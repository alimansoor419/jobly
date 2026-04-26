import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenerativeAI } from "@google/generative-ai";
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CV_PATH = path.join(__dirname, '../../data/cv.txt');
let CV_TEXT = '';

try {
  if (!fs.existsSync(CV_PATH)) {
    console.warn("CV file not found at data/cv.txt. Please create it.");
  } else {
    CV_TEXT = fs.readFileSync(CV_PATH, 'utf-8');
  }
} catch (error) {
  console.error("Error loading CV:", error);
}

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// List of fallback models to try if the first one is unavailable or high in demand
// These models are chosen based on the quotas available in your specific Google account tier
const FALLBACK_MODELS = [
  "gemini-2.5-flash", 
  "gemini-3-flash", 
  "gemini-3.1-flash-lite", 
  "gemini-2.5-flash-lite"
];

export async function runAgent(jobDescription) {
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
  @page {
    size: A4;
    margin-top: 18mm;
    margin-bottom: 18mm;
    margin-left: 15mm;
    margin-right: 15mm;
  }
  body {
    width: auto;
    margin: 0;
    padding: 0;
  }
  h2, h3 { page-break-after: avoid; }
  li, p { page-break-inside: avoid; }
- Print-safe colours only (no dark backgrounds).
- All content from the master CV, rewritten to prioritise skills and experience relevant to the job description.

Job description:
<job_description>
${jobDescription}
</job_description>

Candidate CV:
<cv>
${CV_TEXT}
</cv>
  `;

  let lastError;

  for (const modelName of FALLBACK_MODELS) {
    try {
      console.log(`[AI Agent] Attempting to use model: ${modelName}`);
      const model = genAI.getGenerativeModel({ model: modelName });
      const result = await model.generateContent(prompt);
      const response = await result.response;
      let text = response.text();

      // Clean up response text in case it includes markdown code blocks
      text = text.replace(/```json/g, "").replace(/```/g, "").trim();

      try {
        const parsed = JSON.parse(text);
        console.log(`[AI Agent] Successfully generated content with ${modelName}`);
        return {
          subject: parsed.subject,
          body: parsed.body,
          cv_html: parsed.cv_html,
          cv_filename: parsed.cv_filename
        };
      } catch (parseError) {
        console.error(`[AI Agent] JSON Parse Error using ${modelName}:`, parseError, "Raw context:", text);
        throw new Error("ai_parse_failed");
      }
      
    } catch (err) {
      console.warn(`[AI Agent] Model ${modelName} failed (high demand or unavailable): ${err.message}`);
      lastError = err;
      // Continue to the next model in the array
    }
  }

  // If the loop finishes and we get here, it means ALL 4 models failed.
  console.error("[AI Agent] All available fallback models failed. Last error:", lastError);
  throw new Error("all_models_failed_high_demand");
}
