import { GoogleGenAI } from '@google/genai';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { CandidateProfileSchema, getJsonSchema, cleanSchemaForGemini } from './schemas.js';
import {
    initFirebase,
    saveJobToFirebase,
    getJobsFromFirebase,
    updateJobInFirebase,
    clearFirebaseHistory,
    syncLocalToFirebase,
    isFirebaseReady,
    saveResumeToFirebase,
    loadResumeFromFirebase,
    saveProfileToFirebase,
    loadProfileFromFirebase
} from './firebase.js';

console.log('CareerFit: Background script loading...');

// Initialize Firebase when extension loads
let firebaseInitialized = false;
async function ensureFirebaseInit() {
    if (firebaseInitialized) return;

    // Get Firebase config from storage
    const { firebaseConfig } = await chrome.storage.sync.get(['firebaseConfig']);
    if (firebaseConfig) {
        const result = await initFirebase(firebaseConfig);
        if (result) {
            firebaseInitialized = true;
            console.log('CareerFit: Firebase ready');
        }
    }
}

// Try to initialize on startup
ensureFirebaseInit();

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // Handle Firebase operations
    if (message.type === 'saveJobToCloud') {
        handleSaveJobToCloud(message.job, sendResponse);
        return true;
    }

    if (message.type === 'getJobsFromCloud') {
        handleGetJobsFromCloud(sendResponse);
        return true;
    }

    if (message.type === 'updateJobInCloud') {
        handleUpdateJobInCloud(message.jobId, message.updates, sendResponse);
        return true;
    }

    if (message.type === 'syncToCloud') {
        handleSyncToCloud(message.jobs, sendResponse);
        return true;
    }

    if (message.type === 'clearCloudHistory') {
        handleClearCloudHistory(sendResponse);
        return true;
    }

    if (message.type === 'setFirebaseConfig') {
        handleSetFirebaseConfig(message.config, sendResponse);
        return true;
    }

    if (message.type === 'checkFirebaseStatus') {
        sendResponse({ ready: isFirebaseReady() });
        return true;
    }

    // Handle resume cloud sync
    if (message.type === 'saveResumeToCloud') {
        (async () => {
            await ensureFirebaseInit();
            const result = await saveResumeToFirebase(message.resume);
            sendResponse({ success: !!result });
        })();
        return true;
    }

    if (message.type === 'loadResumeFromCloud') {
        (async () => {
            await ensureFirebaseInit();
            const resume = await loadResumeFromFirebase();
            sendResponse({ success: !!resume, resume });
        })();
        return true;
    }

    // Handle profile cloud sync
    if (message.type === 'saveProfileToCloud') {
        (async () => {
            await ensureFirebaseInit();
            const result = await saveProfileToFirebase(message.profile);
            sendResponse({ success: !!result });
        })();
        return true;
    }

    if (message.type === 'loadProfileFromCloud') {
        (async () => {
            await ensureFirebaseInit();
            const profile = await loadProfileFromFirebase();
            sendResponse({ success: !!profile, profile });
        })();
        return true;
    }

    // Handle analyzeResume - uses sendResponse for options page
    if (message.type === 'analyzeResume') {
        (async () => {
            try {
                // Get API key from sync (small), resume from local (large)
                const syncData = await chrome.storage.sync.get(['geminiApiKey']);
                const localData = await chrome.storage.local.get(['userResume']);

                if (!syncData.geminiApiKey || !localData.userResume) {
                    sendResponse({ success: false, error: 'API Key or Resume not found. Please save them first.' });
                    return;
                }

                const profile = await analyzeResume(localData.userResume, syncData.geminiApiKey);
                sendResponse({ success: true, data: profile });
            } catch (error) {
                console.error('CareerFit: Error analyzing resume:', error);
                sendResponse({ success: false, error: error.message });
            }
        })();
        return true; // Keep channel open for async response
    }

    // Handle matchBullets - Phase 6 resume bullet matching
    if (message.type === 'matchBullets') {
        handleMatchBullets(message.job, sendResponse);
        return true; // Keep channel open for async response
    }

    if (message.type === 'summarizeRole') {
        // Get API Key from storage (no resume needed for summary)
        chrome.storage.sync.get(['geminiApiKey'], (data) => {
            if (!data.geminiApiKey) {
                chrome.tabs.sendMessage(sender.tab.id, {
                    type: 'analysisError',
                    error: 'API Key not found. Please set it in the extension options.'
                });
                return;
            }
            summarizeRole(message.text, data.geminiApiKey, sender.tab.id);
        });
    } else if (message.type === 'analyzeJobHtml') {
        // Get API Key and candidate profile from storage
        (async () => {
            const syncData = await chrome.storage.sync.get(['geminiApiKey']);
            const localData = await chrome.storage.local.get(['candidateProfile']);

            if (!syncData.geminiApiKey) {
                chrome.tabs.sendMessage(sender.tab.id, {
                    type: 'analysisError',
                    error: 'API Key not found. Please set it in the extension options.'
                });
                return;
            }

            if (!localData.candidateProfile) {
                chrome.tabs.sendMessage(sender.tab.id, {
                    type: 'analysisError',
                    error: 'Profile not found. Please analyze your resume first in the extension options.'
                });
                return;
            }

            // Use enhanced profile instead of raw resume for faster, accurate matching
            callGemini(message.text, localData.candidateProfile, syncData.geminiApiKey, sender.tab.id);
        })();
    }
});

