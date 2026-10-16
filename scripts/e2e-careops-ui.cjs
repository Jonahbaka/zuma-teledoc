'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { spawn, spawnSync } = require('node:child_process');
const { chromium } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const speakeasy = require('speakeasy');
const bcrypt = require('bcryptjs');

const target = process.env.SIMULATION_DATABASE_URL;
const standaloneProfile = process.env.CAREOPS_PROFILE_E2E === 'true';
const productionProfile = standaloneProfile && process.env.CAREOPS_PROFILE_PRODUCTION_E2E === 'true';
if (!target || !['localhost', '127.0.0.1'].includes(new URL(target).hostname) || !new URL(target).pathname.endsWith('_test')) throw new Error('Use a disposable loopback test database ending in _test.');
process.env.DATABASE_URL = target;
process.env.NODE_ENV = 'development';
process.env.JWT_ACCESS_SECRET = 'synthetic-careops-browser-jwt-secret-at-least-32-chars';
process.env.JWT_REFRESH_SECRET = 'synthetic-careops-browser-refresh-secret-at-least-32-chars';
process.env.ENCRYPTION_KEY ||= '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
process.env.NG_AUTO_SEED_DISCOVERY = 'false';
process.env.NEXT_PUBLIC_API_URL = standaloneProfile ? '/api' : 'http://127.0.0.1:18080/api';
if (standaloneProfile) Object.assign(process.env, {
  DOCTARX_PRODUCT_PROFILE: 'careops', NEXT_PUBLIC_DOCTARX_PRODUCT_PROFILE: 'careops',
  NEXT_PUBLIC_APP_URL: 'http://127.0.0.1:3002', DOCTARX_API_PROXY_TARGET: 'http://127.0.0.1:18080/api',
  AUTH_COOKIE_DOMAIN_MODE: 'host-only',
});
const db = require('../server/db');
const { listUserProgrammeContexts } = require('../ng/services/phc/programmeScopeService');
const demoPassword = process.env.CAREOPS_E2E_PASSWORD;
if (!demoPassword) throw new Error('CAREOPS_E2E_PASSWORD must match the provisioned demo accounts; this preview never resets credentials.');
const outputDir = path.resolve(process.env.CAREOPS_UI_OUTPUT_DIR || path.join(__dirname, '..', 'work', 'careops-ui'));
fs.mkdirSync(outputDir, { recursive: true });

