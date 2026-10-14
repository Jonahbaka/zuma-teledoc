'use strict';

// Read-only public UI verification against the actual API and isolated database.
// Device coordinates are browser permission emulation. Directory rows are never
// injected, seeded, renamed, or filtered to construct a product demonstration.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { chromium } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');

const target = process.env.SIMULATION_DATABASE_URL;
if (!target || !['localhost', '127.0.0.1'].includes(new URL(target).hostname) || !new URL(target).pathname.endsWith('_test')) throw new Error('Use an isolated loopback database ending in _test.');
process.env.DATABASE_URL = target;
process.env.NODE_ENV = 'development';
process.env.JWT_ACCESS_SECRET = 'doctarx-public-browser-test-access-secret-at-least-32-characters';
process.env.JWT_REFRESH_SECRET = 'doctarx-public-browser-test-refresh-secret-at-least-32-characters';
process.env.ENCRYPTION_KEY ||= '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
process.env.NG_AUTO_SEED_DISCOVERY = 'false';
process.env.DISABLE_SCHEDULERS = 'true';
const reuse = Boolean(process.env.PUBLIC_PLATFORM_EXISTING_WEB_URL || process.env.PUBLIC_PLATFORM_EXISTING_API_URL);
const web = process.env.PUBLIC_PLATFORM_EXISTING_WEB_URL || 'http://127.0.0.1:3005';
const api = process.env.PUBLIC_PLATFORM_EXISTING_API_URL || 'http://127.0.0.1:18083/api';
if (reuse) {
  assert.ok(process.env.PUBLIC_PLATFORM_EXISTING_WEB_URL && process.env.PUBLIC_PLATFORM_EXISTING_API_URL, 'Provide both existing loopback preview URLs.');
  for (const value of [web, api]) {
    const parsed = new URL(value);
    assert.ok(parsed.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(parsed.hostname) && !parsed.username && !parsed.password && !parsed.search && !parsed.hash, 'Only a plain loopback preview can be reused.');
  }
  assert.equal(new URL(web).pathname, '/'); assert.equal(new URL(api).pathname, '/api');
}
process.env.NEXT_PUBLIC_API_URL = api;
const db = require('../server/db');
const output = path.resolve(process.env.PUBLIC_PLATFORM_UI_OUTPUT_DIR || 'work/public-platform-ui');
fs.mkdirSync(output, { recursive: true });
const findings = [];
const captures = [];
const runtime = [];
const directoryChecks = [];
const requests = [];
const scopes = [
  { market: 'US', home: '/', directory: '/pharmacies', city: 'Juneau', state: 'AK', workCity: 'Anchorage', workState: 'AK', point: { latitude: 58.3019, longitude: -134.4197 } },
  { market: 'NG', home: '/ng', directory: '/ng/pharmacies', city: 'Damaturu', state: 'Yobe', workCity: 'Potiskum', workState: 'Yobe', point: { latitude: 11.7469, longitude: 11.9608 } },
];

function check(condition, message, details) {
  if (!condition) findings.push({ message, ...(details ? { details } : {}) });
}

async function waitFor(url) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try { if ((await fetch(url)).ok) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  throw new Error('Public platform preview did not start.');
}

async function settle(page) {
  await page.waitForFunction(() => document.querySelector('main') && ![...document.querySelectorAll('main [role="status"]')].some(element => /^(Finding your device location|Searching the pharmacy directory|Loading|Checking secure access)/i.test(element.textContent.trim())), null, { timeout: 90000 });
  await page.evaluate(async () => { await document.fonts.ready; await Promise.all([...document.images].map(image => image.decode().catch(() => undefined))); });
}