// --- Format candidate profile as structured text for AI matching ---
function formatProfileForMatching(profile) {
    let text = '';

    // Basic info
    text += `EXPERIENCE: ${profile.yearsExperience} years | Level: ${profile.seniorityLevel}\n`;

    // Education
    if (profile.education) {
        text += `EDUCATION: ${profile.education.highestDegree} in ${profile.education.field}`;
        if (profile.education.schools?.length) {
            text += ` (${profile.education.schools.join(', ')})`;
        }
        text += '\n';
    }

    // Functions and industries
    if (profile.functions?.length) {
        text += `FUNCTIONS: ${profile.functions.join(', ')}\n`;
    }
    if (profile.industries?.length) {
        text += `INDUSTRIES: ${profile.industries.join(', ')}\n`;
    }

    // Technical skills with years
    if (profile.hardSkills?.length) {
        text += '\nTECHNICAL SKILLS:\n';
        profile.hardSkills.forEach(skill => {
            if (typeof skill === 'object' && skill.skill) {
                text += `- ${skill.skill} (${skill.years} years)\n`;
            } else {
                // Fallback for old format (just string array)
                text += `- ${skill}\n`;
            }
        });
    }

    // Soft skills
    if (profile.softSkills?.length) {
        text += `\nSOFT SKILLS: ${profile.softSkills.join(', ')}\n`;
    }

    // Certifications
    if (profile.certifications?.length) {
        text += `\nCERTIFICATIONS: ${profile.certifications.join(', ')}\n`;
    }

    return text;
}

