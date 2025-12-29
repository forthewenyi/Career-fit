# CareerFit v2: Job Scanner

## Current Status

| Phase | Status |
|-------|--------|
| Phase 1: Resume Profile Extraction | ✅ DONE |
| Phase 2: Hard Filter Configuration | ✅ DONE |
| Phase 3: Batch Job Scanner | ✅ DONE |
| Phase 4: Quick Filter | ✅ DONE |
| Phase 5: Full AI Scoring | ✅ DONE |
| Phase 6: Apply Workflow | ✅ DONE |

**All phases complete!** The extension can:
1. Analyze resumes and extract structured candidate profiles
2. Configure hard filters (Director+, PhD, companies, etc.)
3. Scan job search pages (LinkedIn, Indeed, Interstride, Greenhouse, Lever)
4. Quick filter jobs without API calls
5. Score remaining jobs with Gemini AI and display ranked results
6. Track job history with status updates (Applied, Interview, etc.)
7. Match resume bullets to specific jobs with AI analysis

---

## Architecture

### User Flow
```
ONE TIME SETUP:
  Resume → Gemini extracts profile → Define hard filters

ON-DEMAND:
  Job search page → Click "Scan Jobs" → Quick filter → AI scoring → Ranked results
```

### Storage
- **chrome.storage.sync** (100KB): API key, resume text
- **chrome.storage.local** (5MB): candidate profile, filters, job history (500 job limit)

### Supported Sites
- LinkedIn (`/jobs/search`, `/jobs/collections`)
- Indeed (`/jobs`, `q=`)
- Interstride (`/jobs`)
- Greenhouse (job boards)
- Lever (job boards)

---

## Future Phases

### Phase 7: Resume Tailor (NOT STARTED)

**Goal:** Tell user what to UPDATE on their resume - missing keywords, bullet rewrites, skills to add.

**Schema:**
```javascript
{
  missingKeywords: ["Kubernetes", "CI/CD"],
  bulletsToAdd: [{ suggestion: "...", example: "..." }],
  bulletsToRewrite: [{ original: "...", improved: "...", reason: "..." }],
  skillsToHighlight: ["SQL", "A/B testing"],
  overallFit: "Good fit with minor adjustments needed"
}
```

### Phase 8: Interview Prep (NOT STARTED)

**Goal:** Generate study content when user marks job as "Applied".

**Flow:** Status → Applied → AI generates prep content → Store in jobHistory → Display with "View Prep" button

**Content:** Topics to study, skills gaps, company research areas, common interview questions

---

## Known Risks

1. **Site changes break selectors** - Job sites update HTML frequently
2. **Rate limiting** - Scoring many jobs may hit API limits
3. **Bot detection** - Mitigated by 4-12s delays between jobs
4. **Storage limits** - 5MB limit, ~1MB current usage with 500 jobs
