'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createLiveWebRtcSession, mergeLiveCleanupConcerns, liveCleanupWarning, LEASE_RENEWAL_TIMEOUT_MS } = require('../../../lib/voice/liveWebRtcSession.cjs');
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
class Events extends EventEmitter { addEventListener(name, callback) { this.on(name, callback); } removeEventListener(name, callback) { this.off(name, callback); } }
function fixture(overrides = {}) {
  const fixtureTime = Date.now(), now = overrides.now || (() => fixtureTime);
  const calls = [], errors = [], states = [], transcripts = [], scheduled = [], cleanups = [];
  const track = Object.assign(new Events(), { enabled: true, stopped: false, stop() { this.stopped = true; } });
  const stream = { getTracks: () => [track], getAudioTracks: () => [track] };
  let peer, captured;
  class Peer extends Events {
    constructor(config) { super(); peer = this; this.iceGatheringState = 'complete'; calls.push(['peer', config]); }
    createDataChannel(name) { this.channel = new Events(); this.channel.readyState = 'open'; this.channel.send = data => calls.push(['event', JSON.parse(data)]); this.channel.close = () => { this.channel.readyState = 'closed'; }; calls.push(['channel', name]); return this.channel; }
    addTrack(value) { calls.push(['addTrack', value]); }
    async createOffer() { calls.push(['offer']); return { type: 'offer', sdp: 'v=0\r\nsynthetic-offer' }; }
    async setLocalDescription(description) { this.localDescription = description; }
    async setRemoteDescription(description) { this.remoteDescription = description; }
    close() { this.closed = true; }
  }
  const audio = { srcObject: null, paused: true, pause() { this.paused = true; }, async play() { this.paused = false; } };
  const broker = { async reserve(input) { calls.push(['reserve', input]); return { permitId: 'permit', expiresAt: now() + 180000, language: input.language, dataClass: 'synthetic', provider: 'openai-gpt-live' }; }, async connect(id, body) { calls.push(['connect', id, body]); return { transport: { type: 'webrtc', sdp: 'v=0\r\nsynthetic-answer' } }; }, async stop(id) { calls.push(['stop', id]); return { providerCleanupConfirmed: true }; }, async lease() { return { active: true }; }, ...overrides.broker };
  const client = createLiveWebRtcSession({ broker, mediaDevices: { async getUserMedia(config) { calls.push(['capture', config]); captured = true; return overrides.capture ? overrides.capture() : stream; } }, PeerConnection: Peer, MediaStreamClass: class { constructor(tracks) { this.tracks = tracks; } }, audioElement: audio,
    onError: error => errors.push(error), onState: state => { states.push(state); overrides.onState?.(state); }, onTranscript: fragment => transcripts.push(fragment), onCleanup: receipt => cleanups.push(receipt), now, ...(overrides.AbortControllerClass ? { AbortControllerClass: overrides.AbortControllerClass } : {}),
    timers: { setTimeout(fn, ms) { const entry = { fn, ms, type: 'timeout' }; scheduled.push(entry); return entry; }, clearTimeout(entry) { if (entry) entry.cleared = true; }, setInterval(fn, ms) { const entry = { fn, ms, type: 'interval' }; scheduled.push(entry); return entry; }, clearInterval(entry) { if (entry) entry.cleared = true; } } });
  const start = () => client.start({ language: 'ha', consentVersion: 'voice-live-synthetic-v1', consentAcknowledged: true });
  return { client, calls, errors, states, transcripts, cleanups, track, stream, audio, scheduled, start, get peer() { return peer; }, get captured() { return captured; } };
}

test('microphone cannot open without consent or before server authorization', async () => {
  const f = fixture({ broker: { reserve: async () => { throw new Error('Denied'); } } });
  await f.client.start({ language: 'ha', consentAcknowledged: false }); assert.equal(f.captured, undefined);
  await f.start(); assert.equal(f.captured, undefined); assert.equal(f.client.getState(), 'failed');
});

