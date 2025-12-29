console.log('CareerFit: Content script loaded');
console.log('CareerFit: Current URL:', window.location.href);

// --- Site Configuration for Job Extraction ---
const SITE_CONFIGS = {
    'indeed.com': {
        isSearchPage: (url) => url.includes('/jobs') || url.includes('q='),
        jobCards: '.jobsearch-ResultsList > li, .job_seen_beacon, .resultContent',
        title: '.jobTitle, [data-testid="jobTitle"], .jobTitle-color-purple > span',
        company: '.companyName, [data-testid="company-name"], .company_location .companyName',
        location: '.companyLocation, [data-testid="text-location"]',
        posted: '.date, .myJobsState',
        link: 'a[data-jk], .jobTitle a, a.jcs-JobTitle',
    },
    'student.interstride.com': {
        isSearchPage: (url) => url.includes('/jobs') && !url.match(/\/jobs\/\d+$/),
        // Generic selectors with fallbacks for Interstride
        jobCards: '[class*="job-card"], [class*="JobCard"], .job-listing, [class*="job-item"], [class*="JobItem"], .card',
        title: '[class*="title"], [class*="Title"], h3, h4, h5',
        company: '[class*="company"], [class*="Company"], [class*="employer"], [class*="Employer"]',
        location: '[class*="location"], [class*="Location"]',
        posted: '[class*="date"], [class*="Date"], [class*="posted"], [class*="Posted"], time',
        link: 'a[href*="/jobs/"]',
    },
    'linkedin.com': {
        isSearchPage: (url) => url.includes('/jobs/search') || url.includes('/jobs/collections'),
        jobCards: '.jobs-search-results__list-item, .job-card-container, .jobs-search-results-list__list-item',
        title: '.job-card-list__title, .job-card-container__link, .artdeco-entity-lockup__title',
        company: '.job-card-container__company-name, .artdeco-entity-lockup__subtitle',
        location: '.job-card-container__metadata-item, .artdeco-entity-lockup__caption',
        posted: 'time',
        link: 'a.job-card-container__link, a.job-card-list__title',
    },
    'greenhouse.io': {
        isSearchPage: (url) => url.includes('/jobs') || url.includes('/careers'),
        jobCards: '.opening, [class*="job-post"], [class*="career"]',
        title: 'a, .job-title, h3',
        company: '.company-name, .department',
        location: '.location',
        posted: '.posted-date',
        link: 'a',
    },
    'lever.co': {
        isSearchPage: (url) => url.includes('/jobs'),
        jobCards: '.posting, [class*="posting"]',
        title: '.posting-title h5, .posting-name',
        company: '.posting-categories .sort-by-team',
        location: '.posting-categories .sort-by-location',
        posted: '.posting-date',
        link: 'a.posting-title',
    }
};

// --- Anti-bot Delays ---
const DELAYS = {
    betweenJobs: () => 4000 + Math.random() * 8000,  // 4-12 seconds
    maxJobsPerScan: 20,
    scrollPause: () => 500 + Math.random() * 1000
};

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// --- Site Detection ---
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

// --- Job Extraction ---
function extractJobListings() {
    const config = getSiteConfig();
    if (!config) {
        console.log('CareerFit: No site config for', window.location.hostname);
        return [];
    }

    const jobs = [];
    const cards = document.querySelectorAll(config.jobCards);
    console.log('CareerFit: Found', cards.length, 'job cards using selector:', config.jobCards);

    cards.forEach((card, index) => {
        const titleEl = card.querySelector(config.title);
        const companyEl = card.querySelector(config.company);
        const locationEl = card.querySelector(config.location);
        const postedEl = card.querySelector(config.posted);
        const linkEl = card.querySelector(config.link);

        const title = titleEl?.textContent?.trim();
        const company = companyEl?.textContent?.trim();
        const location = locationEl?.textContent?.trim();
        const posted = postedEl?.textContent?.trim();
        const link = linkEl?.href || window.location.href;

        if (title) {
            jobs.push({
                index,
                title,
                company: company || 'Unknown',
                location: location || '',
                posted: posted || '',
                link,
                element: card
            });
        }
    });

    console.log('CareerFit: Extracted', jobs.length, 'jobs with titles');
    return jobs;
}

