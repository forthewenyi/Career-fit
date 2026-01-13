console.log('CareerFit: Content script loaded');
console.log('CareerFit: Current URL:', window.location.href);

// --- 1. Create and inject the buttons ---
const buttonContainer = document.createElement('div');
buttonContainer.id = 'careerfit-buttons';

buttonContainer.innerHTML = `
    <span id="cf-drag-handle">⋮⋮</span>
    <button id="cf-minimize-btn" title="Minimize">−</button>
    <button id="summarize-btn" class="cf-action-btn">Summarize</button>
    <button id="assess-btn" class="cf-action-btn">Assess</button>
    <button id="autofill-btn" class="cf-action-btn">Auto-fill</button>
    <button id="history-btn" class="cf-action-btn">History</button>
`;
document.body.appendChild(buttonContainer);

// --- Draggable functionality ---
let isDragging = false;
let dragOffsetX = 0;
let dragOffsetY = 0;

buttonContainer.addEventListener('mousedown', (e) => {
    // Only start drag on the handle or container background (not buttons)
    if (e.target.tagName === 'BUTTON') return;

    isDragging = true;
    const rect = buttonContainer.getBoundingClientRect();
    dragOffsetX = e.clientX - rect.left;
    dragOffsetY = e.clientY - rect.top;
    buttonContainer.style.cursor = 'grabbing';
});

document.addEventListener('mousemove', (e) => {
    if (!isDragging) return;

    const x = e.clientX - dragOffsetX;
    const y = e.clientY - dragOffsetY;

    // Keep within viewport bounds
    const maxX = window.innerWidth - buttonContainer.offsetWidth;
    const maxY = window.innerHeight - buttonContainer.offsetHeight;

    buttonContainer.style.left = Math.max(0, Math.min(x, maxX)) + 'px';
    buttonContainer.style.top = Math.max(0, Math.min(y, maxY)) + 'px';
    buttonContainer.style.right = 'auto';
});

document.addEventListener('mouseup', () => {
    if (isDragging) {
        isDragging = false;
        buttonContainer.style.cursor = 'move';
    }
});

// --- Minimize functionality ---
const minimizeBtn = document.getElementById('cf-minimize-btn');
minimizeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const isMinimized = buttonContainer.classList.toggle('minimized');
    minimizeBtn.textContent = isMinimized ? '+' : '−';
    minimizeBtn.title = isMinimized ? 'Expand' : 'Minimize';
});

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

// --- 3. Handle close button click and save skill buttons ---
document.addEventListener('click', async (event) => {
    if (event.target.id === 'close-modal') {
        modal.style.display = 'none';
    }

    // Handle save skill button clicks
    if (event.target.classList.contains('save-skill-btn')) {
        const btn = event.target;
        const skill = btn.dataset.skill;
        const resources = btn.dataset.resources || '';
        const keywords = btn.dataset.keywords ? btn.dataset.keywords.split(',').filter(k => k) : [];

        if (skill) {
            await saveSkillToLearn({ skill, resources, keywords });
            // Visual feedback - change to checkmark
            btn.textContent = '✓';
            btn.style.background = '#3d8b6e';
            btn.style.color = 'white';
            btn.style.borderColor = '#3d8b6e';
            btn.disabled = true;
            btn.title = 'Saved!';
        }
    }
});

