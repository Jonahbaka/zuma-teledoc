'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), crypto = require('node:crypto');
const { EventEmitter } = require('node:events');
const { createGeminiPcmGateway } = require('../../services/voice/geminiPcmGateway');
const { createGeminiLiveEvaluationTransport, MODEL } = require('../../services/voice/geminiLiveEvaluationTransport');
const { createGeminiEvaluationPolicy } = require('../../services/voice/geminiEvaluationPolicy');
const { createVoiceSessionAuthority } = require('../../services/voice/voiceSessionAuthority');
const { createPostgresVoiceSessionReader, SNAPSHOT_SQL } = require('../../services/voice/postgresVoiceSessionReader');
const flush = async () => { for (let i = 0; i < 5; i++) await new Promise(resolve => setImmediate(resolve)); };
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { resolve, promise }; };
function fixture(extra = {}) {
  let at = 10000, timerId = 0, callbacks; const timers = new Map(), sdkInput = [], incidents = []; let creates = 0, closes = 0;
  const userId = crypto.randomUUID(), familyId = crypto.randomUUID();
  const actor = { id: userId, role: 'provider', voiceAuth: { userId, familyId, credentialVersion: 2, expiresAt: 190000 } };
  const principal = { id: userId, role: 'provider', is_active: true, account_status: 'active', provider_status: 'approved', must_change_password: false, credential_version: 2 };
  const family = { active: true };
  const binding = { provider: 'google', model: MODEL, accountRef: 'fictional-account', projectRef: 'fictional-project', region: 'fictional-region', termsVersion: 'fictional-nonclinical-v1', retentionVersion: 'fictional-retention-v1' };
  const record = { ...binding, evaluationId: 'fictional-evaluation', purpose: 'synthetic_voice_evaluation', dataClass: 'synthetic', status: 'approved', revision: 'fictional-r1', validFrom: 0, expiresAt: 190000 };
  const approvals = { evaluatorGrant: { ...record, actorId: userId, languages: ['ha', 'ig', 'yo'] },
    consent: { ...record, actorId: userId, language: 'ig', version: 'voice-live-synthetic-v1', audioScope: 'fictional_tester_audio' },
    processorApproval: { ...record, languages: ['ha', 'ig', 'yo'] }, budgetApproval: { ...record, approvalId: 'fictional-budget', currency: 'USD', limitMinor: 1 } };
  const time = { now: () => at, setTimer(fn, ms) { const id = ++timerId; timers.set(id, { fn, at: at + ms }); return id; }, clearTimer(id) { timers.delete(id); } };
  const read = createPostgresVoiceSessionReader({ now: time.now, pool: { async query(config) {
    assert.equal(config.text, SNAPSHOT_SQL); assert.deepEqual(config.values, [userId, familyId]);
    if (extra.snapshotWait) await extra.snapshotWait.promise;
    return { rows: [{ ...principal, family_id: family.active ? familyId : null, family_user_id: family.active ? userId : null, family_expires_at_ms: family.active ? '200000' : null, observed_at_ms: String(at) }] };
  } } });
  const authority = createVoiceSessionAuthority({ readSessionSnapshot: read, now: time.now });
  const policy = createGeminiEvaluationPolicy({ evaluationId: 'fictional-evaluation', providerBinding: binding, now: time.now,
    async readApprovalSnapshot({ language }) { if (extra.policyWait) await extra.policyWait.promise; return { observedAt: at, principal: { id: userId, active: true, role: principal.role }, ...approvals, consent: { ...approvals.consent, language } }; } });
  const transport = createGeminiLiveEvaluationTransport({ ...time, async connectLive(config) {
    creates++; callbacks = config.callbacks; if (extra.connectWait) await extra.connectWait.promise;
    queueMicrotask(() => callbacks.onmessage({ setupComplete: {} }));
    return { sendRealtimeInput: value => sdkInput.push(value), close() { closes++; if (!extra.noCloseAck) queueMicrotask(() => callbacks.onclose()); } };
  } });
  class Peer extends EventEmitter {
    constructor() { super(); this.readyState = 1; this.bufferedAmount = 0; this.sent = []; }
    send(value, cb) { this.sent.push(JSON.parse(value)); this.deliver?.(JSON.parse(value)); cb?.(); }
    close() { if (this.readyState === 3) return; this.readyState = 3; this.emit('close'); this.disconnected?.(); }
  }
  const peer = new Peer();
  const gateway = createGeminiPcmGateway({ ...time, env: { NODE_ENV: 'test', DOCTARX_VOICE_GEMINI_PCM_ENABLED: 'true' }, expectedOrigin: 'https://fictional.example',
    async admitPeer() { if (extra.admitWait) await extra.admitWait.promise; return { actor, origin: 'https://fictional.example', upgradeVerified: true, ...extra.admission }; },
    assertSession: authority, authorize: policy, provider: transport, onIncident: item => incidents.push(item), ...extra.gateway });
  let sequence = 0;
  return { gateway, peer, actor, principal, family, approvals, binding, authority, policy, sdkInput, incidents, now: time.now,
    creates: () => creates, closes: () => closes, event: value => callbacks.onmessage(value),
    attach: () => gateway.attach({ request: { syntheticTestDouble: true }, peer, language: 'ig', consentVersion: 'voice-live-synthetic-v1' }),
    send: (type, data) => peer.emit('message', JSON.stringify({ type, sequence: ++sequence, ...(data === undefined ? {} : { data }) }), false),
    async advance(ms) { at += ms; for (const [id, timer] of [...timers]) if (timer.at <= at && timers.has(id)) { timers.delete(id); await timer.fn(); } await flush(); },
    setTime: value => { at = value; }, transport };
}
test('default and production composition cannot admit a PCM peer', () => {
  assert.equal(createGeminiPcmGateway().capabilities().enabled, false);
  const f = fixture({ gateway: { env: { NODE_ENV: 'production', DOCTARX_VOICE_GEMINI_PCM_ENABLED: 'true' } } });
  assert.throws(() => f.attach(), { code: 'PCM_GATEWAY_DISABLED' }); assert.equal(f.creates(), 0);
});
test('trusted upgrade/origin and current account are required before provider creation', async () => {
  for (const admission of [{ origin: 'https://other.invalid' }, { upgradeVerified: false }, { actor: null }]) {
    const f = fixture({ admission }), handle = f.attach(); await assert.rejects(handle.ready); assert.equal(f.creates(), 0); assert.equal(f.peer.readyState, 3); await f.gateway.close();
  }
  const f = fixture(); f.principal.account_status = 'suspended'; await assert.rejects(f.attach().ready); assert.equal(f.creates(), 0); await f.gateway.close();
});
test('real policy/session reader seams authorize bounded fictional PCM and a single fixed greeting', async () => {
  const f = fixture(), handle = f.attach(), ready = await handle.ready;
  assert.equal(ready.provider, 'google'); assert.equal(ready.model, MODEL); assert.equal(ready.expiresAt, 190000);
  f.send('audio.pcm', Buffer.alloc(3200).toString('base64')); f.send('greeting');
  assert.equal(f.sdkInput.length, 2); assert.equal(f.sdkInput[0].audio.mimeType, 'audio/pcm;rate=16000');
  const stopped = await handle.stop(); assert.equal(stopped.providerCleanupConfirmed, true); assert.equal(stopped.providerFinalUsageConfirmed, false);
  assert.deepEqual(await f.gateway.stop({ id: f.actor.id, role: 'patient' }, handle.sessionId), stopped);
  await assert.rejects(f.gateway.stop({ id: crypto.randomUUID() }, handle.sessionId)); await f.gateway.close();
});
test('peer input cannot submit text, tools, video, identity or approval claims', async () => {
  for (const frame of [{ type: 'text', data: 'not permitted' }, { type: 'audio.pcm', data: 'bad' }, { type: 'greeting', actorId: 'other' }, { type: 'greeting', approved: true }]) {
    const f = fixture(), h = f.attach(); await h.ready; f.peer.emit('message', JSON.stringify({ sequence: 1, ...frame }), false); await flush();
    assert.equal(f.sdkInput.length, 0); assert.equal(f.peer.readyState, 3); assert.equal(f.closes(), 1); await f.gateway.close();
  }
});
test('input rate, replay, binary and output backlog violations close the session', async () => {
  for (const action of ['rate', 'replay', 'binary', 'backlog']) {
    const f = fixture(), h = f.attach(); await h.ready;
    if (action === 'rate') for (let i = 0; i < 17; i++) f.send('audio.pcm', Buffer.alloc(3200).toString('base64'));
    if (action === 'replay') { f.send('capture.end'); f.peer.emit('message', JSON.stringify({ type: 'capture.end', sequence: 1 }), false); }
    if (action === 'binary') f.peer.emit('message', Buffer.alloc(3200), true);
    if (action === 'backlog') { f.peer.bufferedAmount = 131072; f.event({ serverContent: { modelTurn: { parts: [{ inlineData: { mimeType: 'audio/pcm;rate=24000', data: Buffer.alloc(480).toString('base64') } }] } } }); }
    await flush(); assert.equal(f.peer.readyState, 3); assert.equal(f.closes(), 1); await f.gateway.close();
  }
});
test('family, credential, account and consent revocation terminate active fake providers independently', async () => {
  for (const kind of ['family', 'credential', 'account', 'consent']) {
    const f = fixture(), h = f.attach(); await h.ready;
    if (kind === 'family') f.family.active = false;
    if (kind === 'credential') f.principal.credential_version++;
    if (kind === 'account') f.principal.account_status = 'suspended';
    if (kind === 'consent') f.approvals.consent.status = 'revoked';
    await f.advance(4000); assert.equal(f.peer.readyState, 3); assert.equal(f.closes(), 1); await f.gateway.close();
  }
});
test('stop during admission or policy wait cannot later start a provider', async () => {
  for (const key of ['admitWait', 'policyWait']) {
    const wait = deferred(), f = fixture({ [key]: wait }), h = f.attach(); await flush(); await h.stop(); wait.resolve();
    await assert.rejects(h.ready); assert.equal(f.creates(), 0); await f.gateway.close();
  }
});
test('stop during provider creation retains pending cleanup and closes the late handle', async () => {
  const wait = deferred(), f = fixture({ connectWait: wait }), h = f.attach(); await flush();
  const stopping = h.stop(); await flush(); await f.advance(3500); const first = await stopping;
  assert.equal(first.providerCleanupConfirmed, false); assert.equal(first.providerCreationPending, true);
  wait.resolve(); await assert.rejects(h.ready); await flush(); assert.equal(f.closes(), 1);
  const result = await f.gateway.stop(f.actor, h.sessionId); assert.equal(result.providerCleanupConfirmed, true); await f.gateway.close();
});
test('unknown synchronous provider-create outcome is retained and never retried', async () => {
  let creates = 0; const f = fixture({ gateway: { provider: { open() { creates++; throw new Error('unknown'); } } } }), h = f.attach();
  await assert.rejects(h.ready); const stopped = await f.gateway.stop(f.actor, h.sessionId);
  assert.equal(stopped.providerOutcomeUncertain, true); assert.equal(stopped.providerCleanupConfirmed, false); assert.equal(creates, 1); await f.gateway.close();
});
test('old OpenAI approval records cannot authorize Gemini transport', async () => {
  const f = fixture(); for (const record of Object.values(f.approvals)) record.provider = 'openai';
  await assert.rejects(f.attach().ready); assert.equal(f.creates(), 0); await f.gateway.close();
});
module.exports = { fixture, flush };