// --- 1. Create and inject the buttons ---
const buttonContainer = document.createElement('div');
buttonContainer.id = 'careerfit-buttons';

// Check if we're on a search results page to show Scan Jobs button
const onSearchPage = isOnSearchResultsPage();
console.log('CareerFit: On search results page:', onSearchPage);

buttonContainer.innerHTML = `
    ${onSearchPage ? '<button id="scan-jobs-btn">Scan Jobs</button>' : ''}
    <button id="summarize-btn">Summarize Role</button>
    <button id="assess-btn">Compare to Resume</button>
`;
document.body.appendChild(buttonContainer);

// --- 2. Create the modal (initially hidden) ---
const modal = document.createElement('div');
modal.id = 'assess-modal';
modal.style.display = 'none';
modal.innerHTML = `
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px;">
        <h3 style="margin: 0;">CareerFit AI</h3>
        <button id="close-modal" style="background: none; border: none; font-size: 24px; cursor: pointer; color: #666; padding: 0; line-height: 1;">&times;</button>
    </div>
    <div id="assess-modal-content">
        <p>Click a button to begin...</p>
    </div>
`;
document.body.appendChild(modal);

// --- 3. Handle close button click ---
document.addEventListener('click', (event) => {
    if (event.target.id === 'close-modal') {
        modal.style.display = 'none';
    }
});

// --- Helper function to get job text (stripped of HTML) ---
function getJobText() {
    // Selectors for different job sites
    const selectors = [
        // Amazon
        '#job-detail-body',
        '.job-detail',
        '[data-job-id]',
        '.job-description',
        // LinkedIn
        '.jobs-search__job-details',
        '.jobs-description',
        '.jobs-details__main-content',
        '.scaffold-layout__detail',
        // Indeed
        '#jobDescriptionText',
        '.jobsearch-jobDescriptionText',
        // Glassdoor
        '.jobDescriptionContent',
        '[data-test="jobDescription"]',
        // Lever
        '.posting-page',
        // Greenhouse
        '.job__description',
        // Interstride
        '.job-details',
        '[class*="job-detail"]',
        '[class*="JobDetail"]',
        // Generic fallbacks - be more specific
        '[class*="job-description"]',
        '[class*="jobDescription"]',
        '[id*="job"]',
        'main',
        'article',
        // Last resort - just get the body
        'body',
    ];

    for (const selector of selectors) {
        const container = document.querySelector(selector);
        if (container) {
            // Strip HTML, get text only
            const text = container.innerText || container.textContent;
            // Clean up: remove extra whitespace
            const cleanText = text.replace(/\s+/g, ' ').trim();
            console.log('CareerFit: Found job using selector:', selector, 'Length:', cleanText.length);
            return cleanText;
        }
    }
    return null;
}

// --- Helper function to show loading state ---
function showLoading(text) {
    modal.style.display = 'block';
    const modalContent = document.getElementById('assess-modal-content');
    modalContent.innerHTML = `
        <div style="text-align: center; padding: 20px;">
            <div class="loading-spinner"></div>
            <p style="margin-top: 15px; color: #666;">${text}</p>
        </div>
    `;
}

// --- Helper function to show error ---
function showError(text) {
    const modalContent = document.getElementById('assess-modal-content');
    modalContent.innerHTML = `<p style="color:red;">${text}</p>`;
}

// --- 4. Handle Summarize Role button click ---
document.getElementById('summarize-btn').addEventListener('click', () => {
    showLoading('Analyzing role...');

    const jobText = getJobText();
    if (jobText) {
        console.log('CareerFit: Sending job for summary, text length:', jobText.length);
        console.log('CareerFit: First 500 chars of job text:', jobText.substring(0, 500));
        chrome.runtime.sendMessage({ type: 'summarizeRole', text: jobText });
    } else {
        showError('Could not find job details on this page.');
    }
});

// --- 5. Handle Compare to Resume button click ---
document.getElementById('assess-btn').addEventListener('click', () => {
    showLoading('Comparing to your resume...');

    const jobText = getJobText();
    if (jobText) {
        console.log('CareerFit: Sending job for comparison, text length:', jobText.length);
        chrome.runtime.sendMessage({ type: 'analyzeJobHtml', text: jobText });
    } else {
        showError('Could not find job details on this page.');
    }
});

