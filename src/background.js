import { GoogleGenAI } from '@google/genai';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { CandidateProfileSchema, FitAnalysisSchema, getJsonSchema } from './schemas.js';
import {
    initFirebase,
    saveJobToFirebase,
    getJobsFromFirebase,
    updateJobInFirebase,
    deleteJobFromFirebase,
    clearFirebaseHistory,
    syncLocalToFirebase,
    isFirebaseReady
} from './firebase.js';

console.log('CareerFit: Background script loading...');

// Helper to clean JSON Schema for Gemini (removes unsupported fields)
function cleanSchemaForGemini(schema) {
    if (!schema || typeof schema !== 'object') return schema;

    const cleaned = {};
    for (const [key, value] of Object.entries(schema)) {
        // Skip unsupported JSON Schema fields
        if (['additionalProperties', '$schema'].includes(key)) continue;

        if (Array.isArray(value)) {
            cleaned[key] = value.map(item => cleanSchemaForGemini(item));
        } else if (typeof value === 'object' && value !== null) {
            cleaned[key] = cleanSchemaForGemini(value);
        } else {
            cleaned[key] = value;
        }
    }
    return cleaned;
}

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

    // Handle analyzeResume - uses sendResponse for options page
    if (message.type === 'analyzeResume') {
        chrome.storage.sync.get(['geminiApiKey', 'userResume'], async (data) => {
            if (!data.geminiApiKey || !data.userResume) {
                sendResponse({ success: false, error: 'API Key or Resume not found. Please save them first.' });
                return;
            }
            try {
                const profile = await analyzeResume(data.userResume, data.geminiApiKey);
                sendResponse({ success: true, data: profile });
            } catch (error) {
                console.error('CareerFit: Error analyzing resume:', error);
                sendResponse({ success: false, error: error.message });
            }
        });
        return true; // Keep channel open for async response
    }

    // Handle scoreJob - for batch scanning
    if (message.type === 'scoreJob') {
        handleScoreJob(message.job, sendResponse);
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
        // Get API Key and Resume from storage first
        chrome.storage.sync.get(['geminiApiKey', 'userResume'], (data) => {
            if (!data.geminiApiKey || !data.userResume) {
                chrome.tabs.sendMessage(sender.tab.id, {
                    type: 'analysisError',
                    error: 'API Key or Resume not found. Please set them in the extension options.'
                });
                return;
            }
            // If we have the data, call the AI
            callGemini(message.text, data.userResume, data.geminiApiKey, sender.tab.id);
        });
    }
});

// --- Shared HTML formatting for consistent design ---
function formatRoleHtml(data, options = {}) {
    const { showScore = false, fitScore = null, gaps = [], isAssess = false } = options;
    const years = data.yearsRequired || 'Not specified';
    const managerType = data.managerType || '';
    const func = data.function || '';
    const uniqueReqs = data.uniqueRequirements || [];

    // Score color
    let scoreColor = '#9e9e9e';
    if (fitScore >= 4) scoreColor = '#4caf50';
    else if (fitScore >= 3) scoreColor = '#ff9800';
    else if (fitScore >= 2) scoreColor = '#ff5722';
    else if (fitScore >= 1) scoreColor = '#f44336';

    let html = `<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.5;">`;

    // Score badge (only for Assess)
    if (showScore && fitScore !== null) {
        html += `
            <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 16px; padding-bottom: 16px; border-bottom: 1px solid #eee;">
                <div style="width: 56px; height: 56px; border-radius: 50%; background: ${scoreColor}; display: flex; align-items: center; justify-content: center;">
                    <span style="color: white; font-size: 24px; font-weight: 700;">${fitScore}</span>
                </div>
                <div>
                    <div style="font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; color: #888;">Fit Score</div>
                    <div style="font-size: 18px; font-weight: 600; color: ${scoreColor};">${fitScore >= 4 ? 'Great Match' : fitScore >= 3 ? 'Good Match' : fitScore >= 2 ? 'Stretch' : 'Low Match'}</div>
                </div>
            </div>
        `;
    }

    // Role basics
    html += `
        <div style="margin-bottom: 16px;">
            <div style="display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 8px;">
                <span style="background: #e3f2fd; color: #1565c0; padding: 4px 10px; border-radius: 16px; font-size: 12px; font-weight: 500;">${years}</span>
                ${managerType ? `<span style="background: ${managerType === 'People Manager' ? '#f3e5f5' : '#e8f5e9'}; color: ${managerType === 'People Manager' ? '#7b1fa2' : '#2e7d32'}; padding: 4px 10px; border-radius: 16px; font-size: 12px; font-weight: 500;">${managerType}</span>` : ''}
            </div>
            ${func ? `<p style="margin: 0; font-size: 14px; color: #555;">${func}</p>` : ''}
        </div>
    `;

    // Role requirements
    if (uniqueReqs.length > 0) {
        html += `
            <div style="margin-bottom: 16px;">
                <div style="font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; color: #888; margin-bottom: 8px;">Role Looking For</div>
                <ul style="margin: 0; padding-left: 16px;">
                    ${uniqueReqs.map(req => `<li style="font-size: 13px; color: #333; margin-bottom: 4px;">${req}</li>`).join('')}
                </ul>
            </div>
        `;
    } else if (!isAssess) {
        html += `<p style="color: #888; font-style: italic; font-size: 13px;">Standard role - no specific requirements</p>`;
    }

    // Gaps with learning resources (only for Assess)
    if (isAssess && gaps.length > 0) {
        html += `
            <div style="margin-top: 16px; padding-top: 16px; border-top: 1px solid #eee;">
                <div style="font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; color: #e65100; margin-bottom: 10px;">Gaps</div>
                ${gaps.map(gap => `
                    <div style="background: #fff8e1; border-radius: 6px; padding: 10px 12px; margin-bottom: 8px;">
                        <div style="font-size: 13px; font-weight: 600; color: #333;">${gap.skill || 'Unknown skill'}</div>
                        ${gap.resources ? `<div style="font-size: 12px; color: #555; margin: 4px 0;">Learn: ${gap.resources}</div>` : ''}
                        ${gap.funFact ? `<div style="font-size: 11px; color: #888; font-style: italic;">${gap.funFact}</div>` : ''}
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
            uniqueRequirements: z.array(z.string()).describe('What makes THIS role different. Include: specific domain/industry, specific products, specific tools/skills, company-specific processes, hardware vs software, target audience. Plain English + (original term). Max 8.')
        });

        const rawSchema = zodToJsonSchema(zodSchema);
        const schemaToBeProcessed = cleanSchemaForGemini(rawSchema);
        schemaToBeProcessed['propertyOrdering'] = ['yearsRequired', 'managerType', 'function', 'uniqueRequirements'];

        const prompt = `Job: ${jobText}

Extract what makes this role UNIQUE:
- yearsRequired: exact years mentioned
- managerType: IC or People Manager
- function: what kind of work (plain English)
- uniqueRequirements: specific domain, products, tools, processes, audience. NOT generic PM skills. Plain English + (original jargon). Max 8.`;

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

