# CareerFit AI - Browser Extension

A Chrome browser extension that helps LinkedIn users automatically assess job fit against their resume using Google's Gemini AI.

## ✨ Features

- **AI-Powered Job Analysis**: Uses Gemini 2.5 Flash with structured JSON output for consistent, reliable assessments
- **Color-Coded Fit Scores**: Visual feedback with green (excellent), orange (good), and red (poor) fit indicators
- **Interactive Modal Interface**: Clean, dismissible modal with animated loading states
- **Secure Storage**: API keys and resume data stored securely in Chrome sync storage
- **Modern UI**: LinkedIn-integrated floating button with hover effects and smooth animations

## 🏗️ Architecture

### User Flow
1. **Setup**: Install extension → Right-click icon → Options → Enter Gemini API key and resume
2. **Usage**: Visit LinkedIn job page → Click "Assess My Fit" button → View color-coded analysis in modal
3. **Results**: See fit score (1-5), reasoning, strengths, and improvement areas with close button to dismiss

### Technical Stack
- **Frontend**: Vanilla JavaScript, CSS3 animations, Chrome Extension APIs
- **AI Integration**: Google GenAI SDK with Zod schema validation for structured responses
- **Build System**: Webpack 5 with Babel for ES6+ transpilation and dependency bundling
- **Storage**: Chrome sync storage for cross-device settings persistence

## 📁 Project Structure

```
career-fit/
├── src/                    # Source files
│   ├── background.js       # Service worker with Gemini AI integration
│   ├── content.js          # LinkedIn page interaction and UI injection
│   └── options.js          # Settings page functionality
├── dist/                   # Webpack build output (auto-generated)
├── manifest.json           # Extension configuration
├── options.html            # Settings page UI
├── styles.css              # Modal and button styling with animations
├── careerfit.png          # Extension icon
├── package.json            # Dependencies and build scripts
├── webpack.config.js       # Build configuration
└── .gitignore             # Git ignore rules
```

## 🛠️ Development Setup

### Prerequisites
- Node.js 16+
- Chrome browser
- Gemini API key from Google AI Studio

### Installation
```bash
# Clone and install dependencies
npm install

# Build the extension
npm run build

# Development mode (auto-rebuild on changes)
npm run dev
```

### Loading in Chrome
1. Open `chrome://extensions/`
2. Enable "Developer mode"
3. Click "Load unpacked"
4. Select the project directory
5. Configure API key and resume in extension options

## 🔧 Technical Implementation

### Manifest v3 Configuration
```json
{
  "manifest_version": 3,
  "name": "CareerFit AI - Assess My Fit",
  "version": "1.1",
  "permissions": ["storage", "activeTab", "scripting"],
  "host_permissions": ["https://www.linkedin.com/*"],
  "background": {"service_worker": "dist/background.js"},
  "content_scripts": [{
    "matches": ["https://www.linkedin.com/jobs/*"],
    "js": ["dist/content.js"],
    "css": ["styles.css"]
  }]
}
```

### AI Integration Details
- **Model**: Gemini 2.5 Flash for fast, structured responses
- **Schema Validation**: Zod schemas ensure consistent JSON output format
- **Error Handling**: Robust fallbacks for malformed responses and API failures
- **Response Format**: Structured data with fitScore (1-5), reasoning, strengths array, gaps array

### Content Script Features
- **LinkedIn Integration**: Targets `.jobs-search__job-details` container for job data extraction
- **Dynamic UI**: Floating button and modal injected without conflicting with LinkedIn's interface
- **Loading States**: Animated spinner with progress messaging during AI analysis
- **Close Functionality**: Dismissible modal with intuitive close button

### Styling & UX
- **Modern Design**: Clean modal with subtle shadows and rounded corners
- **Responsive Layout**: Adapts to different screen sizes with fixed positioning
- **Color Psychology**: Traffic light system (red/orange/green) for quick fit assessment
- **Smooth Animations**: CSS transitions for button hover states and loading indicators

## 🚀 Build Process

### Webpack Configuration
- **Entry Points**: Separate bundles for background, content, and options scripts
- **Babel Integration**: ES6+ transpilation for broad browser compatibility
- **Dependency Bundling**: @google/genai and Zod packaged for extension environment
- **Development Mode**: Source maps and watch mode for efficient debugging

### Dependencies
```json
{
  "dependencies": {
    "@google/genai": "^0.3.1",
    "zod": "^3.22.4",
    "zod-to-json-schema": "^3.22.4"
  },
  "devDependencies": {
    "webpack": "^5.89.0",
    "webpack-cli": "^5.1.4",
    "@babel/core": "^7.23.0",
    "@babel/preset-env": "^7.23.0",
    "babel-loader": "^9.1.3"
  }
}
```

## 🐛 Debugging & Troubleshooting

### Chrome Extension DevTools
- **Service Worker Console**: `chrome://extensions/` → "service worker" link
- **Content Script Console**: Right-click page → Inspect → Console tab  
- **Error Logs**: Check Extensions page for red "Errors" button

### Common Issues
- **Inactive Service Worker**: Usually webpack bundle compatibility issues
- **API Errors**: Check API key validity and quota limits
- **Modal Not Appearing**: Verify LinkedIn URL patterns and content script injection
- **Undefined Properties**: Enhanced error handling now provides fallback values

### Logging
Comprehensive console logging throughout for debugging:
- Extension loading and initialization
- API request/response cycles
- Data validation and error states
- User interaction tracking

## 🔐 Security & Privacy

- **Local Storage Only**: No data sent to external servers except Gemini API
- **API Key Security**: Stored in Chrome's secure sync storage
- **Content Isolation**: Extension runs in isolated context from LinkedIn
- **Minimal Permissions**: Only requests necessary LinkedIn access permissions

## 📝 Future Enhancements

- Support for additional job sites (Indeed, Glassdoor, etc.)
- Resume optimization suggestions based on job requirements
- Job tracking and comparison features
- Export functionality for analysis results
- Multi-language support for international users