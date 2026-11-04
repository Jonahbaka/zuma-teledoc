'use strict';
const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;
const ORIGIN = 'http://127.0.0.1:3219';
const browserErrors = new WeakMap();
const externalRequests = new WeakMap();
test.beforeEach(async ({ page, request }) => {
  const reset = await request.post(`${ORIGIN}/__voice_fixture/reset`, { headers: { Origin: ORIGIN, Authorization: 'Bearer fictional-browser-fixture' }, data: {} });
  expect(reset.ok()).toBeTruthy();
  const errors = [], external = []; browserErrors.set(page, errors); externalRequests.set(page, external);
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => {
    if (new URL(route.request().url()).origin !== ORIGIN) { external.push(route.request().url()); return route.abort('blockedbyclient'); }
    return route.continue();
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Synthetic voice browser QA' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Start live synthetic test' })).toBeVisible();
});
test.afterEach(async ({ page, request }) => {
  const result = await request.post(`${ORIGIN}/__voice_fixture/reset`, { headers: { Origin: ORIGIN, Authorization: 'Bearer fictional-browser-fixture' }, data: {} });
  expect(result.ok()).toBeTruthy();
  expect(browserErrors.get(page) || []).toEqual([]); expect(externalRequests.get(page) || []).toEqual([]);
});
const consent = page => page.getByRole('checkbox', { name: /I consent to sending my microphone audio/ });
async function begin(page, language = 'ha') {
  await page.getByRole('combobox', { name: 'Conversation language' }).selectOption(language);
  const start = page.getByRole('button', { name: 'Start live synthetic test' });
  await expect(start).toBeDisabled();
  await expect(page.getByTestId('permission-requests')).toHaveText('Permission requests: 0');
  await consent(page).check(); await start.click();
  await expect(page.getByTestId('pending-permissions')).toHaveText('Pending permissions: 1');
  await expect(page.getByTestId('provider-creates')).toHaveText('Fake provider creates: 0');
  await page.getByRole('button', { name: 'Allow pending fake permission' }).click();
  await expect(page.getByRole('region', { name: 'Live audio prototype' }).getByRole('status')).toContainText('listening');
  await expect(page.getByTestId('active-tracks')).toHaveText('Active fake tracks: 1');
  await expect(page.getByTestId('provider-creates')).toHaveText('Fake provider creates: 1');
}
async function stopped(page) {
  await expect(page.getByTestId('active-tracks')).toHaveText('Active fake tracks: 0');
  await expect(page.getByTestId('open-peers')).toHaveText('Open fake peers: 0');
  await expect(page.getByTestId('speaker-state')).toHaveText('Fake speaker: stopped');
  await expect(page.getByTestId('provider-closes')).toHaveText('Fake provider closes: 1');
}
for (const [language, greeting] of [['ha', 'Sannu'], ['ig', 'Ndewo'], ['yo', 'Ẹ káàbọ̀']]) test(`${language}: permission, duplex caption simulation, speaker interruption and consent revocation`, async ({ page }, testInfo) => {
  await begin(page, language);
  await page.getByRole('button', { name: 'Emit fictional assistant caption' }).click();
  await page.getByRole('button', { name: 'Emit fictional patient interruption' }).click();
  await expect(page.getByLabel('Unverified live captions')).toContainText(`${greeting}: fictional assistant fragment`);
  await expect(page.getByLabel('Unverified live captions')).toContainText(`${greeting}: fictional patient fragment`);
  await expect(page.getByTestId('evidence-count')).toHaveText('Provisional evidence: 2');
  await page.getByRole('button', { name: 'Mute speaker now' }).click();
  await expect(page.getByTestId('speaker-state')).toHaveText('Fake speaker: stopped');
  await expect(page.getByTestId('active-tracks')).toHaveText('Active fake tracks: 1');
  await page.getByRole('button', { name: 'Resume speaker' }).click();
  await expect(page.getByTestId('speaker-state')).toHaveText('Fake speaker: playing');
  const screenshot = await page.screenshot({ path: testInfo.outputPath(`${language}-synthetic-voice.png`), fullPage: true });
  await testInfo.attach(`${language} synthetic interaction`, { body: screenshot, contentType: 'image/png' });
  await page.getByRole('button', { name: 'Revoke fictional consent' }).click(); await stopped(page);
  await expect(page.getByRole('region', { name: 'Live audio prototype' }).getByRole('status')).toContainText('stopped');
});

