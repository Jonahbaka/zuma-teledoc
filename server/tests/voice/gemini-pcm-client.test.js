'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs');
const { GEMINI_LIVE_LANGUAGE_CATALOG } = require('../../../shared/voiceLanguageCatalog.cjs');
const { createGeminiPcmSession } = require('../../../lib/voice/geminiPcmSession.cjs');
const { browser, deferred, FakeSocket } = require('./helpers/pcmBrowser.cjs');
const flush = () => new Promise(resolve => setImmediate(resolve));
const identity = { actorId: 'fictional-browser-evaluator', sessionBinding: 'a'.repeat(64) };
const options = language => ({ language, consentAcknowledged: true, consentVersion: 'voice-live-synthetic-v1', expectedActorId: identity.actorId, expectedSessionBinding: identity.sessionBinding });
const permit = language => ({ type: 'session.ready', provider: 'google', model: 'gemini-3.8-live', language, dataClass: 'synthetic', consentVersion: 'voice-live-synthetic-v1', sessionId: 'fictional-session', expiresAt: 181000, ...identity });
function fixture(extra = {}) {
  const media = browser(extra), states = [], transcripts = [], errors = [], sockets = [], timers = new Map(); let at = 1000, nextId = 0;
  const client = createGeminiPcmSession({ origin: 'https://fictional.example', ...media, now: () => at,
    setTimer(fn, ms) { const id = ++nextId; timers.set(id, { fn, ms }); return id; }, clearTimer(id) { timers.delete(id); },
    createSocket(url) { const socket = new FakeSocket(url); sockets.push(socket); return socket; },
    onState: value => states.push(value), onTranscript: value => transcripts.push(value), onError: value => errors.push(value), ...extra.options });
  async function start(language = 'ha') { const starting = client.start(options(language)); const socket = sockets.at(-1); socket.open(); socket.message(permit(language)); await starting; return socket; }
  return { ...media, client, sockets, states, transcripts, errors, timers, start, advance(ms) { at += ms; }, fire(ms) { const timer = [...timers.values()].find(value => value.ms === ms); assert.ok(timer); timer.fn(); } };
}
test('browser controller requires consent and trusted server permit before requesting fictional microphone', async () => {
  const f = fixture(); await assert.rejects(f.client.start(options('zz')), { code: 'PCM_CONSENT_REQUIRED' });
  await assert.rejects(f.client.start({ language: 'ha', consentAcknowledged: false }), { code: 'PCM_CONSENT_REQUIRED' });
  assert.equal(f.sockets.length, 0); const starting = f.client.start(options('ha')); assert.equal(f.requests(), 0);
  const socket = f.sockets[0]; socket.open(); assert.equal(f.requests(), 0); assert.equal(new URL(socket.url).protocol, 'wss:');
  socket.message(permit('ha')); await starting; assert.equal(f.requests(), 1); assert.equal(f.streams[0].track.enabled, true);
  assert.deepEqual(socket.sent, [{ type: 'greeting', sequence: 1 }]); await f.client.stop();
});
test('every catalog code carries synthetic PCM and independently marked provisional transcripts', async () => {
  for (const { code: language } of GEMINI_LIVE_LANGUAGE_CATALOG) {
    const f = fixture(), socket = await f.start(language); f.frame(); assert.equal(socket.sent[1].type, 'audio.pcm'); assert.equal(Buffer.from(socket.sent[1].data, 'base64').length, 3200);
    socket.message({ type: 'transcript', speaker: 'assistant', text: 'Fictional fixture' });
    assert.deepEqual(f.transcripts, [{ speaker: 'assistant', text: 'Fictional fixture', language, provisional: true, clinicalReviewed: false }]);
    socket.message({ type: 'audio.pcm', data: Buffer.alloc(480).toString('base64'), sampleRate: 24000, playbackEpoch: 0 }); assert.equal(f.nodes.length, 1);
    socket.message({ type: 'playback.clear', playbackEpoch: 1 }); assert.equal(f.nodes[0].stops, 1); await f.client.stop();
  }
});
test('wrong provider, language, consent or expired permits cannot acquire a microphone', async () => {
  for (const change of [{ provider: 'other' }, { model: 'other' }, { language: 'yo' }, { dataClass: 'patient' }, { consentVersion: 'other' }, { expiresAt: 1000 }, { expiresAt: 181001 }, { actorId: 'another-evaluator' }, { sessionBinding: 'b'.repeat(64) }]) {
    const f = fixture(), starting = f.client.start(options('ha')), socket = f.sockets[0]; socket.open(); socket.message({ ...permit('ha'), ...change });
    await assert.rejects(starting, { code: 'PCM_SERVER_PERMIT_INVALID' }); assert.equal(f.requests(), 0); assert.equal(socket.readyState, 3);
  }
});
test('stale microphone permission completion cannot replace or stop a newer session', async () => {
  const pending = deferred(); let calls = 0; let f;
  f = fixture({ getUserMedia: () => ++calls === 1 ? pending.promise : Promise.resolve(f.stream()) });
  const old = f.client.start(options('ha')); f.sockets[0].open(); f.sockets[0].message(permit('ha')); await f.client.stop(); await assert.rejects(old);
  await f.start('yo'); const currentTrack = f.streams[0].track, staleStream = f.stream(); pending.resolve(staleStream); await flush();
  assert.equal(staleStream.track.readyState, 'ended'); assert.equal(currentTrack.enabled, true); assert.equal(f.sockets[1].readyState, 1); await f.client.stop();
});
test('throwing state sink terminates once without recursive notifications', async () => {
  let callbacks = 0; const f = fixture({ options: { onState() { callbacks++; throw new Error('fictional sink error'); } } });
  await assert.rejects(f.client.start(options('ha'))); assert.equal(callbacks, 1); assert.equal(f.requests(), 0); assert.equal(f.sockets[0].readyState, 3); await f.client.stop(); assert.equal(callbacks, 1);
  await assert.rejects(f.client.start(options('yo')), { code: 'PCM_STATE_SINK_FAILED' }); assert.equal(f.sockets.length, 1);
});
test('Stop from microphone-request state prevents even a new permission request', async () => {
  let f; f = fixture({ options: { onState(value) { if (value === 'requesting_microphone') void f.client.stop(); } } });
  const starting = f.client.start(options('ha')); f.sockets[0].open(); f.sockets[0].message(permit('ha')); await assert.rejects(starting);
  assert.equal(f.requests(), 0);
});
test('Stop during worklet module loading releases tracks and cannot later enable capture', async () => {
  const wait = deferred(), f = fixture({ moduleWait: wait }), starting = f.client.start(options('ha')); f.sockets[0].open(); f.sockets[0].message(permit('ha')); await flush();
  await f.client.stop(); wait.resolve(); await assert.rejects(starting); await flush(); assert.equal(f.streams[0].track.readyState, 'ended'); assert.equal(f.sockets[0].sent.length, 0);
});
test('setup timeout and page hiding release owned media, including late permission results', async () => {
  for (const action of ['timeout', 'hidden', 'pagehide']) {
    const wait = deferred(), f = fixture({ getUserMedia: () => wait.promise }), starting = f.client.start(options('ha')); f.sockets[0].open(); f.sockets[0].message(permit('ha'));
    if (action === 'timeout') f.fire(15000); else if (action === 'hidden') { f.documentTarget.visibilityState = 'hidden'; f.documentTarget.emit('visibilitychange'); } else f.pageTarget.emit('pagehide');
    await assert.rejects(starting); const stream = f.stream(); wait.resolve(stream); await flush(); assert.equal(stream.track.readyState, 'ended'); assert.equal(f.sockets[0].readyState, 3);
  }
});
test('expired or disconnected sessions stop both local capture and queued audio', async () => {
  for (const action of ['expiry', 'close', 'error']) { const f = fixture(), socket = await f.start(); socket.message({ type: 'audio.pcm', data: Buffer.alloc(480).toString('base64'), sampleRate: 24000, playbackEpoch: 0 });
    if (action === 'expiry') { f.advance(180000); f.fire(180000); } else socket.emit(action);
    assert.equal(f.streams[0].track.readyState, 'ended'); assert.equal(f.nodes[0].stops, 1); await flush();
  }
});
test('an owned graph detecting permit expiry closes its session before the separate timer runs', async () => {
  const f = fixture(), socket = await f.start(); f.advance(180000); f.frame();
  assert.equal(f.states.at(-1), 'failed'); assert.equal(socket.readyState, 3);
  assert.equal(f.streams[0].track.readyState, 'ended');
  assert.deepEqual(await f.client.stop(), { tracksStopped: true, contextsClosed: true });
});
test('microphone pause suppresses capture and sends end marker without restarting old frames', async () => {
  const f = fixture(), socket = await f.start(); f.client.setMicrophonePaused(true); f.frame(); assert.deepEqual(socket.sent.at(-1), { type: 'capture.end', sequence: 2 }); assert.equal(f.streams[0].track.enabled, false);
  f.client.setMicrophonePaused(false); f.frame(); assert.equal(socket.sent.at(-1).type, 'audio.pcm'); await f.client.stop();
});
test('speaker pause persists across late playback and a delayed resume', async () => {
  const f = fixture(), socket = await f.start(), audio = { type: 'audio.pcm', data: Buffer.alloc(480).toString('base64'), sampleRate: 24000, playbackEpoch: 0 };
  f.client.pauseSpeaker(); socket.message(audio); assert.equal(f.nodes.length, 0);
  const wait = deferred(); f.contexts[1].waitResume = wait; const resume = f.client.resumeSpeaker(); f.client.pauseSpeaker(); wait.resolve(); assert.equal(await resume, false); socket.message(audio); assert.equal(f.nodes.length, 0);
  f.contexts[1].waitResume = null; assert.equal(await f.client.resumeSpeaker(), true); socket.message(audio); assert.equal(f.nodes.length, 1); await f.client.stop();
});
test('failed speaker interruption closes the actual PCM session and retains uncertain context cleanup', async () => {
  for (const action of ['interrupt', 'mute']) {
    const f = fixture(), socket = await f.start(), audio = { type: 'audio.pcm', data: Buffer.alloc(480).toString('base64'), sampleRate: 24000, playbackEpoch: 0 };
    socket.message(audio);
    f.nodes[0].stop = () => { throw new Error('Fictional playback stop failure'); };
    f.nodes[0].disconnect = () => { throw new Error('Fictional playback disconnect failure'); };
    f.contexts[1].close = async () => { throw new Error('Fictional context close failure'); };
    if (action === 'interrupt') socket.message({ type: 'playback.clear', playbackEpoch: 1 }); else f.client.pauseSpeaker();
    assert.equal(f.states.at(-1), 'failed', action); assert.equal(socket.readyState, 3);
    assert.equal(f.streams[0].track.readyState, 'ended');
    socket.message({ ...audio, playbackEpoch: 1 }); assert.equal(f.nodes.length, 1);
    assert.deepEqual(await f.client.stop(), { tracksStopped: true, contextsClosed: false });
  }
});
test('slow socket output fails closed instead of buffering microphone audio', async () => {
  const f = fixture(), socket = await f.start(); socket.bufferedAmount = 17000; f.frame(); assert.equal(f.streams[0].track.readyState, 'ended'); assert.equal(socket.readyState, 3);
});
test('malformed, early, duplicated permit and stale-generation events fail closed', async () => {
  for (const event of [{ type: 'audio.pcm', data: 'invalid', sampleRate: 24000, playbackEpoch: 0 }, { type: 'playback.clear', playbackEpoch: -1 }, { type: 'transcript', speaker: 'tool', text: 'fictional' }, permit('ha'), { type: 'tools' }]) {
    const f = fixture(), socket = await f.start(); socket.message(event); assert.equal(socket.readyState, 3); assert.equal(f.streams[0].track.readyState, 'ended');
  }
  const f = fixture(), starting = f.client.start(options('ha')); f.sockets[0].open(); f.sockets[0].message({ type: 'turn.complete' }); await assert.rejects(starting); assert.equal(f.requests(), 0);
});
test('hidden pages and overlapping starts never authorize a second socket', async () => {
  const f = fixture(); f.documentTarget.visibilityState = 'hidden'; await assert.rejects(f.client.start(options('ha')), { code: 'PCM_PAGE_HIDDEN' }); assert.equal(f.sockets.length, 0);
  f.documentTarget.visibilityState = 'visible'; const first = f.client.start(options('ha')); await assert.rejects(f.client.start(options('ig')), { code: 'PCM_SESSION_EXISTS' }); assert.equal(f.sockets.length, 1); await f.client.stop(); await assert.rejects(first);
});
test('controller and upgrade remain unmounted and no credentials are added to browser URLs', () => {
  const client = fs.readFileSync(require.resolve('../../../lib/voice/geminiPcmSession.cjs'), 'utf8');
  const index = fs.readFileSync(require.resolve('../../index'), 'utf8');
  assert.doesNotMatch(client, /localStorage|sessionStorage|apiKey|process\.env|Bearer/); assert.doesNotMatch(index, /createGeminiPcmUpgrade|geminiPcmUpgrade/);
});

