import session from '../session/store.js';
import { sendEmail } from '../email/gmail.js';
import { runAgent } from '../ai/agent.js';
import { postConfirmation } from './confirmation.js';
import { buildCvPdf } from '../utils/cv_builder.js';
import fs from 'fs';
import logger from '../utils/logger.js';

export default function registerActions(app) {
  // Handle "Apply" button
  app.action('action_apply', async ({ ack, body, action, client }) => {
    await ack();
    const userId = action.value;
    logger.info('actions.apply.clicked', { userId, thread: body.container.thread_ts });
    const sessionData = session.get(userId);

    if (!sessionData) {
      await client.chat.postEphemeral({
        channel: body.channel.id,
        user: userId,
        thread_ts: body.container.thread_ts,
        text: "Session expired. Please resubmit."
      });
      return;
    }

    try {
      const { applyEmail, subject, body: emailBody, pdfPath, cv_filename } = sessionData;
      // sanitize applyEmail here so logs show the actual recipients we will use
      const extractEmails = (input) => {
        if (!input) return [];
        const re = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
        const matches = input.match(re);
        return matches || [];
      };
      const recipients = extractEmails(applyEmail);
      const toHeader = recipients.join(', ');
      logger.info('actions.apply.sending_email', { to: toHeader || applyEmail, filename: cv_filename });
      
      let pdfBuffer = null;
      if (pdfPath && fs.existsSync(pdfPath)) {
        pdfBuffer = fs.readFileSync(pdfPath);
      }

      await sendEmail(toHeader || applyEmail, subject, emailBody, pdfBuffer, cv_filename);

      logger.info('actions.apply.email_sent', { to: applyEmail });
      await client.chat.postEphemeral({
        channel: body.channel.id,
        user: userId,
        thread_ts: body.container.thread_ts,
        text: `Email sent to ${applyEmail}. File: ${cv_filename || 'n/a'}. Model used: ${sessionData.model_used || 'unknown'}. Good luck!`
      });
    } catch (error) {
      logger.error('actions.apply.error', { error: error?.message || error });
      await client.chat.postEphemeral({
        channel: body.channel.id,
        user: userId,
        thread_ts: body.container.thread_ts,
        text: `Failed to send email: ${error.message}`
      });
    } finally {
      try {
        if (sessionData && sessionData.pdfPath && fs.existsSync(sessionData.pdfPath)) {
          fs.unlinkSync(sessionData.pdfPath);
          logger.info('actions.clean.removed_pdf', { path: sessionData.pdfPath });
        }
      } catch (e) {
        logger.warn('actions.clean.error_removing_pdf', { error: e?.message || e });
      }
      session.delete(userId);
    }
  });

  // Handle "Leave" button
  app.action('action_leave', async ({ ack, body, action, client }) => {
    await ack();
    const userId = action.value;
    logger.info('actions.leave.clicked', { userId, thread: body.container.thread_ts });
    const sessionData = session.get(userId);

    if (sessionData && sessionData.pdfPath && fs.existsSync(sessionData.pdfPath)) {
      fs.unlinkSync(sessionData.pdfPath);
    }
    
    session.delete(userId);

    await client.chat.postEphemeral({
      channel: body.channel.id,
      user: userId,
      thread_ts: body.container.thread_ts,
      text: "Application discarded."
    });
  });

  // Handle "Recreate CV" button
  app.action('action_recreate', async ({ ack, body, action, client }) => {
    await ack();
    const userId = action.value;
    const channel = body.channel.id;
    const threadTs = body.container.thread_ts;
    logger.info('actions.recreate.clicked', { userId, thread: threadTs });

    const sessionData = session.get(userId);
    if (!sessionData?.jobDescription) {
      await client.chat.postEphemeral({ channel, user: userId, thread_ts: threadTs, text: 'Session expired. Please resubmit the job description.' });
      return;
    }

    // Clean up old PDF
    if (sessionData.pdfPath && fs.existsSync(sessionData.pdfPath)) {
      fs.unlinkSync(sessionData.pdfPath);
    }

    const statusMsg = await client.chat.postMessage({
      channel, thread_ts: threadTs, text: '🔄 Recreating CV using Groq...'
    }).catch(() => null);

    const updateStatus = async (text) => {
      if (!statusMsg?.message?.ts) return;
      await client.chat.update({ channel, ts: statusMsg.message.ts, text }).catch(() => {});
    };

    try {
      const aiResult = await runAgent(sessionData.jobDescription, updateStatus, { groqOnly: true });
      aiResult.applyEmail = sessionData.applyEmail;
      aiResult.jobDescription = sessionData.jobDescription;

      await updateStatus(`✅ CV recreated — used *${aiResult.model_used}*`);

      const pdfPath = await buildCvPdf(aiResult.cv_html, aiResult.cv_filename);

      await client.files.uploadV2({
        channel_id: channel,
        thread_ts: threadTs,
        filename: aiResult.cv_filename,
        file: fs.createReadStream(pdfPath),
        initial_comment: '📄 Recreated CV:'
      });

      await postConfirmation(client, channel, threadTs, userId, aiResult, pdfPath);
      logger.info('actions.recreate.done', { userId, model: aiResult.model_used });

    } catch (err) {
      logger.error('actions.recreate.error', { error: err?.message });
      await updateStatus(`❌ Failed to recreate CV: ${err.message}`);
    }
  });
}
