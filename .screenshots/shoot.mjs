import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const outDir = path.resolve('.screenshots/out');
fs.mkdirSync(outDir, { recursive: true });
const siteUrl = 'file://' + path.resolve('.screenshots/site/presentation/index.html');

const browser = await chromium.launch();

// ---------- Microsite: desktop full + sections ----------
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
await page.goto(siteUrl, { waitUntil: 'networkidle' });
await page.waitForTimeout(1800);
await page.screenshot({ path: `${outDir}/01-microsite-full.png`, fullPage: true });

const sections = [
  ['02-hero', '.hero'],
  ['03-video', '#video'],
  ['04-pilot', '#pilot'],
  ['05-video-consult', '#video-consult'],
  ['06-forecasting', '#forecasting'],
  ['07-dhis2', '#dhis2'],
  ['08-timeline', '#timeline'],
  ['09-dashboard', '#dashboard'],
  ['10-faq', '#faq'],
];
for (const [name, sel] of sections) {
  const el = await page.$(sel);
  if (el) {
    await el.scrollIntoViewIfNeeded();
    await page.waitForTimeout(500);
    await el.screenshot({ path: `${outDir}/${name}.png` });
    console.log('shot', name);
  }
}

// ---------- Microsite: mobile ----------
const mctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const mp = await mctx.newPage();
await mp.goto(siteUrl, { waitUntil: 'networkidle' });
await mp.waitForTimeout(1200);
await mp.screenshot({ path: `${outDir}/11-microsite-mobile.png`, fullPage: true });
console.log('shot mobile');

// ---------- Platform (Next app), best-effort ----------
const pages = [
  ['12-platform-ng-home', 'http://127.0.0.1:3100/ng'],
  ['13-platform-ministry-dashboard', 'http://127.0.0.1:3100/ng/admin/public-health-programme?demo=1'],
];
for (const [name, url] of pages) {
  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 45000 });
    // give client components + demo fallback time to render
    await page.waitForTimeout(5000);
    await page.screenshot({ path: `${outDir}/${name}.png`, fullPage: true });
    console.log('shot', name);
  } catch (e) {
    console.log('skip', name, e.message);
  }
}

await browser.close();
console.log('screenshots:', fs.readdirSync(outDir).join(', '));
