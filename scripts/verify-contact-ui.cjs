'use strict';
// Verify the actual production page using fictional enquiries and intercepted
// responses. No Express server, mail transport or external service is contacted.
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { chromium, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;
const root = path.resolve(__dirname, '..');
const base = 'http://127.0.0.1:58482';
const fixture = { name: 'Fictional Partner', email: 'fixture@example.invalid', subject: 'Fictional clinic pilot', message: 'A fictional business enquiry for an isolated browser test.', type: 'partnership' };
const scenarios = [
  { id: 'unavailable', status: 503, body: { success: false, code: 'CONTACT_UNAVAILABLE' } },
  { id: 'accepted-without-acknowledgement', status: 200, body: { success: true, acknowledgementSent: false } },
  { id: 'malformed-success', status: 200, body: { message: 'This is not a success receipt.' } },
];
const child = spawn(process.execPath, [require.resolve('next/dist/bin/next'), 'start', '-H', '127.0.0.1', '-p', '58482'], {
  cwd: root, env: { ...process.env, NODE_ENV: 'production', NEXT_TELEMETRY_DISABLED: '1' }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
});
let serverOutput = '';
child.stdout.on('data', data => { serverOutput = (serverOutput + data).slice(-10000); });
child.stderr.on('data', data => { serverOutput = (serverOutput + data).slice(-10000); });

(async () => {
  let browser;
  const results = []; const accessibility = [];
  try {
    let ready = false;
    for (let attempt = 0; attempt < 120; attempt++) {
      if (child.exitCode !== null) throw new Error('Next exited before readiness: ' + serverOutput);
      try { if ((await fetch(base + '/contact', { signal: AbortSignal.timeout(2000) })).ok) { ready = true; break; } } catch {}
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    assert.ok(ready, 'production contact page readiness');
    browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
    for (const viewport of [{ width: 390, height: 844 }, { width: 1440, height: 900 }]) {
      for (const scenario of scenarios) {
        const context = await browser.newContext({ viewport, serviceWorkers: 'block' });
        let submissions = 0;
        const cors = { 'access-control-allow-origin': base, 'access-control-allow-credentials': 'true', 'access-control-allow-methods': 'POST, OPTIONS', 'access-control-allow-headers': 'content-type, authorization', 'cache-control': 'no-store' };
        await context.route('**/*', async route => {
          const request = route.request();
          const url = new URL(request.url());
          if (url.pathname === '/api/contact') {
            if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
            assert.equal(request.method(), 'POST');
            assert.deepEqual(request.postDataJSON(), fixture);
            assert.equal(request.headers().authorization, undefined, 'public enquiry does not attach an auth token');
            submissions++;
            return route.fulfill({ status: scenario.status, contentType: 'application/json', headers: cors, body: JSON.stringify(scenario.body) });
          }
          // Never allow another API path or an external host to receive data.
          if (url.pathname.startsWith('/api/') || url.origin !== base) return route.abort();
          return route.continue();
        });
        try {
          const page = await context.newPage();
          await page.goto(base + '/contact', { waitUntil: 'load' });
          const main = page.locator('main');
          await expect(main.getByRole('heading', { level: 1 })).toHaveText('Contact Us');
          await page.waitForFunction(() => document.styleSheets.length > 0 && document.fonts.status === 'loaded');
          await expect(main).not.toContainText(/24 hours/i);
          await expect(main).toContainText('Do not include health records');
          await page.getByLabel('Inquiry Type', { exact: true }).selectOption(fixture.type);
          for (const [label, key] of [['Name', 'name'], ['Email', 'email'], ['Subject', 'subject'], ['Message', 'message']]) await page.getByLabel(label, { exact: true }).fill(fixture[key]);
          await main.getByRole('button', { name: 'Send Message', exact: true }).click();
          if (scenario.id === 'accepted-without-acknowledgement') {
            await expect(main.getByRole('heading', { name: 'Message accepted', exact: true })).toBeVisible();
            await expect(main.getByRole('status')).toContainText('No need to submit it again.');
            await expect(main.getByRole('status')).toContainText('We could not send a confirmation email to your address, but your enquiry was accepted for the team.');
            await expect(main.locator('form')).toHaveCount(0);
            await expect(main.getByRole('alert')).toHaveCount(0);
          } else {
            await expect(main.getByRole('alert')).toBeVisible();
            await expect(main.getByRole('alert')).toContainText(scenario.id === 'unavailable' ? 'Your message was not sent.' : 'We could not confirm delivery.');
            await expect(main.getByRole('heading', { name: 'Message accepted', exact: true })).toHaveCount(0);
            await expect(main.getByRole('alert').getByRole('link')).toHaveAttribute('href', 'mailto:info@doctarx.com');
            for (const [label, key] of [['Name', 'name'], ['Email', 'email'], ['Subject', 'subject'], ['Message', 'message']]) await expect(page.getByLabel(label, { exact: true })).toHaveValue(fixture[key]);
            await expect(main.getByRole('button', { name: 'Send Message', exact: true })).toBeEnabled();
          }
          assert.equal(submissions, 1, 'one explicit submission without automatic retry');
          assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'contact page has no horizontal overflow');
          const scan = await new AxeBuilder({ page }).include('main').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
          const violations = scan.violations.map(item => ({ id: item.id, impact: item.impact, nodes: item.nodes.map(node => node.target) }));
          assert.deepEqual(violations, [], scenario.id + ' contact accessibility');
          accessibility.push({ scenario: scenario.id, width: viewport.width, violations: 0 });
          results.push({ scenario: scenario.id, width: viewport.width, mockedSubmissions: submissions, passed: true });
        } finally { await context.close(); }
      }
    }
    const directory = path.join(root, 'artifacts', 'contact');
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, 'browser.json'), JSON.stringify({ sourceSha: process.env.GITHUB_SHA || null, passed: true, realMailSent: false, results, accessibility }, null, 2));
    console.log('Contact production browser checks passed: ' + results.length + ' delivery scenarios and ' + accessibility.length + ' accessibility scans; all mail responses mocked, no external messages sent.');
  } finally {
    if (browser) await browser.close();
    child.kill();
    await new Promise(resolve => { if (child.exitCode !== null) resolve(); else child.once('exit', resolve); });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