// --- 6. Listen for results from the background script ---
chrome.runtime.onMessage.addListener((message) => {
    const modalContent = document.getElementById('assess-modal-content');

    if (message.type === 'summaryResult') {
        modalContent.innerHTML = message.data;
    } else if (message.type === 'analysisResult') {
        modalContent.innerHTML = message.data;
    } else if (message.type === 'analysisError') {
        modalContent.innerHTML = `<p style="color:red;">${message.error}</p>`;
    } else if (message.type === 'scoreJobResult') {
        // Handle individual job score result during batch scan
        handleScoreResult(message);
    }
});

// --- Phase 4: Quick Filter (No API call - fast pre-screening) ---
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
        const seniorTitles = ['director', 'vp', 'vice president', 'head of', 'chief', 'cto', 'cfo', 'ceo', 'coo'];
        const isTooSenior = seniorTitles.some(t => titleLower.includes(t));
        if (isTooSenior) return { pass: false, reason: 'Too senior (Director+)' };
    }

    // Check for PhD requirement in title (rough check)
    if (hardFilters?.skipPhD) {
        if (titleLower.includes('phd') || titleLower.includes('ph.d')) {
            return { pass: false, reason: 'PhD required' };
        }
    }

    // Check if title roughly matches any target title
    if (candidateProfile?.targetTitles?.length) {
        const titleMatch = candidateProfile.targetTitles.some(targetTitle => {
            const targetLower = targetTitle.toLowerCase();
            // Check for partial matches (e.g., "product manager" matches "senior product manager")
            const targetWords = targetLower.split(/\s+/);
            return targetWords.some(word => word.length > 3 && titleLower.includes(word));
        });
        if (!titleMatch) return { pass: false, reason: 'Title mismatch' };
    }

    return { pass: true, reason: 'Passed quick filter' };
}

// --- Phase 3: Handle Scan Jobs Button Click ---
let scanState = {
    isScanning: false,
    jobs: [],
    results: [],
    currentIndex: 0
};

async function handleScanJobs() {
    if (scanState.isScanning) {
        console.log('CareerFit: Scan already in progress');
        return;
    }

    const jobs = extractJobListings();

    if (jobs.length === 0) {
        showError('No job listings found on this page. Make sure you\'re on a job search results page.');
        modal.style.display = 'block';
        return;
    }

    showLoading(`Found ${jobs.length} jobs. Loading your profile...`);

    // Get profile and filters from storage
    const data = await chrome.storage.local.get(['candidateProfile', 'hardFilters']);

    if (!data.candidateProfile) {
        showError('Please analyze your resume first in the extension options (right-click extension icon → Options).');
        return;
    }

    const { candidateProfile, hardFilters } = data;

    showLoading(`Running quick filter on ${jobs.length} jobs...`);

    // Run quick filter (no API calls)
    const filtered = jobs.map(job => ({
        ...job,
        quickResult: quickFilter(job, candidateProfile, hardFilters)
    }));

    const passed = filtered.filter(j => j.quickResult.pass);
    const skipped = filtered.filter(j => !j.quickResult.pass);

    console.log('CareerFit: Quick filter results - Passed:', passed.length, 'Skipped:', skipped.length);

    // Highlight jobs on page
    skipped.forEach(j => {
        if (j.element) {
            j.element.style.opacity = '0.3';
            j.element.style.transition = 'opacity 0.3s';
        }
    });
    passed.forEach(j => {
        if (j.element) {
            j.element.style.borderLeft = '4px solid #4caf50';
            j.element.style.transition = 'border 0.3s';
        }
    });

    // If no jobs passed quick filter, show summary
    if (passed.length === 0) {
        displayQuickFilterResults(passed, skipped);
        return;
    }

    // Ask user if they want to run full AI scoring
    displayQuickFilterWithScoreOption(passed, skipped, candidateProfile);
}