test('real WebRTC path negotiates duplex tracks and event channel; no speech is enabled before started', async () => {
  const f = fixture(); await f.start();
  assert.equal(f.calls[0][0], 'reserve'); assert.equal(f.calls[1][0], 'capture');
  assert.equal(f.calls.find(call => call[0] === 'capture')[1].video, false);
  assert.equal(f.track.enabled, false);
  assert.ok(f.calls.findIndex(call => call[0] === 'channel') < f.calls.findIndex(call => call[0] === 'offer'));
  assert.deepEqual(f.peer.remoteDescription, { type: 'answer', sdp: 'v=0\r\nsynthetic-answer' });
  f.peer.emit('track', { track: { stop() {} } });
  f.peer.channel.emit('message', { data: JSON.stringify({ type: 'session.started' }) });
  assert.equal(f.track.enabled, true); assert.equal(f.audio.paused, false); assert.equal(f.client.getState(), 'listening');
  for (const type of ['session.input_transcript.delta', 'session.output_transcript.delta']) f.peer.channel.emit('message', { data: JSON.stringify({ type, delta: ' fragment', start_ms: 100, end_ms: 200 }) });
  assert.deepEqual(f.transcripts.map(item => item.speaker), ['patient', 'assistant']);
  assert.equal(f.transcripts[0].final, false); assert.equal(f.transcripts[1].heardAudio, null);
  f.client.interruptPlayback(); assert.equal(f.audio.paused, true); assert.equal(f.track.enabled, true);
  await f.client.resumePlayback(); assert.equal(f.audio.paused, false);
  await f.client.pause(); assert.equal(f.track.stopped, true); assert.equal(f.peer.closed, true); assert.equal(f.audio.srcObject, null);
  assert.equal(f.calls.some(call => call[0] === 'event' && call[1].type === 'session.close'), false);
  assert.ok(f.calls.some(call => call[0] === 'stop'));
});

test('late microphone permission after cancel stops every acquired track', async () => {
  const pending = deferred(); const f = fixture({ capture: () => pending.promise });
  const starting = f.start(); await new Promise(resolve => setImmediate(resolve));
  await f.client.stop(); pending.resolve(f.stream); await starting;
  assert.equal(f.track.stopped, true); assert.equal(f.peer, undefined);
});

test('stop during SDP exchange closes late provider result and rejects stale transcript events', async () => {
  const pending = deferred(); const f = fixture({ broker: { connect: () => pending.promise } });
  const starting = f.start(); await new Promise(resolve => setImmediate(resolve));
  await f.client.stop(); pending.resolve({ transport: { type: 'webrtc', sdp: 'v=0\r\nlate' } }); await starting;
  assert.equal(f.track.stopped, true); assert.equal(f.peer.remoteDescription, undefined);
  f.peer.channel.emit('message', { data: JSON.stringify({ type: 'session.input_transcript.delta', delta: 'late', start_ms: 1, end_ms: 2 }) });
  assert.equal(f.transcripts.length, 0);
});

test('connection failure and lease loss stop local audio without automatic reconnect', async () => {
  const f = fixture(); await f.start(); f.peer.connectionState = 'disconnected'; f.peer.emit('connectionstatechange');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.track.stopped, true); assert.equal(f.client.getState(), 'stopped');
  assert.equal(f.calls.filter(call => call[0] === 'capture').length, 1);
  const g = fixture({ broker: { lease: async () => { throw new Error('revoked'); } } }); await g.start();
  g.scheduled.find(entry => entry.type === 'interval').fn(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(g.track.stopped, true);
});

test('repeated start does not open another microphone and malformed events are ignored', async () => {
  const f = fixture(); await f.start(); await f.start();
  assert.equal(f.calls.filter(call => call[0] === 'capture').length, 1);
  for (const data of ['bad json', JSON.stringify({ type: 'session.input_transcript.delta', delta: 'x', start_ms: 'a', end_ms: 2 }), JSON.stringify({ type: 'response.function_call_arguments.done', arguments: '{"action":"sign_note"}' })]) f.peer.channel.emit('message', { data });
  assert.equal(f.transcripts.length, 0); await f.client.stop();
});

test('late old SDP result and track cannot detach audio belonging to a newer session', async () => {
  const pending = deferred(); let connectionCount = 0;
  const f = fixture({ broker: { connect: async () => { connectionCount++; return connectionCount === 1 ? pending.promise : { transport: { type: 'webrtc', sdp: 'v=0\r\nnew' } }; } } });
  const oldStart = f.start(); await new Promise(resolve => setImmediate(resolve)); const oldPeer = f.peer;
  await f.client.stop(); await f.start();
  f.peer.emit('track', { track: { stop() {} } }); f.peer.channel.emit('message', { data: JSON.stringify({ type: 'session.started' }) });
  const newAudio = f.audio.srcObject; assert.equal(f.audio.paused, false);
  pending.resolve({ transport: { type: 'webrtc', sdp: 'v=0\r\nold' } }); await oldStart;
  assert.equal(f.audio.srcObject, newAudio); assert.equal(f.audio.paused, false);
  let stopped = false; oldPeer.emit('track', { track: { stop() { stopped = true; } } });
  assert.equal(stopped, true); assert.equal(f.audio.srcObject, newAudio); await f.client.stop();
});