// --- Helper function to get job text (stripped of HTML) ---
function getJobText() {
    // Selectors for different job sites - ORDER MATTERS, most specific first
    const selectors = [
        // LinkedIn 2024/2025 - updated selectors
        '.jobs-description-content',
        '.jobs-description__content',
        '.jobs-description-content__text',
        '.job-details-jobs-unified-top-card__job-insight',
        '.jobs-unified-top-card__job-insight',
        '[class*="jobs-description"]',
        '.jobs-box__html-content',
        '.jobs-search__job-details--wrapper',
        '.jobs-search__job-details',
        '.jobs-description',
        '.jobs-details__main-content',
        '.scaffold-layout__detail',
        // Try article inside scaffold
        '.scaffold-layout__detail article',
        // Indeed
        '#jobDescriptionText',
        '.jobsearch-jobDescriptionText',
        // Glassdoor
        '.jobDescriptionContent',
        '[data-test="jobDescription"]',
        // Microsoft Careers
        '[class*="JobDescription"]',
        '[class*="jobDescription"]',
        '[class*="description-"] .content',
        '[class*="description-"]',
        '.ms-Stack [class*="content"]',
        // Amazon
        '#job-detail-body',
        '.job-detail',
        '.job-description',
        // Lever
        '.posting-page',
        // Greenhouse
        '.job__description',
        // Interstride
        '.job-details',
        '[class*="job-detail"]',
        '[class*="JobDetail"]',
        // Generic fallbacks
        '[class*="job-description"]',
        'main',
        'article',
        // Last resort
        'body',
    ];

    // Debug: log all elements with 'description' in class name
    console.log('CareerFit DEBUG: Elements with description in class:');
    document.querySelectorAll('[class*="description"]').forEach(el => {
        const text = (el.innerText || '').substring(0, 100);
        console.log('  -', el.className.substring(0, 80), '| Length:', el.innerText?.length || 0, '| Preview:', text.substring(0, 50));
    });

    for (const selector of selectors) {
        const container = document.querySelector(selector);
        if (container) {
            // Strip HTML, get text only
            const text = container.innerText || container.textContent;
            // Clean up: remove extra whitespace
            const cleanText = text.replace(/\s+/g, ' ').trim();
            // Require minimum length to avoid matching tiny elements like "Saved jobs"
            if (cleanText.length >= 200) {
                console.log('CareerFit: Found job using selector:', selector, 'Length:', cleanText.length);
                return cleanText;
            } else {
                console.log('CareerFit: Skipping selector (too short):', selector, 'Length:', cleanText.length);
            }
        }
    }
    // If no good match found, fall back to body
    const bodyText = document.body.innerText?.replace(/\s+/g, ' ').trim() || '';
    console.log('CareerFit: Using body fallback, Length:', bodyText.length);
    return bodyText;
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
document.getElementById('summarize-btn').addEventListener('click', async () => {
    // First, check if we have cached summary for this job
    const jobInfo = extractCurrentJobInfo();
    const cachedResult = await getCachedSummary(jobInfo);

    if (cachedResult) {
        console.log('CareerFit: Found cached summary for:', jobInfo.title);
        showCachedSummary(cachedResult);
        return;
    }

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
document.getElementById('assess-btn').addEventListener('click', async () => {
    // First, check if we have cached results for this job
    const jobInfo = extractCurrentJobInfo();
    const cachedResult = await getCachedAssessment(jobInfo);

    if (cachedResult) {
        console.log('CareerFit: Found cached assessment for:', jobInfo.title);
        showCachedAssessment(cachedResult);
        return;
    }

    showLoading('Comparing to your resume...');

    const jobText = getJobText();
    if (jobText) {
        console.log('CareerFit: Sending job for comparison, text length:', jobText.length);
        chrome.runtime.sendMessage({ type: 'analyzeJobHtml', text: jobText });
    } else {
        showError('Could not find job details on this page.');
    }
});

// --- Safe storage access (handles extension context invalidation) ---
async function safeStorageGet(keys) {
    try {
        if (!chrome?.storage?.local) {
            console.warn('CareerFit: Extension context invalidated, reload the page');
            return {};
        }
        return await chrome.storage.local.get(keys);
    } catch (e) {
        console.warn('CareerFit: Storage access failed:', e.message);
        return {};
    }
}

async function safeStorageSet(data) {
    try {
        if (!chrome?.storage?.local) {
            console.warn('CareerFit: Extension context invalidated, reload the page');
            return false;
        }
        await chrome.storage.local.set(data);
        return true;
    } catch (e) {
        console.warn('CareerFit: Storage write failed:', e.message);
        return false;
    }
}

// --- Check for cached assessment ---
async function getCachedAssessment(jobInfo) {
    if (!jobInfo.title) return null;

    const { jobHistory = [] } = await safeStorageGet(['jobHistory']);
    const jobId = btoa(`${jobInfo.title}|${jobInfo.company || 'Unknown'}|${window.location.href}`).slice(0, 32);

    const cached = jobHistory.find(j => j.id === jobId && j.analysis && j.analysis.fitScore);
    return cached;
}

// --- Check for cached summary ---
async function getCachedSummary(jobInfo) {
    if (!jobInfo.title) return null;

    const { jobHistory = [] } = await safeStorageGet(['jobHistory']);
    const jobId = btoa(`${jobInfo.title}|${jobInfo.company || 'Unknown'}|${window.location.href}`).slice(0, 32);

    // Look for job with summary data (yearsRequired is a good indicator)
    const cached = jobHistory.find(j => j.id === jobId && j.summary && j.summary.yearsRequired);
    return cached;
}

// --- Display cached assessment ---
function showCachedAssessment(cachedJob) {
    modal.style.display = 'block';
    const modalContent = document.getElementById('assess-modal-content');

    const analysis = cachedJob.analysis;
    const summary = cachedJob.summary || {};
    const fitScore = analysis.fitScore;

    // Option B: Green + Cream Hybrid colors
    let scoreColor = '#4a4a4a';
    if (fitScore >= 4) scoreColor = '#3d8b6e';
    else if (fitScore >= 3) scoreColor = '#c9a050';

    const scannedDate = new Date(cachedJob.scannedAt).toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' });
    const years = summary.yearsRequired || 'Not specified';
    const managerType = summary.managerType || '';
    const func = summary.function || '';
    const uniqueReqs = summary.uniqueRequirements || [];

    // Option B: 12px font, 1.35 line-height
    let html = `<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 12px; line-height: 1.35;">`;

    // Cached banner - Option B: Creamy white with green text
    html += `
        <div style="background: #F5F3E7; padding: 4px 8px; border-radius: 5px; margin-bottom: 8px; font-size: 10px; color: #2d6b52; border: 1px solid #e0ddd0; display: flex; justify-content: space-between; align-items: center;">
            <span>Cached ${scannedDate}</span>
            <button id="refresh-assess" style="background: #3d8b6e; color: white; border: none; padding: 3px 8px; border-radius: 4px; cursor: pointer; font-size: 10px; font-weight: 500;">Refresh</button>
        </div>
    `;

    // Score badge - Option B: 38px badge
    html += `
        <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px; padding-bottom: 8px; border-bottom: 1px solid #eee;">
            <div style="width: 38px; height: 38px; border-radius: 50%; background: ${scoreColor}; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
                <span style="color: white; font-size: 18px; font-weight: 700;">${fitScore}</span>
            </div>
            <div>
                <div style="font-size: 9px; text-transform: uppercase; letter-spacing: 0.5px; color: #888;">Fit Score</div>
                <div style="font-size: 14px; font-weight: 600; color: ${scoreColor};">${fitScore >= 4 ? 'Great Match' : fitScore >= 3 ? 'Good Match' : fitScore >= 2 ? 'Stretch' : 'Low Match'}</div>
            </div>
        </div>
    `;

    // Role basics - Option B: Creamy white tags
    html += `
        <div style="margin-bottom: 8px;">
            <div style="display: flex; gap: 3px; flex-wrap: wrap; margin-bottom: 3px;">
                <span style="background: #F5F3E7; color: #2d6b52; padding: 2px 8px; border-radius: 10px; font-size: 11px; font-weight: 600; border: 1px solid #e0ddd0;">${years}</span>
                ${managerType ? `<span style="background: ${managerType === 'People Manager' ? '#f5f0e0' : '#e8f5f1'}; color: ${managerType === 'People Manager' ? '#6b5a30' : '#2d6b52'}; padding: 2px 8px; border-radius: 10px; font-size: 11px; font-weight: 600; border: 1px solid ${managerType === 'People Manager' ? '#e8e0d0' : '#d0e8e0'};">${managerType}</span>` : ''}
            </div>
            ${func ? `<p style="margin: 3px 0 0 0; font-size: 12px; color: #444; line-height: 1.35;">${func}</p>` : ''}
        </div>
    `;

    // Role requirements - Option B: tighter spacing
    if (uniqueReqs.length > 0) {
        html += `
            <div style="margin-bottom: 8px;">
                <div style="font-size: 9px; text-transform: uppercase; letter-spacing: 0.5px; color: #2d6b52; margin-bottom: 4px; font-weight: 600;">Looking For</div>
                <ul style="margin: 0; padding-left: 16px;">
                    ${uniqueReqs.map(req => `<li style="font-size: 12px; color: #333; margin-bottom: 2px;">${req}</li>`).join('')}
                </ul>
            </div>
        `;
    }

    // Gaps - Option B: Yellow left border, cream background
    const gaps = analysis.gaps || [];
    if (gaps.length > 0) {
        html += `
            <div style="margin-top: 8px; padding-top: 8px; border-top: 1px solid #eee;">
                <div style="font-size: 9px; text-transform: uppercase; letter-spacing: 0.5px; color: #2d6b52; margin-bottom: 4px; font-weight: 600;">Skills to Develop</div>
                ${gaps.map(gap => {
                    if (typeof gap === 'string') {
                        return `<div style="background: #fdfcf8; border-radius: 5px; padding: 6px 8px; margin-bottom: 4px; border-left: 3px solid #F0D58C;">
                            <div style="font-size: 12px; font-weight: 600; color: #333;">${gap}</div>
                        </div>`;
                    }
                    return `<div style="background: #fdfcf8; border-radius: 5px; padding: 6px 8px; margin-bottom: 4px; border-left: 3px solid #F0D58C;">
                        <div style="font-size: 12px; font-weight: 600; color: #333;">${gap.skill || gap}</div>
                        ${gap.resources ? `<div style="font-size: 11px; color: #555; margin-top: 1px;">${gap.resources}</div>` : ''}
                    </div>`;
                }).join('')}
            </div>
        `;
    }

    html += `</div>`;
    modalContent.innerHTML = html;

    // Add refresh button handler
    document.getElementById('refresh-assess')?.addEventListener('click', () => {
        showLoading('Refreshing assessment...');
        const jobText = getJobText();
        if (jobText) {
            chrome.runtime.sendMessage({ type: 'analyzeJobHtml', text: jobText });
        } else {
            showError('Could not find job details on this page.');
        }
    });
}

// --- Display cached summary ---
function showCachedSummary(cachedJob) {
    modal.style.display = 'block';
    const modalContent = document.getElementById('assess-modal-content');

    const summary = cachedJob.summary || {};
    const scannedDate = new Date(cachedJob.scannedAt).toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' });
    const years = summary.yearsRequired || 'Not specified';
    const managerType = summary.managerType || '';
    const func = summary.function || '';
    const uniqueReqs = summary.uniqueRequirements || [];

    // Option B: 12px font, 1.35 line-height
    let html = `<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 12px; line-height: 1.35;">`;

    // Cached banner - Option B: Creamy white with green text
    html += `
        <div style="background: #F5F3E7; padding: 4px 8px; border-radius: 5px; margin-bottom: 8px; font-size: 10px; color: #2d6b52; border: 1px solid #e0ddd0; display: flex; justify-content: space-between; align-items: center;">
            <span>Cached ${scannedDate}</span>
            <button id="refresh-summary" style="background: #3d8b6e; color: white; border: none; padding: 3px 8px; border-radius: 4px; cursor: pointer; font-size: 10px; font-weight: 500;">Refresh</button>
        </div>
    `;

    // Role basics - Option B: Creamy white tags
    html += `
        <div style="margin-bottom: 8px;">
            <div style="display: flex; gap: 3px; flex-wrap: wrap; margin-bottom: 3px;">
                <span style="background: #F5F3E7; color: #2d6b52; padding: 2px 8px; border-radius: 10px; font-size: 11px; font-weight: 600; border: 1px solid #e0ddd0;">${years}</span>
                ${managerType ? `<span style="background: ${managerType === 'People Manager' ? '#f5f0e0' : '#e8f5f1'}; color: ${managerType === 'People Manager' ? '#6b5a30' : '#2d6b52'}; padding: 2px 8px; border-radius: 10px; font-size: 11px; font-weight: 600; border: 1px solid ${managerType === 'People Manager' ? '#e8e0d0' : '#d0e8e0'};">${managerType}</span>` : ''}
            </div>
            ${func ? `<p style="margin: 3px 0 0 0; font-size: 12px; color: #444; line-height: 1.35;">${func}</p>` : ''}
        </div>
    `;

    // Role requirements - Option B: tighter spacing
    if (uniqueReqs.length > 0) {
        html += `
            <div style="margin-bottom: 8px;">
                <div style="font-size: 9px; text-transform: uppercase; letter-spacing: 0.5px; color: #2d6b52; margin-bottom: 4px; font-weight: 600;">Looking For</div>
                <ul style="margin: 0; padding-left: 16px;">
                    ${uniqueReqs.map(req => `<li style="font-size: 12px; color: #333; margin-bottom: 2px;">${req}</li>`).join('')}
                </ul>
            </div>
        `;
    } else {
        html += `<p style="color: #888; font-style: italic; font-size: 11px;">Standard role - no specific requirements</p>`;
    }

    html += `</div>`;
    modalContent.innerHTML = html;

    // Add refresh button handler
    document.getElementById('refresh-summary')?.addEventListener('click', () => {
        showLoading('Refreshing summary...');
        const jobText = getJobText();
        if (jobText) {
            chrome.runtime.sendMessage({ type: 'summarizeRole', text: jobText });
        } else {
            showError('Could not find job details on this page.');
        }
    });
}

// --- 6. Listen for results from the background script ---
chrome.runtime.onMessage.addListener((message) => {
    const modalContent = document.getElementById('assess-modal-content');

    if (message.type === 'summaryResult') {
        modalContent.innerHTML = message.data;
        // Save to job history if we have summary data
        if (message.summary) {
            saveSummaryToHistory(message.summary);
        }
    } else if (message.type === 'analysisResult') {
        modalContent.innerHTML = message.data;
        // Save to job history if we have analysis data
        if (message.analysis) {
            saveAssessmentToHistory(message.analysis);
        }
    } else if (message.type === 'analysisError') {
        modalContent.innerHTML = `<p style="color:red;">${message.error}</p>`;
    }
});

// --- Save individual "Assess fit" results to history ---
async function saveAssessmentToHistory(analysis) {
    // Try to extract job info from the page
    const jobInfo = extractCurrentJobInfo();
    if (!jobInfo.title) {
        console.log('CareerFit: Could not extract job info, skipping history save');
        return;
    }

    await saveJobToHistory({
        title: jobInfo.title,
        company: jobInfo.company || 'Unknown',
        location: jobInfo.location || '',
        link: window.location.href,
        score: analysis.fitScore,
        analysis: {
            fitScore: analysis.fitScore,
            gaps: analysis.gaps // Now an array of objects with skill, why, resources, funFact
        },
        // Include summary data from combined API call
        summary: {
            yearsRequired: analysis.yearsRequired,
            managerType: analysis.managerType,
            function: analysis.function,
            uniqueRequirements: analysis.uniqueRequirements
        },
        status: analysis.fitScore >= 4 ? 'interested' : 'scanned'
    });
    console.log('CareerFit: Saved assessment to history:', jobInfo.title, 'Score:', analysis.fitScore);
}

// --- Save "Summarize Role" results to history (no score, just summary) ---
async function saveSummaryToHistory(summary) {
    // Try to extract job info from the page
    const jobInfo = extractCurrentJobInfo();
    if (!jobInfo.title) {
        console.log('CareerFit: Could not extract job info, skipping history save');
        return;
    }

    await saveJobToHistory({
        title: jobInfo.title,
        company: jobInfo.company || 'Unknown',
        location: jobInfo.location || '',
        link: window.location.href,
        score: null, // Summarize Role doesn't score
        analysis: null,
        summary: {
            yearsRequired: summary.yearsRequired,
            managerType: summary.managerType,
            function: summary.function,
            uniqueRequirements: summary.uniqueRequirements
        },
        status: 'scanned'
    });
    console.log('CareerFit: Saved summary to history:', jobInfo.title);
}

// --- Extract job info from current page ---
function extractCurrentJobInfo() {
    const host = window.location.hostname;
    let title = '';
    let company = '';
    let location = '';

    // First, try to get data from JSON-LD structured data (most reliable)
    const jsonLdData = extractFromJsonLd();
    if (jsonLdData.title) {
        console.log('CareerFit: Extracted job info from JSON-LD:', jsonLdData);
        return jsonLdData;
    }

    // LinkedIn
    if (host.includes('linkedin.com')) {
        title = document.querySelector('.job-details-jobs-unified-top-card__job-title, .jobs-unified-top-card__job-title, h1.t-24, .t-24.job-details-jobs-unified-top-card__job-title')?.textContent?.trim() || '';
        company = document.querySelector('.job-details-jobs-unified-top-card__company-name, .jobs-unified-top-card__company-name, .job-details-jobs-unified-top-card__primary-description-container a')?.textContent?.trim() || '';
        location = document.querySelector('.job-details-jobs-unified-top-card__bullet, .jobs-unified-top-card__bullet, .job-details-jobs-unified-top-card__primary-description-container .tvm__text')?.textContent?.trim() || '';
    }
    // Indeed
    else if (host.includes('indeed.com')) {
        title = document.querySelector('.jobsearch-JobInfoHeader-title, [data-testid="jobsearch-JobInfoHeader-title"], h1[data-testid="jobTitle"]')?.textContent?.trim() || '';
        company = document.querySelector('.jobsearch-InlineCompanyRating-companyHeader, [data-testid="inlineHeader-companyName"], [data-testid="companyName"]')?.textContent?.trim() || '';
        location = document.querySelector('.jobsearch-JobInfoHeader-subtitle > div:last-child, [data-testid="job-location"], [data-testid="inlineHeader-companyLocation"]')?.textContent?.trim() || '';
    }
    // Microsoft Careers (careers.microsoft.com)
    else if (host.includes('microsoft.com') || host.includes('careers.microsoft')) {
        // New Microsoft careers site uses dynamic class names
        title = document.querySelector('.position-title-3TPtN, [class*="position-title"], h2[class*="position"], .title-1aNJK')?.textContent?.trim() || '';
        // Fallback to h1 or h2 if position title not found
        if (!title) {
            title = document.querySelector('h2')?.textContent?.trim() || document.querySelector('h1')?.textContent?.trim() || '';
        }
        company = 'Microsoft';
        location = document.querySelector('.position-location-12ZUO, [class*="position-location"], .fieldValue-3kEar')?.textContent?.trim() || '';
    }
    // Greenhouse
    else if (host.includes('greenhouse.io')) {
        title = document.querySelector('.job-title, h1, .app-title')?.textContent?.trim() || '';
        company = document.querySelector('.company-name, .company')?.textContent?.trim() || '';
        location = document.querySelector('.location, [class*="location"]')?.textContent?.trim() || '';
    }
    // Lever
    else if (host.includes('lever.co')) {
        title = document.querySelector('.posting-headline h2, h2')?.textContent?.trim() || '';
        company = document.querySelector('.posting-categories .sort-by-team, .main-header-logo img')?.getAttribute('alt') || '';
        location = document.querySelector('.posting-categories .sort-by-location, .location')?.textContent?.trim() || '';
    }
    // Workday (used by many companies)
    else if (host.includes('workday.com') || host.includes('myworkdayjobs.com')) {
        title = document.querySelector('h1, [data-automation-id="jobPostingHeader"], .css-1q2dra3')?.textContent?.trim() || '';
        company = document.querySelector('[data-automation-id="company"], .css-1saizt3')?.textContent?.trim() || '';
        location = document.querySelector('[data-automation-id="locations"], .css-129m7dg')?.textContent?.trim() || '';
    }
    // Amazon Jobs
    else if (host.includes('amazon.jobs') || host.includes('amazon.com')) {
        title = document.querySelector('.job-title, h1.title, h1')?.textContent?.trim() || '';
        company = 'Amazon';
        location = document.querySelector('.location-icon + span, .job-location, [class*="location"]')?.textContent?.trim() || '';
    }
    // Google Careers
    else if (host.includes('google.com/about/careers') || host.includes('careers.google.com')) {
        title = document.querySelector('h1, .gc-card__title')?.textContent?.trim() || '';
        company = 'Google';
        location = document.querySelector('.gc-job-detail__location, [class*="location"]')?.textContent?.trim() || '';
    }
    // Generic fallback - try multiple patterns
    else {
        // Try h1 first, but filter out generic page titles
        const h1 = document.querySelector('h1');
        if (h1) {
            const h1Text = h1.textContent?.trim() || '';
            // Only use h1 if it looks like a job title (not too long, not generic)
            if (h1Text.length < 100 && !h1Text.toLowerCase().includes('careers') && !h1Text.toLowerCase().includes('jobs at')) {
                title = h1Text;
            }
        }
        if (!title) {
            title = document.querySelector('.job-title, [class*="jobTitle"], [class*="job-title"], [data-testid*="title"]')?.textContent?.trim() || '';
        }
        company = document.querySelector('.company-name, [class*="company"], [class*="employer"], [data-testid*="company"]')?.textContent?.trim() || '';
        location = document.querySelector('.location, [class*="location"], [data-testid*="location"]')?.textContent?.trim() || '';
    }

    console.log('CareerFit: Extracted job info from DOM:', { title, company, location });
    return { title, company, location };
}

// --- Extract job info from JSON-LD structured data ---
function extractFromJsonLd() {
    let title = '';
    let company = '';
    let location = '';

    try {
        const scripts = document.querySelectorAll('script[type="application/ld+json"]');
        for (const script of scripts) {
            const data = JSON.parse(script.textContent);

            // Handle both single object and array of objects
            const items = Array.isArray(data) ? data : [data];

            for (const item of items) {
                if (item['@type'] === 'JobPosting') {
                    title = item.title || '';
                    company = item.hiringOrganization?.name || '';

                    // Location can be object or array
                    if (item.jobLocation) {
                        const loc = Array.isArray(item.jobLocation) ? item.jobLocation[0] : item.jobLocation;
                        if (loc.address) {
                            const addr = loc.address;
                            location = [addr.addressLocality, addr.addressRegion].filter(Boolean).join(', ');
                        } else if (typeof loc === 'string') {
                            location = loc;
                        }
                    }

                    if (title) break;
                }
            }
            if (title) break;
        }
    } catch (e) {
        console.log('CareerFit: Error parsing JSON-LD:', e);
    }

    return { title, company, location };
}

// --- Helper function for score colors ---
function getScoreColor(score) {
    if (score >= 4) return '#3d8b6e'; // dark green
    if (score >= 3) return '#c9a050'; // orange/gold
    return '#4a4a4a'; // grey
}

// ============================================================
// PHASE 6: Apply Workflow Features
// ============================================================

// --- 6.1: Job History Storage ---
async function saveJobToHistory(job) {
    const { jobHistory = [] } = await safeStorageGet(['jobHistory']);

    // Create a unique ID for the job based on title + company + link
    const jobId = btoa(`${job.title}|${job.company}|${job.link}`).slice(0, 32);

    // Check if job already exists
    const existingIndex = jobHistory.findIndex(j => j.id === jobId);

    const jobRecord = {
        id: jobId,
        title: job.title,
        company: job.company,
        location: job.location || '',
        link: job.link,
        score: job.score || null,
        analysis: job.analysis || null,
        summary: job.summary || null, // From Summarize Role
        status: job.status || 'scanned', // scanned, interested, applied, rejected, interview
        scannedAt: job.scannedAt || new Date().toISOString(),
        appliedAt: job.appliedAt || null,
        notes: job.notes || '',
        source: window.location.hostname
    };

    if (existingIndex >= 0) {
        // Update existing job, preserving some fields
        jobHistory[existingIndex] = {
            ...jobHistory[existingIndex],
            ...jobRecord,
            scannedAt: jobHistory[existingIndex].scannedAt, // Keep original scan date
        };
    } else {
        // Add new job at the beginning
        jobHistory.unshift(jobRecord);
    }

    // Limit history to 500 jobs to avoid storage limits
    if (jobHistory.length > 500) {
        jobHistory.splice(500);
    }

    await safeStorageSet({ jobHistory });
    console.log('CareerFit: Saved job to history:', jobRecord.title);

    // Also save to Firebase (async, don't wait)
    chrome.runtime.sendMessage({ type: 'saveJobToCloud', job: jobRecord });

    return jobRecord;
}

// --- 6.1b: Skills to Learn Storage ---
async function saveSkillToLearn(skillData) {
    const { skillsToLearn = [] } = await safeStorageGet(['skillsToLearn']);

    // Check if skill already exists
    const existingIndex = skillsToLearn.findIndex(s => s.skill.toLowerCase() === skillData.skill.toLowerCase());

    const skillRecord = {
        skill: skillData.skill,
        resources: skillData.resources || '',
        keywords: skillData.keywords || [],
        savedAt: new Date().toISOString(),
        learned: false
    };

    if (existingIndex >= 0) {
        // Update existing - merge keywords
        const existing = skillsToLearn[existingIndex];
        const mergedKeywords = [...new Set([...(existing.keywords || []), ...(skillRecord.keywords || [])])];
        skillsToLearn[existingIndex] = {
            ...existing,
            resources: skillRecord.resources || existing.resources,
            keywords: mergedKeywords
        };
    } else {
        // Add new skill at beginning
        skillsToLearn.unshift(skillRecord);
    }

    // Limit to 100 skills
    if (skillsToLearn.length > 100) {
        skillsToLearn.splice(100);
    }

    await safeStorageSet({ skillsToLearn });
    console.log('CareerFit: Saved skill to learn:', skillRecord.skill);
    return skillRecord;
}

async function toggleSkillLearned(skillName) {
    const { skillsToLearn = [] } = await safeStorageGet(['skillsToLearn']);
    const skillIndex = skillsToLearn.findIndex(s => s.skill === skillName);

    if (skillIndex >= 0) {
        skillsToLearn[skillIndex].learned = !skillsToLearn[skillIndex].learned;
        await safeStorageSet({ skillsToLearn });
    }
    return skillsToLearn;
}

async function removeSkillToLearn(skillName) {
    const { skillsToLearn = [] } = await safeStorageGet(['skillsToLearn']);
    const filtered = skillsToLearn.filter(s => s.skill !== skillName);
    await safeStorageSet({ skillsToLearn: filtered });
    return filtered;
}

async function updateJobStatus(jobId, status, notes = null) {
    const { jobHistory = [] } = await safeStorageGet(['jobHistory']);
    const jobIndex = jobHistory.findIndex(j => j.id === jobId);

    if (jobIndex >= 0) {
        jobHistory[jobIndex].status = status;
        if (status === 'applied') {
            jobHistory[jobIndex].appliedAt = new Date().toISOString();
        }
        if (status === 'interested') {
            jobHistory[jobIndex].interestedAt = new Date().toISOString();
        }
        if (notes !== null) {
            jobHistory[jobIndex].notes = notes;
        }
        await safeStorageSet({ jobHistory });
        console.log('CareerFit: Updated job status:', jobHistory[jobIndex].title, '->', status);

        // Also update in Firebase (async, don't wait)
        chrome.runtime.sendMessage({
            type: 'updateJobInCloud',
            jobId: jobId,
            updates: {
                status,
                appliedAt: jobHistory[jobIndex].appliedAt,
                interestedAt: jobHistory[jobIndex].interestedAt,
                notes: jobHistory[jobIndex].notes
            }
        });

        return jobHistory[jobIndex];
    }
    return null;
}

async function getJobHistory(filter = 'all') {
    const { jobHistory = [] } = await safeStorageGet(['jobHistory']);

    if (filter === 'all') return jobHistory;
    return jobHistory.filter(j => j.status === filter);
}

// --- 6.3: View History Modal ---
async function showJobHistory() {
    showLoading('Loading job history...');

    let jobHistory = await getJobHistory();
    const { skillsToLearn = [] } = await safeStorageGet(['skillsToLearn']);

    // Sort by fit score (highest first), jobs without score at the end
    jobHistory = [...jobHistory].sort((a, b) => {
        const scoreA = a.score || 0;
        const scoreB = b.score || 0;
        if (scoreA === scoreB) {
            return new Date(b.scannedAt) - new Date(a.scannedAt);
        }
        return scoreB - scoreA;
    });

    // Group jobs and skills
    const interestedJobs = jobHistory.filter(j => j.status === 'interested');
    const appliedJobs = jobHistory.filter(j => j.status === 'applied');
    const pendingSkills = skillsToLearn.filter(s => !s.learned);
    const learnedSkills = skillsToLearn.filter(s => s.learned);

    const modalContent = document.getElementById('assess-modal-content');
    modalContent.innerHTML = `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 12px; line-height: 1.35;">
            <!-- Tab buttons - 5 tabs (11px, black/grey) -->
            <div style="display: flex; gap: 0; margin-bottom: 12px; border-bottom: 1px solid #e0ddd0;">
                <button id="tab-all-jobs" class="history-tab active" style="flex: 1; padding: 6px 4px; border: none; border-bottom: 2px solid #3d8b6e; background: transparent; color: #222; cursor: pointer; font-size: 11px; font-weight: 600;">All (${jobHistory.length})</button>
                <button id="tab-interested" class="history-tab" style="flex: 1; padding: 6px 4px; border: none; border-bottom: 2px solid transparent; background: transparent; color: #666; cursor: pointer; font-size: 11px; font-weight: 600;">Interested (${interestedJobs.length})</button>
                <button id="tab-applied" class="history-tab" style="flex: 1; padding: 6px 4px; border: none; border-bottom: 2px solid transparent; background: transparent; color: #666; cursor: pointer; font-size: 11px; font-weight: 600;">Applied (${appliedJobs.length})</button>
                <button id="tab-skills" class="history-tab" style="flex: 1; padding: 6px 4px; border: none; border-bottom: 2px solid transparent; background: transparent; color: #666; cursor: pointer; font-size: 11px; font-weight: 600;">To Learn (${pendingSkills.length})</button>
                <button id="tab-learned" class="history-tab" style="flex: 1; padding: 6px 4px; border: none; border-bottom: 2px solid transparent; background: transparent; color: #666; cursor: pointer; font-size: 11px; font-weight: 600;">Learned (${learnedSkills.length})</button>
            </div>

            <!-- All Jobs Panel -->
            <div id="panel-all-jobs">
                ${jobHistory.length === 0 ? `
                    <p style="color: #666; text-align: center; padding: 20px;">
                        No jobs in history yet.<br>
                        <small>Scan some jobs to start building your history!</small>
                    </p>
                ` : `
                    <div id="history-list" style="max-height: 320px; overflow-y: auto;">
                        ${renderHistoryList(jobHistory)}
                    </div>
                    <div style="margin-top: 10px; text-align: center;">
                        <button id="clear-history-btn" style="padding: 5px 10px; background: #4a4a4a; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 10px;">Clear History</button>
                    </div>
                `}
            </div>

            <!-- Interested Jobs Panel -->
            <div id="panel-interested" style="display: none;">
                ${interestedJobs.length === 0 ? `
                    <p style="color: #666; text-align: center; padding: 20px;">
                        No interested jobs yet.<br>
                        <small>Mark jobs as "Interested" to prepare for applying.</small>
                    </p>
                ` : `
                    <div id="interested-list" style="max-height: 320px; overflow-y: auto;">
                        ${renderHistoryList(interestedJobs)}
                    </div>
                `}
            </div>

            <!-- Applied Jobs Panel -->
            <div id="panel-applied" style="display: none;">
                ${appliedJobs.length === 0 ? `
                    <p style="color: #666; text-align: center; padding: 20px;">
                        No applied jobs yet.<br>
                        <small>Mark jobs as "Applied" to track them here.</small>
                    </p>
                ` : `
                    <div id="applied-list" style="max-height: 320px; overflow-y: auto;">
                        ${renderHistoryList(appliedJobs)}
                    </div>
                `}
            </div>

            <!-- Skills to Learn Panel -->
            <div id="panel-skills" style="display: none;">
                ${renderPendingSkillsList(pendingSkills)}
            </div>

            <!-- Learned Skills Panel -->
            <div id="panel-learned" style="display: none;">
                ${renderLearnedSkillsList(learnedSkills)}
            </div>
        </div>
    `;

    // Tab switching helper
    function setActiveTab(activeTabId, activePanelId) {
        // Reset all tabs - grey inactive
        ['tab-all-jobs', 'tab-interested', 'tab-applied', 'tab-skills', 'tab-learned'].forEach(id => {
            const tab = document.getElementById(id);
            if (tab) {
                tab.style.borderBottomColor = 'transparent';
                tab.style.color = '#666';
            }
        });
        // Hide all panels
        ['panel-all-jobs', 'panel-interested', 'panel-applied', 'panel-skills', 'panel-learned'].forEach(id => {
            const panel = document.getElementById(id);
            if (panel) panel.style.display = 'none';
        });
        // Activate selected - black text, green underline
        const activeTab = document.getElementById(activeTabId);
        const activePanel = document.getElementById(activePanelId);
        if (activeTab) {
            activeTab.style.borderBottomColor = '#3d8b6e';
            activeTab.style.color = '#222';
        }
        if (activePanel) activePanel.style.display = 'block';
    }

    // Tab click handlers
    document.getElementById('tab-all-jobs').addEventListener('click', () => {
        setActiveTab('tab-all-jobs', 'panel-all-jobs');
        attachHistoryListeners();
    });

    document.getElementById('tab-interested').addEventListener('click', () => {
        setActiveTab('tab-interested', 'panel-interested');
        attachHistoryListeners();
    });

    document.getElementById('tab-applied').addEventListener('click', () => {
        setActiveTab('tab-applied', 'panel-applied');
        attachHistoryListeners();
    });

    document.getElementById('tab-skills').addEventListener('click', () => {
        setActiveTab('tab-skills', 'panel-skills');
        attachSkillsListeners();
    });

    document.getElementById('tab-learned').addEventListener('click', () => {
        setActiveTab('tab-learned', 'panel-learned');
        attachSkillsListeners();
    });

    // Add clear history handler
    document.getElementById('clear-history-btn')?.addEventListener('click', async () => {
        if (confirm('Are you sure you want to clear all job history? This cannot be undone.')) {
            await safeStorageSet({ jobHistory: [] });
            showJobHistory();
        }
    });

    // Attach listeners for job actions
    attachHistoryListeners();
}

function renderHistoryList(jobs) {
    if (jobs.length === 0) {
        return '<p style="color: #888; text-align: center; padding: 12px; font-size: 12px;">No jobs match this filter.</p>';
    }

    // Option B: Green + Cream Hybrid (Tighter) styling
    return jobs.map(job => {
        const statusColors = {
            applied: '#3d8b6e',    // dark green
            interested: '#c9a050', // orange
            scanned: '#9DC3B5'    // calming green
        };
        const statusColor = statusColors[job.status] || '#9DC3B5';

        // Get title - try multiple sources
        const jobTitle = job.title || job.analysis?.jobTitle || job.summary?.title || 'Untitled Job';
        const jobCompany = job.company || job.analysis?.company || 'Unknown Company';

        // Score badge (circular) or summary tag
        let scoreBadge = '';
        let infoTag = '';
        if (job.score) {
            const scoreColor = getScoreColor(job.score);
            scoreBadge = `<div style="width: 28px; height: 28px; border-radius: 50%; background: ${scoreColor}; display: flex; align-items: center; justify-content: center; flex-shrink: 0;"><span style="color: white; font-size: 14px; font-weight: 700;">${job.score}</span></div>`;
        }
        if (job.summary) {
            // Show years/type from summary with creamy tag style
            const summaryInfo = [];
            if (job.summary.yearsRequired && job.summary.yearsRequired !== 'Not specified') {
                summaryInfo.push(job.summary.yearsRequired);
            }
            if (job.summary.managerType) {
                summaryInfo.push(job.summary.managerType);
            }
            if (summaryInfo.length > 0) {
                infoTag = `<span style="background: #F5F3E7; color: #2d6b52; padding: 2px 8px; border-radius: 10px; font-size: 10px; font-weight: 600; border: 1px solid #e0ddd0; margin-left: 6px;">${summaryInfo.join(' · ')}</span>`;
            }
        }

        // Shorter date format
        const date = job.appliedAt || job.interestedAt ? new Date(job.appliedAt || job.interestedAt) : new Date(job.scannedAt);
        const dateStr = `${date.getMonth() + 1}/${date.getDate()}`;
        const statusLabels = { applied: 'Applied', interested: 'Interested', scanned: 'Scanned' };
        const dateDisplay = `${statusLabels[job.status] || 'Scanned'} ${dateStr}`;

        return `
            <div class="history-job-item" data-job-id="${job.id}" style="padding: 8px; margin: 4px 0; background: #fdfcf8; border-radius: 5px; border-left: 3px solid ${statusColor}; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
                <div style="display: flex; align-items: center; gap: 8px;">
                    ${scoreBadge}
                    <div style="flex: 1;">
                        <div style="display: flex; align-items: center; flex-wrap: wrap;">
                            <strong style="font-size: 12px; color: #222;">${jobTitle}</strong>${infoTag}
                        </div>
                        <div style="color: #222; font-size: 12px;">${jobCompany}</div>
                        <div style="color: #4a4a4a; font-size: 10px; margin-top: 2px;">${dateDisplay}</div>
                    </div>
                </div>
                <div style="margin-top: 6px; display: flex; gap: 4px; flex-wrap: wrap;">
                    <select class="job-status-select" data-job-id="${job.id}" style="padding: 3px 6px; border: 1px solid #e0ddd0; border-radius: 4px; font-size: 10px; background: #F5F3E7; color: #2d6b52;">
                        <option value="scanned" ${job.status === 'scanned' || !job.status ? 'selected' : ''}>Scanned</option>
                        <option value="interested" ${job.status === 'interested' ? 'selected' : ''}>Interested</option>
                        <option value="applied" ${job.status === 'applied' ? 'selected' : ''}>Applied</option>
                    </select>
                    <a href="${job.link}" target="_blank" style="padding: 3px 8px; background: #3d8b6e; color: white; border-radius: 4px; font-size: 10px; text-decoration: none; font-weight: 500;">View</a>
                    <button class="match-bullets-btn" data-job-id="${job.id}" style="padding: 3px 8px; background: #c9a050; color: white; border: none; border-radius: 4px; font-size: 10px; cursor: pointer; font-weight: 500;">Match</button>
                </div>
            </div>
        `;
    }).join('');
}

function attachHistoryListeners() {
    // Status change handlers
    document.querySelectorAll('.job-status-select').forEach(select => {
        select.addEventListener('change', async (e) => {
            const jobId = e.target.dataset.jobId;
            const newStatus = e.target.value;
            await updateJobStatus(jobId, newStatus);

            // Visual feedback - Option B colors
            const item = e.target.closest('.history-job-item');
            const statusColors = {
                applied: '#3d8b6e',
                interested: '#c9a050',
                scanned: '#9DC3B5'
            };
            item.style.borderLeftColor = statusColors[newStatus] || '#9DC3B5';

            // Trigger Resume Bullet Matching when marked as Interested
            if (newStatus === 'interested') {
                const { jobHistory = [] } = await safeStorageGet(['jobHistory']);
                const job = jobHistory.find(j => j.id === jobId);
                if (job) {
                    showBulletMatching(job);
                }
            }
        });
    });

    // Match bullets handlers
    document.querySelectorAll('.match-bullets-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            const jobId = e.target.dataset.jobId;
            const { jobHistory = [] } = await safeStorageGet(['jobHistory']);
            const job = jobHistory.find(j => j.id === jobId);
            if (job) {
                showBulletMatching(job);
            }
        });
    });
}