test('automatic failures preserve the actual cleanup receipt for later and repeated Stop', async () => {
  for (const action of ['socket', 'processor']) {
    const f = fixture(), socket = await f.start();
    f.streams[0].track.stop = () => { throw new Error('Fictional track failure'); };
    f.contexts[1].close = async () => { throw new Error('Fictional context failure'); };
    if (action === 'socket') socket.emit('error'); else f.worklets[0].onprocessorerror();
    assert.equal(f.states.at(-1), 'failed');
    assert.deepEqual(await f.client.stop(), { tracksStopped: false, contextsClosed: false }, action);
    assert.deepEqual(await f.client.stop(), { tracksStopped: false, contextsClosed: false }, action);
  }
});

test('automatic stop during pending microphone permission retains pending-release evidence', async () => {
  const wait = deferred(), f = fixture({ getUserMedia: () => wait.promise });
  const starting = f.client.start(options('ha')); f.sockets[0].open(); f.sockets[0].message(permit('ha'));
  f.sockets[0].emit('error'); await assert.rejects(starting);
  assert.deepEqual(await f.client.stop(), { tracksStopped: false, contextsClosed: true, permissionPending: true });
  const late = f.stream(); wait.resolve(late); await flush(); assert.equal(late.track.readyState, 'ended');
});

test('reentrant Stop from teardown observation retains the same uncertain receipt', async () => {
  for (const event of ['stop.requested', 'socket.close_requested']) {
    let f, nested;
    f = fixture({ options: { onObservation(type) { if (type === event) nested = f.client.stop(); } } });
    await f.start(); f.streams[0].track.stop = () => { throw new Error('Fictional track failure'); };
    const stopping = f.client.stop();
    assert.deepEqual(await nested, { tracksStopped: false, contextsClosed: true }, event);
    assert.deepEqual(await stopping, { tracksStopped: false, contextsClosed: true }, event);
  }
});

test('automatic graph failure confirms context cleanup only after the actual close completes', async () => {
  const f = fixture(); await f.start(); const pending = deferred();
  f.contexts[1].close = async () => { await pending.promise; f.contexts[1].state = 'closed'; };
  f.worklets[0].onprocessorerror();
  let settled = false; const stopping = f.client.stop().then(receipt => { settled = true; return receipt; });
  await flush(); assert.equal(settled, false);
  pending.resolve(); assert.deepEqual(await stopping, { tracksStopped: true, contextsClosed: true });
});
