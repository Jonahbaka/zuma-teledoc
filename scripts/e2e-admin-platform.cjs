'use strict';

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
process.env.JWT_ACCESS_SECRET = 'doctarx-admin-browser-test-access-secret-at-least-32-characters';
process.env.JWT_REFRESH_SECRET = 'doctarx-admin-browser-test-refresh-secret-at-least-32-characters';
process.env.ENCRYPTION_KEY ||= '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
process.env.NG_AUTO_SEED_DISCOVERY = 'false';
process.env.DISABLE_SCHEDULERS = 'true';
process.env.NEXT_PUBLIC_API_URL = 'http://127.0.0.1:18082/api';

const db = require('../server/db');
const password = process.env.CAREOPS_E2E_PASSWORD || 'Demo12345678!';
const email = process.env.ADMIN_PLATFORM_E2E_EMAIL || 'admin@demo.doctarx.com';
const output = path.resolve(process.env.ADMIN_PLATFORM_UI_OUTPUT_DIR || 'work/admin-platform-ui');
const overviewOnly = process.env.ADMIN_PLATFORM_OVERVIEW_ONLY === 'true';
fs.mkdirSync(output, { recursive: true });
let captureCount = 0;

async function businessCounts() {
  return (await db.getPool().query(`SELECT (SELECT COUNT(*) FROM users)::integer AS users,
    (SELECT COUNT(*) FROM pharmacy_network)::integer AS us_pharmacies,
    (SELECT COUNT(*) FROM ng_pharmacies)::integer AS ng_pharmacies,
    (SELECT COUNT(*) FROM ng_provider_match_groups)::integer AS directory_groups`)).rows[0];
}

async function runPublicInPreview() {
  const directory = path.resolve(process.env.PUBLIC_PLATFORM_UI_OUTPUT_DIR || 'work/public-platform-ui');
  fs.mkdirSync(directory, { recursive: true });
  const log = fs.openSync(path.join(directory, 'public-shared-preview.log'), 'w');
  try {
    const child = spawn(process.execPath, [path.join(__dirname, 'e2e-public-platform.cjs')], {
      cwd: path.join(__dirname, '..'), env: { ...process.env, PUBLIC_PLATFORM_EXISTING_WEB_URL: 'http://127.0.0.1:3004', PUBLIC_PLATFORM_EXISTING_API_URL: 'http://127.0.0.1:18082/api', PUBLIC_PLATFORM_UI_OUTPUT_DIR: directory },
      windowsHide: true, stdio: ['ignore', log, log],
    });
    await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', code => code === 0 ? resolve() : reject(new Error('Public verification failed in the shared preview; inspect public-shared-preview.log.')));
    });
    const report = JSON.parse(fs.readFileSync(path.join(directory, 'DoctaRx public validation.json'), 'utf8'));
    assert.equal(report.passed, true); assert.equal(report.runtime.length, 0);
    return { checked: true, passed: report.passed, screenshots: report.captures.length, reusedLoopbackPreview: report.reusedLoopbackPreview };
  } finally { fs.closeSync(log); }
}

async function waitFor(url) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try { if ((await fetch(url)).ok) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  throw new Error('Admin platform preview did not start.');
}