// --- Shared HTML formatting for consistent design ---
function formatRoleHtml(data, options = {}) {
    const { showScore = false, fitScore = null, gaps = [], disqualifiers = [], isAssess = false } = options;
    const years = data.yearsRequired || 'Not specified';
    const managerType = data.managerType || '';
    const func = data.function || '';
    const uniqueReqs = data.uniqueRequirements || [];

    // Score color using trend palette
    let scoreColor = '#4a4a4a'; // grey for low
    if (fitScore >= 4) { scoreColor = '#3d8b6e'; }
    else if (fitScore >= 3) { scoreColor = '#c9a050'; }

    let html = `<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 12px; line-height: 1.35;">`;

    // Score badge (only for Assess)
    if (showScore && fitScore !== null) {
        html += `
            <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px; padding-bottom: 8px; border-bottom: 1px solid #eee;">
                <div style="width: 38px; height: 38px; border-radius: 50%; background: ${scoreColor}; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
                    <span style="color: white; font-size: 18px; font-weight: 700;">${fitScore}</span>
                </div>
                <div>
                    <div style="font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; color: #222;">Fit Score</div>
                    <div style="font-size: 14px; font-weight: 600; color: ${scoreColor};">${fitScore >= 4 ? 'Great Match' : fitScore >= 3 ? 'Good Match' : fitScore >= 2 ? 'Stretch' : 'Low Match'}</div>
                </div>
            </div>
        `;
    }

    // Disqualifiers warning (missing minimum qualifications)
    if (isAssess && disqualifiers.length > 0) {
        html += `
            <div style="background: #ffebee; border: 1px solid #ffcdd2; border-radius: 5px; padding: 8px; margin-bottom: 8px;">
                <div style="display: flex; align-items: center; gap: 6px; margin-bottom: 4px;">
                    <span style="font-size: 14px;">⚠️</span>
                    <span style="font-size: 11px; font-weight: 600; color: #c62828; text-transform: uppercase; letter-spacing: 0.5px;">Missing Minimum Qualifications</span>
                </div>
                ${disqualifiers.map(d => `
                    <div style="margin-bottom: 4px; padding-left: 20px;">
                        <div style="font-size: 11px; color: #b71c1c; font-weight: 500;">${d.requirement}</div>
                        ${d.resumeHas ? `<div style="font-size: 12px; color: #666; margin-top: 1px;">Your resume: ${d.resumeHas}</div>` : ''}
                    </div>
                `).join('')}
            </div>
        `;
    }

    // Role basics - Creamy white tags with green text
    html += `
        <div style="margin-bottom: 10px;">
            <div style="display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 6px;">
                <span style="background: #F5F3E7; color: #2d6b52; padding: 4px 10px; border-radius: 10px; font-size: 12px; font-weight: 600; border: 1px solid #e0ddd0;">${years}</span>
                ${managerType ? `<span style="background: ${managerType === 'People Manager' ? '#f5f0e0' : '#e8f5f1'}; color: ${managerType === 'People Manager' ? '#6b5a30' : '#2d6b52'}; padding: 4px 10px; border-radius: 10px; font-size: 12px; font-weight: 600; border: 1px solid ${managerType === 'People Manager' ? '#e8e0d0' : '#d0e8e0'};">${managerType}</span>` : ''}
            </div>
            ${func ? `<p style="margin: 6px 0 0 0; font-size: 13px; color: #444; line-height: 1.4;">${func}</p>` : ''}
        </div>
    `;

    // Role requirements
    if (uniqueReqs.length > 0) {
        html += `
            <div style="margin-bottom: 8px;">
                <div style="font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; color: #2d6b52; margin-bottom: 4px; font-weight: 600;">Looking For</div>
                <ul style="margin: 0; padding-left: 16px;">
                    ${uniqueReqs.map(req => `<li style="font-size: 12px; color: #333; margin-bottom: 2px;">${req}</li>`).join('')}
                </ul>
            </div>
        `;
    } else if (!isAssess) {
        html += `<p style="color: #888; font-style: italic; font-size: 11px;">Standard role - no specific requirements</p>`;
    }

    // Gaps with learning resources - Yellow left border, cream background
    if (isAssess && gaps.length > 0) {
        html += `
            <div style="margin-top: 8px; padding-top: 8px; border-top: 1px solid #eee;">
                <div style="font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; color: #2d6b52; margin-bottom: 4px; font-weight: 600;">Skills to Develop</div>
                ${gaps.map(gap => `
                    <div style="background: #fdfcf8; border-radius: 5px; padding: 6px 8px; margin-bottom: 4px; border-left: 3px solid #F0D58C; position: relative;">
                        <button class="save-skill-btn" data-skill="${(gap.skill || '').replace(/"/g, '&quot;')}" data-resources="${(gap.resources || '').replace(/"/g, '&quot;')}" data-keywords="${(gap.keywords || []).join(',').replace(/"/g, '&quot;')}" style="position: absolute; top: 4px; right: 4px; width: 20px; height: 20px; border-radius: 50%; border: 1px solid #d0e8e0; background: #e8f5f1; color: #2d6b52; font-size: 14px; font-weight: 600; cursor: pointer; display: flex; align-items: center; justify-content: center; padding: 0; line-height: 1;" title="Save to learning list">+</button>
                        <div style="font-size: 12px; font-weight: 600; color: #333; padding-right: 24px;">${gap.skill || 'Unknown skill'}</div>
                        ${gap.resources ? `<div style="font-size: 12px; color: #555; margin-top: 1px;">${gap.resources}</div>` : ''}
                        ${gap.keywords && gap.keywords.length > 0 ? `
                            <div style="margin-top: 4px;">
                                <span style="font-size: 12px; color: #888;">Add to resume: </span>
                                ${gap.keywords.map(kw => `<span style="background: #e8f5f1; color: #2d6b52; padding: 1px 5px; border-radius: 4px; font-size: 12px; margin-right: 3px;">${kw}</span>`).join('')}
                            </div>
                        ` : ''}
                    </div>`).join('')}
            </div>
        `;
    }

    html += `</div>`;
    return html;
}