test('device loss stops its session, while old-track ended events cannot stop a newer one', async () => {
  const f = fixture(); await f.start(); f.track.emit('ended'); await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.client.getState(), 'stopped'); assert.equal(f.track.stopped, true);
  const oldTrack = Object.assign(new Events(), { enabled: true, stop() {} });
  const newTrack = Object.assign(new Events(), { enabled: true, stop() {} }); let captures = 0;
  const g = fixture({ capture: async () => { const track = ++captures === 1 ? oldTrack : newTrack; return { getTracks: () => [track], getAudioTracks: () => [track] }; } });
  await g.start(); await g.client.stop(); await g.start();
  g.peer.channel.emit('message', { data: JSON.stringify({ type: 'session.started' }) });
  oldTrack.emit('ended'); assert.equal(g.client.getState(), 'listening'); await g.client.stop();
});


test('privacy stop releases microphone immediately but keeps transport until server close finalizes', async () => {
  const pending = deferred(); const f = fixture({ broker: { stop: () => pending.promise } });
  await f.start(); const ending = f.client.stop();
  assert.equal(f.track.stopped, true); assert.notEqual(f.peer.closed, true); assert.equal(f.peer.channel.readyState, 'open');
  pending.resolve({ providerCleanupConfirmed: true }); await ending;
  assert.equal(f.peer.closed, true); assert.equal(f.peer.channel.readyState, 'closed');
});

test('failed old start cannot overwrite a newer listening state after delayed cleanup', async () => {
  const closing = deferred(); let connects = 0, stops = 0;
  const f = fixture({ broker: { async connect() { if (++connects === 1) throw new Error('old connection failed'); return { transport: { type: 'webrtc', sdp: 'v=0\r\nnew' } }; }, async stop() { return ++stops === 1 ? closing.promise : { providerCleanupConfirmed: true }; } } });
  const oldStart = f.start(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.client.getState(), 'stopped'); await f.start();
  f.peer.channel.emit('message', { data: JSON.stringify({ type: 'session.started' }) });
  assert.equal(f.client.getState(), 'listening'); closing.resolve({ providerCleanupConfirmed: true }); await oldStart;
  assert.equal(f.client.getState(), 'listening'); await f.client.stop();
});

test('an already-queued old expiry callback cannot stop a newer session', async () => {
  const f = fixture(); await f.start(); const oldExpiry = f.scheduled[0]; await f.client.stop(); await f.start();
  f.peer.channel.emit('message', { data: JSON.stringify({ type: 'session.started' }) }); oldExpiry.fn();
  assert.equal(f.client.getState(), 'listening'); await f.client.stop();
});

test('speaker mute survives a late track and duplicate started event until explicit resume', async () => {
  const f = fixture(); await f.start(); f.peer.channel.emit('message', { data: JSON.stringify({ type: 'session.started' }) });
  f.client.interruptPlayback(); f.peer.emit('track', { track: { stop() {} } });
  f.peer.channel.emit('message', { data: JSON.stringify({ type: 'session.started' }) });
  assert.equal(f.audio.paused, true); assert.equal(f.client.getState(), 'playback_paused');
  await f.client.resumePlayback(); assert.equal(f.audio.paused, false); assert.equal(f.client.getState(), 'listening'); await f.client.stop();
});


test('a newer speaker mute wins over a pending resume promise and later tracks', async () => {
  const f = fixture(); await f.start(); f.peer.channel.emit('message', { data: JSON.stringify({ type: 'session.started' }) });
  f.client.interruptPlayback(); const playing = deferred(); let plays = 0;
  f.audio.play = () => { plays++; f.audio.paused = false; return playing.promise; };
  const resume = f.client.resumePlayback(); f.client.interruptPlayback(); playing.resolve(); await resume;
  assert.equal(f.audio.paused, true); assert.equal(f.client.getState(), 'playback_paused');
  f.peer.emit('track', { track: { stop() {} } }); assert.equal(plays, 1); assert.equal(f.audio.paused, true); await f.client.stop();
});

