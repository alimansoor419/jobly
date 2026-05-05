import pkg from '@slack/bolt';
const { App } = pkg;
import dotenv from 'dotenv';
import express from 'express';
import { google } from 'googleapis';
import logger from './utils/logger.js';
import registerTrigger from './slack/trigger.js';
import registerActions from './slack/actions.js';

dotenv.config();

logger.info('startup.system', { NODE_ENV: process.env.NODE_ENV || 'development', PORT: process.env.PORT || 3000 });

const { SLACK_BOT_TOKEN, SLACK_SIGNING_SECRET, SLACK_APP_TOKEN } = process.env;

// Initialize Slack Bolt App
const app = new App({
  token: SLACK_BOT_TOKEN,
  signingSecret: SLACK_SIGNING_SECRET,
  socketMode: true,
  appToken: SLACK_APP_TOKEN,
  port: process.env.PORT || 3000
});

// Initialize Express for potential health checks or future extension
const expressApp = express();
const port = process.env.PORT || 3000;

// Gmail token health check
async function checkGmailToken() {
  const { GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN } = process.env;
  if (!GMAIL_CLIENT_ID || !GMAIL_CLIENT_SECRET || !GMAIL_REFRESH_TOKEN) {
    logger.warn('gmail.health.missing_env', 'Missing Gmail OAuth env vars; skipping token check.');
    return;
  }

  const oauth2 = new google.auth.OAuth2(GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET);
  oauth2.setCredentials({ refresh_token: GMAIL_REFRESH_TOKEN });

  try {
    const res = await oauth2.getAccessToken();
    if (!res || !res.token) {
      logger.error('gmail.health.no_access_token', 'Token exchange did not return an access token. Check refresh token and client credentials.');
    } else {
      logger.info('gmail.health.success', 'Token exchange succeeded.');
    }
  } catch (err) {
    logger.error('gmail.health.failed', err.response?.data || err.message || err);
  }
}

// Register Slack modules
registerTrigger(app);
logger.info('trigger.config', { 
  workflowChannel: process.env.SLACK_WORKFLOW_CHANNEL_ID ?? 'NOT SET',
  myUserId: process.env.MY_SLACK_USER_ID ?? 'NOT SET'
});
registerActions(app);

(async () => {
  try {
    logger.info('startup.gmail_check', 'running Gmail token health check');
    await checkGmailToken();

    logger.info('startup.slack', 'starting Slack Bolt app');
    await app.start();
    logger.info('startup.slack', 'Slack Bolt app running (Socket Mode)');
  } catch (err) {
    logger.error('startup.failed', err?.message || err, { error: err });
    throw err;
  }

  // Start Express for health check (optional but good practice)
  expressApp.get('/health', (req, res) => res.send('OK'));
  expressApp.listen(port, () => {
    logger.info('http.health', `Express health check listening on port ${port}`);
  });

  logger.info('startup.ready', 'Job application automation system running');
})();
