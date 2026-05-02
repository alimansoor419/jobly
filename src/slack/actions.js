import session from '../session/store.js';
import { sendEmail } from '../email/gmail.js';
import fs from 'fs';

export default function registerActions(app) {
  // Handle "Apply" button
  app.action('action_apply', async ({ ack, body, action, client }) => {
    await ack();
    const userId = action.value;
    console.log(`[ACTIONS] action_apply clicked by user=${userId} thread=${body.container.thread_ts}`);
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
      console.log(`[ACTIONS] sending email to ${applyEmail} filename=${cv_filename}`);
      
      let pdfBuffer = null;
      if (pdfPath && fs.existsSync(pdfPath)) {
        pdfBuffer = fs.readFileSync(pdfPath);
      }

      await sendEmail(applyEmail, subject, emailBody, pdfBuffer, cv_filename);

      console.log('[ACTIONS] email send succeeded');
      await client.chat.postEphemeral({
        channel: body.channel.id,
        user: userId,
        thread_ts: body.container.thread_ts,
        text: `Email sent to ${applyEmail}. Good luck!`
      });
    } catch (error) {
      console.error("Action apply error:", error);
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
          console.log('[ACTIONS] removed temp pdf', sessionData.pdfPath);
        }
      } catch (e) {
        console.warn('[ACTIONS] error removing pdf:', e.message);
      }
      session.delete(userId);
    }
  });

  // Handle "Leave" button
  app.action('action_leave', async ({ ack, body, action, client }) => {
    await ack();
    const userId = action.value;
    console.log(`[ACTIONS] action_leave clicked by user=${userId} thread=${body.container.thread_ts}`);
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
}