async function summarizeRole(jobText, apiKey, tabId) {
    try {
        const ai = new GoogleGenAI({ vertexai: false, apiKey: apiKey });

        const zodSchema = z.object({
            yearsRequired: z.string().describe('Years of experience mentioned (e.g., "5+ years", "3-5 years"). If not mentioned, say "Not specified".'),
            managerType: z.string().describe('"IC" or "People Manager"'),
            function: z.string().describe('Plain English: what kind of work? E.g., "Engineering - shipping software with devs", "Operations - internal processes", "Product - building features"'),
            uniqueRequirements: z.array(z.string()).describe('Specific skills/tools/domains needed. Max 6 short items.')
        });

        const rawSchema = zodToJsonSchema(zodSchema);
        const schemaToBeProcessed = cleanSchemaForGemini(rawSchema);
        schemaToBeProcessed['propertyOrdering'] = ['yearsRequired', 'managerType', 'function', 'uniqueRequirements'];

        const prompt = `Job: ${jobText}

Extract key info:
- yearsRequired: exact years (e.g., "5+ years", "3-5 years"). Extract the NUMBER only.
- managerType: "IC" or "People Manager"
- function: 1 sentence - what does this person DO daily?
- uniqueRequirements: 4-6 SPECIFIC things this role needs (NOT years of experience - that's already in yearsRequired)

GOOD unique requirements (things that filter out most candidates):
- "Retail/Shopping Ads experience"
- "Healthcare industry required"
- "PMP certification required"
- "Tableau proficiency"
- "On-site 5 days/week"
- "No visa sponsorship"
- "Masters degree preferred"
- "Spanish fluency required"
- "AWS/Azure experience"

BAD - NEVER include these in uniqueRequirements:
- Years of experience (already captured in yearsRequired)
- "Cross-functional collaboration"
- "Project management"
- "Stakeholder management"
- "Strong communication"
- "Data analysis skills"
- "Problem solving"
- "Detail-oriented"
- "Fast-paced environment"
- "Team collaboration"
- "Strategic thinking"

RULE: If 80% of applicants would have this skill, it's NOT unique. Skip it.

Each item: max 5 words, no parentheses, no repetition.`;

        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: prompt,
            config: {
                responseMimeType: 'application/json',
                responseSchema: schemaToBeProcessed,
            },
        });

        console.log('CareerFit: Summary response:', response.text);

        let data;
        try {
            data = JSON.parse(response.text);
        } catch (parseError) {
            console.error('CareerFit: Failed to parse summary response:', parseError);
            throw new Error('Invalid response format from AI service');
        }

        console.log('CareerFit: Parsed data:', JSON.stringify(data, null, 2));

        // Extract fields - schema enforces exact names
        const years = data.yearsRequired || 'Not specified';
        const managerType = data.managerType || '';
        const func = data.function || '';
        const uniqueReqs = Array.isArray(data.uniqueRequirements) ? data.uniqueRequirements : [];

        // Use shared formatting
        const formattedHtml = formatRoleHtml({
            yearsRequired: years,
            managerType,
            function: func,
            uniqueRequirements: uniqueReqs
        });

        // Send both HTML and raw data for history saving
        chrome.tabs.sendMessage(tabId, {
            type: 'summaryResult',
            data: formattedHtml,
            summary: {
                yearsRequired: years,
                managerType,
                function: func,
                uniqueRequirements: uniqueReqs
            }
        });

    } catch (error) {
        console.error("Error summarizing role:", error);
        chrome.tabs.sendMessage(tabId, {
            type: 'analysisError',
            error: `Error summarizing role: ${error.message}`
        });
    }
}

