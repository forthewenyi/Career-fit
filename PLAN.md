# CareerFit v2: Job Scanner Implementation Plan

## Current Status (Updated Dec 29, 2024)

| Phase | Status |
|-------|--------|
| Phase 1: Resume Profile Extraction | ✅ DONE |
| Phase 2: Hard Filter Configuration | ✅ DONE |
| Phase 3: Batch Job Scanner | ✅ DONE |
| Phase 4: Quick Filter | ✅ DONE |
| Phase 5: Full AI Scoring | ✅ DONE |
| Phase 6: Apply Workflow | ✅ DONE |

### Recent Updates (Dec 29, 2024)
- **Search Queries**: Added copy buttons next to each search query for easy copying to job boards
- **Target Titles**: Now generates 8-12 titles including both current level AND entry-level/junior roles
- **Interstride Selectors**: Updated with more specific selectors for job detail pages

**All phases complete!** The extension can now:
1. Analyze resumes and extract structured candidate profiles
2. Configure hard filters (Director+, PhD, companies, etc.)
3. Scan job search pages (LinkedIn, Indeed, Interstride, Greenhouse, Lever)
4. Quick filter jobs without API calls
5. Score remaining jobs with Gemini AI and display ranked results
6. Track job history with status updates (Applied, Interview, etc.)
7. Match resume bullets to specific jobs with AI analysis

---

## Overview

Transform CareerFit from a single-job analyzer into a batch job scanner that finds roles matching your profile.

```
┌─────────────────────────────────────────────────────────────┐
│                     ONE TIME SETUP                          │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Your Master Resume                                         │
│         ↓                                                   │
│  Gemini extracts structured profile:                        │
│    • 7 years experience                                     │
│    • Functions: Product, Ops, Engineering                   │
│    • Skills: SQL, Python, Leadership, Process               │
│    • Seniority: Senior/Manager level                        │
│    • Industries: CPG, Auto, Tech                            │
│         ↓                                                   │
│  Define hard filters:                                       │
│    • SKIP if requires 10+ years                             │
│    • SKIP if requires PhD                                   │
│    • SKIP if Director+ level                                │
│    • SKIP if specific cert required (CPA, etc)              │
│                                                             │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│                   ON-DEMAND WORKFLOW                        │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  User navigates to job search results page                  │
│         ↓                                                   │
│  Clicks "Scan Jobs" button                                  │
│         ↓                                                   │
│  Quick filter: Apply hard filters (minimal API calls)       │
│         ↓                                                   │
│  Remaining ~15-20 jobs: Full score with Gemini              │
│         ↓                                                   │
│  Filter to 4+ fit                                           │
│         ↓                                                   │
│  Output: Ranked list of matching jobs                       │
│    • Job title, company, link                               │
│    • Fit score + why                                        │
│    • Posted X hours ago                                     │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## Storage Strategy

**chrome.storage.sync** (syncs across devices, 100KB limit):
- `geminiApiKey` - API key
- `userResume` - Resume text

**chrome.storage.local** (local only, 5MB limit):
- `candidateProfile` - Extracted structured profile
- `hardFilters` - User's filter preferences
- `referralList` - Company/contact pairs
- `analyzedJobs` - Job history and scores
- `scanHistory` - Past scan results

---

## File Structure (Target)

```
career-fit/
├── manifest.json              # Update: add dashboard page
├── src/
│   ├── background.js          # Add: analyzeResume(), compareProfiles()
│   ├── content.js             # Add: extractJobListings(), quickFilter()
│   ├── options.js             # Add: Analyze Resume button, profile display
│   ├── dashboard.js           # NEW: Job dashboard logic
│   └── schemas.js             # NEW: Shared Zod schemas
├── pages/
│   └── dashboard.html         # NEW: Job results dashboard
├── styles.css                 # Add: scan button, results panel
├── dist/                      # Webpack output
├── webpack.config.js          # Update: add dashboard entry
└── package.json
```

---

## Phase 1: Resume Profile Extraction

**Goal:** Convert user's resume into structured, searchable data

### New File: src/schemas.js

```javascript
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

