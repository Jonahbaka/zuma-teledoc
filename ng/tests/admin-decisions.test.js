'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const decisions = require('../services/adminVerificationService');
const { validateManualActivation } = require('../services/manualSubscriptionActivationService');
const checkout = require('../services/subscriptionCheckoutGateService');
const { cancelSubscription } = require('../services/subscriptionCancellationService');

const actorId = '00000000-0000-4000-8000-000000000001';
const subscriptionId = '00000000-0000-4000-8000-000000000002';

test('verification decisions reject prototype keys, malformed IDs and missing or oversized decision reasons', () => {
  const statuses = { approve: 'verified', reject: 'rejected', suspend: 'suspended' };
  assert.deepEqual(decisions.validateDecision(subscriptionId, { action: 'approve' }, statuses), { action: 'approve', status: 'verified', reason: null });
  for (const [id, body] of [
    ['invalid', { action: 'approve' }], [subscriptionId, { action: '__proto__' }], [subscriptionId, { action: 'constructor' }],
    [subscriptionId, { action: 'suspend', reason: ' ' }], [subscriptionId, { action: 'reject', reason: ['not text'] }],
    [subscriptionId, { action: 'approve', reason: 'x'.repeat(1001) }],
  ]) assert.throws(() => decisions.validateDecision(id, body, statuses), error => error.status === 400);
});

test('current database actor controls NG administrator access even after a valid earlier session check', async () => {
  for (const row of [null, { role: 'patient', market_scope: 'NG', is_active: true }, { role: 'super_admin', market_scope: 'US', is_active: true }, { role: 'admin', market_scope: 'NG', is_active: false }]) {
    const client = { async query(sql, params) { assert.ok(sql.includes('FOR SHARE')); assert.deepEqual(params, [actorId]); return { rows: row ? [row] : [] }; } };
    await assert.rejects(decisions.requireCurrentNGActor(client, actorId), error => error.status === 403);
  }
  const actor = await decisions.requireCurrentNGActor({ query: async () => ({ rows: [{ id: actorId, role: 'super_admin', market_scope: 'NG', is_active: true }] }) }, actorId);
  assert.equal(actor.id, actorId);
});

test('manual confirmations require supplied real payment reference/amount, one subject and a bounded current period', () => {
  const valid = { subjectType: 'provider', userId: actorId, planKey: 'provider_basic', amountNgn: '10000.25', paymentReference: 'Recorded-bank-reference', periodEnd: new Date(Date.now() + 30 * 86400000).toISOString() };
  assert.equal(validateManualActivation(valid).amountNgn, 10000.25);
  for (const change of [
    { paymentReference: '' }, { paymentReference: {} }, { paymentReference: 'x'.repeat(121) }, { amountNgn: undefined }, { amountNgn: -1 }, { amountNgn: '10.001' },
    { organizationId: subscriptionId }, { subjectType: 'patient' }, { userId: 'invalid' }, { planKey: 'x'.repeat(51) },
    { periodEnd: undefined }, { periodEnd: 'invalid' }, { periodEnd: new Date(Date.now() - 10000).toISOString() },
    { periodStart: new Date(Date.now() + 86400000).toISOString() }, { periodEnd: new Date(Date.now() + 367 * 86400000).toISOString() },
    { idempotencyKey: 'invalid' }, { notes: 'x'.repeat(1001) }, { paymentMethod: 'gateway_verified' },
  ]) assert.throws(() => validateManualActivation({ ...valid, ...change }), error => error.status === 400);
});

function isolatedGatePool({ role = 'patient', market = 'NG', status = 'pending', reference = 'SAVED', owner = true } = {}) {
  const statements = [];
  const client = {
    released: false,
    async query(sql, params) {
      statements.push(sql);
      if (['BEGIN', 'ROLLBACK', 'COMMIT'].includes(sql)) return { rows: [], rowCount: 0 };
      if (sql.includes('FROM users')) return { rows: [{ id: actorId, role, market_scope: market, is_active: true }], rowCount: 1 };
      if (sql.includes('FROM ng_subscriptions')) {
        assert.ok(sql.includes('subscriber_user_id = $2')); assert.ok(sql.includes('FOR SHARE'));
        assert.deepEqual(params, [subscriptionId, actorId]);
        return { rows: owner ? [{ id: subscriptionId, status, amount_per_period: '10000.00', currency: 'NGN', last_payment_reference: reference }] : [], rowCount: owner ? 1 : 0 };
      }
      throw new Error('Unexpected write or gateway action');
    },
    release() { client.released = true; },
  };
  return { statements, client, connect: async () => client };
}

test('customer subscription checkout remains closed before any charge even with caller amount/environment or forged receipt', async () => {
  for (const activation of [undefined, { payment_reference: 'SAVED', payment_provider: 'paystack', amount: 1, currency: 'USD', environment: 'live', receipt: { verified: true } }]) {
    const pool = isolatedGatePool();
    await assert.rejects(checkout.assertCheckoutUnavailable(pool, { actorId, subscriptionId, activation }), error => error.status === 503 && error.code === 'SUBSCRIPTION_CHECKOUT_NOT_ACTIVATED');
    assert.equal(pool.statements.some(sql => /\b(UPDATE|INSERT|DELETE|COMMIT)\b/.test(sql)), false);
    assert.equal(pool.statements.at(-1), 'ROLLBACK'); assert.equal(pool.client.released, true);
  }
});

test('subscription activation denies forged reference, foreign owner/current market and terminal replay without writes', async () => {
  for (const [options, expected, activation] of [
    [{ owner: false }, 404, { payment_reference: 'SAVED' }], [{ market: 'US' }, 403, { payment_reference: 'SAVED' }],
    [{ reference: 'SAVED' }, 409, { payment_reference: 'FORGED' }],
    ...['active', 'canceled', 'expired'].map(status => [{ status }, 409, { payment_reference: 'SAVED' }]),
  ]) {
    const pool = isolatedGatePool(options);
    await assert.rejects(checkout.assertCheckoutUnavailable(pool, { actorId, subscriptionId, activation }), error => error.status === expected);
    assert.equal(pool.statements.some(sql => /\b(UPDATE|INSERT|DELETE|COMMIT)\b/.test(sql)), false);
    assert.equal(pool.client.released, true);
  }
});

test('invalid admin cancellation never acquires a connection or reports success', async () => {
  const pool = { async connect() { throw new Error('Invalid requests must not reach the database'); } };
  await assert.rejects(cancelSubscription(pool, { actorId, subscriptionId, admin: true, reason: '' }), error => error.status === 400);
  await assert.rejects(cancelSubscription(pool, { actorId, subscriptionId: 'invalid', admin: true, reason: 'Recorded staff reason' }), error => error.status === 400);
});