test('live panel wires explicit speaker resume and guards callbacks across identity generations', () => {
  // Source contract only. Rendered interaction remains a separate browser gate.
  const source = require('node:fs').readFileSync(require('node:path').join(__dirname, '../../../components/voice/LiveVoicePrototype.jsx'), 'utf8');
  assert.match(source, /transport\.current\?\.resumePlayback\(\)/);
  assert.match(source, /'Resume speaker' : 'Mute speaker now'/);
  assert.doesNotMatch(source, /<audio[^>]*\bcontrols\b/);
  assert.match(source, /\[userId, role, language\]/);
  for (const callback of ['onState', 'onError', 'onTranscript']) assert.match(source, new RegExp(String.raw`${callback}: [^=]+=> \{ if \(current\(\)\)`));
  assert.match(source, /generationRef\.current\+\+; void transport\.current\?\.stop\(\)/);
});


test('throwing microphone and speaker operations cannot bypass provider or peer cleanup', async () => {
  const f = fixture(); await f.start();
  let remoteStopped = false, otherStopped = false;
  f.peer.emit('track', { track: { stop() { remoteStopped = true; } } });
  f.track.stop = () => { throw new Error('device diagnostic must not leak'); };
  f.stream.getTracks = () => [f.track, { stop() { otherStopped = true; } }];
  f.audio.pause = () => { throw new Error('playback diagnostic must not leak'); };
  const result = await f.client.stop();
  assert.equal(otherStopped, true); assert.equal(remoteStopped, true);
  assert.equal(f.audio.srcObject, null); assert.equal(f.track.enabled, false);
  assert.equal(f.peer.closed, true); assert.ok(f.calls.some(call => call[0] === 'stop'));
  assert.equal(result.tracksStopped, false); assert.equal(result.playbackStopped, false);
  assert.equal(result.transportClosed, true); assert.equal(result.providerCleanupConfirmed, true);
  assert.equal(JSON.stringify(f.cleanups).includes('diagnostic'), false);
});

test('duplicate stop returns the same pending promise and retained cleanup failure receipt', async () => {
  const ending = deferred(); const f = fixture({ broker: { stop: () => ending.promise } }); await f.start();
  f.track.stop = () => { throw new Error('stop rejected'); };
  const first = f.client.stop(), second = f.client.stop(); assert.equal(second, first);
  ending.resolve({ providerCleanupConfirmed: false });
  const result = await first; assert.equal(result.tracksStopped, false); assert.equal(result.providerCleanupConfirmed, false);
  assert.equal(await second, result); assert.equal(await f.client.stop(), result);
  assert.equal(f.cleanups.length, 2); assert.equal(f.cleanups[0].cleanupPending, true); assert.equal(f.peer.closed, true);
});

test('late granted microphone failures are reported after cancellation without disrupting a replacement', async () => {
  const permission = deferred(); let captures = 0, liveStopped = false, extraStopped = false;
  const late = { readyState: 'live', stop() { throw new Error('old device'); } };
  const other = { stop() { extraStopped = true; } };
  const replacement = { stop() { liveStopped = true; } };
  const f = fixture({ capture: () => ++captures === 1 ? permission.promise : { getTracks: () => [replacement], getAudioTracks: () => [replacement] } });
  const starting = f.start(); await new Promise(resolve => setImmediate(resolve));
  assert.equal((await f.client.stop()).permissionPending, true);
  await f.start(); f.peer.channel.emit('message', { data: JSON.stringify({ type: 'session.started' }) });
  permission.resolve({ getTracks: () => [late, other] }); await starting;
  assert.equal(f.cleanups.at(-1).tracksStopped, false); assert.equal(f.cleanups.at(-1).permissionPending, false);
  assert.equal(extraStopped, true); assert.equal(liveStopped, false); assert.equal(f.client.getState(), 'listening');
  await f.client.stop();
});

test('each transport close is attempted even when channel and provider close fail', async () => {
  const f = fixture({ broker: { stop: async () => { throw new Error('provider'); } } }); await f.start();
  f.peer.channel.close = () => { throw new Error('channel'); };
  const result = await f.client.stop();
  assert.equal(f.peer.closed, true); assert.equal(f.track.stopped, true);
  assert.equal(result.transportClosed, false); assert.equal(result.providerCleanupConfirmed, false);
  assert.equal(result.providerFinalUsageConfirmed, false);
});

test('provider close timeout still closes peer and retains an uncertain receipt', async () => {
  const never = deferred(); const f = fixture({ broker: { stop: () => never.promise } }); await f.start();
  const ending = f.client.stop(); f.scheduled.find(entry => entry.ms === 17000 && !entry.cleared).fn();
  const result = await ending; assert.equal(result.providerCleanupConfirmed, false); assert.equal(f.peer.closed, true);
  never.resolve({ providerCleanupConfirmed: true }); await new Promise(resolve => setImmediate(resolve));
  assert.equal(await f.client.stop(), result); assert.equal(f.cleanups.length, 1);
});

