import { google } from 'googleapis';
import dotenv from 'dotenv';

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
    console.log(`[EMAIL] sendEmail to=${to} subject_len=${subject ? subject.length : 0} attach=${!!pdfBuffer}`);
    const utf8Subject = `=?utf-8?B?${Buffer.from(subject).toString('base64')}?=`;
    const boundary = "BOUNDARY_" + Date.now().toString(16);

    let messageParts = [
      `From: ${GMAIL_SENDER_ADDRESS}`,
      `To: ${to}`,
      `Subject: ${utf8Subject}`,
      'MIME-Version: 1.0',
      `Content-Type: multipart/mixed; boundary="${boundary}"`,
      '',
      `--${boundary}`,
      'Content-Type: text/plain; charset="UTF-8"',
      '',
      body,
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
    console.log(`Email sent to ${to}. ID: ${res.data.id}`);
    return res.data;
  } catch (error) {
    console.error('Error sending email:', error);
    throw error;
  }
}
