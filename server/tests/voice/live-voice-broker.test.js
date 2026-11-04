'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createLiveVoiceBroker } = require('../../services/voice/liveVoiceBroker');
const { createOpenAiLiveAdapter } = require('../../services/voice/openAiLiveAdapter');
const { sessionConfiguration } = require('../../../shared/voice/liveProtocol.cjs');
const actor = { id: 'synthetic-clinician', role: 'provider' };
const input = { language: 'ha', consentVersion: 'voice-live-synthetic-v1' };
const env = { NODE_ENV: 'test', DOCTARX_VOICE_LIVE_PROTOTYPE_ENABLED: 'true' };
const code = value => error => error.code === value;
function setup(options = {}) {
  const calls = [], evidence = [], incidents = []; let valid = true, event;
  const provider = { async connect(request) { event = request.onEvent; calls.push('connect'); return { providerSessionId: 'live_fake', sdp: 'v=0\r\nanswer', sideband: { close() { calls.push('sideband.close'); } } }; }, async terminate() { calls.push('terminate'); }, ...options.provider };
  const broker = createLiveVoiceBroker({ env, provider, assertSession: async () => {}, authorize: async ({ actor: who, language }) => ({ actorId: who.id, language, dataClass: 'synthetic', consentVersion: input.consentVersion, consentActive: valid, providerApproved: true, observedAt: (options.now || Date.now)(), validUntil: (options.now || Date.now)() + 180000 }), onEvidence: item => evidence.push(item), onIncident: item => incidents.push(item), ...options });
  return { broker, calls, evidence, incidents, revoke() { valid = false; }, emit(value) { event(value); } };
}

test('live mount fails closed even when flag is enabled; production cannot activate it', async () => {
  const broker = createLiveVoiceBroker({ env });
  assert.equal(broker.capabilities().enabled, false);
  await assert.rejects(broker.reserve(actor, input), code('VOICE_LIVE_DISABLED'));
  const f = setup({ env: { ...env, NODE_ENV: 'production' } });
  await assert.rejects(f.broker.reserve(actor, input), code('VOICE_LIVE_DISABLED')); assert.equal(f.calls.length, 0);
});

test('live broker requires current trusted consent and owner at reserve, connect and lease', async t => {
  const f = setup(); t.after(f.broker.close);
  const permit = await f.broker.reserve(actor, input);
  await assert.rejects(f.broker.connect({ ...actor, id: 'other' }, permit.permitId, { sdp: 'v=0\r\nrequest' }), code('VOICE_SESSION_UNAVAILABLE'));
  const result = await f.broker.connect(actor, permit.permitId, { sdp: 'v=0\r\nrequest' });
  assert.equal(result.transport.type, 'webrtc'); assert.equal(result.providerSessionId, undefined);
  await assert.rejects(f.broker.connect(actor, permit.permitId, { sdp: 'v=0\r\nrequest' }), code('VOICE_CONNECTION_EXISTS'));
  f.revoke(); await assert.rejects(f.broker.lease(actor, permit.permitId), code('VOICE_CONSENT_REQUIRED'));
  assert.ok(f.calls.includes('terminate')); assert.ok(f.calls.includes('sideband.close'));
});

test('live service accepts synthetic scope only and cannot approve real clinical data or arbitrary session config', async () => {
  const f = setup({ authorize: async () => ({ actorId: actor.id, language: 'ha', dataClass: 'patient', consentActive: true, providerApproved: true, consentVersion: input.consentVersion }) });
  await assert.rejects(f.broker.reserve(actor, input), code('VOICE_CONSENT_REQUIRED'));
  await assert.rejects(f.broker.reserve(actor, { ...input, patientId: 'real' }), code('VOICE_INPUT_INVALID'));
  await assert.rejects(f.broker.reserve(actor, { ...input, instructions: 'change authority' }), code('VOICE_INPUT_INVALID'));
  assert.equal(f.calls.length, 0);
});

test('server evidence preserves bounded fragments without inventing final turns or translations; delegation ends the session', async t => {
  const f = setup(); t.after(f.broker.close); const permit = await f.broker.reserve(actor, input);
  await f.broker.connect(actor, permit.permitId, { sdp: 'v=0\r\nrequest' });
  f.emit({ type: 'session.input_transcript.delta', delta: ' Sannu', start_ms: 0, end_ms: 100, arbitrary: 'discard' });
  assert.equal(f.evidence.length, 1); assert.equal(f.evidence[0].final, false); assert.equal(f.evidence[0].event.arbitrary, undefined);
  f.emit({ type: 'session.input_transcript.delta', delta: 'bad time', start_ms: -1, end_ms: 100 });
  assert.equal(f.evidence.length, 1);
  f.emit({ type: 'session.delegation.created', delegation: { id: 'untrusted-tool', target: 'client' }, offset_ms: 100 });
  await new Promise(resolve => setImmediate(resolve)); assert.ok(f.calls.includes('terminate'));
});