test('a nonthrowing device stop that leaves the microphone live is not a confirmed release', async () => {
  const f = fixture(); await f.start(); f.track.readyState = 'live'; f.track.stop = () => {};
  const result = await f.client.stop(); assert.equal(result.tracksStopped, false); assert.equal(f.peer.closed, true);
});

test('late started and resume callbacks cannot enable audio after expiry when timers have not run', async () => {
  let at = Date.now(); const f = fixture({ now: () => at }); await f.start();
  at += 200000; f.peer.channel.emit('message', { data: JSON.stringify({ type: 'session.started' }) });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.track.enabled, false); assert.equal(f.track.stopped, true); assert.equal(f.client.getState(), 'stopped');
  let time = Date.now(); const g = fixture({ now: () => time }); await g.start();
  g.peer.channel.emit('message', { data: JSON.stringify({ type: 'session.started' }) });
  time += 200000; await g.client.resumePlayback(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(g.track.stopped, true); assert.equal(g.audio.paused, true); assert.equal(g.client.getState(), 'stopped');
});

test('a shorter lease expiry is enforced, but a longer response cannot extend the original permit', async () => {
  let at = Date.now(), expiry = at + 1000;
  const f = fixture({ now: () => at, broker: { lease: async () => ({ active: true, expiresAt: expiry }) } }); await f.start();
  const tick = f.scheduled.find(entry => entry.type === 'interval'); tick.fn(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.scheduled.at(-1).ms, 1000);
  expiry = at + 3600000; tick.fn(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.scheduled.at(-1).ms, 1000);
  at += 1001; f.peer.channel.emit('message', { data: JSON.stringify({ type: 'session.started' }) });
  await new Promise(resolve => setImmediate(resolve)); assert.equal(f.track.stopped, true); assert.equal(f.client.getState(), 'stopped');
});

