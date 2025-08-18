console.log('CareerFit: Content script loaded');
console.log('CareerFit: Current URL:', window.location.href);

// --- 1. Create and inject the button ---
const assessButton = document.createElement('button');
assessButton.id = 'assess-btn';
assessButton.innerText = 'Assess My Fit';
document.body.appendChild(assessButton);

// --- 2. Create the modal (initially hidden) ---
const modal = document.createElement('div');
modal.id = 'assess-modal';
modal.style.display = 'none';
modal.innerHTML = `
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px;">
        <h3 style="margin: 0;">CareerFit AI Assessment</h3>
        <button id="close-modal" style="background: none; border: none; font-size: 20px; cursor: pointer; color: #666;">&times;</button>
    </div>
    <div id="assess-modal-content">
        <p>Click "Assess My Fit" to begin...</p>
    </div>
`;
document.body.appendChild(modal);

// --- 3. Handle close button click ---
document.addEventListener('click', (event) => {
    if (event.target.id === 'close-modal') {
        modal.style.display = 'none';
    }
});

// --- 4. Handle assess button click ---
assessButton.addEventListener('click', () => {
    modal.style.display = 'block';
    const modalContent = document.getElementById('assess-modal-content');
    modalContent.innerHTML = `
        <div style="text-align: center; padding: 20px;">
            <div class="loading-spinner"></div>
            <p style="margin-top: 15px; color: #666;">Analyzing job fit with AI...</p>
            <p style="font-size: 12px; color: #999;">This may take a few seconds</p>
        </div>
    `;

    // Find the job description element on LinkedIn
    const jobDetailsContainer = document.querySelector('.jobs-search__job-details');
    console.log('CareerFit: Job details container found:', !!jobDetailsContainer);
    
    if (jobDetailsContainer) {
        const jobHtml = jobDetailsContainer.innerHTML;
        // Send the HTML to the background script for analysis
        chrome.runtime.sendMessage({ type: 'analyzeJobHtml', html: jobHtml });
    } else {
        modalContent.innerHTML = '<p style="color:red;">Error: Could not find job details on this page.</p>';
    }
});

// --- 5. Listen for results from the background script ---
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'analysisResult') {
        const modalContent = document.getElementById('assess-modal-content');
        modalContent.innerHTML = message.data; // Display the formatted result
    } else if (message.type === 'analysisError') {
        const modalContent = document.getElementById('assess-modal-content');
        modalContent.innerHTML = `<p style="color:red;">${message.error}</p>`;
    }
});