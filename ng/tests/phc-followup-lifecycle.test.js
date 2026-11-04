'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
process.env.ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const { transitionFollowUp, formatFollowUp, canActOnFollowUp } = require('../services/phc/phcWorkflowService');
const context = { programme_id: 'programme-a', facility_id: 'facility-a', userId: 'nurse-a', programmeRole: 'phc_nurse', membershipId: 'membership-a' };
const base = { id: 'task-a', patient_user_id: 'patient-a', title: 'Synthetic task', instructions: 'Synthetic instructions', status: 'open', record_version: 1, assigned_user_id: 'nurse-a', assigned_role: 'phc_nurse', created_by: 'doctor-a', closure_evidence_json: {} };
const input = { taskId: base.id, toStatus: 'completed', expectedVersion: 1, outcome: 'Synthetic human-confirmed documentation completed.' };
function fixture(overrides = {}, options = {}) {
  const calls = [];
  const row = { ...base, ...overrides };
  const client = { async query(sql, params = []) {
    calls.push({ sql, params });
    if (/^(BEGIN|COMMIT|ROLLBACK)$/.test(sql)) return { rows: [] };
    if (sql.includes('FROM users')) { assert.match(sql, /FOR SHARE/); return { rows: options.revokedAccount ? [] : [{ id: context.userId, is_test_account: true }] }; }
    if (sql.includes('FROM public_health_programmes')) { assert.match(sql, /FOR SHARE OF p,pf/); return { rows: options.inactiveProgramme ? [] : [{ demo_only: true }] }; }
    if (sql.includes('FROM ng_programme_memberships')) {
      assert.match(sql, /clock_timestamp/);
      return { rows: options.revokedMembership || (options.expiredWhileWaiting && !sql.includes('FOR SHARE')) ? [] : [{ id: context.membershipId }] };
    }
    if (sql.includes('SELECT * FROM ng_follow_up_tasks')) {
      assert.match(sql, /programme_id=\$2 AND facility_id=\$3 FOR UPDATE/);
      assert.deepEqual(params, [base.id, context.programme_id, context.facility_id]);
      return { rows: options.missing ? [] : [row] };
    }
    if (sql.includes('FROM ng_programme_patient_enrollments')) {
      assert.match(sql, /status='active' AND consent_status='granted' FOR SHARE/);
      assert.deepEqual(params, [context.programme_id, context.facility_id, base.patient_user_id]);
      return { rows: options.noConsent ? [] : [{ id: 'enrollment' }] };
    }
    if (sql.startsWith('UPDATE ng_follow_up_tasks')) {
      assert.match(sql, /record_version=record_version\+1/);
      assert.match(sql, /WHERE id=\$1 AND record_version=\$5/);
      if (options.updateLost) return { rows: [] };
      return { rows: [{ ...row, status: params[1], completed_by: params[1] === 'completed' ? params[2] : null,
        completed_at: params[1] === 'completed' ? new Date() : null, closure_evidence_json: JSON.parse(params[3]), record_version: row.record_version + 1 }] };
    }
    if (sql.includes('INSERT INTO ng_programme_audit_events')) {
      if (options.auditFailure) throw new Error('synthetic audit unavailable');
      return { rows: [] };
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  }, release() { client.released = true; } };
  return { calls, client, connect: async () => client };
}
test('completion encrypts outcome, records actor/version and audit contains no narrative', async () => {
  const pool = fixture();
  const task = await transitionFollowUp(pool, {}, context, input);
  assert.equal(task.status, 'completed'); assert.equal(task.completed_by, context.userId);
  assert.ok(task.completed_at); assert.equal(task.record_version, 2);
  assert.equal(task.closure_outcome, input.outcome); assert.equal(task.closure_evidence_json, undefined);
  assert.deepEqual(task.allowed_transitions, []);
  const update = pool.calls.find(c => c.sql.startsWith('UPDATE'));
  const evidence = JSON.parse(update.params[3]);
  assert.equal(evidence.version, 1); assert.ok(evidence.encrypted && evidence.iv && evidence.tag);
  assert.equal(update.params[3].includes(input.outcome), false);
  const audit = pool.calls.find(c => c.sql.includes('INSERT INTO ng_programme_audit_events'));
  assert.equal(JSON.stringify(audit.params).includes(input.outcome), false);
  assert.equal(pool.calls.at(-1).sql, 'COMMIT'); assert.equal(pool.client.released, true);
});
test('start and cancellation do not claim clinical completion', async () => {
  const start = await transitionFollowUp(fixture(), {}, context, { ...input, toStatus: 'in_progress', outcome: null });
  assert.equal(start.completed_at, null); assert.equal(start.completed_by, null); assert.equal(start.closure_outcome, null);
  assert.deepEqual(start.allowed_transitions, ['completed', 'cancelled']);
  const cancel = await transitionFollowUp(fixture({ status: 'in_progress' }), {}, context, { ...input, toStatus: 'cancelled' });
  assert.equal(cancel.completed_at, null); assert.equal(cancel.completed_by, null); assert.equal(cancel.closure_outcome, input.outcome);
});
test('assigned user takes priority over role; role-owned and creator-owned task controls are explicit', () => {
  assert.equal(canActOnFollowUp({ ...base, assigned_user_id: 'other' }, context), false);
  assert.equal(canActOnFollowUp({ ...base, assigned_user_id: null }, context), true);
  assert.equal(canActOnFollowUp({ ...base, assigned_user_id: null, assigned_role: 'remote_clinician' }, context), false);
  assert.equal(canActOnFollowUp({ ...base, assigned_user_id: null, assigned_role: null, created_by: context.userId }, context), true);
  assert.equal(canActOnFollowUp({ ...base, assigned_user_id: null, assigned_role: null }, context), false);
  assert.equal(canActOnFollowUp(base, { ...context, programmeRole: 'government_analyst' }), false);
  assert.deepEqual(formatFollowUp({ ...base, assigned_user_id: 'other' }, context).allowed_transitions, []);
});
test('not found, wrong assignee, stale version, terminal task, withdrawn consent all reject without update', async () => {
  for (const [overrides, options, code] of [
    [{}, { missing: true }, 'FOLLOW_UP_NOT_FOUND'],
    [{}, { revokedAccount: true }, 'FOLLOW_UP_AUTHORITY_REVOKED'],
    [{}, { inactiveProgramme: true }, 'FOLLOW_UP_AUTHORITY_REVOKED'],
    [{}, { revokedMembership: true }, 'FOLLOW_UP_AUTHORITY_REVOKED'],
    [{}, { expiredWhileWaiting: true }, 'FOLLOW_UP_AUTHORITY_REVOKED'],
    [{ assigned_user_id: 'other' }, {}, 'FOLLOW_UP_ASSIGNEE_REQUIRED'],
    [{ record_version: 2 }, {}, 'FOLLOW_UP_VERSION_CONFLICT'],
    [{ status: 'completed' }, {}, 'INVALID_FOLLOW_UP_TRANSITION'],
    [{ status: 'cancelled' }, {}, 'INVALID_FOLLOW_UP_TRANSITION'],
    [{ status: 'waived' }, {}, 'INVALID_FOLLOW_UP_TRANSITION'],
    [{}, { noConsent: true }, 'FOLLOW_UP_ENROLLMENT_REQUIRED'],
  ]) {
    const pool = fixture(overrides, options);
    await assert.rejects(transitionFollowUp(pool, {}, context, input), { code });
    assert.equal(pool.calls.some(c => c.sql.startsWith('UPDATE') || c.sql.includes('INSERT')), false);
    assert.equal(pool.calls.at(-1).sql, 'ROLLBACK'); assert.equal(pool.client.released, true);
  }
});
test('invalid request fails before acquiring a database connection', async () => {
  for (const change of [{ expectedVersion: 0 }, { expectedVersion: '1' }, { toStatus: 'waived' }, { outcome: '  ' }, { outcome: 'ab' }, { outcome: 'x'.repeat(5001) }, { outcome: {} }, { toStatus: 'in_progress', outcome: 'unexpected' }]) {
    const pool = fixture(); await assert.rejects(transitionFollowUp(pool, {}, context, { ...input, ...change })); assert.equal(pool.calls.length, 0);
  }
});
test('failed write and failed audit roll back instead of confirming a transition', async () => {
  for (const options of [{ updateLost: true }, { auditFailure: true }]) {
    const pool = fixture({}, options); await assert.rejects(transitionFollowUp(pool, {}, context, input));
    assert.equal(pool.calls.at(-1).sql, 'ROLLBACK'); assert.equal(pool.client.released, true);
  }
});
test('legacy closure JSON is not exposed as plaintext or accepted as protected outcome', () => {
  const result = formatFollowUp({ ...base, closure_evidence_json: { note: 'legacy sensitive value' } }, context);
  assert.equal(result.closure_outcome, null); assert.equal(result.closure_evidence_json, undefined);
});
test('malformed protected closure fails closed instead of displaying a missing outcome', () => {
  assert.throws(() => formatFollowUp({ ...base, closure_evidence_json: { version: 1, encrypted: 'broken' } }, context), { code: 'FOLLOW_UP_OUTCOME_UNREADABLE' });
});