test('pending lease requests are bounded and a synchronous lease throw still stops capture', async () => {
  const pending = deferred(); let reads = 0;
  const f = fixture({ broker: { lease: () => { reads++; return pending.promise; } } }); await f.start();
  const tick = f.scheduled.find(entry => entry.type === 'interval'); for (let i = 0; i < 20; i++) tick.fn();
  await new Promise(resolve => setImmediate(resolve)); assert.equal(reads, 1); await f.client.stop(); pending.resolve({ active: true });
  const g = fixture({ broker: { lease() { throw new Error('lease failed'); } } }); await g.start();
  g.scheduled.find(entry => entry.type === 'interval').fn(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(g.track.stopped, true); assert.equal(g.peer.closed, true);
});

test('UI callback failure before capture cannot open the microphone after its implicit stop', async () => {
  const f = fixture({ onState(state) { if (state === 'requesting_microphone') throw new Error('unmounted view'); } });
  await f.start(); assert.equal(f.captured, undefined); assert.equal(f.client.getState(), 'stopped');
});

test('cleanup warnings survive newer successful sessions and do not include raw device details', () => {
  const first = mergeLiveCleanupConcerns({}, { tracksStopped: false, playbackStopped: false, transportClosed: false, providerCleanupConfirmed: false, permissionPending: true });
  const merged = mergeLiveCleanupConcerns(first, { tracksStopped: true, playbackStopped: true, transportClosed: true, providerCleanupConfirmed: true, permissionPending: false });
  assert.equal(merged.permission, false);
  for (const field of ['microphone', 'speaker', 'transport', 'provider']) assert.equal(merged[field], true);
  const warning = liveCleanupWarning(first);
  for (const fragment of ['microphone indicator', 'Speaker release', 'voice connection', 'Provider termination', 'pending microphone permission']) assert.match(warning, new RegExp(fragment));
  const source = require('node:fs').readFileSync(require('node:path').join(__dirname, '../../../components/voice/LiveVoicePrototype.jsx'), 'utf8');
  assert.match(source, /if \(mounted\.current\) setCleanupConcerns\(cleanupConcernRef\.current\)/);
  assert.match(source, /mergeLiveCleanupConcerns\(cleanupConcernRef\.current, receipt, captured\)/);
});


test('failed local muting immediately disconnects the peer instead of streaming through slow provider close', async () => {
  const pending = deferred(); const f = fixture({ broker: { stop: () => pending.promise } }); await f.start();
  Object.defineProperty(f.track, 'enabled', { get: () => true, set() { throw new Error('mute failed'); } });
  f.track.stop = () => { throw new Error('stop failed'); };
  const ending = f.client.stop();
  assert.equal(f.peer.closed, true); assert.equal(f.peer.channel.readyState, 'closed');
  assert.equal(f.cleanups.length, 1); assert.equal(f.cleanups[0].tracksStopped, false); assert.equal(f.cleanups[0].cleanupPending, true);
  assert.equal(mergeLiveCleanupConcerns({}, f.cleanups[0]).provider, false);
  pending.resolve({ providerCleanupConfirmed: true }); assert.equal((await ending).cleanupPending, false);
});

test('late failed microphone cleanup refreshes the terminal receipt returned by a later Stop', async () => {
  const permission = deferred(), f = fixture({ capture: () => permission.promise });
  const starting = f.start(); await new Promise(resolve => setImmediate(resolve));
  const initial = await f.client.stop(); assert.equal(initial.permissionPending, true);
  f.track.stop = () => { throw new Error('late failure'); };
  permission.resolve(f.stream); await starting;
  const latest = await f.client.stop(); assert.equal(latest.tracksStopped, false); assert.equal(latest.permissionPending, false);
  assert.notEqual(latest, initial); assert.equal(await f.client.stop(), latest);
});


test('a denied microphone prompt after cancel reports its resolved permission state', async () => {
  const permission = deferred(), f = fixture({ capture: () => permission.promise });
  const starting = f.start(); await new Promise(resolve => setImmediate(resolve)); await f.client.stop();
  assert.equal(f.cleanups.at(-1).permissionPending, true); permission.reject(new Error('permission denied')); await starting;
  assert.equal(f.cleanups.at(-1).permissionPending, false); assert.equal((await f.client.stop()).permissionPending, false);
  assert.equal(f.cleanups.at(-1).tracksStopped, true);
});

test('resolved permission clears only its own session concern and never another outstanding prompt', () => {
  const successful = { tracksStopped: true, playbackStopped: true, transportClosed: true, providerCleanupConfirmed: true };
  let concerns = mergeLiveCleanupConcerns({}, { ...successful, permissionPending: true }, 'old');
  concerns = mergeLiveCleanupConcerns(concerns, { ...successful, permissionPending: true }, 'new');
  concerns = mergeLiveCleanupConcerns(concerns, { ...successful, permissionPending: false }, 'old');
  assert.equal(concerns.permission, true); assert.deepEqual(concerns.permissionScopes, ['new']);
  concerns = mergeLiveCleanupConcerns(concerns, { ...successful, permissionPending: false }, 'new');
  assert.equal(concerns.permission, false); assert.equal(liveCleanupWarning(concerns), '');
});


test('pending permission is reported synchronously even while server cleanup is still pending', async () => {
  const permission = deferred(), closing = deferred();
  const f = fixture({ capture: () => permission.promise, broker: { stop: () => closing.promise } });
  const starting = f.start(); await new Promise(resolve => setImmediate(resolve)); const ending = f.client.stop();
  assert.equal(f.client.getState(), 'stopped'); assert.equal(f.cleanups.length, 1);
  assert.equal(f.cleanups[0].permissionPending, true); assert.equal(f.cleanups[0].cleanupPending, true);
  permission.reject(new Error('denied')); await starting;
  assert.equal(f.cleanups.at(-1).permissionPending, false); assert.equal(f.cleanups.at(-1).cleanupPending, true);
  closing.resolve({ providerCleanupConfirmed: true }); assert.equal((await ending).permissionPending, false);
});

test('the shorter connection answer deadline applies before the first periodic lease', async () => {
  let at = Date.now();
  const f = fixture({ now: () => at, broker: { connect: async () => ({ transport: { type: 'webrtc', sdp: 'v=0' }, expiresAt: at + 500 }) } });
  await f.start(); at += 501; f.peer.channel.emit('message', { data: JSON.stringify({ type: 'session.started' }) });
  await new Promise(resolve => setImmediate(resolve)); assert.equal(f.track.enabled, false); assert.equal(f.track.stopped, true);
  const g = fixture({ broker: { connect: async () => ({ transport: { type: 'webrtc', sdp: 'v=0' }, expiresAt: 1 }) } });
  await g.start(); assert.equal(g.peer.remoteDescription, undefined); assert.equal(g.track.stopped, true);
});


test('hung renewal stops capture and playback at its deadline and aborts the browser HTTP request', async () => {
  const pending = deferred(); let signal;
  const f = fixture({ broker: { lease: (_id, options) => { signal = options.signal; return pending.promise; } } }); await f.start();
  f.peer.emit('track', { track: { stop() {} } }); f.peer.channel.emit('message', { data: JSON.stringify({ type: 'session.started' }) });
  f.scheduled.find(entry => entry.type === 'interval').fn(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(signal.aborted, false); assert.equal(f.track.enabled, true);
  const timeout = f.scheduled.find(entry => entry.ms === LEASE_RENEWAL_TIMEOUT_MS && !entry.cleared); assert.ok(timeout); timeout.fn();
  assert.equal(signal.aborted, true); assert.equal(f.track.stopped, true); assert.equal(f.audio.srcObject, null); assert.equal(f.client.getState(), 'stopped');
  await new Promise(resolve => setImmediate(resolve)); assert.equal(f.peer.closed, true);
  pending.resolve({ active: true, expiresAt: Date.now() + 999999 }); await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.client.getState(), 'stopped'); assert.equal(f.calls.filter(call => call[0] === 'capture').length, 1);
  assert.match(f.errors.at(-1), /renewal timed out/);
});

test('Stop aborts renewal and its queued timeout or rejection cannot affect a replacement session', async () => {
  const pending = deferred(); let signal;
  const f = fixture({ broker: { lease: (_id, options) => { signal = options.signal; return pending.promise; } } }); await f.start();
  f.scheduled.find(entry => entry.type === 'interval').fn(); await new Promise(resolve => setImmediate(resolve));
  const timeout = f.scheduled.find(entry => entry.ms === LEASE_RENEWAL_TIMEOUT_MS && !entry.cleared);
  await f.client.stop(); assert.equal(signal.aborted, true); assert.equal(timeout.cleared, true);
  await f.start(); f.peer.channel.emit('message', { data: JSON.stringify({ type: 'session.started' }) });
  timeout.fn(); pending.reject(new Error('old network diagnostic')); await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.client.getState(), 'listening'); assert.equal(f.errors.length, 0); await f.client.stop();
});