async function waitFor(url) {
  for (let attempt = 0; attempt < 90; attempt++) {
    try { if ((await fetch(url)).ok) return; } catch { /* startup */ }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error('CareOps preview did not become ready');
}

async function settleVisuals(page) {
  await page.evaluate(async () => {
    await Promise.race([Promise.all([document.fonts.ready,...Array.from(document.images).map((image)=>image.decode())]),new Promise((_resolve,reject)=>setTimeout(()=>reject(new Error('The page visual assets did not settle within 15 seconds.')),15000))]);
  });
}

async function main() {
  // Reuse provisioned demo accounts. Browser inspection does not create or
  // rename facilities/patients and never resets an account's password.
  const account = (await db.getPool().query("SELECT id,role,password_hash FROM users WHERE email='nurse@demo.doctarx.com' AND is_active=true")).rows[0];
  if (!account) throw new Error('Provision the existing DoctaRx demo accounts before browser testing.');
  const governmentAccount=(await db.getPool().query("SELECT password_hash FROM users WHERE email='government@demo.doctarx.com' AND is_active=true")).rows[0];
  if (!governmentAccount || !await bcrypt.compare(demoPassword,account.password_hash) || !await bcrypt.compare(demoPassword,governmentAccount.password_hash)) throw new Error('The configured preview password does not match the existing demo accounts. No sign-in attempts or credential changes were made.');
  const existingContext = (await listUserProgrammeContexts(db.getPool(), account))[0];
  if (!existingContext) throw new Error('The existing nurse demo account needs its programme/facility assignment.');
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
  const next = spawn(process.execPath, productionProfile ? [path.join(__dirname, 'careops-profile.cjs'), 'start'] : [require.resolve('next/dist/bin/next'), 'dev', '-p', '3002', '-H', '127.0.0.1'], {
    cwd: path.join(__dirname, '..'), env: { ...process.env, ...(productionProfile ? { NODE_ENV: 'production', PORT: '3002', CAREOPS_HOST: '127.0.0.1' } : {}), NEXT_DIST_DIR: productionProfile ? '.next-careops' : standaloneProfile ? '.next-careops-profile-preview' : '.next-careops-preview' }, windowsHide: true, stdio: ['ignore', log, log],
  });
  let browser;
  try {
    await waitFor('http://127.0.0.1:3002/careops/login');
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('http://127.0.0.1:3002/careops',{waitUntil:'commit'});
    await page.waitForURL(url => url.pathname === '/careops/login',{waitUntil:'commit'});
    if (standaloneProfile) {
      const entry = await context.request.get('http://127.0.0.1:3002/', { maxRedirects: 0 });
      assert.equal(entry.status(), 307); assert.equal(entry.headers().location, '/careops');
      const loginDocument = await context.request.get('http://127.0.0.1:3002/careops/login');
      assert.equal(loginDocument.headers()['x-doctarx-product'], 'careops');
      const manifest = await context.request.get('http://127.0.0.1:3002/careops/manifest.webmanifest');
      const install = await manifest.json(); assert.equal(install.name, 'DoctaRx CareOps'); assert.equal(install.start_url, '/careops');
      const release = await context.request.get('http://127.0.0.1:3002/careops/release'); assert.equal((await release.json()).product, 'careops');
      assert.equal(await page.locator('meta[name="application-name"]').first().getAttribute('content'), 'DoctaRx CareOps');
    }
    await page.getByRole('heading', { name: 'Sign in to CareOps' }).waitFor();
    await page.getByRole('button', { name: 'Sign in', exact: true }).waitFor();
    await page.keyboard.press('Tab');
    assert.match(await page.evaluate(() => document.activeElement.textContent), /Skip to (main content|workspace)/);
    await page.keyboard.press('Escape');
    await page.getByRole('heading', { name: 'Sign in to CareOps' }).click();
    await settleVisuals(page);
    await page.screenshot({ path: path.join(outputDir, 'CareOps sign-in desktop.png'), fullPage: true });
    await page.getByLabel('Email', { exact: true }).fill('nurse@demo.doctarx.com');
    await page.getByLabel('Password', { exact: true }).fill(demoPassword);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await page.waitForURL('**/careops',{waitUntil:'commit'});
    await page.getByRole('heading', { name: 'Clinical workspace', exact: true }).waitFor();
    await page.getByRole('tab', { name: 'Patient intake', exact: true }).waitFor();
    // Scan the settled screen after disabled-state opacity transitions finish.
    await page.getByRole('button', { name: 'Refresh worklists' }).waitFor({ state: 'visible' });
    await page.waitForFunction(() => !Array.from(document.querySelectorAll('button')).find((button) => button.textContent.includes('Refresh worklists'))?.disabled);
    await page.getByRole('button', { name: 'Refresh worklists' }).evaluate((button) => Promise.all(button.getAnimations().map((animation) => animation.finished)));
    await settleVisuals(page);
    const clinicalAccessibility = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
    fs.writeFileSync(path.join(outputDir, 'clinical-accessibility.json'), JSON.stringify({ violations: clinicalAccessibility.violations.map(({ id, impact, description, nodes }) => ({ id, impact, description, nodes: nodes.map(({ target, html, failureSummary }) => ({ target, html, failureSummary })) })) }, null, 2));
    await page.screenshot({ path: path.join(outputDir, 'CareOps clinical desktop.png'), fullPage: true });
    assert.equal(clinicalAccessibility.violations.filter((violation) => ['serious', 'critical'].includes(violation.impact)).length, 0, 'Clinical accessibility has serious violations');
    assert.equal(await page.locator('main p').first().evaluate((element) => getComputedStyle(element).fontSize), '16px');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: path.join(outputDir, 'CareOps clinical mobile.png'), fullPage: true });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1), false, 'CareOps must not overflow the mobile viewport');
    await page.goto('http://127.0.0.1:3002/careops/insurance',{waitUntil:'commit'});
    await page.getByText('Insurance administration access is required. Contact your programme administrator.').waitFor();
    // A clinical user cannot acquire financial privileges through navigation.
    assert.equal(await page.getByRole('button', { name: 'Add for review' }).count(), 0);
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await page.waitForURL(url => url.pathname === '/careops/login',{waitUntil:'commit'});
    await context.close();

    const government = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const govPage = await government.newPage();
    govPage.on('pageerror', (error) => errors.push(error.message));
    await govPage.goto('http://127.0.0.1:3002/careops/login',{waitUntil:'commit'});
    await govPage.getByLabel('Workspace', { exact: true }).selectOption('/careops/government');
    await govPage.getByLabel('Email', { exact: true }).fill('government@demo.doctarx.com');
    await govPage.getByLabel('Password', { exact: true }).fill(demoPassword);
    await govPage.getByRole('button', { name: 'Sign in', exact: true }).click();
    await govPage.getByLabel('Authenticator code').waitFor();
    assert.equal(await govPage.getByLabel('Workspace', { exact: true }).inputValue(), '/careops/government', 'MFA challenge must preserve the selected workspace');
    await govPage.getByLabel('Authenticator code').fill(speakeasy.totp({ secret: 'JBSWY3DPEHPK3PXP', encoding: 'base32' }));
    await govPage.getByRole('button', { name: 'Sign in', exact: true }).click();
    await govPage.waitForURL('**/careops/government',{waitUntil:'commit'});
    await govPage.getByRole('heading', { name: 'Public health data' }).waitFor();
    await settleVisuals(govPage);
    const governmentAccessibility = await new AxeBuilder({ page: govPage }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
    fs.writeFileSync(path.join(outputDir, 'government-accessibility.json'), JSON.stringify({ violations: governmentAccessibility.violations.map(({ id, impact, description, nodes }) => ({ id, impact, description, targets: nodes.map((node) => node.target) })) }, null, 2));
    assert.equal(governmentAccessibility.violations.filter((violation) => ['serious', 'critical'].includes(violation.impact)).length, 0, 'Government accessibility has serious violations');
    await govPage.screenshot({ path: path.join(outputDir, 'CareOps government desktop.png'), fullPage: true });
    await govPage.setViewportSize({ width: 390, height: 844 });
    assert.equal(await govPage.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1), false, 'Government workspace must not overflow mobile width');
    await govPage.goto('http://127.0.0.1:3002/careops/delivery',{waitUntil:'commit'});
    await govPage.getByRole('heading', { name: 'Reports and DHIS2 delivery' }).waitFor();
    await govPage.waitForFunction(() => !document.querySelector('[role="status"]')?.textContent?.includes('Loading authorised'));
    assert.equal(await govPage.getByRole('button', { name: 'Submit approved report' }).count(), 0);
    await govPage.goto('http://127.0.0.1:3002/ng/executive-view',{waitUntil:'commit'});
    await govPage.getByRole('heading', { name: 'Executive command center' }).waitFor();
    assert.equal(await govPage.getByRole('tab', { name: 'Data management' }).count(), 0);
    assert.equal(await govPage.getByRole('button', { name: 'Excel', exact: true }).count(), 0);
    const executiveAlerts = govPage.locator('main [role="alert"]');
    assert.equal(await executiveAlerts.count(), 0, `Approved-record executive view must load scoped reference data: ${(await executiveAlerts.allTextContents()).join('; ')}`);
    const deniedFhir = await govPage.request.get(`http://127.0.0.1:18080/api/ng/interop/fhir/Encounter/${existingContext.facility_id}?programmeId=${existingContext.programme_id}&facilityId=${existingContext.facility_id}`);
    assert.equal(deniedFhir.status(), 403, 'Government membership must not grant clinical FHIR access');
    const deniedNational = await govPage.request.get('http://127.0.0.1:18080/api/ng/public-health/analytics');
    assert.equal(deniedNational.status(), 403, 'Scoped analyst must not read legacy national analytics');
    assert.equal(errors.length, 0, errors.join('\n'));
    await government.close();
    console.log(JSON.stringify({ profile: standaloneProfile ? 'careops' : 'main', productionProfile, apiMode: standaloneProfile ? 'same-origin-shared-api-proxy' : 'existing-api-origin', passed: ['unauthenticated redirect', 'clinical sign-in', 'nurse role navigation', 'readable typography', 'mobile width', 'insurance administration privilege denial', 'CareOps logout return', 'government MFA sign-in', 'clinical and government accessibility', 'clinical FHIR denied to government', 'national analytics denied to scoped analyst', 'scoped delivery workspace', 'read-only approved-record executive view'], screenshots: 4 }));
  } catch (error) {
    if (browser) {
      const pages=browser.contexts().flatMap(context=>context.pages());
      for (const [index,page] of pages.entries()) {
        await page.screenshot({path:path.join(outputDir,`failure-${index}.png`),fullPage:true,timeout:5000}).catch(()=>{});
        const alerts=await page.locator('[role="alert"]').allTextContents().catch(()=>[]);
        fs.writeFileSync(path.join(outputDir,`failure-${index}.json`),JSON.stringify({url:page.url(),alerts,error:error.message},null,2));
      }
    }
    throw error;
  } finally {
    if (browser) await browser.close();
    if (process.platform==='win32') spawnSync('taskkill',['/PID',String(next.pid),'/T','/F'],{stdio:'ignore',windowsHide:true});
    else next.kill();
    fs.closeSync(log);
    await new Promise((resolve) => server.close(resolve));
    await db.close();
  }
}
main().catch(async(error) => { console.error(error.message); await db.close().catch(()=>{}); process.exitCode = 1; });
