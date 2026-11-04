'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { createVoiceSessionAuthority } = require('../../services/voice/voiceSessionAuthority');
const { createLiveVoiceBroker } = require('../../services/voice/liveVoiceBroker');
const { createSyntheticEvaluationPolicy } = require('../../services/voice/syntheticEvaluationPolicy');
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { resolve, promise }; };
const code = value => error => error.code === value;
function setup() {
  let at = 10000; const userId = crypto.randomUUID(), familyId = crypto.randomUUID();
  const actor = { id: userId, role: 'provider', voiceAuth: Object.freeze({ userId, familyId, credentialVersion: 2, expiresAt: at + 10000 }) };
  const snapshot = { observedAt: at, principal: { id: userId, active: true, accountStatus: 'active', role: 'provider', providerStatus: 'approved', mustChangePassword: false, credentialVersion: 2 }, family: { id: familyId, userId, active: true, expiresAt: at + 100000 } };
  const reads = [], factory = reader => createVoiceSessionAuthority({ now: () => at, readSessionSnapshot: reader || (async input => { reads.push(input); return snapshot; }) });
  return { actor, snapshot, reads, factory, authority: factory(), now: () => at, advance: ms => { at += ms; } };
}
test('session authority requires an explicit reader and fresh exact owner/family/version binding', async () => {
  assert.throws(() => createVoiceSessionAuthority(), code('VOICE_SESSION_POLICY_UNCONFIGURED'));
  const f = setup(); await f.authority(f.actor); assert.deepEqual(f.reads, [{ userId: f.actor.id, familyId: f.actor.voiceAuth.familyId }]);
  await f.authority(f.actor); assert.equal(f.reads.length, 2);
});
test('missing or invalid family, credential version, token expiry and owner are rejected before reading', async () => {
  for (const change of [{ familyId: null }, { familyId: 'not-a-uuid' }, { credentialVersion: null }, { credentialVersion: -1 }, { expiresAt: null }, { expiresAt: Infinity }, { expiresAt: 10000 }, { userId: crypto.randomUUID() }]) {
    const f = setup(); await assert.rejects(f.authority({ ...f.actor, voiceAuth: { ...f.actor.voiceAuth, ...change } }), code('VOICE_SESSION_AUTHORITY_REQUIRED')); assert.equal(f.reads.length, 0);
  }
});
test('current principal deactivation, role removal, provider approval, password and credential epoch all revoke', async () => {
  for (const change of [{ active: false }, { role: 'patient' }, { role: 'admin' }, { providerStatus: 'pending' }, { mustChangePassword: true }, { mustChangePassword: undefined }, { credentialVersion: 3 }, { id: crypto.randomUUID() }]) {
    const f = setup(); Object.assign(f.snapshot.principal, change); await assert.rejects(f.authority(f.actor), code('VOICE_SESSION_REVOKED'));
  }
});
test('revoked, expired or cross-owner current family is rejected', async () => {
  for (const change of [{ active: false }, { expiresAt: 9999 }, { userId: crypto.randomUUID() }, { id: crypto.randomUUID() }]) {
    const f = setup(); Object.assign(f.snapshot.family, change); await assert.rejects(f.authority(f.actor), code('VOICE_SESSION_REVOKED'));
  }
});
test('stale, future and malformed observations cannot supply current authority', async () => {
  for (const observedAt of [8999, 10001, null, '10000']) { const f = setup(); f.snapshot.observedAt = observedAt; await assert.rejects(f.authority(f.actor), code('VOICE_SESSION_REVOKED')); }
});
test('reader errors and a stalled reader fail closed with bounded sanitized failure', async () => {
  const f = setup(); await assert.rejects(f.factory(async () => { throw new Error('private-db-detail'); })(f.actor), error => error.code === 'VOICE_SESSION_AUTHORITY_UNAVAILABLE' && !error.message.includes('private-db-detail'));
  const start = Date.now(); await assert.rejects(f.factory(() => new Promise(() => {}))(f.actor), code('VOICE_SESSION_AUTHORITY_UNAVAILABLE')); assert.ok(Date.now() - start < 3000);
});
test('token expiry during reader wait is checked again after it returns', async () => {
  const f = setup(), read = deferred(), pending = f.factory(() => read.promise)(f.actor); f.advance(10000); f.snapshot.observedAt = f.now(); read.resolve(f.snapshot);
  await assert.rejects(pending, code('VOICE_SESSION_REVOKED'));
});
test('caller mutation during a read cannot replace the expected family or credential version', async () => {
  const f = setup(), read = deferred(), actor = { ...f.actor, voiceAuth: { ...f.actor.voiceAuth } }, pending = f.factory(() => read.promise)(actor);
  actor.voiceAuth.familyId = crypto.randomUUID(); actor.voiceAuth.credentialVersion = 3;
  f.snapshot.family.id = actor.voiceAuth.familyId; f.snapshot.principal.credentialVersion = 3; read.resolve(f.snapshot);
  await assert.rejects(pending, code('VOICE_SESSION_REVOKED'));
});
function brokerFixture(f, extra = {}) {
  const calls = [], input = { language: 'ha', consentVersion: 'voice-live-synthetic-v1' };
  const approve = async ({ actor, language }) => ({ actorId: actor.id, language, consentVersion: input.consentVersion, consentActive: true, providerApproved: true, dataClass: 'synthetic', observedAt: f.now(), validUntil: f.now() + 180000 });
  const broker = createLiveVoiceBroker({ env: { NODE_ENV: 'test', DOCTARX_VOICE_LIVE_PROTOTYPE_ENABLED: 'true' }, now: f.now, assertSession: f.authority, authorize: approve,
    provider: { async connect() { calls.push('connect'); return { providerSessionId: 'fictional', sdp: 'v=0\r\nanswer', sideband: { close() {} } }; }, async terminate() { calls.push('terminate'); } }, ...extra });
  return { broker, input, calls, approve };
}
test('a provider and approval policy alone cannot enable a broker without session authority', async () => {
  const f = setup(), b = brokerFixture(f, { assertSession: undefined }); assert.equal(b.broker.capabilities().enabled, false);
  await assert.rejects(b.broker.reserve(f.actor, b.input), code('VOICE_LIVE_DISABLED')); assert.deepEqual(b.calls, []);
});
test('session revocation while approval is pending is rechecked before any provider call', async () => {
  const f = setup(); let waiting = false; const approval = deferred();
  const b = brokerFixture(f, { authorize: async request => { if (waiting) await approval.promise; return b.approve(request); } });
  const permit = await b.broker.reserve(f.actor, b.input); waiting = true;
  const connecting = b.broker.connect(f.actor, permit.permitId, { sdp: 'v=0\r\noffer' }); await new Promise(resolve => setImmediate(resolve));
  f.snapshot.family.active = false; approval.resolve(); await assert.rejects(connecting, code('VOICE_SESSION_REVOKED')); assert.deepEqual(b.calls, []); await b.broker.close();
});
test('stop during a pending authority read cannot create a provider afterward', async () => {
  const f = setup(); let waiting = false; const read = deferred();
  const b = brokerFixture(f, { assertSession: async actor => { if (waiting) await read.promise; await f.authority(actor); } });
  const permit = await b.broker.reserve(f.actor, b.input); waiting = true;
  const connecting = b.broker.connect(f.actor, permit.permitId, { sdp: 'v=0\r\noffer' }); await new Promise(resolve => setImmediate(resolve));
  const stopped = await b.broker.stop(f.actor, permit.permitId); assert.equal(stopped.providerCleanupConfirmed, false);
  read.resolve(); await assert.rejects(connecting, code('VOICE_SESSION_UNAVAILABLE')); assert.deepEqual(b.calls, []);
  assert.equal((await b.broker.stop(f.actor, permit.permitId)).providerCleanupConfirmed, true); await b.broker.close();
});
test('current-session denial terminates an existing provider rather than only rejecting the lease', async () => {
  const f = setup(), b = brokerFixture(f); const permit = await b.broker.reserve(f.actor, b.input);
  await b.broker.connect(f.actor, permit.permitId, { sdp: 'v=0\r\noffer' }); f.snapshot.principal.credentialVersion++;
  await assert.rejects(b.broker.lease(f.actor, permit.permitId), code('VOICE_SESSION_REVOKED')); assert.deepEqual(b.calls, ['connect', 'terminate']); await b.broker.close();
});
test('newer same-family token cannot expand the original permit expiry', async () => {
  const f = setup(), b = brokerFixture(f); const permit = await b.broker.reserve(f.actor, b.input);
  const newer = { ...f.actor, voiceAuth: { ...f.actor.voiceAuth, expiresAt: f.now() + 999999 } };
  assert.equal((await b.broker.lease(newer, permit.permitId)).expiresAt, f.actor.voiceAuth.expiresAt); await b.broker.close();
});

