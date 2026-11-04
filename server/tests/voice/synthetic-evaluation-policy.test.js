'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createSyntheticEvaluationPolicy } = require('../../services/voice/syntheticEvaluationPolicy');
const { createLiveVoiceBroker } = require('../../services/voice/liveVoiceBroker');
const actor = { id: 'fictional-evaluator', role: 'provider' };
const context = { consentVersion: 'voice-live-synthetic-v1' };
const providerBinding = { provider: 'openai', accountRef: 'test-account', projectRef: 'test-project', model: 'gpt-live-1', region: 'test-region', termsVersion: 'test-terms-v1', retentionVersion: 'test-retention-v1' };
const code = value => error => error.code === value;
function fixture() {
  let at = 100000; const calls = [];
  const record = { status: 'approved', revokedAt: null, revision: 'r1', validFrom: 1, expiresAt: 200000,
    evaluationId: 'fictional-evaluation', purpose: 'synthetic_voice_evaluation', dataClass: 'synthetic', ...providerBinding };
  const snapshot = { observedAt: at, principal: { id: actor.id, role: 'provider', active: true },
    evaluatorGrant: { ...record, actorId: actor.id, languages: ['ha', 'ig', 'yo'] },
    consent: { ...record, actorId: actor.id, language: 'ha', version: context.consentVersion, audioScope: 'fictional_tester_audio' },
    processorApproval: { ...record, ...providerBinding, languages: ['ha', 'ig', 'yo'] },
    budgetApproval: { ...record, ...providerBinding, approvalId: 'fictional-budget', currency: 'USD', limitMinor: 100 },
  };
  const config = { evaluationId: 'fictional-evaluation', providerBinding: { ...providerBinding }, now: () => at,
    async readApprovalSnapshot(query) { calls.push(query); return structuredClone(snapshot); } };
  const authorize = createSyntheticEvaluationPolicy(config);
  return { snapshot, config, calls, authorize, advance: ms => { at += ms; }, request: extra => authorize({ actor, language: 'ha', context, ...extra }) };
}

test('policy approves only a current matching synthetic evaluation and exposes no raw approval records', async () => {
  const f = fixture(); const result = await f.request();
  assert.equal(result.providerApproved, true); assert.equal(result.consentActive, true);
  assert.equal(result.budgetApproved, true); assert.equal(result.budgetEnforced, false); assert.equal(result.audioContentVerifiedSynthetic, false);
  assert.deepEqual(result.providerBinding, providerBinding); assert.deepEqual(f.calls, [{ actorId: actor.id, evaluationId: 'fictional-evaluation', language: 'ha' }]);
  assert.equal(result.budgetApproval, undefined); assert.equal(result.principal, undefined); assert.equal(result.limitMinor, undefined);
  f.config.providerBinding.accountRef = 'changed'; assert.equal((await f.request()).providerBinding.accountRef, 'test-account');
  result.providerBinding.accountRef = 'changed'; assert.equal((await f.request()).providerBinding.accountRef, 'test-account');
});

for (const key of Object.keys(providerBinding)) test(`policy rejects a mismatched configured ${key} before provider access`, async () => {
  for (const record of ['evaluatorGrant', 'consent', 'processorApproval', 'budgetApproval']) {
    const f = fixture(); f.snapshot[record][key] = 'mismatch';
    await assert.rejects(f.request(), code('VOICE_EVALUATION_APPROVAL_REQUIRED'));
  }
});

test('new processing approvals cannot reuse consent or evaluator grant from the previous binding', async () => {
  for (const key of Object.keys(providerBinding)) {
    const f = fixture(); const changedBinding = { ...providerBinding, [key]: 'changed-scope' };
    Object.assign(f.snapshot.processorApproval, changedBinding); Object.assign(f.snapshot.budgetApproval, changedBinding);
    if (['provider', 'model'].includes(key)) {
      assert.throws(() => createSyntheticEvaluationPolicy({ ...f.config, providerBinding: changedBinding }), code('VOICE_EVALUATION_POLICY_INVALID'));
    } else {
      const authorize = createSyntheticEvaluationPolicy({ ...f.config, providerBinding: changedBinding });
      await assert.rejects(authorize({ actor, language: 'ha', context }), code('VOICE_EVALUATION_APPROVAL_REQUIRED'));
      Object.assign(f.snapshot.evaluatorGrant, changedBinding);
      await assert.rejects(authorize({ actor, language: 'ha', context }), code('VOICE_EVALUATION_APPROVAL_REQUIRED'));
      Object.assign(f.snapshot.consent, changedBinding);
      assert.equal((await authorize({ actor, language: 'ha', context })).providerApproved, true);
    }
  }
});

for (const record of ['evaluatorGrant', 'consent', 'processorApproval', 'budgetApproval']) test(`${record} revocation, expiry and scope are re-read, not cached`, async () => {
  for (const patch of [{ status: 'pending' }, { revokedAt: 90000 }, { expiresAt: 100000 }, { validFrom: 100001 }, { dataClass: 'patient' }, { purpose: 'clinical_intake' }, { evaluationId: 'another-evaluation' }, { revision: '' }]) {
    const f = fixture(); await f.request(); Object.assign(f.snapshot[record], patch);
    await assert.rejects(f.request(), code('VOICE_EVALUATION_APPROVAL_REQUIRED')); assert.equal(f.calls.length, 2);
  }
});

