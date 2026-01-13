const saveButton = document.getElementById('saveBtn');
const analyzeButton = document.getElementById('analyzeResumeBtn');
const saveFiltersBtn = document.getElementById('saveFiltersBtn');
const apiKeyInput = document.getElementById('apiKey');
const resumeInput = document.getElementById('resume');
const statusDiv = document.getElementById('status');

// Load saved settings when the page opens
document.addEventListener('DOMContentLoaded', () => {
    // Load API key and candidate profile from sync storage
    chrome.storage.sync.get(['geminiApiKey', 'candidateProfile'], (syncData) => {
        if (syncData.geminiApiKey) {
            apiKeyInput.value = syncData.geminiApiKey;
        }

        // If we have a synced profile, display it
        if (syncData.candidateProfile) {
            displayProfile(syncData.candidateProfile);
        } else {
            // No sync profile - try loading from Firebase
            loadProfileFromCloud();
        }
    });

    // Load resume and filters from local storage
    chrome.storage.local.get(['userResume', 'hardFilters'], (data) => {
        if (data.userResume) {
            resumeInput.value = data.userResume;
        }
        if (data.hardFilters) {
            loadFilters(data.hardFilters);
        }

        // If no local resume, try loading from Firebase
        if (!data.userResume) {
            loadResumeFromCloud();
        }
    });
});

// Load resume from Firebase cloud
function loadResumeFromCloud() {
    chrome.runtime.sendMessage({ type: 'loadResumeFromCloud' }, (response) => {
        if (response && response.success && response.resume) {
            resumeInput.value = response.resume;
            // Also save to local storage
            chrome.storage.local.set({ userResume: response.resume });
            console.log('CareerFit: Resume loaded from cloud');
        }
    });
}

// Load profile from Firebase cloud
function loadProfileFromCloud() {
    chrome.runtime.sendMessage({ type: 'loadProfileFromCloud' }, (response) => {
        if (response && response.success && response.profile) {
            displayProfile(response.profile);
            // Also save to local storage
            chrome.storage.local.set({ candidateProfile: response.profile });
            console.log('CareerFit: Profile loaded from cloud');
        }
    });
}

// Save settings when the button is clicked
saveButton.addEventListener('click', () => {
    const apiKey = apiKeyInput.value;
    const resume = resumeInput.value;

    if (!apiKey || !resume) {
        showStatus('Please fill out both fields.', 'error');
        return;
    }

    // Save API key to sync (small), resume to local (large)
    chrome.storage.sync.set({ geminiApiKey: apiKey }, () => {
        chrome.storage.local.set({ userResume: resume }, () => {
            showStatus('Settings saved successfully!', 'success');
        });
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

    // Check if resume has changed since last analysis
    chrome.storage.local.get(['userResume', 'candidateProfile', 'lastAnalyzedResumeHash'], (data) => {
        const currentHash = simpleHash(resume);
        const hasExistingProfile = data.candidateProfile && data.candidateProfile.analyzedAt;
        const resumeChanged = data.lastAnalyzedResumeHash !== currentHash;

        // If profile exists and resume hasn't changed, ask user
        if (hasExistingProfile && !resumeChanged) {
            const lastAnalyzed = new Date(data.candidateProfile.analyzedAt).toLocaleDateString();
            if (!confirm(`Your resume was last analyzed on ${lastAnalyzed} and hasn't changed.\n\nRe-analyze anyway? (This uses API tokens)`)) {
                showStatus('Analysis skipped - using cached profile.', 'success');
                return;
            }
        }

        // Proceed with analysis
        chrome.storage.sync.set({ geminiApiKey: apiKey }, () => {
            chrome.storage.local.set({ userResume: resume }, () => {
                // Also save resume to Firebase cloud
                chrome.runtime.sendMessage({ type: 'saveResumeToCloud', resume });

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
                        showStatus('Profile extracted and synced to cloud!', 'success');
                        displayProfile(response.data);

                        // Save the hash of the analyzed resume
                        chrome.storage.local.set({ lastAnalyzedResumeHash: currentHash });

                        // Save profile to Firebase cloud
                        chrome.runtime.sendMessage({ type: 'saveProfileToCloud', profile: response.data });
                    } else {
                        showStatus('Error: ' + (response?.error || 'Unknown error'), 'error');
                    }
                });
            });
        });
    });
});

// Simple hash function to detect resume changes
function simpleHash(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash; // Convert to 32bit integer
    }
    return hash.toString();
}

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

    // Technical Skills (skill + years only)
    const hardSkillsHtml = (profile.hardSkills || []).map(s => {
        // Handle both old format (string) and new format (object with skill, years)
        if (typeof s === 'string') {
            return `<span class="tag tag-skill">${s}</span>`;
        }
        return `<span class="tag tag-skill">${s.skill} <span style="color: var(--cf-orange); font-size: 10px;">(${s.years}y)</span></span>`;
    }).join('');
    document.getElementById('profileHardSkills').innerHTML = hardSkillsHtml || '<span style="color: #888;">No skills data</span>';

    // Soft Skills (simple tags)
    document.getElementById('profileSoftSkills').innerHTML =
        (profile.softSkills || []).map(s => `<span class="tag tag-skill">${s}</span>`).join('') || '<span style="color: #888;">No soft skills</span>';

    // Certifications (simple tags)
    document.getElementById('profileCertifications').innerHTML =
        (profile.certifications || []).map(c => `<span class="tag tag-cert">${c}</span>`).join('') || '<span style="color: #888;">No certifications</span>';
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
        filterStatus.style.color = '#3d8b6e';
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