async function callGemini(jobHtml, candidateProfile, apiKey, tabId) {
    try {
        const ai = new GoogleGenAI({ vertexai: false, apiKey: apiKey });

        // Schema for disqualifiers (missing MINIMUM qualifications)
        const disqualifierSchema = z.object({
            requirement: z.string().describe('The minimum requirement not met (e.g., "6 years management consulting")'),
            resume_has: z.string().describe('What the candidate has instead (e.g., "3 years strategy experience")')
        });

        // Schema for gaps (missing PREFERRED qualifications - fixable)
        const gapSchema = z.object({
            skill_name: z.string().describe('Specific technical skill, tool, certification, or industry experience. NEVER generic skills like "communication", "leadership", "problem-solving".'),
            resources: z.string().describe('1-2 specific learning resources (course name, certification, book title)'),
            keywords: z.array(z.string()).describe('2-3 exact keywords to add to resume for ATS matching')
        });

        const zodSchema = z.object({
            years_required: z.string().describe('Years of experience required. Say "Not specified" if not mentioned.'),
            manager_type: z.string().describe('"IC" or "People Manager"'),
            job_function: z.string().describe('What kind of work (e.g., "Product - building features")'),
            unique_requirements: z.array(z.string()).describe('ONLY requirements that filter 80%+ of candidates: specific tools (ServiceNow, Tableau), certifications (PMP, CPA), industries (healthcare, fintech), degrees, location/visa constraints. NEVER generic skills like "communication", "project management", "cross-functional collaboration", "data analysis", "stakeholder management". Max 6 items.'),
            disqualifiers: z.array(disqualifierSchema).describe('MINIMUM qualifications the candidate does NOT meet. Only include hard requirements from "Minimum Qualifications" section. Empty array if all minimums are met.'),
            fit_score: z.number().min(1).max(5).describe('Fit score 1-5. If disqualifiers exist, score should be 1-2.'),
            gaps: z.array(gapSchema).describe('1-3 SPECIFIC skills from "Preferred" section that candidate lacks. Must be learnable (tools, certifications, industry knowledge). NEVER include: communication, leadership, collaboration, stakeholder management, problem-solving, or other soft skills.')
        });

        const rawSchema = zodToJsonSchema(zodSchema);
        const schemaToBeProcessed = cleanSchemaForGemini(rawSchema);
        schemaToBeProcessed['propertyOrdering'] = [
            'years_required',
            'manager_type',
            'job_function',
            'unique_requirements',
            'disqualifiers',
            'fit_score',
            'gaps'
        ];

        // Format candidate profile as structured text for better matching
        const profileText = formatProfileForMatching(candidateProfile);

        const prompt = `Analyze this job against the candidate profile. CRITICAL: Distinguish between MINIMUM and PREFERRED qualifications.

**MINIMUM QUALIFICATIONS** (usually labeled "Minimum qualifications", "Requirements", or "Must have"):
- If candidate does NOT meet these → add to "disqualifiers" array
- Examples: "6 years in management consulting", "Bachelor's degree required", "Must have CPA"

**PREFERRED QUALIFICATIONS → GAPS** (usually labeled "Preferred", "Nice to have", or "Bonus"):
- If candidate lacks these → add to "gaps" array (max 3)
- ONLY include SPECIFIC, LEARNABLE skills: tools (Kubernetes, Tableau), certifications (AWS, PMP), industry experience (healthcare, fintech)
- NEVER include soft skills: communication, leadership, collaboration, stakeholder management, problem-solving, analytical thinking

**Scoring Rules:**
- If ANY disqualifier exists → fit_score MUST be 1 or 2
- If no disqualifiers but some gaps → fit_score can be 3-4
- If no disqualifiers and few/no gaps → fit_score can be 4-5

**CANDIDATE PROFILE:**
${profileText}

**JOB POSTING:**
${jobHtml}`;

        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: prompt,
            config: {
                responseMimeType: 'application/json',
                responseSchema: schemaToBeProcessed,
            },
        });

        console.log('CareerFit: Raw API response text:', response.text);

        let analysisData;
        try {
            analysisData = JSON.parse(response.text);
            console.log('CareerFit: Parsed analysis data:', analysisData);
        } catch (parseError) {
            console.error('CareerFit: Failed to parse API response as JSON:', parseError);
            console.error('CareerFit: Raw response that failed to parse:', response.text);
            throw new Error('Invalid response format from AI service');
        }

        // Map snake_case from API to camelCase for internal use
        const yearsRequired = analysisData.years_required || 'Not specified';
        const managerType = analysisData.manager_type || '';
        const func = analysisData.job_function || '';
        const uniqueReqs = analysisData.unique_requirements || [];

        // Extract disqualifiers (missing minimum qualifications)
        const disqualifiers = Array.isArray(analysisData.disqualifiers)
            ? analysisData.disqualifiers.map(d => ({
                requirement: d.requirement || '',
                resumeHas: d.resume_has || ''
            }))
            : [];

        // Cap score at 2 if any disqualifiers exist
        let rawScore = analysisData.fit_score;
        if (disqualifiers.length > 0 && rawScore > 2) {
            console.log('CareerFit: Capping score from', rawScore, 'to 2 due to disqualifiers');
            rawScore = 2;
        }
        const fitScore = (typeof rawScore === 'number' && rawScore >= 1 && rawScore <= 5) ? rawScore : 3;

        // Map gap fields from snake_case
        const gaps = Array.isArray(analysisData.gaps)
            ? analysisData.gaps.map(gap => ({
                skill: gap.skill_name || 'Unknown skill',
                resources: gap.resources || '',
                keywords: Array.isArray(gap.keywords) ? gap.keywords : []
            }))
            : [];

        // Use shared formatting function
        const formattedHtml = formatRoleHtml(
            {
                yearsRequired,
                managerType,
                function: func,
                uniqueRequirements: uniqueReqs
            },
            {
                showScore: true,
                fitScore,
                gaps,
                disqualifiers,
                isAssess: true
            }
        );

        // Send the formatted HTML and raw analysis data back to the content script
        chrome.tabs.sendMessage(tabId, {
            type: 'analysisResult',
            data: formattedHtml,
            analysis: {
                fitScore,
                gaps,
                disqualifiers,
                // Include summary data for saving to history
                yearsRequired,
                managerType,
                function: func,
                uniqueRequirements: uniqueReqs
            }
        });

    } catch (error) {
        console.error("Error calling Gemini:", error);
        chrome.tabs.sendMessage(tabId, {
            type: 'analysisError',
            error: `An error occurred during analysis: ${error.message}`
        });
    }
}