export const CandidateProfileSchema = z.object({
  analyzedAt: z.string(),
  yearsExperience: z.string(),
  seniorityLevel: z.enum(['Entry', 'Mid', 'Senior', 'Manager', 'Director', 'VP']),
  functions: z.array(z.string()),
  industries: z.array(z.string()),
  hardSkills: z.array(z.string()),
  softSkills: z.array(z.string()),
  certifications: z.array(z.string()),
  targetTitles: z.array(z.string()),
  searchQueries: z.array(z.string()),
  keywords: z.array(z.string()),
  hardFilters: z.object({
    maxYearsRequired: z.number(),
    excludeTitles: z.array(z.string()),
    excludeRequirements: z.array(z.string()),
  }),
});

export const FitAnalysisSchema = z.object({
  fitScore: z.number().min(1).max(5),
  confidence: z.enum(['High', 'Medium', 'Low']),
  skillsMatch: z.object({
    matched: z.array(z.string()),
    missing: z.array(z.string()),
    bonus: z.array(z.string()),
  }),
  experienceMatch: z.object({
    yearsMatch: z.boolean(),
    seniorityMatch: z.boolean(),
    functionMatch: z.boolean(),
  }),
  strengths: z.array(z.string()),
  gaps: z.array(z.string()),
  recommendation: z.enum(['Strong Apply', 'Apply', 'Consider', 'Skip']),
});

export function getJsonSchema(zodSchema) {
  const schema = zodToJsonSchema(zodSchema);
  schema['propertyOrdering'] = Object.keys(zodSchema.shape);
  return schema;
}
```

### Add to src/background.js

```javascript
import { CandidateProfileSchema, FitAnalysisSchema, getJsonSchema } from './schemas.js';

async function analyzeResume(resumeText, apiKey) {
  const ai = new GoogleGenAI({ apiKey });

  const prompt = `You are a career coach analyzing a resume.

RESUME:
${resumeText}

Extract structured data:
1. yearsExperience: Total years (e.g., "7", "5-7")
2. seniorityLevel: Entry/Mid/Senior/Manager/Director/VP
3. functions: Types of work (e.g., ["Product Management", "Operations"])
4. industries: Industries worked in (e.g., ["CPG", "Tech"])
5. hardSkills: Technical skills (e.g., ["SQL", "Python"])
6. softSkills: Leadership skills (e.g., ["Cross-functional leadership"])
7. certifications: Any certifications (e.g., ["PMP"])
8. targetTitles: 5-10 job titles to search for
9. searchQueries: 3-5 Boolean search strings
10. keywords: 10-15 keywords for matching jobs
11. hardFilters:
    - maxYearsRequired: Max years job can require (their years + 2)
    - excludeTitles: Too senior titles (e.g., ["VP", "Director"])
    - excludeRequirements: Can't meet (e.g., ["PhD", "CPA"])`;

  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: prompt,
    config: {
      responseMimeType: 'application/json',
      responseJsonSchema: getJsonSchema(CandidateProfileSchema),
    },
  });

  const profile = JSON.parse(response.text);
  profile.analyzedAt = new Date().toISOString();

  await chrome.storage.local.set({ candidateProfile: profile });
  return profile;
}

// Update message listener - use sendResponse for options page
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'analyzeResume') {
    chrome.storage.sync.get(['geminiApiKey', 'userResume'], async (data) => {
      if (!data.geminiApiKey || !data.userResume) {
        sendResponse({ success: false, error: 'API Key or Resume not found.' });
        return;
      }
      try {
        const profile = await analyzeResume(data.userResume, data.geminiApiKey);
        sendResponse({ success: true, data: profile });
      } catch (error) {
        sendResponse({ success: false, error: error.message });
      }
    });
    return true; // Keep channel open for async response
  }

  // ... existing handlers for summarizeRole, analyzeJobHtml ...
});
```

### Add to options.html

```html
<!-- After resume textarea -->
<button id="analyzeResumeBtn">Analyze My Resume</button>
<div id="analysisStatus"></div>

<div id="profileDisplay" style="display:none; margin-top: 20px; padding: 15px; background: #f5f5f5; border-radius: 8px;">
  <h3>Your Candidate Profile</h3>
  <p><strong>Experience:</strong> <span id="profileYears"></span> years (<span id="profileLevel"></span>)</p>
  <p><strong>Functions:</strong> <span id="profileFunctions"></span></p>
  <p><strong>Target Titles:</strong></p>
  <ul id="profileTitles"></ul>
  <p><strong>Search Queries:</strong></p>
  <ul id="profileQueries"></ul>
