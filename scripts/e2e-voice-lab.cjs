#!/usr/bin/env node
'use strict';
// Real Next UI + real synthetic Express handlers. Identity alone is a fixed
// test injection. No database, external provider, microphone or real PHI.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const express = require('express');
const { chromium, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;
const { createVoiceLabRouter } = require('../server/routes/voiceLab');
const { createVoiceLiveRouter } = require('../server/routes/voiceLive');
const { createSyntheticVoiceSessionService } = require('../server/services/voice/syntheticVoiceSessionService');
const ROOT = path.resolve(__dirname, '..');
const PORT = 3217;
const ORIGIN = `http://127.0.0.1:${PORT}`;
const ART = path.join(ROOT, 'artifacts/voice-lab'); fs.mkdirSync(ART, { recursive: true });
const actor = { id: '00000000-0000-4000-8000-000000000001', role: 'provider', firstName: 'Synthetic', lastName: 'Reviewer' };
const token = `test.${Buffer.from(JSON.stringify({ userId: actor.id, sub: actor.id })).toString('base64url')}.synthetic`;
const evidence = { syntheticOnly: true, realMicrophone: false, realProvider: false, injectedIdentity: true, checks: [], externalRequestsBlocked: [] };
const service = createSyntheticVoiceSessionService({ env: { NODE_ENV: 'test', DOCTARX_VOICE_SYNTHETIC_ENABLED: 'true' } });
let browser, child, server;
const log = fs.createWriteStream(path.join(ART, 'next-dev.log'));
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const pass = name => { evidence.checks.push(name); console.log(`VOICE PASS: ${name}`); };
async function main() {
  const app = express(); app.use(express.json());
  const auth = (req, res, next) => { if (req.headers.authorization !== `Bearer ${token}`) return res.status(401).json({ success: false }); req.user = actor; next(); };
  app.get('/api/auth/me', auth, (_req, res) => res.json({ success: true, user: actor }));
  app.get('/api/health', (_req, res) => res.json({ version: 'synthetic-voice-e2e' }));
  app.use('/api/voice-lab', createVoiceLabRouter({ authenticate: auth, service }));
  app.use('/api/voice-live', createVoiceLiveRouter({ authenticate: auth }));
  server = await new Promise(resolve => { const value = app.listen(0, '127.0.0.1', () => resolve(value)); });
  const apiOrigin = `http://127.0.0.1:${server.address().port}`;
  try { await fetch(ORIGIN, { signal: AbortSignal.timeout(500) }); throw new Error('Voice test port is occupied; refusing to reuse unknown process.'); } catch (error) { if (error.message.includes('occupied')) throw error; }
  child = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'dev', '-p', String(PORT), '-H', '127.0.0.1'], { cwd: ROOT, env: { ...process.env, NODE_ENV: 'development', NODE_OPTIONS: '--max-old-space-size=1024', NEXT_DIST_DIR: '.next-voice-lab', NEXT_PUBLIC_API_URL: '/api', DOCTARX_VOICE_SYNTHETIC_ENABLED: 'true', NEXT_TELEMETRY_DISABLED: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.pipe(log, { end: false }); child.stderr.pipe(log, { end: false });
  const deadline = Date.now() + 120000; let ready = false;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Next dev exited ${child.exitCode}`);
    try { const response = await fetch(`${ORIGIN}/voice-lab`, { signal: AbortSignal.timeout(4000) }); if (response.ok) { ready = true; break; } } catch { /* compile is pending */ }
    await delay(400);
  }
  assert.equal(ready, true, 'Next voice lab did not become ready');
  browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, serviceWorkers: 'block' });
  await context.addInitScript(({ token }) => { localStorage.setItem('accessToken', token); window.__voiceMicCalls = 0; navigator.mediaDevices.getUserMedia = async () => { window.__voiceMicCalls++; throw new Error('Real microphone forbidden in synthetic browser test'); }; }, { token });
  const page = await context.newPage(); const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', async route => {
    const request = route.request(); const url = new URL(request.url());
    if (url.origin !== ORIGIN) { evidence.externalRequestsBlocked.push(url.origin); return route.fulfill({ status: 200, contentType: request.resourceType() === 'stylesheet' ? 'text/css' : 'text/plain', body: '' }); }
    if (url.pathname.startsWith('/api/')) {
      const response = await fetch(apiOrigin + url.pathname + url.search, { method: request.method(), headers: { Authorization: request.headers().authorization || '', 'Content-Type': 'application/json' }, ...(request.postData() ? { body: request.postData() } : {}) });
      return route.fulfill({ status: response.status, headers: { 'content-type': 'application/json', 'cache-control': 'private, no-store' }, body: await response.text() });
    }
    return route.continue();
  });
  await page.goto(`${ORIGIN}/voice-lab`);
  await expect(page.getByRole('heading', { name: 'A conversation, in your language.' })).toBeVisible();
  await expect(page.getByText('Live speech not connected or language-tested')).toBeVisible();
  assert.equal(await page.getByRole('button', { name: 'Start live synthetic test' }).count(), 0);
  const consent = page.getByRole('checkbox', { name: /I understand this is a fictional test/ });
  const start = page.getByRole('button', { name: 'Start synthetic conversation' });
  await expect(start).toBeDisabled(); pass('Consent gate and honest unavailable live state');
  for (const [language, native] of [['ha', 'Sannu'], ['ig', 'Ndewo'], ['yo', 'Ẹ káàbọ̀']]) {
    await page.getByRole('combobox', { name: 'Text rehearsal language' }).selectOption(language);
    await consent.check(); await start.click();
    await page.getByRole('checkbox', { name: 'Animate text' }).uncheck();
    const advance = page.getByRole('button', { name: 'Advance text' }); await expect(advance).toBeEnabled(); await advance.click();
    await expect(page.getByLabel('Transcript').getByText(new RegExp(native))).toBeVisible();
    await expect(page.getByRole('button', { name: 'Report a headache' })).toBeEnabled(); await page.getByRole('button', { name: 'Report a headache' }).click();
    await expect(page.getByText('Simulated assistant · interrupted').first()).toBeVisible();
    await page.getByRole('button', { name: 'Say “yesterday”' }).click();
    await page.getByRole('button', { name: 'No medicine taken' }).click();
    await page.getByRole('button', { name: 'Prepare synthetic intake draft' }).click();
    await expect(page.getByText('Draft: awaiting demo review')).toBeVisible();
    await page.getByRole('button', { name: 'Mark demo review complete' }).click();
    await expect(page.getByText('Draft: reviewed demo')).toBeVisible();
    await page.getByRole('button', { name: 'Correct to “two days ago”' }).click();
    await expect(page.getByText('Draft: stale')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Mark demo review complete' })).toBeDisabled();
    await page.getByRole('button', { name: 'Prepare synthetic intake draft' }).click();
    await expect(page.getByLabel('Evidence review').getByText('No, it started two days ago.')).toBeVisible();
    await page.getByRole('button', { name: 'Pause', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Report a headache' })).toBeDisabled();
    await page.getByRole('button', { name: 'Resume', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Advance text' })).toBeDisabled();
    await page.getByRole('button', { name: 'Request an interpreter' }).click();
    await expect(page.getByText('Human assistance requested in the rehearsal.', { exact: false })).toBeVisible();
    if (language === 'yo') await page.screenshot({ path: path.join(ART, 'yoruba-workflow.png'), fullPage: true });
    await page.getByRole('button', { name: 'End and clear' }).click();
    await expect(start).toBeVisible(); assert.equal(await page.getByLabel('Transcript').count(), 0);
    pass(`${language}: streamed fixture, interruption, correction, review invalidation, pause/resume, interpreter and end`);
  }
  await consent.check(); await start.click(); await page.getByRole('button', { name: 'Withdraw demo consent' }).click();
  await expect(start).toBeDisabled(); pass('Consent withdrawal clears session and requires fresh acknowledgment');
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.querySelector('main').scrollWidth <= window.innerWidth), true);
  await page.screenshot({ path: path.join(ART, 'mobile-lab.png'), fullPage: true });
  const accessibility = await new AxeBuilder({ page }).include('main').analyze();
  fs.writeFileSync(path.join(ART, 'accessibility.json'), JSON.stringify(accessibility.violations, null, 2));
  assert.deepEqual(accessibility.violations.map(item => item.id), []);
  pass('Mobile layout and axe main-region accessibility');
  assert.equal(await page.evaluate(() => window.__voiceMicCalls), 0);
  assert.deepEqual(errors, []); pass('No microphone acquisition or browser runtime errors');
  fs.writeFileSync(path.join(ART, 'evidence.json'), JSON.stringify(evidence, null, 2));
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  await browser?.close(); service.close(); if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  if (child) { child.kill('SIGTERM'); await new Promise(resolve => { if (child.exitCode !== null) resolve(); else { child.once('exit', resolve); setTimeout(() => { child.kill('SIGKILL'); resolve(); }, 5000).unref(); } }); }
  log.end();
});