async function capture(page, name) {
  await page.waitForFunction(() => {
    const main = document.querySelector('main');
    return main && !main.querySelector('.animate-spin') && ![...main.querySelectorAll('[role="status"],p')].some(element => /^Loading\b|^Checking secure access/i.test(element.textContent.trim()));
  }, null, { timeout: 90000 });
  await page.evaluate(async () => { await document.fonts.ready; await Promise.all([...document.images].map(image => image.decode())); });
  await page.evaluate(async () => {
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    await Promise.all(document.getAnimations().filter(animation => animation.playState === 'running' && animation.effect?.getComputedTiming().endTime !== Infinity).map(animation => animation.finished.catch(() => undefined)));
  });
  const small = await page.evaluate(() => [...document.querySelectorAll('main *,header *,nav *,aside *')].filter(element => {
    const box = element.getBoundingClientRect(); const style = getComputedStyle(element);
    return box.width > 2 && box.height > 2 && style.visibility !== 'hidden' && style.display !== 'none' && [...element.childNodes].some(node => node.nodeType === Node.TEXT_NODE && node.textContent.trim()) && parseFloat(style.fontSize) < 16;
  }).map(element => ({ text: element.textContent.trim().slice(0, 70), size: getComputedStyle(element).fontSize })));
  assert.deepEqual(small, [], name + ' must use readable text.');
  const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  fs.writeFileSync(path.join(output, name + ' accessibility.json'), JSON.stringify(axe.violations.map(({ id, impact, nodes }) => ({ id, impact, nodes: nodes.map(({ target, failureSummary }) => ({ target, failureSummary })) })), null, 2));
  assert.deepEqual(axe.violations.filter(violation => ['serious', 'critical'].includes(violation.impact)), [], name + ' must not have serious accessibility violations.');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, name + ' must fit the viewport.');
  await page.screenshot({ path: path.join(output, name + '.png'), fullPage: true });
  captureCount += 1;
  console.log('Verified:', name);
}