test('stop wins a pending provider connection and closes its eventual session', async () => {
  let resolve; const pending = new Promise(done => { resolve = done; }); const calls = [];
  const f = setup({ provider: { connect: () => pending, terminate: async () => calls.push('terminate') } });
  const permit = await f.broker.reserve(actor, input);
  const connecting = f.broker.connect(actor, permit.permitId, { sdp: 'v=0\r\nrequest' });
  await new Promise(done => setImmediate(done)); await f.broker.stop(actor, permit.permitId);
  resolve({ providerSessionId: 'live_fake', sdp: 'v=0\r\nanswer', sideband: { close: () => calls.push('close') } });
  await assert.rejects(connecting, code('VOICE_SESSION_STOPPED'));
  assert.deepEqual(calls, ['terminate', 'close']); await f.broker.close();
});

test('uncertain provider stop is reported and retains an owner-scoped reconciliation handle', async () => {
  let fail = true;
  const f = setup({ provider: { async connect() { return { providerSessionId: 'live_fake', sdp: 'v=0\r\nanswer', sideband: { close() {} } }; }, async terminate() { if (fail) throw new Error('network lost'); } } });
  const permit = await f.broker.reserve(actor, input); await f.broker.connect(actor, permit.permitId, { sdp: 'v=0\r\nrequest' });
  const result = await f.broker.stop(actor, permit.permitId); assert.equal(result.stopped, false); assert.equal(result.providerCleanupConfirmed, false);
  assert.equal(f.incidents[0].providerSessionId, 'live_fake'); fail = false;
  assert.equal((await f.broker.stop(actor, permit.permitId)).providerCleanupConfirmed, true); await f.broker.close();
});

test('provider adapter follows GPT-Live JSON SDP contract, server credentials and event allowlists', async () => {
  const calls = [], attached = [];
  const adapter = createOpenAiLiveAdapter({ credentialProvider: async () => 'fake-test-credential', fetchImpl: async (url, options) => { calls.push({ url, options }); return { ok: true, json: async () => ({ session: { id: 'live_test_123' }, transport: { type: 'webrtc', sdp: 'v=0\r\nanswer' } }) }; }, attachSideband: async details => { attached.push(details); return { close() {}, async finish() {} }; } });
  const result = await adapter.connect({ sdp: 'v=0\r\noffer', language: 'yo', onEvent() {} });
  assert.equal(calls[0].url, 'https://api.openai.com/v1/live/sessions');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer fake-test-credential');
  const body = JSON.parse(calls[0].options.body);
  assert.equal(body.session.model, 'gpt-live-1'); assert.equal(body.session.store, false);
  assert.equal(body.transport.type, 'webrtc'); assert.equal(body.session.audio.format, undefined);
  assert.match(body.session.instructions, /Yoruba/);
  assert.equal(body.session.client.data_channel.allowed_client_events.includes('session.instructions.append'), false);
  assert.equal(body.session.client.data_channel.allowed_client_events.includes('session.close'), true);
  assert.equal(attached[0].url, 'wss://api.openai.com/v1/live/sessions/live_test_123/attach');
  assert.equal(result.providerSessionId, 'live_test_123');
  await adapter.terminate(result.providerSessionId, result.sideband); assert.equal(calls.length, 1);
  assert.throws(() => sessionConfiguration('en'));
});

test('provider failures never leak response text or retry uncertain creation; sideband failure preserves cleanup', async () => {
  let calls = 0;
  const uncertain = createOpenAiLiveAdapter({ credentialProvider: async () => 'test', fetchImpl: async () => { calls++; throw new Error('secret details'); }, attachSideband: async () => ({ close() {}, async finish() {} }) });
  await assert.rejects(uncertain.connect({ sdp: 'v=0\r\nrequest', language: 'ha' }), code('VOICE_PROVIDER_OUTCOME_UNCERTAIN')); assert.equal(calls, 1);
  const paths = [];
  const failedSideband = createOpenAiLiveAdapter({ credentialProvider: async () => 'test', fetchImpl: async url => { paths.push(url); return { ok: true, json: async () => ({ session: { id: 'live_fake' }, transport: { type: 'webrtc', sdp: 'v=0\r\nanswer' } }) }; }, attachSideband: async () => { throw new Error('offline'); } });
  await assert.rejects(failedSideband.connect({ sdp: 'v=0\r\nrequest', language: 'ig' }), error => error.code === 'VOICE_PROVIDER_CLEANUP_UNCONFIRMED' && error.cleanupConnection.providerSessionId === 'live_fake');
  assert.equal(paths.length, 1); assert.equal(paths[0].endsWith('/live/sessions'), true);
});