</div>
```

### Add to src/options.js

```javascript
// Use sendResponse pattern (NOT onMessage listener)
document.getElementById('analyzeResumeBtn').addEventListener('click', () => {
  document.getElementById('analysisStatus').textContent = 'Analyzing resume...';

  chrome.runtime.sendMessage({ type: 'analyzeResume' }, (response) => {
    if (response.success) {
      displayProfile(response.data);
      document.getElementById('analysisStatus').textContent = 'Analysis complete!';
    } else {
      document.getElementById('analysisStatus').textContent = 'Error: ' + response.error;
    }
  });
});

function displayProfile(profile) {
  document.getElementById('profileDisplay').style.display = 'block';
  document.getElementById('profileYears').textContent = profile.yearsExperience;
  document.getElementById('profileLevel').textContent = profile.seniorityLevel;
  document.getElementById('profileFunctions').textContent = profile.functions.join(', ');
  document.getElementById('profileTitles').innerHTML =
    profile.targetTitles.map(t => `<li>${t}</li>`).join('');
  document.getElementById('profileQueries').innerHTML =
    profile.searchQueries.map(q => `<li><code>${q}</code></li>`).join('');
}

// Load existing profile on page load
chrome.storage.local.get(['candidateProfile'], (data) => {
  if (data.candidateProfile) displayProfile(data.candidateProfile);
});
```

### Phase 1 Acceptance Criteria
- [x] "Analyze Resume" button in options page
- [x] Clicking sends resume to Gemini via background.js
- [x] Response comes back via sendResponse (not onMessage)
- [x] Structured profile saved to chrome.storage.local
- [x] Profile displayed with target titles and search queries
- [x] Profile persists and loads on page refresh
- [x] Education extraction added (highestDegree, field, schools)

---

## Phase 2: Hard Filter Configuration UI

**Goal:** Let user set automatic skip rules

### Add to options.html

```html
<h3>Hard Filters</h3>
<p>Auto-skip jobs that match these criteria:</p>

<label>
  <input type="checkbox" id="filterYears" checked>
  Requires more than <input type="number" id="maxYears" value="10" style="width:50px"> years
</label><br>

<label>
  <input type="checkbox" id="filterPhD" checked>
  Requires PhD
</label><br>

<label>
  <input type="checkbox" id="filterDirector" checked>
  Director level or above
</label><br>

<label>
  Skip certifications I don't have:<br>
  <input type="text" id="skipCerts" placeholder="CPA, CFA, PE">
</label><br>

<label>
  Exclude companies:<br>
  <input type="text" id="excludeCompanies" placeholder="Company1, Company2">
</label>

<button id="saveFiltersBtn">Save Filters</button>
```

### Add to src/options.js

```javascript
document.getElementById('saveFiltersBtn').addEventListener('click', () => {
  const hardFilters = {
    maxYearsRequired: document.getElementById('filterYears').checked
      ? parseInt(document.getElementById('maxYears').value) : 99,
    skipPhD: document.getElementById('filterPhD').checked,
    skipDirectorPlus: document.getElementById('filterDirector').checked,
    skipCertifications: document.getElementById('skipCerts').value
      .split(',').map(s => s.trim()).filter(Boolean),
    excludeCompanies: document.getElementById('excludeCompanies').value
      .split(',').map(s => s.trim()).filter(Boolean),
  };

  chrome.storage.local.set({ hardFilters }, () => {
    alert('Filters saved!');
  });
});

