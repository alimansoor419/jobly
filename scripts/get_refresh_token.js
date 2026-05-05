#!/usr/bin/env node
import express from 'express';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { google } from 'googleapis';

// Resolve project root from this script's location, then load .env from project root
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const envPath = path.resolve(__dirname, '..', '.env');
dotenv.config({ path: envPath });

const CLIENT_ID = process.env.GMAIL_CLIENT_ID;
const CLIENT_SECRET = process.env.GMAIL_CLIENT_SECRET;
const PORT = process.env.OAUTH_CALLBACK_PORT || 3000;
const REDIRECT_URI = `http://localhost:${PORT}/oauth2callback`;

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('Please set GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET in your environment (or .env) before running this tool.');
  process.exit(1);
}

const app = express();

app.get('/', (req, res) => {
  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?response_type=code&client_id=${encodeURIComponent(CLIENT_ID)}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&scope=${encodeURIComponent('https://www.googleapis.com/auth/gmail.send')}&access_type=offline&prompt=consent`;
  res.send(`<h3>OAuth Refresh Token Helper</h3><p><a href="${authUrl}">Authorize with Google</a></p><p>Make sure <strong>${REDIRECT_URI}</strong> is registered as an authorized redirect URI for your OAuth client in Google Cloud Console.</p>`);
});

app.get('/oauth2callback', async (req, res) => {
  const code = req.query.code;
  if (!code) return res.status(400).send('Missing code param');

  const oauth2 = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);
  try {
    const { tokens } = await oauth2.getToken(code);
    // Show tokens to user (do not commit these anywhere)
    res.setHeader('Content-Type', 'text/html');
    res.send(`<h3>Tokens</h3><pre>${JSON.stringify(tokens, null, 2)}</pre><p>Copy the <strong>refresh_token</strong> and add it to your environment as <code>GMAIL_REFRESH_TOKEN</code>.</p>`);
    console.log('[OAUTH TOOL] Received tokens:', tokens);
    console.log('Copy the refresh_token value into your .env or Render environment variables as GMAIL_REFRESH_TOKEN');
  } catch (err) {
    console.error('Error exchanging code for tokens:', err.response?.data || err.message || err);
    res.status(500).send('Token exchange failed. Check server logs for details.');
  }
});

app.listen(PORT, () => {
  console.log(`OAuth helper running on http://localhost:${PORT}`);
  console.log(`Open http://localhost:${PORT} and click the authorize link.`);
});

// Usage: node scripts/get_refresh_token.js
