'use strict';
const { defineConfig, devices } = require('@playwright/test');
module.exports = defineConfig({
  testDir: './tests/voice-browser', testMatch: 'voice.spec.cjs', timeout: 30000, expect: { timeout: 10000 },
  fullyParallel: false, workers: 1, retries: 0,
  reporter: [['line'], ['html', { outputFolder: 'artifacts/voice-browser/report', open: 'never' }]],
  outputDir: 'artifacts/voice-browser/results',
  use: { baseURL: 'http://127.0.0.1:3219', serviceWorkers: 'block', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [
    { name: 'desktop-chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile-chromium', use: { ...devices['Pixel 7'] } },
  ],
  webServer: { command: 'node tests/voice-browser/server.cjs', url: 'http://127.0.0.1:3219/__voice_fixture/health',
    reuseExistingServer: false, timeout: 60000, stdout: 'pipe', stderr: 'pipe',
    env: { NODE_ENV: 'test', DOCTARX_VOICE_BROWSER_FIXTURE: 'true', VOICE_BROWSER_PORT: '3219', NODE_OPTIONS: '--max-old-space-size=384', RAYON_NUM_THREADS: '1' },
  },
});
