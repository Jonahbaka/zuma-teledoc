'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const { createMedicationDeliveryWorkflowService } = require('../services/logistics/medicationDeliveryWorkflowService');
const { createMedicationFinanceService } = require('../services/logistics/medicationFinanceService');
const { createCourierProvider } = require('../services/logistics/providers');

test('production workflow rejects every injected test dependency before touching a database or provider', () => {
  let touched = 0;
  const fixtures = {
    pool: { query() { touched++; }, connect() { touched++; } },
    provider: { getAvailability() { touched++; } },
    gateway: { initializeTransaction() { touched++; } },
    finance: { postPayment() { touched++; } },
    now() { touched++; },
  };
  for (const [key, fixture] of Object.entries(fixtures)) {
    assert.throws(() => createMedicationDeliveryWorkflowService({ env: { NODE_ENV: 'production' }, [key]: fixture }), error => error.status === 500 && /Test dependencies/.test(error.message));
  }
  assert.equal(touched, 0);
});

test('production finance and courier adapters cannot accept an injected mock gateway or transport', () => {
  let touched = 0;
  assert.throws(() => createMedicationFinanceService({ env: { NODE_ENV: 'production' }, gateway: { createRefund() { touched++; } } }), { code: 'MEDICATION_TEST_GATEWAY_FORBIDDEN' });
  assert.throws(() => createCourierProvider({ env: { NODE_ENV: 'production' }, fetchImpl: async () => { touched++; } }), { code: 'COURIER_TEST_TRANSPORT_FORBIDDEN' });
  assert.equal(touched, 0);
});

test('medication checkout defaults to disabled even with an otherwise configured merchant', async () => {
  let databaseCalls = 0; let providerCalls = 0;
  const service = createMedicationDeliveryWorkflowService({
    env: { NODE_ENV: 'test', PAYSTACK_SECRET_KEY: 'sk_test_isolated', NEXT_PUBLIC_APP_URL: 'http://127.0.0.1:3005' },
    pool: { async query() { databaseCalls++; throw new Error('Disabled checkout must not access a database'); }, async connect() { databaseCalls++; throw new Error('Disabled checkout must not reserve a payment'); } },
    provider: { getAvailability() { providerCalls++; return { available: false }; } },
    gateway: { initializeTransaction() { providerCalls++; throw new Error('Disabled checkout must not collect money'); } },
  });
  await assert.rejects(service.initiatePayment('00000000-0000-4000-8000-000000000001', { id: '00000000-0000-4000-8000-000000000002' }, { stage: 'medicines', idempotencyKey: 'isolated-request-key' }), error => error.status === 503 && /merchant activation/.test(error.message));
  assert.equal(databaseCalls, 0);
  assert.equal(providerCalls, 0);
});
