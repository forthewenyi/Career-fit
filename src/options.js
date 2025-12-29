const saveButton = document.getElementById('saveBtn');
const analyzeButton = document.getElementById('analyzeResumeBtn');
const saveFiltersBtn = document.getElementById('saveFiltersBtn');
const apiKeyInput = document.getElementById('apiKey');
const resumeInput = document.getElementById('resume');
const statusDiv = document.getElementById('status');

// Load saved settings when the page opens
document.addEventListener('DOMContentLoaded', () => {
    // Load API key and resume from sync storage
    chrome.storage.sync.get(['geminiApiKey', 'userResume'], (data) => {
        if (data.geminiApiKey) {
            apiKeyInput.value = data.geminiApiKey;
        }
        if (data.userResume) {
            resumeInput.value = data.userResume;
        }
    });

    // Load existing profile from local storage
    chrome.storage.local.get(['candidateProfile', 'hardFilters'], (data) => {
        if (data.candidateProfile) {
            displayProfile(data.candidateProfile);
        }
        if (data.hardFilters) {
            loadFilters(data.hardFilters);
        }
    });
});

// Save settings when the button is clicked
saveButton.addEventListener('click', () => {
    const apiKey = apiKeyInput.value;
    const resume = resumeInput.value;

    if (!apiKey || !resume) {
        showStatus('Please fill out both fields.', 'error');
        return;
    }

    chrome.storage.sync.set({
        geminiApiKey: apiKey,
        userResume: resume
    }, () => {
        showStatus('Settings saved successfully!', 'success');
    });
});

// Analyze Resume button click
analyzeButton.addEventListener('click', () => {
    // First save the current values
    const apiKey = apiKeyInput.value;
    const resume = resumeInput.value;

    if (!apiKey || !resume) {
        showStatus('Please fill out API key and resume first.', 'error');
        return;
    }

    // Save first, then analyze
    chrome.storage.sync.set({
        geminiApiKey: apiKey,
        userResume: resume
    }, () => {
        // Now analyze
        showStatus('Analyzing your resume...', 'loading');
        analyzeButton.disabled = true;

        chrome.runtime.sendMessage({ type: 'analyzeResume' }, (response) => {
            analyzeButton.disabled = false;

            if (chrome.runtime.lastError) {
                showStatus('Error: ' + chrome.runtime.lastError.message, 'error');
                return;
            }

            if (response && response.success) {
                showStatus('Profile extracted successfully!', 'success');
                displayProfile(response.data);
            } else {
                showStatus('Error: ' + (response?.error || 'Unknown error'), 'error');
            }
        });
    });
});

// Helper to show status messages
function showStatus(message, type) {
    statusDiv.textContent = message;
    statusDiv.className = '';
    if (type === 'success') {
        statusDiv.classList.add('status-success');
    } else if (type === 'error') {
        statusDiv.classList.add('status-error');
    } else if (type === 'loading') {
        statusDiv.classList.add('status-loading');
    }

    // Auto-clear success messages
    if (type === 'success') {
        setTimeout(() => { statusDiv.textContent = ''; }, 5000);
    }
}

