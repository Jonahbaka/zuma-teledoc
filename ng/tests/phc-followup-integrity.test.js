'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
process.env.ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const { createFollowUp } = require('../services/phc/phcWorkflowService');
const context = { programme_id: 'programme-a', facility_id: 'facility-a', userId: 'clinician-a', programmeRole: 'remote_clinician' };
const input = { patientUserId: 'patient-a', encounterId: 'encounter-a', referralId: 'referral-a', taskType: 'review', title: 'Synthetic review', instructions: 'Synthetic follow-up instruction', priority: 'routine', assignedRole: 'remote_clinician', assignedUserId: 'clinician-a', dueAt: '2026-11-03T10:00:00Z', idempotencyKey: 'request-a' };
function existing(overrides = {}) {
  return { id: 'task-a', facility_id: context.facility_id, patient_user_id: input.patientUserId, encounter_id: input.encounterId, referral_id: input.referralId, task_type: input.taskType, title: input.title, instructions: input.instructions, priority: input.priority, assigned_role: input.assignedRole, assigned_user_id: input.assignedUserId, due_at: new Date(input.dueAt), created_by: context.userId, status: 'open', ...overrides };
}
function fakePool(options = {}) {
  const calls = [];
  let lookups = 0;
  const client = { released: false, async query(sql, params = []) {
    calls.push({ sql, params });
    if (/^(BEGIN|COMMIT|ROLLBACK)$/.test(sql)) return { rows: [] };
    if (sql.includes('FROM ng_programme_patient_enrollments')) return { rows: [{ id: 'enrollment-a' }] };
    if (sql.includes('FROM ng_clinical_encounters')) {
      assert.deepEqual(params, [input.encounterId, context.programme_id, context.facility_id, input.patientUserId]);
      assert.match(sql, /patient_user_id=\$4/);
      return { rows: options.badEncounter ? [] : [{ id: input.encounterId }] };
    }
    if (sql.includes('FROM ng_referrals')) {
      assert.deepEqual(params, [input.referralId, context.programme_id, context.facility_id, input.patientUserId]);
      assert.match(sql, /patient_user_id=\$4/);
      return { rows: options.badReferral ? [] : [{ id: input.referralId, encounter_id: options.referralEncounter || input.encounterId }] };
    }
    if (sql.includes('FROM ng_programme_memberships')) {
      assert.deepEqual(params, [input.assignedUserId, context.programme_id, context.facility_id, input.assignedRole]);
      assert.match(sql, /m.status='active'/);
      assert.match(sql, /m.expires_at>NOW\(\)/);
      return { rows: options.badAssignee ? [] : [{ id: 'membership-a' }] };
    }
    if (sql.includes('SELECT * FROM ng_follow_up_tasks')) {
      lookups++;
      return { rows: options.replay ? [options.replay] : (options.race && lookups > 1 ? [options.race] : []) };
    }
    if (sql.includes('INSERT INTO ng_follow_up_tasks')) {
      assert.match(sql, /ON CONFLICT \(programme_id, idempotency_key\) DO NOTHING/);
      assert.notEqual(params[6], input.title);
      assert.notEqual(params[9], input.instructions);
      if (options.race) return { rows: [] };
      return { rows: [existing({ title: null, title_encrypted: params[6], title_iv: params[7], title_tag: params[8], instructions: null, instructions_encrypted: params[9], instructions_iv: params[10], instructions_tag: params[11] })] };
    }
    if (sql.includes('SELECT metadata_json FROM ng_programme_audit_events')) return { rows: [{ metadata_json: options.provenance || {} }] };
    if (sql.includes('INSERT INTO ng_programme_audit_events')) return { rows: [] };
    throw new Error(`Unexpected SQL ${sql}`);
  }, release() { this.released = true; } };
  return { calls, client, connect: async () => client };
}
async function rejected(options, code) {
  const pool = fakePool(options);
  await assert.rejects(createFollowUp(pool, {}, context, input), { code });
  assert.ok(pool.calls.some(call => call.sql === 'ROLLBACK'));
  assert.equal(pool.calls.some(call => call.sql.includes('INSERT INTO ng_follow_up_tasks')), false);
  assert.equal(pool.client.released, true);
}
test('follow-up creation preserves encrypted storage, audit, and open task status', async () => {
  const pool = fakePool();
  const result = await createFollowUp(pool, {}, context, input);
  assert.equal(result.title, input.title);
  assert.equal(result.instructions, input.instructions);
  assert.equal(result.status, 'open');
  assert.equal(result.title_encrypted, undefined);
  assert.ok(pool.calls.some(call => call.sql.includes('INSERT INTO ng_programme_audit_events')));
  assert.equal(pool.calls.at(-1).sql, 'COMMIT');
});
test('cross-patient/facility encounter and referral references are rejected before writes', async () => {
  await rejected({ badEncounter: true }, 'FOLLOW_UP_ENCOUNTER_MISMATCH');
  await rejected({ badReferral: true }, 'FOLLOW_UP_REFERRAL_MISMATCH');
  await rejected({ referralEncounter: 'encounter-b' }, 'FOLLOW_UP_REFERRAL_MISMATCH');
});
test('inactive or out-of-scope assignee is rejected', async () => {
  await rejected({ badAssignee: true }, 'FOLLOW_UP_ASSIGNEE_INVALID');
});
test('identical idempotent replay returns task without duplicate insert or audit', async () => {
  const pool = fakePool({ replay: existing() });
  const result = await createFollowUp(pool, {}, context, input);
  assert.equal(result.id, 'task-a');
  assert.equal(pool.calls.some(call => call.sql.includes('INSERT')), false);
});
test('reused request key cannot leak different patient/facility task or silently accept changed content', async () => {
  for (const change of [{ patient_user_id: 'patient-b' }, { facility_id: 'facility-b' }, { title: 'Different' }, { encounter_id: 'encounter-b' }, { instructions: 'Changed' }, { due_at: null }, { created_by: 'clinician-b' }]) {
    await rejected({ replay: existing(change) }, 'FOLLOW_UP_IDEMPOTENCY_CONFLICT');
  }
});
test('concurrent winner path returns only equivalent task and rejects conflicting winner', async () => {
  const identical = fakePool({ race: existing() });
  assert.equal((await createFollowUp(identical, {}, context, input)).id, 'task-a');
  assert.equal(identical.calls.some(call => call.sql.includes('INSERT INTO ng_programme_audit_events')), false);
  const conflict = fakePool({ race: existing({ title: 'Different task' }) });
  await assert.rejects(createFollowUp(conflict, {}, context, input), { code: 'FOLLOW_UP_IDEMPOTENCY_CONFLICT' });
  assert.equal(conflict.calls.at(-1).sql, 'ROLLBACK');
});
test('manual unlinked and unassigned follow-up remains available', async () => {
  const pool = fakePool();
  await createFollowUp(pool, {}, context, { ...input, encounterId: null, referralId: null, assignedRole: null, assignedUserId: null });
  assert.equal(pool.calls.some(call => call.sql.includes('FROM ng_clinical_encounters') || call.sql.includes('FROM ng_referrals') || call.sql.includes('FROM ng_programme_memberships')), false);
});
test('invalid due date is rejected without a transaction', async () => {
  const pool = fakePool();
  await assert.rejects(createFollowUp(pool, {}, context, { ...input, dueAt: 'not-a-date' }), { code: 'FOLLOW_UP_DUE_DATE_INVALID' });
  assert.equal(pool.calls.length, 0);
});