async function callGemini(jobHtml, resume, apiKey, tabId) {
    try {
        const ai = new GoogleGenAI({ vertexai: false, apiKey: apiKey });

        // Use snake_case in schema (Gemini prefers it), then map to camelCase in code
        const gapSchema = z.object({
            skill_name: z.string().describe('The specific skill gap (e.g., "HIPAA compliance")'),
            resources: z.string().describe('1-2 learning resources as a single string'),
            surprising_fact: z.string().optional().describe('One surprising fact about this skill')
        });

        const zodSchema = z.object({
            years_required: z.string().describe('Years of experience (e.g., "5+ years"). Say "Not specified" if not mentioned.'),
            manager_type: z.string().describe('"IC" or "People Manager"'),
            job_function: z.string().describe('What kind of work (e.g., "Product - building features")'),
            unique_requirements: z.array(z.string()).describe('What makes this role unique. Max 8 items.'),
            fit_score: z.number().min(1).max(5).describe('Fit score 1-5'),
            gaps: z.array(gapSchema).describe('Skill gaps. Only real gaps, not nice-to-haves.')
        });

        const rawSchema = zodToJsonSchema(zodSchema);
        const schemaToBeProcessed = cleanSchemaForGemini(rawSchema);
        schemaToBeProcessed['propertyOrdering'] = [
            'years_required',
            'manager_type',
            'job_function',
            'unique_requirements',
            'fit_score',
            'gaps'
        ];

        const prompt = `Analyze this job against the resume. Be concise.

**Resume:**
${resume}

**Job:**
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
        const rawScore = analysisData.fit_score;
        const fitScore = (typeof rawScore === 'number' && rawScore >= 1 && rawScore <= 5) ? rawScore : 3;

        // Map gap fields from snake_case
        const gaps = Array.isArray(analysisData.gaps)
            ? analysisData.gaps.map(gap => ({
                skill: gap.skill_name || 'Unknown skill',
                resources: gap.resources || '',
                funFact: gap.surprising_fact || ''
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

    const prompt = `You are a career coach analyzing a resume to help match this person to jobs.

RESUME:
${resumeText}

IMPORTANT: Carefully scan the ENTIRE resume including the Education section which is often at the bottom. Look for degree names (BS, BA, MS, MBA, PhD, etc.), university/college names, and fields of study.

Extract the following structured data:

1. yearsExperience: Total years of professional experience (e.g., "7", "5-7"). Calculate from earliest job date to present.
2. seniorityLevel: Current career level (Entry/Mid/Senior/Manager/Director/VP)
3. education: REQUIRED - Look for Education section in resume
   - highestDegree: Highest degree earned. Use the degree abbreviation only: PhD, MBA, MS, MA, BS, BA, BBA, Associate's. Do NOT expand MBA to "MBA in Business Administration" - just say "MBA".
   - field: Field of study / major / concentration. For MBA, use the concentration if any (e.g., "Finance", "Marketing") or leave as "General Management". For other degrees, use the actual major (e.g., "Business Information Technology", "Computer Science").
   - schools: Array of ALL schools/universities attended with their degrees, highest first (e.g., ["Kelley School of Business (MBA)", "Virginia Tech (BS)"])
4. functions: Types of work they do (e.g., ["Product Management", "Operations", "Engineering"])
5. industries: Industries they've worked in (e.g., ["CPG", "Tech", "Automotive"])
6. hardSkills: Technical skills - tools, languages, methodologies (e.g., ["SQL", "Python", "Agile"])
7. softSkills: Leadership, communication skills (e.g., ["Cross-functional leadership", "Stakeholder management"])
8. certifications: Any certifications (e.g., ["PMP", "Six Sigma Green Belt"])
9. targetTitles: 8-12 job titles they should search for - INCLUDE BOTH their current level AND entry-level/junior roles they qualify for (e.g., if they're a Senior PM, also include "Product Manager", "Associate Product Manager")
10. searchQueries: 3-5 Boolean search strings for job boards (e.g., "product manager AND operations")
11. keywords: 10-15 keywords that should appear in matching job descriptions
12. hardFilters: Disqualifiers
    - maxYearsRequired: Max years a job can require (their years + 2)
    - excludeTitles: Titles too senior (e.g., ["VP", "Chief", "Director"] if they're Manager level)
    - excludeRequirements: Requirements they can't meet (e.g., ["PhD", "CPA", "10+ years"])

Be specific and actionable. The targetTitles and searchQueries will be used directly for job searching.`;

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

    // Save to local storage
    await chrome.storage.local.set({ candidateProfile: profile });
    console.log('CareerFit: Candidate profile saved:', profile);

    return profile;
}

// --- Phase 5: Score Job for Batch Scanning ---
async function handleScoreJob(job, sendResponse) {
    try {
        // Get API key and candidate profile
        const syncData = await chrome.storage.sync.get(['geminiApiKey']);
        const localData = await chrome.storage.local.get(['candidateProfile']);

        if (!syncData.geminiApiKey) {
            sendResponse({ success: false, error: 'API Key not found.' });
            return;
        }

        if (!localData.candidateProfile) {
            sendResponse({ success: false, error: 'Candidate profile not found. Please analyze your resume first.' });
            return;
        }

        const result = await scoreJob(job, localData.candidateProfile, syncData.geminiApiKey);
        sendResponse({ success: true, data: result });
    } catch (error) {
        console.error('CareerFit: Error scoring job:', error);
        sendResponse({ success: false, error: error.message });
    }
}

async function scoreJob(job, candidateProfile, apiKey) {
    const ai = new GoogleGenAI({ vertexai: false, apiKey: apiKey });

    // Create a job description string from available info
    const jobDescription = `
Job Title: ${job.title}
Company: ${job.company}
Location: ${job.location || 'Not specified'}
Link: ${job.link}
    `.trim();

    const prompt = `Compare this candidate profile to this job posting and provide a fit score.

CANDIDATE PROFILE:
- Years of Experience: ${candidateProfile.yearsExperience}
- Seniority Level: ${candidateProfile.seniorityLevel}
- Functions: ${candidateProfile.functions?.join(', ') || 'Not specified'}
- Industries: ${candidateProfile.industries?.join(', ') || 'Not specified'}
- Hard Skills: ${candidateProfile.hardSkills?.join(', ') || 'Not specified'}
- Soft Skills: ${candidateProfile.softSkills?.join(', ') || 'Not specified'}
- Target Titles: ${candidateProfile.targetTitles?.join(', ') || 'Not specified'}

JOB POSTING:
${jobDescription}

Score from 1-5:
- 5: Excellent Fit - title matches target, experience level appropriate
- 4: Good Fit - close title match, likely qualified
- 3: Possible Fit - related field, some gaps
- 2: Stretch - significant gaps but some transferable skills
- 1: Poor Fit - major mismatches in title/function

Based ONLY on title/company matching to candidate's target titles and experience level, give an honest assessment. Since we only have limited job info, focus on title relevance.`;

    const schemaJson = getJsonSchema(FitAnalysisSchema);

    const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: prompt,
        config: {
            responseMimeType: 'application/json',
            responseSchema: schemaJson,
        },
    });

    console.log('CareerFit: Score job response:', response.text);

    let result;
    try {
        result = JSON.parse(response.text);
    } catch (parseError) {
        console.error('CareerFit: Failed to parse score response:', parseError);
        throw new Error('Invalid response format from AI service');
    }

    return result;
}

// --- Phase 6: Resume Bullet Matching ---
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