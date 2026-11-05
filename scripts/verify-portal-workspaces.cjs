'use strict';
// Render the actual Next pages with explicitly fictional API responses. All API
// calls are intercepted; unknown endpoints and external hosts are blocked.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;

const base = process.env.PORTAL_PREVIEW_URL || 'http://127.0.0.1:58483';
const target = new URL(base);
if (!['localhost', '127.0.0.1'].includes(target.hostname) || !['http:', 'https:'].includes(target.protocol)) throw new Error('Portal verification only accepts a loopback preview.');
const output = path.resolve(process.env.PORTAL_PREVIEW_OUTPUT || 'artifacts/portal-workspaces');
fs.mkdirSync(output, { recursive: true });

function fixture(role, market) {
  const user = { id: `fictional-${market}-${role}`, role, firstName: role === 'provider' ? 'Avery' : 'Jordan', lastName: 'Example', email: `${role}@example.invalid`, marketScope: market, country: market, mustChangePassword: false, accountStatus: 'active' };
  const appointment = (id, minutes, status, type = 'video') => ({ id, scheduledAt: new Date(Date.now() + minutes * 60000).toISOString(), status, type, patientFirstName: 'Jordan', patientLastName: 'Example', providerFirstName: 'Avery', providerLastName: 'Example' });
  return {
    user,
    appointments: [appointment('fictional-arrival', -15, 'confirmed'), appointment('fictional-next', 90, 'scheduled'), appointment('fictional-followup', 1440, 'confirmed', 'phone')],
    patients: [{ id: 'fictional-patient', firstName: 'Jordan', lastName: 'Example', lastVisit: new Date(Date.now() + 90 * 60000).toISOString() }],
    notes: [{ id: 'fictional-note-draft', appointmentId: 'fictional-draft', patientFirstName: 'Jordan', patientLastName: 'Example', isSigned: false, createdAt: new Date().toISOString() }, { id: 'fictional-note-signed', appointmentId: 'fictional-signed', patientFirstName: 'Morgan', patientLastName: 'Example', isSigned: true, createdAt: new Date(Date.now() - 86400000).toISOString() }],
  };
}

async function installFixture(context, data, mode) {
  const unknown = [];
  // This unsigned fixture token exists only in this isolated browser context;
  // every API call is intercepted. Match the real client's owner consistency
  // hint without changing or bypassing the production authentication code.
  const token = `fixture.${Buffer.from(JSON.stringify({ userId: data.user.id })).toString('base64url')}.not-a-real-signature`;
  await context.addInitScript(value => { localStorage.setItem('accessToken', value); localStorage.setItem('refreshToken', 'fictional-portal-preview-refresh'); }, token);
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.pathname.startsWith('/api/')) {
      const headers = { 'access-control-allow-origin': target.origin, 'access-control-allow-credentials': 'true', 'access-control-allow-methods': 'GET, OPTIONS', 'access-control-allow-headers': 'content-type, authorization', 'cache-control': 'no-store' };
      if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
      if (request.method() !== 'GET') { unknown.push(request.method() + ' ' + url.pathname); return route.abort(); }
      let body;
      const routePath = url.pathname;
      if (routePath === '/api/auth/me') body = { success: true, user: data.user };
      else if (routePath === '/api/health') body = { success: true, status: 'ok' };
      else if (routePath === '/api/notifications/unread-count') body = { success: true, unreadCount: 0 };
      else if (routePath === '/api/appointments/upcoming') {
        if (mode.unavailable) return route.fulfill({ status: 503, headers, json: { success: false } });
        body = { success: true, appointments: data.appointments };
      }
      else if (routePath === '/api/providers/me/patients') body = { success: true, patients: data.patients };
      else if (routePath === '/api/visits/provider/recent') body = { success: true, visits: data.notes };
      else if (routePath === '/api/ng/providers/me/access') body = { providerAccess: { provider: { id: 'fictional-ng-provider' } } };
      else if (routePath === '/api/ng/providers/fictional-ng-provider/appointments') {
        if (mode.partial) return route.fulfill({ status: 503, headers, json: { success: false } });
        body = { appointments: [] };
      }
      else if (routePath === '/api/ng/patient/prescriptions') body = [{ id: 'fictional-rx', medication_name: 'Example medication record', status: 'recorded' }];
      else if (routePath === `/api/clinical-encounters/patient/${data.user.id}/medications`) body = { success: true, medications: [{ id: 'fictional-medication', medicationName: 'Example medication record', status: 'recorded' }] };
      else if (routePath === '/api/messages/conversations') body = { success: true, conversations: [{ id: 'fictional-conversation' }] };
      else { unknown.push(routePath); return route.abort(); }
      return route.fulfill({ status: 200, headers, json: body });
    }
    if (url.origin !== target.origin) return route.abort();
    return route.continue();
  });
  return unknown;
}

async function capture(page, name, report) {
  await page.evaluate(async () => { await document.fonts.ready; await Promise.all(document.getAnimations().filter(animation => Number.isFinite(animation.effect?.getComputedTiming().endTime)).map(animation => animation.finished.catch(() => {}))); });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, name + ' fits viewport');
  const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  const violations = axe.violations.map(({ id, impact, nodes }) => ({ id, impact, nodes: nodes.map(({ target, failureSummary }) => ({ target, failureSummary })) }));
  report.accessibility.push({ name, violations });
  fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(report, null, 2));
  assert.deepEqual(violations, [], name + ' accessibility');
  await page.screenshot({ path: path.join(output, name + '.png'), fullPage: true });
  report.screenshots.push(name + '.png');
}

(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
  const report = { fixtureData: true, externalApiCalls: false, checkedAt: new Date().toISOString(), base, scenarios: [], accessibility: [], screenshots: [] };
  try {
    for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
      const size = viewport.width < 500 ? 'mobile' : 'desktop';
      for (const market of ['US', 'NG']) for (const role of ['patient', 'provider']) {
        const prefix = `${market === 'NG' ? '/ng' : ''}/${role}`;
        const context = await browser.newContext({ viewport, serviceWorkers: 'block' });
        const data = fixture(role, market), mode = { unavailable: false, partial: false };
        const unknown = await installFixture(context, data, mode);
        const page = await context.newPage();
        try {
          await page.goto(base + prefix + '/dashboard', { timeout: 120000, waitUntil: 'domcontentloaded' });
          const main = page.locator('main');
          await expect(main.getByRole('heading', { level: 1 })).toHaveText(role === 'provider' ? 'Your day in care' : 'Welcome, Jordan', { timeout: 30000 });
          await expect(main).toContainText('Last checked');
          await expect(main.locator(`a[href="${prefix}/appointments/fictional-arrival/call"]`).first()).toBeVisible();
          const links = await main.locator('a').evaluateAll(nodes => nodes.map(node => node.getAttribute('href')));
          assert.ok(links.every(href => href.startsWith(prefix + '/')), 'every care link retains role and market');
          if (role === 'provider') { await expect(main).toContainText('Unsigned'); await expect(main).toContainText('Signed'); await expect(main).toContainText('Latest appointment:'); }
          await capture(page, `${market}-${role}-${size}`, report);
          report.scenarios.push(`${market}-${role}-${size}: dashboard, late arrival, market links`);
          if (size === 'mobile') {
            await page.getByRole('button', { name: `Open ${role} navigation`, exact: true }).click();
            await expect(page.getByRole('dialog')).toBeVisible();
            await page.keyboard.press('Escape');
            await expect(page.getByRole('dialog')).toHaveCount(0);
          }
          mode.unavailable = true;
          await main.getByRole('button', { name: 'Refresh', exact: true }).click();
          await expect(main.getByRole('alert').first()).toContainText('could not be loaded');
          await expect(main.locator(`a[href="${prefix}/appointments/fictional-arrival/call"]`)).toHaveCount(0);
          await capture(page, `${market}-${role}-${size}-unavailable`, report);
          mode.unavailable = false;
          await main.getByRole('button', { name: 'Try again', exact: true }).first().click();
          await expect(main.locator(`a[href="${prefix}/appointments/fictional-arrival/call"]`).first()).toBeVisible();
          report.scenarios.push(`${market}-${role}-${size}: unavailable and retry recovery`);
          if (role === 'provider') {
            await main.getByRole('link', { name: /Practice activity/ }).click();
            await expect(main.getByRole('heading', { level: 1 })).toHaveText('Practice activity');
            await expect(main).toContainText('Last checked');
            await expect(main).toContainText('loaded subsets');
            await capture(page, `${market}-analytics-${size}`, report);
            report.scenarios.push(`${market}-analytics-${size}: operational loaded subsets`);
            if (market === 'NG') {
              mode.partial = true;
              await main.getByRole('button', { name: 'Refresh', exact: true }).click();
              await expect(main.getByRole('alert')).toContainText('counts and lists are partial');
              await capture(page, `${market}-analytics-${size}-partial`, report);
              report.scenarios.push(`${market}-analytics-${size}: partial-data notice`);
            }
          }
          assert.deepEqual(unknown, [], 'no unhandled or mutating API calls');
        } catch (error) {
          await page.screenshot({ path: path.join(output, 'failure.png'), fullPage: true }).catch(() => {});
          console.error({ url: page.url(), unknown, body: (await page.locator('body').innerText().catch(() => '')).slice(0, 3000) });
          throw error;
        } finally { await context.close(); }
      }
    }
    fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(report, null, 2));
    console.log(`Passed ${report.scenarios.length} scenarios, ${report.accessibility.length} Axe scans, ${report.screenshots.length} screenshots. Fictional intercepted API data only.`);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
