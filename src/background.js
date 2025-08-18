import { GoogleGenAI } from '@google/genai';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

console.log('CareerFit: Background script loading...');

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'analyzeJobHtml') {
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
            callGemini(message.html, data.userResume, data.geminiApiKey, sender.tab.id);
        });
    }
});

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

console.log('CareerFit: Background script loaded successfully');