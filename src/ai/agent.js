import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import logger from '../utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

const CV_PATH = path.resolve(__dirname, '../../data/cv.txt');
logger.info('agent.cv_loader', { cwd: process.cwd(), cvPath: CV_PATH });

let CV_TEXT = '';

try {
  if (!fs.existsSync(CV_PATH)) {
    logger.warn('agent.cv_missing', 'CV file not found at data/cv.txt. Please create it.');
  } else {
    CV_TEXT = fs.readFileSync(CV_PATH, 'utf-8');
  }
} catch (error) {
  logger.error('agent.cv_load_error', { error: error?.message || error });
}

const firstLine = CV_TEXT ? CV_TEXT.split(/\r?\n/)[0] : '';
logger.info('agent.cv_first_line', { firstLine, cvPath: CV_PATH });

// ── Resilient JSON Parser ─────────────────────────────────────────────────────
function resilientParseModelOutput(text) {
  if (!text || typeof text !== 'string') return null;
  text = text.replace(/```json/gi, '').replace(/```/g, '').trim();

  const tryParse = (s) => { try { return JSON.parse(s); } catch { return null; } };

  // 1) Direct parse
  let parsed = tryParse(text);
  if (parsed) return parsed;

  // 2) Field-by-field extraction — handles unescaped quotes inside cv_html/body
  try {
    const extract = (key, nextKey) => {
      const keyIdx = text.indexOf(`"${key}"`);
      if (keyIdx === -1) return null;
      const colon = text.indexOf(':', keyIdx);
      const openQuote = text.indexOf('"', colon + 1);
      if (openQuote === -1) return null;

      const nextKeyIdx = nextKey ? text.indexOf(`"${nextKey}"`, openQuote) : -1;
      const closeSearch = nextKeyIdx !== -1 ? nextKeyIdx : text.lastIndexOf('}');

      let closeQuote = closeSearch - 1;
      while (closeQuote > openQuote && /[\s,\n\r]/.test(text[closeQuote])) closeQuote--;
      if (text[closeQuote] === '"') closeQuote--;

      return text.slice(openQuote + 1, closeQuote + 1);
    };

    const unescape = (s) => {
      if (!s) return s;
      return s
        .replace(/\\n/g, '\n')
        .replace(/\\t/g, '\t')
        .replace(/\\"/g, '"')
        .replace(/\\\\/g, '\\');
    };

    const subject = extract('subject', 'body');
    const body = extract('body', 'cv_html');
    const cv_html = extract('cv_html', 'cv_filename');
    const cv_filename = extract('cv_filename', null);

    if (subject && body && cv_html && cv_filename) {
      logger.info('agent.parse_rescued', { strategy: 'field-extraction' });
      return {
        subject: unescape(subject),
        body: unescape(body),
        cv_html: unescape(cv_html),
        cv_filename: unescape(cv_filename),
      };
    }
  } catch (e) {
    logger.warn('agent.parse_extraction_failed', { error: e?.message });
  }

  // 3) Brace-matching fallback
  const start = text.indexOf('{');
  if (start !== -1) {
    let inString = false, esc = false, depth = 0;
    for (let i = start; i < text.length; i++) {
      const ch = text[i];
      if (!esc && ch === '"') inString = !inString;
      if (!inString) { if (ch === '{') depth++; else if (ch === '}') depth--; }
      esc = !esc && ch === '\\';
      if (depth === 0) {
        parsed = tryParse(text.slice(start, i + 1));
        if (parsed) return parsed;
        break;
      }
    }
  }

  return null;
}

// ── Agent Runner ─────────────────────────────────────────────────────────────
export async function runAgent(jobDescription, notify = async () => { }, options = {}) {
  logger.info('agent.run_invoked', { jobDescriptionLength: jobDescription?.length ?? 0 });

  const prompt = `
  You are a CV and cover letter formatter. Reformat and reorder existing content only — never invent, infer, or omit any fact.

OUTPUT: A single raw JSON object. No markdown, no code fences, no explanation, no text before or after.

{
  "subject":     "Application for [Job Title] – [Candidate Full Name]",
  "body":        "<plain text cover letter>",
  "cv_html":     "<complete self-contained HTML document>",
  "cv_filename": "firstname_lastname_jobtitle_company.pdf"
}

── body ──
3 paragraphs, plain text, no HTML.
1. Role + company you're applying to. One sentence on why the background is a direct match.
2. 2–3 specific experiences from the CV most relevant to the job. No generalisations.
3. One sentence of genuine interest. Candidate's full name on a new line.
Rules: every claim must trace to the CV. Do not use: passionate, dynamic, leverage, synergy, spearhead, excited to.

── cv_html ──
Complete HTML document. Use SINGLE quotes for all HTML attributes.
Use exactly this CSS inside <style>, do not modify it:
body{font-family:Arial,sans-serif;font-size:12px;line-height:1.5;margin:0;padding:0}h1{font-family:Georgia,serif;font-size:20px;margin-bottom:4px}h2{font-family:Georgia,serif;font-size:14px;margin-top:14px;margin-bottom:2px;border-bottom:1px solid #ccc}h3{font-family:Georgia,serif;font-size:12px;margin-top:8px;margin-bottom:2px}p,li,td{font-size:12px;margin:0 0 2px 0}small,span{font-size:11px}ul{margin:2px 0;padding-left:18px}a{color:#000;text-decoration:underline}@page{size:A4;margin:18mm 15mm}h2,h3{page-break-after:avoid}li,p{page-break-inside:avoid}

Section order: Header → Summary → Skills → Experience → Projects → Education → Certifications.
- Header: name as h1, email/phone/location on one line, each URL on its own line.
- Summary: 2 sentences max, based only on CV facts, framed toward the job.
- Skills: grouped by category, ordered by relevance to job. Each category: h3 + comma-separated p.
- Experience: h3 for title/company, small for date/location, exactly 4 bullet points per role (one action + one outcome/tech, max 20 words each).
- Projects: h3 for name, exactly 2 sentences (what it does, tech used, your role).
- Education: h3 for degree/university, small for years, awards as ul.
- Certifications: single ul.
Reorder content to match the job. Do not add, remove, or rephrase any fact.

── cv_filename ──
firstname_lastname_jobtitle_company.pdf — lowercase, underscores, no spaces or special characters.

<job_description>
${jobDescription}
</job_description>

<cv>
${CV_TEXT}
</cv>
  `;

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    logger.error('agent.openai_missing_key', 'OPENAI_API_KEY environment variable is not defined.');
    throw new Error("Missing OPENAI_API_KEY environment variable.");
  }

  try {
    logger.info('agent.openai_attempt', { model: 'gpt-5-mini' });
    const res = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'gpt-5-mini',
        input: prompt
      })
    });

    if (!res.ok) {
      const bodyText = await res.text().catch(() => '');
      logger.error('agent.openai_failed', { status: res.status, body: bodyText });
      throw new Error(`OpenAI API returned HTTP ${res.status}: ${bodyText}`);
    }

    const data = await res.json().catch(() => null);
    
    // Extract text from the Responses API format
    let text = data?.output_text ?? null;
    if (!text && data?.output && Array.isArray(data.output)) {
      const messageItem = data.output.find(item => item.type === 'message');
      if (messageItem) {
        if (typeof messageItem.content === 'string') {
          text = messageItem.content;
        } else if (Array.isArray(messageItem.content)) {
          text = messageItem.content
            .map(part => {
              if (part.type === 'text') return part.text;
              if (part.type === 'output_text') return part.text;
              return '';
            })
            .join('');
        }
      }
    }

    if (!text) {
      logger.error('agent.openai_no_text');
      throw new Error("OpenAI Responses API returned an empty response.");
    }

    logger.info('agent.openai_raw_response', { length: text.length, preview: text.slice(0, 300) });

    const parsed = resilientParseModelOutput(text);
    if (!parsed) {
      logger.error('agent.openai_parse_failed', { rawStart: text.slice(0, 500) });
      throw new Error("Failed to parse OpenAI JSON output.");
    }

    logger.info('agent.openai_success');
    return { ...parsed, model_used: 'gpt-5-mini' };

  } catch (err) {
    logger.error('agent.openai_error', { error: err?.message });
    throw err;
  }
}
