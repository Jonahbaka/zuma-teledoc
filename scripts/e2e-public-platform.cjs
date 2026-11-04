'use strict';

// Read-only public UI verification against the actual API and isolated database.
// Device coordinates are browser permission emulation. Directory rows are never
// injected, seeded, renamed, or filtered to construct a product demonstration.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const net = require('node:net');
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
const browserConsole = [];
const startup = [];
const previewDirectory = '.next-public-platform-preview';
const nextLog = path.join(output, 'public-platform-next.log');
const reportPath = path.join(output, 'DoctaRx public validation.json');
const harnessSourceSha256 = crypto.createHash('sha256').update(fs.readFileSync(__filename)).digest('hex');
const scopes = [
  { market: 'US', home: '/', directory: '/pharmacies', city: 'Juneau', state: 'AK', workCity: 'Anchorage', workState: 'AK', point: { latitude: 58.3019, longitude: -134.4197 } },
  { market: 'NG', home: '/ng', directory: '/ng/pharmacies', city: 'Damaturu', state: 'Yobe', workCity: 'Potiskum', workState: 'Yobe', point: { latitude: 11.7469, longitude: 11.9608 } },
];

function check(condition, message, details) {
  if (!condition) findings.push({ message, ...(details ? { details } : {}) });
}

async function boundedOperation(label, operation, { timeoutMs = 15000 } = {}) {
  assert.ok(Number.isFinite(timeoutMs) && timeoutMs > 0, 'A positive operation deadline is required.');
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(operation),
      new Promise((_, reject) => { timer = setTimeout(() => { const error = new Error(`Timed out after ${timeoutMs}ms`); error.code = 'PUBLIC_BROWSER_PHASE_TIMEOUT'; reject(error); }, timeoutMs); }),
    ]);
  } catch (cause) {
    const error = new Error(`${label}: ${cause.message}`, { cause });
    error.phase = label; error.code = cause.code || 'PUBLIC_BROWSER_PHASE_FAILED'; throw error;
  } finally { clearTimeout(timer); }
}

async function closeBrowserContext(context, label, { timeoutMs = 15000, priorError } = {}) {
  try { await boundedOperation(label + ' context close', () => context.close(), { timeoutMs }); }
  catch (cause) {
    const error = priorError ? new AggregateError([priorError, cause], `${label}: validation and context cleanup both failed`, { cause: priorError }) : cause;
    error.contextCleanupFailed = true; throw error;
  }
}

async function closeOwnedBrowser(browser, browserServer, { timeoutMs = 15000 } = {}) {
  const errors = [];
  if (browser) { try { await boundedOperation('Owned browser connection shutdown', () => browser.close(), { timeoutMs }); } catch (error) { errors.push(error); } }
  if (browserServer) {
    if (!errors.length) { try { await boundedOperation('Owned browser server shutdown', () => browserServer.close(), { timeoutMs }); } catch (error) { errors.push(error); } }
    if (errors.length) { try { await boundedOperation('Owned browser forced shutdown', () => browserServer.kill(), { timeoutMs }); } catch (error) { errors.push(error); if (browserServer.process) { try { await boundedOperation('Owned browser process-tree shutdown', () => stopOwnedPreview(browserServer.process()), { timeoutMs }); } catch (fallbackError) { errors.push(fallbackError); } } } }
  }
  if (errors.length) throw new AggregateError(errors, 'Owned browser shutdown failed: ' + errors.map(error => error.message).join('; '), { cause: errors[0] });
}

