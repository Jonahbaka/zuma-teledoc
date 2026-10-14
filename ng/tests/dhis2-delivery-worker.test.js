'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { processDueJobs } = require('../services/public-health/dhis2DeliveryWorkerService');
const { assertProfile, applyCommand } = require('../services/public-health/dhis2DeliveryOperationsService');
const { importOutcome, asyncTask, retryAfterMs, scheduledDelay } = require('../services/public-health/dhis2DeliveryService');
const env = { ENCRYPTION_KEY: 'a'.repeat(64), DHIS2_ALLOW_LIVE_SYNC: 'true' };
const config = { baseUrl: 'https://approved.example.invalid', username: 'approved-principal', apiToken: 'isolated', settings: { environment: 'sandbox', enabled: true, dryRunOnly: false,
  governmentApprovalStatus: 'approved', apiCredentialsStatus: 'configured', dataSharingAgreementStatus: 'approved', ndprReviewStatus: 'approved',
  apiVersion: '2.43', profileApprovalReference: 'Approved isolated profile', asyncImportEnabled: true } };

test('worker defaults disabled without touching storage or transport, with bounded batch input', async () => {
  const pool = { query() { throw new Error('Disabled worker must not query'); } };
  assert.deepEqual(await processDueJobs(pool, { env: {}, fetchImpl() { throw new Error('No network'); } }), { enabled: false, examined: 0, confirmed: 0, pending: 0, failed: 0, contended: 0 });
  for (const limit of [0,51,1.5,'10']) await assert.rejects(processDueJobs(pool, { env: {}, limit }));
});
test('only explicitly approved known-version encrypted configurations can activate delivery', () => {
  assert.deepEqual(assertProfile(config, env), { apiVersion: '2.43', approvalReference: config.settings.profileApprovalReference, asyncImportEnabled: true });
  for (const settings of [{ apiVersion: null }, { apiVersion: '2.44' }, { profileApprovalReference: '' }, { dryRunOnly: true }, { enabled: false }, { governmentApprovalStatus: 'pending' }, { environment: 'disabled' }])
    assert.throws(() => assertProfile({ ...config, settings: { ...config.settings, ...settings } }, env));
  assert.throws(() => assertProfile(config, { ...env, ENCRYPTION_KEY: '' }), { code: 'DHIS2_ENCRYPTION_KEY_REQUIRED' });
  assert.throws(() => assertProfile(config, { ...env, DHIS2_ALLOW_LIVE_SYNC: 'false' }), { code: 'DHIS2_ACTIVATION_REQUIRED' });
  assert.throws(() => assertProfile({ ...config, username: null }, env), { code: 'DHIS2_TASK_PRINCIPAL_REQUIRED' });
});
test('async adapter accepts only DATAVALUE_IMPORT task IDs and never returns a notifier URL', () => {
  assert.deepEqual(asyncTask({ response: { id: 'a1234567890', jobType: 'DATAVALUE_IMPORT', relativeNotifierEndpoint: 'https://foreign.example.invalid/private' } }), { id: 'a1234567890', type: 'DATAVALUE_IMPORT' });
  for (const response of [{ id: '../secret', jobType: 'DATAVALUE_IMPORT' }, { id: 'a1234567890', jobType: 'METADATA_IMPORT' }, { id: 'x', relativeNotifierEndpoint: '/api/tasks' }]) assert.throws(() => asyncTask({ response }), { code: 'DHIS2_TASK_INVALID' });
  assert.equal(asyncTask({ importCount: { imported: 1 } }), null);
});
test('transient import statuses schedule reconciliation while permanent rejection stays terminal', () => {
  for (const code of [408,425,429,500,502,503,504]) assert.equal(importOutcome(code, {}, 1).state, 'reconciliation');
  for (const code of [400,401,403,409,422]) assert.equal(importOutcome(code, {}, 1).state, 'rejected');
});
test('retry delay respects bounded retry-after and growing capped backoff', () => {
  assert.equal(retryAfterMs({ headers: { get: () => '120' } }), 120000);
  assert.equal(retryAfterMs({ headers: { get: () => '999999999' } }), 300000);
  assert.equal(retryAfterMs({ headers: { get: () => 'invalid' } }), 0);
  assert.equal(scheduledDelay(1,0,() => 0), 5000); assert.equal(scheduledDelay(2,0,() => 0),10000);
  assert.equal(scheduledDelay(1,120000,() => 0),120000); assert.equal(scheduledDelay(99,0,() => 1),300000);
});
test('malformed or unbounded operator commands fail before storage', async () => {
  const pool = { connect() { throw new Error('Invalid commands must not connect'); } };
  for (const body of [{ action: 'POST', expectedVersion: 1, reason: 'Review' }, { action: 'reconcile', expectedVersion: 0, reason: 'Review' }, { action: 'close', expectedVersion: 1, reason: 'x'.repeat(501) }, { action: 'close', expectedVersion: 1, reason: 'Review', reportId: 'foreign' }])
    await assert.rejects(applyCommand(pool, {}, '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002', body), { code: 'DHIS2_COMMAND_INVALID' });
});