test('absolute renewal deadline rejects a late success before an overdue timer runs', async () => {
  let at = Date.now(), signal; const pending = deferred();
  const f = fixture({ now: () => at, broker: { lease: (_id, options) => { signal = options.signal; return pending.promise; } } }); await f.start();
  f.scheduled.find(entry => entry.type === 'interval').fn(); await new Promise(resolve => setImmediate(resolve));
  at += LEASE_RENEWAL_TIMEOUT_MS + 1; pending.resolve({ active: true, expiresAt: at + 180000 }); await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.track.stopped, true); assert.equal(signal.aborted, true); assert.equal(f.client.getState(), 'stopped');
});

test('audio events cannot continue after a renewal deadline while the timer and HTTP result remain pending', async () => {
  let at = Date.now(); const pending = deferred();
  const f = fixture({ now: () => at, broker: { lease: () => pending.promise } }); await f.start();
  f.peer.channel.emit('message', { data: JSON.stringify({ type: 'session.started' }) });
  f.scheduled.find(entry => entry.type === 'interval').fn(); await new Promise(resolve => setImmediate(resolve));
  at += LEASE_RENEWAL_TIMEOUT_MS + 1;
  f.peer.channel.emit('message', { data: JSON.stringify({ type: 'session.input_transcript.delta', delta: 'late', start_ms: 0, end_ms: 100 }) });
  assert.equal(f.transcripts.length, 0); assert.equal(f.track.stopped, true); assert.equal(f.client.getState(), 'stopped');
  pending.resolve({ active: true }); await f.client.stop();
});

test('a completed renewal invalidates its queued timeout even after a later renewal begins', async () => {
  const pending = deferred(); let calls = 0;
  const f = fixture({ broker: { lease: async () => ++calls === 1 ? { active: true } : pending.promise } }); await f.start();
  f.peer.channel.emit('message', { data: JSON.stringify({ type: 'session.started' }) });
  const interval = f.scheduled.find(entry => entry.type === 'interval'); interval.fn();
  const firstTimeout = f.scheduled.find(entry => entry.ms === LEASE_RENEWAL_TIMEOUT_MS && !entry.cleared);
  await new Promise(resolve => setImmediate(resolve)); assert.equal(firstTimeout.cleared, true);
  interval.fn(); await new Promise(resolve => setImmediate(resolve)); firstTimeout.fn();
  assert.equal(f.client.getState(), 'listening'); assert.equal(calls, 2); assert.equal(f.errors.length, 0);
  await f.client.stop(); pending.resolve({ active: true });
});