test('revocation during provider creation closes the resulting connection before returning an answer', async () => {
  const f = setup(), created = deferred(), calls = [];
  const b = brokerFixture(f, { provider: { connect: () => { calls.push('connect'); return created.promise; }, terminate: async () => { calls.push('terminate'); } } });
  const permit = await b.broker.reserve(f.actor, b.input);
  const connecting = b.broker.connect(f.actor, permit.permitId, { sdp: 'v=0\r\noffer' }); await new Promise(resolve => setImmediate(resolve));
  f.snapshot.family.active = false; created.resolve({ providerSessionId: 'fictional', sdp: 'v=0\r\nanswer', sideband: { close() {} } });
  await assert.rejects(connecting, code('VOICE_SESSION_REVOKED')); assert.deepEqual(calls, ['connect', 'terminate']);
  assert.equal((await b.broker.stop(f.actor, permit.permitId)).providerFinalUsageConfirmed, false); await b.broker.close();
});


for (const phase of ['reserve', 'connect']) test(`approval expiry during the final session read blocks ${phase} without provider creation`, async () => {
  const f = setup(); let expireDuringRead = phase === 'reserve', sessionReads = 0, approvalExpiry = phase === 'reserve' ? f.now() + 100 : f.now() + 50000;
  const binding = { provider: 'openai', accountRef: 'fictional-account', projectRef: 'fictional-project', model: 'gpt-live-1', region: 'fictional-region', termsVersion: 'terms1', retentionVersion: 'retention1' };
  const authorize = createSyntheticEvaluationPolicy({ evaluationId: 'fictional-eval', providerBinding: binding, now: f.now,
    readApprovalSnapshot: async ({ evaluationId, language }) => {
      const record = { ...binding, evaluationId, status: 'approved', revokedAt: null, revision: 'r1', purpose: 'synthetic_voice_evaluation', dataClass: 'synthetic', validFrom: 0, expiresAt: approvalExpiry };
      return { observedAt: f.now(), principal: { id: f.actor.id, active: true, role: 'provider' },
        evaluatorGrant: { ...record, actorId: f.actor.id, languages: [language] },
        consent: { ...record, actorId: f.actor.id, language, version: 'voice-live-synthetic-v1', audioScope: 'fictional_tester_audio' },
        processorApproval: { ...record, languages: [language] }, budgetApproval: { ...record, approvalId: 'fictional-budget', currency: 'USD', limitMinor: 100 } };
    } });
  const assertSession = async actor => { sessionReads++; if (expireDuringRead && sessionReads === 2) f.advance(200); f.snapshot.observedAt = f.now(); await f.authority(actor); };
  const b = brokerFixture(f, { authorize, assertSession });
  if (phase === 'reserve') await assert.rejects(b.broker.reserve(f.actor, b.input), code('VOICE_EVALUATION_APPROVAL_EXPIRED'));
  else {
    const permit = await b.broker.reserve(f.actor, b.input); sessionReads = 0; expireDuringRead = true; approvalExpiry = f.now() + 100;
    await assert.rejects(b.broker.connect(f.actor, permit.permitId, { sdp: 'v=0\r\noffer' }), code('VOICE_EVALUATION_APPROVAL_EXPIRED'));
  }
  assert.deepEqual(b.calls, []); await b.broker.close();
});

test('approval expiry caps the permit and a later shorter approval reschedules its deadline', async () => {
  const f = setup(); let validUntil = f.now() + 5000;
  const b = brokerFixture(f, { authorize: async request => ({ ...await b.approve(request), validUntil }) });
  const permit = await b.broker.reserve(f.actor, b.input); assert.equal(permit.expiresAt, validUntil);
  validUntil = f.now() + 2000; assert.equal((await b.broker.lease(f.actor, permit.permitId)).expiresAt, validUntil);
  await b.broker.close();
});
