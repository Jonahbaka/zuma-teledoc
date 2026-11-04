'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { createLocalObservation } = require('../../../lib/voice/localObservation.cjs');
const { createObservedPcmSession } = require('../../../lib/voice/observedPcmSession.cjs');
const { createGeminiPcmSession } = require('../../../lib/voice/geminiPcmSession.cjs');
const { analyzeTrace, createEvaluationTrial, analyzeEvaluationTrial } = require('../../services/voice/voiceEvaluationEvidence');
const { browser, deferred, FakeSocket } = require('./helpers/pcmBrowser.cjs');
const flush = () => new Promise(resolve => setImmediate(resolve));
const INPUT = { language: 'ha', consentAcknowledged: true, consentVersion: 'voice-live-synthetic-v1', expectedActorId: 'private-actor-not-in-evidence', expectedSessionBinding: 'd'.repeat(64) };
function fixture({ pendingPermission = false, observation = {}, directObserver, socketClose } = {}) {
  const permission = pendingPermission ? deferred() : null;
  const media = browser(permission ? { getUserMedia: () => permission.promise } : {}), sockets = [], timers = new Map();
  let sequence = 0, clock = 0;
  const options = { ...media, origin: 'https://private-origin-not-in-evidence.invalid', now: () => 1000,
    setTimer(fn, ms) { const id = ++sequence; timers.set(id, { fn, ms }); return id; }, clearTimer(id) { timers.delete(id); },
    createSocket(url, protocol) { const socket = new FakeSocket(url); socket.protocol = protocol; if (socketClose) socket.close = socketClose; sockets.push(socket); return socket; } };
  const client = directObserver ? createGeminiPcmSession({ ...options, onObservation: directObserver })
    : createObservedPcmSession(options, { sessionRef: 'local-session-1', now: () => clock++, ...observation });
  async function start() {
    const started = client.start(INPUT); const socket = sockets[0]; socket.open();
    socket.message({ type: 'session.ready', provider: 'google', model: 'gemini-3.8-live', language: 'ha', dataClass: 'synthetic', consentVersion: INPUT.consentVersion,
      sessionId: 'private-provider-session-not-in-evidence', actorId: INPUT.expectedActorId, sessionBinding: INPUT.expectedSessionBinding, expiresAt: 181000 });
    return started;
  }
  return { client, media, sockets, timers, permission, start,
    fireTimer(ms) { const pair = [...timers].find(([, timer]) => timer.ms === ms); assert.ok(pair); timers.delete(pair[0]); pair[1].fn(); },
    audio() { sockets[0].message({ type: 'audio.pcm', sampleRate: 24000, playbackEpoch: 0, data: Buffer.alloc(480).toString('base64') }); },
  };
}
test('explicit wrapper captures real local controller lifecycle, never audio, captions, identity or audibility', async () => {
  const f = fixture(); await f.start(); f.media.frame(); f.audio();
  f.sockets[0].message({ type: 'transcript', speaker: 'assistant', text: 'private-caption-not-in-evidence' });
  f.client.setMicrophonePaused(true); f.client.setMicrophonePaused(false);
  await f.client.stop(); const report = f.client.evidence(), types = report.trace.map(event => event.type);
  assert.equal(report.status, 'local_observations_only');
  for (const type of ['consent.granted', 'start.requested', 'provider.ready', 'microphone.requested', 'microphone.started', 'audio.input.sent',
    'audio.output.scheduled', 'microphone.paused', 'microphone.resumed', 'stop.requested', 'socket.close_requested',
    'socket.closed', 'provider.close_unconfirmed', 'playback.cleared', 'microphone.stopped', 'audio.contexts.closed']) assert.ok(types.includes(type), type);
  for (const type of ['audio.output.started', 'audio.output.stopped', 'input.speech.ended', 'provider.closed', 'captions.cleared']) assert.equal(types.includes(type), false, type);
  for (const key of ['audioRecorded', 'transcriptRecorded', 'audiblePlaybackVerified', 'providerClosureVerified', 'languageQualityValidated', 'activationApproved']) assert.equal(report[key], false);
  const encoded = JSON.stringify(report);
  for (const secret of ['private-actor', 'private-origin', 'private-provider-session', 'private-caption', INPUT.expectedSessionBinding, Buffer.alloc(480).toString('base64')]) assert.equal(encoded.includes(secret), false);
  assert.ok(report.trace.every(event => Object.keys(event).sort().join() === 'atMs,sessionRef,type'));
  assert.equal(f.timers.size, 0); assert.ok(f.media.streams.every(stream => stream.track.readyState === 'ended'));
  const analyzed = analyzeTrace(report.trace); assert.equal(analyzed.status, 'incomplete_reported_trace');
  assert.ok(analyzed.missing.includes('provider_closure_unconfirmed')); assert.ok(analyzed.missing.includes('caption_clear_not_observed'));
});
test('scheduled source completion is queue metadata, not proof of audible playback', async () => {
  const f = fixture(); await f.start(); f.audio(); f.media.nodes[0].onended(); await f.client.stop();
  const trace = f.client.evidence().trace;
  assert.ok(trace.some(event => event.type === 'audio.output.node_ended')); assert.ok(trace.some(event => event.type === 'playback.queue_drained'));
  const trial = createEvaluationTrial('ha-greeting_language_preference'); trial.trace = trace;
  assert.ok(analyzeEvaluationTrial(trial).issues.includes('spoken_turn_events_not_observed'));
});
test('scheduled playback is checked for consent, readiness and post-stop violations', () => {
  assert.ok(analyzeTrace([{ type: 'audio.output.scheduled', atMs: 0 }]).violations.includes('capture_or_start_without_reported_consent'));
  const events = [{ type: 'consent.granted', atMs: 0 }, { type: 'start.requested', atMs: 1 }, { type: 'provider.ready', atMs: 2 },
    { type: 'stop.requested', atMs: 3 }, { type: 'audio.output.scheduled', atMs: 4 }];
  assert.ok(analyzeTrace(events).violations.includes('activity_after_stop_or_withdrawal'));
  assert.ok(analyzeTrace(events).missing.includes('playback_queue_clear_not_observed'));
});
test('input sent while microphone is muted is a trace violation; mute is not track termination', () => {
  const events = ['consent.granted', 'start.requested', 'provider.ready', 'microphone.requested', 'microphone.started', 'microphone.paused', 'audio.input.sent']
    .map((type, atMs) => ({ type, atMs }));
  assert.ok(analyzeTrace(events).violations.includes('audio_sent_without_reported_capture'));
  events.splice(-1, 0, { type: 'microphone.resumed', atMs: 6 }); events.at(-1).atMs = 7;
  assert.equal(analyzeTrace(events).violations.includes('audio_sent_without_reported_capture'), false);
});
test('late permission cleanup remains in the original single-use observed session', async () => {
  const f = fixture({ pendingPermission: true }); const starting = f.start();
  await f.client.stop(); const stream = f.media.stream(); f.permission.resolve(stream); await assert.rejects(starting); await flush();
  assert.equal(stream.track.readyState, 'ended'); const report = f.client.evidence();
  assert.ok(report.trace.some(event => event.type === 'microphone.stop_unconfirmed'));
  assert.ok(report.trace.some(event => event.type === 'microphone.stopped'));
  assert.equal(analyzeTrace(report.trace).missing.includes('microphone_release_unconfirmed'), false);
  await assert.rejects(f.client.start(INPUT), { code: 'PCM_OBSERVATION_SESSION_USED' }); assert.equal(f.sockets.length, 1);
  assert.ok(report.trace.every(event => event.sessionRef === 'local-session-1'));
});
test('missing socket close stays unconfirmed with bounded observer cleanup', async () => {
  const f = fixture({ socketClose() {} }); await f.start(); await f.client.stop();
  assert.equal(f.client.evidence().trace.some(event => event.type === 'socket.closed'), false);
  f.fireTimer(3000);
  assert.ok(f.client.evidence().trace.some(event => event.type === 'socket.close_unconfirmed'));
  assert.equal(f.sockets[0].listeners.get('close')?.size || 0, 0); assert.equal(f.timers.size, 0);
});
test('an actual late socket close clears the deadline and is not provider finalization', async () => {
  const f = fixture({ socketClose() {} }); await f.start(); await f.client.stop();
  f.sockets[0].emit('close', {});
  assert.ok(f.client.evidence().trace.some(event => event.type === 'socket.closed'));
  assert.equal(f.client.evidence().trace.some(event => event.type === 'provider.closed'), false);
  assert.equal(f.timers.size, 0);
});
test('observer throw, rejected promise and async return do not break local cleanup', async () => {
  for (const directObserver of [() => { throw new Error('private-observer-error'); }, () => Promise.reject(new Error('private-rejection')), async () => {}]) {
    const f = fixture({ directObserver }); await f.start(); f.media.frame(); f.audio();
    const cleanup = await f.client.stop(); await flush();
    assert.deepEqual(cleanup, { tracksStopped: true, contextsClosed: true });
    assert.equal(f.client.observationStatus(), 'incomplete'); assert.equal(f.timers.size, 0);
  }
});
test('overflow and an invalid observation clock explicitly mark the export incomplete', async () => {
  for (const observation of [{ maxEvents: 2 }, { now: (() => { let calls = 0; return () => ++calls === 1 ? 100 : 0; })() }]) {
    const f = fixture({ observation }); await f.start(); await f.client.stop();
    const report = f.client.evidence(); assert.equal(report.status, 'incomplete');
    assert.equal(report.audiblePlaybackVerified, false); assert.equal(report.activationApproved, false);
    assert.ok(f.media.streams.every(stream => stream.track.readyState === 'ended'));
  }
});
test('repeated stop adds no new session or terminal observations', async () => {
  const f = fixture(); await f.start(); await f.client.stop(); const first = f.client.evidence();
  await f.client.stop(); assert.deepEqual(f.client.evidence(), first);
  assert.equal(first.trace.filter(event => event.type === 'microphone.started').length, 1);
  assert.equal(first.trace.filter(event => event.type === 'microphone.stopped').length, 1);
});
test('local sink disables a failed callback, suppresses raw errors and never enables itself', async () => {
  let calls = 0; const sink = createLocalObservation(() => { calls++; throw new Error('private'); });
  sink.emit('stop.requested'); sink.emit('socket.closed'); assert.equal(calls, 1); assert.equal(sink.status(), 'incomplete');
  const disabled = createLocalObservation(); disabled.emit('stop.requested'); assert.equal(disabled.status(), 'disabled');
  const invalid = createLocalObservation({}); assert.equal(invalid.status(), 'incomplete');
});
test('observer-triggered stop cannot create a socket or request a microphone afterward', async () => {
  for (const type of ['consent.granted', 'start.requested', 'provider.ready', 'microphone.requested', 'microphone.started']) {
    let f; f = fixture({ directObserver(event) { if (event === type) void f.client.stop(); } });
    if (['consent.granted', 'start.requested'].includes(type)) {
      await assert.rejects(f.client.start(INPUT)); assert.equal(f.sockets.length, 0);
    } else await assert.rejects(f.start());
    await flush();
    assert.equal(f.media.requests(), type === 'microphone.started' ? 1 : 0, type);
    assert.ok(f.media.streams.every(stream => stream.track.readyState === 'ended'));
    assert.ok(f.sockets.every(socket => socket.sent.length === 0));
    assert.equal(f.timers.size, 0, type);
  }
});
test('initially muted permission completion does not claim capture until first enable', async () => {
  const f = fixture({ pendingPermission: true }); const started = f.start(); f.client.setMicrophonePaused(true);
  const stream = f.media.stream(); f.permission.resolve(stream); await started;
  assert.equal(stream.track.enabled, false);
  assert.equal(f.client.evidence().trace.some(event => event.type === 'microphone.started'), false);
  f.client.setMicrophonePaused(false); assert.equal(stream.track.enabled, true);
  assert.equal(f.client.evidence().trace.filter(event => event.type === 'microphone.started').length, 1);
  f.client.setMicrophonePaused(true); f.client.setMicrophonePaused(false);
  assert.equal(f.client.evidence().trace.filter(event => event.type === 'microphone.started').length, 1);
  await f.client.stop();
});
test('failed source cleanup remains uncertain across empty clears until context closure confirms it', async () => {
  for (const contextCloses of [true, false]) {
    const f = fixture(); await f.start(); f.audio();
    f.media.nodes[0].stop = () => { throw new Error('fictional stop failure'); };
    if (!contextCloses) f.media.contexts[1].close = async () => { throw new Error('fictional context close failure'); };
    f.client.pauseSpeaker(); f.client.pauseSpeaker();
    const before = f.client.evidence().trace;
    assert.equal(before.some(event => event.type === 'playback.cleared'), false);
    assert.ok(before.filter(event => event.type === 'playback.clear_unconfirmed').length >= 2);
    await f.client.stop(); const trace = f.client.evidence().trace;
    assert.equal(trace.some(event => event.type === 'playback.cleared'), contextCloses);
    assert.equal(analyzeTrace(trace).missing.includes('playback_clear_unconfirmed'), !contextCloses);
  }
});
test('failed or muted output cannot create a successful scheduling observation', async () => {
  const paused = fixture(); await paused.start(); paused.client.pauseSpeaker(); paused.audio();
  assert.equal(paused.client.evidence().trace.some(event => event.type === 'audio.output.scheduled'), false); await paused.client.stop();
  const failed = fixture(); await failed.start();
  failed.media.contexts[1].createBufferSource = () => ({ connect() {}, disconnect() {}, stop() {}, start() { throw new Error('fictional scheduling failure'); } });
  failed.audio(); await flush();
  assert.equal(failed.client.evidence().trace.some(event => event.type === 'audio.output.scheduled'), false); await failed.client.stop();
});