// --- Analyze Resume to extract Candidate Profile ---
async function analyzeResume(resumeText, apiKey) {
    const ai = new GoogleGenAI({ vertexai: false, apiKey: apiKey });

    const prompt = `You are a career coach analyzing a resume to create a profile for job matching.

RESUME:
${resumeText}

Extract the following for accurate job matching:

1. yearsExperience: Total years (e.g., "7", "5-7"). Calculate from earliest job to present.

2. seniorityLevel: Current level (Entry/Mid/Senior/Manager/Director/VP)

3. education:
   - highestDegree: Abbreviation only (PhD, MBA, MS, BS, etc.)
   - field: Major/concentration
   - schools: Array with degrees (e.g., ["Kelley School of Business (MBA)", "Virginia Tech (BS)"])

4. functions: Types of work (e.g., ["Product Management", "Operations"])

5. industries: Industries worked in (e.g., ["CPG", "Tech", "FinTech"])

6. hardSkills: Array of ALL technical skills found in resume, each with:
   - skill: The skill name (e.g., "SQL", "Python", "Agile", "ServiceNow", "ITIL", "Tableau", "SAP")
   - years: Years of experience with this skill
   IMPORTANT: Include EVERY technical skill mentioned. No limit - be thorough as these are used for job matching.

7. softSkills: Leadership skills (e.g., ["Cross-functional leadership", "Executive communication"])

8. certifications: ALL certifications found in resume (e.g., ["PMP", "AWS Solutions Architect", "ITIL", "Six Sigma", "Google Analytics"]). Include every certification mentioned.

9. hardFilters:
    - maxYearsRequired: Their years + 2
    - excludeTitles: Too senior (e.g., ["VP", "Chief", "Director"])
    - excludeRequirements: Can't meet (e.g., ["PhD", "CPA"])

Be thorough with skills - list every technical tool, methodology, and platform found in the resume.`;

    const schemaJson = getJsonSchema(CandidateProfileSchema);

    const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: prompt,
        config: {
            responseMimeType: 'application/json',
            responseSchema: schemaJson,
        },
    });

    console.log('CareerFit: Resume analysis response:', response.text);

    let profile;
    try {
        profile = JSON.parse(response.text);
    } catch (parseError) {
        console.error('CareerFit: Failed to parse resume analysis:', parseError);
        throw new Error('Invalid response format from AI service');
    }

    profile.analyzedAt = new Date().toISOString();

    // Save to sync storage (syncs across devices)
    try {
        await chrome.storage.sync.set({ candidateProfile: profile });
        console.log('CareerFit: Candidate profile saved to sync storage');
    } catch (syncError) {
        // If sync fails (e.g., quota exceeded), fall back to local
        console.warn('CareerFit: Sync storage failed, using local:', syncError.message);
        await chrome.storage.local.set({ candidateProfile: profile });
    }

    return profile;
}