test('AI provenance requires a complete nonnegative source pair', async () => {
  for (const source of [{ sourceSuggestionId: 'draft-a' }, { sourceDraftIndex: 0 }, { sourceSuggestionId: 'draft-a', sourceDraftIndex: -1 }]) {
    const pool = fakePool();
    await assert.rejects(createFollowUp(pool, {}, context, { ...input, ...source }), { code: 'FOLLOW_UP_SOURCE_INVALID' });
    assert.equal(pool.calls.length, 0);
  }
});
test('AI follow-up validates the accepted source before linkage locks and records provenance', async () => {
  const ai = require('../services/phc/clinicalAiService');
  const original = ai.assertAcceptedFollowUpSource;
  let checked = false;
  ai.assertAcceptedFollowUpSource = async (client, passedContext, args) => {
    checked = true;
    assert.equal(passedContext, context);
    assert.deepEqual(args, { suggestionId: 'draft-a', draftIndex: 0, patientUserId: input.patientUserId, encounterId: input.encounterId, title: input.title, instructions: input.instructions });
  };
  try {
    const pool = fakePool();
    await createFollowUp(pool, {}, context, { ...input, sourceSuggestionId: 'draft-a', sourceDraftIndex: 0, idempotencyKey: require('uuid').v5('clinical-ai-follow-up:draft-a:0', require('uuid').v5.URL) });
    assert.equal(checked, true);
    const audit = pool.calls.find(call => call.sql.includes('INSERT INTO ng_programme_audit_events'));
    assert.deepEqual(JSON.parse(audit.params[9]), { sourceSuggestionId: 'draft-a', sourceDraftIndex: 0 });
  } finally { if (original) ai.assertAcceptedFollowUpSource = original; else delete ai.assertAcceptedFollowUpSource; }
});
test('manual replay cannot strip an AI task provenance link', async () => {
  const pool = fakePool({ replay: existing(), provenance: { sourceSuggestionId: 'draft-a', sourceDraftIndex: 0 } });
  await assert.rejects(createFollowUp(pool, {}, context, input), { code: 'FOLLOW_UP_IDEMPOTENCY_CONFLICT' });
});

test('changing request key cannot duplicate an accepted AI follow-up proposal', async () => {
  const pool = fakePool();
  await assert.rejects(createFollowUp(pool, {}, context, { ...input, sourceSuggestionId: 'draft-a', sourceDraftIndex: 0, idempotencyKey: 'another-request' }), { code: 'FOLLOW_UP_SOURCE_KEY_INVALID' });
  assert.equal(pool.calls.length, 0);
});

test('AI follow-ups require explicit due date and a responsible authorized role or user', async () => {
  const sourced = { ...input, sourceSuggestionId: 'draft-a', sourceDraftIndex: 0, idempotencyKey: require('uuid').v5('clinical-ai-follow-up:draft-a:0', require('uuid').v5.URL) };
  for (const dueAt of [null, undefined, '', 'not-a-date']) {
    const pool = fakePool();
    await assert.rejects(createFollowUp(pool, {}, context, { ...sourced, dueAt }), { code: 'FOLLOW_UP_DUE_DATE_REQUIRED' });
    assert.equal(pool.calls.length, 0);
  }
  for (const assignedRole of [null, '', 'government_analyst', 'admin']) {
    const pool = fakePool();
    await assert.rejects(createFollowUp(pool, {}, context, { ...sourced, assignedUserId: null, assignedRole }), { code: 'FOLLOW_UP_ASSIGNEE_REQUIRED' });
    assert.equal(pool.calls.length, 0);
  }
});
test('manual follow-ups may still omit a due date and assignee', async () => {
  const pool = fakePool();
  await assert.doesNotReject(createFollowUp(pool, {}, context, { ...input, dueAt: null, assignedRole: null, assignedUserId: null }));
});
