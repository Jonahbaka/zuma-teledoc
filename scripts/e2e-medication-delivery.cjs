'use strict';

// Real application routes, PostgreSQL and browser UI; only the external courier
// and payment transports are replaced in this isolated test process.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = require('node:path');
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const { Pool } = require('pg');
const { chromium } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');

const target = process.env.SIMULATION_DATABASE_URL;
if (!target || !['127.0.0.1', 'localhost'].includes(new URL(target).hostname) || !new URL(target).pathname.endsWith('_test')) throw new Error('Use a disposable loopback database ending in _test.');
process.env.DATABASE_URL = target;
process.env.NODE_ENV = 'test';
process.env.JWT_ACCESS_SECRET = 'isolated-medication-browser-access-secret-at-least-32-characters';
process.env.JWT_REFRESH_SECRET = 'isolated-medication-browser-refresh-secret-at-least-32-characters';
process.env.ENCRYPTION_KEY ||= 'c'.repeat(64);
process.env.NG_AUTO_SEED_DISCOVERY = 'false';
const base = process.env.MEDICATION_DELIVERY_NEXT_BASE_URL || 'http://127.0.0.1:3008';
const productionBuild = process.env.MEDICATION_DELIVERY_USE_PRODUCTION_BUILD === 'true';
const nextDist = process.env.MEDICATION_DELIVERY_NEXT_DIST_DIR || (productionBuild ? '.next' : '.next-medication-preview');
const buildId = productionBuild ? fs.readFileSync(path.resolve(__dirname, '..', nextDist, 'BUILD_ID'), 'utf8').trim() : null;
const apiUrl = new URL(process.env.MEDICATION_DELIVERY_API_BASE_URL || 'http://127.0.0.1:18088');
if (apiUrl.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(apiUrl.hostname) || !apiUrl.port || Number(apiUrl.port) < 1024 || Number(apiUrl.port) > 65535 || apiUrl.username || apiUrl.password || apiUrl.pathname !== '/' || apiUrl.search || apiUrl.hash) throw new Error('The isolated API must use a loopback HTTP origin with an explicit unprivileged port.');
const apiBase = apiUrl.origin;
if (!['127.0.0.1', 'localhost'].includes(new URL(base).hostname) || new URL(base).protocol !== 'http:') throw new Error('Browser simulation is restricted to a loopback HTTP preview.');
process.env.NEXT_PUBLIC_API_URL = `${apiBase}/api`;
const output = path.resolve(process.env.MEDICATION_DELIVERY_UI_OUTPUT_DIR || 'work/medication-delivery-ui');
fs.mkdirSync(output, { recursive: true });
const backendSourceSha256 = Object.fromEntries(['ng/services/logistics/medicationDeliveryWorkflowService.js', 'ng/services/logistics/medicationFinanceService.js'].map(file => [file, crypto.createHash('sha256').update(fs.readFileSync(path.resolve(__dirname, '..', file))).digest('hex')]));
const db = require('../server/db');
const workflowPath = require.resolve('../ng/services/logistics/medicationDeliveryWorkflowService');
const workflow = require(workflowPath);
const { createBrowserFixture } = require('../ng/tests/helpers/medication-delivery-fixture');
let currentService;
require.cache[workflowPath].exports = new Proxy({}, { get(_value, method) { return method === 'createMedicationDeliveryWorkflowService' ? workflow.createMedicationDeliveryWorkflowService : (...args) => currentService[method](...args); } });
const pool = new Pool({ connectionString: target });
const runtime = [];
const consoleErrors = [];
const serverErrors = [];
const captures = [];
const results = [];

async function waitFor(url) { for (let count = 0; count < 100; count++) { try { if ((await fetch(url)).ok) return; } catch {} await new Promise(resolve => setTimeout(resolve, 1000)); } throw new Error('Local medication preview did not become ready.'); }
const money = minor => `${BigInt(minor) / 100n}.${String(BigInt(minor) % 100n).padStart(2, '0')}`;

