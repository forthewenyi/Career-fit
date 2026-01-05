# CareerFit AI

A Chrome extension that uses AI to instantly assess how well your resume matches any job posting.

## The Problem

Job hunting is exhausting. You spend hours reading job descriptions, trying to figure out if you're qualified. Should you apply? Is it a stretch? What skills are you missing?

## The Solution

CareerFit AI analyzes job postings against your resume in seconds, giving you:

- **Fit Score (1-5)** - Instantly know if a job is worth your time
- **Gap Analysis** - See exactly what skills you're missing
- **Learning Resources** - Get specific courses/books to close skill gaps
- **Batch Scanning** - Score dozens of jobs at once on search results pages

## Features

| Feature | Description |
|---------|-------------|
| **Summarize** | Extract key requirements (years, IC vs Manager, unique skills) |
| **Assess** | Full AI analysis with fit score, gaps, and learning resources |
| **Scan Jobs** | Batch analyze all jobs on a search results page |
| **History** | Track jobs you've analyzed, sorted by fit score |
| **Apply Workflow** | Mark jobs as Applied, Interview, Rejected, etc. |

## Supported Sites

- LinkedIn Jobs
- Indeed
- Interstride
- Greenhouse job boards
- Lever job boards

## Tech Stack

- **AI**: Google Gemini 2.5 Flash with structured JSON output
- **Frontend**: Vanilla JS, Chrome Extension Manifest V3
- **Build**: Webpack 5, Babel
- **Storage**: Chrome sync/local storage (optional Firebase sync)

## Installation

1. Clone the repo
2. Run `npm install && npm run build`
3. Open `chrome://extensions/` → Enable Developer Mode
4. Click "Load unpacked" → Select the `/build` folder
5. Get a [Gemini API key](https://aistudio.google.com/apikey)
6. Right-click extension icon → Options → Paste API key and resume

## Privacy

- Your resume stays in Chrome's local storage
- Job data is only sent to Google's Gemini API for analysis
- No tracking, no ads, no data collection

## License

MIT