async function waitFor(url, { child, timeoutMs = 120000, intervalMs = 250, format = 'html', requireMain = false } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (child && (child.exitCode !== null || child.signalCode !== null)) throw new Error(`Owned Next preview exited before readiness (code ${child.exitCode}, signal ${child.signalCode}).`);
    let response;
    try {
      response = await fetch(url, { signal: AbortSignal.timeout(Math.max(1, deadline - Date.now())) });
    } catch (error) {
      // Only a listener that has not started can be polled. A failed streamed
      // response, HTTP error, or compile error is evidence, never a retry pass.
      if (error.cause?.code !== 'ECONNREFUSED' || Date.now() >= deadline) throw error;
      await new Promise(resolve => setTimeout(resolve, Math.min(intervalMs, Math.max(1, deadline - Date.now()))));
      continue;
    }
    // fetch resolves at headers. Drain the initial server-rendered stream before
    // another request can race Next's cold compilation/global manifest writes.
    const body = format === 'binary' ? await response.arrayBuffer() : await response.text();
    assert.equal(response.ok, true, `Preview startup GET ${new URL(url).pathname} returned HTTP ${response.status}.`);
    if (format === 'json') JSON.parse(body);
    if (format === 'html') {
      assert.ok(/<\/html\s*>/i.test(body), `Preview startup GET ${new URL(url).pathname} did not finish its HTML response.`);
      assert.ok(!/id=["']__next_error__["']|data-next-error-message=|data-next-error-digest=/i.test(body), `Preview startup GET ${new URL(url).pathname} returned a Next error document.`);
      if (requireMain) assert.ok(/<main(?:\s|>)/i.test(body), `Preview startup GET ${new URL(url).pathname} did not render its public main content.`);
    }
    return { path: new URL(url).pathname, status: response.status, bytes: typeof body === 'string' ? Buffer.byteLength(body) : body.byteLength, completedAt: new Date().toISOString() };
  }
}

async function availablePort(url) {
  const parsed = new URL(url);
  const probe = net.createServer();
  await new Promise((resolve, reject) => { probe.once('error', reject); probe.listen(Number(parsed.port), parsed.hostname, resolve); });
  await new Promise((resolve, reject) => probe.close(error => error ? reject(error) : resolve()));
}

async function stopOwnedPreview(child, { platform = process.platform, graceMs = 5000, spawnImpl = spawn, signalGroup = process.kill.bind(process) } = {}) {
  if (!child) return;
  if (platform !== 'win32') {
    // The launcher can exit before its forked Next worker. Its detached group
    // remains ours: prove that group is gone, rather than equating leader close
    // with worker/listener shutdown.
    const exists = () => { try { signalGroup(-child.pid, 0); return true; } catch (error) { if (error.code === 'ESRCH') return false; throw error; } };
    const goneWithin = async milliseconds => {
      const deadline = Date.now() + milliseconds;
      while (exists()) {
        if (Date.now() >= deadline) return false;
        await new Promise(resolve => setTimeout(resolve, Math.min(25, Math.max(1, deadline - Date.now()))));
      }
      return true;
    };
    if (!exists()) return;
    for (const signal of ['SIGTERM', 'SIGKILL']) {
      try { signalGroup(-child.pid, signal); } catch (error) { if (error.code !== 'ESRCH') throw error; }
      if (await goneWithin(graceMs)) return;
    }
    throw new Error('Owned Next process group remains alive after its bounded shutdown.');
  }
  if (child.exitCode !== null || child.signalCode !== null) return;
  let closed = false;
  const completion = new Promise(resolve => child.once('close', () => { closed = true; resolve(); }));
  const within = async milliseconds => {
    let timer;
    try { return await Promise.race([completion.then(() => true), new Promise(resolve => { timer = setTimeout(() => resolve(false), milliseconds); })]); }
    finally { clearTimeout(timer); }
  };
    // Windows terminates only this spawned process tree. No image-name kill or
    // computed filesystem operation is involved, and no unrelated tab is owned.
    const killer = spawnImpl('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    await new Promise((resolve, reject) => { killer.once('error', reject); killer.once('close', code => code === 0 || closed ? resolve() : reject(new Error(`Owned Next process-tree shutdown failed (${code}).`))); });
  if (await within(graceMs)) return;
  throw new Error('Owned Next preview did not close after its bounded shutdown.');
}

function diagnostics(child) {
  let logTail = '';
  try { logTail = fs.readFileSync(nextLog, 'utf8').split(/\r?\n/).slice(-70).join('\n').slice(-12000); } catch {}
  const manifests = ['routes-manifest.json', 'prerender-manifest.json', 'build-manifest.json', 'server/next-font-manifest.json', 'server/server-reference-manifest.json'].map(file => {
    try {
      const value = fs.readFileSync(path.join(__dirname, '..', previewDirectory, file), 'utf8');
      let parseError = null; try { JSON.parse(value); } catch (error) { parseError = error.message; }
      return { file, bytes: Buffer.byteLength(value), parseError };
    } catch (error) { return { file, unavailable: error.code || error.message }; }
  });
  return { process: child ? { pid: child.pid, exitCode: child.exitCode, signalCode: child.signalCode } : null, manifests, nextLogTail: logTail };
}

function recordFailure(label, error) {
  const evidence = (value, depth = 0) => ({ message: value.message, stack: value.stack || null, phase: value.phase || null, code: value.code || null, ...(depth < 3 && value.cause ? { cause: evidence(value.cause, depth + 1) } : {}), ...(depth < 3 && value.errors ? { errors: [...value.errors].map(item => evidence(item, depth + 1)) } : {}) });
  const finding = { ...evidence(error), message: label + ': ' + error.message };
  findings.push(finding); console.error('Public validation failure:', finding.message, '\n' + (finding.stack || ''));
}

function observeRuntime(page) {
  page.on('pageerror', error => { runtime.push({ route: page.url(), message: error.message, stack: error.stack }); console.error('Public runtime:', error.stack || error.message); });
  page.on('console', entry => {
    if (['error', 'warning'].includes(entry.type())) browserConsole.push({ route: page.url(), type: entry.type(), message: entry.text() });
  });
}

async function settle(page, { resourceTimeoutMs = 30000 } = {}) {
  await page.waitForFunction(() => document.querySelector('main') && ![...document.querySelectorAll('main [role="status"]')].some(element => /^(Finding your device location|Searching the pharmacy directory|Loading|Checking secure access)/i.test(element.textContent.trim())), null, { timeout: 90000 });
  await boundedOperation('Fonts and image readiness at ' + page.url(), () => page.evaluate(async ({ timeoutMs }) => {
    const original = { left: scrollX, top: scrollY };
    const deadline = Date.now() + timeoutMs;
    async function resource(label, pending) {
      let timer;
      try { return await Promise.race([pending, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(label + ' readiness timed out')), Math.max(1, deadline - Date.now())); })]); }
      finally { clearTimeout(timer); }
    }
    try {
      await resource('Document fonts', document.fonts.ready);
      for (const image of document.images) {
        // Exercise ordinary scrolling so native lazy loading can start. Waiting
        // for offscreen lazy images before ever scrolling deadlocks long pages.
        image.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
        await resource('Image scroll frame', new Promise(resolve => requestAnimationFrame(resolve)));
        await resource('Image ' + (image.currentSrc || image.getAttribute('src') || image.alt || '(unnamed)'), image.decode().catch(() => undefined));
      }
    } finally { window.scrollTo({ ...original, behavior: 'instant' }); }
  }, { timeoutMs: Math.max(1, Math.floor(resourceTimeoutMs * 0.8)) }), { timeoutMs: resourceTimeoutMs });
  return waitForRenderedPage(page);
}