test('permission refusal never creates a provider session', async ({ page }) => {
  await page.getByRole('combobox', { name: 'Fake permission response' }).selectOption('deny');
  await consent(page).check(); await page.getByRole('button', { name: 'Start live synthetic test' }).click();
  await expect(page.getByRole('region', { name: 'Live audio prototype' }).getByRole('status')).toContainText('failed');
  await expect(page.getByTestId('permission-requests')).toHaveText('Permission requests: 1');
  await expect(page.getByTestId('active-tracks')).toHaveText('Active fake tracks: 0');
  await expect(page.getByTestId('provider-creates')).toHaveText('Fake provider creates: 0');
});

test('cancelled pending permission cannot resurrect capture or a provider session', async ({ page }) => {
  await consent(page).check(); await page.getByRole('button', { name: 'Start live synthetic test' }).click();
  await expect(page.getByTestId('pending-permissions')).toHaveText('Pending permissions: 1');
  await page.getByRole('button', { name: 'Stop microphone and end' }).click();
  await page.getByRole('button', { name: 'Allow pending fake permission' }).click();
  await expect(page.getByTestId('pending-permissions')).toHaveText('Pending permissions: 0');
  await expect(page.getByTestId('active-tracks')).toHaveText('Active fake tracks: 0');
  await expect(page.getByTestId('provider-creates')).toHaveText('Fake provider creates: 0');
  await expect(consent(page)).not.toBeChecked();
});

test('microphone device loss stops local media and the fake provider', async ({ page }) => {
  await begin(page); await page.getByRole('button', { name: 'Disconnect fake microphone' }).click(); await stopped(page);
});

for (const [label, kind] of [['Revoke fictional processor approval', 'processor'], ['Remove fictional evaluator role', 'role']]) test(`${kind} revocation ends the session and forbids new capture`, async ({ page }) => {
  await begin(page); await page.getByRole('button', { name: label }).click(); await stopped(page);
  await page.getByRole('button', { name: 'Start live synthetic test' }).click();
  await expect(page.getByRole('region', { name: 'Live audio prototype' }).getByRole('status')).toContainText('failed');
  await expect(page.getByTestId('permission-requests')).toHaveText('Permission requests: 1');
  await expect(page.getByTestId('provider-creates')).toHaveText('Fake provider creates: 1');
});

test('language change ends the prior session and resets consent', async ({ page }) => {
  await begin(page, 'ha'); await page.getByRole('combobox', { name: 'Conversation language' }).selectOption('yo'); await stopped(page);
  await expect(consent(page)).not.toBeChecked();
  await expect(page.getByRole('button', { name: 'Start live synthetic test' })).toBeDisabled();
  await expect(page.getByTestId('provider-creates')).toHaveText('Fake provider creates: 1');
});

test('unmount terminates its owned session', async ({ page }) => {
  await begin(page); await page.getByRole('button', { name: 'Unmount live panel' }).click(); await stopped(page);
  await expect(page.getByRole('region', { name: 'Live audio prototype' })).toHaveCount(0);
});

test('fixture layout and controls are accessible without external requests', async ({ page }) => {
  await expect(page.getByRole('button', { name: 'Start live synthetic test' })).toBeDisabled();
  const violations = (await new AxeBuilder({ page }).include('main').analyze()).violations;
  expect(violations.map(value => value.id)).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
});

