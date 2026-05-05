import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenerativeAI } from "@google/generative-ai";
import dotenv from 'dotenv';
import logger from '../utils/logger.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CV_PATH = path.resolve(process.cwd(), 'data/cv.txt');
logger.info('agent.cv_loader', { cwd: process.cwd(), cvPath: CV_PATH });
function parseGroqOutput(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const text = raw.replace(/```json/gi, '').replace(/```/g, '').trim();

  // 1) Try direct parse first — works if model got lucky with escaping
  try { return JSON.parse(text); } catch {}

  // 2) Regex extract simple fields — subject and cv_filename never contain HTML
  const subject     = (text.match(/"subject"\s*:\s*"((?:[^"\\]|\\.)*)"/s)     || [])[1];
  const cv_filename = (text.match(/"cv_filename"\s*:\s*"((?:[^"\\]|\\.)*)"[\s\n]*}/) || [])[1];

  // 3) Extract body — between "body": " and "cv_html":
  let body = null;
  const bodyKeyIdx    = text.indexOf('"body"');
  const cvHtmlKeyIdx  = text.indexOf('"cv_html"');
  if (bodyKeyIdx !== -1 && cvHtmlKeyIdx !== -1) {
    const openQuote = text.indexOf('"', text.indexOf(':', bodyKeyIdx)) + 1;
    let closeSearch = cvHtmlKeyIdx - 1;
    while (closeSearch > openQuote && /[\s,\n\r]/.test(text[closeSearch])) closeSearch--;
    if (text[closeSearch] === '"') closeSearch--;
    body = text.slice(openQuote, closeSearch + 1)
      .replace(/\\n/g, '\n')
      .replace(/\\t/g, '\t')
      .replace(/\\"/g, '"');
  }

  // 4) Extract cv_html — raw slice between "cv_html": " and "cv_filename"
  //    This works even when HTML has unescaped double quotes inside
  let cv_html = null;
  const cvFilenameKeyIdx = text.indexOf('"cv_filename"');
  if (cvHtmlKeyIdx !== -1 && cvFilenameKeyIdx !== -1) {
    let start = text.indexOf(':', cvHtmlKeyIdx) + 1;
    while (start < text.length && /[\s\n]/.test(text[start])) start++;
    if (text[start] === '"') start++; // skip opening quote

    let end = cvFilenameKeyIdx - 1;
    while (end > start && /[\s,\n\r]/.test(text[end])) end--;
    if (text[end] === '"') end--; // skip structural closing quote

    cv_html = text.slice(start, end + 1)
      .replace(/\\n/g, '\n')
      .replace(/\\t/g, '\t')
      .replace(/\\"/g, '"')
      .replace(/\\'/g, "'");
  }

  if (subject && body && cv_html && cv_filename) {
    logger.info('agent.groq_parse_rescued', { strategy: 'dedicated-groq-parser' });
    return { subject, body, cv_html, cv_filename };
  }

  logger.warn('agent.groq_parse_fields_missing', {
    subject: !!subject,
    body: !!body,
    cv_html: !!cv_html,
    cv_filename: !!cv_filename,
  });
  return null;
}

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

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const FALLBACK_MODELS = [
"gemini-2.5-flash",       // primary — retry when demand drops
  "gemini-2.0-flash",       // solid fallback
  "gemini-2.0-flash-lite",  // lighter quota usage
  "gemini-1.5-flash-8b",    // smallest, most likely to have quota leftt
];

// ─── MODULE-LEVEL PARSER ─────────────────────────────────────────────────────
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
      subject:     unescape(subject),
      body:        unescape(body),
      cv_html:     unescape(cv_html),
      cv_filename: unescape(cv_filename),
    };    }
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
// ─────────────────────────────────────────────────────────────────────────────

export async function runAgent(jobDescription) {
  logger.info('agent.run_invoked', { jobDescriptionLength: jobDescription?.length ?? 0 });

  const prompt = `
You are a professional job application assistant. You will be given a job description and a candidate's CV.
Respond ONLY with a raw JSON object. No markdown, no code fences, no preamble.

The JSON must have exactly these four keys:
{
  "subject": "string — a concise, professional email subject line",
  "body": "string — a plain-text email body (3-4 paragraphs, no HTML)",
  "cv_html": "string — a complete, self-contained HTML document for the CV",
  "cv_filename": "string — a safe filename e.g. john_doe_cv_company.pdf"
}

Requirements for cv_html:
- Must be a complete HTML document (<!DOCTYPE html>...)
- IMPORTANT: Use single quotes for ALL HTML attributes. Never double quotes inside the HTML.
  Write: <html lang='en'> not <html lang="en">
  Write: <meta charset='UTF-8'> not <meta charset="UTF-8">
  This is required because the entire cv_html value is a JSON string.
- All CSS inlined in a <style> block inside <head>. No external stylesheets or fonts.
- Use system fonts only: font-family: Georgia, serif for headings; Arial, sans-serif for body.
- Set these exact font sizes:
  body -> font-size: 12px; line-height: 1.5;
  h1 -> font-size: 20px;
  h2 -> font-size: 14px;
  h3 -> font-size: 12px;
  p, li, td -> font-size: 12px;
  small, span -> font-size: 11px;
- Add this EXACT block to the <style> section for print formatting:
  @page { size: A4; margin-top: 18mm; margin-bottom: 18mm; margin-left: 15mm; margin-right: 15mm; }
  body { width: auto; margin: 0; padding: 0; }
  h2, h3 { page-break-after: avoid; }
  li, p { page-break-inside: avoid; }
- Print-safe colours only (no dark backgrounds).
- All content from the master CV, rewritten to prioritise skills relevant to the job description.

Job description:
<job_description>
${jobDescription}
</job_description>

Candidate CV:
<cv>
${CV_TEXT}
</cv>
  `;

  let lastError = null;


  // ── 1. GROQ ─────────────────────────────────────────────────────────────────
  
  const groqKeys = [
    process.env.GROQ_API_KEY_1,
    process.env.GROQ_API_KEY_2,
    process.env.GROQ_API_KEY_3
  ].filter(Boolean);
const groqModels = [
  'llama-3.3-70b-versatile',  // primary — best quality
  'llama-3.1-8b-instant',     // fallback — faster, lighter
];
  for (const key of groqKeys) {
      for (const model of groqModels) {

    try {
      logger.info('agent.groq_attempt');
      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
        body: JSON.stringify({
          model: 'openai/gpt-oss-120b',
          messages: [{ role: 'user', content: prompt }]
        })
      });

      if (!res.ok) {
        const bodyText = await res.text().catch(() => '');
        logger.warn('agent.groq_key_failed', { status: res.status, body: bodyText.slice(0, 200) });
        continue;
      }

      const data = await res.json().catch(() => null);
      const text = data?.choices?.[0]?.message?.content ?? data?.choices?.[0]?.text ?? null;

      if (!text) { logger.warn('agent.groq_no_text'); continue; }

      // Prefer the resilient parser (handles many model quirks), but keep the
      // dedicated GROQ parser as a fallback for highly-structured outputs.
      const parsed = resilientParseModelOutput(text) || parseGroqOutput(text);
      if (!parsed) {
        logger.error('agent.groq_json_parse_error', { rawStart: text.slice(0, 500) });
        continue;
      }

      logger.info('agent.groq_success');
      return { ...parsed, model_used: 'groq-openai/gpt-oss-120b' };

    } catch (err) {
      logger.warn('agent.groq_request_failed', { error: err?.message });
      continue;
    }
  }}