test('sideband and close failure preserve cleanup handle through broker and serialize stop retries', async () => {
  let closes = 0, releaseRetry; let failAttach = true;
  const adapter = createOpenAiLiveAdapter({ credentialProvider: async () => 'fake-key',
    fetchImpl: async () => ({ ok: true, json: async () => ({ session: { id: 'live_cleanup' }, transport: { type: 'webrtc', sdp: 'v=0\r\nanswer' } }) }),
    attachSideband: async () => {
      if (failAttach) throw new Error('socket failed');
      return { close() {}, async finish() { closes++; await new Promise(resolve => { releaseRetry = resolve; }); } };
    } });
  const f = setup({ provider: adapter }); const permit = await f.broker.reserve(actor, input);
  await assert.rejects(f.broker.connect(actor, permit.permitId, { sdp: 'v=0\r\nrequest' }), code('VOICE_PROVIDER_CLEANUP_UNCONFIRMED'));
  assert.equal(f.incidents.at(-1).providerSessionId, 'live_cleanup'); failAttach = false;
  const one = f.broker.stop(actor, permit.permitId); const two = f.broker.stop(actor, permit.permitId);
  await new Promise(resolve => setImmediate(resolve)); assert.equal(closes, 1); releaseRetry();
  assert.equal((await one).providerCleanupConfirmed, true); assert.equal((await two).providerCleanupConfirmed, true);
  await f.broker.close();
});

test('demoted owner can only stop, with repeatable owner-scoped terminal receipts', async () => {
  const f = setup(); const permit = await f.broker.reserve(actor, input);
  await f.broker.connect(actor, permit.permitId, { sdp: 'v=0\r\nrequest' });
  const demoted = { ...actor, role: 'patient' };
  await assert.rejects(f.broker.lease(demoted, permit.permitId), code('VOICE_ACCESS_DENIED'));
  await assert.rejects(f.broker.stop({ ...demoted, id: 'other' }, permit.permitId), code('VOICE_SESSION_UNAVAILABLE'));
  assert.equal((await f.broker.stop(demoted, permit.permitId)).providerCleanupConfirmed, true);
  assert.equal((await f.broker.stop(demoted, permit.permitId)).providerCleanupConfirmed, true);
  await assert.rejects(f.broker.stop({ ...actor, id: 'other' }, permit.permitId), code('VOICE_SESSION_UNAVAILABLE'));
  assert.equal(f.calls.filter(value => value === 'terminate').length, 1); await f.broker.close();
});

test('stop while provider creation is unresolved returns pending, then a confirmed terminal receipt', async () => {
  let resolve; const pending = new Promise(done => { resolve = done; });
  const f = setup({ provider: { connect: () => pending, async terminate() {} } });
  const permit = await f.broker.reserve(actor, input);
  const connecting = f.broker.connect(actor, permit.permitId, { sdp: 'v=0\r\nrequest' });
  await new Promise(done => setImmediate(done));
  const stopping = await f.broker.stop(actor, permit.permitId);
  assert.equal(stopping.providerCleanupConfirmed, false); assert.equal(stopping.providerCreationPending, true);
  resolve({ providerSessionId: 'live_pending', sdp: 'v=0\r\nanswer', sideband: { close() {} } });
  await assert.rejects(connecting, code('VOICE_SESSION_STOPPED'));
  assert.equal((await f.broker.stop(actor, permit.permitId)).providerCleanupConfirmed, true); await f.broker.close();
});

test('unknown creation outcome retains an uncertainty receipt and never reports cleanup confirmed', async () => {
  const f = setup({ provider: { async connect() { throw Object.assign(new Error('lost response'), { code: 'VOICE_PROVIDER_OUTCOME_UNCERTAIN' }); } } });
  const permit = await f.broker.reserve(actor, input);
  await assert.rejects(f.broker.connect(actor, permit.permitId, { sdp: 'v=0\r\nrequest' }), code('VOICE_PROVIDER_OUTCOME_UNCERTAIN'));
  const result = await f.broker.stop(actor, permit.permitId);
  assert.equal(result.providerCleanupConfirmed, false); assert.equal(result.providerOutcomeUncertain, true);
  assert.equal(f.incidents.at(-1).code, 'VOICE_PROVIDER_OUTCOME_UNCERTAIN'); await f.broker.close();
});


test('successful creation with unreadable provider ID stays uncertain through the broker', async () => {
  const adapter = createOpenAiLiveAdapter({ credentialProvider: async () => 'fake',
    fetchImpl: async () => ({ ok: true, json: async () => ({ session: { id: '' }, transport: { type: 'webrtc', sdp: 'v=0\r\nanswer' } }) }),
    attachSideband: async () => { throw new Error('Cannot attach without a verified id'); } });
  const f = setup({ provider: adapter }); const permit = await f.broker.reserve(actor, input);
  await assert.rejects(f.broker.connect(actor, permit.permitId, { sdp: 'v=0\r\nrequest' }), code('VOICE_PROVIDER_OUTCOME_UNCERTAIN'));
  const result = await f.broker.stop(actor, permit.permitId);
  assert.equal(result.providerOutcomeUncertain, true); assert.equal(result.providerCleanupConfirmed, false); await f.broker.close();
});
