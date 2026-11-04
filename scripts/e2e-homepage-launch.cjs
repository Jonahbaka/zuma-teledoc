'use strict';

// Read-only frontend review of an already running, isolated local build.
// No clinical sessions, API fixtures, account data or language claims are tested here.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { AFRICAN_GEMINI_LIVE_LANGUAGES, DOCUMENTED_GEMINI_LIVE_LANGUAGES } = require('../shared/voiceLanguageCatalog.cjs');
const { chromium } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;

const origin = new URL(process.env.HOMEPAGE_PREVIEW_URL || 'http://127.0.0.1:3133');
assert.ok(['localhost', '127.0.0.1'].includes(origin.hostname) && origin.protocol === 'http:', 'Use a local homepage preview only.');
assert.equal(origin.pathname, '/');
const output = path.resolve(process.env.HOMEPAGE_REVIEW_OUTPUT || 'artifacts/homepage-launch');
fs.mkdirSync(output, { recursive: true });

async function main() {
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
  const results = [];
  try {
    for (const width of [320, 390, 768, 1440]) {
      for (const market of ['US', 'NG']) {
        const context = await browser.newContext({ viewport: { width, height: width < 600 ? 844 : 1000 } });
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        try {
          const route = market === 'NG' ? '/ng' : '/';
          const response = await page.goto(new URL(route, origin).href, { waitUntil: 'networkidle', timeout: 60000 });
          assert.equal(response.status(), 200);
          await page.getByRole('heading', { level: 1, name: /AI-first telehealth\.\s*Human care\./ }).waitFor();
          await page.evaluate(() => document.fonts.ready);
          assert.match(await page.title(), /AI-First Telehealth.*Language Voice/);
          const hero = page.getByAltText('AI-generated medical voice concept showing a patient speaking with a doctor through a luminous voice orb and sound waves in a primary healthcare centre');
          await hero.evaluate(image => image.decode());
          assert.equal(await hero.count(), 1);
          assert.deepEqual(await hero.evaluate(image => ({ width: image.getAttribute('width'), height: image.getAttribute('height'), fit: getComputedStyle(image).objectFit })), { width: '1672', height: '941', fit: 'contain' });
          assert.equal(await hero.locator('..').locator('[aria-hidden="true"] svg[aria-label="DoctaRx"]').count(), 1);
          assert.equal(await page.getByRole('group', { name: 'Illustrative conversation from Hausa to English', exact: true }).count(), 1);
          assert.equal(await page.locator('main').count(), 1);
          assert.equal(await page.getByRole('contentinfo').count(), 1);
          assert.equal(await page.locator('#language-voice').count(), 1);
          const african = page.getByRole('list', { name: 'African language voice choices', exact: true });
          assert.deepEqual(await african.locator('li').allTextContents(), AFRICAN_GEMINI_LIVE_LANGUAGES.map(item => item.name));
          assert.equal(await page.getByRole('link', { name: 'Join as a provider', exact: true }).getAttribute('href'), '/provider/register');
          const more = page.locator('#language-voice details');
          await more.locator('summary').click();
          assert.equal(await more.evaluate(element => element.open), true);
          assert.deepEqual(await page.getByRole('list', { name: 'More language voice choices', exact: true }).locator('li').allTextContents(), DOCUMENTED_GEMINI_LIVE_LANGUAGES.filter(item => !item.african).map(item => item.name));
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, `${market} ${width}: expanded language overflow`);
          await more.locator('summary').click();
          assert.equal(await more.evaluate(element => element.open), false);
          assert.equal(await page.locator('a[href="/voice-lab"]').count(), 0);
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, `${market} ${width}: horizontal overflow`);

          const exploration = page.getByRole('link', { name: 'Explore language voice', exact: true });
          await exploration.click();
          await page.waitForURL('**#language-voice');
          assert.equal(await page.locator('#voice-heading').isVisible(), true);
          await page.goBack();
          assert.equal(new URL(page.url()).hash, '');

          if (width < 1280) {
            const menu = page.locator('header button[aria-expanded]');
            await menu.click();
            assert.equal(await menu.getAttribute('aria-expanded'), 'true');
            await page.keyboard.press('Escape');
            assert.equal(await menu.getAttribute('aria-expanded'), 'false');
            assert.equal(await menu.evaluate(button => document.activeElement === button), true);
            await menu.click();
            await page.getByRole('navigation', { name: 'Mobile primary navigation', exact: true }).getByRole('link', { name: 'Language voice', exact: true }).click();
            assert.equal(await menu.getAttribute('aria-expanded'), 'false');
            await page.goBack();
            await menu.click();
            await page.getByRole('button', { name: 'Close main navigation', exact: true }).click();
            assert.equal(await menu.getAttribute('aria-expanded'), 'false');
          }

          for (const img of await page.locator('main img').all()) {
            await img.scrollIntoViewIfNeeded();
            await img.evaluate(image => image.decode());
          }
          await page.evaluate(() => window.scrollTo(0, 0));
          const smallText = await page.evaluate(() => [...document.querySelectorAll('main *,header *,nav *,footer *')].filter(element => {
            const box = element.getBoundingClientRect(), style = getComputedStyle(element);
            return box.width > 2 && box.height > 2 && style.visibility !== 'hidden' && style.display !== 'none' && [...element.childNodes].some(node => node.nodeType === Node.TEXT_NODE && node.textContent.trim()) && parseFloat(style.fontSize) < 16;
          }).map(element => ({ text: element.textContent.trim().slice(0, 80), size: getComputedStyle(element).fontSize })));
          assert.deepEqual(smallText, [], 'All visible text meets the existing 16px minimum.');
          await page.screenshot({ path: path.join(output, `${market}-${width}-viewport.png`) });
          await page.locator('figure').first().screenshot({ path: path.join(output, `${market}-${width}-voice-hero.png`) });
          await page.screenshot({ path: path.join(output, `${market}-${width}-full.png`), fullPage: true });
          const audit = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
          const violations = audit.violations.map(item => ({ id: item.id, impact: item.impact, nodes: item.nodes.map(node => ({ target: node.target, failureSummary: node.failureSummary })) }));
          results.push({ market, width, title: await page.title(), pageErrors: errors, violations });
          fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(results, null, 2));
          assert.deepEqual(errors, [], `${market} ${width}: page errors`);
          assert.deepEqual(violations, [], `${market} ${width}: accessibility violations`);
          console.log(`${market} ${width}: headline, medical voice image, metadata, anchor history, menu, overflow and accessibility passed`);
        } finally { await context.close(); }
      }
    }
  } finally { await browser.close(); }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