async function capture(page, name) {
  await settle(page);
  const typography = await page.evaluate(() => [...document.querySelectorAll('main *,header *,nav *,footer *,aside *')].filter(element => {
    const box = element.getBoundingClientRect(), style = getComputedStyle(element);
    return box.width > 2 && box.height > 2 && style.visibility !== 'hidden' && style.display !== 'none' && [...element.childNodes].some(node => node.nodeType === Node.TEXT_NODE && node.textContent.trim()) && parseFloat(style.fontSize) < 16;
  }).map(element => ({ text: element.textContent.trim().slice(0, 90), tag: element.tagName, size: getComputedStyle(element).fontSize })));
  check(typography.length === 0, name + ': all visible text must be at least 16px.', typography);
  const widths = await page.evaluate(() => ({ document: document.documentElement.scrollWidth, viewport: innerWidth }));
  check(widths.document <= widths.viewport + 1, name + ': page must fit its viewport.', widths);
  const clippedControls = await page.evaluate(() => [...document.querySelectorAll('header a,header button,main input,main select,main button,footer a')].filter(element => {
    const box = element.getBoundingClientRect(), style = getComputedStyle(element);
    return box.width > 2 && box.height > 2 && style.visibility !== 'hidden' && style.display !== 'none' && (box.left < -1 || box.right > innerWidth + 1);
  }).map(element => ({ text: element.textContent.trim().slice(0, 80), left: element.getBoundingClientRect().left, right: element.getBoundingClientRect().right })));
  check(clippedControls.length === 0, name + ': interactive controls must not be clipped by overflow suppression.', clippedControls);
  const bodyFont = await page.evaluate(() => getComputedStyle(document.body).fontFamily);
  check(!/Times New Roman/i.test(bodyFont), name + ': the shared sans font token must resolve.', { bodyFont });
  const publicHeadingFonts = await page.evaluate(() => [...document.querySelectorAll('.doctarx-site :is(h1,h2,h3,h4), footer h2')].map(element => ({ text: element.textContent.trim(), font: getComputedStyle(element).fontFamily })).filter(element => !/DM Sans|ui-sans-serif|system-ui/.test(element.font)));
  check(publicHeadingFonts.length === 0, name + ': public and footer headings use the shared readable sans font.', publicHeadingFonts);
  const images = await page.evaluate(() => [...document.images].map(image => ({ src: image.getAttribute('src'), alt: image.alt, loaded: image.complete && image.naturalWidth > 0 })));
  check(images.every(image => image.loaded), name + ': every image must load.', images.filter(image => !image.loaded));
  const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  const accessibility = axe.violations.map(({ id, impact, nodes }) => ({ id, impact, nodes: nodes.map(({ target, failureSummary }) => ({ target, failureSummary })) }));
  fs.writeFileSync(path.join(output, name + ' accessibility.json'), JSON.stringify(accessibility, null, 2));
  check(!accessibility.some(item => ['serious', 'critical'].includes(item.impact)), name + ': no serious or critical accessibility failures.', accessibility);
  await page.screenshot({ path: path.join(output, name + '.png'), fullPage: true });
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await page.screenshot({ path: path.join(output, name + ' viewport.png'), fullPage: false });
  captures.push({ name, images, widths, bodyFont, typographyMinimum: typography.length ? Math.min(...typography.map(item => parseFloat(item.size))) : 16 });
  console.log('Checked:', name);
}

async function chooseArea(page, scope, label) {
  const picker = page.getByRole('region', { name: 'Care discovery location', exact: true });
  await picker.getByRole('button', { name: 'Change location', exact: true }).click();
  await picker.getByRole('combobox').selectOption(label);
  await picker.getByLabel('City or town', { exact: true }).fill(label === 'Work' ? scope.workCity : scope.city);
  await picker.getByLabel('State or region', { exact: true }).fill(label === 'Work' ? scope.workState : scope.state);
  await picker.getByLabel('Postal code', { exact: true }).fill('');
  await picker.getByRole('button', { name: 'Use this area', exact: true }).click();
  await picker.getByText(label + ': ' + (label === 'Work' ? scope.workCity + ', ' + scope.workState : scope.city + ', ' + scope.state), { exact: true }).waitFor();
  const saved = await page.evaluate(market => JSON.parse(sessionStorage.getItem('doctarx-care-location:' + market)), scope.market);
  assert.equal(saved.mode, 'manual'); assert.equal(saved.label, label);
  assert.equal('latitude' in saved, false); assert.equal('longitude' in saved, false);
  return saved;
}

function matchesDirectory(request, scope) {
  return request.url().startsWith(api + (scope.market === 'US' ? '/directory/pharmacies' : '/ng/discovery/providers'));
}

async function navigateDirectory(page, scope) {
  const received = page.waitForResponse(response => matchesDirectory(response.request(), scope));
  await page.locator('main').getByRole('link', { name: 'Find pharmacies', exact: true }).click();
  await page.waitForURL(web + scope.directory + '**');
  await page.getByRole('heading', { level: 1, name: 'Pharmacies near you.', exact: true }).waitFor();
  return received;
}

