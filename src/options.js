const saveButton = document.getElementById('saveBtn');
const apiKeyInput = document.getElementById('apiKey');
const resumeInput = document.getElementById('resume');
const statusDiv = document.getElementById('status');

// Load saved settings when the page opens
document.addEventListener('DOMContentLoaded', () => {
    chrome.storage.sync.get(['geminiApiKey', 'userResume'], (data) => {
        if (data.geminiApiKey) {
            apiKeyInput.value = data.geminiApiKey;
        }
        if (data.userResume) {
            resumeInput.value = data.userResume;
        }
    });
});

// Save settings when the button is clicked
saveButton.addEventListener('click', () => {
    const apiKey = apiKeyInput.value;
    const resume = resumeInput.value;

    if (!apiKey || !resume) {
        statusDiv.textContent = 'Please fill out both fields.';
        statusDiv.style.color = 'red';
        return;
    }

    chrome.storage.sync.set({
        geminiApiKey: apiKey,
        userResume: resume
    }, () => {
        statusDiv.textContent = 'Settings saved successfully!';
        statusDiv.style.color = 'green';
        setTimeout(() => { statusDiv.textContent = ''; }, 3000);
    });
});