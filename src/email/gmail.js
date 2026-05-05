import { google } from 'googleapis';
import dotenv from 'dotenv';
import logger from '../utils/logger.js';

dotenv.config();

const {
  GMAIL_CLIENT_ID,
  GMAIL_CLIENT_SECRET,
  GMAIL_REFRESH_TOKEN,
  GMAIL_SENDER_ADDRESS
} = process.env;

const oauth2Client = new google.auth.OAuth2(
  GMAIL_CLIENT_ID,
  GMAIL_CLIENT_SECRET,
  'https://developers.google.com/oauthplayground'
);

oauth2Client.setCredentials({
  refresh_token: GMAIL_REFRESH_TOKEN
});

const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

export async function sendEmail(to, subject, body, pdfBuffer, pdfFilename) {
  try {
    // sanitize `to` field: Slack may pass mailto-formatted strings like
    // "<mailto:one@ex.com|one><mailto:two@ex.com|two@ex.com>" — extract valid emails
    const extractEmails = (input) => {
      if (!input) return [];
      // find email-like substrings
      const re = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
      const matches = input.match(re);
      return matches || [];
    };

    const recipients = extractEmails(to);
    if (!recipients.length) {
      logger.error('email.invalid_to', { to });
      throw new Error('Invalid To header: no valid email addresses found');
    }
    const toHeader = recipients.join(', ');
    logger.info('email.send_attempt', { to: toHeader, subject_len: subject ? subject.length : 0, attach: !!pdfBuffer });
    const utf8Subject = `=?utf-8?B?${Buffer.from(subject).toString('base64')}?=`;
    const boundary = "BOUNDARY_" + Date.now().toString(16);
    const altBoundary = `ALT_${Date.now().toString(16)}`;

    // simple HTML escape
    const escapeHtml = (s = '') => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    // convert plaintext paragraphs into <p>..</p>
    const htmlParagraphs = (body || '')
      .split(/\r?\n\r?\n/)
      .map(p => `<p>${escapeHtml(p).replace(/\r?\n/g, '<br/>')}</p>`)
      .join('\n');

      const senderName    = process.env.GMAIL_SENDER_NAME  ?? 'Mansoor Ali';
const senderTitle   = process.env.GMAIL_SENDER_TITLE ?? 'Backend Engineer & AI Developer';
const senderPhone   = process.env.GMAIL_SENDER_PHONE ?? '+92 318 433 4464';
const avatarInitials = senderName.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();

const htmlBody = `<!doctype html>
<html><head><meta charset="utf-8"><style>
  body { margin:0; padding:0; background:#f4f4f4; font-family:Calibri,Arial,Helvetica,sans-serif; font-size:14px; color:#111; }
  .wrap { max-width:600px; margin:28px auto; background:#fff; border:1px solid #e0e0e0; border-radius:8px; overflow:hidden; }
  .header { padding:20px 28px 16px; display:flex; align-items:center; gap:14px; border-bottom:1px solid #ebebeb; }
  .avatar { width:42px; height:42px; border-radius:50%; background:#e8f0fe; 
            text-align:center; line-height:42px;
            font-weight:600; font-size:15px; color:#185FA5; flex-shrink:0; font-family:Arial,sans-serif; }
  .sender-info { margin-left:12px; }
  .sender-name { margin:0; font-size:15px; font-weight:600; color:#111; }
  .sender-role { margin:3px 0 0; font-size:12px; color:#888; }
  .body { padding:22px 28px; line-height:1.75; color:#222; }
  .body p { margin:0 0 13px; text-align:justify; }
  .body p:last-child { margin:0; }
  .footer { padding:14px 28px 20px; border-top:1px solid #ebebeb; display:flex; justify-content:space-between; align-items:flex-end; }
  .sig-name { margin:0; font-weight:600; font-size:13px; color:#111; }
  .sig-role { margin:3px 0 0; font-size:12px; color:#888; }
  .sig-contact { font-size:12px; color:#aaa; text-align:right; line-height:1.7; }
</style></head>
<body>
  <div class="wrap">
        <div class="header">
      <div class="avatar">${avatarInitials}</div>
      <div class="sender-info">
        <p class="sender-name">${escapeHtml(senderName)}</p>
        <p class="sender-role">${escapeHtml(senderTitle)}</p>
      </div>
    </div>
    </div>
    <div class="body">${htmlParagraphs}</div>
    <div class="footer">
      <div>
        <p class="sig-name">${escapeHtml(senderName)}</p>
        <p class="sig-role">${escapeHtml(senderTitle)}</p>
      </div>
      <div class="sig-contact">
        ${escapeHtml(GMAIL_SENDER_ADDRESS)}<br/>
        ${escapeHtml(senderPhone)}
      </div>
    </div>
  </div>
</body></html>`;

    let messageParts = [
      `From: ${GMAIL_SENDER_ADDRESS}`,
      `To: ${toHeader}`,
      `Subject: ${utf8Subject}`,
      'MIME-Version: 1.0',
      `Content-Type: multipart/mixed; boundary="${boundary}"`,
      '',
      `--${boundary}`,
      `Content-Type: multipart/alternative; boundary="${altBoundary}"`,
      '',
      `--${altBoundary}`,
      'Content-Type: text/plain; charset="UTF-8"',
      '',
      body || '',
      '',
      `--${altBoundary}`,
      'Content-Type: text/html; charset="UTF-8"',
      '',
      htmlBody,
      '',
      `--${altBoundary}--`,
      ''
    ];

    if (pdfBuffer && pdfFilename) {
      messageParts = messageParts.concat([
        `--${boundary}`,
        `Content-Type: application/pdf; name="${pdfFilename}"`,
        'Content-Transfer-Encoding: base64',
        `Content-Disposition: attachment; filename="${pdfFilename}"`,
        '',
        pdfBuffer.toString('base64'),
        ''
      ]);
    }

    messageParts.push(`--${boundary}--`);
    
    const message = messageParts.join('\r\n');

    // The body needs to be base64url encoded
    const encodedMessage = Buffer.from(message)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    const res = await gmail.users.messages.send({
      userId: 'me',
      requestBody: {
        raw: encodedMessage,
      },
    });
    logger.info('email.sent', { to: toHeader, id: res.data.id });
    return res.data;
  } catch (error) {
    logger.error('email.error', { error: error?.message || error });
    throw error;
  }
}
