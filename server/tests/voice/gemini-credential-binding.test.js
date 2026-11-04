'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), { createHash } = require('node:crypto');
const { createGeminiCredentialBinding } = require('../../services/voice/geminiCredentialBinding');
const { createGeminiLiveEvaluationTransport, MODEL } = require('../../services/voice/geminiLiveEvaluationTransport');
const { deferred } = require('./helpers/pcmBrowser.cjs');
const flush = () => new Promise(resolve => setImmediate(resolve));
function fixture(extra = {}) {
  const binding = { provider: 'google', model: MODEL, accountRef: 'fictional-account', projectRef: 'fictional-project', region: 'fictional-region', termsVersion: 'fictional-terms', retentionVersion: 'fictional-retention' };
  const key = 'fictional-noncredential-fixture';
  const record = { ...binding, credentialRef: 'fictional-ref', status: 'verified', revision: 'r1', fingerprintSha256: createHash('sha256').update(key).digest('hex'), observedAt: 1000, validFrom: 0, expiresAt: 100000 };
  let reads = 0, keyReads = 0, creates = 0, connects = 0, closes = 0, active = true;
  const credential = createGeminiCredentialBinding({ providerBinding: binding, credentialRef: record.credentialRef, now: () => 1000,
    async readCredentialSnapshot(input) { reads++; assert.equal(input.credentialRef, record.credentialRef); if (extra.readWait) await extra.readWait.promise; return { ...record }; },
    async readCredential() { keyReads++; if (extra.keyWait) await extra.keyWait.promise; return extra.key || key; },
    createClient(input) { creates++; assert.equal(input.apiKey, key); if (extra.throwCreate) throw new Error(key); return { live: { async connect(config) { connects++; queueMicrotask(() => config.callbacks?.onmessage({ setupComplete: {} })); return { sendRealtimeInput() {}, close() { closes++; config.callbacks?.onclose(); } }; } } }; },
    ...extra.options });
  return { credential, record, key, binding, connect: config => credential.connectLive(config || { model: MODEL }, { isActive: () => active }), cancel: () => { active = false; }, stats: () => ({ reads, keyReads, creates, connects, closes }) };
}
test('approved enrollment must match actual fictional key fingerprint before creating injected SDK', async () => {
  const f = fixture(); await f.connect(); assert.deepEqual(f.stats(), { reads: 2, keyReads: 1, creates: 1, connects: 1, closes: 0 });
});
test('missing, revoked, stale, expired, cross-account and wrong-model enrollment denies before key read', async () => {
  for (const change of [{ status: 'pending' }, { revokedAt: 999 }, { observedAt: 1001 }, { observedAt: -100 }, { expiresAt: 1000 }, { accountRef: 'other-account' }, { model: 'other-model' }, { fingerprintSha256: 'invalid' }]) {
    const f = fixture(); Object.assign(f.record, change); await assert.rejects(f.connect(), { code: 'VOICE_CREDENTIAL_BINDING_REQUIRED' }); assert.equal(f.stats().keyReads, 0); assert.equal(f.stats().creates, 0);
  }
});
test('wrong credential fingerprint and wrong requested model never create SDK clients', async () => {
  const f = fixture({ key: 'different-fictional-value' }); await assert.rejects(f.connect()); assert.equal(f.stats().creates, 0);
  const other = fixture(); await assert.rejects(other.connect({ model: 'other' })); assert.equal(other.stats().reads, 0);
});
test('revocation and enrollment revision change while key read awaits prevent provider creation', async () => {
  for (const change of [{ revokedAt: 1000 }, { revision: 'r2' }]) {
    const wait = deferred(), f = fixture({ keyWait: wait }), connection = f.connect(); await flush(); Object.assign(f.record, change); wait.resolve();
    await assert.rejects(connection); assert.equal(f.stats().creates, 0);
  }
});
test('cancellation before or during enrollment/key reads prevents later SDK creation', async () => {
  for (const phase of ['before', 'enrollment', 'key']) {
    const wait = deferred(), f = fixture(phase === 'enrollment' ? { readWait: wait } : { keyWait: wait });
    if (phase === 'before') f.cancel(); const connection = f.connect(); const rejected = assert.rejects(connection); await flush(); f.cancel(); wait.resolve(); await rejected; assert.equal(f.stats().creates, 0);
  }
});
test('raw credential and SDK exception details never escape the public failure', async () => {
  const f = fixture({ throwCreate: true }); await assert.rejects(f.connect(), error => { assert.doesNotMatch(String(error), new RegExp(f.key)); assert.equal(error.code, 'VOICE_CREDENTIAL_BINDING_REQUIRED'); return true; });
});
test('credential metadata checks do not fetch or create a credential', async () => {
  const f = fixture(); const result = await f.credential.assertCurrentBinding(); assert.equal(result.revision, 'r1'); assert.equal(f.stats().keyReads, 0); assert.equal(f.stats().creates, 0);
  assert.equal(Object.values(result).includes(f.key), false);
});
test('unresolved timed-out metadata operations retain bounded work slots', { timeout: 3000 }, async () => {
  const wait = deferred(), f = fixture({ readWait: wait });
  const reads = Array.from({ length: 50 }, () => assert.rejects(f.credential.assertCurrentBinding()));
  await Promise.all([...reads, new Promise(resolve => setTimeout(resolve, 800))]);
  await assert.rejects(f.credential.assertCurrentBinding()); assert.equal(f.stats().reads, 50);
  wait.resolve(); await flush(); await f.credential.assertCurrentBinding(); assert.equal(f.stats().reads, 51);
});
test('real protocol transport cancels during credential setup without creating a late provider', async () => {
  const wait = deferred(), f = fixture({ keyWait: wait }), transport = createGeminiLiveEvaluationTransport({ connectLive: f.credential.connectLive });
  const handle = transport.open({ language: 'ha', onEvent() {} }); await flush(); const stopping = handle.stop(); wait.resolve(); await assert.rejects(handle.ready); await flush(); assert.equal(f.stats().connects, 0);
  // No SDK close callback exists because no SDK was created. The transport
  // accurately retains unconfirmed creation rather than inventing final usage.
  await Promise.all([stopping, new Promise(resolve => setTimeout(resolve, 3100))]);
});
