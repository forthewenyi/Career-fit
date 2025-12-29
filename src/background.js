import { GoogleGenAI } from '@google/genai';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { CandidateProfileSchema, FitAnalysisSchema, getJsonSchema } from './schemas.js';

console.log('CareerFit: Background script loading...');

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
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

async function summarizeRole(jobText, apiKey, tabId) {
    try {
        const ai = new GoogleGenAI({ vertexai: false, apiKey: apiKey });

        const zodSchema = z.object({
            yearsRequired: z.string().describe('Years of experience mentioned (e.g., "5+ years", "3-5 years"). If not mentioned, say "Not specified".'),
            managerType: z.string().describe('"IC" or "People Manager"'),
            function: z.string().describe('Plain English: what kind of work? E.g., "Engineering - shipping software with devs", "Operations - internal processes", "Product - building features"'),
            uniqueRequirements: z.array(z.string()).describe('What makes THIS role different. Include: specific domain/industry, specific products, specific tools/skills, company-specific processes, hardware vs software, target audience. Plain English + (original term). Max 8.')
        });

        const schemaToBeProcessed = zodToJsonSchema(zodSchema);
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
                responseJsonSchema: schemaToBeProcessed,
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

        const years = data.yearsRequired || 'Not specified';
        const managerType = data.managerType || '';
        const func = data.function || '';

        // Handle uniqueRequirements - could be strings or objects
        let uniqueReqs = [];
        if (Array.isArray(data.uniqueRequirements)) {
            uniqueReqs = data.uniqueRequirements.map(req => {
                if (typeof req === 'string') return req;
                if (typeof req === 'object' && req !== null) {
                    return req.requirement || req.text || req.value || req.name || JSON.stringify(req);
                }
                return String(req);
            });
        }

        let formattedHtml = `
            <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
                <p style="margin: 0 0 5px 0; font-size: 16px; font-weight: 600; color: #333;">${years}${managerType ? ` · ${managerType}` : ''}</p>
                ${func ? `<p style="margin: 0 0 15px 0; font-size: 14px; color: #666;">${func}</p>` : ''}
        `;

        if (uniqueReqs.length === 0) {
            formattedHtml += `<p style="color: #888; font-style: italic;">Standard PM role - nothing unusual</p>`;
        } else {
            formattedHtml += `<ul style="margin: 0; padding-left: 20px; line-height: 2;">`;
            for (const req of uniqueReqs) {
                formattedHtml += `<li style="font-size: 15px; color: #333;">${req}</li>`;
            }
            formattedHtml += `</ul>`;
        }

        formattedHtml += `</div>`;

        chrome.tabs.sendMessage(tabId, { type: 'summaryResult', data: formattedHtml });

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

        // Define the schema for structured output
        const zodSchema = z.object({
            fitScore: z.number().min(1).max(5).describe('Fit score from 1 to 5 (1=Poor Fit, 5=Excellent Fit)'),
            reasoning: z.string().describe('Brief explanation for the score in one paragraph'),
            strengths: z.array(z.string()).describe('2-3 key strengths from the resume that align with the job'),
            gaps: z.array(z.string()).describe('1-2 key gaps or areas where the resume is weaker for this role')
        });

        const schemaToBeProcessed = zodToJsonSchema(zodSchema);
        schemaToBeProcessed['propertyOrdering'] = [
            'fitScore',
            'reasoning', 
            'strengths',
            'gaps'
        ];

        const prompt = `
            You are an expert career coach. Analyze the following resume against the provided job description HTML.
            Provide a clear, concise analysis.

            **My Resume:**
            ${resume}

            ---

            **Job Description HTML:**
            ${jobHtml}

            ---

            Please provide:
            1. A fit score from 1 to 5 (1=Poor Fit, 5=Excellent Fit)
            2. Brief reasoning for your score in one paragraph
            3. 2-3 key strengths from the resume that align with the job
            4. 1-2 key gaps or areas where the resume is weaker for this role
        `;

        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: prompt,
            config: {
                responseMimeType: 'application/json',
                responseJsonSchema: schemaToBeProcessed,
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
        
        // Validate and provide defaults for missing data
        const fitScore = (typeof analysisData.fitScore === 'number' && analysisData.fitScore >= 1 && analysisData.fitScore <= 5) 
            ? analysisData.fitScore : 3;
        const reasoning = (typeof analysisData.reasoning === 'string' && analysisData.reasoning.length > 0) 
            ? analysisData.reasoning : 'Unable to generate detailed reasoning for this job analysis.';
        const strengths = Array.isArray(analysisData.strengths) && analysisData.strengths.length > 0 
            ? analysisData.strengths : ['Skills analysis available', 'Experience review completed'];
        const gaps = Array.isArray(analysisData.gaps) && analysisData.gaps.length > 0 
            ? analysisData.gaps : ['Areas for improvement identified'];
        
        // Determine color based on fit score
        let scoreColor = '#f44336'; // Red for low scores
        let scoreText = 'Poor Fit';
        
        if (fitScore >= 4) {
            scoreColor = '#4caf50'; // Green for excellent fit
            scoreText = 'Excellent Fit';
        } else if (fitScore >= 3) {
            scoreColor = '#ff9800'; // Orange for good fit
            scoreText = 'Good Fit';
        } else if (fitScore >= 2) {
            scoreColor = '#ff5722'; // Red-orange for fair fit
            scoreText = 'Fair Fit';
        }
        
        // Format the response as HTML for display
        const formattedHtml = `
            <div style="background: ${scoreColor}15; border-left: 4px solid ${scoreColor}; padding: 15px; margin-bottom: 15px; border-radius: 4px;">
                <h3 style="margin: 0 0 5px 0; color: ${scoreColor};">Fit Score: ${fitScore}/5</h3>
                <p style="margin: 0; font-weight: bold; color: ${scoreColor};">${scoreText}</p>
            </div>
            <h4 style="color: #333; margin-bottom: 10px;">Reasoning</h4>
            <p style="margin-bottom: 15px; line-height: 1.5;">${reasoning}</p>
            <h4 style="color: #4caf50; margin-bottom: 10px;">✓ Strengths</h4>
            <ul style="margin-bottom: 15px;">
                ${strengths.map(strength => `<li style="margin-bottom: 5px; color: #333;">${strength}</li>`).join('')}
            </ul>
            <h4 style="color: #ff9800; margin-bottom: 10px;">⚠ Areas for Improvement</h4>
            <ul>
                ${gaps.map(gap => `<li style="margin-bottom: 5px; color: #333;">${gap}</li>`).join('')}
            </ul>
        `;

        // Send the formatted HTML back to the content script
        chrome.tabs.sendMessage(tabId, { type: 'analysisResult', data: formattedHtml });

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

Extract the following structured data:

1. yearsExperience: Total years of professional experience (e.g., "7", "5-7")
2. seniorityLevel: Current career level (Entry/Mid/Senior/Manager/Director/VP)
3. education: Educational background
   - highestDegree: Highest degree (e.g., "MBA", "BS", "MS", "PhD", "High School")
   - field: Field of study (e.g., "Computer Science", "Business Administration")
   - schools: List of schools attended
4. functions: Types of work they do (e.g., ["Product Management", "Operations", "Engineering"])
5. industries: Industries they've worked in (e.g., ["CPG", "Tech", "Automotive"])
6. hardSkills: Technical skills - tools, languages, methodologies (e.g., ["SQL", "Python", "Agile"])
7. softSkills: Leadership, communication skills (e.g., ["Cross-functional leadership", "Stakeholder management"])
8. certifications: Any certifications (e.g., ["PMP", "Six Sigma Green Belt"])
9. targetTitles: 5-10 job titles they should search for based on their experience
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
            responseJsonSchema: schemaJson,
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
            responseJsonSchema: schemaJson,
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

console.log('CareerFit: Background script loaded successfully');