async function confirmEmpty(page, response, scope, name) {
  const payload = await response.json();
  const rows = scope.market === 'US' ? payload.pharmacies : payload.providers;
  assert.equal(response.ok(), true, name + ': actual directory API must succeed.');
  assert.ok(Array.isArray(rows), name + ': actual directory response must contain a list.');
  // The selected real geographic areas must have no rows in the isolated
  // registry. If that changes, stop instead of hiding business/test entities.
  assert.equal(rows.length, 0, name + ': use a genuinely empty area; do not filter or rename existing rows for screenshots.');
  await page.getByText('No pharmacies were returned for this search. You can enter pharmacy details below.', { exact: true }).waitFor();
  check(await page.locator('main .portal-error [role="alert"]').count() === 0, name + ': confirmed empty is distinct from failure.');
  const sent = scope.market === 'US' ? response.request().postDataJSON() : Object.fromEntries(new URL(response.url()).searchParams);
  assert.equal('latitude' in sent, false); assert.equal('longitude' in sent, false);
  assert.equal(sent.city, scope.city); assert.equal(sent.state, scope.state);
  directoryChecks.push({ market: scope.market, status: response.status(), actualRows: rows.length, area: { city: sent.city, state: sent.state }, gpsCleared: true });
  await capture(page, name);
}

async function publicScope(browser, scope, width) {
  const size = width === 390 ? 'mobile' : 'desktop';
  const context = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 1000 }, geolocation: scope.point });
  context.setDefaultNavigationTimeout(90000); context.setDefaultTimeout(90000);
  const page = await context.newPage();
  page.on('pageerror', error => { runtime.push({ route: page.url(), message: error.message, stack: error.stack }); console.error('Public runtime:', error.stack || error.message); });
  page.on('request', request => { if (request.url().startsWith(api)) requests.push({ method: request.method(), path: new URL(request.url()).pathname }); });
  try {
    await page.goto(web + scope.home);
    await page.getByRole('heading', { level: 1, name: /Good care\.\s*Closer to you\./ }).waitFor();
    await page.getByText('Device location is unavailable. Choose an area to continue.', { exact: true }).waitFor();
    check(await page.getByText('Using your device location', { exact: true }).count() === 0, scope.market + ': denied permission must not claim a device location.');
    check(await page.getByRole('contentinfo').count() === 1, scope.market + ': public homepage has one shared footer.');
    check(await page.locator('main img[alt="Illustration of a clinician listening during a virtual consultation"]').count() === 1, scope.market + ': hero uses the actual illustration with accessible text.');
    const footer = page.getByRole('contentinfo');
    assert.equal(await footer.getByRole('link', { name: 'Find pharmacies', exact: true }).getAttribute('href'), scope.directory);
    assert.equal(await footer.getByRole('link', { name: 'Patient sign in', exact: true }).getAttribute('href'), (scope.market === 'NG' ? '/ng/patient' : '/patient') + '/login');
    assert.equal(await footer.getByRole('link', { name: 'DoctaRx CareOps', exact: true }).getAttribute('href'), '/careops/login');
    await capture(page, 'DoctaRx ' + scope.market + ' homepage ' + size);
    if (width === 390) {
      await page.getByRole('button', { name: 'Open main navigation', exact: true }).click();
      await page.getByRole('navigation', { name: 'Mobile primary navigation', exact: true }).waitFor();
      await capture(page, 'DoctaRx ' + scope.market + ' navigation ' + size);
      await page.keyboard.press('Escape');
      assert.equal(await page.getByRole('button', { name: 'Open main navigation', exact: true }).getAttribute('aria-expanded'), 'false');
    }
    await page.goto(web + scope.directory);
    await page.getByText('Device location is unavailable. Choose an area to continue.', { exact: true }).waitFor();
    check(await page.getByText('No pharmacies were returned for this search. You can enter pharmacy details below.', { exact: true }).count() === 0, scope.market + ': denied location cannot be a confirmed empty lookup.');
    await capture(page, 'DoctaRx ' + scope.market + ' pharmacies location choice ' + size);
    await page.getByRole('link', { name: 'Home', exact: true }).click();
    await page.waitForURL(web + scope.home);
    await context.grantPermissions(['geolocation'], { origin: web });
    await page.getByRole('button', { name: 'Use my location', exact: true }).click();
    await page.getByText('Using your device location', { exact: true }).waitFor();
    const gps = new URL(await page.locator('main').getByRole('link', { name: 'Find pharmacies', exact: true }).getAttribute('href'), web);
    assert.equal(gps.searchParams.has('latitude'), false, 'Precise coordinates must stay out of navigation history and page-view URLs.');
    assert.equal(gps.searchParams.has('longitude'), false);
    await chooseArea(page, scope, 'Home');
    const manual = new URL(await page.locator('main').getByRole('link', { name: 'Find pharmacies', exact: true }).getAttribute('href'), web);
    assert.equal(manual.searchParams.has('latitude'), false); assert.equal(manual.searchParams.has('longitude'), false);
    await confirmEmpty(page, await navigateDirectory(page, scope), scope, 'DoctaRx ' + scope.market + ' pharmacies confirmed empty ' + size);
    check(await page.getByRole('contentinfo').count() === 1, scope.market + ': public directory has the shared footer.');

    const pattern = api + (scope.market === 'US' ? '/directory/pharmacies' : '/ng/discovery/providers') + '**';
    // Abort transport, never replace a response with fabricated product rows.
    await page.route(pattern, route => route.abort('failed'));
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: 'The pharmacy directory could not be reached.' }).waitFor();
    check(await page.getByText('No pharmacies were returned for this search. You can enter pharmacy details below.', { exact: true }).count() === 0, scope.market + ': transport outage cannot be shown as empty.');
    await capture(page, 'DoctaRx ' + scope.market + ' pharmacies unavailable ' + size);
    await page.unroute(pattern);
    const recovery = page.waitForResponse(response => matchesDirectory(response.request(), scope));
    await page.getByRole('button', { name: 'Try again', exact: true }).click();
    await confirmEmpty(page, await recovery, scope, 'DoctaRx ' + scope.market + ' pharmacies recovered ' + size);
    await page.getByRole('link', { name: 'Home', exact: true }).click();
    await page.waitForURL(web + scope.home);
    await page.getByText('Home: ' + scope.city + ', ' + scope.state, { exact: true }).waitFor();
    await chooseArea(page, scope, 'Work');
    await page.locator('main').getByRole('link', { name: 'Find pharmacies', exact: true }).click();
    await page.waitForURL(web + scope.directory + '**');
    await page.getByText('Work: ' + scope.workCity + ', ' + scope.workState, { exact: true }).waitFor();
    await page.getByRole('link', { name: 'Home', exact: true }).click();
    await page.waitForURL(web + scope.home);
    await page.getByText('Work: ' + scope.workCity + ', ' + scope.workState, { exact: true }).waitFor();
    console.log('Location preferences retained:', scope.market, size);
  } finally { await context.close(); }
}