test('a queued renewal dispatch is canceled before issuing HTTP when Stop happens synchronously', async () => {
  let calls = 0; const f = fixture({ broker: { lease: async () => { calls++; return { active: true }; } } }); await f.start();
  f.scheduled.find(entry => entry.type === 'interval').fn(); const ending = f.client.stop();
  await ending; await new Promise(resolve => setImmediate(resolve)); assert.equal(calls, 0);
  assert.equal(f.scheduled.filter(entry => entry.ms === LEASE_RENEWAL_TIMEOUT_MS).every(entry => entry.cleared), true);
});

test('renewal timeout is capped by the remaining original permit lifetime', async () => {
  const at = Date.now(), pending = deferred();
  const f = fixture({ now: () => at, broker: {
    reserve: async input => ({ permitId: 'permit', expiresAt: at + 900, language: input.language, dataClass: 'synthetic', provider: 'openai-gpt-live' }),
    lease: () => pending.promise,
  } }); await f.start(); f.scheduled.find(entry => entry.type === 'interval').fn();
  assert.equal(f.scheduled.at(-1).ms, 900); await f.client.stop(); pending.resolve({ active: true });
});

test('unavailable cancellation support fails closed without issuing a renewal', async () => {
  let calls = 0;
  const f = fixture({ AbortControllerClass: class { constructor() { throw new Error('unsupported'); } }, broker: { lease: async () => { calls++; return { active: true }; } } });
  await f.start(); f.scheduled.find(entry => entry.type === 'interval').fn(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls, 0); assert.equal(f.track.stopped, true); assert.equal(f.peer.closed, true);
});

test('truthy nonboolean authority and private renewal errors cannot keep the microphone active', async () => {
  for (const lease of [async () => ({ active: 'true' }), async () => { throw new Error('sensitive network detail'); }]) {
    const f = fixture({ broker: { lease } }); await f.start(); f.scheduled.find(entry => entry.type === 'interval').fn();
    await new Promise(resolve => setImmediate(resolve)); assert.equal(f.track.stopped, true); assert.equal(f.peer.closed, true);
    assert.equal(f.errors.some(message => message.includes('sensitive network detail')), false);
  }
});

test('voice HTTP adapter forwards the exact renewal AbortSignal without changing request destination', async () => {
  const fs = require('node:fs'), vm = require('node:vm');
  const source = fs.readFileSync(require.resolve('../../../lib/voice/voiceLiveApi.js'), 'utf8');
  // Execute the unchanged request logic with only the ESM dependency/export
  // boundary replaced by the injected Axios-shaped test double.
  const calls = [], context = { api: { request: async input => { calls.push(input); return { data: { active: true } }; } }, result: null };
  vm.runInNewContext(source.replace("import api from '@/lib/api';", '').replace('export const voiceLiveApi', 'const voiceLiveApi') + '\nresult = voiceLiveApi;', context);
  const controller = new AbortController(); await context.result.lease('fictional-permit', { signal: controller.signal });
  assert.equal(calls[0].signal, controller.signal); assert.equal(calls[0].url, '/voice-live/permits/fictional-permit/lease');
  assert.equal(calls[0].method, 'POST'); assert.equal(calls[0].timeout, 25000);
  controller.abort(); assert.equal(calls[0].signal.aborted, true);
});

test('renewal AbortSignal cancels a real loopback HTTP request through Axios', { timeout: 3000 }, async t => {
  const http = require('node:http'), axios = require('axios'), fs = require('node:fs'), vm = require('node:vm');
  const arrived = deferred(), disconnected = deferred();
  const server = http.createServer((request, response) => {
    assert.equal(request.url, '/voice-live/permits/fictional-permit/lease');
    request.resume(); response.once('close', () => disconnected.resolve()); arrived.resolve();
    // Deliberately leave the local response pending. This server has no auth,
    // patient data or provider; only the browser-request cancellation is tested.
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const source = fs.readFileSync(require.resolve('../../../lib/voice/voiceLiveApi.js'), 'utf8');
  const context = { api: axios.create({ baseURL: `http://127.0.0.1:${server.address().port}`, proxy: false }), result: null };
  vm.runInNewContext(source.replace("import api from '@/lib/api';", '').replace('export const voiceLiveApi', 'const voiceLiveApi') + '\nresult = voiceLiveApi;', context);
  const controller = new AbortController(); const pending = context.result.lease('fictional-permit', { signal: controller.signal });
  const canceled = assert.rejects(pending, error => error.code === 'ERR_CANCELED');
  await arrived.promise; controller.abort(); await canceled; await disconnected.promise;
});