// --- 6.3b: Skills to Learn List ---
function renderPendingSkillsList(skills) {
    if (skills.length === 0) {
        return `
            <p style="color: #666; text-align: center; padding: 20px;">
                No skills to learn yet.<br>
                <small style="color: #888;">Click + on skill gaps in Assess results to save them here.</small>
            </p>
        `;
    }

    let html = `<div style="max-height: 320px; overflow-y: auto;">`;
    skills.forEach(skill => {
        html += renderSkillCard(skill, false);
    });
    html += `</div>`;

    html += `
        <div style="margin-top: 10px; text-align: center;">
            <button id="clear-pending-skills-btn" style="padding: 5px 10px; background: #4a4a4a; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 10px;">Clear To Learn</button>
        </div>
    `;

    return html;
}

function renderLearnedSkillsList(skills) {
    if (skills.length === 0) {
        return `
            <p style="color: #666; text-align: center; padding: 20px;">
                No learned skills yet.<br>
                <small style="color: #888;">Mark skills as learned to track your progress!</small>
            </p>
        `;
    }

    let html = `<div style="max-height: 320px; overflow-y: auto;">`;
    skills.forEach(skill => {
        html += renderSkillCard(skill, true);
    });
    html += `</div>`;

    html += `
        <div style="margin-top: 10px; text-align: center;">
            <button id="clear-learned-skills-btn" style="padding: 5px 10px; background: #4a4a4a; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 10px;">Clear Learned</button>
        </div>
    `;

    return html;
}