function displayQuickFilterResults(passed, skipped) {
    const modalContent = document.getElementById('assess-modal-content');
    modalContent.innerHTML = `
        <h4 style="margin-top: 0;">Quick Scan Complete</h4>
        <div style="display: flex; gap: 15px; margin-bottom: 15px;">
            <div style="flex: 1; text-align: center; padding: 15px; background: #e8f5e9; border-radius: 8px;">
                <div style="font-size: 24px; font-weight: bold; color: #4caf50;">${passed.length}</div>
                <div style="font-size: 12px; color: #666;">Potential Matches</div>
            </div>
            <div style="flex: 1; text-align: center; padding: 15px; background: #ffebee; border-radius: 8px;">
                <div style="font-size: 24px; font-weight: bold; color: #f44336;">${skipped.length}</div>
                <div style="font-size: 12px; color: #666;">Filtered Out</div>
            </div>
        </div>
        ${passed.length === 0 ? '<p style="color: #666;">No jobs matched your profile and filters. Try adjusting your hard filters in the extension options.</p>' : ''}
        ${skipped.length > 0 ? `
            <details style="margin-top: 10px;">
                <summary style="cursor: pointer; color: #666; font-size: 13px;">Why were jobs filtered out?</summary>
                <ul style="font-size: 12px; color: #888; margin-top: 8px;">
                    ${skipped.slice(0, 5).map(j => `<li>${j.title} - ${j.quickResult.reason}</li>`).join('')}
                    ${skipped.length > 5 ? `<li>...and ${skipped.length - 5} more</li>` : ''}
                </ul>
            </details>
        ` : ''}
    `;
    modal.style.display = 'block';
}

function displayQuickFilterWithScoreOption(passed, skipped, candidateProfile) {
    const modalContent = document.getElementById('assess-modal-content');
    const jobsToScore = Math.min(passed.length, DELAYS.maxJobsPerScan);
    const estimatedTime = Math.ceil((jobsToScore * 8) / 60); // ~8 seconds average per job

    modalContent.innerHTML = `
        <h4 style="margin-top: 0;">Quick Scan Complete</h4>
        <div style="display: flex; gap: 15px; margin-bottom: 15px;">
            <div style="flex: 1; text-align: center; padding: 15px; background: #e8f5e9; border-radius: 8px;">
                <div style="font-size: 24px; font-weight: bold; color: #4caf50;">${passed.length}</div>
                <div style="font-size: 12px; color: #666;">Potential Matches</div>
            </div>
            <div style="flex: 1; text-align: center; padding: 15px; background: #ffebee; border-radius: 8px;">
                <div style="font-size: 24px; font-weight: bold; color: #f44336;">${skipped.length}</div>
                <div style="font-size: 12px; color: #666;">Filtered Out</div>
            </div>
        </div>
        <p style="margin: 15px 0; font-size: 13px;">Matches (highlighted green on page):</p>
        <ul style="font-size: 13px; max-height: 150px; overflow-y: auto; margin: 0; padding-left: 20px;">
            ${passed.slice(0, 10).map(j => `<li style="margin: 4px 0;"><strong>${j.title}</strong> - ${j.company}</li>`).join('')}
            ${passed.length > 10 ? `<li>...and ${passed.length - 10} more</li>` : ''}
        </ul>
        <hr style="margin: 15px 0; border: none; border-top: 1px solid #eee;">
        <p style="font-size: 13px; color: #666;">Run AI scoring on ${jobsToScore} jobs? (~${estimatedTime} min)</p>
        <button id="run-full-scoring" style="width: 100%; padding: 12px; background: #4caf50; color: white; border: none; border-radius: 8px; cursor: pointer; font-weight: 600; font-size: 14px;">
            Score Jobs with AI
        </button>
        ${skipped.length > 0 ? `
            <details style="margin-top: 15px;">
                <summary style="cursor: pointer; color: #666; font-size: 13px;">Filtered out jobs</summary>
                <ul style="font-size: 12px; color: #888; margin-top: 8px;">
                    ${skipped.slice(0, 5).map(j => `<li>${j.title} - ${j.quickResult.reason}</li>`).join('')}
                    ${skipped.length > 5 ? `<li>...and ${skipped.length - 5} more</li>` : ''}
                </ul>
            </details>
        ` : ''}
    `;
    modal.style.display = 'block';

    // Store passed jobs for scoring
    scanState.jobs = passed;
    scanState.results = [];
    scanState.currentIndex = 0;
    scanState.candidateProfile = candidateProfile;

    // Add click handler for full scoring button
    document.getElementById('run-full-scoring').addEventListener('click', () => {
        runFullScoring();
    });
}