async function waitForRenderedPage(page, { timeoutMs = 10000 } = {}) {
  const pathname = new URL(page.url()).pathname;
  const expectedTitle = {
    '/': 'DoctaRx | Connected Virtual Care',
    '/ng': 'Online Doctor Consultation and Pharmacy Access in Nigeria',
    '/pharmacies': 'Pharmacy directory',
    '/ng/pharmacies': 'Pharmacy directory',
    '/ng/provider/call': 'DoctaRx | Virtual Care, Prescriptions, and Pharmacy Coordination',
  }[pathname];
  assert.ok(expectedTitle, 'An explicit rendered-page title contract is required for ' + pathname);
  // Main content and its API response can finish before App Router's metadata
  // boundary. Next 15 can append streamed metadata to body, so observe the
  // actual HTML title anywhere in this document, not only inside head.
  // Observe normal motion; never inject a title,
  // disable animations, or rerun Axe until an accessibility failure disappears.
  return page.evaluate(({ pathname, expectedTitle, timeoutMs }) => new Promise((resolve, reject) => {
    let frame; let stableFrames = 0; let previous = ''; let snapshot;
    const timer = setTimeout(() => {
      cancelAnimationFrame(frame);
      reject(new Error('Rendered-page readiness timed out: ' + JSON.stringify(snapshot)));
    }, timeoutMs);
    function inspect() {
      const titles = [...document.querySelectorAll('title')].filter(element => element.namespaceURI === 'http://www.w3.org/1999/xhtml')
        .map(element => ({ text: element.textContent.trim(), parent: element.parentElement.tagName }));
      const title = document.title.trim();
      const finiteAnimations = document.getAnimations().filter(animation =>
        (animation.playState === 'running' || animation.pending) && Number.isFinite(animation.effect?.getComputedTiming().endTime)
      ).map(animation => ({ type: animation.constructor.name, state: animation.playState }));
      snapshot = { pathname: location.pathname, title, titles, finiteAnimations };
      const signature = JSON.stringify(snapshot);
      const ready = location.pathname === pathname && titles.length === 1 && titles[0].text === title &&
        (title === expectedTitle || title.startsWith(expectedTitle + ' | ')) && title.includes('DoctaRx') && finiteAnimations.length === 0;
      stableFrames = ready ? signature === previous ? stableFrames + 1 : 1 : 0;
      previous = signature;
      if (stableFrames >= 3) { clearTimeout(timer); resolve(snapshot); return; }
      frame = requestAnimationFrame(inspect);
    }
    frame = requestAnimationFrame(inspect);
  }), { pathname, expectedTitle, timeoutMs });
}