// ── 1.5 OpenRouter fallback ──────────────────────────────────────────────────
const openRouterKey = process.env.OPENROUTER_API_KEY;
if (openRouterKey) {
const openRouterModels = [
  'meta-llama/llama-3.3-70b-instruct:free',       // best instruction following, 66K ctx
  'openrouter/free',                               // auto-picks any available free model
  'nousresearch/hermes-3-llama-3.1-405b:free',    // 405B params, great for structured output
  'nvidia/nemotron-3-super-120b-a12b:free',        // 120B, 262K context, tools support
  'z-ai/glm-4.5-air:free',                         // 131K context, tools support
  'google/gemma-3-27b-it:free',                    // 131K context, solid fallback

];

  for (const model of openRouterModels) {
    try {
      logger.info('agent.openrouter_attempt', { model });
      const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${openRouterKey}`,
          'HTTP-Referer': 'https://github.com/jobly',
        },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: prompt }]
        })
      });

      if (!res.ok) {
        const bodyText = await res.text().catch(() => '');
        logger.warn('agent.openrouter_failed', { status: res.status, model, body: bodyText.slice(0, 200) });
        continue;
      }

      const data = await res.json().catch(() => null);
      const text = data?.choices?.[0]?.message?.content ?? null;
      if (!text) { logger.warn('agent.openrouter_no_text', { model }); continue; }

      const parsed = resilientParseModelOutput(text);
      if (!parsed) { logger.error('agent.openrouter_parse_failed', { model }); continue; }

      logger.info('agent.openrouter_success', { model });
      return { ...parsed, model_used: model };

    } catch (err) {
      logger.warn('agent.openrouter_error', { model, error: err?.message });
    }
  }
}
  // ── 3. Google REST ──────────────────────────────────────────────────────────
  const googleApiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || process.env.X_GOOG_API_KEY;
  if (googleApiKey) {
    for (const modelName of FALLBACK_MODELS) {
      try {
        logger.info('agent.google_rest_attempt', { model: modelName });
        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-goog-api-key': googleApiKey },
            body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }],  generationConfig: { responseMimeType: 'application/json' } })
          }
        );

        if (!res.ok) {
          const bodyText = await res.text().catch(() => '');
          logger.warn('agent.google_rest_failed', { status: res.status, body: bodyText.slice(0, 200) });
          continue;
        }

        const data = await res.json().catch(() => null);
        const text = data?.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('\n') ?? null;

        if (!text) { logger.warn('agent.google_rest_no_text'); continue; }

        const parsed = resilientParseModelOutput(text);
        if (!parsed) { logger.error('agent.google_rest_parse_failed', { rawStart: text.slice(0, 500) }); continue; }

        logger.info('agent.google_rest_success', { model: modelName });
        return { ...parsed, model_used: modelName };

      } catch (err) {
        logger.warn('agent.google_rest_error', { model: modelName, error: err?.message });
        lastError = err;
      }
    }
  }

  // ── 4. Gemini SDK fallback ───────────────────────────────────────────────────
  for (const modelName of FALLBACK_MODELS) {
    try {
      logger.info('agent.gemini_attempt', { model: modelName });
      const model = genAI.getGenerativeModel({ model: modelName });
      const result = await model.generateContent(prompt);
      const text = result.response.text();

      const parsed = resilientParseModelOutput(text);
      if (!parsed) {
        logger.error('agent.gemini_json_parse_error', { model: modelName, rawStart: text.slice(0, 500) });
        throw new Error("ai_parse_failed");
      }

      logger.info('agent.gemini_success', { model: modelName });
      return { ...parsed, model_used: modelName };

    } catch (err) {
      logger.warn('agent.gemini_model_failed', { model: modelName, error: err?.message });
      lastError = err;
    }
  }

  logger.error('agent.all_models_failed', { error: lastError?.message });
  throw new Error("all_models_failed_high_demand");
}