function renderSkillCard(skill, isLearned) {
    // Option B styling - use calming green for learned, healing yellow for pending
    const bgColor = isLearned ? '#fdfcf8' : '#fdfcf8';
    const borderColor = isLearned ? '#9DC3B5' : '#F0D58C';
    const textDecor = isLearned ? 'line-through' : 'none';
    const textColor = isLearned ? '#888' : '#333';

    return `
        <div class="skill-card" data-skill="${skill.skill.replace(/"/g, '&quot;')}" style="background: ${bgColor}; border-radius: 5px; padding: 8px; margin-bottom: 6px; border-left: 3px solid ${borderColor}; position: relative;">
            <div style="display: flex; justify-content: space-between; align-items: start;">
                <div style="flex: 1;">
                    <div style="font-size: 12px; font-weight: 600; color: ${textColor}; text-decoration: ${textDecor};">${skill.skill}</div>
                    ${skill.resources ? `<div style="font-size: 10px; color: #666; margin-top: 2px;">${skill.resources}</div>` : ''}
                    ${skill.keywords && skill.keywords.length > 0 ? `
                        <div style="margin-top: 4px;">
                            ${skill.keywords.map(kw => `<span style="background: #e8f5f1; color: #2d6b52; padding: 1px 5px; border-radius: 4px; font-size: 9px; margin-right: 2px;">${kw}</span>`).join('')}
                        </div>
                    ` : ''}
                </div>
                <div style="display: flex; gap: 4px;">
                    <button class="toggle-learned-btn" data-skill="${skill.skill.replace(/"/g, '&quot;')}" style="width: 22px; height: 22px; border-radius: 50%; border: 1px solid ${isLearned ? '#3d8b6e' : '#d0e8e0'}; background: ${isLearned ? '#3d8b6e' : '#e8f5f1'}; color: ${isLearned ? 'white' : '#3d8b6e'}; font-size: 12px; cursor: pointer; display: flex; align-items: center; justify-content: center; padding: 0;" title="${isLearned ? 'Mark as not learned' : 'Mark as learned'}">✓</button>
                    <button class="remove-skill-btn" data-skill="${skill.skill.replace(/"/g, '&quot;')}" style="width: 22px; height: 22px; border-radius: 50%; border: 1px solid #e0ddd0; background: #F5F3E7; color: #4a4a4a; font-size: 12px; cursor: pointer; display: flex; align-items: center; justify-content: center; padding: 0;" title="Remove">×</button>
                </div>
            </div>
        </div>
    `;
}

