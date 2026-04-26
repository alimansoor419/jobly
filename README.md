# Job Application Automation System

A Node.js backend service that automates job applications by listening to Slack messages, tailoring your CV into a professional PDF using AI (Gemini 2.5), and sending emails with the PDF attached via Gmail OAuth.

## Prerequisites
- Node.js 20+
- A Slack App with Socket Mode enabled
- A Google Cloud Project with Gmail API enabled
- Gemini API Key from Google AI Studio

## Setup Instructions

### 1. Slack App Setup
1. Go to [api.slack.com](https://api.slack.com/apps) and create a new app "From scratch".
2. Enable **Socket Mode** in the "Settings" sidebar.
3. In **App-Level Tokens**, generate a token with the `connections:write` scope (this is your `SLACK_APP_TOKEN`).
4. In **OAuth & Permissions**, add the following Bot Token Scopes:
   - `channels:history`
   - `chat:write`
   - `im:write`
   - `groups:history`
   - `files:write` *(Required to upload the PDF CV)*
5. Install the app to your workspace and copy the **Bot User OAuth Token** (`SLACK_BOT_TOKEN`).
6. Get the **Signing Secret** from the "Basic Information" page (`SLACK_SIGNING_SECRET`).
7. Create a channel named `#workflow` and get its ID:
   - Right-click channel -> View channel details -> Copy Channel ID (`SLACK_WORKFLOW_CHANNEL_ID`).
8. Get your Slack User ID:
   - Click your profile -> More -> Copy member ID (`MY_SLACK_USER_ID`).

### 2. Google AI Studio (Gemini)
1. Get an API key from [Google AI Studio](https://aistudio.google.com/app/apikey).
2. Add it to `.env` as `GEMINI_API_KEY`.

### 3. Gmail API & OAuth2 Setup
1. Create a project in [Google Cloud Console](https://console.cloud.google.com/).
2. Enable the **Gmail API**.
3. Go to **APIs & Services > Credentials** and create **OAuth 2.0 Client IDs** (Web application).
   - Authorized redirect URIs: `https://developers.google.com/oauthplayground`
4. Copy your `GMAIL_CLIENT_ID` and `GMAIL_CLIENT_SECRET`.
5. Use [OAuth2 Playground](https://developers.google.com/oauthplayground):
   - Click the settings icon (cog) and check "Use your own OAuth credentials".
   - Enter your Client ID and Client Secret.
   - Select the Gmail API scope: `https://www.googleapis.com/auth/gmail.send`.
   - Click "Authorize APIs" and sign in.
   - Click "Exchange authorization code for tokens" and copy the **Refresh Token** (`GMAIL_REFRESH_TOKEN`).

### 4. Configuration
1. Copy `.env.example` to `.env`.
2. Fill in all the variables collected in the steps above.

### 5. Adding your CV
Paste your CV as plain text into `data/cv.txt`.

## Running the App
```bash
npm install
npm start
```

## How to Test
1. Go to your `#workflow` channel in Slack.
2. Send a message exactly in this format (everything must be inside the double curly braces):
```text
job-description:{{We're looking for a developer with Node.js and Express experience...}}
email:{{hr@acme.com}}
```
3. The AI will respond in the thread with a draft email, and it will upload a newly generated PDF version of your tailored CV.
4. Click **Apply at the job** to automatically attach the PDF and send the email, or **Leave** to discard.

## Project Structure
- `src/index.js`: App entry point.
- `src/slack/`: Slack event listeners and action handlers.
- `src/ai/`: Gemini API integration for CV tailoring.
- `src/email/`: Gmail API integration.
- `src/session/`: In-memory session management.
- `src/utils/`: Message parsing and Puppeteer PDF generation (`cv_builder.js`).
- `data/cv.txt`: Your base CV file.
