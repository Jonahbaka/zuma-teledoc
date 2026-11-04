'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  QUEUE_TRANSITIONS,
  REFERRAL_TRANSITIONS,
  createEncounter,
  hashNormalized,
  withTransaction,
} = require('../services/phc/phcWorkflowService');

function transactionalPool(results) {
  const calls = [];
  const client = {
    released: false,
    async query(sql, params) {
      const normalized = String(sql).trim();
      calls.push({ sql: normalized, params });
      if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(normalized)) return { rows: [] };
      const next = results.shift();
      if (next instanceof Error) throw next;
      return next || { rows: [] };
    },
    release() { this.released = true; },
  };
  return { calls, client, connect: async () => client };
}

const context = {
  programme_id: 'programme-1',
  facility_id: 'facility-1',
  programme_facility_id: 'programme-facility-1',
  userId: 'nurse-1',
  programmeRole: 'phc_nurse',
};

test('queue transition map makes terminal states immutable', () => {
  for (const status of ['completed', 'cancelled', 'no_show', 'left_without_being_seen']) {
    assert.equal(QUEUE_TRANSITIONS[status].size, 0);
  }
  assert.equal(QUEUE_TRANSITIONS.waiting.has('claimed'), true);
  assert.equal(QUEUE_TRANSITIONS.in_consultation.has('completed'), true);
  assert.equal(QUEUE_TRANSITIONS.draft.has('completed'), false);
});

test('referral lifecycle requires explicit acceptance and has immutable terminal states', () => {
  assert.deepEqual([...REFERRAL_TRANSITIONS.draft], ['sent', 'cancelled']);
  assert.equal(REFERRAL_TRANSITIONS.sent.has('accepted'), true);
  assert.equal(REFERRAL_TRANSITIONS.accepted.has('completed'), true);
  for (const status of ['completed', 'declined', 'cancelled']) {
    assert.equal(REFERRAL_TRANSITIONS[status].size, 0);
  }
});

test('normalized identity hash is stable without exposing its source', () => {
  const one = hashNormalized(' Patient@Example.com ');
  const two = hashNormalized('patient@example.com');
  assert.equal(one, two);
  assert.match(one, /^[a-f0-9]{64}$/);
  assert.doesNotMatch(one, /patient/i);
});

test('transaction helper rolls back and releases on failure', async () => {
  const pool = transactionalPool([]);
  await assert.rejects(
    withTransaction(pool, async () => { throw new Error('expected failure'); }),
    /expected failure/
  );
  assert.deepEqual(pool.calls.map((call) => call.sql), ['BEGIN', 'ROLLBACK']);
  assert.equal(pool.client.released, true);
});

test('encounter creation writes Nigeria and canonical records in one transaction', async () => {
  const pool = transactionalPool([
    { rows: [] },
    { rows: [{ id: 'enrollment-1', consent_status: 'granted' }] },
    { rows: [{ id: 'ng-encounter-1', patient_user_id: 'patient-1' }] },
    { rows: [{ id: 'core-encounter-1' }] },
    { rows: [] },
    { rows: [] },
  ]);

  const result = await createEncounter(pool, { ip: '127.0.0.1', headers: {} }, context, {
    patientUserId: 'patient-1',
    chiefComplaint: 'Synthetic test complaint',
    idempotencyKey: '00000000-0000-4000-8000-000000000001',
  });

  assert.equal(result.id, 'ng-encounter-1');
  assert.equal(result.canonical_id, 'core-encounter-1');
  assert.equal(pool.calls[0].sql, 'BEGIN');
  assert.match(pool.calls[3].sql, /INSERT INTO ng_clinical_encounters/);
  assert.match(pool.calls[4].sql, /INSERT INTO clinical_encounters/);
  assert.match(pool.calls[5].sql, /INSERT INTO ng_clinical_record_links/);
  assert.match(pool.calls[6].sql, /INSERT INTO ng_programme_audit_events/);
  assert.equal(pool.calls.at(-1).sql, 'COMMIT');
  assert.equal(pool.client.released, true);
});
