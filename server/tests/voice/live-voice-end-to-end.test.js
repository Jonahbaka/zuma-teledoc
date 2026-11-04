'use strict';
// Cross-layer synthetic evaluation: browser transport -> real loopback HTTP ->
// route -> broker -> actual provider adapter -> fake provider/socket. No real
// credentials, model, microphone, external HTTP or clinical database is used.
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { EventEmitter } = require('node:events');
const { createVoiceLiveRouter } = require('../../routes/voiceLive');
const { createLiveVoiceBroker } = require('../../services/voice/liveVoiceBroker');
const { createSyntheticEvaluationPolicy } = require('../../services/voice/syntheticEvaluationPolicy');
const { createOpenAiLiveAdapter } = require('../../services/voice/openAiLiveAdapter');
const { createOpenAiLiveSideband } = require('../../services/voice/openAiLiveSideband');
const { createLiveWebRtcSession } = require('../../../lib/voice/liveWebRtcSession.cjs');
class Events extends EventEmitter { addEventListener(name, fn) { this.on(name, fn); } removeEventListener(name, fn) { this.off(name, fn); } }
async function until(predicate) {
  const deadline = Date.now() + 3000;
  while (!predicate()) { if (Date.now() >= deadline) throw new Error('Synthetic state did not settle.'); await new Promise(resolve => setTimeout(resolve, 5)); }
}
async function fixture(t) {
  let role = 'provider', granted = true, processorApproved = true, peer, sidebandSocket, captures = 0;
  const providerRequests = [], evidence = [], captions = [], commands = [], states = [], errors = [], responses = [];
  const actorId = 'synthetic-reviewer';
  const attachSideband = createOpenAiLiveSideband({ createSocket(url, options) {
    assert.equal(url, 'wss://api.openai.com/v1/live/sessions/live_synthetic_e2e/attach');
    assert.equal(options.headers.Authorization, 'Bearer fake-fixture-only');
    const socket = new EventEmitter(); sidebandSocket = socket;
    socket.close = () => { socket.closed = true; };
    socket.send = message => {
      const command = JSON.parse(message); commands.push(command);
      assert.equal(command.type, 'session.close');
      setImmediate(() => socket.emit('message', Buffer.from(JSON.stringify({ type: 'session.closed', usage: { seconds: 2 } }))));
    };
    setImmediate(() => socket.emit('open')); return socket;
  } });
  const provider = createOpenAiLiveAdapter({ credentialProvider: async () => 'fake-fixture-only', attachSideband,
    fetchImpl: async (url, options) => {
      // This injected function never delegates to global fetch.
      assert.equal(url, 'https://api.openai.com/v1/live/sessions');
      providerRequests.push(JSON.parse(options.body));
      return { ok: true, json: async () => ({ session: { id: 'live_synthetic_e2e' }, transport: { type: 'webrtc', sdp: 'v=0\r\nsynthetic-answer' } }) };
    } });
  const providerBinding = { provider: 'openai', accountRef: 'fictional-account', projectRef: 'fictional-project', model: 'gpt-live-1', region: 'fictional-region', termsVersion: 'fictional-terms', retentionVersion: 'fictional-retention' };
  const authorize = createSyntheticEvaluationPolicy({ evaluationId: 'fictional-http-evaluation', providerBinding,
    async readApprovalSnapshot({ actorId: requestedActor, evaluationId, language }) {
      assert.equal(requestedActor, actorId);
      const at = Date.now();
      const record = { status: 'approved', revokedAt: null, revision: 'r1', validFrom: at - 1, expiresAt: at + 180000,
        evaluationId, purpose: 'synthetic_voice_evaluation', dataClass: 'synthetic', ...providerBinding };
      return { observedAt: at, principal: { id: actorId, role, active: true },
        evaluatorGrant: { ...record, actorId, languages: ['ha', 'ig', 'yo'] },
        consent: { ...record, actorId, language, version: 'voice-live-synthetic-v1', audioScope: 'fictional_tester_audio', status: granted ? 'approved' : 'revoked' },
        processorApproval: { ...record, languages: ['ha', 'ig', 'yo'], status: processorApproved ? 'approved' : 'revoked' },
        budgetApproval: { ...record, approvalId: 'fictional-budget', currency: 'USD', limitMinor: 100 },
      };
    } });
  const broker = createLiveVoiceBroker({ env: { NODE_ENV: 'test', DOCTARX_VOICE_LIVE_PROTOTYPE_ENABLED: 'true' }, assertSession: async () => {}, provider, authorize,
    onEvidence: value => evidence.push(value) });
  const app = express(); app.use(express.json({ limit: '70kb' }));
  app.use('/voice', createVoiceLiveRouter({ broker, authenticate(req, res, next) {
    if (req.headers.authorization !== 'Bearer synthetic-http-fixture') return res.status(401).json({ code: 'AUTH_REQUIRED' });
    req.user = { id: actorId, role }; next();
  } }));
  const server = await new Promise(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
  async function request(path, body) {
    const result = await fetch(`http://127.0.0.1:${server.address().port}/voice${path}`, { method: 'POST', headers: { Authorization: 'Bearer synthetic-http-fixture', 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const value = await result.json(); responses.push(value);
    if (!result.ok) throw Object.assign(new Error('Synthetic request failed'), { code: value.code });
    return value;
  }
  const httpBroker = { reserve: input => request('/permits', input), connect: (id, input) => request(`/permits/${id}/connect`, input), stop: id => request(`/permits/${id}/stop`, {}), lease: id => request(`/permits/${id}/lease`, {}) };
  const track = Object.assign(new Events(), { enabled: true, stopped: false, stop() { this.stopped = true; } });
  class Peer extends Events {
    constructor() { super(); peer = this; this.iceGatheringState = 'complete'; }
    createDataChannel() { this.channel = new Events(); this.channel.readyState = 'open'; this.channel.close = () => { this.channel.readyState = 'closed'; }; return this.channel; }
    addTrack() {}
    async createOffer() { return { type: 'offer', sdp: 'v=0\r\nsynthetic-offer' }; }
    async setLocalDescription(description) { this.localDescription = description; }
    async setRemoteDescription(description) {
      assert.equal(description.sdp, 'v=0\r\nsynthetic-answer');
      this.emit('track', { track: { stop() {} } });
      this.channel.emit('message', { data: JSON.stringify({ type: 'session.started', session: { id: 'live_synthetic_e2e' } }) });
    }
    close() { this.closed = true; }
  }
  const timers = [];
  const audio = { srcObject: null, paused: true, pause() { this.paused = true; }, async play() { this.paused = false; } };
  const client = createLiveWebRtcSession({ broker: httpBroker, mediaDevices: { async getUserMedia() { captures++; return { getTracks: () => [track], getAudioTracks: () => [track] }; } }, PeerConnection: Peer, MediaStreamClass: class {}, audioElement: audio,
    onState: state => states.push(state), onError: error => errors.push(error), onTranscript: caption => captions.push(caption),
    timers: { setTimeout, clearTimeout, setInterval(fn) { const timer = { fn }; timers.push(timer); return timer; }, clearInterval(timer) { if (timer) timer.cleared = true; } } });
  t.after(async () => { await client.stop(); await broker.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  return { client, broker, providerRequests, evidence, captions, commands, states, errors, responses, timers, track, audio,
    start: language => client.start({ language, consentVersion: 'voice-live-synthetic-v1', consentAcknowledged: true }),
    revoke: () => { granted = false; }, revokeProcessor: () => { processorApproved = false; }, demote: () => { role = 'patient'; }, get captures() { return captures; }, get peer() { return peer; }, get socket() { return sidebandSocket; } };
}

for (const language of ['ha', 'ig', 'yo']) test(`${language}: full synthetic HTTP/media/provider contract with transcript and confirmed close`, async t => {
  const f = await fixture(t); await f.start(language);
  assert.equal(f.client.getState(), 'listening'); assert.equal(f.captures, 1); assert.equal(f.track.enabled, true);
  assert.equal(f.providerRequests[0].session.model, 'gpt-live-1'); assert.equal(f.providerRequests[0].session.store, false);
  for (const type of ['session.input_transcript.delta', 'session.output_transcript.delta']) {
    const event = { type, delta: ' synthetic fragment', start_ms: 0, end_ms: 100 };
    f.socket.emit('message', Buffer.from(JSON.stringify(event))); f.peer.channel.emit('message', { data: JSON.stringify(event) });
  }
  assert.equal(f.evidence.length, 2); assert.equal(f.captions.length, 2);
  assert.ok(f.evidence.every(item => item.clinicalReady === false && item.final === false));
  f.client.interruptPlayback(); assert.equal(f.audio.paused, true); assert.equal(f.track.enabled, true);
  await f.client.resumePlayback(); assert.equal(f.audio.paused, false);
  await f.client.stop(); assert.equal(f.track.stopped, true); assert.equal(f.peer.closed, true); assert.equal(f.commands.length, 1);
  assert.equal(f.providerRequests.length, 1); assert.equal(f.responses.some(value => JSON.stringify(value).includes('fake-fixture-only')), false);
  assert.equal(f.responses.some(value => JSON.stringify(value).includes('live_synthetic_e2e')), false);
  assert.deepEqual(f.errors, []);
});

test('cross-layer role revocation prevents new authority but still permits owner cleanup', async t => {
  const f = await fixture(t); await f.start('yo'); f.demote(); f.timers[0].fn();
  await until(() => f.client.getState() === 'stopped' && f.peer.closed);
  assert.equal(f.track.stopped, true); assert.equal(f.commands.length, 1);
  await f.start('ha'); assert.equal(f.captures, 1); assert.equal(f.client.getState(), 'failed');
});

test('cross-layer consent revocation closes the provider and stops local capture', async t => {
  const f = await fixture(t); await f.start('ig'); f.revoke(); f.timers[0].fn();
  await until(() => f.client.getState() === 'stopped' && f.peer.closed);
  assert.equal(f.track.stopped, true); assert.equal(f.commands.length, 1);
});


test('cross-layer processor approval revocation stops an active evaluation and forbids another microphone', async t => {
  const f = await fixture(t); await f.start('ha'); f.revokeProcessor(); f.timers[0].fn();
  await until(() => f.client.getState() === 'stopped' && f.peer.closed);
  assert.equal(f.track.stopped, true); assert.equal(f.commands.length, 1);
  await f.start('yo'); assert.equal(f.captures, 1); assert.equal(f.providerRequests.length, 1);
});