// Load filters on page load
chrome.storage.local.get(['hardFilters'], (data) => {
  if (data.hardFilters) {
    const f = data.hardFilters;
    document.getElementById('maxYears').value = f.maxYearsRequired || 10;
    document.getElementById('filterPhD').checked = f.skipPhD !== false;
    document.getElementById('filterDirector').checked = f.skipDirectorPlus !== false;
    document.getElementById('skipCerts').value = (f.skipCertifications || []).join(', ');
    document.getElementById('excludeCompanies').value = (f.excludeCompanies || []).join(', ');
  }
});
```

### Phase 2 Acceptance Criteria
- [x] Filter UI displays in options page
- [x] Filters save to chrome.storage.local
- [x] Filters load on page refresh
- [x] Values accessible from content.js for quick filtering

---

## Phase 3: Batch Job Scanner

**Goal:** Extract job listings from search results pages

**STATUS: IMPLEMENTED** - Site configs added for LinkedIn, Indeed, Interstride (generic selectors), Greenhouse, and Lever.

### Site Configuration (content.js)

```javascript
const SITE_CONFIGS = {
  'indeed.com': {
    isSearchPage: (url) => url.includes('/jobs') || url.includes('q='),
    jobCards: '.jobsearch-ResultsList > li, .job_seen_beacon',
    title: '.jobTitle, [data-testid="jobTitle"]',
    company: '.companyName, [data-testid="company-name"]',
    location: '.companyLocation',
    posted: '.date',
    link: 'a[data-jk], .jobTitle a',
  },
  'student.interstride.com': {
    isSearchPage: (url) => url.includes('/jobs') && !url.match(/\/jobs\/\d+/),
    // TODO: Replace with actual selectors after DOM inspection
    jobCards: '[class*="job-card"], [class*="JobCard"], .job-listing',
    title: '[class*="title"], h3, h4',
    company: '[class*="company"], [class*="employer"]',
    location: '[class*="location"]',
    posted: '[class*="date"], [class*="posted"]',
    link: 'a',
  },
  'linkedin.com': {
    isSearchPage: (url) => url.includes('/jobs/search'),
    jobCards: '.jobs-search-results__list-item',
    title: '.job-card-list__title',
    company: '.job-card-container__company-name',
    location: '.job-card-container__metadata-item',
    posted: 'time',
    link: 'a.job-card-container__link',
  }
};

function getSiteConfig() {
  const host = window.location.hostname;
  for (const [domain, config] of Object.entries(SITE_CONFIGS)) {
    if (host.includes(domain)) return { domain, ...config };
  }
  return null;
}

function isOnSearchResultsPage() {
  const config = getSiteConfig();
  if (!config) return false;
  return config.isSearchPage(window.location.href);
}

function extractJobListings() {
  const config = getSiteConfig();
  if (!config) return [];

  const jobs = [];
  const cards = document.querySelectorAll(config.jobCards);

  cards.forEach((card, index) => {
    const title = card.querySelector(config.title)?.textContent?.trim();
    const company = card.querySelector(config.company)?.textContent?.trim();
    const location = card.querySelector(config.location)?.textContent?.trim();
    const posted = card.querySelector(config.posted)?.textContent?.trim();
    const linkEl = card.querySelector(config.link);
    const link = linkEl?.href || window.location.href;

    if (title) {
      jobs.push({
        index,
        title,
        company: company || 'Unknown',
        location: location || '',
        posted: posted || '',
        link,
        element: card // For highlighting later
      });
    }
  });

  console.log('CareerFit: Extracted', jobs.length, 'jobs');
  return jobs;
}
```

### Add Scan Button (content.js)

```javascript
// Only show scan button on search results pages
if (isOnSearchResultsPage()) {
  const scanBtn = document.createElement('button');
  scanBtn.id = 'scan-jobs-btn';
  scanBtn.textContent = 'Scan Jobs';
  buttonContainer.appendChild(scanBtn);

  scanBtn.addEventListener('click', handleScanJobs);
}

