'use strict';

// Receipt-backed UI checks using an existing authorized demo patient. No plan,
// subscription, payment, membership card, account, or gateway call is created.
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
process.env.JWT_ACCESS_SECRET = 'doctarx-membership-browser-access-secret-at-least-32-characters';
process.env.JWT_REFRESH_SECRET = 'doctarx-membership-browser-refresh-secret-at-least-32-characters';
process.env.ENCRYPTION_KEY ||= '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
process.env.NG_AUTO_SEED_DISCOVERY = 'false';
process.env.DISABLE_SCHEDULERS = 'true';
process.env.NEXT_PUBLIC_API_URL = 'http://127.0.0.1:18084/api';
const db = require('../server/db');
const email = process.env.MEMBERSHIP_PLATFORM_E2E_EMAIL || 'patient@demo.doctarx.com';
const password = process.env.CAREOPS_E2E_PASSWORD || 'Demo12345678!';
const output = path.resolve(process.env.MEMBERSHIP_PLATFORM_UI_OUTPUT_DIR || 'work/membership-platform-ui');
const previewDirectory = process.env.MEMBERSHIP_PLATFORM_PREVIEW_DIR || '.next-membership-platform-preview';
assert.ok(['.next-membership-platform-preview', '.next-admin-platform-preview'].includes(previewDirectory), 'Use the isolated membership preview, or an explicitly coordinated, closed admin preview.');
fs.mkdirSync(output, { recursive: true });
const reportPath = path.join(output, 'DoctaRx membership validation.json');
fs.writeFileSync(reportPath, JSON.stringify({ passed: false, state: 'running', startedAt: new Date().toISOString() }, null, 2));
let captures = 0;

async function waitFor(url) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try { if ((await fetch(url)).ok) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  throw new Error('Membership preview did not start.');
}

async function snapshot(userId) {
  return (await db.getPool().query(`SELECT (SELECT COUNT(*)::integer FROM users) AS users,
    (SELECT COALESCE(jsonb_agg(to_jsonb(s) ORDER BY s.id),'[]'::jsonb) FROM subscriptions s WHERE s.user_id=$1) AS subscriptions,
    (SELECT COALESCE(jsonb_agg(to_jsonb(p) ORDER BY p.id),'[]'::jsonb) FROM payments p WHERE p.user_id=$1 AND p.type='subscription') AS payments,
    (SELECT COALESCE(jsonb_agg(to_jsonb(c) ORDER BY c.id),'[]'::jsonb) FROM membership_cards c WHERE c.user_id=$1) AS cards`, [userId])).rows[0];
}

async function capture(page, name) {
  await page.waitForFunction(() => document.querySelector('main') && ![...document.querySelectorAll('main [role="status"]')].some(element => /^Loading/i.test(element.textContent.trim())), null, { timeout: 90000 });
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all([...document.images].map(image => image.decode()));
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    await Promise.all(document.getAnimations().filter(animation => animation.playState === 'running' && animation.effect?.getComputedTiming().endTime !== Infinity).map(animation => animation.finished.catch(() => undefined)));
  });
  const small = await page.evaluate(() => [...document.querySelectorAll('main *,header *,nav *,aside *')].filter(element => {
    const box = element.getBoundingClientRect(), style = getComputedStyle(element);
    return box.width > 2 && box.height > 2 && style.visibility !== 'hidden' && style.display !== 'none' && [...element.childNodes].some(node => node.nodeType === Node.TEXT_NODE && node.textContent.trim()) && parseFloat(style.fontSize) < 16;
  }).map(element => ({ text: element.textContent.trim().slice(0, 80), size: getComputedStyle(element).fontSize })));
  assert.deepEqual(small, [], name + ': visible text must be at least 16px.');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, name + ': no mobile overflow.');
  const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  fs.writeFileSync(path.join(output, name + ' accessibility.json'), JSON.stringify(axe.violations.map(({ id, impact, nodes }) => ({ id, impact, nodes: nodes.map(({ target, failureSummary }) => ({ target, failureSummary })) })), null, 2));
  assert.deepEqual(axe.violations.filter(row => ['serious', 'critical'].includes(row.impact)), [], name + ': no serious accessibility errors.');
  await page.screenshot({ path: path.join(output, name + '.png'), fullPage: true }); captures += 1;
  console.log('Verified:', name);
}

