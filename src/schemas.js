import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

export const CandidateProfileSchema = z.object({
    analyzedAt: z.string().describe('ISO timestamp of when profile was analyzed'),
    yearsExperience: z.string().describe('Total years of experience (e.g., "7", "5-7")'),
    seniorityLevel: z.enum(['Entry', 'Mid', 'Senior', 'Manager', 'Director', 'VP']).describe('Current career level'),
    education: z.object({
        highestDegree: z.string().describe('Highest degree earned (e.g., "MBA", "BS", "MS", "PhD", "High School")'),
        field: z.string().describe('Field of study (e.g., "Computer Science", "Business Administration")'),
        schools: z.array(z.string()).describe('Schools attended (e.g., ["Stanford University", "UC Berkeley"])'),
    }).describe('Educational background'),
    functions: z.array(z.string()).describe('Types of work (e.g., ["Product Management", "Operations"])'),
    industries: z.array(z.string()).describe('Industries worked in (e.g., ["CPG", "Tech", "Automotive"])'),
    hardSkills: z.array(z.string()).describe('Technical skills - tools, languages, methodologies (e.g., ["SQL", "Python", "Agile"])'),
    softSkills: z.array(z.string()).describe('Leadership and interpersonal skills (e.g., ["Cross-functional leadership", "Stakeholder management"])'),
    certifications: z.array(z.string()).describe('Professional certifications (e.g., ["PMP", "Six Sigma Green Belt"])'),
    targetTitles: z.array(z.string()).describe('5-10 job titles this person should search for'),
    searchQueries: z.array(z.string()).describe('3-5 Boolean search strings for job boards'),
    keywords: z.array(z.string()).describe('10-15 keywords that should appear in matching job descriptions'),
    hardFilters: z.object({
        maxYearsRequired: z.number().describe('Max years a job can require (candidate years + 2)'),
        excludeTitles: z.array(z.string()).describe('Titles too senior for this candidate'),
        excludeRequirements: z.array(z.string()).describe('Requirements candidate cannot meet (e.g., ["PhD", "CPA"])'),
    }).describe('Automatic disqualifiers for job filtering'),
});

export const FitAnalysisSchema = z.object({
    fitScore: z.number().min(1).max(5).describe('Fit score from 1-5'),
    confidence: z.enum(['High', 'Medium', 'Low']).describe('Confidence in the assessment'),
    skillsMatch: z.object({
        matched: z.array(z.string()).describe('Skills the candidate has that match the job'),
        missing: z.array(z.string()).describe('Required skills the candidate lacks'),
        bonus: z.array(z.string()).describe('Extra skills the candidate has beyond requirements'),
    }),
    experienceMatch: z.object({
        yearsMatch: z.boolean().describe('Does candidate meet years requirement'),
        seniorityMatch: z.boolean().describe('Is the seniority level appropriate'),
        functionMatch: z.boolean().describe('Does the function/department match'),
    }),
    strengths: z.array(z.string()).describe('2-3 key strengths for this role'),
    gaps: z.array(z.string()).describe('1-2 key gaps or concerns'),
    recommendation: z.enum(['Strong Apply', 'Apply', 'Consider', 'Skip']).describe('Action recommendation'),
});

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

export function getJsonSchema(zodSchema) {
    const rawSchema = zodToJsonSchema(zodSchema);
    const schema = cleanSchemaForGemini(rawSchema);
    schema['propertyOrdering'] = Object.keys(zodSchema.shape);
    return schema;
}