test('actual worklet and graph cross the gateway into fake SDK PCM, play output and cancel on interruption/revocation', async () => {
  const fs = require('node:fs'), vm = require('node:vm');
  const { createVoicePcmAudioGraph } = require('../../../lib/voice/pcmAudioGraph.cjs');
  const f = fixture(), h = f.attach(), permit = await h.ready, playback = [];
  let Processor, graph; const track = { kind: 'audio', enabled: true, readyState: 'live', stop() { this.readyState = 'ended'; }, addEventListener() {}, removeEventListener() {} };
  const node = { connect() {}, disconnect() {}, port: { onmessage: null, postMessage(data) { processor.port.onmessage({ data }); } } };
  class Base { constructor() { this.port = { postMessage(data) { node.port.onmessage?.({ data }); }, onmessage: null }; } }
  vm.runInNewContext(fs.readFileSync(require.resolve('../../../public/voice/pcm-capture-worklet.js'), 'utf8'), {
    AudioWorkletProcessor: Base, sampleRate: 16000, ArrayBuffer, Int16Array, DataView,
    registerProcessor(_name, type) { Processor = type; },
  });
  const processor = new Processor();
  function context({ sampleRate }) {
    return { sampleRate, state: 'suspended', currentTime: 0, destination: {}, audioWorklet: { async addModule() {} },
      async resume() { this.state = 'running'; }, async close() { this.state = 'closed'; },
      createMediaStreamSource() { return { connect() {}, disconnect() {} }; },
      createBuffer(_channels, size) { const data = new Float32Array(size); return { getChannelData: () => data }; },
      createBufferSource() { const source = { stops: 0, connect() {}, disconnect() {}, start() {}, stop() { this.stops++; } }; playback.push(source); return source; } };
  }
  graph = createVoicePcmAudioGraph({ stream: { getAudioTracks: () => [track], getTracks: () => [track] },
    createContext: context, createWorkletNode: () => node, onInputPcm: bytes => f.send('audio.pcm', Buffer.from(bytes).toString('base64')),
    expiresAt: permit.expiresAt, now: f.now, onState(state) { if (state.phase === 'closed') f.peer.close(); } });
  f.peer.disconnected = () => void graph.stop();
  f.peer.deliver = event => {
    if (event.type === 'audio.pcm') graph.enqueuePcm(new Uint8Array(Buffer.from(event.data, 'base64')), event.playbackEpoch);
    if (event.type === 'playback.clear') graph.clearPlayback(event.playbackEpoch);
  };
  await graph.start(); assert.equal(track.enabled, false); graph.setCaptureEnabled(true);
  processor.process([[new Float32Array(1600).fill(0.1)]], [[new Float32Array(1600)]]);
  assert.equal(f.sdkInput.length, 1); assert.equal(Buffer.from(f.sdkInput[0].audio.data, 'base64').readInt16LE(0), 3277);
  assert.equal(processor.outstanding.size, 0); // Real ACK traversed graph back to worklet.
  f.event({ serverContent: { modelTurn: { parts: [{ inlineData: { mimeType: 'audio/pcm;rate=24000', data: Buffer.alloc(480).toString('base64') } }] } } });
  assert.equal(playback.length, 1); f.event({ serverContent: { interrupted: true } }); assert.equal(playback[0].stops, 1);
  graph.setCaptureEnabled(false); processor.process([[new Float32Array(1600)]], []); assert.equal(f.sdkInput.length, 1);
  f.family.active = false; await f.advance(4000); assert.equal(track.readyState, 'ended'); assert.equal(f.closes(), 1);
  f.event({ serverContent: { modelTurn: { parts: [{ inlineData: { mimeType: 'audio/pcm;rate=24000', data: Buffer.alloc(480).toString('base64') } }] } } });
  assert.equal(playback.length, 1); await graph.stop(); await f.gateway.close();
});