/// --- Phase 6: Resume Bullet Matching ---
async function handleMatchBullets(job, sendResponse) {
    try {
        const syncData = await chrome.storage.sync.get(['geminiApiKey', 'userResume']);

        if (!syncData.geminiApiKey) {
            sendResponse({ success: false, error: 'API Key not found.' });
            return;
        }

        if (!syncData.userResume) {
            sendResponse({ success: false, error: 'Resume not found. Please save your resume in the extension options.' });
            return;
        }

        const result = await matchResumeBullets(job, syncData.userResume, syncData.geminiApiKey);
        sendResponse({ success: true, data: result });
    } catch (error) {
        console.error('CareerFit: Error matching bullets:', error);
        sendResponse({ success: false, error: error.message });
    }
}

async function matchResumeBullets(job, resumeText, apiKey) {
    const ai = new GoogleGenAI({ vertexai: false, apiKey: apiKey });

    // Define schema for bullet matching
    const bulletMatchSchema = z.object({
        matches: z.array(z.object({
            bullet: z.string().describe('The resume bullet point that matches'),
            strength: z.enum(['strong', 'moderate']).describe('How strong the match is'),
            reason: z.string().describe('Why this bullet matches the job (1 sentence)')
        })).describe('Resume bullets that match the job'),
        suggestions: z.array(z.string()).describe('2-3 suggestions to strengthen the application')
    });

    const rawSchema = zodToJsonSchema(bulletMatchSchema);
    const schemaJson = cleanSchemaForGemini(rawSchema);
    schemaJson['propertyOrdering'] = ['matches', 'suggestions'];

    const prompt = `Analyze which parts of this resume best match this job posting.

JOB:
- Title: ${job.title}
- Company: ${job.company}

RESUME:
${resumeText}

For each relevant resume bullet point or accomplishment:
1. Identify bullets that demonstrate skills/experience relevant to "${job.title}" at "${job.company}"
2. Rate match strength: "strong" (directly relevant) or "moderate" (transferable)
3. Explain WHY it matches in 1 short sentence

Also provide 2-3 specific suggestions on how to strengthen the application for this role.

Be selective - only include bullets that genuinely match. Quality over quantity.`;

    const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: prompt,
        config: {
            responseMimeType: 'application/json',
            responseSchema: schemaJson,
        },
    });

    console.log('CareerFit: Match bullets response:', response.text);

    let result;
    try {
        result = JSON.parse(response.text);
    } catch (parseError) {
        console.error('CareerFit: Failed to parse bullet match response:', parseError);
        throw new Error('Invalid response format from AI service');
    }

    return result;
}