async function canonicalCommunications(page, width, sources) {
  const size = width === 390 ? 'mobile' : 'desktop';
  const apiBase = 'http://127.0.0.1:18082/api';
  const inboxUrl = url => url.origin === 'http://127.0.0.1:18082' && url.pathname === '/api/inbox';
  const inboxRequest = request => inboxUrl(new URL(request.url()));
  const inbox = page.locator('main section[aria-label="Inbox messages"]');
  await page.goto('http://127.0.0.1:3004/admin/inbox');
  await page.getByRole('heading', { level: 1, name: 'Administrative inbox', exact: true }).waitFor();
  await capture(page, 'DoctaRx administrative inbox ' + size);
  assert.equal(await inbox.locator('article').count(), sources.inbox.items.length, 'Inbox renders actual records, including a confirmed empty list.');
  await page.getByText('Unread messages: ' + sources.inbox.unreadCount, { exact: true }).waitFor();
  if (sources.inbox.items.length === 0) await page.getByText('No messages match this filter.', { exact: true }).waitFor();

  // Delay a real filtered GET to verify pending controls and stale-list removal.
  // The actual backend response is allowed through; no product data is injected.
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  await page.route(inboxUrl, async route => { await pending; await route.continue(); });
  const filteredResponse = page.waitForResponse(response => inboxRequest(response.request()) && new URL(response.url()).searchParams.get('unread') === 'true');
  await page.getByRole('button', { name: 'Unread', exact: true }).click();
  await page.getByText('Loading records…', { exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Refreshing…', exact: true }).isDisabled(), true);
  assert.equal(await page.getByRole('button', { name: 'Mark all as read', exact: true }).isDisabled(), true);
  assert.equal(await inbox.locator('article').count(), 0, 'Prior filter records are hidden while the new request is pending.');
  release();
  const filtered = await filteredResponse;
  assert.equal(filtered.ok(), true); const filteredPayload = await filtered.json();
  assert.equal(filteredPayload.success, true); assert.ok(Array.isArray(filteredPayload.data?.items));
  await page.unroute(inboxUrl);
  await capture(page, 'DoctaRx administrative inbox unread ' + size);
  assert.equal(await inbox.locator('article').count(), filteredPayload.data.items.length);

  await page.route(inboxUrl, route => route.abort('failed'));
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await inbox.getByRole('alert').waitFor();
  await page.getByText('Unread messages: —', { exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Mark all as read', exact: true }).isDisabled(), true);
  assert.equal(await page.getByText('No messages match this filter.', { exact: true }).count(), 0, 'Failed inbox fetch is not a confirmed empty list.');
  await capture(page, 'DoctaRx administrative inbox unavailable ' + size);
  await page.unroute(inboxUrl);
  const restoredResponse = page.waitForResponse(response => inboxRequest(response.request()));
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  assert.equal((await restoredResponse).ok(), true);
  await capture(page, 'DoctaRx administrative inbox recovered ' + size);
  assert.equal(await inbox.locator('article').count(), filteredPayload.data.items.length);

  await page.goto('http://127.0.0.1:3004/admin/campaigns');
  await page.getByRole('heading', { level: 1, name: 'Email campaigns', exact: true }).waitFor();
  await capture(page, 'DoctaRx email campaigns ' + size);
  async function assertSavedSource(source, emptyText) {
    if (source.available) {
      assert.equal(await page.locator('main article').count(), source.rows, 'Saved communications come from actual CRM records.');
      if (!source.rows) await page.getByText(emptyText, { exact: true }).waitFor();
    } else {
      await page.locator('main [role="alert"]').waitFor();
      assert.equal(await page.getByText(emptyText, { exact: true }).count(), 0, 'Unavailable CRM is not a confirmed empty list.');
      assert.equal(await page.getByRole('button', { name: 'Try again', exact: true }).isEnabled(), true);
    }
  }
  await assertSavedSource(sources.campaigns, 'No saved campaigns.');
  if (!sources.campaigns.available) {
    const retried = page.waitForResponse(response => response.url().startsWith(apiBase + '/crm/campaigns'));
    await page.getByRole('button', { name: 'Try again', exact: true }).click();
    assert.equal((await retried).status(), 503, 'An absent optional CRM schema remains explicitly unavailable on retry.');
    await capture(page, 'DoctaRx email campaigns unavailable retry ' + size);
    await assertSavedSource(sources.campaigns, 'No saved campaigns.');
  }
  // Open and close unsaved forms only. Never save a draft, approve a campaign,
  // invoke an agent, alter read status, or send mail from browser verification.
  await page.getByRole('button', { name: 'Create campaign draft', exact: true }).click();
  await page.getByRole('heading', { name: 'New campaign draft', exact: true }).waitFor();
  await capture(page, 'DoctaRx campaign draft form ' + size);
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('button', { name: 'Templates', exact: true }).click();
  await capture(page, 'DoctaRx email templates ' + size);
  await assertSavedSource(sources.templates, 'No saved email templates.');
  await page.getByRole('button', { name: 'Create template', exact: true }).click();
  await page.getByRole('heading', { name: 'New email template', exact: true }).waitFor();
  await capture(page, 'DoctaRx email template form ' + size);
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
}

async function main() {
  const account = (await db.getPool().query("SELECT id,email,role,market_scope,is_active,mfa_enabled FROM users WHERE email=$1 AND role IN ('admin','super_admin')", [email])).rows[0];
  assert.ok(account?.is_active, 'Use an existing active authorized demo admin account; this script never provisions or resets accounts.');
  assert.equal(account.mfa_enabled, false, 'Use an existing demo account that is provisioned for non-MFA browser checks.');
  const accountCount = Number((await db.getPool().query('SELECT COUNT(*) AS count FROM users')).rows[0].count);
  const originalBusinessCounts = await businessCounts();
  const app = express();
  app.use(cors({ origin: 'http://127.0.0.1:3004', credentials: true }));
  app.use(cookieParser()); app.use(express.json({ limit: '10mb' }));
  // The isolated preview reports its current process and a real database probe.
  // It does not fabricate uptime percentages, latency, media calls, or email queues.
  app.get('/api/health', async (_req, res) => {
    try {
      await db.getPool().query('SELECT 1 AS healthy');
      res.json({ status: 'healthy', uptime: Math.floor(process.uptime()), timestamp: new Date().toISOString(), database: { primary: { healthy: true } }, source: 'isolated-admin-browser-preview' });
    } catch {
      res.status(503).json({ status: 'degraded', uptime: Math.floor(process.uptime()), timestamp: new Date().toISOString(), database: { primary: { healthy: false } }, source: 'isolated-admin-browser-preview' });
    }
  });
  for (const [route, file] of [['auth', 'auth'], ['admin', 'admin'], ['credentialing', 'credentialing'], ['inbox', 'inbox'], ['crm', 'crm'], ['notifications', 'notifications'], ['users', 'users']]) app.use('/api/' + route, require('../server/routes/' + file));
  app.use('/api/directory', require('../server/routes/publicDirectory'));
  app.use('/api/ng', require('../ng/routes'));
  app.use((error, _req, res, _next) => res.status(500).json({ success: false, error: error.message }));
  const server = app.listen(18082, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const log = fs.openSync(path.join(output, 'admin-platform-next.log'), 'w');
  const next = spawn(process.execPath, [require.resolve('next/dist/bin/next'), 'dev', '-p', '3004', '-H', '127.0.0.1'], {
    cwd: path.join(__dirname, '..'), env: { ...process.env, NEXT_DIST_DIR: '.next-admin-platform-preview', DOCTARX_DISABLE_BUILD_CACHE: 'true' }, windowsHide: true, stdio: ['ignore', log, log],
  });
  let browser;
  try {
    await waitFor('http://127.0.0.1:3004/secure/admin');
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    context.setDefaultNavigationTimeout(90000); context.setDefaultTimeout(90000);
    const login = await context.request.post('http://127.0.0.1:18082/api/auth/login', { data: { email, password, role: 'admin' } });
    assert.equal(login.ok(), true, 'The existing admin credentials must authenticate.');
    const session = await login.json(); assert.equal(session.success, true); assert.equal(session.user.role, account.role);
    const dashboardResponse = await context.request.get('http://127.0.0.1:18082/api/admin/dashboard', { headers: { Authorization: 'Bearer ' + session.accessToken } });
    assert.equal(dashboardResponse.ok(), true);
    const payload = await dashboardResponse.json();
    assert.equal(payload.dashboard.availability.users, true);
    for (const section of ['providers', 'appointments', 'subscriptions', 'weeklyActivity', 'pendingErx', 'credentialing', 'recentErrors']) assert.equal(payload.dashboard.availability[section], true, section + ' query must match the migrated schema.');
    const users = (await db.getPool().query('SELECT COUNT(*) AS count FROM users WHERE is_active=true')).rows[0];
    assert.equal(payload.dashboard.users.total, Number(users.count), 'Overview uses actual active accounts.');
    const pending = (await db.getPool().query("SELECT COUNT(*) AS count FROM users WHERE role='provider' AND provider_status='pending'")).rows[0];
    assert.equal(payload.dashboard.providers.pendingApproval, Number(pending.count), 'Pending counts come from the approval query.');
    assert.equal(payload.metrics.estimatedmrr, null);
    const ngDashboardResponse = await context.request.get('http://127.0.0.1:18082/api/ng/admin/analytics/dashboard', { headers: { Authorization: 'Bearer ' + session.accessToken } });
    assert.equal(ngDashboardResponse.ok(), true, 'Operations overview must load actual NG aggregates.');
    const ngPayload = await ngDashboardResponse.json();
    const pharmacies = (await db.getPool().query("SELECT COUNT(*) AS count FROM ng_pharmacies WHERE status='approved'")).rows[0];
    assert.equal(Number(ngPayload.pharmacies.active_pharmacies), Number(pharmacies.count));
    const statsResponse = await context.request.get('http://127.0.0.1:18082/api/credentialing/admin/stats', { headers: { Authorization: 'Bearer ' + session.accessToken } });
    assert.equal(statsResponse.ok(), true, 'Credentialing statistics must resolve its static endpoint.');
    const credentialing = await statsResponse.json();
    assert.equal(credentialing.stats.underReview, payload.dashboard.credentialing.underReview);

    const communicationsSchema = (await db.getPool().query("SELECT to_regclass('public.crm_campaigns') IS NOT NULL AS campaigns, to_regclass('public.crm_email_templates') IS NOT NULL AS templates")).rows[0];
    const inboxResponse = await context.request.get('http://127.0.0.1:18082/api/inbox?limit=100', { headers: { Authorization: 'Bearer ' + session.accessToken } });
    assert.equal(inboxResponse.ok(), true, 'Actual administrative inbox must load.');
    const actualInbox = await inboxResponse.json();
    assert.equal(actualInbox.success, true); assert.ok(Array.isArray(actualInbox.data?.items));
    const actualUnread = Number((await db.getPool().query("SELECT COUNT(*) AS count FROM ai_chat_messages WHERE recipient_type='operator' AND read_at IS NULL")).rows[0].count);
    assert.equal(actualInbox.data.unreadCount, actualUnread);
    const communicationsSources = { inbox: actualInbox.data };
    for (const [resource, schemaKey] of [['campaigns', 'campaigns'], ['templates', 'templates']]) {
      const response = await context.request.get('http://127.0.0.1:18082/api/crm/' + resource, { headers: { Authorization: 'Bearer ' + session.accessToken } });
      const data = await response.json();
      if (communicationsSchema[schemaKey]) {
        assert.equal(response.ok(), true, resource + ' must load its existing schema.');
        assert.equal(data.success, true); assert.ok(Array.isArray(data.data));
        communicationsSources[resource] = { available: true, rows: data.data.length, status: response.status() };
      } else {
        assert.equal(response.status(), 503, 'Missing optional CRM schema must be unavailable, not a false empty list.');
        assert.equal(data.success, false); assert.equal(Array.isArray(data.data), false);
        communicationsSources[resource] = { available: false, rows: null, status: 503, reason: 'Optional CRM table is absent in the isolated test database.' };
      }
    }

    const page = await context.newPage(); const runtime = []; const adminWrites = [];
    const dataFailures = [];
    page.on('response', response => { if (response.url().startsWith('http://127.0.0.1:18082/api/') && response.status() >= 400) dataFailures.push({ status: response.status(), path: new URL(response.url()).pathname }); });
    page.on('request', request => {
      if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method()) && /\/api\/(?:admin|ng\/admin|credentialing|inbox|crm)(?:\/|$)/.test(request.url())) adminWrites.push({ method: request.method(), url: request.url() });
    });
    page.on('pageerror', error => { runtime.push(error.message); console.error('Admin runtime:', error.message); });
    await page.addInitScript(session => { localStorage.setItem('accessToken', session.accessToken); localStorage.setItem('refreshToken', session.refreshToken); localStorage.setItem('user', JSON.stringify(session.user)); }, session);
    const routes = [['/admin/dashboard', 'Platform overview', 'DoctaRx admin overview'], ...(!overviewOnly ? [['/ng/admin', 'Operations overview', 'DoctaRx operations overview']] : [])];
    for (const [url, title, name] of routes) {
      await page.goto('http://127.0.0.1:3004' + url); await page.getByRole('heading', { level: 1, name: title, exact: true }).waitFor();
      await capture(page, name + ' desktop');
      if (url === '/admin/dashboard') {
        await page.getByText('DoctaRx Gold', { exact: true }).waitFor();
        assert.equal(await page.getByText('Docta Gold', { exact: true }).count(), 0, 'Membership labels must use DoctaRx branding.');
        await page.getByText('Connected', { exact: true }).waitFor();
        assert.equal(await page.getByText('Monitoring unavailable', { exact: true }).count(), 2, 'No fabricated media/email health.');
        await page.getByRole('button', { name: 'Refresh overview', exact: true }).click();
        await page.getByRole('button', { name: 'Refresh overview', exact: true }).waitFor();
      }
    }
    await page.setViewportSize({ width: 390, height: 844 });
    for (const [url, title, name] of routes) {
      await page.goto('http://127.0.0.1:3004' + url); await page.getByRole('heading', { level: 1, name: title, exact: true }).waitFor();
      await capture(page, name + ' mobile');
      await page.getByRole('button', { name: 'Open administration navigation', exact: true }).click();
      await page.getByRole('button', { name: 'Close administration navigation', exact: true }).waitFor();
      await page.keyboard.press('Escape');
      assert.equal(await page.getByRole('button', { name: 'Open administration navigation', exact: true }).getAttribute('aria-expanded'), 'false');
    }
    const leaves = overviewOnly ? [] : [
      ['analytics', 'Operations analytics'], ['revenue', 'Revenue reporting'], ['compliance', 'Audit and compliance'],
      ['consultations', 'Consultation oversight'], ['providers', 'Provider credential reviews'], ['hospitals', 'Facility registrations'],
      ['organizations', 'Organization accounts'], ['subscriptions', 'Subscription management'], ['notifications', 'Administrative notifications'],
    ];
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
      for (const [route, title] of leaves) {
        await page.goto('http://127.0.0.1:3004/ng/admin/' + route);
        await page.getByRole('heading', { level: 1, name: title, exact: true }).waitFor();
        await capture(page, 'DoctaRx admin ' + route + ' ' + (width === 390 ? 'mobile' : 'desktop'));
        // Failure rendering is a required contract, not a fabricated empty list.
        if (await page.getByRole('button', { name: 'Try again', exact: true }).count()) assert.ok(await page.locator('main [role="alert"]').count(), route + ' must explain unavailable data.');
      }
      if (!overviewOnly) await canonicalCommunications(page, width, communicationsSources);
    }
    assert.deepEqual(runtime, []);
    assert.deepEqual(adminWrites, [], 'Overview verification must not perform administrative mutations.');
    const expectedUnavailablePaths = new Set(['campaigns', 'templates'].filter(resource => !communicationsSources[resource].available).map(resource => '/api/crm/' + resource));
    const unexpectedDataFailures = dataFailures.filter(failure => failure.status !== 503 || !expectedUnavailablePaths.has(failure.path));
    assert.deepEqual(unexpectedDataFailures, [], 'Only explicit unavailable responses for an absent optional CRM schema are expected.');
    assert.equal(Number((await db.getPool().query('SELECT COUNT(*) AS count FROM users')).rows[0].count), accountCount, 'No accounts were created or reset for the preview.');
    assert.deepEqual(await businessCounts(), originalBusinessCounts, 'Administrative browser verification must not alter accounts or business fixtures.');
    await context.close();
    let publicSuite = { checked: false };
    if (!overviewOnly && process.env.ADMIN_PLATFORM_INCLUDE_PUBLIC === 'true') {
      await browser.close(); browser = null;
      publicSuite = await runPublicInPreview();
      assert.deepEqual(await businessCounts(), originalBusinessCounts, 'The combined public/admin preview does not create, reset, rename, or delete business fixtures.');
    }
    fs.writeFileSync(path.join(output, 'DoctaRx admin validation.json'), JSON.stringify({ screenshots: captureCount, overviewOnly, accountSeeding: false, accountReset: false, businessFixtureMutations: false, role: account.role, marketScope: account.market_scope, routes: [...routes.map(([url]) => url), ...leaves.map(([route]) => '/ng/admin/' + route), ...(!overviewOnly ? ['/admin/inbox', '/admin/campaigns'] : [])], minimumVisibleTextPx: 16, responsiveViewport: 390, axeSeriousCritical: 0, runtimeErrors: 0, sourceAvailability: payload.dashboard.availability, communicationsSources: { inbox: { available: true, rows: actualInbox.data.items.length, unreadCount: actualUnread }, campaigns: communicationsSources.campaigns, templates: communicationsSources.templates }, dataFailures, unexpectedDataFailures, publicSuite, pendingProviders: Number(pending.count), activeUsers: Number(users.count), healthSource: 'Actual isolated-process uptime and SQL database probe; no media or email metrics', adminWrites: false, dataEnvironment: 'Isolated test database may contain persisted integration-test fixtures; these screenshots are validation artifacts, not production demonstrations.' }, null, 2));
    console.log('Admin platform verified in ' + captureCount + ' desktop/mobile states.');
  } finally {
    if (browser) await browser.close();
    next.kill(); await new Promise(resolve => server.close(resolve)); fs.closeSync(log); await db.getPool().end();
  }
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
