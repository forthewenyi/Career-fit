// Simple test background script to debug service worker
console.log('CareerFit: Background script loading...');

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log('CareerFit: Message received:', message.type);
    
    if (message.type === 'analyzeJobHtml') {
        console.log('CareerFit: Starting analysis...');
        
        chrome.tabs.sendMessage(sender.tab.id, { 
            type: 'analysisResult', 
            data: '<h3>Test Response</h3><p>Background script is working!</p>' 
        });
    }
});

console.log('CareerFit: Background script loaded successfully');