// --- Phase 5: Full AI Scoring ---
async function runFullScoring() {
    scanState.isScanning = true;
    const jobsToScore = scanState.jobs.slice(0, DELAYS.maxJobsPerScan);

    showLoading(`Scoring job 1 of ${jobsToScore.length}...`);

    for (let i = 0; i < jobsToScore.length; i++) {
        scanState.currentIndex = i;
        const job = jobsToScore[i];

        // Update progress
        updateScanProgress(i + 1, jobsToScore.length, job.title);

        try {
            // Send job for scoring via background script
            const response = await chrome.runtime.sendMessage({
                type: 'scoreJob',
                job: {
                    title: job.title,
                    company: job.company,
                    location: job.location,
                    link: job.link,
                    // We'll fetch the full description in background if needed
                }
            });

            if (response && response.success) {
                scanState.results.push({
                    ...job,
                    score: response.data.fitScore,
                    analysis: response.data
                });

                // Update job card visual based on score
                updateJobCardVisual(job.element, response.data.fitScore);
            } else {
                console.error('CareerFit: Error scoring job:', response?.error);
                scanState.results.push({
                    ...job,
                    score: 0,
                    error: response?.error || 'Unknown error'
                });
            }
        } catch (error) {
            console.error('CareerFit: Exception scoring job:', error);
            scanState.results.push({
                ...job,
                score: 0,
                error: error.message
            });
        }

        // Add delay between jobs (anti-bot)
        if (i < jobsToScore.length - 1) {
            const delay = DELAYS.betweenJobs();
            console.log(`CareerFit: Waiting ${Math.round(delay/1000)}s before next job...`);
            await sleep(delay);
        }
    }

    scanState.isScanning = false;
    displayFinalResults();
}

function updateScanProgress(current, total, jobTitle) {
    const modalContent = document.getElementById('assess-modal-content');
    const percent = Math.round((current / total) * 100);

    modalContent.innerHTML = `
        <h4 style="margin-top: 0;">Scoring Jobs...</h4>
        <div style="background: #f5f5f5; border-radius: 8px; padding: 2px; margin: 15px 0;">
            <div style="background: linear-gradient(90deg, #4caf50, #81c784); width: ${percent}%; height: 8px; border-radius: 6px; transition: width 0.3s;"></div>
        </div>
        <p style="text-align: center; color: #666; font-size: 14px;">${current} of ${total}</p>
        <p style="text-align: center; font-size: 13px; color: #888; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
            ${jobTitle}
        </p>
        <p style="text-align: center; font-size: 12px; color: #aaa; margin-top: 20px;">
            Please keep this tab open...
        </p>
    `;
}

function updateJobCardVisual(element, score) {
    if (!element) return;

    if (score >= 4) {
        element.style.borderLeft = '4px solid #4caf50';
        element.style.background = 'rgba(76, 175, 80, 0.05)';
    } else if (score >= 3) {
        element.style.borderLeft = '4px solid #ff9800';
        element.style.background = 'rgba(255, 152, 0, 0.05)';
    } else {
        element.style.borderLeft = '4px solid #f44336';
        element.style.opacity = '0.5';
    }
}