async function handleScanJobs() {
  const jobs = extractJobListings();

  if (jobs.length === 0) {
    showError('No job listings found on this page.');
    return;
  }

  showLoading(`Found ${jobs.length} jobs. Analyzing...`);

  // Get profile and filters
  const { candidateProfile, hardFilters } =
    await chrome.storage.local.get(['candidateProfile', 'hardFilters']);

  if (!candidateProfile) {
    showError('Please analyze your resume first in extension options.');
    return;
  }

  // Quick filter (no API call)
  const filtered = jobs.map(job => ({
    ...job,
    quickResult: quickFilter(job, candidateProfile, hardFilters)
  }));

  const passed = filtered.filter(j => j.quickResult.pass);
  const skipped = filtered.filter(j => !j.quickResult.pass);

  // Highlight on page
  skipped.forEach(j => {
    if (j.element) j.element.style.opacity = '0.3';
  });
  passed.forEach(j => {
    if (j.element) j.element.style.borderLeft = '4px solid #4caf50';
  });

  // Show summary in modal
  const modalContent = document.getElementById('assess-modal-content');
  modalContent.innerHTML = `
    <h4>Quick Scan Complete</h4>
    <p><strong>${passed.length}</strong> potential matches</p>
    <p><strong>${skipped.length}</strong> filtered out</p>
    <hr>
    <p>Matches:</p>
    <ul>
      ${passed.slice(0, 10).map(j => `<li>${j.title} - ${j.company}</li>`).join('')}
    </ul>
    ${passed.length > 10 ? `<p>...and ${passed.length - 10} more</p>` : ''}
  `;
  modal.style.display = 'block';
}
```

### Anti-bot Measures

```javascript
const DELAYS = {
  betweenJobs: () => 4000 + Math.random() * 8000,  // 4-12 seconds
  maxJobsPerScan: 20,
  scrollPause: () => 500 + Math.random() * 1000
};

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
```

### Phase 3 Acceptance Criteria
- [x] "Scan Jobs" button appears only on search results pages
- [x] extractJobListings() works on Indeed
- [x] extractJobListings() uses generic selectors for Interstride (may need tuning)
- [x] Jobs are highlighted on page (green = match, faded = skipped)
- [x] Summary shows in modal
- [x] Site configs added for LinkedIn, Greenhouse, Lever

---

## Phase 4: Quick Filter (Pre-screening)

**Goal:** Fast, cheap filtering before full AI scoring

### Add to src/content.js

```javascript
function quickFilter(job, candidateProfile, hardFilters) {
  const titleLower = job.title.toLowerCase();
  const companyLower = (job.company || '').toLowerCase();

  // Check excluded companies
  if (hardFilters?.excludeCompanies?.length) {
    const excluded = hardFilters.excludeCompanies.some(c =>
      companyLower.includes(c.toLowerCase())
    );
    if (excluded) return { pass: false, reason: 'Excluded company' };
  }

  // Check excluded titles (Director, VP, etc.)
  if (hardFilters?.skipDirectorPlus) {
    const seniorTitles = ['director', 'vp', 'vice president', 'head of', 'chief'];
    const isTooSenior = seniorTitles.some(t => titleLower.includes(t));
    if (isTooSenior) return { pass: false, reason: 'Too senior' };
  }

  // Check if title matches target titles
  if (candidateProfile?.targetTitles?.length) {
    const titleMatch = candidateProfile.targetTitles.some(t =>
      titleLower.includes(t.toLowerCase())
    );
    if (!titleMatch) return { pass: false, reason: 'Title mismatch' };
  }

  return { pass: true, reason: 'Passed quick filter' };
}
```

### Phase 4 Acceptance Criteria
- [x] Quick filter runs without API call
- [x] Filters out excluded companies
- [x] Filters out too-senior titles (Director, VP, Chief, etc.)
- [x] Filters out non-matching titles
- [x] Returns reason for each decision
- [x] Filters out PhD requirements in title

---

## Phase 5: Full Scoring & Results Display

**Goal:** Score remaining jobs with Gemini, show ranked results

### Scoring Flow

```
Jobs from page (e.g., 25)
    ↓
Quick filter → Remove ~10
    ↓
Remaining ~15 → For each, fetch full description → Score with Gemini
    ↓
Filter to 4+ fit → ~8 jobs
    ↓