// Display the candidate profile
function displayProfile(profile) {
    const profileDiv = document.getElementById('profileDisplay');
    profileDiv.style.display = 'block';

    // Analyzed timestamp
    if (profile.analyzedAt) {
        const date = new Date(profile.analyzedAt);
        document.getElementById('profileAnalyzedAt').textContent =
            'Analyzed: ' + date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
    }

    // Experience and Level
    document.getElementById('profileYears').textContent = profile.yearsExperience || '?';
    document.getElementById('profileLevel').textContent = profile.seniorityLevel || '?';

    // Education
    if (profile.education) {
        const edu = profile.education;
        const eduText = `${edu.highestDegree || '?'}${edu.field ? ' in ' + edu.field : ''}${edu.schools?.length ? ' (' + edu.schools.join(', ') + ')' : ''}`;
        document.getElementById('profileEducation').textContent = eduText;
    } else {
        document.getElementById('profileEducation').textContent = 'Not specified';
    }

    // Functions (as tags)
    document.getElementById('profileFunctions').innerHTML =
        (profile.functions || []).map(f => `<span class="tag">${f}</span>`).join('');

    // Industries (as tags)
    document.getElementById('profileIndustries').innerHTML =
        (profile.industries || []).map(i => `<span class="tag tag-industry">${i}</span>`).join('');

    // Skills (hard + soft combined)
    const allSkills = [...(profile.hardSkills || []), ...(profile.softSkills || [])];
    document.getElementById('profileSkills').innerHTML =
        allSkills.map(s => `<span class="tag tag-skill">${s}</span>`).join('');

    // Target Titles
    document.getElementById('profileTitles').innerHTML =
        (profile.targetTitles || []).map(t => `<li>${t}</li>`).join('');

    // Search Queries with copy buttons
    document.getElementById('profileQueries').innerHTML =
        (profile.searchQueries || []).map((q, i) => `
            <li style="display: flex; align-items: center; gap: 8px; margin: 6px 0;">
                <code style="flex: 1; word-break: break-word;">${q}</code>
                <button class="copy-query-btn" data-query="${encodeURIComponent(q)}" style="padding: 4px 8px; font-size: 11px; background: #0a66c2; color: white; border: none; border-radius: 4px; cursor: pointer; white-space: nowrap;">Copy</button>
            </li>
        `).join('');

    // Add copy button handlers
    document.querySelectorAll('.copy-query-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            const query = decodeURIComponent(e.target.dataset.query);
            try {
                await navigator.clipboard.writeText(query);
                e.target.textContent = 'Copied!';
                e.target.style.background = '#4caf50';
                setTimeout(() => {
                    e.target.textContent = 'Copy';
                    e.target.style.background = '#0a66c2';
                }, 1500);
            } catch (err) {
                e.target.textContent = 'Failed';
                setTimeout(() => { e.target.textContent = 'Copy'; }, 1500);
            }
        });
    });
}

// --- Hard Filters ---

// Save filters when button clicked
saveFiltersBtn.addEventListener('click', () => {
    const hardFilters = {
        filterYearsEnabled: document.getElementById('filterYears').checked,
        maxYearsRequired: parseInt(document.getElementById('maxYears').value) || 10,
        skipPhD: document.getElementById('filterPhD').checked,
        skipDirectorPlus: document.getElementById('filterDirector').checked,
        skipCertifications: document.getElementById('skipCerts').value
            .split(',')
            .map(s => s.trim())
            .filter(Boolean),
        excludeCompanies: document.getElementById('excludeCompanies').value
            .split(',')
            .map(s => s.trim())
            .filter(Boolean),
    };

    chrome.storage.local.set({ hardFilters }, () => {
        const filterStatus = document.getElementById('filterStatus');
        filterStatus.textContent = 'Filters saved!';
        filterStatus.style.color = '#4caf50';
        setTimeout(() => { filterStatus.textContent = ''; }, 3000);
    });
});

// Load filters into UI
function loadFilters(filters) {
    if (filters.filterYearsEnabled !== undefined) {
        document.getElementById('filterYears').checked = filters.filterYearsEnabled;
    }
    if (filters.maxYearsRequired !== undefined) {
        document.getElementById('maxYears').value = filters.maxYearsRequired;
    }
    if (filters.skipPhD !== undefined) {
        document.getElementById('filterPhD').checked = filters.skipPhD;
    }
    if (filters.skipDirectorPlus !== undefined) {
        document.getElementById('filterDirector').checked = filters.skipDirectorPlus;
    }
    if (filters.skipCertifications?.length) {
        document.getElementById('skipCerts').value = filters.skipCertifications.join(', ');
    }
    if (filters.excludeCompanies?.length) {
        document.getElementById('excludeCompanies').value = filters.excludeCompanies.join(', ');
    }
}
