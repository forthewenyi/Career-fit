# CareerFit AI

## Current Status

**All core features complete!** The extension can:

1. Analyze resumes and extract structured candidate profiles
2. Configure hard filters (Director+, PhD, companies, etc.)
3. Summarize jobs (years, IC/Manager, unique requirements)
4. Assess job fit with AI scoring (1-5), gaps, disqualifiers
5. Track job history with status updates (Scanned, Interested, Applied)
6. Match resume bullets to specific jobs with AI analysis
7. Auto-fill common application questions on Workday, Greenhouse, Lever
8. Track skills to learn from job gaps, mark skills as learned
9. View history with 5-tab interface: All Jobs, Interested, Applied, To Learn, Learned

---

## Architecture

### User Flow
```
ONE TIME SETUP:
  Resume → Gemini extracts profile (skills, industries, certifications) → (Optional) Define hard filters

ON ANY JOB PAGE (button bar starts minimized):
  Click + to expand → Summarize | Assess | Auto-fill | History
  Click Assess → Full fit analysis with score, gaps, disqualifiers
  Click Summarize → Quick role overview
  Click Auto-fill → Fill application form fields
  Click History → View/manage job history
```

### Storage
- **chrome.storage.sync** (100KB): API key, candidate profile, Firebase config
- **chrome.storage.local** (5MB): resume text, autofill answers, job history (500 job limit), skills to learn (100 limit)

### Supported Sites
- LinkedIn Jobs
- Indeed
- Interstride
- Greenhouse job boards
- Lever job boards
- Auto-fill on Workday, Greenhouse, Lever

### UI Preview
Open `output-preview.html` in browser to see all UI components and states.

---

## Future Phases

### Phase 9: Resume Tailor (NOT STARTED)

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

### Phase 10: Interview Prep (NOT STARTED)

**Goal:** Generate study content when user marks job as "Applied".

**Flow:** Status → Applied → AI generates prep content → Store in jobHistory → Display with "View Prep" button

**Content:** Topics to study, skills gaps, company research areas, common interview questions

---

## Known Risks

1. **Site changes break selectors** - Job sites update HTML frequently
2. **Rate limiting** - Many API calls may hit limits
3. **Storage limits** - 5MB limit, ~1MB current usage with 500 jobs
