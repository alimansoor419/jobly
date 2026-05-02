import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';
import os from 'os';

import { execSync } from 'child_process';

function getChromePath() {
  // 1. Use env var only if it's a real path (no wildcard)
  const envPath = process.env.PUPPETEER_EXECUTABLE_PATH;
  if (envPath && !envPath.includes('*') && existsSync(envPath)) {
    execSync(`chmod +x "${envPath}"`);
    return envPath;
  }

  // 2. Dynamically resolve the glob — finds the actual versioned folder
  try {
    const found = execSync(
      'find /opt/render/.cache/puppeteer/chrome -name "chrome" -type f 2>/dev/null | head -1'
    ).toString().trim();
    if (found && existsSync(found))
      execSync(`chmod +x "${found}"`);

    return found;
  } catch (e) { }

  // 3. Fall back to whatever puppeteer thinks (works locally)
  return puppeteer.executablePath();
}
export async function buildCvPdf(cvHtml, filename) {
  try {
    console.log(`[CV BUILDER] buildCvPdf start filename=${filename}`);

    // Then in your buildCvPdf:
    const execPath = getChromePath();
        try {
      execSync(`chmod +x "${execPath}"`);
      console.log('[CV BUILDER] chmod applied to:', execPath);
    } catch (e) {
      console.warn('[CV BUILDER] chmod failed:', e.message);
    }
    console.log('[CV BUILDER] executable path:', execPath);

    const browser = await puppeteer.launch({
      headless: "new",
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu"
      ],
      executablePath: execPath
    });

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
    console.log('[CV BUILDER] wrote pdf to', pdfPath);

    return pdfPath;
  } catch (error) {
    console.error('[CV BUILDER] error building pdf:', error);
    throw new Error(`Failed to build CV PDF: ${error.message}`);
  }
}