function displayFinalResults() {
    const results = scanState.results;
    const highFit = results.filter(r => r.score >= 4).sort((a, b) => b.score - a.score);
    const mediumFit = results.filter(r => r.score >= 3 && r.score < 4);
    const lowFit = results.filter(r => r.score < 3 && r.score > 0);
    const errors = results.filter(r => r.score === 0);

    const modalContent = document.getElementById('assess-modal-content');

    modalContent.innerHTML = `
        <h4 style="margin-top: 0;">Scan Complete!</h4>
        <div style="display: flex; gap: 10px; margin-bottom: 15px;">
            <div style="flex: 1; text-align: center; padding: 12px; background: #e8f5e9; border-radius: 8px;">
                <div style="font-size: 20px; font-weight: bold; color: #4caf50;">${highFit.length}</div>
                <div style="font-size: 11px; color: #666;">Great Fit (4+)</div>
            </div>
            <div style="flex: 1; text-align: center; padding: 12px; background: #fff3e0; border-radius: 8px;">
                <div style="font-size: 20px; font-weight: bold; color: #ff9800;">${mediumFit.length}</div>
                <div style="font-size: 11px; color: #666;">Good Fit (3)</div>
            </div>
            <div style="flex: 1; text-align: center; padding: 12px; background: #ffebee; border-radius: 8px;">
                <div style="font-size: 20px; font-weight: bold; color: #f44336;">${lowFit.length}</div>
                <div style="font-size: 11px; color: #666;">Low Fit (1-2)</div>
            </div>
        </div>

        ${highFit.length > 0 ? `
            <h5 style="color: #4caf50; margin: 15px 0 10px 0;">Recommended Jobs</h5>
            <div style="max-height: 300px; overflow-y: auto;">
                ${highFit.map(job => `
                    <div style="padding: 12px; margin: 8px 0; background: #f8f9fa; border-radius: 8px; border-left: 4px solid ${getScoreColor(job.score)};">
                        <div style="display: flex; justify-content: space-between; align-items: start;">
                            <div style="flex: 1;">
                                <strong style="font-size: 14px;">${job.title}</strong><br>
                                <span style="color: #666; font-size: 13px;">${job.company}</span>
                            </div>
                            <div style="background: ${getScoreColor(job.score)}; color: white; padding: 4px 10px; border-radius: 12px; font-weight: bold; font-size: 13px;">
                                ${job.score}/5
                            </div>
                        </div>
                        ${job.analysis?.recommendation ? `<div style="font-size: 12px; color: #4caf50; margin-top: 6px;">${job.analysis.recommendation}</div>` : ''}
                        ${job.analysis?.strengths?.length ? `<div style="font-size: 12px; color: #666; margin-top: 4px;">✓ ${job.analysis.strengths[0]}</div>` : ''}
                        <a href="${job.link}" target="_blank" style="display: inline-block; margin-top: 8px; font-size: 12px; color: #0a66c2; text-decoration: none;">View Job →</a>
                    </div>
                `).join('')}
            </div>
        ` : '<p style="color: #666; text-align: center; padding: 20px;">No jobs scored 4 or above. Try expanding your filters.</p>'}

        ${mediumFit.length > 0 ? `
            <details style="margin-top: 15px;">
                <summary style="cursor: pointer; color: #ff9800; font-size: 13px; font-weight: 600;">Good Fit Jobs (${mediumFit.length})</summary>
                <div style="margin-top: 8px;">
                    ${mediumFit.map(job => `
                        <div style="padding: 8px; margin: 4px 0; background: #fff8e1; border-radius: 6px; font-size: 13px;">
                            <strong>${job.title}</strong> - ${job.company}
                            <span style="float: right; color: #ff9800;">${job.score}/5</span>
                            <br><a href="${job.link}" target="_blank" style="font-size: 11px; color: #0a66c2;">View →</a>
                        </div>
                    `).join('')}
                </div>
            </details>
        ` : ''}

        ${errors.length > 0 ? `
            <details style="margin-top: 10px;">
                <summary style="cursor: pointer; color: #999; font-size: 12px;">${errors.length} jobs couldn't be scored</summary>
                <ul style="font-size: 11px; color: #999;">
                    ${errors.map(j => `<li>${j.title} - ${j.error || 'Error'}</li>`).join('')}
                </ul>
            </details>
        ` : ''}
    `;
    modal.style.display = 'block';
}

function getScoreColor(score) {
    if (score >= 4) return '#4caf50';
    if (score >= 3) return '#ff9800';
    return '#f44336';
}

// --- Handle Score Result from Background ---
function handleScoreResult(message) {
    // This is called when background sends score results
    // Currently handled inline in runFullScoring, but keeping for future async improvements
    console.log('CareerFit: Received score result:', message);
}

// --- Attach Scan Jobs Button Handler ---
if (onSearchPage) {
    const scanBtn = document.getElementById('scan-jobs-btn');
    if (scanBtn) {
        scanBtn.addEventListener('click', handleScanJobs);
    }
}