async function videoPreflight(browser) {
  if (process.env.PUBLIC_PLATFORM_VIDEO_PREFLIGHT === 'false') return { checked: false, reason: 'Explicitly disabled; main platform script owns full verification.' };
  const account = (await db.getPool().query("SELECT email FROM users WHERE email=$1 AND role='provider' AND is_active=true", [process.env.PUBLIC_PLATFORM_E2E_PROVIDER || 'doctor@demo.doctarx.com'])).rows[0];
  assert.ok(account, 'Use an existing active demo provider for the preflight check.');
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  context.setDefaultNavigationTimeout(90000); context.setDefaultTimeout(90000);
  try {
    const login = await context.request.post(api + '/auth/login', { data: { email: account.email, password: process.env.CAREOPS_E2E_PASSWORD || 'Demo12345678!', role: 'provider' } });
    assert.equal(login.ok(), true, 'The existing provider must authenticate; no account reset is performed.');
    const session = await login.json(); assert.equal(session.success, true);
    const page = await context.newPage();
    page.on('pageerror', error => runtime.push({ route: page.url(), message: error.message, stack: error.stack }));
    const writes = [];
    page.on('request', request => { if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method()) && request.url().includes('/conference/')) writes.push(new URL(request.url()).pathname); });
    await page.addInitScript(session => { localStorage.setItem('accessToken', session.accessToken); localStorage.setItem('refreshToken', session.refreshToken); localStorage.setItem('user', JSON.stringify(session.user)); }, session);
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
      await page.goto(web + '/ng/provider/call');
      await page.getByRole('button', { name: 'Start New Consultation', exact: true }).waitFor();
      await capture(page, 'DoctaRx video preflight ' + (width === 390 ? 'mobile' : 'desktop'));
      check(await page.evaluate(() => [...document.querySelectorAll('video,audio')].every(element => !element.srcObject)), 'Denied camera permission must not attach a live stream.');
    }
    assert.deepEqual(writes, [], 'Preflight is read-only; do not create or join a conference.');
    return { checked: true, actualProviderAuthentication: true, conferenceWrites: false, cameraPermission: 'Not granted; unavailable preview checked.', liveSfuAcceptance: false };
  } finally { await context.close(); }
}

