import puppeteer from 'puppeteer';
import fs, { existsSync } from 'fs';
import path from 'path';
import os from 'os';
import logger from '../utils/logger.js';

import { execSync } from 'child_process';

function getChromePath() {
  if (process.platform === 'win32') {
    const winPath = process.env.PUPPETEER_EXECUTABLE_PATH_WIN;
    return winPath && existsSync(winPath)
      ? winPath
      : "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
  }

  // Linux (AWS / Ubuntu / Render)
  const linuxPath = process.env.PUPPETEER_EXECUTABLE_PATH;

  if (linuxPath && existsSync(linuxPath)) {
    return linuxPath;
  }

  // fallback for Ubuntu AWS
  const defaultLinuxPath = "/usr/bin/chromium-browser";
  if (existsSync(defaultLinuxPath)) {
    return defaultLinuxPath;
  }

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