async function capture(page, name) {
  const renderedPage = await settle(page);
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
  renderedPage.submitButtons = await page.evaluate(() => [...document.querySelectorAll('main button[type="submit"]')].map(element => {
    const style = getComputedStyle(element);
    return { text: element.textContent.trim(), disabled: element.disabled, opacity: style.opacity, color: style.color, background: style.backgroundColor, transitionProperty: style.transitionProperty };
  }));
  const axe = await boundedOperation('Accessibility audit at ' + page.url(), () => new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze(), { timeoutMs: 60000 });
  const accessibility = axe.violations.map(({ id, impact, nodes }) => ({ id, impact, nodes: nodes.map(({ target, failureSummary }) => ({ target, failureSummary })) }));
  fs.writeFileSync(path.join(output, name + ' accessibility.json'), JSON.stringify(accessibility, null, 2));
  check(!accessibility.some(item => ['serious', 'critical'].includes(item.impact)), name + ': no serious or critical accessibility failures.', accessibility);
  await page.screenshot({ path: path.join(output, name + '.png'), fullPage: true });
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await page.screenshot({ path: path.join(output, name + ' viewport.png'), fullPage: false });
  captures.push({ name, images, widths, bodyFont, renderedPage, typographyMinimum: typography.length ? Math.min(...typography.map(item => parseFloat(item.size))) : 16 });
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
  observeRuntime(page);
  page.on('request', request => { if (request.url().startsWith(api)) requests.push({ method: request.method(), path: new URL(request.url()).pathname }); });
  let priorError;
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
  } catch (error) { priorError = error; throw error; }
  finally { console.log('Closing public context:', scope.market, size, page.url()); await closeBrowserContext(context, scope.market + ' ' + size + ' at ' + page.url(), { priorError }); console.log('Closed public context:', scope.market, size); }
}