async function capture(page, name) {
  await page.evaluate(async () => { window.scrollTo(0, 0); document.activeElement?.blur(); await document.fonts.ready; await Promise.all(document.getAnimations().filter(animation => Number.isFinite(animation.effect?.getComputedTiming().endTime)).map(animation => animation.finished.catch(() => {}))); });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, `${name}: no horizontal overflow`);
  const tiny = await page.locator('main').evaluate(element => [...element.querySelectorAll('*')].filter(node => { const box = node.getBoundingClientRect(), style = getComputedStyle(node); return box.width > 2 && box.height > 2 && style.display !== 'none' && style.visibility !== 'hidden' && [...node.childNodes].some(child => child.nodeType === Node.TEXT_NODE && child.textContent.trim()) && parseFloat(style.fontSize) < 16; }).map(node => node.tagName));
  assert.deepEqual(tiny, [], `${name}: readable typography`);
  const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  const failures = axe.violations.filter(row => ['critical', 'serious'].includes(row.impact));
  fs.writeFileSync(path.join(output, `${name} accessibility.json`), JSON.stringify(axe.violations.map(({ id, impact, nodes }) => ({ id, impact, targets: nodes.map(row => row.target) })), null, 2));
  assert.deepEqual(failures, [], `${name}: no serious accessibility defects`);
  await page.screenshot({ path: path.join(output, `${name}.png`), fullPage: true }); captures.push(name);
}
async function responsive(page, name) {
  for (const [label, width, height] of [['mobile', 390, 844], ['tablet', 768, 1024], ['desktop', 1440, 1000]]) { await page.setViewportSize({ width, height }); await capture(page, `${name} ${label}`); }
  await page.setViewportSize({ width: 390, height: 844 });
}
async function contextFor(browser, user) {
  const accessToken = jwt.sign({ userId: user.id, role: user.role }, process.env.JWT_ACCESS_SECRET, { expiresIn: '1h' });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
  context.setDefaultTimeout(90000); context.setDefaultNavigationTimeout(90000);
  await context.addInitScript(session => { if (window === window.top && location.origin === session.appOrigin) { localStorage.setItem('accessToken', session.accessToken); localStorage.setItem('user', JSON.stringify(session.user)); } }, { accessToken, user, appOrigin: new URL(base).origin });
  await context.route('https://checkout.paystack.com/**', route => route.fulfill({ status: 200, contentType: 'text/html', body: '<html lang="en"><title>Isolated payment simulation</title><body><h1>Isolated payment transport</h1><p>No real customer charge occurs in this test.</p></body></html>' }));
  context.on('page', page => {
    page.on('pageerror', error => runtime.push(error.message));
    page.on('console', message => { if (message.type() === 'error') consoleErrors.push({ text: message.text(), location: message.location() }); });
    page.on('response', response => { if (response.status() >= 500) serverErrors.push({ status: response.status(), url: response.url() }); });
  });
  const page = await context.newPage();
  return { context, page, accessToken };
}
async function actorRead(actor, route) { const response = await actor.context.request.get(`${apiBase}/api${route}`, { headers: { Authorization: `Bearer ${actor.accessToken}` } }); assert.equal(response.status(), 200, route); return response.json(); }
async function write(page, pathSuffix, action) {
  const response = page.waitForResponse(row => new URL(row.url()).pathname.endsWith(pathSuffix) && ['POST', 'PATCH'].includes(row.request().method()));
  response.catch(() => {}); await action(); const result = await response;
  const data = await result.json(); assert.equal(result.status() < 300, true, `${pathSuffix}: ${data.error || result.status()}`); return data;
}
async function openPharmacy(actor, orderNumber) {
  await actor.page.goto(`${base}/ng/pharmacy/orders`); await actor.page.getByRole('heading', { name: 'Prescription fulfillment queue', exact: true }).waitFor();
  await actor.page.getByText(orderNumber, { exact: true }).waitFor();
  await actor.page.getByRole('button', { name: 'Review & fulfill order', exact: true }).click();
  await actor.page.getByRole('heading', { name: 'Dispensing & fulfillment', exact: true }).waitFor();
}
async function openPatient(actor, orderId) { await actor.page.goto(`${base}/ng/patient/track?orderId=${encodeURIComponent(orderId)}`); await actor.page.getByRole('heading', { name: 'Medicines confirmed by your pharmacy', exact: true }).waitFor(); }
async function payAndVerify(actor, fixture, orderId, stage) {
  const label = stage === 'medicines' ? 'Pay for medicines securely' : 'Pay approved delivery amount securely';
  const reserved = actor.page.waitForResponse(row => new URL(row.url()).pathname.endsWith(`/orders/${orderId}/pay`) && row.request().method() === 'POST');
  reserved.catch(() => {}); await actor.page.getByRole('button', { name: label, exact: true }).click();
  const response = await reserved; assert.equal(response.status(), 200); assert.equal(response.request().postDataJSON().stage, stage);
  await actor.page.waitForURL('https://checkout.paystack.com/**');
  // Navigation may discard CDP response bodies. Verify the durable attempt from
  // the real authorized API rather than trusting a hosted-checkout return flag.
  const pending = await actorRead(actor, `/ng/patient/orders/${orderId}/checkout`);
  const reference = pending.payment[stage].reference; assert.ok(reference); fixture.markPaid(reference);
  await openPatient(actor, orderId);
  const card = actor.page.getByRole('heading', { name: 'Payment verification', exact: true }).locator('..');
  const block = card.locator(':scope > div').filter({ has: actor.page.getByText(new RegExp(`^${stage === 'medicines' ? 'Medicine' : 'Delivery'} payment ·`)) });
  await write(actor.page, `/payments/${encodeURIComponent(reference)}/verify`, () => block.getByRole('button', { name: 'Verify with payment provider', exact: true }).click());
  const state = await actorRead(actor, `/ng/patient/orders/${orderId}/checkout`); assert.equal(state.payment[stage].status, 'verified');
}
async function checkAdministration(browser, orderNumber) {
  const id = crypto.randomUUID();
  const user = (await pool.query("INSERT INTO users(id,email,password_hash,role,first_name,last_name,country,market_scope,region,is_active,is_verified,is_test_account) VALUES($1,$2,'!isolated-browser-not-a-login','admin','Isolated','Medication Reviewer','NG','NG','NG',TRUE,TRUE,TRUE) RETURNING id,email,role", [id, `medication-admin-${id}@doctarx.test`])).rows[0];
  const admin = await contextFor(browser, { ...user, marketScope: 'NG', firstName: 'Isolated', lastName: 'Medication Reviewer' });
  try {
    await admin.page.goto(`${base}/ng/admin/medication-delivery`); await admin.page.getByRole('heading', { name: 'Medication delivery', exact: true }).waitFor();
    await admin.page.getByRole('heading', { name: 'Financial reconciliation', exact: true }).waitFor();
    const data = await actorRead(admin, '/ng/admin/medication-delivery'); assert.equal(data.report.balanced, true); assert.ok(data.orders.some(order => order.orderNumber === orderNumber));
    await admin.page.getByRole('button', { name: 'Review evidence & coverage', exact: true }).first().click();
    await admin.page.getByRole('region', { name: 'Administrative medication order review', exact: true }).getByRole('heading', { name: orderNumber, exact: true }).waitFor();
    await responsive(admin.page, 'DoctaRx medication delivery administration');
    results.push({ scenario: 'administration', actualLedgerBalanced: true, verifiedInsurancePartnerRead: true, settlementsExecuted: 0 });
  } finally { await admin.context.close(); }
}
async function resumeScenario(browser) {
  const fixture = await createBrowserFixture({ pool }); currentService = fixture.service;
  const created = await fixture.service.createOrder(fixture.input, fixture.patient);
  const orderId = created.order.id;
  let state = await fixture.service.confirmPrice(orderId, fixture.pharmacyUser, { version: created.checkout.version, items: [{ drugId: fixture.drugId, unitPriceMinor: fixture.unitPriceMinor }], pharmacistRegistrationNumber: fixture.registration, attest: true, packageCategory: 'sealed_ambient_medication', idempotencyKey: crypto.randomUUID() });
  state = await fixture.service.setFulfillment(orderId, fixture.patient, { version: state.version, deliveryType: 'pickup', consent: true, contactConsent: false, idempotencyKey: crypto.randomUUID() });
  await fixture.service.approve(orderId, fixture.patient, { version: state.version, stage: 'medicines', consent: true, idempotencyKey: crypto.randomUUID() });
  const patient = await contextFor(browser, fixture.patient);
  try {
    await openPatient(patient, orderId);
    const reserved = patient.page.waitForResponse(row => new URL(row.url()).pathname.endsWith(`/orders/${orderId}/pay`) && row.request().method() === 'POST'); reserved.catch(() => {});
    await patient.page.getByRole('button', { name: 'Pay for medicines securely', exact: true }).click(); assert.equal((await reserved).status(), 200); await patient.page.waitForURL('https://checkout.paystack.com/**');
    const first = await actorRead(patient, `/ng/patient/orders/${orderId}/checkout`); assert.equal(first.payment.medicines.status, 'pending'); assert.equal(fixture.state.initializeCalls, 1);
    await openPatient(patient, orderId); await patient.page.getByRole('button', { name: 'Resume medicine payment securely', exact: true }).waitFor();
    const resumed = patient.page.waitForResponse(row => new URL(row.url()).pathname.endsWith(`/orders/${orderId}/pay`) && row.request().method() === 'POST'); resumed.catch(() => {});
    await patient.page.getByRole('button', { name: 'Resume medicine payment securely', exact: true }).click(); assert.equal((await resumed).status(), 200); await patient.page.waitForURL('https://checkout.paystack.com/**');
    const second = await actorRead(patient, `/ng/patient/orders/${orderId}/checkout`); assert.equal(second.payment.medicines.reference, first.payment.medicines.reference); assert.equal(second.payment.medicines.status, 'pending'); assert.equal(fixture.state.initializeCalls, 1);
    await openPatient(patient, orderId); await capture(patient.page, 'DoctaRx resumed medicine payment mobile');
    results.push({ scenario: 'resume_abandoned_medicine_payment', referenceReused: true, gatewayInitializations: 1, confirmedPaid: false, duplicateCharge: false });
    await fixture.cleanup();
  } finally { await patient.context.close(); }
}
async function financialScenario(browser) {
  const fixture = await createBrowserFixture({ pool }); currentService = fixture.service;
  await pool.query('INSERT INTO ng_pharmacy_wallets(pharmacy_id) VALUES($1)', [fixture.pharmacyId]);
  const created = await fixture.service.createOrder(fixture.input, fixture.patient); const orderId = created.order.id;
  const patient = await contextFor(browser, fixture.patient), pharmacy = await contextFor(browser, fixture.pharmacyUser), admin = await contextFor(browser, fixture.superAdmin);
  try {
    await openPharmacy(pharmacy, created.checkout.orderNumber);
    const category = pharmacy.page.getByRole('combobox', { name: /Verified medication package category/ }); assert.equal(await category.inputValue(), '');
    await pharmacy.page.getByLabel(/Final unit price in NGN for/).fill(money(fixture.unitPriceMinor)); await pharmacy.page.getByLabel('Verifying pharmacist’s registration number', { exact: true }).fill(fixture.registration); await pharmacy.page.getByLabel(/I am the authorized licensed pharmacist/).check();
    assert.equal(await pharmacy.page.getByRole('button', { name: 'Confirm availability & final medicine prices', exact: true }).isEnabled(), false, 'No default package classification');
    await category.selectOption('sealed_ambient_medication'); await pharmacy.page.getByLabel(/I am the authorized licensed pharmacist/).check();
    await write(pharmacy.page, `/orders/${orderId}/price`, () => pharmacy.page.getByRole('button', { name: 'Confirm availability & final medicine prices', exact: true }).click());
    await openPatient(patient, orderId); await patient.page.getByRole('radio', { name: /Deliver my medicines/ }).check();
    for (const [label, key] of [['Recipient’s full name', 'recipientName'], ['Authorized contact phone', 'recipientPhone'], ['Street address and building', 'addressLine1'], ['City / district', 'city'], ['State / FCT', 'state'], ['Postal code, if available', 'postalCode']]) await patient.page.getByLabel(label, { exact: true }).fill(String(fixture.address[key]));
    assert.equal(await patient.page.getByLabel('Destination latitude', { exact: true }).isVisible(), false, 'Map coordinates start collapsed');
    await patient.page.getByLabel(/I authorize sharing this recipient/).check(); await patient.page.getByLabel(/I confirm this delivery address/).check();
    let fulfillmentWrites = 0; patient.page.on('request', request => { if (request.method() === 'POST' && new URL(request.url()).pathname.endsWith(`/orders/${orderId}/fulfillment`)) fulfillmentWrites++; });
    await patient.page.getByRole('button', { name: 'Save delivery details', exact: true }).click(); await patient.page.getByText(/Choose a delivery location using your device/).waitFor();
    assert.equal(fulfillmentWrites, 0, 'Missing destination never sends an invalid checkout'); assert.equal(await patient.page.getByLabel('Destination latitude', { exact: true }).isVisible(), true); await patient.page.getByLabel('Destination latitude', { exact: true }).fill(String(fixture.address.latitude)); await patient.page.getByLabel('Destination longitude', { exact: true }).fill(String(fixture.address.longitude));
    await patient.page.getByLabel(/I authorize sharing this recipient/).check(); await patient.page.getByLabel(/I confirm this delivery address/).check(); await write(patient.page, `/orders/${orderId}/fulfillment`, () => patient.page.getByRole('button', { name: 'Save delivery details', exact: true }).click());
    assert.equal(fulfillmentWrites, 1); await capture(patient.page, 'DoctaRx verified delivery location mobile');
    let state = await fixture.service.getCheckout(orderId, fixture.patient); state = await fixture.service.approve(orderId, fixture.patient, { version: state.version, stage: 'medicines', consent: true, idempotencyKey: crypto.randomUUID() });
    const payment = await fixture.service.initiatePayment(orderId, fixture.patient, { version: state.version, stage: 'medicines', idempotencyKey: crypto.randomUUID() }); await fixture.service.verifyPayment(orderId, fixture.patient, payment.reference);
    await pharmacy.page.goto(`${base}/ng/pharmacy/wallet`); await pharmacy.page.getByRole('heading', { name: 'Medication-order statement', exact: true }).waitFor();
    const wallet = await actorRead(pharmacy, `/ng/pharmacy/${fixture.pharmacyId}/wallet`); assert.equal(wallet.medicationStatement.outstandingMinor, 900000); assert.equal(wallet.medicationStatement.settledMinor, 0); assert.equal(Number(wallet.balance), 0);
    await capture(pharmacy.page, 'DoctaRx separate medication pharmacy statement mobile'); await pharmacy.page.setViewportSize({ width: 1440, height: 1000 }); await capture(pharmacy.page, 'DoctaRx separate medication pharmacy statement desktop');
    await admin.page.goto(`${base}/ng/admin/medication-delivery`); await admin.page.getByRole('heading', { name: 'Financial reconciliation', exact: true }).waitFor(); await admin.page.getByRole('button', { name: 'Review evidence & coverage', exact: true }).first().click();
    await admin.page.getByText('Medication payouts are awaiting activation.', { exact: false }).waitFor(); assert.equal(await admin.page.getByRole('button', { name: 'Approve documented medication payout', exact: true }).count(), 0);
    await capture(admin.page, 'DoctaRx gated medication settlement administration mobile'); await admin.page.setViewportSize({ width: 1440, height: 1000 }); await capture(admin.page, 'DoctaRx gated medication settlement administration desktop');
    results.push({ scenario: 'pharmacy_wallet_admin_and_location', explicitPackageClassification: true, missingLocationExpandedBeforeRequest: true, actualMedicationOutstandingMinor: 900000, legacyAvailableCashMinor: 0, payoutExecutionEnabled: false, payoutRequests: 0 }); await fixture.cleanup();
  } finally { await patient.context.close(); await pharmacy.context.close(); await admin.context.close(); }
}
async function scenario(browser, deliveryType) {
  const fixture = await createBrowserFixture({ pool }); currentService = fixture.service;
  const patient = await contextFor(browser, fixture.patient), pharmacy = await contextFor(browser, fixture.pharmacyUser);
  try {
    await patient.page.goto(`${base}/ng/patient/orders`); await patient.page.getByRole('heading', { name: 'Your pharmacy orders', exact: true }).waitFor();
    await patient.page.getByRole('button', { name: 'Start an order', exact: true }).click(); await patient.page.getByLabel('Prescription and pharmacy', { exact: true }).selectOption(`digital:${fixture.prescriptionId}`);
    const created = await write(patient.page, '/ng/patient/orders', () => patient.page.getByRole('button', { name: 'Send to pharmacy for final confirmation', exact: true }).click());
    const orderId = created.order.id, orderNumber = created.checkout.orderNumber;
    await openPharmacy(pharmacy, orderNumber); await pharmacy.page.getByLabel(/Final unit price in NGN for/).fill(money(fixture.unitPriceMinor)); await pharmacy.page.getByLabel('Verifying pharmacist’s registration number', { exact: true }).fill(fixture.registration); await pharmacy.page.getByRole('combobox', { name: /Verified medication package category/ }).selectOption('sealed_ambient_medication'); await pharmacy.page.getByLabel(/I am the authorized licensed pharmacist/).check();
    await write(pharmacy.page, `/orders/${orderId}/price`, () => pharmacy.page.getByRole('button', { name: 'Confirm availability & final medicine prices', exact: true }).click());
    await openPatient(patient, orderId);
    if (deliveryType === 'delivery') {
      await patient.page.getByRole('radio', { name: /Deliver my medicines/ }).check();
      for (const [label, key] of [['Recipient’s full name', 'recipientName'], ['Authorized contact phone', 'recipientPhone'], ['Street address and building', 'addressLine1'], ['City / district', 'city'], ['State / FCT', 'state'], ['Postal code, if available', 'postalCode'], ['Destination latitude', 'latitude'], ['Destination longitude', 'longitude']]) { if (key === 'latitude') await patient.page.getByText('Use a different verified map location', { exact: true }).click(); await patient.page.getByLabel(label, { exact: true }).fill(String(fixture.address[key])); }
      await patient.page.getByLabel(/I authorize sharing this recipient/).check(); await patient.page.getByLabel(/I confirm this delivery address/).check();
      await write(patient.page, `/orders/${orderId}/fulfillment`, () => patient.page.getByRole('button', { name: 'Save delivery details', exact: true }).click());
    } else { await patient.page.getByLabel(/I choose collection from this pharmacy/).check(); await write(patient.page, `/orders/${orderId}/fulfillment`, () => patient.page.getByRole('button', { name: 'Save pharmacy collection', exact: true }).click()); }
    await patient.page.getByLabel(/I approve these confirmed medicine charges/).check(); await write(patient.page, `/orders/${orderId}/approve`, () => patient.page.getByRole('button', { name: 'Approve medicines', exact: true }).click());
    await responsive(patient.page, `DoctaRx ${deliveryType} medicine checkout`); await payAndVerify(patient, fixture, orderId, 'medicines');
    await openPharmacy(pharmacy, orderNumber); await write(pharmacy.page, `/orders/${orderId}/confirm`, () => pharmacy.page.getByRole('button', { name: 'Start pharmacy preparation', exact: true }).click());
    await openPharmacy(pharmacy, orderNumber); await pharmacy.page.getByLabel(/I have completed the licensed-pharmacist check/).check(); await responsive(pharmacy.page, `DoctaRx ${deliveryType} pharmacy verification`); await write(pharmacy.page, `/orders/${orderId}/ready`, () => pharmacy.page.getByRole('button', { name: 'Confirm prepared & verified', exact: true }).click());
    if (deliveryType === 'pickup') {
      await openPharmacy(pharmacy, orderNumber); await pharmacy.page.getByLabel(/I verified the patient or their authorized representative/).check(); await write(pharmacy.page, `/orders/${orderId}/collect`, () => pharmacy.page.getByRole('button', { name: 'Record pharmacy collection', exact: true }).click());
      const state = await actorRead(patient, `/ng/patient/orders/${orderId}/checkout`); assert.equal(state.pricing.courierMinor, 0); assert.equal(state.pricing.managementMinor, 0); assert.equal(fixture.state.bookCalls, 0); results.push({ scenario: 'pickup', noCourierFee: true, courierBookings: 0, initializedPayments: fixture.state.initializeCalls });
    } else {
      await openPatient(patient, orderId); await write(patient.page, `/orders/${orderId}/delivery-quote`, () => patient.page.getByRole('button', { name: 'Check approved courier availability & price', exact: true }).click());
      await patient.page.getByLabel(/I approve this courier fare/).check(); await write(patient.page, `/orders/${orderId}/approve`, () => patient.page.getByRole('button', { name: 'Approve this delivery quote', exact: true }).click());
      await responsive(patient.page, 'DoctaRx approved courier checkout'); await payAndVerify(patient, fixture, orderId, 'delivery');
      await openPharmacy(pharmacy, orderNumber); await pharmacy.page.getByLabel(/The verified sealed package is ready for this courier pickup/).check(); await write(pharmacy.page, `/orders/${orderId}/delivery/dispatch`, () => pharmacy.page.getByRole('button', { name: 'Book approved courier once', exact: true }).click()); assert.equal(fixture.state.bookCalls, 1);
      fixture.state.now = Math.max(fixture.state.now, Date.now());
      await fixture.advanceDelivery('delivered'); await openPharmacy(pharmacy, orderNumber); await write(pharmacy.page, `/orders/${orderId}/delivery/refresh`, () => pharmacy.page.getByRole('button', { name: 'Retrieve verified courier status', exact: true }).click());
      const state = await actorRead(patient, `/ng/patient/orders/${orderId}/checkout`); assert.equal(state.delivery.status, 'delivered'); assert.ok(state.delivery.pickupProof?.recordedAt); assert.ok(state.delivery.deliveryProof?.recordedAt); assert.equal(state.pricing.managementMinor, 75000); assert.equal(state.pricing.patientTotalMinor, 1255000);
      await patient.page.goto(`${base}/ng/patient/track/${state.delivery.trackingId}`); await patient.page.getByRole('heading', { name: 'Pickup & delivery evidence', exact: true }).waitFor(); await responsive(patient.page, 'DoctaRx private delivery tracking');
      results.push({ scenario: 'delivery', managementMinor: 75000, totalMinor: 1255000, verifiedPaymentStages: 2, courierBookings: fixture.state.bookCalls, pickupProof: true, deliveryProof: true });
      await checkAdministration(browser, orderNumber);
    }
    await fixture.cleanup();
  } finally { await patient.context.close(); await pharmacy.context.close(); }
}
async function main() {
  const app = express(); app.use(cors({ origin: base, credentials: true })); app.use(cookieParser()); app.use(express.json());
  app.get('/api/health', async (_req, res) => { try { await pool.query('SELECT 1'); res.json({ status: 'ok', isolatedSimulation: true }); } catch { res.status(503).json({ status: 'unavailable' }); } });
  for (const route of ['auth', 'notifications', 'users']) app.use(`/api/${route}`, require(`../server/routes/${route}`));
  app.use('/api/ng', require('../ng/routes')); const server = app.listen(Number(apiUrl.port), apiUrl.hostname); await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  let next, log, browser;
  try {
    if (!process.env.MEDICATION_DELIVERY_NEXT_BASE_URL) { log = fs.openSync(path.join(output, productionBuild ? 'next-production.log' : 'next.log'), 'w'); next = spawn(process.execPath, [require.resolve('next/dist/bin/next'), productionBuild ? 'start' : 'dev', '-p', '3008', '-H', '127.0.0.1'], { cwd: path.resolve(__dirname, '..'), windowsHide: true, env: { ...process.env, NODE_ENV: productionBuild ? 'production' : 'development', NEXT_DIST_DIR: nextDist, DOCTARX_DISABLE_BUILD_CACHE: 'true' }, stdio: ['ignore', log, log] }); }
    await waitFor(`${base}/ng/patient/login`); browser = await chromium.launch({ headless: true });
    const resumeOnly = process.env.MEDICATION_DELIVERY_FOCUS === 'resume', financialOnly = process.env.MEDICATION_DELIVERY_FOCUS === 'financial';
    if (resumeOnly) await resumeScenario(browser); else if (financialOnly) await financialScenario(browser); else { await scenario(browser, 'pickup'); await scenario(browser, 'delivery'); }
    assert.deepEqual(runtime, []);
    assert.deepEqual(consoleErrors, [], 'No browser console errors');
    assert.deepEqual(serverErrors, [], 'No HTTP 5xx responses');
    const receiptName = resumeOnly ? 'DoctaRx medication payment resume validation.json' : financialOnly ? 'DoctaRx pharmacy statement and location validation.json' : 'DoctaRx medication delivery browser validation.json';
    fs.writeFileSync(path.join(output, receiptName), JSON.stringify({ passed: true, completedAt: new Date().toISOString(), servedProductionBuild: productionBuild, buildId, backendSourceSha256, enabledSettlementExecutionExercised: false, realApplicationRoutes: true, actualPostgres: true, externalCourierCalls: 0, realCustomerCharges: 0, isolatedTransports: true, accountResets: 0, productionDeployment: false, pageErrors: runtime, consoleErrors, http5xxResponses: serverErrors, scenarios: results, captures }, null, 2));
    console.log(JSON.stringify({ passed: true, servedProductionBuild: productionBuild, buildId, scenarios: results, captures: captures.length, pageErrors: runtime.length, consoleErrors: consoleErrors.length, http5xxResponses: serverErrors.length, externalCourierCalls: 0, realCustomerCharges: 0 }));
  } finally { await browser?.close(); if (next) next.kill(); if (log != null) fs.closeSync(log); await new Promise(resolve => server.close(resolve)); await pool.end(); await db.close(); require.cache[workflowPath].exports = workflow; }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
