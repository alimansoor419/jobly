import parseMessage from '../utils/parseMessage.js';
import { runAgent } from '../ai/agent.js';
import { postConfirmation } from './confirmation.js';
import { buildCvPdf } from '../utils/cv_builder.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import logger from '../utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const { SLACK_WORKFLOW_CHANNEL_ID, MY_SLACK_USER_ID } = process.env;

export default function registerTrigger(app) {
  app.message(async ({ message, client }) => {
    logger.info('trigger.hit', { ts: message?.ts, user: message?.user, channel: message?.channel });
    logger.info('trigger.incoming', { ts: message?.ts, user: message?.user, channel: message?.channel });
    try {
      // Ignore bot messages and messages from other channels
      if (message.bot_id !== undefined) {
        logger.info('trigger.ignored', 'ignoring message from bot');
        return;
      }
      if (message.channel !== SLACK_WORKFLOW_CHANNEL_ID) {
        logger.info('trigger.ignored_channel', { channel: message.channel });
        return;
      }

      // Major step log: message received
      logger.info('trigger.received', 'message received - parsing payload');

      // Log first non-empty line of data/cv.txt for traceability
      try {
        const cvPath = path.resolve(__dirname, '../../data/cv.txt');
        if (fs.existsSync(cvPath)) {
          const cvText = fs.readFileSync(cvPath, 'utf-8');
          const firstLine = cvText.split(/\r?\n/).find(l => l && l.trim()) || '';
          logger.info('trigger.cv_first_line', firstLine);
        } else {
          logger.warn('trigger.cv_missing', 'CV file not found at data/cv.txt');
        }
      } catch (e) {
        logger.warn('trigger.cv_read_error', { error: e?.message || e });
      }

      // Filter to only messages from MY_SLACK_USER_ID
      if (message.user !== MY_SLACK_USER_ID) {
        logger.info('trigger.ignored_user', { user: message.user });
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
          text: "Invalid format. First line must be the apply email, followed by the job description."
        });
        return;
      }

      // Post a live status message that gets updated as models are tried
      const statusMsg = await client.chat.postMessage({
        channel,
        thread_ts: ts,
        text: '🤖 Analyzing job description and tailoring your CV...'
      }).catch(() => null);

      const updateStatus = async (text) => {
        if (!statusMsg?.message?.ts) return;
        await client.chat.update({ channel, ts: statusMsg.message.ts, text }).catch(() => {});
      };

      // Call AI agent
      logger.info('trigger.call_ai', { jobDescriptionLength: (payload.jobDescription || '').length });
      const aiResult = await runAgent(payload.jobDescription, updateStatus);
      logger.info('trigger.ai_response', { model_used: aiResult?.model_used || 'unknown' });

      // Update status to show which model succeeded
      await updateStatus(`✅ Done — used *${aiResult.model_used}*`);

      // Add apply-at-email and jobDescription to the result for later use
      aiResult.applyEmail = payload.applyEmail;
      aiResult.jobDescription = payload.jobDescription;

      // Step A - Build the PDF
      logger.info('trigger.build_pdf', { filename: aiResult.cv_filename });
      const pdfPath = await buildCvPdf(aiResult.cv_html, aiResult.cv_filename);
      logger.info('trigger.built_pdf', { path: pdfPath });

      // Step B - Upload the PDF to Slack before posting the approval message
      logger.info('trigger.upload', 'uploading CV to Slack (sending response)');
      const uploadRes = await client.files.uploadV2({
        channel_id: channel,
        thread_ts: ts, // optionally post the upload to the thread
        filename: aiResult.cv_filename,
        file: fs.createReadStream(pdfPath),
        initial_comment: '📄 CV preview for your review:',
      });
      logger.info('trigger.upload_response', { fileId: uploadRes?.file?.id || uploadRes?.file_id || 'unknown' });

      // Post confirmation with buttons
      await postConfirmation(client, channel, ts, message.user, aiResult, pdfPath);
      logger.info('trigger.confirmation_posted', { channel, thread: ts, user: message.user });

    } catch (error) {
      logger.error('trigger.error', { error: error?.message || error });
      await client.chat.postMessage({
        channel: message.channel,
        thread_ts: message.ts,
        text: `Error processing request: ${error.message}`
      });
    }
  });
}
