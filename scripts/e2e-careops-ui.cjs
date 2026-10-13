'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const { chromium } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const speakeasy = require('speakeasy');

const target = process.env.SIMULATION_DATABASE_URL;
if (!target || !['localhost', '127.0.0.1'].includes(new URL(target).hostname) || !new URL(target).pathname.endsWith('_test')) throw new Error('Use a disposable loopback test database ending in _test.');
process.env.DATABASE_URL = target;
process.env.NODE_ENV = 'development';
process.env.JWT_ACCESS_SECRET = 'synthetic-careops-browser-jwt-secret-at-least-32-chars';
process.env.JWT_REFRESH_SECRET = 'synthetic-careops-browser-refresh-secret-at-least-32-chars';
process.env.ENCRYPTION_KEY ||= '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
process.env.NG_AUTO_SEED_DISCOVERY = 'false';
process.env.NEXT_PUBLIC_API_URL = 'http://127.0.0.1:18080/api';
const db = require('../server/db');
const { seedDemoAccounts } = require('../ng/scripts/seed-demo-accounts');
const outputDir = path.resolve(process.env.CAREOPS_UI_OUTPUT_DIR || path.join(__dirname, '..', 'work', 'careops-ui'));
fs.mkdirSync(outputDir, { recursive: true });

async function waitFor(url) {
  for (let attempt = 0; attempt < 90; attempt++) {
    try { if ((await fetch(url)).ok) return; } catch { /* startup */ }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error('CareOps preview did not become ready');
}

async function main() {
  const seeded = await seedDemoAccounts({ pool: db.getPool(), password: 'Synthetic-Browser-Pass-2099!', mfaSecret: 'JBSWY3DPEHPK3PXP' });
  const app = express();
  app.use(cors({ origin: 'http://127.0.0.1:3002', credentials: true }));
  app.use(cookieParser());
  app.use(express.json());
  app.use('/api/auth', require('../server/routes/auth'));
  app.use('/api/ng', require('../ng/routes'));
  app.use('/api/appointments', require('../server/routes/appointments'));
  app.use('/api/providers', require('../server/routes/providers'));
  app.use('/api/clinical-encounters', require('../server/routes/clinicalEncounters'));
  app.use('/api/medical-records', require('../server/routes/medicalRecords'));
  app.use((error, _req, res, _next) => res.status(500).json({ error: error.message }));
  const server = app.listen(18080, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const log = fs.openSync(path.join(outputDir, 'careops-next-preview.log'), 'w');
  const next = spawn(process.execPath, [require.resolve('next/dist/bin/next'), 'dev', '-p', '3002', '-H', '127.0.0.1'], {
    cwd: path.join(__dirname, '..'), env: { ...process.env, NEXT_DIST_DIR: '.next-careops-preview' }, windowsHide: true, stdio: ['ignore', log, log],
  });
  let browser;
  try {
    await waitFor('http://127.0.0.1:3002/careops/login');
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('http://127.0.0.1:3002/careops');
    await page.waitForURL('**/careops/login');
    await page.getByRole('heading', { name: 'Sign in to CareOps' }).waitFor();
    await page.keyboard.press('Tab');
    assert.match(await page.evaluate(() => document.activeElement.textContent), /Skip to (main content|workspace)/);
    await page.screenshot({ path: path.join(outputDir, 'CareOps sign-in desktop.png'), fullPage: true });
    await page.getByLabel('Email', { exact: true }).fill('nurse@demo.doctarx.com');
    await page.getByLabel('Password', { exact: true }).fill('Synthetic-Browser-Pass-2099!');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await page.waitForURL('**/careops');
    await page.getByRole('heading', { name: 'Clinical workspace', exact: true }).waitFor();
    await page.getByRole('tab', { name: 'Patient intake', exact: true }).waitFor();
    // Scan the settled screen after disabled-state opacity transitions finish.
    await page.getByRole('button', { name: 'Refresh worklists' }).waitFor({ state: 'visible' });
    await page.waitForFunction(() => !Array.from(document.querySelectorAll('button')).find((button) => button.textContent.includes('Refresh worklists'))?.disabled);
    await page.getByRole('button', { name: 'Refresh worklists' }).evaluate((button) => Promise.all(button.getAnimations().map((animation) => animation.finished)));
    const clinicalAccessibility = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
    fs.writeFileSync(path.join(outputDir, 'clinical-accessibility.json'), JSON.stringify({ violations: clinicalAccessibility.violations.map(({ id, impact, description, nodes }) => ({ id, impact, description, nodes: nodes.map(({ target, html, failureSummary }) => ({ target, html, failureSummary })) })) }, null, 2));
    await page.screenshot({ path: path.join(outputDir, 'CareOps clinical desktop.png'), fullPage: true });
    assert.equal(clinicalAccessibility.violations.filter((violation) => ['serious', 'critical'].includes(violation.impact)).length, 0, 'Clinical accessibility has serious violations');
    assert.equal(await page.locator('main p').first().evaluate((element) => getComputedStyle(element).fontSize), '16px');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: path.join(outputDir, 'CareOps clinical mobile.png'), fullPage: true });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1), false, 'CareOps must not overflow the mobile viewport');
    await page.goto('http://127.0.0.1:3002/careops/partners');
    await page.getByText('No active funding-administration assignment. Contact your programme administrator.').waitFor();
    // A clinical user cannot acquire financial privileges through navigation.
    assert.equal(await page.getByRole('button', { name: 'Add for review' }).count(), 0);
    await context.close();

    const government = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const govPage = await government.newPage();
    await govPage.goto('http://127.0.0.1:3002/careops/login');
    await govPage.getByLabel('Workspace', { exact: true }).selectOption('/careops/government');
    await govPage.getByLabel('Email', { exact: true }).fill('government@demo.doctarx.com');
    await govPage.getByLabel('Password', { exact: true }).fill('Synthetic-Browser-Pass-2099!');
    await govPage.getByRole('button', { name: 'Sign in', exact: true }).click();
    await govPage.getByLabel('Authenticator code').waitFor();
    await govPage.getByLabel('Authenticator code').fill(speakeasy.totp({ secret: 'JBSWY3DPEHPK3PXP', encoding: 'base32' }));
    await govPage.getByRole('button', { name: 'Sign in', exact: true }).click();
    await govPage.waitForURL('**/careops/government');
    await govPage.getByRole('heading', { name: /Government/i }).first().waitFor();
    const governmentAccessibility = await new AxeBuilder({ page: govPage }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
    fs.writeFileSync(path.join(outputDir, 'government-accessibility.json'), JSON.stringify({ violations: governmentAccessibility.violations.map(({ id, impact, description, nodes }) => ({ id, impact, description, targets: nodes.map((node) => node.target) })) }, null, 2));
    assert.equal(governmentAccessibility.violations.filter((violation) => ['serious', 'critical'].includes(violation.impact)).length, 0, 'Government accessibility has serious violations');
    await govPage.screenshot({ path: path.join(outputDir, 'CareOps government desktop.png'), fullPage: true });
    await govPage.setViewportSize({ width: 390, height: 844 });
    assert.equal(await govPage.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1), false, 'Government workspace must not overflow mobile width');
    await govPage.goto('http://127.0.0.1:3002/careops/delivery');
    await govPage.getByRole('heading', { name: 'Reports and DHIS2 delivery' }).waitFor();
    await govPage.waitForFunction(() => !document.querySelector('[role="status"]')?.textContent?.includes('Loading authorised'));
    assert.equal(await govPage.getByRole('button', { name: 'Submit approved report' }).count(), 0);
    const deniedFhir = await govPage.request.get(`http://127.0.0.1:18080/api/ng/interop/fhir/Encounter/${seeded.demoProgramme.facilityId}?programmeId=${seeded.demoProgramme.programmeId}&facilityId=${seeded.demoProgramme.facilityId}`);
    assert.equal(deniedFhir.status(), 403, 'Government membership must not grant clinical FHIR access');
    const deniedNational = await govPage.request.get('http://127.0.0.1:18080/api/ng/public-health/analytics');
    assert.equal(deniedNational.status(), 403, 'Scoped analyst must not read legacy national analytics');
    assert.equal(errors.length, 0, errors.join('\n'));
    await government.close();
    console.log(JSON.stringify({ passed: ['unauthenticated redirect', 'clinical sign-in', 'nurse role navigation', 'readable typography', 'mobile width', 'financial privilege denial', 'government MFA sign-in', 'clinical and government accessibility', 'clinical FHIR denied to government', 'national analytics denied to scoped analyst', 'scoped delivery workspace'], screenshots: 4 }));
  } finally {
    if (browser) await browser.close();
    next.kill(); fs.closeSync(log);
    await new Promise((resolve) => server.close(resolve));
    await db.close();
  }
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });
