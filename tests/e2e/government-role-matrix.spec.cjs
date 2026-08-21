'use strict';

const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;
const speakeasy = require('speakeasy');

const PASSWORD = process.env.E2E_ROLE_PASSWORD || 'Fictional-Role-Browser-2099!';
const MFA_SECRET = process.env.E2E_MFA_SECRET || 'JBSWY3DPEHPK3PXP';
const ACTORS = [
  { name: 'patient', email: 'e2e-patient@example.test', role: 'patient', path: '/ng/patient/appointments', text: /appointments/i },
  { name: 'provider', email: 'e2e-provider@example.test', role: 'provider', path: '/ng/provider/dashboard', text: /provider|clinical|dashboard/i },
  { name: 'pharmacy', email: 'e2e-pharmacy@example.test', role: 'pharmacy', path: '/ng/pharmacy/dashboard', text: /pharmacy|prescription|dashboard/i },
  { name: 'government', email: 'e2e-government@example.test', role: 'patient', mfa: true, path: '/ng/government-data', text: /government data intake and search/i },
  { name: 'executive', email: 'e2e-executive@example.test', role: 'patient', mfa: true, path: '/ng/executive-view', text: /executive command center/i },
];

for (const actor of ACTORS) {
  test(`${actor.name} authenticated workflow renders without serious accessibility or API failures`, async ({ page, context }, testInfo) => {
    const consoleErrors = [];
    const failedRequests = [];
    page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
    page.on('pageerror', (error) => consoleErrors.push(error.message));
    page.on('requestfailed', (request) => failedRequests.push({ url: request.url(), error: request.failure()?.errorText }));
    page.on('response', (response) => {
      if (response.status() >= 400 && response.url().includes('/api/')) failedRequests.push({ url: response.url(), status: response.status() });
    });

    const mfaCode = actor.mfa ? speakeasy.totp({ secret: MFA_SECRET, encoding: 'base32' }) : undefined;
    const login = await context.request.post('/api/auth/login', { data: { email: actor.email, password: PASSWORD, role: actor.role, mfaCode } });
    expect(login.ok(), `${actor.name} login`).toBeTruthy();
    const session = await login.json();
    expect(session.success).toBe(true);
    // Production cookies are Secure and scoped to doctarx.com, which an HTTP
    // localhost browser cannot retain. The login above still verifies the real
    // TOTP; mirror only its short-lived MFA marker onto the isolated test host.
    if (actor.mfa) {
      await context.addCookies([{
        name: 'mfaVerified', value: 'true', url: 'http://127.0.0.1:8080',
        httpOnly: true, secure: false, sameSite: 'Lax',
      }]);
    }
    await page.addInitScript(({ accessToken, refreshToken, user }) => {
      localStorage.setItem('accessToken', accessToken);
      localStorage.setItem('refreshToken', refreshToken);
      localStorage.setItem('user', JSON.stringify(user));
    }, { accessToken: session.accessToken, refreshToken: session.refreshToken, user: session.user });

    await page.goto(actor.path, { waitUntil: 'networkidle' });
    await expect(page.locator('body')).toContainText(actor.text);
    if (actor.name === 'government') {
      await page.getByLabel('What are you looking for?').fill('PNC');
      await page.getByRole('button', { name: 'Search', exact: true }).click();
      await expect(page.getByText(/PNC within 24 hours/i).first()).toBeVisible();
    }
    if (actor.name === 'executive') {
      await expect(page.locator('body')).not.toContainText(/fictional data for presentation|presentation demo/i);
    }

    const screenshot = testInfo.outputPath(`${actor.name}-${testInfo.project.name}.png`);
    await page.screenshot({ path: screenshot, fullPage: true });
    await testInfo.attach('role-screenshot', { path: screenshot, contentType: 'image/png' });
    const accessibility = await new AxeBuilder({ page }).analyze();
    const severe = accessibility.violations.filter((violation) => ['serious', 'critical'].includes(violation.impact));
    await testInfo.attach('accessibility.json', { body: Buffer.from(JSON.stringify(accessibility, null, 2)), contentType: 'application/json' });
    await testInfo.attach('browser-diagnostics.json', { body: Buffer.from(JSON.stringify({ consoleErrors, failedRequests }, null, 2)), contentType: 'application/json' });
    expect(severe, `${actor.name} serious/critical accessibility violations`).toEqual([]);
    expect(consoleErrors, `${actor.name} console errors`).toEqual([]);
    expect(failedRequests.filter((item) => item.status >= 400 || item.error), `${actor.name} failed requests`).toEqual([]);
  });
}
