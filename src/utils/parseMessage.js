export default function parseMessage(text) {
  // Extract text within double curly braces for each key
  const jdMatch = text.match(/job-description:\{\{([\s\S]*?)\}\}/);
  const emailMatch = text.match(/email:\{\{([\s\S]*?)\}\}/);

  if (!jdMatch || !emailMatch) {
    throw new Error("Format must be exactly:\njob-description:{{ [your text here] }}\nemail:{{ [email here] }}");
  }

  const jobDescription = jdMatch[1].trim();
  const applyEmail = emailMatch[1].trim();

  if (!applyEmail.includes('@')) {
    throw new Error("Invalid email address inside email:{{...}}");
  }

  if (!jobDescription) {
    throw new Error("Job description inside job-description:{{...}} is empty.");
  }

  return { jobDescription, applyEmail };
}