async function videoPreflight(browser) {
  if (process.env.PUBLIC_PLATFORM_VIDEO_PREFLIGHT === 'false') return { checked: false, reason: 'Explicitly disabled; main platform script owns full verification.' };
  const account = (await db.getPool().query("SELECT email FROM users WHERE email=$1 AND role='provider' AND is_active=true", [process.env.PUBLIC_PLATFORM_E2E_PROVIDER || 'doctor@demo.doctarx.com'])).rows[0];
  assert.ok(account, 'Use an existing active demo provider for the preflight check.');
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  context.setDefaultNavigationTimeout(90000); context.setDefaultTimeout(90000);
  let priorError;
  try {
    const login = await context.request.post(api + '/auth/login', { data: { email: account.email, password: process.env.CAREOPS_E2E_PASSWORD || 'Demo12345678!', role: 'provider' } });
    assert.equal(login.ok(), true, 'The existing provider must authenticate; no account reset is performed.');
    const session = await login.json(); assert.equal(session.success, true);
    const page = await context.newPage();
    observeRuntime(page);
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
  } catch (error) { priorError = error; throw error; }
  finally { await closeBrowserContext(context, 'Video preflight', { priorError }); }
}

async function businessCounts() {
  const result = await db.getPool().query(`SELECT (SELECT COUNT(*) FROM users)::integer AS users,
    (SELECT COUNT(*) FROM pharmacy_network)::integer AS us_pharmacies,
    (SELECT COUNT(*) FROM ng_pharmacies)::integer AS ng_pharmacies,
    (SELECT COUNT(*) FROM ng_provider_match_groups)::integer AS directory_groups`);
  return result.rows[0];
}

