import parseMessage from '../utils/parseMessage.js';
import { runAgent } from '../ai/agent.js';
import { postConfirmation } from './confirmation.js';
import { buildCvPdf } from '../utils/cv_builder.js';
import fs from 'fs';
import dotenv from 'dotenv';

dotenv.config();

const { SLACK_WORKFLOW_CHANNEL_ID, MY_SLACK_USER_ID } = process.env;

export default function registerTrigger(app) {
  app.message(async ({ message, client }) => {
    console.log(`[TRIGGER] incoming message ts=${message?.ts} user=${message?.user} channel=${message?.channel}`);
    try {
      // Ignore bot messages and messages from other channels
      if (message.bot_id !== undefined) {
        console.log('[TRIGGER] ignoring message from bot');
        return;
      }
      if (message.channel !== SLACK_WORKFLOW_CHANNEL_ID) {
        console.log(`[TRIGGER] ignoring message from channel ${message.channel}`);
        return;
      }

      // Filter to only messages from MY_SLACK_USER_ID
      if (message.user !== MY_SLACK_USER_ID) {
        return;
      }

      const { text, channel, ts } = message;

      let payload;
      try {
        payload = parseMessage(text);
      } catch (err) {
        await client.chat.postMessage({
          channel: channel,
          thread_ts: ts,
          text: "Invalid format. Send: {\"job-description\":\"...\",\"apply-at-email\":\"...\"}"
        });
        return;
      }

      // Let user know AI is thinking
      await client.chat.postEphemeral({
        channel: channel,
        user: message.user,
        thread_ts: ts,
        text: "Analyzing job description and tailoring your CV... This may take a moment."
      });

      // Call AI agent
      console.log('[TRIGGER] calling AI agent for job description length', (payload.jobDescription || '').length);
      const aiResult = await runAgent(payload.jobDescription);
      console.log('[TRIGGER] AI agent returned result');

      // Add apply-at-email to the result for later use
      aiResult.applyEmail = payload.applyEmail;

      // Step A - Build the PDF
      console.log('[TRIGGER] building CV PDF:', aiResult.cv_filename);
      const pdfPath = await buildCvPdf(aiResult.cv_html, aiResult.cv_filename);
      console.log('[TRIGGER] built CV PDF at', pdfPath);

      // Step B - Upload the PDF to Slack before posting the approval message
      const uploadRes = await client.files.uploadV2({
        channel_id: channel,
        thread_ts: ts, // optionally post the upload to the thread
        filename: aiResult.cv_filename,
        file: fs.createReadStream(pdfPath),
        initial_comment: '📄 CV preview for your review:',
      });
      console.log('[TRIGGER] file upload response:', uploadRes?.file?.id || uploadRes?.file_id || 'unknown');

      // Post confirmation with buttons
      await postConfirmation(client, channel, ts, message.user, aiResult, pdfPath);

    } catch (error) {
      console.error("Trigger module error:", error);
      await client.chat.postMessage({
        channel: message.channel,
        thread_ts: message.ts,
        text: `Error processing request: ${error.message}`
      });
    }
  });
}
