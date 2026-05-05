import puppeteer from 'puppeteer';
import fs, { existsSync } from 'fs';
import path from 'path';
import os from 'os';
import logger from '../utils/logger.js';

import { execSync } from 'child_process';

function getChromePath() {
  // 1. Prefer an OS-specific env var first (so Render/Linux and Windows can coexist)
  const envPathWin = process.env.PUPPETEER_EXECUTABLE_PATH_WIN || process.env.PUPPETEER_EXECUTABLE_PATH_WINDOWS;
  if (process.platform === 'win32' && envPathWin && !envPathWin.includes('*') && existsSync(envPathWin)) {
    return envPathWin;
  }

  // 2. Generic env var — but avoid returning a Linux Render path when running on Windows
  const envPath = process.env.PUPPETEER_EXECUTABLE_PATH;
  if (envPath && !envPath.includes('*')) {
    const normalized = envPath.toLowerCase();
    const looksLikeRenderPath = normalized.includes('opt/render') || normalized.includes('/opt/render') || normalized.includes('opt\\render');
    if (process.platform === 'win32' && looksLikeRenderPath) {
      // ignore Linux render path on Windows
    } else if (existsSync(envPath)) {
      if (process.platform !== 'win32') {
        try { execSync(`chmod +x "${envPath}"`); } catch (e) {}
      }
      return envPath;
    }
  }

  // 2. Dynamically resolve the glob — finds the actual versioned folder
  try {
    if (process.platform !== 'win32') {
      const found = execSync(
        'find /opt/render/.cache/puppeteer/chrome -name "chrome" -type f 2>/dev/null | head -1'
      ).toString().trim();

      if (found && existsSync(found)) {
        try { execSync(`chmod +x "${found}"`); } catch (e) {}
        return found;
      }
    }
  } catch (e) { }

  // 3. Fall back to whatever puppeteer thinks (works locally)
  try {
    const p = puppeteer.executablePath();
    if (p && existsSync(p)) return p;
  } catch (e) {}
  return null;
}
export async function buildCvPdf(cvHtml, filename) {
  try {
    logger.info('cv_builder.start', { filename });

    // Then in your buildCvPdf:
    const execPath = getChromePath();
    if (execPath) {
      logger.info('cv_builder.exec_path', { execPath });
    } else {
      logger.info('cv_builder.exec_path', { execPath: 'auto (no valid path found; using Puppeteer default)' });
    }

    const launchOptions = {
      headless: "new",
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu"
      ]
    };

    if (execPath && existsSync(execPath)) {
      launchOptions.executablePath = execPath;
      if (process.platform !== 'win32') {
        try { execSync(`chmod +x "${execPath}"`); logger.info('cv_builder.chmod', { execPath }); } catch (e) { logger.warn('cv_builder.chmod_failed', { error: e?.message || e }); }
      }
    } else {
      logger.warn('cv_builder.exec_missing', { execPath });
    }

    const browser = await puppeteer.launch(launchOptions);

    const page = await browser.newPage();
    await page.setContent(cvHtml, { waitUntil: "networkidle0" });
    const pdfBuffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '0', right: '0', bottom: '0', left: '0' }
    });

    await browser.close();

    // Using os.tmpdir() to be compatible across environments (Windows/Linux/Mac)
    const tmpDir = os.tmpdir();
    const pdfPath = path.join(tmpDir, filename);

    fs.writeFileSync(pdfPath, pdfBuffer);
    logger.info('cv_builder.wrote_pdf', { pdfPath });

    return pdfPath;
  } catch (error) {
    logger.error('cv_builder.error', { error: error?.message || error });
    throw new Error(`Failed to build CV PDF: ${error.message}`);
  }
}