async function main() {
  const account = (await db.getPool().query('SELECT id,role,market_scope FROM users WHERE email=$1 AND is_active=true', [email])).rows[0];
  assert.equal(account?.role, 'patient', 'Use an existing active, authorized patient account.');
  const before = await snapshot(account.id);
  const app = express(); app.use(cors({ origin: 'http://127.0.0.1:3006', credentials: true })); app.use(cookieParser()); app.use(express.json());
  app.get('/api/health', async (_req, res) => { const health = await db.healthCheck(); res.status(health.healthy ? 200 : 503).json({ status: health.healthy ? 'ok' : 'unavailable' }); });
  // Read-only guard makes an accidental button regression fail before it can
  // collect payment or mutate any patient record in this browser acceptance.
  const rejectedWrites = [];
  app.use('/api', (req, res, next) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && !req.path.startsWith('/auth/')) {
      rejectedWrites.push({ path: req.path, method: req.method }); return res.status(405).json({ success: false, error: 'This acceptance preview is read-only.' });
    }
    return next();
  });
  for (const route of ['auth', 'users', 'notifications', 'subscriptions', 'stripe']) app.use('/api/' + route, require('../server/routes/' + route));
  app.use('/api/ng', require('../ng/routes'));
  const server = app.listen(18084, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  const log = fs.openSync(path.join(output, 'membership-platform-next.log'), 'w');
  const next = spawn(process.execPath, [require.resolve('next/dist/bin/next'), 'dev', '-p', '3006', '-H', '127.0.0.1'], {
    cwd: path.join(__dirname, '..'), env: { ...process.env, NEXT_DIST_DIR: previewDirectory, DOCTARX_DISABLE_BUILD_CACHE: 'true' }, windowsHide: true, stdio: ['ignore', log, log],
  });
  let browser;
  try {
    await waitFor('http://127.0.0.1:3006/patient/login'); browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } }); context.setDefaultTimeout(90000); context.setDefaultNavigationTimeout(90000);
    const login = await context.request.post('http://127.0.0.1:18084/api/auth/login', { data: { email, password, role: 'patient' } });
    assert.equal(login.ok(), true, 'Authenticate the existing account without seeding or password reset.');
    const session = await login.json(); assert.equal(session.success, true); assert.equal(session.user.id, account.id);
    assert.equal(session.user.marketScope, account.market_scope, 'Sign-in must expose the actual account market without route or locale inference.');
    const token = { Authorization: 'Bearer ' + session.accessToken };
    const currentUser = await context.request.get('http://127.0.0.1:18084/api/auth/me', { headers: token });
    assert.equal(currentUser.status(), 200); const current = await currentUser.json();
    assert.equal(current.user.id, account.id); assert.equal(current.user.marketScope, account.market_scope);
    const response = await context.request.get('http://127.0.0.1:18084/api/subscriptions/me', { headers: token });
    assert.equal(response.status(), 200, 'Read actual membership state.'); const actual = await response.json(); assert.equal(actual.success, true);
    assert.equal(actual.capabilities.market, account.market_scope); assert.ok(Array.isArray(actual.plans));
    await context.addInitScript(value => { localStorage.setItem('accessToken', value.accessToken); localStorage.setItem('refreshToken', value.refreshToken); localStorage.setItem('user', JSON.stringify(value.user)); }, session);
    const page = await context.newPage(); const runtime = [], writes = [];
    page.on('pageerror', error => runtime.push(error.message));
    page.on('request', request => { const url = new URL(request.url()); if (url.pathname.startsWith('/api/') && !url.pathname.startsWith('/api/auth/') && !['GET', 'HEAD', 'OPTIONS'].includes(request.method())) writes.push({ path: url.pathname, method: request.method() }); });
    const membershipUrl = url => url.origin === 'http://127.0.0.1:18084' && url.pathname === '/api/subscriptions/me';
    const routes = ['/patient/subscription', ...(account.market_scope === 'NG' ? ['/ng/patient/subscription'] : [])];
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 }); const size = width === 390 ? 'mobile' : 'desktop';
      for (const route of routes) {
        const scope = route.startsWith('/ng') ? 'NG' : 'US';
        await page.goto('http://127.0.0.1:3006' + route); await page.getByRole('heading', { level: 1, name: 'Membership & billing', exact: true }).waitFor();
        await capture(page, 'DoctaRx ' + scope + ' membership ' + size);
        assert.equal(await page.locator('main [role="alert"]').count(), 0); assert.equal(await page.locator('main article').count(), actual.plans.length);
        if (!actual.hasActiveSubscription) await page.getByText('No verified paid membership', { exact: true }).waitFor();
        if (account.market_scope === 'NG') { assert.equal(await page.getByRole('button', { name: 'Continue to checkout', exact: true }).count(), 0); await page.getByRole('link', { name: 'Consultation billing', exact: true }).waitFor(); }
      }
      const route = routes[0];
      for (const query of ['?success=true', '?checkout=cancelled']) {
        await page.goto('http://127.0.0.1:3006' + route + query);
        await page.getByText(query.includes('success') ? 'You returned from checkout' : 'Checkout was closed', { exact: true }).waitFor();
        await capture(page, 'DoctaRx membership ' + (query.includes('success') ? 'returned' : 'closed') + ' ' + size);
        assert.equal(await page.getByText(actual.paymentEnvironment === 'test' ? 'Active · test payment verified' : 'Active · payment verified', { exact: true }).count(), actual.hasActiveSubscription ? 1 : 0);
        assert.equal(await page.getByText('No charges were made.', { exact: true }).count(), 0);
      }
      const unavailable = route => route.abort('failed'); await page.route(membershipUrl, unavailable);
      await page.goto('http://127.0.0.1:3006' + route);
      await page.getByRole('heading', { level: 2, name: 'Membership unavailable', exact: true }).waitFor();
      assert.equal(await page.getByText('No verified paid membership', { exact: true }).count(), 0);
      await capture(page, 'DoctaRx membership unavailable ' + size); await page.unroute(membershipUrl, unavailable);
      const retry = page.waitForResponse(value => membershipUrl(new URL(value.url())) && value.request().method() === 'GET');
      await page.getByRole('button', { name: 'Try again', exact: true }).click(); assert.equal((await retry).status(), 200);
      await capture(page, 'DoctaRx membership recovered ' + size); assert.equal(await page.locator('main [role="alert"]').count(), 0);
    }
    assert.deepEqual(runtime, []); assert.deepEqual(writes, []); assert.deepEqual(rejectedWrites, []);
    assert.deepEqual(await snapshot(account.id), before, 'Membership preview must preserve all accounts and actual billing records.');
    fs.writeFileSync(reportPath, JSON.stringify({ passed: true, screenshots: captures, role: account.role, accountMarket: account.market_scope, routes,
      source: '/api/subscriptions/me using current DB history, verified Stripe invoice bindings and current server capabilities',
      hasActiveSubscription: actual.hasActiveSubscription, paymentEnvironment: actual.paymentEnvironment, testingBypassActive: actual.testingBypassActive, configuredPlans: actual.plans.length,
      checkoutAvailable: actual.capabilities.checkoutAvailable, billingPortalAvailable: actual.capabilities.billingPortalAvailable,
      minimumVisibleTextPx: 16, mobileWidth: 390, axeSeriousCritical: 0, runtimeErrors: 0, writes: 0, accountSeeding: false, accountReset: false, businessFixtureMutations: false,
      checkoutOrPortalCalled: false, paidMembershipGatewayAcceptance: 'Not performed; no gateway calls or payment data created.',
      USMarketBrowserEligibility: account.market_scope === 'US' ? 'Existing US patient used.' : 'Not performed; existing authorized demo patient is NG. US plan/card behavior is verified by component tests.' }, null, 2));
    console.log(JSON.stringify({ passed: true, screenshots: captures, accountMarket: account.market_scope, writes: 0, runtimeErrors: 0 }));
  } finally { if (browser) await browser.close(); next.kill(); fs.closeSync(log); await new Promise(resolve => server.close(resolve)); await db.close(); }
}
main().catch(error => {
  fs.writeFileSync(reportPath, JSON.stringify({ passed: false, state: 'failed', screenshots: captures, error: error.message, finishedAt: new Date().toISOString() }, null, 2));
  console.error(error.stack || error.message); process.exitCode = 1;
});