// --- Firebase Handler Functions ---

async function handleSaveJobToCloud(job, sendResponse) {
    await ensureFirebaseInit();
    try {
        const result = await saveJobToFirebase(job);
        sendResponse({ success: !!result, data: result });
    } catch (error) {
        console.error('CareerFit: Error saving to cloud:', error);
        sendResponse({ success: false, error: error.message });
    }
}

async function handleGetJobsFromCloud(sendResponse) {
    await ensureFirebaseInit();
    try {
        const jobs = await getJobsFromFirebase();
        sendResponse({ success: true, data: jobs });
    } catch (error) {
        console.error('CareerFit: Error getting jobs from cloud:', error);
        sendResponse({ success: false, error: error.message, data: [] });
    }
}

async function handleUpdateJobInCloud(jobId, updates, sendResponse) {
    await ensureFirebaseInit();
    try {
        const result = await updateJobInFirebase(jobId, updates);
        sendResponse({ success: result });
    } catch (error) {
        console.error('CareerFit: Error updating job in cloud:', error);
        sendResponse({ success: false, error: error.message });
    }
}

async function handleSyncToCloud(jobs, sendResponse) {
    await ensureFirebaseInit();
    try {
        const result = await syncLocalToFirebase(jobs);
        sendResponse({ success: result });
    } catch (error) {
        console.error('CareerFit: Error syncing to cloud:', error);
        sendResponse({ success: false, error: error.message });
    }
}

async function handleClearCloudHistory(sendResponse) {
    await ensureFirebaseInit();
    try {
        const result = await clearFirebaseHistory();
        sendResponse({ success: result });
    } catch (error) {
        console.error('CareerFit: Error clearing cloud history:', error);
        sendResponse({ success: false, error: error.message });
    }
}

async function handleSetFirebaseConfig(config, sendResponse) {
    try {
        // Save config to storage
        await chrome.storage.sync.set({ firebaseConfig: config });

        // Re-initialize Firebase with new config
        firebaseInitialized = false;
        const result = await initFirebase(config);

        if (result) {
            firebaseInitialized = true;
            sendResponse({ success: true });
        } else {
            sendResponse({ success: false, error: 'Failed to initialize Firebase' });
        }
    } catch (error) {
        console.error('CareerFit: Error setting Firebase config:', error);
        sendResponse({ success: false, error: error.message });
    }
}

console.log('CareerFit: Background script loaded successfully');