async function businessCounts() {
  const result = await db.getPool().query(`SELECT (SELECT COUNT(*) FROM users)::integer AS users,
    (SELECT COUNT(*) FROM pharmacy_network)::integer AS us_pharmacies,
    (SELECT COUNT(*) FROM ng_pharmacies)::integer AS ng_pharmacies,
    (SELECT COUNT(*) FROM ng_provider_match_groups)::integer AS directory_groups`);
  return result.rows[0];
}

async function main() {
  const before = await businessCounts();
  let server; let log; let next;
  if (!reuse) {
    const app = express();
    app.use(cors({ origin: web, credentials: true })); app.use(cookieParser()); app.use(express.json({ limit: '10mb' }));
    app.use('/api/directory', require('../server/routes/publicDirectory'));
    for (const file of ['auth', 'users', 'notifications']) app.use('/api/' + file, require('../server/routes/' + file));
    app.use('/api/ng', require('../ng/routes'));
    app.use((error, _req, res, _next) => res.status(500).json({ success: false, error: error.message }));
    server = app.listen(18083, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
    log = fs.openSync(path.join(output, 'public-platform-next.log'), 'w');
    next = spawn(process.execPath, [require.resolve('next/dist/bin/next'), 'dev', '-p', '3005', '-H', '127.0.0.1'], {
      cwd: path.join(__dirname, '..'), env: { ...process.env, NEXT_DIST_DIR: '.next-public-platform-preview', DOCTARX_DISABLE_BUILD_CACHE: 'true' }, windowsHide: true, stdio: ['ignore', log, log],
    });
  }
  let browser; let preflight = { checked: false };
  try {
    await waitFor(web + '/'); browser = await chromium.launch({ headless: true });
    for (const scope of scopes) for (const width of [1440, 390]) {
      try { await publicScope(browser, scope, width); } catch (error) { findings.push({ message: scope.market + ' ' + width + ': ' + error.message }); console.error(error.message); }
    }
    try { preflight = await videoPreflight(browser); } catch (error) { findings.push({ message: 'Video preflight: ' + error.message }); }
    check(runtime.length === 0, 'No uncaught public/preflight runtime errors.', runtime);
    check(requests.every(request => ['GET', 'HEAD', 'OPTIONS'].includes(request.method) || request.path === '/api/directory/pharmacies'), 'Public browser performs directory reads only.', requests.filter(request => !['GET', 'HEAD', 'OPTIONS'].includes(request.method) && request.path !== '/api/directory/pharmacies'));
    assert.deepEqual(await businessCounts(), before, 'No accounts or public business fixtures were created, reset, renamed, or deleted.');
  } finally {
    if (browser) await browser.close(); next?.kill(); if (log !== undefined) fs.closeSync(log); if (server) await new Promise(resolve => server.close(resolve)); await db.close();
    fs.writeFileSync(path.join(output, 'DoctaRx public validation.json'), JSON.stringify({ passed: findings.length === 0, captures, findings, directoryChecks, runtime, videoPreflight: preflight, reusedLoopbackPreview: reuse, accountSeeding: false, accountReset: false, businessFixtureMutations: false, minimumTextPx: 16, viewports: [1440, 390], deviceLocation: 'Explicit Playwright permission and coordinate emulation; manual areas use actual API registry queries.', directoryOutage: 'Browser transport abort only; no replacement product data.', dataSource: 'Actual mounted publicDirectory and NG discovery handlers with isolated PostgreSQL; no fixture creation.' }, null, 2));
  }
  assert.equal(findings.length, 0, 'Public validation reported ' + findings.length + ' actionable findings; inspect DoctaRx public validation.json.');
  console.log('Public platform verified in ' + captures.length + ' desktop/mobile states.');
}

main().catch(async error => { console.error(error.message); await db.close(); process.exitCode = 1; });
