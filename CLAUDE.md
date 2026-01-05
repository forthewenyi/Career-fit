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
- `chrome.storage.local` (5MB): candidate profile, filters, job history (500 job limit)

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

## Current Features (Phases 1-6 Complete)

1. **Resume Profile Extraction** - Analyzes resume, extracts structured profile
2. **Hard Filter Configuration** - Skip Director+, PhD, excluded companies
3. **Batch Job Scanner** - Scan LinkedIn/Indeed/Interstride/Greenhouse/Lever
4. **Quick Filter** - Pre-screen without API calls
5. **Full AI Scoring** - Score with Gemini, display ranked results
6. **Apply Workflow** - Track status (Applied, Interview, etc.)

## Key Functions in background.js

| Function | Purpose |
|----------|---------|
| `summarizeRole()` | Extract job basics (years, IC/Manager, function) |
| `callGemini()` | Full fit assessment with gaps |
| `analyzeResume()` | Extract candidate profile from resume |
| `scoreJob()` | Quick score for batch scanning |
| `matchResumeBullets()` | Match resume bullets to job |
| `formatRoleHtml()` | Shared HTML formatting |

## UI Components (content.js)

- **Button Container**: Draggable, minimizable, contains Summarize/Assess/History/Scan buttons
- **Modal**: Displays results with close button
- **Score Badge**: Circular badge with color (green/orange/red) based on fitScore 1-5

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

- **Phase 7**: Smarter Fit Scoring - distinguish minimum vs preferred qualifications
- **Phase 8**: Resume Tailor - suggest resume improvements
- **Phase 9**: Interview Prep - generate study content
