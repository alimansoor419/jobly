export default function parseMessage(text) {
  const lines = text.split(/\r?\n/);

  // Find index of first non-empty line
  const firstLineIndex = lines.findIndex(l => l.trim() !== '');
  if (firstLineIndex === -1) {
    throw new Error('Invalid format. First line must be the apply email, followed by the job description.');
  }

  // Strip Slack auto-linked mailto format: <mailto:email@domain.com|email@domain.com> or [email](mailto:...)
  const rawFirstLine = lines[firstLineIndex]
    .replace(/<mailto:[^|>]+\|([^>]+)>/g, '$1')           // <mailto:x|x> (Slack mrkdwn)
    .replace(/\[([^\]]+)\]\(mailto:[^)]+\)/g, '$1');      // [x](mailto:x) (markdown)

  const emailMatch = rawFirstLine.match(/[\w.+\-]+@[\w\-]+\.[a-z]{2,}/i);
  if (!emailMatch) {
    throw new Error('Invalid format. First line must be the apply email, followed by the job description.');
  }
  const applyEmail = emailMatch[0];

  const jobDescription = lines.slice(firstLineIndex + 1).join('\n').trim();
  if (!jobDescription) {
    throw new Error('Invalid format. First line must be the apply email, followed by the job description.');
  }

  return { jobDescription, applyEmail };
}