test('approval expiry during the final session read cannot start a provider', async () => {
  let reads = 0, f;
  f = fixture({ gateway: { async assertSession(actor) { await f.authority(actor); if (++reads === 2) f.setTime(10200); } } });
  for (const record of Object.values(f.approvals)) record.expiresAt = 10100;
  await assert.rejects(f.attach().ready, { code: 'PCM_APPROVAL_REQUIRED' }); assert.equal(f.creates(), 0); await f.gateway.close();
});
test('revocation while provider readiness is pending closes the created transport before admission', async () => {
  const wait = deferred(), f = fixture({ connectWait: wait }), h = f.attach(); await flush(); f.principal.account_status = 'revoked'; wait.resolve();
  await assert.rejects(h.ready); assert.equal(f.creates(), 1); assert.equal(f.closes(), 1); assert.equal(f.peer.sent.length, 0); await f.gateway.close();
});
test('the original verified token deadline ends an active peer without waiting for renewal', async () => {
  const f = fixture(); f.actor.voiceAuth.expiresAt = 11000; const h = f.attach(); assert.equal((await h.ready).expiresAt, 11000);
  await f.advance(1000); assert.equal(f.peer.readyState, 3); assert.equal(f.closes(), 1); await f.gateway.close();
});
test('a peer cannot be attached twice or revive after closure', async () => {
  const f = fixture(), h = f.attach(); assert.throws(() => f.attach(), { code: 'PCM_PEER_ALREADY_USED' }); await h.ready; await h.stop();
  assert.throws(() => f.attach(), { code: 'PCM_PEER_ALREADY_USED' }); assert.equal(f.creates(), 1); await f.gateway.close();
});
test('Gemini consent and evaluator grants cannot follow newly changed processing scope', async () => {
  for (const key of ['accountRef', 'projectRef', 'region', 'termsVersion', 'retentionVersion']) {
    const f = fixture(), binding = { ...f.binding, [key]: 'changed-scope' };
    f.approvals.processorApproval[key] = binding[key]; f.approvals.budgetApproval[key] = binding[key];
    const policy = createGeminiEvaluationPolicy({ evaluationId: 'fictional-evaluation', providerBinding: binding, now: f.now,
      readApprovalSnapshot: async () => ({ observedAt: f.now(), principal: { id: f.actor.id, role: 'provider', active: true }, ...f.approvals }) });
    await assert.rejects(policy({ actor: f.actor, language: 'ig', context: { consentVersion: 'voice-live-synthetic-v1' } }));
    await f.gateway.close();
  }
  for (const patch of [{ provider: 'openai' }, { model: 'not-approved' }]) {
    const f = fixture(); assert.throws(() => createGeminiEvaluationPolicy({ evaluationId: 'fictional-evaluation', providerBinding: { ...f.binding, ...patch }, readApprovalSnapshot: async () => ({}) })); await f.gateway.close();
  }
});