Display ranked in modal
```

### Add to src/background.js

```javascript
async function scoreJob(jobText, candidateProfile, apiKey) {
  const ai = new GoogleGenAI({ apiKey });

  const prompt = `Compare this candidate to this job.

CANDIDATE:
${JSON.stringify(candidateProfile, null, 2)}

JOB:
${jobText}

Score 1-5:
- 5: Excellent - meets all requirements
- 4: Good - meets most, minor gaps
- 3: Possible - some gaps but transferable
- 2: Stretch - significant gaps
- 1: Poor - major mismatches

Be honest. Candidate wants accurate assessments.`;

  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: prompt,
    config: {
      responseMimeType: 'application/json',
      responseJsonSchema: getJsonSchema(FitAnalysisSchema),
    },
  });

  return JSON.parse(response.text);
}
```

### Results Display (in modal)

```javascript
function displayScanResults(results) {
  const highFit = results.filter(r => r.score >= 4);
  const modalContent = document.getElementById('assess-modal-content');

  modalContent.innerHTML = `
    <h4>Scan Results</h4>
    <p>Found <strong>${highFit.length}</strong> jobs with 4+ fit score</p>
    <div style="max-height: 400px; overflow-y: auto;">
      ${highFit.map(job => `
        <div style="padding: 10px; margin: 8px 0; background: #f5f5f5; border-radius: 8px; border-left: 4px solid ${job.score >= 4 ? '#4caf50' : '#ff9800'};">
          <strong>${job.score}/5</strong> - ${job.title}<br>
          <span style="color: #666;">${job.company}</span><br>
          <small>${job.recommendation}</small><br>
          <a href="${job.link}" target="_blank">View Job</a>
        </div>
      `).join('')}
    </div>
  `;
}
```

### Phase 5 Acceptance Criteria
- [x] Full scoring uses candidateProfile for comparison
- [x] Results ranked by score
- [x] High-fit jobs (4+) prominently displayed
- [x] Each result shows score, title, company, recommendation
- [x] "View Job" link works
- [x] Progress bar during scoring
- [x] Anti-bot delays (4-12s between jobs)
- [x] Max 20 jobs per scan limit

---

## Phase 6: Apply Workflow

**Goal:** Help with actual applications

**STATUS: IMPLEMENTED**

### Features Implemented:
- [x] Job history storage (saves all scanned jobs to chrome.storage.local)
- [x] Status tracking (scanned → interested → applied → interview → rejected)
- [x] "History" button in UI to view all past jobs
- [x] Filter history by status (All, Applied, Interested)
- [x] "Match Resume" button for each job - AI analyzes which resume bullets match
- [x] Resume bullet matching with strength ratings (strong/moderate)
- [x] Application suggestions from AI
- [x] "Clear History" option
- [x] Auto-save results after scanning (high-fit jobs marked as "interested")

### Phase 6 Acceptance Criteria
- [x] Jobs saved to history after scanning
- [x] Status can be changed via dropdown
- [x] History persists across sessions
- [x] Resume bullet matching works via background.js
- [x] Strong/moderate match categorization
- [x] Suggestions for strengthening application

---

## Required Config Changes

### manifest.json additions

```json
{
  "action": {
    "default_popup": "pages/dashboard.html"
  }
}
```

Or for a separate dashboard page:
```json
{
  "chrome_url_overrides": {
    "newtab": "pages/dashboard.html"
  }
}
```

### webpack.config.js update

```javascript
export default {
  entry: {
    background: './src/background.js',
    content: './src/content.js',
    options: './src/options.js',
    dashboard: './src/dashboard.js',  // ADD THIS
  },
  // ... rest unchanged
};
```

### styles.css additions

```css
#scan-jobs-btn {
  background-color: #4caf50;
  color: white;
  border: none;
  padding: 10px 16px;
  border-radius: 20px;
  cursor: pointer;
  box-shadow: 0 4px 12px rgba(76,175,80,0.3);
  font-size: 13px;
  font-weight: 600;
  transition: all 0.2s ease;
}

#scan-jobs-btn:hover {
  background-color: #43a047;
  transform: translateY(-1px);
}
```

---

## Implementation Order

| Order | Phase | Effort | Status | Dependencies |
|-------|-------|--------|--------|--------------|
| 1 | Phase 1: Profile extraction | 2-3 hrs | **DONE** | None |
| 2 | Phase 2: Hard filters UI | 1-2 hrs | **DONE** | Phase 1 |
| 3 | Phase 3: Job scanner | 2-3 hrs | **DONE** | None |
| 4 | Phase 4: Quick filter | 1 hr | **DONE** | Phase 3 |
| 5 | Phase 5: Full scoring | 2-3 hrs | **DONE** | Phase 4 |
| 6 | Phase 6: Apply workflow | 3+ hrs | **DONE** | Phase 5 |

**All phases completed!** CareerFit v2 is feature-complete.

---

## Future Improvements

### Search Queries Feature

**Current Implementation:**
The "Search Queries" section in the Options page displays AI-generated Boolean search strings based on the user's resume. These are optimized queries for job boards like:
- `"Technical Program Manager" AND (Agile OR SAFe) AND automotive`
- `"Product Manager" AND SQL AND "cross-functional"`

**Current Workflow:**
1. User analyzes their resume in Options page
2. Gemini generates 3-5 optimized search queries
3. Each query has a "Copy" button
4. User manually goes to job board → pastes query into search box

**Why It's in Options (not content script):**
- Search queries are generated once during resume analysis
- They're meant for use across multiple job sites
- Options page is where users configure their profile

**Potential Future Improvements:**
| Option | Description | Pros | Cons |
|--------|-------------|------|------|
| Keep as-is | Manual copy workflow | Simple, works anywhere | Extra steps for user |
| Auto-fill search | Inject queries into job board search boxes | Seamless UX | Site-specific, may break |
| Toolbar popup | Show queries in extension popup | Quick access | Adds UI complexity |
| Remove feature | Rely on target titles instead | Cleaner UI | Loses search optimization |

### Interstride support:
If Interstride job extraction isn't working:
1. Go to https://student.interstride.com/jobs
2. Right-click a job card → Inspect
3. Share the HTML structure or class names
4. Update SITE_CONFIGS with more specific selectors

---

## Phase 7: Resume Tailor (Future)

**Goal:** Instead of just matching resume bullets to jobs, tell user what to UPDATE on their resume - missing keywords, bullet points to add/rewrite, skills gaps to address.

### Current "Match Resume" Behavior:
- Shows which existing resume bullets match the job
- Rates match strength (strong/moderate)
- Provides general suggestions

### Proposed New Behavior:
```
User clicks "Tailor Resume" for a job
        ↓
