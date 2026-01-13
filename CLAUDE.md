# CareerFit AI - Browser Extension

Chrome extension that assesses job fit against user's resume using Gemini AI.

## Quick Reference

**Build & Deploy:**
```bash
npm run build                    # Build extension
rm -rf build && mkdir build && cp manifest.json options.html styles.css careerfit.png build/ && cp -r dist build/
# Load from /build folder in Chrome (NOT root - root has node_modules = 150MB)
```

**Key Files:**
- `src/background.js` - Gemini API calls, all AI logic
- `src/content.js` - LinkedIn UI injection, button handlers
- `src/schemas.js` - Zod schemas, `cleanSchemaForGemini()`, `getJsonSchema()`
- `src/firebase.js` - Cloud sync (optional)
- `src/options.js` - Settings page logic
- `PLAN.md` - Roadmap with future phases (Phase 7-9)

## Architecture

```
User clicks button → content.js sends message → background.js calls Gemini → response parsed → HTML formatted → sent back to content.js → displayed in modal
```

**Storage:**
- `chrome.storage.sync` (100KB): API key, resume text, Firebase config
- `chrome.storage.local` (5MB): candidate profile, autofill answers, job history (500 job limit), skills to learn (100 limit)

## Database Schema

**jobHistory entry:**
```javascript
{
  id: string,           // Base64 hash of title|company|url
  title: string,
  company: string,
  location: string,
  link: string,         // URL to job posting
  score: number|null,   // 1-5 fit score
  analysis: { fitScore, gaps[], disqualifiers[] },
  summary: { yearsRequired, managerType, function, uniqueRequirements[] },
  status: 'scanned'|'interested'|'applied',
  scannedAt: string,    // ISO timestamp
  appliedAt: string,    // ISO timestamp (when applied)
  interestedAt: string, // ISO timestamp (when marked interested)
  notes: string,
  source: string        // Hostname
}
```

**skillsToLearn entry:**
```javascript
{
  skill: string,
  resources: string,
  keywords: string[],   // Keywords to add to resume
  savedAt: string,      // ISO timestamp
  learned: boolean
}
```

**candidateProfile:** See `CandidateProfileSchema` in schemas.js - includes experience[], hardSkills[] with context, topAchievements[], targetTitles[], hardFilters{}

**autofillAnswers:** Work auth (authUSA, sponsorship), personal (fullName, email, phone, linkedIn), location (city, state, zipCode), diversity (gender, veteran, disability)

## Gemini Structured Output Pattern

**CRITICAL:** Use `responseSchema` (not `responseJsonSchema`) and clean schema with `cleanSchemaForGemini()`:

```javascript
import { cleanSchemaForGemini } from './schemas.js';

const zodSchema = z.object({
    field_name: z.string().describe('Description'),
    // Use snake_case for Gemini, map to camelCase in code
});

const rawSchema = zodToJsonSchema(zodSchema);
const schema = cleanSchemaForGemini(rawSchema);  // Removes additionalProperties, $schema
schema['propertyOrdering'] = ['field_name', ...];

const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: prompt,
    config: {
        responseMimeType: 'application/json',
        responseSchema: schema,  // NOT responseJsonSchema
    },
});
```

## Current Features

1. **Resume Profile Extraction** - Analyzes resume, extracts structured profile
2. **Hard Filter Configuration** - Skip Director+, PhD, excluded companies (for future use)
3. **Summarize Role** - Quick role overview (years, IC/Manager, unique requirements)
4. **Assess Fit** - Full AI analysis with fit score, gaps, disqualifiers, learning resources
5. **Apply Workflow** - Track job status (Scanned, Interested, Applied)
6. **Resume Bullet Matching** - Match resume bullets to specific jobs
7. **Application Auto-Fill** - Fill common questions on Workday, Greenhouse, Lever
8. **Skills Tracking** - Save skills to learn from gaps, mark as learned
9. **Job History** - 5-tab view: All Jobs, Interested, Applied, To Learn, Learned

## Key Functions in background.js

| Function | Purpose |
|----------|---------|
| `summarizeRole()` | Extract job basics (years, IC/Manager, function) |
| `callGemini()` | Full fit assessment with gaps and disqualifiers |
| `analyzeResume()` | Extract candidate profile from resume |
| `matchResumeBullets()` | Match resume bullets to job |
| `formatRoleHtml()` | Shared HTML formatting |

## UI Components (content.js)

- **Button Container**: Draggable, minimizable, contains Summarize/Assess/Auto-fill/History buttons
- **Modal**: Displays results with close button
- **Score Badge**: Circular badge with color (green/orange/grey) based on fitScore 1-5
- **History Modal**: 5 tabs - All Jobs, Interested, Applied, To Learn, Learned
- **Skills Tracking**: Save skills to learn from Assess gaps, mark as learned

## Design System (Option B - Green + Cream Hybrid)

**Typography:** 12px base, 11px tabs, 38px score badge

**Color Palette:**
| Color | Hex | Usage |
|-------|-----|-------|
| Dark Green | #3d8b6e | Primary actions, score 4-5 |
| Calming Green | #9DC3B5 | Learned skills border |
| Creamy White | #F5F3E7 | Tag backgrounds, buttons |
| Healing Yellow | #F0D58C | Pending skills border |
| Orange | #c9a050 | Score 3, secondary actions |
| Grey | #4a4a4a | Score 1-2, remove buttons |

**Button Styling:**
- Action buttons: `background: #F5F3E7; color: #2d6b52; border: 1px solid #e0ddd0`
- Checkmark (not learned): `background: #e8f5f1; color: #3d8b6e; border: #d0e8e0`
- Checkmark (learned): `background: #3d8b6e; color: white`
- Remove button: `background: #F5F3E7; color: #4a4a4a; border: #e0ddd0`

**Tab Styling:**
- Active: `color: #222; border-bottom: 2px solid #3d8b6e`
- Inactive: `color: #666; border-bottom: transparent`

## Caching (content.js)

Both Summarize and Assess results are cached to `jobHistory` in Chrome storage to avoid duplicate API calls:

```javascript
// Cache key generation (same for both)
const jobId = btoa(`${title}|${company}|${url}`).slice(0, 32);

// Check cache before API call
const cached = jobHistory.find(j => j.id === jobId && j.summary?.yearsRequired);  // Summarize
const cached = jobHistory.find(j => j.id === jobId && j.analysis?.fitScore);      // Assess
```

**Cache Functions:**
| Function | Purpose |
|----------|---------|
| `getCachedSummary()` | Check for existing summary in jobHistory |
| `getCachedAssessment()` | Check for existing assessment in jobHistory |
| `showCachedSummary()` | Display cached summary with "Refresh" button |
| `showCachedAssessment()` | Display cached assessment with "Refresh" button |

Cached results show a banner with date and "Refresh" button to force new API call.

## Known Issues & Fixes

1. **Gemini ignores schema** → Use `responseSchema` not `responseJsonSchema`
2. **additionalProperties error** → Use `cleanSchemaForGemini()`
3. **Extension too large (150MB)** → Load from `/build` folder, not root
4. **[object Object] in display** → Schema field names must match extraction code

## Adding New AI Features

1. Define Zod schema with snake_case fields
2. Convert with `zodToJsonSchema()` and `cleanSchemaForGemini()`
3. Add `propertyOrdering` array
4. Call `ai.models.generateContent()` with `responseSchema`
5. Parse response, map snake_case → camelCase
6. Format HTML and send to content.js

## Future Phases (see PLAN.md)

- **Phase 9**: Resume Tailor - suggest resume improvements
- **Phase 10**: Interview Prep - generate study content