function attachSkillsListeners() {
    // Toggle learned status
    document.querySelectorAll('.toggle-learned-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            const skillName = e.target.dataset.skill;
            await toggleSkillLearned(skillName);
            // Refresh both skills panels
            const { skillsToLearn = [] } = await safeStorageGet(['skillsToLearn']);
            const pending = skillsToLearn.filter(s => !s.learned);
            const learned = skillsToLearn.filter(s => s.learned);
            document.getElementById('panel-skills').innerHTML = renderPendingSkillsList(pending);
            document.getElementById('panel-learned').innerHTML = renderLearnedSkillsList(learned);
            // Update tab counts
            document.getElementById('tab-skills').textContent = `To Learn (${pending.length})`;
            document.getElementById('tab-learned').textContent = `Learned (${learned.length})`;
            attachSkillsListeners();
        });
    });

    // Remove skill
    document.querySelectorAll('.remove-skill-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            const skillName = e.target.dataset.skill;
            await removeSkillToLearn(skillName);
            // Refresh both skills panels
            const { skillsToLearn = [] } = await safeStorageGet(['skillsToLearn']);
            const pending = skillsToLearn.filter(s => !s.learned);
            const learned = skillsToLearn.filter(s => s.learned);
            document.getElementById('panel-skills').innerHTML = renderPendingSkillsList(pending);
            document.getElementById('panel-learned').innerHTML = renderLearnedSkillsList(learned);
            // Update tab counts
            document.getElementById('tab-skills').textContent = `To Learn (${pending.length})`;
            document.getElementById('tab-learned').textContent = `Learned (${learned.length})`;
            attachSkillsListeners();
        });
    });

    // Clear pending skills
    document.getElementById('clear-pending-skills-btn')?.addEventListener('click', async () => {
        if (confirm('Are you sure you want to clear all skills to learn?')) {
            const { skillsToLearn = [] } = await safeStorageGet(['skillsToLearn']);
            const learnedOnly = skillsToLearn.filter(s => s.learned);
            await safeStorageSet({ skillsToLearn: learnedOnly });
            document.getElementById('panel-skills').innerHTML = renderPendingSkillsList([]);
            document.getElementById('tab-skills').textContent = `To Learn (0)`;
        }
    });

    // Clear learned skills
    document.getElementById('clear-learned-skills-btn')?.addEventListener('click', async () => {
        if (confirm('Are you sure you want to clear all learned skills?')) {
            const { skillsToLearn = [] } = await safeStorageGet(['skillsToLearn']);
            const pendingOnly = skillsToLearn.filter(s => !s.learned);
            await safeStorageSet({ skillsToLearn: pendingOnly });
            document.getElementById('panel-learned').innerHTML = renderLearnedSkillsList([]);
            document.getElementById('tab-learned').textContent = `Learned (0)`;
        }
    });
}

