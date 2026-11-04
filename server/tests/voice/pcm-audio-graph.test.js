'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { createVoicePcmAudioGraph, WORKLET_URL } = require('../../../lib/voice/pcmAudioGraph.cjs');
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { resolve, promise }; };
const flush = () => new Promise(resolve => setImmediate(resolve));
function fixture(extra = {}) {
  let at = 1000; const timers = new Map(); let timerId = 0; const contexts = [], inputs = [], states = [], nodes = [];
  const listeners = new Set(); let frameSequence = 0; const track = { kind: 'audio', enabled: true, readyState: 'live', stops: 0,
    stop() { this.stops++; this.readyState = 'ended'; }, addEventListener(_name, cb) { listeners.add(cb); }, removeEventListener(_name, cb) { listeners.delete(cb); } };
  const stream = { getAudioTracks: () => [track], getTracks: () => [track] };
  const worklet = { connect() {}, disconnect() { this.disconnected = true; }, port: { sent: [], postMessage(value) { this.sent.push(value); }, onmessage: null } };
  function createContext(options) {
    const context = { sampleRate: options.sampleRate, state: 'suspended', destination: {}, currentTime: 0, closes: 0, resumes: 0,
      audioWorklet: { async addModule(url) { assert.equal(url, WORKLET_URL); if (extra.moduleWait) await extra.moduleWait.promise; } },
      async resume() { this.resumes++; if (this.waitResume) await this.waitResume.promise; if (this.state !== 'closed') this.state = 'running'; }, async close() { this.closes++; this.state = 'closed'; if (this.waitClose) await this.waitClose.promise; },
      createMediaStreamSource(value) { assert.equal(value, stream); return { connect() {}, disconnect() {} }; },
      createBuffer(channels, frames, sampleRate) { assert.equal(channels, 1); assert.equal(sampleRate, 24000); const samples = new Float32Array(frames); return { getChannelData: () => samples }; },
      createBufferSource() { const node = { stops: 0, connect() {}, disconnect() {}, start(at) { this.at = at; }, stop() { this.stops++; }, onended: null }; nodes.push(node); return node; },
    }; contexts.push(context); return context;
  }
  const graph = createVoicePcmAudioGraph({ stream, createContext, createWorkletNode: () => worklet, expiresAt: 181000, now: () => at,
    setTimer(fn, ms) { const id = ++timerId; timers.set(id, { fn, ms }); return id; }, clearTimer(id) { timers.delete(id); },
    onInputPcm: bytes => inputs.push(bytes), onState: state => states.push(state), ...extra.options });
  return { graph, track, worklet, contexts, nodes, inputs, states, timers, advance: ms => { at += ms; },
    frame(data = { type: 'pcm16', buffer: new ArrayBuffer(3200), epoch: graph.status().captureEpoch }) { worklet.port.onmessage?.({ data: { sequence: ++frameSequence, ...data } }); },
    ended() { track.readyState = 'ended'; for (const cb of [...listeners]) cb(); },
    fire(ms) { const value = [...timers.values()].find(item => item.ms === ms); assert.ok(value); value.fn(); } };
}
test('owned native Web Audio-shaped pipeline starts muted and requires explicit capture enable', async () => {
  const f = fixture(); assert.equal(f.track.enabled, false); await f.graph.start();
  assert.deepEqual(f.contexts.map(context => context.sampleRate), [16000, 24000]);
  f.frame(); assert.equal(f.inputs.length, 0); f.graph.setCaptureEnabled(true); f.frame(); assert.equal(f.inputs.length, 1);
  assert.equal(f.inputs[0].byteLength, 3200); f.graph.setCaptureEnabled(false); f.frame(); assert.equal(f.inputs.length, 1);
  assert.deepEqual(await f.graph.stop(), { tracksStopped: true, contextsClosed: true });
});
test('no microphone request, provider route or external worklet is supplied by this unmounted module', () => {
  const source = fs.readFileSync(require.resolve('../../../lib/voice/pcmAudioGraph.cjs'), 'utf8');
  assert.doesNotMatch(source, /navigator\.|fetch\(|WebSocket|https?:\/\/|process\.env/);
  assert.equal(WORKLET_URL, '/voice/pcm-capture-worklet.js');
  assert.throws(() => createVoicePcmAudioGraph(), { code: 'PCM_AUDIO_NOT_AUTHORIZED' });
});
test('24 kHz little-endian output is decoded and interruption stops every queued source', async () => {
  const f = fixture(); await f.graph.start();
  const bytes = new Uint8Array([0, 128, 255, 127]); assert.equal(f.graph.enqueuePcm(bytes, 0), true);
  assert.deepEqual([...f.nodes[0].buffer.getChannelData(0)], [-1, 32767 / 32768]);
  f.graph.clearPlayback(1); assert.equal(f.nodes[0].stops, 1); assert.equal(f.graph.enqueuePcm(bytes, 0), false);
  assert.equal(f.graph.enqueuePcm(bytes, 1), true); await f.graph.stop();
});
test('failed interruption or speaker mute ends the graph before another audio turn can play', async () => {
  for (const action of ['interrupt', 'mute']) for (const failure of ['stop', 'disconnect', 'both']) {
    const f = fixture(); await f.graph.start(); f.graph.setCaptureEnabled(true);
    assert.equal(f.graph.enqueuePcm(new Uint8Array(480), 0), true);
    if (failure !== 'disconnect') f.nodes[0].stop = () => { throw new Error('Fictional playback stop failure'); };
    if (failure !== 'stop') f.nodes[0].disconnect = () => { throw new Error('Fictional playback disconnect failure'); };
    if (action === 'interrupt') f.graph.clearPlayback(1); else f.graph.pausePlayback();
    assert.equal(f.graph.status().phase, 'closed', `${action}/${failure}`);
    assert.equal(f.track.readyState, 'ended'); assert.equal(f.track.enabled, false);
    assert.equal(f.graph.enqueuePcm(new Uint8Array(480), 1), false); assert.equal(f.nodes.length, 1);
    assert.equal(f.states.some(state => state.reason === 'playback_clear_failed'), true);
    assert.deepEqual(await f.graph.stop(), { tracksStopped: true, contextsClosed: true });
    assert.equal(f.contexts.every(context => context.closes === 1), true);
  }
});
test('explicit speaker mute survives late media and a delayed Resume resolution', async () => {
  const f = fixture(); await f.graph.start(); f.graph.pausePlayback(); assert.equal(f.graph.enqueuePcm(new Uint8Array(10), 0), false);
  const pending = deferred(); f.contexts[1].waitResume = pending; const resuming = f.graph.resumePlayback(); f.graph.pausePlayback(); pending.resolve();
  assert.equal(await resuming, false); assert.equal(f.graph.status().speakerPaused, true); assert.equal(f.graph.enqueuePcm(new Uint8Array(10), 0), false);
  f.contexts[1].waitResume = null; assert.equal(await f.graph.resumePlayback(), true); assert.equal(f.graph.enqueuePcm(new Uint8Array(10), 0), true); await f.graph.stop();
});
test('stop while local worklet loads cannot later connect or restart capture', async () => {
  const wait = deferred(), f = fixture({ moduleWait: wait }); const starting = f.graph.start(); await flush(); const stopped = f.graph.stop(); wait.resolve();
  await assert.rejects(starting, { code: 'PCM_AUDIO_STOPPED' }); assert.equal((await stopped).tracksStopped, true);
  assert.equal(f.worklet.port.onmessage, null); assert.equal(f.contexts.every(context => context.closes === 1), true); assert.equal(f.track.enabled, false);
});
test('device loss and lease expiry stop tracks immediately and suppress late input', async () => {
  for (const action of ['device', 'expiry']) { const f = fixture(); await f.graph.start(); f.graph.setCaptureEnabled(true);
    if (action === 'device') f.ended(); else { f.advance(180000); f.frame(); }
    assert.equal(f.track.readyState, 'ended'); assert.equal(f.track.enabled, false); assert.equal(f.graph.status().phase, 'closed'); f.frame(); assert.equal(f.inputs.length, 0); await f.graph.stop(); }
});
test('invalid frames and slow/failed input sinks fail closed instead of buffering indefinitely', async () => {
  for (const options of [{}, { onInputPcm() { throw new Error('private'); } }, { onInputPcm: async () => { throw new Error('private'); } }]) {
    const f = fixture({ options }); await f.graph.start(); f.graph.setCaptureEnabled(true);
    f.frame(Object.keys(options).length ? undefined : { type: 'pcm16', buffer: new ArrayBuffer(3202), epoch: f.graph.status().captureEpoch });
    assert.equal(f.graph.status().phase, 'closed'); assert.equal(f.track.readyState, 'ended'); await f.graph.stop();
  }
});
test('bounded playback queue stops rather than accumulating stale conversation', async () => {
  const f = fixture(); await f.graph.start(); const bytes = new Uint8Array(48000);
  assert.equal(f.graph.enqueuePcm(bytes, 0), true); assert.equal(f.graph.enqueuePcm(bytes, 0), false);
  assert.equal(f.graph.status().phase, 'closed'); assert.equal(f.nodes[0].stops, 1); await f.graph.stop();
});
test('one graph cleanup cannot affect a new graph or its playback', async () => {
  const a = fixture(), b = fixture(); await a.graph.start(); await b.graph.start(); b.graph.enqueuePcm(new Uint8Array(480), 0);
  await a.graph.stop(); a.ended(); assert.equal(b.graph.status().phase, 'ready'); assert.equal(b.nodes[0].stops, 0); await b.graph.stop();
});
test('close timeout reports unconfirmed context closure while tracks are already stopped', async () => {
  const f = fixture(); await f.graph.start(); f.contexts[0].waitClose = deferred(); const stopping = f.graph.stop(); await flush(); f.fire(1500);
  assert.deepEqual(await stopping, { tracksStopped: true, contextsClosed: false }); f.contexts[0].waitClose.resolve();
});
function workletFixture(rate = 16000) {
  let Processor; const sent = [];
  class FakeProcessor { constructor() { this.port = { postMessage: value => sent.push(value), onmessage: null }; } }
  vm.runInNewContext(fs.readFileSync(require.resolve('../../../public/voice/pcm-capture-worklet.js'), 'utf8'), {
    AudioWorkletProcessor: FakeProcessor, sampleRate: rate, registerProcessor(name, value) { assert.equal(name, 'doctarx-pcm16-capture'); Processor = value; }, ArrayBuffer, DataView, Int16Array,
  });
  const processor = new Processor(); let epoch = 0; return { processor, sent, control: data => processor.port.onmessage({ data: { epoch: data.type === 'capture' ? ++epoch : epoch, ...data } }) };
}
test('actual worklet source emits bounded mono PCM16LE frames and no local sidetone', () => {
  const f = workletFixture(), input = [new Float32Array(1600).fill(1), new Float32Array(1600).fill(-1)], output = [[new Float32Array(1600).fill(1)]];
  f.processor.process([input], output); assert.equal(f.sent.length, 0); f.control({ type: 'capture', enabled: true });
  f.processor.process([input], output); assert.equal(f.sent[0].buffer.byteLength, 3200); assert.equal(new DataView(f.sent[0].buffer).getInt16(0, true), 0);
  assert.equal(output[0][0].every(value => value === 0), true);
  f.processor.process([[new Float32Array(1600).fill(-2)]], output); assert.equal(new DataView(f.sent[1].buffer).getInt16(0, true), -32768);
});
test('worklet mute/stop discard partial frames and incompatible sample rates fail closed', () => {
  const f = workletFixture(); f.control({ type: 'capture', enabled: true }); f.processor.process([[new Float32Array(800)]], []);
  f.control({ type: 'capture', enabled: false }); f.control({ type: 'capture', enabled: true }); f.processor.process([[new Float32Array(800)]], []); assert.equal(f.sent.length, 0);
  f.control({ type: 'stop' }); assert.equal(f.processor.process([[new Float32Array(1600)]], []), false); assert.equal(f.sent.length, 0);
  const other = workletFixture(48000); assert.equal(other.sent[0].code, 'PCM_CAPTURE_RATE_UNSUPPORTED'); assert.equal(other.processor.process([], []), false);
});

test('old capture frames cannot cross a mute and resume boundary', async () => {
  const f = fixture(); await f.graph.start(); f.graph.setCaptureEnabled(true); const oldEpoch = f.graph.status().captureEpoch;
  f.graph.setCaptureEnabled(false); f.graph.setCaptureEnabled(true);
  f.frame({ type: 'pcm16', buffer: new ArrayBuffer(3200), epoch: oldEpoch }); assert.equal(f.inputs.length, 0);
  f.frame(); assert.equal(f.inputs.length, 1); await f.graph.stop();
});
test('processor failure or a suspended context terminates capture instead of waiting for lease expiry', async () => {
  for (const reason of ['processor', 'context']) {
    const f = fixture(); await f.graph.start(); f.graph.setCaptureEnabled(true);
    if (reason === 'processor') f.worklet.onprocessorerror(); else { f.contexts[0].state = 'suspended'; f.contexts[0].onstatechange(); }
    assert.equal(f.graph.status().phase, 'closed'); assert.equal(f.track.readyState, 'ended'); await f.graph.stop();
  }
});

test('speaker pause during startup survives the delayed output resume', async () => {
  const wait = deferred(), f = fixture({ moduleWait: wait }); const starting = f.graph.start();
  f.contexts[1].waitResume = deferred(); wait.resolve(); await flush(); f.graph.pausePlayback(); f.contexts[1].waitResume.resolve();
  await starting; assert.equal(f.graph.status().speakerPaused, true); assert.equal(f.graph.enqueuePcm(new Uint8Array(480), 0), false); await f.graph.stop();
});
test('capture byte budget is bounded even if a worklet produces frames faster than real time', async () => {
  const f = fixture(); await f.graph.start(); f.graph.setCaptureEnabled(true);
  for (let i = 0; i < 1801; i++) f.frame();
  assert.equal(f.inputs.length, 1800); assert.equal(f.graph.status().phase, 'closed'); await f.graph.stop();
});
test('failed track stop is not reported as verified microphone release', async () => {
  const f = fixture(); await f.graph.start(); f.track.stop = () => { throw new Error('device unavailable'); };
  const result = await f.graph.stop(); assert.equal(f.track.enabled, false); assert.equal(result.tracksStopped, false); assert.equal(result.contextsClosed, true);
});

test('worklet bounds outstanding messages when the main thread never consumes them', () => {
  const f = workletFixture(); f.control({ type: 'capture', enabled: true });
  for (let i = 0; i < 2001; i++) f.processor.process([[new Float32Array(1600)]], []);
  assert.equal(f.sent.filter(item => item.type === 'pcm16').length, 4);
  assert.equal(f.sent.at(-1).code, 'PCM_CAPTURE_CONSUMER_STALLED');
  assert.equal(f.processor.process([], []), false);
});
test('worklet has an independent cumulative cap even across capture generations', () => {
  const f = workletFixture(); f.control({ type: 'capture', enabled: true });
  for (let i = 0; i < 1800; i++) {
    assert.equal(f.processor.process([[new Float32Array(1600)]], []), true);
    const frame = f.sent.at(-1); f.control({ type: 'ack', epoch: frame.epoch, sequence: frame.sequence });
    if (i === 900) { f.control({ type: 'capture', enabled: false }); f.control({ type: 'capture', enabled: true }); }
  }
  assert.equal(f.processor.process([[new Float32Array(1600)]], []), false);
  assert.equal(f.sent.filter(item => item.type === 'pcm16').length, 1800);
  assert.equal(f.sent.at(-1).code, 'PCM_CAPTURE_DURATION_LIMIT');
});
test('mute/resume and wrong acknowledgements cannot discard outstanding-frame accounting', () => {
  const f = workletFixture(); f.control({ type: 'capture', enabled: true });
  f.processor.process([[new Float32Array(1600)]], []); const first = f.sent[0];
  f.control({ type: 'capture', enabled: false }); f.control({ type: 'capture', enabled: true });
  f.control({ type: 'ack', sequence: first.sequence }); assert.equal(f.processor.outstanding.size, 1);
  f.control({ type: 'ack', sequence: first.sequence, epoch: first.epoch }); assert.equal(f.processor.outstanding.size, 0);
  f.control({ type: 'capture', enabled: false, epoch: first.epoch }); assert.equal(f.processor.enabled, true);
  for (let i = 0; i < 5; i++) f.processor.process([[new Float32Array(1600)]], []);
  assert.equal(f.sent.at(-1).code, 'PCM_CAPTURE_CONSUMER_STALLED');
});
test('main graph acknowledges only handled frames and rejects replayed frame sequences', async () => {
  const f = fixture(); await f.graph.start(); f.graph.setCaptureEnabled(true); f.frame();
  assert.deepEqual(f.worklet.port.sent.at(-1), { type: 'ack', epoch: 1, sequence: 1 });
  f.graph.setCaptureEnabled(false); f.frame({ type: 'pcm16', buffer: new ArrayBuffer(3200), epoch: 1, sequence: 2 });
  assert.deepEqual(f.worklet.port.sent.at(-1), { type: 'ack', epoch: 1, sequence: 2 }); assert.equal(f.inputs.length, 1);
  f.frame({ type: 'pcm16', buffer: new ArrayBuffer(3200), epoch: 1, sequence: 2 });
  assert.equal(f.graph.status().phase, 'closed'); await f.graph.stop();
});
test('mixed audio/video streams are rejected before acquiring media ownership', () => {
  const audio = { kind: 'audio', readyState: 'live', stop() {} }, video = { kind: 'video', readyState: 'live' };
  assert.throws(() => fixture({ options: { stream: { getAudioTracks: () => [audio], getTracks: () => [audio, video] } } }), { code: 'PCM_AUDIO_NOT_AUTHORIZED' });
});

test('reentrant terminal callbacks receive the same final graph cleanup receipt', async () => {
  for (const callback of ['state', 'observation']) {
    let f, nested;
    f = fixture({ options: callback === 'state'
      ? { onState(state) { if (state.phase === 'closed') nested = f.graph.stop(); } }
      : { onObservation(type) { if (type === 'playback.cleared') nested = f.graph.stop(); } } });
    await f.graph.start(); const stopping = f.graph.stop();
    assert.equal(nested, stopping, callback);
    assert.deepEqual(await nested, { tracksStopped: true, contextsClosed: true }, callback);
    assert.equal(f.contexts.every(context => context.closes === 1), true);
  }
});
