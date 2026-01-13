import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

// Simple skill with years
const SkillSchema = z.object({
    skill: z.string().describe('The skill name (e.g., "SQL", "Product Management")'),
    years: z.number().describe('Years of experience with this skill'),
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
    functions: z.array(z.string()).describe('Types of work (e.g., ["Product Management", "Operations"])'),
    industries: z.array(z.string()).describe('Industries worked in (e.g., ["CPG", "Tech", "Automotive"])'),
    // Technical skills with years - detailed for accurate job matching
    hardSkills: z.array(SkillSchema).describe('ALL technical skills found in resume with years. Include every skill mentioned.'),
    softSkills: z.array(z.string()).describe('Leadership and interpersonal skills (e.g., ["Cross-functional leadership", "Stakeholder management"])'),
    certifications: z.array(z.string()).describe('ALL professional certifications found in resume (e.g., ["PMP", "Six Sigma", "ITIL", "Google Analytics"])'),
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
