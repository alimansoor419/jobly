import session from '../session/store.js';
import logger from '../utils/logger.js';

export async function postConfirmation(client, channel, threadTs, userId, aiResult, pdfPath) {
  try {
    // Store result and pdfPath in session
    aiResult.pdfPath = pdfPath;
    session.set(userId, aiResult);
    logger.info('confirm.stored_session', { userId, threadTs, filename: aiResult.cv_filename });

    const { subject, body, model_used } = aiResult;

    // Truncate text if it exceeds Slack's 3000 character limit for section blocks
    const truncate = (str = '', limit = 2900) => (str.length > limit ? str.substring(0, limit) + "..." : str);

    const blocks = [
      {
        type: "header",
        text: {
          type: "plain_text",
          text: "AI has drafted your application",
          emoji: true
        }
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*Email body:*\n${truncate(body)}`
        }
      },
      {
        type: "divider"
      },
      {
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: `Model used: *${model_used || 'unknown'}*`
          }
        ]
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `📄 *Note:* A PDF version of your tailored CV has been generated and uploaded to this thread above.`
        }
      },
      {
        type: "divider"
      },
      {
        type: "actions",
        elements: [
          {
            type: "button",
            text: {
              type: "plain_text",
              text: "Apply at the job",
              emoji: true
            },
            style: "primary",
            value: userId,
            action_id: "action_apply"
          },
          {
            type: "button",
            text: {
              type: "plain_text",
              text: "Leave",
              emoji: true
            },
            style: "danger",
            value: userId,
            action_id: "action_leave"
          }
        ]
      }
    ];

    await client.chat.postMessage({
      channel: channel,
      thread_ts: threadTs,
      text: "AI has drafted your application",
      blocks: blocks
    });
    logger.info('confirm.posted', { channel, threadTs });
  } catch (error) {
    logger.error('confirm.error', { error: error?.message || error });
    await client.chat.postMessage({
      channel: channel,
      thread_ts: threadTs,
      text: "Failed to post AI results. Please check logs."
    });
  }
}