// --- Firebase Cloud Sync ---

const firebaseConfigInput = document.getElementById('firebaseConfig');
const saveFirebaseBtn = document.getElementById('saveFirebaseBtn');
const syncToCloudBtn = document.getElementById('syncToCloudBtn');
const firebaseStatusSpan = document.getElementById('firebaseStatus');
const firebaseStatusMsg = document.getElementById('firebaseStatusMsg');

// Load Firebase config on page load
document.addEventListener('DOMContentLoaded', () => {
    chrome.storage.sync.get(['firebaseConfig'], (data) => {
        if (data.firebaseConfig) {
            firebaseConfigInput.value = JSON.stringify(data.firebaseConfig, null, 2);
        }
    });

    // Check Firebase connection status
    checkFirebaseStatus();
});

function checkFirebaseStatus() {
    chrome.runtime.sendMessage({ type: 'checkFirebaseStatus' }, (response) => {
        if (response && response.ready) {
            firebaseStatusSpan.textContent = 'Connected';
            firebaseStatusSpan.className = 'firebase-status firebase-connected';
        } else {
            firebaseStatusSpan.textContent = 'Not Connected';
            firebaseStatusSpan.className = 'firebase-status firebase-disconnected';
        }
    });
}

// Save Firebase config
saveFirebaseBtn.addEventListener('click', () => {
    const configText = firebaseConfigInput.value.trim();

    if (!configText) {
        showFirebaseStatus('Please enter your Firebase config.', 'error');
        return;
    }

    let config;
    try {
        config = JSON.parse(configText);
    } catch (e) {
        showFirebaseStatus('Invalid JSON. Please check your config format.', 'error');
        return;
    }

    // Validate required fields
    if (!config.apiKey || !config.projectId) {
        showFirebaseStatus('Config must include apiKey and projectId.', 'error');
        return;
    }

    showFirebaseStatus('Connecting to Firebase...', 'loading');

    chrome.runtime.sendMessage({ type: 'setFirebaseConfig', config }, (response) => {
        if (response && response.success) {
            showFirebaseStatus('Connected to Firebase successfully!', 'success');
            checkFirebaseStatus();
        } else {
            showFirebaseStatus('Failed to connect: ' + (response?.error || 'Unknown error'), 'error');
        }
    });
});

// Sync local history to cloud
syncToCloudBtn.addEventListener('click', async () => {
    showFirebaseStatus('Syncing to cloud...', 'loading');

    // Get local job history
    chrome.storage.local.get(['jobHistory'], (data) => {
        const jobs = data.jobHistory || [];

        if (jobs.length === 0) {
            showFirebaseStatus('No local jobs to sync.', 'error');
            return;
        }

        chrome.runtime.sendMessage({ type: 'syncToCloud', jobs }, (response) => {
            if (response && response.success) {
                showFirebaseStatus(`Synced ${jobs.length} jobs to cloud!`, 'success');
            } else {
                showFirebaseStatus('Sync failed: ' + (response?.error || 'Unknown error'), 'error');
            }
        });
    });
});

function showFirebaseStatus(message, type) {
    firebaseStatusMsg.textContent = message;
    if (type === 'success') {
        firebaseStatusMsg.style.color = '#3d8b6e';
    } else if (type === 'error') {
        firebaseStatusMsg.style.color = '#f44336';
    } else {
        firebaseStatusMsg.style.color = '#ff9800';
    }

    if (type === 'success') {
        setTimeout(() => { firebaseStatusMsg.textContent = ''; }, 5000);
    }
}

// --- Application Auto-Fill ---

const autofillFields = [
    'authUSA', 'sponsorship',
    'fullName', 'email', 'phone', 'linkedIn',
    'city', 'state', 'zipCode', 'willingRelocate',
    'gender', 'ethnicity', 'hispanic', 'veteran', 'disability'
];

// Load autofill data on page load
document.addEventListener('DOMContentLoaded', () => {
    chrome.storage.local.get(['autofillAnswers'], (data) => {
        if (data.autofillAnswers) {
            loadAutofillAnswers(data.autofillAnswers);
        }
    });
});

function loadAutofillAnswers(answers) {
    for (const field of autofillFields) {
        const el = document.getElementById(field);
        if (el && answers[field] !== undefined) {
            el.value = answers[field];
        }
    }
}

// Save autofill data
const saveAutofillBtn = document.getElementById('saveAutofillBtn');
const autofillStatus = document.getElementById('autofillStatus');

saveAutofillBtn.addEventListener('click', () => {
    const autofillAnswers = {};
    for (const field of autofillFields) {
        const el = document.getElementById(field);
        if (el) {
            autofillAnswers[field] = el.value;
        }
    }

    chrome.storage.local.set({ autofillAnswers }, () => {
        autofillStatus.textContent = 'Auto-fill answers saved!';
        autofillStatus.style.color = '#3d8b6e';
        setTimeout(() => { autofillStatus.textContent = ''; }, 3000);
    });
});
