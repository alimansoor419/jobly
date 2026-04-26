import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';
import os from 'os';

export async function buildCvPdf(cvHtml, filename) {
  try {
    const browser = await puppeteer.launch({ args: ['--no-sandbox'] });
    const page = await browser.newPage();
    await page.setContent(cvHtml, { waitUntil: 'networkidle0' });
    
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
    
    return pdfPath;
  } catch (error) {
    throw new Error(`Failed to build CV PDF: ${error.message}`);
  }
}
