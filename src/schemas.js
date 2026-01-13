import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

// Rich skill with context for better matching
const RichSkillSchema = z.object({
    skill: z.string().describe('The skill name (e.g., "SQL", "Product Management")'),
    context: z.string().describe('How they used it with scale/impact (e.g., "Built data pipelines serving 10M users")'),
    years: z.number().describe('Years of experience with this skill'),
});

// Work experience entry with highlights
const ExperienceEntrySchema = z.object({
    title: z.string().describe('Job title'),
    company: z.string().describe('Company name'),
    years: z.number().describe('Years in this role'),
    highlights: z.array(z.string()).describe('2-3 key achievements with metrics (e.g., "Led team of 8", "Reduced costs 40%")'),
});

export const CandidateProfileSchema = z.object({
    analyzedAt: z.string().describe('ISO timestamp of when profile was analyzed'),
    yearsExperience: z.string().describe('Total years of experience (e.g., "7", "5-7")'),
    seniorityLevel: z.enum(['Entry', 'Mid', 'Senior', 'Manager', 'Director', 'VP']).describe('Current career level'),
    education: z.object({
        highestDegree: z.string().describe('Highest degree earned (e.g., "MBA", "BS", "MS", "PhD", "High School")'),
        field: z.string().describe('Field of study (e.g., "Computer Science", "Business Administration")'),
        schools: z.array(z.string()).describe('Schools attended (e.g., ["Stanford University", "UC Berkeley"])'),
    }).describe('Educational background'),
    // Enhanced: Work history with context
    experience: z.array(ExperienceEntrySchema).describe('Work history with highlights, most recent first (max 4 roles)'),
    functions: z.array(z.string()).describe('Types of work (e.g., ["Product Management", "Operations"])'),
    industries: z.array(z.string()).describe('Industries worked in (e.g., ["CPG", "Tech", "Automotive"])'),
    // Enhanced: Skills with context
    hardSkills: z.array(RichSkillSchema).describe('Technical skills with context and years'),
    softSkills: z.array(z.string()).describe('Leadership and interpersonal skills (e.g., ["Cross-functional leadership", "Stakeholder management"])'),
    certifications: z.array(z.string()).describe('Professional certifications (e.g., ["PMP", "Six Sigma Green Belt"])'),
    // Key achievements for matching
    topAchievements: z.array(z.string()).describe('3-5 most impressive resume bullets with metrics'),
    targetTitles: z.array(z.string()).describe('5-10 job titles this person should search for'),
    searchQueries: z.array(z.string()).describe('3-5 Boolean search strings for job boards'),
    keywords: z.array(z.string()).describe('10-15 keywords that should appear in matching job descriptions'),
    hardFilters: z.object({
        maxYearsRequired: z.number().describe('Max years a job can require (candidate years + 2)'),
        excludeTitles: z.array(z.string()).describe('Titles too senior for this candidate'),
        excludeRequirements: z.array(z.string()).describe('Requirements candidate cannot meet (e.g., ["PhD", "CPA"])'),
    }).describe('Automatic disqualifiers for job filtering'),
});

// Helper to clean JSON Schema for Gemini (removes unsupported fields)
export function cleanSchemaForGemini(schema) {
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
