'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs');
const { createLocalDemoController, canReplaceDemoController } = require('../../../scripts/voice-local-demo/controller.cjs');
const { createGeneratedSource } = require('../../../scripts/voice-local-demo/generatedSource.cjs');
const { createSimulatedSocket, toneBase64, IDENTITY, NOTICE, ORIGIN } = require('../../../scripts/voice-local-demo/simulation.cjs');
const { GEMINI_LIVE_LANGUAGE_CATALOG } = require('../../../shared/voiceLanguageCatalog.cjs');
const { browser, deferred } = require('./helpers/pcmBrowser.cjs');
const flush = () => new Promise(resolve => setImmediate(resolve));
function fixture(t, { language = 'ha', pendingSource = false, failedSourceClose = false, pendingSourceClose = false } = {}) {
  const media = browser(), snapshots = [], oscillatorNodes = [], sourceWait = pendingSource ? deferred() : null, closeWait = pendingSourceClose ? deferred() : null;
  let contexts = 0, at = 1000;
  function createContext(options) {
    const context = media.createContext(options); const index = contexts++;
    if (index === 0 && sourceWait) context.waitResume = sourceWait;
    if (index === 0 && failedSourceClose) context.close = async () => { throw new Error('private failure'); };
    if (index === 0 && closeWait) context.close = async () => { context.state = 'closed'; await closeWait.promise; };
    context.createMediaStreamDestination = () => ({ stream: media.stream() });
    context.createOscillator = () => {
      const node = { frequency: { value: 0 }, stops: 0, connections: [], connect(value) { this.connections.push(value); }, disconnect() {}, start() {}, stop() { this.stops++; } };
      oscillatorNodes.push(node); return node;
    };
    context.createGain = () => ({ gain: { value: 0 }, connect(value) { assert.notEqual(value, context.destination); }, disconnect() {} });
    return context;
  }
  const controller = createLocalDemoController({ language, createContext, createWorkletNode: media.createWorkletNode, pageTarget: media.pageTarget, documentTarget: media.documentTarget, now: () => at, onChange: value => snapshots.push(value) });
  t.after(async () => { sourceWait?.resolve(); closeWait?.resolve(); await controller.dispose(); });
  async function start() { await controller.load(); controller.setConsent(true); return controller.start(); }
  return { controller, media, snapshots, start, oscillatorNodes, sourceWait, closeWait, advance(ms) { at += ms; } };
}
test('all catalog codes traverse the actual controllers with injected generated-source and provider objects', async t => {
  for (const { code } of GEMINI_LIVE_LANGUAGE_CATALOG) {
    const f = fixture(t, { language: code }); assert.equal(await f.start(), true, code);
    assert.deepEqual(f.media.contexts.map(context => context.sampleRate), [16000, 16000, 24000]);
    for (let i = 0; i < 5; i++) f.media.frame();
    const evidence = f.controller.evidence(); assert.equal(evidence.metrics.generatedInputFrames, 5); assert.equal(evidence.metrics.outputToneAttempts, 2);
    for (const field of ['realProvider', 'realMicrophone', 'speechOrTranslation', 'audiblePlaybackVerified', 'languageQualityValidated', 'clinicalUse', 'activationApproved']) assert.equal(evidence[field], false, field);
    assert.equal(evidence.language, code); assert.equal(f.media.requests(), 0);
    assert.equal(f.controller.snapshot().captions.every(item => /No speech|No microphone/.test(item.text)), true);
    assert.deepEqual(await f.controller.stop(), { tracksStopped: true, contextsClosed: true });
    assert.equal(f.media.contexts.every(context => context.state === 'closed'), true);
    assert.equal(f.oscillatorNodes[0].stops, 1); assert.equal(f.controller.evidence().generatedSourceCleanup.contextsClosed, true);
    await f.controller.dispose();
  }
});
test('acknowledgment, duplicate start, interruption, input pause and output pause remain independent', async t => {
  const f = fixture(t); await f.controller.load(); assert.equal(await f.controller.start(), false); assert.equal(f.media.contexts.length, 0);
  f.controller.setConsent(true); const starting = f.controller.start(); assert.equal(await f.controller.start(), false); assert.equal(await starting, true);
  f.controller.setMicrophonePaused(true); f.media.frame(); assert.equal(f.controller.evidence().metrics.generatedInputFrames, 0);
  f.controller.setMicrophonePaused(false); f.media.frame(); assert.equal(f.controller.evidence().metrics.generatedInputFrames, 1);
  f.controller.interrupt(); assert.equal(f.media.nodes.every(node => node.stops === 1), true);
  f.controller.pauseSpeaker(); const count = f.media.nodes.length; f.controller.reply(); assert.equal(f.media.nodes.length, count);
  assert.equal(await f.controller.resumeSpeaker(), true); f.controller.reply(); assert.equal(f.media.nodes.length, count + 1);
  await f.controller.stop(); assert.equal(f.controller.reply(), false); assert.equal(f.controller.interrupt(), false);
  assert.equal(f.controller.snapshot().captions.length, 0); assert.equal(await f.controller.start(), false);
});
test('Stop during generated-source startup closes its extra context and cannot later acquire capture', async t => {
  const f = fixture(t, { pendingSource: true }); const starting = f.start(); await flush(); assert.equal(f.media.contexts.length, 1);
  const receipt = await f.controller.stop(); assert.equal(receipt.permissionPending, true); assert.equal(receipt.contextsClosed, true);
  f.sourceWait.resolve(); assert.equal(await starting, false); await flush();
  assert.equal(f.media.contexts.length, 1); assert.equal(f.media.streams[0].track.readyState, 'ended'); assert.equal(f.oscillatorNodes[0].stops, 1);
});
test('generated-source close failure stays uncertain through repeated Stop and is not raw error evidence', async t => {
  const f = fixture(t, { failedSourceClose: true }); await f.start();
  const receipt = await f.controller.stop(); assert.equal(receipt.contextsClosed, false); assert.deepEqual(await f.controller.stop(), receipt);
  assert.match(f.controller.snapshot().cleanupWarning, /Audio context cleanup/);
  const evidence = f.controller.evidence(); assert.equal(evidence.generatedSourceCleanup.contextsClosed, false); assert.doesNotMatch(JSON.stringify(evidence), /private failure/);
});
test('hiding the page stops graph contexts and the generated source, not just the simulated socket', async t => {
  const f = fixture(t); await f.start(); f.media.documentTarget.visibilityState = 'hidden'; f.media.documentTarget.emit('visibilitychange'); f.media.pageTarget.emit('pagehide'); await flush();
  assert.equal(f.controller.snapshot().phase, 'stopped'); assert.equal(f.media.contexts.every(context => context.state === 'closed'), true);
  assert.equal(f.media.streams.every(stream => stream.track.readyState === 'ended'), true); assert.equal(f.oscillatorNodes[0].stops, 1);
});
test('older delayed source closure cannot label a running replacement source as cleaned up', async t => {
  const f = fixture(t, { pendingSourceClose: true }); await f.start(); const oldStop = f.controller.stop();
  assert.equal(await f.start(), true); assert.equal(f.controller.evidence().generatedSourceCleanup, null);
  f.closeWait.resolve(); await oldStop;
  const evidence = f.controller.evidence(); assert.equal(evidence.panelPhase, 'listening');
  assert.deepEqual(evidence.generatedSourceStatus, { context: 'running', stopped: false }); assert.equal(evidence.generatedSourceCleanup, null);
  assert.equal(evidence.localObservations.trace.every(event => event.sessionRef === 'local-generated-tone-2'), true);
  await f.controller.stop(); assert.deepEqual(f.controller.evidence().generatedSourceCleanup, { tracksStopped: true, contextsClosed: true });
});
test('a replacement denied before media cannot present the previous generated source as its own', async t => {
  const f = fixture(t); await f.start(); await f.controller.stop();
  f.media.documentTarget.visibilityState = 'hidden'; assert.equal(await f.start(), false);
  const evidence = f.controller.evidence(); assert.equal(evidence.generatedSourceStatus, null); assert.equal(evidence.generatedSourceCleanup, null);
  assert.deepEqual(evidence.metrics, {}); assert.equal(f.media.contexts.length, 3);
});
test('a clean later Stop cannot permit language replacement to discard an older cleanup concern', async t => {
  const f = fixture(t, { failedSourceClose: true }); await f.start(); await f.controller.stop();
  await f.start(); const clean = await f.controller.stop(); assert.deepEqual(clean, { tracksStopped: true, contextsClosed: true });
  assert.match(f.controller.snapshot().cleanupWarning, /Audio context cleanup/);
  assert.equal(canReplaceDemoController(clean, f.controller.snapshot()), false);
  assert.equal(canReplaceDemoController(clean, { cleanupWarning: '' }), true);
  assert.equal(canReplaceDemoController({ ...clean, permissionPending: true }, { cleanupWarning: '' }), false);
});
test('the thirty-second fixture deadline also releases the extra generated context', async t => {
  const f = fixture(t); await f.start(); f.advance(30000); f.media.frame(); await flush();
  assert.equal(f.controller.snapshot().phase, 'failed'); assert.equal(f.media.contexts.every(context => context.state === 'closed'), true);
  assert.deepEqual(f.controller.evidence().generatedSourceCleanup, { tracksStopped: true, contextsClosed: true });
});
test('queued simulated ready cannot open after Stop, and mismatched fixture routing is rejected', () => {
  let pending; const url = `${ORIGIN.replace('https:', 'wss:')}/api/voice-pcm-evaluation?language=ha&consentVersion=${NOTICE}`;
  const options = { url, language: 'ha', protocol: `doctarx-pcm-v1.${IDENTITY.sessionBinding}` };
  const socket = createSimulatedSocket({ ...options, schedule: callback => { pending = callback; } });
  let events = 0; socket.addEventListener('message', () => events++); socket.close(); pending(); assert.equal(socket.readyState, 3); assert.equal(events, 0);
  assert.throws(() => createSimulatedSocket({ ...options, language: 'yo' })); assert.throws(() => createSimulatedSocket({ ...options, url: url.replace('local-voice-fixture.invalid', 'example.com') }));
});
test('generated output is bounded low-amplitude PCM16 with faded edges, not a speech asset', () => {
  const bytes = Buffer.from(toneBase64(24000), 'base64'); assert.equal(bytes.length, 48000);
  let peak = 0; for (let i = 0; i < bytes.length; i += 2) peak = Math.max(peak, Math.abs(bytes.readInt16LE(i)));
  assert.ok(peak > 0 && peak <= 983); assert.equal(bytes.readInt16LE(0), 0); assert.equal(bytes.readInt16LE(bytes.length - 2), 0);
});
test('source construction failure still closes its owned context', async () => {
  let closes = 0; const context = { state: 'running', createMediaStreamDestination() { throw new Error('private'); }, async close() { closes++; this.state = 'closed'; } };
  const source = createGeneratedSource({ createContext: () => context }); await assert.rejects(source.ready, /Generated input/);
  assert.deepEqual(await source.stop(), { tracksStopped: true, contextsClosed: true }); assert.equal(closes, 1);
});
test('standalone browser composition has no real microphone, network, storage or application route fallback', () => {
  for (const name of ['browser.cjs', 'controller.cjs', 'generatedSource.cjs', 'simulation.cjs']) {
    const source = fs.readFileSync(require.resolve(`../../../scripts/voice-local-demo/${name}`), 'utf8');
    assert.doesNotMatch(source, /navigator|new\s+(?:window\.)?WebSocket|fetch\(|localStorage|sessionStorage|apiKey|process\.env/);
  }
  const index = fs.readFileSync(require.resolve('../../index.js'), 'utf8'); assert.doesNotMatch(index, /voice-local-demo/);
});