// --- 6.4: Resume Bullet Matching ---
async function showBulletMatching(job) {
    showLoading('Analyzing which resume bullets match this job...');

    try {
        const response = await chrome.runtime.sendMessage({
            type: 'matchBullets',
            job: {
                title: job.title,
                company: job.company,
                link: job.link
            }
        });

        if (response && response.success) {
            displayBulletMatches(job, response.data);
        } else {
            showError(response?.error || 'Failed to analyze bullet matches');
        }
    } catch (error) {
        console.error('CareerFit: Error matching bullets:', error);
        showError('Failed to analyze bullet matches: ' + error.message);
    }
}

function displayBulletMatches(job, matchData) {
    const modalContent = document.getElementById('assess-modal-content');

    const strongMatches = matchData.matches?.filter(m => m.strength === 'strong') || [];
    const moderateMatches = matchData.matches?.filter(m => m.strength === 'moderate') || [];
    const suggestions = matchData.suggestions || [];

    modalContent.innerHTML = `
        <div style="font-size: 13px; font-weight: 600; color: #222; margin-bottom: 4px;">Resume Match: ${job.title}</div>
        <div style="color: #666; font-size: 12px; margin-bottom: 12px;">${job.company}</div>

        ${strongMatches.length > 0 ? `
            <div style="font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; color: #3d8b6e; margin-bottom: 6px; font-weight: 600;">Strong Matches (${strongMatches.length})</div>
            <ul style="margin: 0 0 12px 0; padding-left: 18px; font-size: 12px;">
                ${strongMatches.map(m => `
                    <li style="margin: 6px 0; color: #333;">
                        "${m.bullet}"
                        <br><span style="color: #3d8b6e; font-size: 11px;">→ ${m.reason}</span>
                    </li>
                `).join('')}
            </ul>
        ` : ''}

        ${moderateMatches.length > 0 ? `
            <div style="font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; color: #c9a050; margin-bottom: 6px; font-weight: 600;">Moderate Matches (${moderateMatches.length})</div>
            <ul style="margin: 0 0 12px 0; padding-left: 18px; font-size: 12px;">
                ${moderateMatches.map(m => `
                    <li style="margin: 6px 0; color: #333;">
                        "${m.bullet}"
                        <br><span style="color: #c9a050; font-size: 11px;">→ ${m.reason}</span>
                    </li>
                `).join('')}
            </ul>
        ` : ''}

        ${strongMatches.length === 0 && moderateMatches.length === 0 ? `
            <p style="color: #4a4a4a; font-style: italic; font-size: 12px;">No strong matches found between your resume and this job.</p>
        ` : ''}

        ${suggestions.length > 0 ? `
            <div style="font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; color: #4a4a4a; margin: 12px 0 6px 0; font-weight: 600;">Suggestions</div>
            <ul style="margin: 0; padding-left: 18px; font-size: 12px; color: #666;">
                ${suggestions.map(s => `<li style="margin: 4px 0;">${s}</li>`).join('')}
            </ul>
        ` : ''}

        <div style="margin-top: 15px; display: flex; gap: 8px;">
            <button id="back-to-history" style="flex: 1; padding: 8px; background: #F5F3E7; color: #2d6b52; border: 1px solid #e0ddd0; border-radius: 6px; cursor: pointer; font-size: 12px; font-weight: 600;">← Back</button>
            <a href="${job.link}" target="_blank" style="flex: 1; padding: 8px; background: #3d8b6e; color: white; border: none; border-radius: 6px; cursor: pointer; font-size: 12px; text-decoration: none; text-align: center; font-weight: 600;">View Job</a>
        </div>
    `;

    document.getElementById('back-to-history').addEventListener('click', () => {
        showJobHistory();
    });
}