AI analyzes job requirements vs resume
        ↓
Returns actionable feedback:
  - Keywords missing from resume (add these!)
  - Bullet points to rewrite with specific suggestions
  - Skills to highlight or add
  - Accomplishments to quantify
        ↓
Display with "Copy" buttons for each suggestion
```

### Schema Design:
```javascript
resumeTailorSchema = {
  missingKeywords: ["Kubernetes", "CI/CD", "stakeholder management"],
  bulletsToAdd: [
    {
      suggestion: "Add a bullet about cross-functional leadership",
      example: "Led cross-functional team of 8 engineers and designers..."
    }
  ],
  bulletsToRewrite: [
    {
      original: "Managed projects",
      improved: "Managed 5 concurrent product launches, delivering $2M ARR",
      reason: "Quantify impact and be specific"
    }
  ],
  skillsToHighlight: ["SQL", "A/B testing"],
  overallFit: "Good fit with minor resume adjustments needed"
}
```

**Status:** NOT STARTED - Replaces/enhances current "Match Resume" feature.

---

## Phase 8: Interview Prep (Future)

**Goal:** When user marks a job as "Applied", generate study content to prepare for interviews.

### Proposed Flow:
```
User changes job status → "Applied"
        ↓
Trigger AI call to generate prep content:
  - Topics to study based on job requirements
  - Skills gaps to address
  - Company-specific research areas
  - Common interview questions for role
        ↓
Store in jobHistory alongside job record
        ↓
Display with "View Prep" button + "Copy" option
```

### Storage Design:
```javascript
jobRecord = {
  // ... existing fields ...
  prepContent: {
    topics: ["SQL queries", "A/B testing", "Product metrics"],
    skillGaps: ["Need to brush up on Python", "Review ML basics"],
    companyResearch: ["Check recent product launches", "Review earnings calls"],
    questions: ["Tell me about a time you...", "How would you prioritize..."],
    generatedAt: "2024-12-29T..."
  }
}
```

### Storage Budget:
| Data | Size Est. | Notes |
|------|-----------|-------|
| chrome.storage.local limit | 5 MB | Total available |
| Current usage (500 jobs) | ~1 MB | Without prep content |
| Prep content per job | ~3-5 KB | Topics, questions, etc. |
| With prep (100 applied jobs) | ~1.5 MB | Conservative estimate |
| **Remaining headroom** | ~2.5 MB | Plenty of space |

### Export Options:
| Option | Complexity | Description |
|--------|------------|-------------|
| Copy to clipboard | Simple | One-click copy formatted prep content |
| Download as .md | Simple | Export prep as markdown file |
| Open in new tab | Simple | Display prep in dedicated page |
| Google Drive (OAuth) | Complex | Requires API setup, but possible |

**Status:** NOT STARTED - Pending user decision on implementation approach.

---

## Known Risks

1. **Site changes break selectors** - Job sites update their HTML frequently
2. **Rate limiting** - Scoring many jobs may hit API limits
3. **Bot detection** - Automated clicking could get flagged (mitigated by delays)
4. **Storage limits** - chrome.storage.local has 5MB limit for job history