test('invalid configured origins and malformed provider readiness fail closed', async () => {
  for (const origin of ['https://user:pass@fictional.example', 'https://fictional.example/path', 'https://fictional.example#fragment', 'http://fictional.example']) {
    const f = fixture({ gateway: { expectedOrigin: origin } }); assert.throws(() => f.attach(), { code: 'PCM_GATEWAY_DISABLED' }); assert.equal(f.creates(), 0); await f.gateway.close();
  }
  let stops = 0;
  const f = fixture({ gateway: { provider: { open: () => ({ ready: {}, sendPcm() {}, sendGreeting() {}, endAudio() {}, async stop() { stops++; return { transportClosedConfirmed: false }; } }) } } });
  const h = f.attach(); await assert.rejects(h.ready, { code: 'PCM_PROVIDER_HANDLE_INVALID' }); assert.equal(stops, 1);
  assert.equal((await f.gateway.stop(f.actor, h.sessionId)).providerOutcomeUncertain, true); await f.gateway.close();
});

test('peer errors during close and after terminal cleanup cannot escape as unhandled errors', async () => {
  const f = fixture(), h = f.attach(); await h.ready;
  const originalClose = f.peer.close.bind(f.peer);
  f.peer.close = () => { f.peer.emit('error', new Error('fictional closing error')); originalClose(); };
  await h.stop(); assert.equal(f.peer.listenerCount('error'), 1);
  assert.doesNotThrow(() => f.peer.emit('error', new Error('fictional late close error')));
  await h.stop(); assert.equal(f.peer.listenerCount('error'), 1);
  assert.equal(f.peer.listenerCount('message'), 0); assert.equal(f.peer.listenerCount('close'), 0); await f.gateway.close();
});
