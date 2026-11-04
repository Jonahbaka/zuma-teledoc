'use strict';

const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests/e2e',
  testMatch: 'government-role-matrix.spec.cjs',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  retries: 1,
  workers: 1,
  reporter: [['line'], ['html', { outputFolder: 'artifacts/government-browser/playwright-report', open: 'never' }]],
  outputDir: 'artifacts/government-browser/test-results',
  use: {
    baseURL: 'http://127.0.0.1:8080',
    trace: 'on',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    ignoreHTTPSErrors: true,
  },
  projects: [
    { name: 'desktop-chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile-chromium', use: { ...devices['Pixel 7'] } },
  ],
  webServer: {
    command: 'npm start',
    url: 'http://127.0.0.1:8080/readyz',
    timeout: 180_000,
    reuseExistingServer: false,
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...process.env, NODE_ENV: 'production', PORT: '8080', DISABLE_SCHEDULERS: 'true', NG_AUTO_SEED_DISCOVERY: 'false' },
  },
});