// --- 6. Handle History button click ---
document.getElementById('history-btn').addEventListener('click', () => {
    modal.style.display = 'block';
    showJobHistory();
});

console.log('CareerFit: Phase 6 - Apply Workflow Features loaded');

// ============================================================
// PHASE 8: Application Auto-Fill (Workday, Greenhouse, Lever)
// ============================================================

// Question patterns mapped to autofill field keys
const QUESTION_PATTERNS = {
    // Work Authorization
    authUSA: [
        /authorized.*work.*u\.?s|legally.*work.*united states|eligible.*work.*us|work authorization/i,
        /are you.*authorized|do you have.*authorization|can you.*legally work/i,
        /authorized to work for any employer/i
    ],
    sponsorship: [
        /require.*sponsor|need.*sponsor|visa sponsor|sponsorship.*require|immigration.*sponsor/i,
        /will you.*require|do you.*need.*visa|require.*visa/i,
        /will you now or in the future require/i
    ],
    over18: [
        /at least 18|18 years.*age|over 18|are you 18/i
    ],

    // Experience
    yearsExp: [
        /years.*experience|experience.*years|how many years|total.*experience/i
    ],
    currentTitle: [
        /current.*title|job title|position.*title|your title/i
    ],
    currentCompany: [
        /current.*company|current.*employer|where.*work|employer.*name/i
    ],

    // Personal Info
    fullName: [
        /full name|your name|legal name|first.*last.*name/i,
        /^name$/i
    ],
    firstName: [
        /first name|given name/i
    ],
    lastName: [
        /last name|surname|family name/i
    ],
    email: [
        /email|e-mail/i
    ],
    phone: [
        /phone|telephone|mobile|cell/i
    ],
    linkedIn: [
        /linkedin|linked in/i
    ],

    // Location
    city: [
        /^city$|your city|current city/i
    ],
    state: [
        /^state$|province|region/i
    ],
    zipCode: [
        /zip|postal code|postcode/i
    ],
    willingRelocate: [
        /relocat|willing.*move|open.*relocation/i
    ],

    // Diversity
    gender: [
        /gender|sex/i,
        /select your gender/i,
        /please select.*gender/i
    ],
    ethnicity: [
        /ethnic|race|racial/i,
        /select.*ethnicity/i,
        /please select.*ethnicity/i,
        /which.*accurately describes.*identify/i
    ],
    hispanic: [
        /hispanic.*latino|latino.*hispanic|identify as hispanic/i,
        /do you identify as hispanic/i
    ],
    veteran: [
        /veteran|military|armed forces|served.*military/i,
        /select.*veteran/i,
        /please select.*veteran/i
    ],
    disability: [
        /disab|handicap/i,
        /please check one of the boxes below/i,
        /voluntary self-identification/i,
        /self identify/i
    ],
    termsConsent: [
        /terms and conditions|consent.*terms|read and consent/i,
        /i've read and consent/i,
        /information provided is true/i
    ],

    // Common form fields
    fullNameField: [
        /^name\*?$/i,
        /your name\*?/i,
        /^name$/i
    ],
    dateField: [
        /^date\*?$/i,
        /today.*date/i,
        /^date$/i
    ],
    employeeId: [
        /employee id/i
    ]
};

// Yes/No value mappings for different sites
const YES_NO_VALUES = {
    yes: ['yes', 'true', '1', 'y', 'Yes', 'YES', 'True', 'TRUE'],
    no: ['no', 'false', '0', 'n', 'No', 'NO', 'False', 'FALSE']
};

// Check if we're on a Workday application page
function isWorkdayPage() {
    const host = window.location.hostname;
    return host.includes('workday.com') || host.includes('myworkdayjobs.com');
}

// Check if we're on a Greenhouse application page
function isGreenhousePage() {
    const host = window.location.hostname;
    return host.includes('greenhouse.io') || document.querySelector('form[action*="greenhouse"]');
}

// Check if we're on a Lever application page
function isLeverPage() {
    const host = window.location.hostname;
    return host.includes('lever.co') || host.includes('jobs.lever.co');
}

function isApplicationPage() {
    return isWorkdayPage() || isGreenhousePage() || isLeverPage();
}

// Match a question/label text to an autofill field
function matchQuestionToField(labelText) {
    const cleanLabel = labelText.toLowerCase().trim();

    for (const [fieldKey, patterns] of Object.entries(QUESTION_PATTERNS)) {
        for (const pattern of patterns) {
            if (pattern.test(cleanLabel)) {
                return fieldKey;
            }
        }
    }
    return null;
}

// Get the value to fill based on field type
function getAutofillValue(fieldKey, answers) {
    // Handle name splitting
    if (fieldKey === 'firstName' && answers.fullName) {
        return answers.fullName.split(' ')[0] || '';
    }
    if (fieldKey === 'lastName' && answers.fullName) {
        const parts = answers.fullName.split(' ');
        return parts.slice(1).join(' ') || '';
    }
    // Handle fullNameField (from "Name*" label)
    if (fieldKey === 'fullNameField' && answers.fullName) {
        return answers.fullName;
    }
    // Handle date field - return today's date in MM/DD/YYYY format
    if (fieldKey === 'dateField') {
        const today = new Date();
        const month = String(today.getMonth() + 1).padStart(2, '0');
        const day = String(today.getDate()).padStart(2, '0');
        return `${month}/${day}/${today.getFullYear()}`;
    }
    // "Are you at least 18?" - always yes
    if (fieldKey === 'over18') {
        return 'yes';
    }
    // Terms and conditions - always yes/consent
    if (fieldKey === 'termsConsent') {
        return 'yes';
    }
    // Employee ID - skip (no response)
    if (fieldKey === 'employeeId') {
        return '';
    }

    return answers[fieldKey] || '';
}