const cameraPanel = page => page.getByRole('region', { name: 'AI pre-consultation assistant camera mock' });
async function beginCamera(page) {
  const panel = cameraPanel(page);
  await expect(panel.getByRole('button', { name: 'Try fictional camera preview' })).toBeDisabled();
  await panel.getByRole('checkbox').check();
  await panel.getByRole('button', { name: 'Try fictional camera preview' }).click();
  await expect(panel.getByRole('group', { name: 'Fictional camera permission' })).toBeVisible();
  await panel.getByRole('button', { name: 'Allow fictional camera' }).click();
  await expect(panel.getByRole('status')).toContainText('previewing');
  await expect(page.getByTestId('permission-requests')).toHaveText('Permission requests: 0');
  await expect(page.getByTestId('provider-creates')).toHaveText('Fake provider creates: 0');
}
test('optional fictional camera has separate permission, local selection, removal and withdrawal', async ({ page }) => {
  await beginCamera(page); const panel = cameraPanel(page);
  await panel.getByRole('button', { name: 'Select current fictional frame' }).click();
  await expect(panel.getByLabel('Selected fictional frames')).toContainText('Blue notebook');
  await panel.getByRole('button', { name: 'Next fictional scene' }).click();
  await panel.getByRole('button', { name: 'Select current fictional frame' }).click();
  await panel.getByRole('button', { name: 'Remove Blue notebook' }).click();
  await expect(panel.getByRole('status')).toContainText('selected frames: 1');
  await panel.getByRole('checkbox').uncheck();
  await expect(panel.getByRole('status')).toContainText('off · selected frames: 0');
  await expect(panel.getByLabel('Selected fictional frames')).toHaveCount(0);
  await expect(page.getByTestId('provider-creates')).toHaveText('Fake provider creates: 0');
});
test('fictional camera refusal requires renewed consent and never opens a preview', async ({ page }) => {
  const panel = cameraPanel(page); await panel.getByRole('checkbox').check();
  await panel.getByRole('button', { name: 'Try fictional camera preview' }).click();
  await panel.getByRole('button', { name: 'Decline fictional camera' }).click();
  await expect(panel.getByRole('status')).toContainText('failed'); await expect(panel.getByRole('checkbox')).not.toBeChecked();
  await expect(panel.getByRole('img')).toHaveCount(0);
});
test('fictional camera loss clears every selected frame and permission', async ({ page }) => {
  await beginCamera(page); const panel = cameraPanel(page); await panel.getByRole('button', { name: 'Select current fictional frame' }).click();
  await panel.getByRole('button', { name: 'Simulate camera loss' }).click();
  await expect(panel.getByRole('status')).toContainText('off · selected frames: 0');
  await expect(panel.getByRole('checkbox')).not.toBeChecked(); await expect(panel.getByRole('img')).toHaveCount(0);
});
test('language change discards fictional camera consent and selection', async ({ page }) => {
  await beginCamera(page); const panel = cameraPanel(page); await panel.getByRole('button', { name: 'Select current fictional frame' }).click();
  await page.getByRole('combobox', { name: 'Conversation language' }).selectOption('yo');
  await expect(panel.getByRole('status')).toContainText('off · selected frames: 0'); await expect(panel.getByRole('checkbox')).not.toBeChecked();
});
test('ending permission or unmounting cannot keep fictional camera preview visible', async ({ page }) => {
  const panel = cameraPanel(page); await panel.getByRole('checkbox').check(); await panel.getByRole('button', { name: 'Try fictional camera preview' }).click();
  await panel.getByRole('button', { name: 'Stop preview and clear frames' }).click();
  await expect(panel.getByRole('group', { name: 'Fictional camera permission' })).toHaveCount(0);
  await beginCamera(page); await page.getByRole('button', { name: 'Unmount live panel' }).click(); await expect(panel).toHaveCount(0);
});
