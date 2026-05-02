import pkg from '@slack/bolt';
const { App } = pkg;
import dotenv from 'dotenv';
import express from 'express';
import registerTrigger from './slack/trigger.js';
import registerActions from './slack/actions.js';

dotenv.config();

console.log(`[STARTUP] NODE_ENV=${process.env.NODE_ENV || 'development'} PORT=${process.env.PORT || 3000}`);

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

// Register Slack modules
registerTrigger(app);
registerActions(app);

(async () => {
  try {
    console.log('[STARTUP] Starting Slack Bolt app...');
    await app.start();
    console.log('⚡️ Slack Bolt app is running with Socket Mode!');
  } catch (err) {
    console.error('[STARTUP] Failed to start Slack Bolt app:', err);
    throw err;
  }

  // Start Express for health check (optional but good practice)
  expressApp.get('/health', (req, res) => res.send('OK'));
  expressApp.listen(port, () => {
    console.log(`📡 Express health check listening on port ${port}`);
  });

  console.log("🚀 Job application automation system running");
})();