// Fill a text input
function fillTextInput(input, value) {
    if (!value || !input) return false;

    // Trigger focus
    input.focus();

    // Set value using multiple methods for React/Angular compatibility
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
    if (nativeInputValueSetter) {
        nativeInputValueSetter.call(input, value);
    } else {
        input.value = value;
    }

    // Trigger events
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    input.dispatchEvent(new Event('blur', { bubbles: true }));

    return true;
}

// Fill a select dropdown
function fillSelect(select, value) {
    if (!value || !select) return false;

    const valueLower = value.toLowerCase();
    const options = Array.from(select.options);

    // Try to find matching option
    let matchedOption = null;

    // For yes/no questions
    if (YES_NO_VALUES.yes.includes(value)) {
        matchedOption = options.find(opt =>
            YES_NO_VALUES.yes.some(v => opt.value.toLowerCase() === v.toLowerCase() || opt.text.toLowerCase() === v.toLowerCase())
        );
    } else if (YES_NO_VALUES.no.includes(value)) {
        matchedOption = options.find(opt =>
            YES_NO_VALUES.no.some(v => opt.value.toLowerCase() === v.toLowerCase() || opt.text.toLowerCase() === v.toLowerCase())
        );
    }

    // Try text/value match
    if (!matchedOption) {
        matchedOption = options.find(opt =>
            opt.value.toLowerCase().includes(valueLower) ||
            opt.text.toLowerCase().includes(valueLower)
        );
    }

    if (matchedOption) {
        select.value = matchedOption.value;
        select.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
    }

    return false;
}

// Fill a radio button group
function fillRadio(radioGroup, value, fieldKey = null) {
    if (!value || !radioGroup.length) return false;

    const valueLower = value.toLowerCase();

    for (const radio of radioGroup) {
        const label = radio.closest('label')?.textContent?.toLowerCase() ||
                      document.querySelector(`label[for="${radio.id}"]`)?.textContent?.toLowerCase() ||
                      radio.value.toLowerCase();

        // Special handling for disability field with specific text patterns
        if (fieldKey === 'disability') {
            if (value === 'yes' && label.includes('yes, i have a disability')) {
                radio.click();
                return true;
            }
            if (value === 'no' && label.includes('no, i do not have a disability')) {
                radio.click();
                return true;
            }
            if (value === '' && label.includes('do not want to answer')) {
                radio.click();
                return true;
            }
        }

        // Special handling for veteran field with specific text patterns
        if (fieldKey === 'veteran') {
            if (value === 'yes' && (label.includes('i am a veteran') || label.includes('protected veteran'))) {
                radio.click();
                return true;
            }
            if (value === 'no' && label.includes('i am not a veteran')) {
                radio.click();
                return true;
            }
        }

        // Check for yes/no
        if (YES_NO_VALUES.yes.includes(value) && YES_NO_VALUES.yes.some(v => label.includes(v.toLowerCase()))) {
            radio.click();
            return true;
        }
        if (YES_NO_VALUES.no.includes(value) && YES_NO_VALUES.no.some(v => label.includes(v.toLowerCase()))) {
            radio.click();
            return true;
        }

        // Check for direct match
        if (label.includes(valueLower)) {
            radio.click();
            return true;
        }
    }

    return false;
}

// Find form fields and their labels
function findFormFields() {
    const fields = [];

    // Strategy 1: Find inputs with associated labels
    document.querySelectorAll('label').forEach(label => {
        const labelText = label.textContent?.trim();
        if (!labelText) return;

        // Find input by for attribute
        let input = null;
        if (label.htmlFor) {
            input = document.getElementById(label.htmlFor);
        }
        // Find input inside label
        if (!input) {
            input = label.querySelector('input, select, textarea');
        }
        // Find next sibling input
        if (!input) {
            input = label.parentElement?.querySelector('input, select, textarea');
        }

        if (input && !input.disabled && !input.readOnly) {
            fields.push({ label: labelText, input });
        }
    });

    // Strategy 2: Find inputs with placeholder or aria-label
    document.querySelectorAll('input, select, textarea').forEach(input => {
        if (input.disabled || input.readOnly) return;

        const labelText = input.placeholder || input.getAttribute('aria-label') || input.name;
        if (labelText && !fields.find(f => f.input === input)) {
            fields.push({ label: labelText, input });
        }
    });

    // Strategy 3: Workday-specific selectors
    if (isWorkdayPage()) {
        document.querySelectorAll('[data-automation-id]').forEach(el => {
            const automationId = el.getAttribute('data-automation-id');
            const labelEl = el.querySelector('[data-automation-id$="Label"]');
            const inputEl = el.querySelector('input, select, textarea');

            if (labelEl && inputEl && !inputEl.disabled) {
                fields.push({ label: labelEl.textContent?.trim() || automationId, input: inputEl });
            }
        });
    }

    return fields;
}

// Main auto-fill function
async function runAutoFill() {
    console.log('CareerFit: Running auto-fill...');

    // Get saved answers
    const { autofillAnswers = {} } = await safeStorageGet(['autofillAnswers']);

    if (Object.keys(autofillAnswers).length === 0) {
        alert('CareerFit: No auto-fill answers saved. Please configure them in the extension options.');
        return { filled: 0, total: 0 };
    }

    const fields = findFormFields();
    console.log('CareerFit: Found', fields.length, 'form fields');

    let filledCount = 0;
    const filledFields = [];

    for (const { label, input } of fields) {
        const fieldKey = matchQuestionToField(label);
        if (!fieldKey) continue;

        const value = getAutofillValue(fieldKey, autofillAnswers);
        if (!value) continue;

        let filled = false;

        if (input.tagName === 'SELECT') {
            filled = fillSelect(input, value);
        } else if (input.type === 'radio') {
            // Find all radios with same name
            const radioGroup = document.querySelectorAll(`input[name="${input.name}"]`);
            filled = fillRadio(radioGroup, value, fieldKey);
        } else if (input.type === 'checkbox') {
            // For checkboxes, check if value is "yes"
            if (value === 'yes' && !input.checked) {
                input.click();
                filled = true;
            }
        } else {
            filled = fillTextInput(input, value);
        }

        if (filled) {
            filledCount++;
            filledFields.push(label);
            console.log('CareerFit: Filled', label, '→', fieldKey);
        }
    }

    console.log('CareerFit: Auto-fill complete.', filledCount, 'fields filled');
    return { filled: filledCount, total: fields.length, filledFields };
}

// --- 7. Handle Auto-fill button click ---
document.getElementById('autofill-btn').addEventListener('click', async () => {
    const autoFillBtn = document.getElementById('autofill-btn');
    autoFillBtn.disabled = true;
    autoFillBtn.textContent = 'Filling...';

    const result = await runAutoFill();

    autoFillBtn.disabled = false;
    autoFillBtn.textContent = 'Auto-fill';

    // Show result in modal
    modal.style.display = 'block';
    const modalContent = document.getElementById('assess-modal-content');

    if (result.filled > 0) {
        modalContent.innerHTML = `
            <div style="font-size: 13px; font-weight: 600; color: #3d8b6e; margin-bottom: 8px;">Auto-Fill Complete!</div>
            <p style="font-size: 12px; color: #333;">
                Filled <strong>${result.filled}</strong> field${result.filled > 1 ? 's' : ''}.
            </p>
            ${result.filledFields?.length > 0 ? `
                <div style="background: #fdfcf8; padding: 10px; border-radius: 6px; margin-top: 10px; max-height: 200px; overflow-y: auto; border: 1px solid #e0ddd0;">
                    <div style="font-size: 11px; color: #888; margin-bottom: 8px;">Fields filled:</div>
                    ${result.filledFields.map(f => `<div style="font-size: 12px; color: #333; margin: 4px 0;">✓ ${f}</div>`).join('')}
                </div>
            ` : ''}
            <p style="font-size: 11px; color: #888; margin-top: 12px;">
                Please review the filled values before submitting.
            </p>
        `;
    } else {
        modalContent.innerHTML = `
            <div style="font-size: 13px; font-weight: 600; color: #c9a050; margin-bottom: 8px;">No Fields Filled</div>
            <p style="font-size: 12px; color: #666;">
                Could not match any form fields to your saved answers.
            </p>
            <p style="font-size: 11px; color: #888; margin-top: 10px;">
                Tips:<br>
                • Make sure you've saved auto-fill answers in extension options<br>
                • The form may use custom field names not yet supported
            </p>
        `;
    }
});

console.log('CareerFit: Phase 8 - Application Auto-Fill loaded');
