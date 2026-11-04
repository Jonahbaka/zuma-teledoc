'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');
const express = require('express');
const { acceptVerifiedEvent, processReceipt } = require('../services/payments/paymentWebhookService');
const { createCourierProvider } = require('../services/logistics/providers');

function receiptPool({ medication = false, consultation = false, legacyOrder = false } = {}) {
  const calls = [];
  const receipts = new Map();
  return {
    calls,
    receipts,
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (sql.includes('INSERT INTO ng_integration_webhook_receipts')) {
        const key = params[0];
        if (!receipts.has(key)) receipts.set(key, { id: `receipt-${receipts.size + 1}`, status: 'received', event_type: params[1], resource_reference: params[2] });
        return { rows: [{ ...receipts.get(key) }] };
      }
      if (sql.includes('UPDATE ng_integration_webhook_receipts')) {
        const receipt = [...receipts.values()].find(value => value.id === params[0]);
        if (receipt) receipt.status = sql.includes("status = 'failed'") ? 'failed' : 'processed';
        return { rows: [] };
      }
      if (sql.includes('FROM ng_medication_payment_attempts')) return { rows: medication ? [{ id: 'medication-attempt' }] : [] };
      if (sql.includes('FROM ng_consultation_payment_attempts')) return { rows: consultation ? [{ id: 'consultation-attempt' }] : [] };
      if (sql.includes('FROM ng_orders')) return { rows: legacyOrder ? [{ id: 'legacy-order' }] : [] };
      throw new Error(`Unexpected test query: ${sql}`);
    },
  };
}
function fixtureServices() {
  const calls = [];
  return {
    calls,
    medicationDeliveryService: {
      async confirmPaymentReference(reference) { calls.push(['medication', reference]); return { status: 'paid' }; },
      async handleRefundWebhook(event, data) { calls.push(['refund', event, data]); return { status: 'refund_pending' }; },
    },
    billingService: { async confirmReference(reference) { calls.push(['consultation', reference]); return { status: 'paid' }; } },
    orderService: { async confirmPayment(reference, provider) { calls.push(['legacy-order', reference, provider]); return { status: 'paid' }; } },
  };
}

test('medication receipts use the new verified payment workflow before consultation or legacy order handlers', async () => {
  const pool = receiptPool({ medication: true, consultation: true, legacyOrder: true });
  const services = fixtureServices();
  const event = { event: 'charge.success', data: { reference: 'medication-payment-1' } };
  const raw = Buffer.from(JSON.stringify(event));
  await acceptVerifiedEvent(pool, event, raw, services);
  assert.deepEqual(services.calls, [['medication', 'medication-payment-1']]);
  assert.equal(pool.calls.some(call => call.sql.includes('FROM ng_consultation_payment_attempts')), false);
  const replay = await acceptVerifiedEvent(pool, event, raw, services);
  assert.equal(replay.alreadyProcessed, true);
  assert.equal(services.calls.length, 1);
  assert.equal(pool.receipts.size, 1);
});

test('existing consultation and legacy pharmacy payment routing is preserved', async () => {
  for (const expected of ['consultation', 'legacy-order']) {
    const pool = receiptPool({ consultation: expected === 'consultation', legacyOrder: expected === 'legacy-order' });
    const services = fixtureServices();
    const event = { event: 'charge.success', data: { reference: 'existing-payment' } };
    await acceptVerifiedEvent(pool, event, Buffer.from(JSON.stringify(event)), services);
    assert.equal(services.calls[0][0], expected);
    assert.equal(services.calls[0][1], 'existing-payment');
  }
});

test('failed or pending medication verification remains retryable without falling through to a legacy payment', async () => {
  const pool = receiptPool({ medication: true, legacyOrder: true });
  const services = fixtureServices();
  services.medicationDeliveryService.confirmPaymentReference = async () => ({ status: 'pending' });
  const event = { event: 'charge.success', data: { reference: 'pending-medication-payment' } };
  await assert.rejects(acceptVerifiedEvent(pool, event, Buffer.from(JSON.stringify(event)), services), /not yet complete/);
  assert.equal([...pool.receipts.values()][0].status, 'failed');
  assert.equal(services.calls.length, 0);
});

test('refund receipt uses transaction_reference, passes verified event and retains no customer payload', async () => {
  for (const eventType of ['refund.processed', 'refund.failed']) {
    const pool = receiptPool({ medication: true });
    const services = fixtureServices();
    const event = { event: eventType, data: { transaction_reference: 'medication-payment-1', refund_reference: null, amount: '355000', currency: 'NGN', status: eventType.split('.')[1], customer: { email: 'not-to-be-persisted@example.invalid' } } };
    await acceptVerifiedEvent(pool, event, Buffer.from(JSON.stringify(event)), services);
    assert.deepEqual(services.calls, [['refund', eventType, event.data]]);
    const insert = pool.calls.find(call => call.sql.includes('INSERT INTO ng_integration_webhook_receipts'));
    assert.equal(insert.params[2], 'medication-payment-1');
    assert.doesNotMatch(JSON.stringify(insert.params), /not-to-be-persisted|customer|amount/);
  }
});