async function main() {
  fs.writeFileSync(reportPath, JSON.stringify({ passed: false, state: 'starting', harnessSourceSha256, startedAt: new Date().toISOString() }, null, 2));
  let server; let log; let next; let browser; let browserServer; let shuttingDown = false; let preflight = { checked: false };
  try {
    const before = await businessCounts();
    if (!reuse) {
    await availablePort(web); await availablePort(api);
    const app = express();
    app.use(cors({ origin: web, credentials: true })); app.use(cookieParser()); app.use(express.json({ limit: '10mb' }));
    app.use('/api/directory', require('../server/routes/publicDirectory'));
    for (const file of ['auth', 'users', 'notifications']) app.use('/api/' + file, require('../server/routes/' + file));
    app.use('/api/ng', require('../ng/routes'));
    app.use((error, _req, res, _next) => res.status(500).json({ success: false, error: error.message }));
    server = app.listen(18083, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
    log = fs.openSync(nextLog, 'w');
    next = spawn(process.execPath, [require.resolve('next/dist/bin/next'), 'dev', '-p', '3005', '-H', '127.0.0.1'], {
      cwd: path.join(__dirname, '..'), env: { ...process.env, NEXT_DIST_DIR: previewDirectory, DOCTARX_DISABLE_BUILD_CACHE: 'true' }, detached: process.platform !== 'win32', windowsHide: true, stdio: ['ignore', log, log],
    });
    next.once('error', error => recordFailure('Owned Next startup', error));
    next.once('exit', (code, signal) => { if (!shuttingDown) recordFailure('Owned Next preview', new Error(`Exited before validation completed (code ${code}, signal ${signal}).`)); });
    }
    // Finish exact tested cold routes one at a time, including metadata that a
    // browser otherwise requests alongside its first page. This is preparation,
    // not an assertion retry: any HTTP/stream/compile error fails the run.
    for (const route of [
      { path: '/', requireMain: true }, { path: '/manifest.webmanifest', format: 'json' },
      { path: '/ng/manifest.webmanifest', format: 'json' }, { path: '/favicon.ico', format: 'binary' },
      { path: '/ng', requireMain: true }, { path: '/pharmacies', requireMain: true }, { path: '/ng/pharmacies', requireMain: true },
      ...(process.env.PUBLIC_PLATFORM_VIDEO_PREFLIGHT === 'false' ? [] : [{ path: '/ng/provider/call' }]),
    ]) startup.push(await waitFor(web + route.path, { ...route, child: next }));
    browserServer = await chromium.launchServer({ headless: true, host: '127.0.0.1', timeout: 60000 });
    browser = await chromium.connect(browserServer.wsEndpoint(), { timeout: 60000 });
    for (const scope of scopes) for (const width of [1440, 390]) {
      console.log('Validating public scope:', scope.market, width);
      try { await boundedOperation('Public scope ' + scope.market + ' ' + width, () => publicScope(browser, scope, width), { timeoutMs: 180000 }); } catch (error) { recordFailure(scope.market + ' ' + width, error); if (error.cause?.contextCleanupFailed || error.code === 'PUBLIC_BROWSER_PHASE_TIMEOUT') throw error; }
    }
    try { preflight = await boundedOperation('Video preflight', () => videoPreflight(browser), { timeoutMs: 180000 }); } catch (error) { recordFailure('Video preflight', error); }
    check(runtime.length === 0, 'No uncaught public/preflight runtime errors.', runtime);
    check(requests.every(request => ['GET', 'HEAD', 'OPTIONS'].includes(request.method) || request.path === '/api/directory/pharmacies'), 'Public browser performs directory reads only.', requests.filter(request => !['GET', 'HEAD', 'OPTIONS'].includes(request.method) && request.path !== '/api/directory/pharmacies'));
    assert.deepEqual(await businessCounts(), before, 'No accounts or public business fixtures were created, reset, renamed, or deleted.');
  } catch (error) {
    recordFailure('Public preview setup/validation', error);
  } finally {
    shuttingDown = true;
    for (const [label, cleanup] of [
      ['Browser shutdown', () => closeOwnedBrowser(browser, browserServer)],
      ['Owned Next shutdown', () => boundedOperation('Owned Next shutdown', () => stopOwnedPreview(next))],
      ['Next log close', async () => { if (log !== undefined) fs.closeSync(log); }],
      ['Owned API shutdown', async () => { if (server) { try { await boundedOperation('Owned API shutdown', () => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))); } catch (error) { server.closeAllConnections(); throw error; } } }],
      ['Database close', () => boundedOperation('Database close', () => db.close())],
    ]) { try { await cleanup(); } catch (error) { recordFailure(label, error); } }
    const failureEvidence = findings.length ? diagnostics(next) : null;
    fs.writeFileSync(reportPath, JSON.stringify({ passed: findings.length === 0, harnessSourceSha256, completedAt: new Date().toISOString(), captures, findings, directoryChecks, runtime, browserConsole, startup, diagnostics: failureEvidence, videoPreflight: preflight, reusedLoopbackPreview: reuse, accountSeeding: false, accountReset: false, businessFixtureMutations: false, minimumTextPx: 16, viewports: [1440, 390], deviceLocation: 'Explicit Playwright permission and coordinate emulation; manual areas use actual API registry queries.', directoryOutage: 'Browser transport abort only; no replacement product data.', dataSource: 'Actual mounted publicDirectory and NG discovery handlers with isolated PostgreSQL; no fixture creation.' }, null, 2));
    if (findings.length) console.error('Public validation findings:', JSON.stringify({ findings, runtime, browserConsole: browserConsole.slice(-25), diagnostics: failureEvidence }, null, 2));
  }
  assert.equal(findings.length, 0, 'Public validation reported ' + findings.length + ' actionable findings; inspect DoctaRx public validation.json.');
  console.log('Public platform verified in ' + captures.length + ' desktop/mobile states.');
}

if (require.main === module) main().catch(error => { console.error(error.stack || error.message); process.exit(1); });