test('current principal, language-specific consent and evaluator eligibility cannot be supplied by the client', async () => {
  for (const mutate of [
    s => { s.principal.role = 'patient'; }, s => { s.principal.active = false; }, s => { s.principal.id = 'other'; },
    s => { s.evaluatorGrant.actorId = 'other'; }, s => { s.evaluatorGrant.languages = ['yo']; },
    s => { s.consent.actorId = 'other'; }, s => { s.consent.language = 'ig'; }, s => { s.consent.version = 'old'; }, s => { s.consent.audioScope = 'patient_audio'; },
    s => { s.processorApproval.languages = ['yo']; }, s => { s.budgetApproval.limitMinor = 0; },
  ]) { const f = fixture(); mutate(f.snapshot); await assert.rejects(f.request(), code('VOICE_EVALUATION_APPROVAL_REQUIRED')); }
  const f = fixture();
  await assert.rejects(f.request({ context: { ...context, providerApproved: true } }), code('VOICE_EVALUATION_APPROVAL_REQUIRED'));
  await assert.rejects(f.request({ actor: { ...actor, role: 'patient' } }), code('VOICE_EVALUATION_APPROVAL_REQUIRED'));
  await assert.rejects(f.request({ language: 'en' }), code('VOICE_EVALUATION_APPROVAL_REQUIRED')); assert.equal(f.calls.length, 0);
});

test('stale, future, failed or missing authoritative snapshots fail closed with sanitized errors', async () => {
  const f = fixture(); f.advance(1001); await assert.rejects(f.request(), code('VOICE_EVALUATION_APPROVAL_REQUIRED'));
  f.snapshot.observedAt = 200000; await assert.rejects(f.request(), code('VOICE_EVALUATION_APPROVAL_REQUIRED'));
  for (const reader of [async () => null, async () => { throw new Error('private database connection string'); }]) {
    const authorize = createSyntheticEvaluationPolicy({ ...fixture().config, readApprovalSnapshot: reader });
    await assert.rejects(authorize({ actor, language: 'ha', context }), error => /^VOICE_EVALUATION_/.test(error.code) && !error.message.includes('private'));
  }
});

test('each supported language needs its own current tester consent', async () => {
  for (const language of ['ha', 'ig', 'yo']) {
    const f = fixture(); f.snapshot.consent.language = language;
    assert.equal((await f.request({ language })).language, language);
    const other = language === 'ha' ? 'yo' : 'ha';
    await assert.rejects(f.request({ language: other }), code('VOICE_EVALUATION_APPROVAL_REQUIRED'));
  }
});

test('an unresponsive approval reader fails closed without cached approval or retries', async () => {
  const f = fixture(); let calls = 0;
  const authorize = createSyntheticEvaluationPolicy({ ...f.config, readApprovalSnapshot: () => { calls++; return new Promise(() => {}); } });
  await assert.rejects(authorize({ actor, language: 'ha', context }), code('VOICE_EVALUATION_POLICY_UNAVAILABLE'));
  assert.equal(calls, 1);
});

test('record expiry while a read is pending is checked after the read completes', async () => {
  const f = fixture(); let release;
  const authorize = createSyntheticEvaluationPolicy({ ...f.config, readApprovalSnapshot: () => new Promise(resolve => { release = resolve; }) });
  const pending = authorize({ actor, language: 'ha', context });
  f.advance(100000); f.snapshot.observedAt = 200000; release(f.snapshot);
  await assert.rejects(pending, code('VOICE_EVALUATION_APPROVAL_REQUIRED'));
});

test('broker revalidates trusted records at reserve, connect and lease; revocation closes only the fake provider', async t => {
  const f = fixture(), calls = [];
  const broker = createLiveVoiceBroker({ env: { NODE_ENV: 'test', DOCTARX_VOICE_LIVE_PROTOTYPE_ENABLED: 'true' }, assertSession: async () => {}, authorize: f.authorize, now: f.config.now,
    provider: { async connect() { calls.push('connect'); return { providerSessionId: 'test_session', sdp: 'v=0\r\nfake', sideband: { close() {} } }; }, async terminate() { calls.push('close'); } } });
  t.after(broker.close);
  const permit = await broker.reserve(actor, { language: 'ha', ...context });
  await broker.connect(actor, permit.permitId, { sdp: 'v=0\r\nfake' });
  assert.equal(f.calls.length, 3); f.snapshot.principal.role = 'patient';
  await assert.rejects(broker.lease(actor, permit.permitId), code('VOICE_EVALUATION_APPROVAL_REQUIRED'));
  assert.deepEqual(calls, ['connect', 'close']);
  assert.equal((await broker.stop({ ...actor, role: 'patient' }, permit.permitId)).providerCleanupConfirmed, true);
});

test('policy has no approval writer, secrets, environment activation or production mount', () => {
  assert.throws(() => createSyntheticEvaluationPolicy(), code('VOICE_EVALUATION_POLICY_INVALID'));
  const route = fs.readFileSync(path.join(__dirname, '../../routes/voiceLive.js'), 'utf8');
  assert.equal(route.includes('syntheticEvaluationPolicy'), false);
  const source = fs.readFileSync(path.join(__dirname, '../../services/voice/syntheticEvaluationPolicy.js'), 'utf8');
  for (const forbidden of ['process.env', 'credentialProvider', 'fetch(', 'writeFile', 'apiKey', 'INSERT INTO', 'UPDATE ']) assert.equal(source.includes(forbidden), false);
});