test('refund reconciliation without the original event requests fresh evidence by transaction reference', async () => {
  const pool = receiptPool({ medication: true });
  const services = fixtureServices();
  await processReceipt(pool, { id: 'failed-receipt', status: 'failed', event_type: 'refund.processed', resource_reference: 'medication-payment-1' }, services);
  assert.deepEqual(services.calls, [['refund', 'refund.processed', { transaction_reference: 'medication-payment-1' }]]);
});

test('a refund service failure leaves the durable receipt failed for replay or reconciliation', async () => {
  const pool = receiptPool({ medication: true });
  const services = fixtureServices();
  services.medicationDeliveryService.handleRefundWebhook = async () => { throw new Error('Authoritative refund evidence unavailable'); };
  const event = { event: 'refund.processed', data: { transaction_reference: 'medication-payment-1' } };
  await assert.rejects(acceptVerifiedEvent(pool, event, Buffer.from(JSON.stringify(event)), services), /evidence unavailable/);
  assert.equal([...pool.receipts.values()][0].status, 'failed');
});

test('unknown references and unrelated refunds cannot alter medication orders', async () => {
  const pool = receiptPool();
  const services = fixtureServices();
  const event = { event: 'refund.processed', data: { transaction_reference: 'another-product-payment' } };
  assert.equal((await acceptVerifiedEvent(pool, event, Buffer.from(JSON.stringify(event)), services)).ignored, true);
  assert.deepEqual(services.calls, []);
});

const courierEnv = {
  NODE_ENV: 'test', NG_COURIER_DELIVERY_ENABLED: 'true', NG_COURIER_PROVIDER: 'uber_direct', UBER_DIRECT_ENABLED: 'true',
  UBER_DIRECT_CONTRACT_REFERENCE: 'isolated-contract', UBER_DIRECT_FCT_APPROVAL_REFERENCE: 'isolated-area', UBER_DIRECT_MEDICATION_APPROVAL_REFERENCE: 'isolated-category',
  UBER_DIRECT_CLIENT_ID: 'isolated-client', UBER_DIRECT_CLIENT_SECRET: 'isolated-secret', UBER_DIRECT_CUSTOMER_ID: 'isolated-customer', UBER_DIRECT_WEBHOOK_SIGNING_KEY: 'isolated-signing-key',
};

test('courier HTTP boundary preserves escaped raw bytes, rejects unsigned/other providers and returns no private payload', async () => {
  const provider = createCourierProvider({ env: courierEnv });
  const calls = [];
  const eventIds = new Set();
  const workflow = { async acceptCourierWebhook(raw, headers) {
    calls.push({ raw, headers });
    const event = provider.verifyWebhook(raw, headers);
    const duplicate = eventIds.has(event.eventId);
    eventIds.add(event.eventId);
    return { duplicate, privateAddress: 'NOT_FOR_RESPONSE' };
  } };
  const routePath = require.resolve('../routes/webhooks');
  const originalLoad = Module._load;
  let routes;
  try {
    Module._load = function loadForCourierBoundary(request, parent) {
      if (parent?.filename === routePath) {
        if (request === '../services/logistics/medicationDeliveryWorkflowService') return workflow;
        if (request.startsWith('../services/') || request === '../../server/db') return {};
      }
      return originalLoad.apply(this, arguments);
    };
    delete require.cache[routePath];
    routes = require(routePath);
    const app = express();
    // Exercise the same global JSON-parser boundary as server/index.js.
    app.use(express.json({ verify(req, _res, body) { req.rawBody = Buffer.from(body); } }));
    app.use('/api/ng/webhooks', routes);
    const server = await new Promise(resolve => { const listener = app.listen(0, '127.0.0.1', () => resolve(listener)); });
    try {
      const base = `http://127.0.0.1:${server.address().port}/api/ng/webhooks`;
      const raw = Buffer.from('{"id":"evt_test1","customer_id":"isolated-customer","kind":"event.delivery_status","delivery_id":"del_test1","status":"delivered","created":"2026-10-15T15:00:00Z","data":{"id":"del_test1","status":"delivered","currency":"ngn","fee":280000,"external_id":"local\\u002d1"}}');
      const signature = crypto.createHmac('sha256', courierEnv.UBER_DIRECT_WEBHOOK_SIGNING_KEY).update(raw).digest('hex');
      const options = { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-uber-signature': signature }, body: raw };
      const response = await fetch(`${base}/delivery/uber_direct`, options);
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { received: true, duplicate: false });
      assert.deepEqual(calls[0].raw, raw);
      const replay = await fetch(`${base}/delivery/uber_direct`, options);
      assert.deepEqual(await replay.json(), { received: true, duplicate: true });
      const invalid = await fetch(`${base}/delivery/uber_direct`, { ...options, headers: { 'Content-Type': 'application/json' } });
      assert.equal(invalid.status, 401);
      const another = await fetch(`${base}/delivery/kwik`, options);
      assert.equal(another.status, 404);
      assert.equal(calls.length, 3);
      assert.equal(eventIds.size, 1);
    } finally { await new Promise(resolve => server.close(resolve)); }
  } finally { Module._load = originalLoad; delete require.cache[routePath]; }
});

test('production JSON parser captures raw Uber Direct webhook bytes', () => {
  const source = fs.readFileSync(path.join(__dirname, '../../server/index.js'), 'utf8');
  assert.match(source, /\/api\/ng\/webhooks\/delivery\/uber_direct['"]/);
  assert.match(source, /req\.rawBody = Buffer\.from\(buffer\)/);
});
