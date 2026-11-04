'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs');
const { createPcmPanelController } = require('../../../lib/voice/pcmPanelController.cjs');
const { createGeminiPcmSession } = require('../../../lib/voice/geminiPcmSession.cjs');
const { browser, deferred, FakeSocket } = require('./helpers/pcmBrowser.cjs');
const flush = () => new Promise(resolve => setImmediate(resolve));
const capabilities = { success: true, identity: { actorId: 'fictional-evaluator', sessionBinding: 'a'.repeat(64) }, capabilities: { enabled: true, provider: 'google', model: 'gemini-3.8-live', voice: 'Zephyr', clinicalUse: false, consentVersion: 'voice-live-synthetic-v1', languages: ['ha', 'ig', 'yo'].map(code => ({ code })) } };
function fixture(extra = {}) {
  const clients = [], snapshots = []; let reads = 0;
  const panel = createPcmPanelController({ userId: 'fictional-evaluator', role: 'provider', language: 'ha', browserSupported: true,
    loadCapabilities: async () => { reads++; return capabilities; }, onChange: state => snapshots.push(state),
    createSession(callbacks) {
      const start = deferred(), resume = deferred(); const client = { callbacks, startPending: start, resumePending: resume, starts: 0, stops: 0, pauses: [], speakerPauses: 0,
        start(input) { this.starts++; this.input = input; callbacks.onState('authorizing'); return start.promise; }, stop() { this.stops++; if (this.cleanup) return this.cleanup.promise; return Promise.resolve({ tracksStopped: true, contextsClosed: true }); },
        setMicrophonePaused(value) { this.pauses.push(value); }, pauseSpeaker() { this.speakerPauses++; callbacks.onState('speaker_paused'); }, resumeSpeaker() { return resume.promise; } };
      clients.push(client); return client;
    }, ...extra });
  async function connected() { await panel.load(); panel.setConsent(true); const pending = panel.start(); const client = clients.at(-1); client.callbacks.onState('listening'); client.startPending.resolve(); await pending; return client; }
  return { panel, clients, snapshots, reads: () => reads, connected };
}
test('disabled, malformed and unsupported-browser configuration never creates transport', async () => {
  for (const extra of [{ loadCapabilities: async () => ({ ...capabilities, capabilities: { ...capabilities.capabilities, enabled: false } }) }, { loadCapabilities: async () => ({ ...capabilities, capabilities: { ...capabilities.capabilities, voice: 'Riko' } }) }, { loadCapabilities: async () => ({ ...capabilities, identity: { actorId: 'wrong', sessionBinding: 'a'.repeat(64) } }) }, { loadCapabilities: async () => ({ ...capabilities, identity: { actorId: 'fictional-evaluator', sessionBinding: 'not-a-binding' } }) }, { browserSupported: false }, { role: 'patient' }, { language: 'zz' }, { userId: null }]) {
    const f = fixture(extra); await f.panel.load(); f.panel.setConsent(true); assert.equal(await f.panel.start(), false); assert.equal(f.clients.length, 0); await f.panel.dispose();
  }
});
test('same-tick repeated Start has only one transport and current consent is required', async () => {
  const f = fixture(); await f.panel.load(); assert.equal(await f.panel.start(), false); f.panel.setConsent(true);
  const first = f.panel.start(); assert.equal(await f.panel.start(), false); assert.equal(f.clients.length, 1); assert.equal(f.clients[0].starts, 1);
  await f.panel.stop(); f.clients[0].startPending.resolve(); assert.equal(await first, false); assert.equal(f.panel.snapshot().consent, false);
});
test('consent withdrawal stops immediately and late start/caption callbacks cannot resurrect it', async () => {
  const f = fixture(); await f.panel.load(); f.panel.setConsent(true); const starting = f.panel.start(), client = f.clients[0];
  f.panel.setConsent(false); assert.equal(client.stops, 1); assert.equal(f.panel.snapshot().phase, 'stopped');
  client.callbacks.onState('listening'); client.callbacks.onTranscript({ speaker: 'assistant', text: 'late', language: 'ha', provisional: true, clinicalReviewed: false }); client.startPending.resolve();
  assert.equal(await starting, false); assert.equal(f.panel.snapshot().captions.length, 0); assert.equal(f.panel.snapshot().consent, false);
});
test('disposal while capabilities load suppresses all later changes and connections', async () => {
  const pending = deferred(), f = fixture({ loadCapabilities: () => pending.promise }); const loading = f.panel.load(); await f.panel.dispose(); pending.resolve(capabilities); await loading;
  assert.equal(f.snapshots.length, 1); f.panel.setConsent(true); assert.equal(await f.panel.start(), false); assert.equal(f.clients.length, 0);
});
test('new identity/language controller remains independent of old delayed callbacks', async () => {
  const old = fixture(), next = fixture({ userId: 'other-fictional-evaluator', language: 'yo', loadCapabilities: async () => ({ ...capabilities, identity: { ...capabilities.identity, actorId: 'other-fictional-evaluator' } }) }); const stale = await old.connected(); await old.panel.dispose(); const active = await next.connected();
  stale.callbacks.onState('failed'); stale.callbacks.onTranscript({ speaker: 'assistant', text: 'old account', language: 'ha', provisional: true, clinicalReviewed: false });
  assert.equal(next.panel.snapshot().phase, 'listening'); assert.equal(active.stops, 0); assert.equal(next.panel.snapshot().captions.length, 0); await next.panel.dispose();
});
test('only marked source-language provisional fragments enter bounded display and Stop clears them', async () => {
  const f = fixture(), client = await f.connected();
  for (let i = 0; i < 110; i++) client.callbacks.onTranscript({ speaker: 'assistant', text: String(i), language: 'ha', provisional: true, clinicalReviewed: false });
  assert.equal(f.panel.snapshot().captions.length, 100); assert.equal(f.panel.snapshot().captions[0].text, '10');
  await f.panel.stop(); assert.equal(f.panel.snapshot().captions.length, 0); assert.equal(client.stops, 1);
});
test('malformed or mismatched-language captions stop and clear local display', async () => {
  const f = fixture(), client = await f.connected(); client.callbacks.onTranscript({ speaker: 'assistant', text: 'wrong language', language: 'yo', provisional: true, clinicalReviewed: false });
  assert.equal(client.stops, 1); assert.equal(f.panel.snapshot().phase, 'stopped'); assert.equal(f.panel.snapshot().captions.length, 0);
});
test('speaker mute wins over a delayed resume and microphone control is independent', async () => {
  const f = fixture(), client = await f.connected(); f.panel.setMicrophonePaused(true); assert.deepEqual(client.pauses, [true]);
  f.panel.pauseSpeaker(); const pending = f.panel.resumeSpeaker(); f.panel.pauseSpeaker(); client.resumePending.resolve(true); assert.equal(await pending, false);
  assert.equal(f.panel.snapshot().speakerPaused, true); assert.equal(f.panel.snapshot().microphonePaused, true); await f.panel.dispose();
});
test('failed transport resets consent and cannot create unhandled start rejection', async () => {
  const f = fixture(); await f.panel.load(); f.panel.setConsent(true); const starting = f.panel.start(), client = f.clients[0];
  client.callbacks.onState('failed'); client.startPending.resolve(); assert.equal(await starting, false); assert.equal(f.panel.snapshot().consent, false); assert.match(f.panel.snapshot().error, /could not continue/);
});
test('stale cleanup rejection cannot overwrite a new stopped session', async () => {
  let rejectCleanup; const f = fixture(), old = await f.connected(); old.cleanup = { promise: new Promise((_resolve, reject) => { rejectCleanup = reject; }) };
  const stopping = f.panel.stop(); f.panel.setConsent(true); const starting = f.panel.start(), next = f.clients[1]; next.callbacks.onState('listening'); next.startPending.resolve(); await starting; await f.panel.stop();
  rejectCleanup(new Error('fictional')); await stopping; assert.equal(f.panel.snapshot().error, '');
});
test('panel traverses actual PCM controller through fictional permit, capture, captions and consent teardown', async () => {
  const media = browser(), sockets = [];
  const panel = createPcmPanelController({ userId: 'fictional-evaluator', role: 'provider', language: 'ig', browserSupported: true, loadCapabilities: async () => capabilities,
    createSession: callbacks => createGeminiPcmSession({ ...callbacks, ...media, origin: 'https://fictional.example', createSocket(url) { const socket = new FakeSocket(url); sockets.push(socket); return socket; } }) });
  await panel.load(); panel.setConsent(true); const starting = panel.start(); assert.equal(media.requests(), 0); sockets[0].open();
  sockets[0].message({ type: 'session.ready', provider: 'google', model: 'gemini-3.8-live', language: 'ig', dataClass: 'synthetic', consentVersion: 'voice-live-synthetic-v1', sessionId: 'fictional', actorId: 'fictional-evaluator', sessionBinding: 'a'.repeat(64), expiresAt: Date.now() + 180000 });
  assert.equal(await starting, true); assert.equal(media.requests(), 1); media.frame(); assert.equal(sockets[0].sent.at(-1).type, 'audio.pcm');
  sockets[0].message({ type: 'transcript', speaker: 'assistant', text: 'Fictional Igbo fragment' }); assert.equal(panel.snapshot().captions.length, 1);
  panel.setConsent(false); assert.equal(media.streams[0].track.readyState, 'ended'); assert.equal(sockets[0].readyState, 3); assert.equal(panel.snapshot().captions.length, 0); await flush(); await panel.dispose();
});
test('React panel is integrated without changing development route boundary or presenting Riko as live voice', () => {
  const ui = fs.readFileSync(require.resolve('../../../components/voice/GeminiPcmPrototype.jsx'), 'utf8');
  const lab = fs.readFileSync(require.resolve('../../../components/voice/VoiceIntakeLab.jsx'), 'utf8');
  const page = fs.readFileSync(require.resolve('../../../app/voice-lab/page.js'), 'utf8');
  assert.match(ui, /Live voice: Zephyr/); assert.match(ui, /Riko is a separate/); assert.match(ui, /pagehide/); assert.match(ui, /visibilitychange/); assert.match(ui, /key=\{JSON.stringify/);
  assert.match(lab, /<GeminiPcmPrototype/); assert.match(lab, /The text rehearsal below has no microphone/); assert.match(page, /NODE_ENV !== 'development'/);
});

test('actual React rendering exposes safe initial status and no controls to unauthorized roles', async () => {
  const React = require('react'), { renderToStaticMarkup } = require('react-dom/server'), vm = require('node:vm');
  let renderedState;
  const filename = require.resolve('../../../components/voice/GeminiPcmPrototype.jsx');
  const compiled = await require('next/dist/build/swc').transform(fs.readFileSync(filename, 'utf8'), { filename,
    jsc: { parser: { syntax: 'ecmascript', jsx: true }, transform: { react: { runtime: 'automatic' } }, target: 'es2020' }, module: { type: 'commonjs' } });
  const holder = { exports: {} };
  vm.runInNewContext(compiled.code, { module: holder, exports: holder.exports, require(name) {
    if (name === 'react') return { ...React, useState: function useInjectedState(initial) { const normal = React.useState(initial); return renderedState ? [renderedState, () => {}] : normal; } };
    if (name === '@/lib/voice/voicePcmApi') return { voicePcmApi: { capabilities() { throw new Error('Unexpected render request'); } } };
    if (name === '@/lib/authSession') return { subscribeAuthSession() { throw new Error('Unexpected render subscription'); } };
    if (name.startsWith('@/')) return require('../../../' + name.slice(2)); return require(name);
  } }, { filename });
  const Component = holder.exports.default;
  const html = renderToStaticMarkup(React.createElement(Component, { userId: 'fictional', role: 'provider', language: 'ha' }));
  assert.match(html, /Checking audio evaluation availability/); assert.match(html, /Riko is a separate/); assert.doesNotMatch(html, /Start fictional audio test/);
  assert.equal(renderToStaticMarkup(React.createElement(Component, { userId: 'fictional', role: 'patient', language: 'ha' })), '');

  const f = fixture(), first = await f.connected(); first.cleanup = { promise: Promise.resolve({ tracksStopped: false, contextsClosed: true }) }; await f.panel.stop();
  const second = await f.connected(); renderedState = f.panel.snapshot();
  const listening = renderToStaticMarkup(React.createElement(Component, { userId: 'fictional', role: 'provider', language: 'ha' }));
  assert.match(listening, /Audio test connected/); assert.match(listening, /microphone indicator/);
  second.cleanup = { promise: Promise.resolve({ tracksStopped: true, contextsClosed: false }) }; await f.panel.stop(); renderedState = f.panel.snapshot();
  const stopped = renderToStaticMarkup(React.createElement(Component, { userId: 'fictional', role: 'provider', language: 'ha' }));
  assert.equal((stopped.match(/microphone indicator/g) || []).length, 1); assert.equal((stopped.match(/Audio context cleanup/g) || []).length, 1);
  await f.panel.dispose();

  const delayed = fixture(), old = await delayed.connected(); old.cleanup = deferred(); const oldStop = delayed.panel.stop();
  const replacement = await delayed.connected(); replacement.cleanup = { promise: Promise.resolve({ tracksStopped: true, contextsClosed: false }) }; await delayed.panel.stop();
  old.cleanup.resolve({ tracksStopped: false, contextsClosed: true }); await oldStop; renderedState = delayed.panel.snapshot();
  const lateCleanup = renderToStaticMarkup(React.createElement(Component, { userId: 'fictional', role: 'provider', language: 'ha' }));
  assert.equal((lateCleanup.match(/microphone indicator/g) || []).length, 1); assert.equal((lateCleanup.match(/Audio context cleanup/g) || []).length, 1);
  assert.match(lateCleanup, /Local stop requested/); await delayed.panel.dispose();
});

test('older availability result cannot override a newer disabled response or carry old consent', async () => {
  const first = deferred(), second = deferred(); let calls = 0;
  const f = fixture({ loadCapabilities: () => ++calls === 1 ? first.promise : second.promise });
  const a = f.panel.load(), b = f.panel.load(); second.resolve({ ...capabilities, capabilities: { ...capabilities.capabilities, enabled: false } }); await b;
  first.resolve(capabilities); await a; f.panel.setConsent(true); assert.equal(f.panel.snapshot().capability.enabled, false); assert.equal(f.panel.snapshot().consent, false); assert.equal(await f.panel.start(), false);
});

test('expected actor and session correlation are forwarded to the PCM permit verifier', async () => {
  const f = fixture(), client = await f.connected();
  assert.equal(client.input.expectedActorId, 'fictional-evaluator'); assert.equal(client.input.expectedSessionBinding, 'a'.repeat(64)); await f.panel.dispose();
});

test('resolved uncertain cleanup receipts explain microphone, context and pending-permission limits', async () => {
  for (const [receipt, expected, absent] of [
    [{ tracksStopped: false, contextsClosed: true }, /microphone indicator/, /Audio context cleanup/],
    [{ tracksStopped: true, contextsClosed: false }, /Audio context cleanup/, /microphone indicator/],
    [{ tracksStopped: true, contextsClosed: true, permissionPending: true }, /permission request is still pending/, /release could not be confirmed/]
  ]) {
    const f = fixture(), client = await f.connected(); client.cleanup = { promise: Promise.resolve(receipt) };
    assert.deepEqual(await f.panel.stop(), receipt); assert.match(f.panel.snapshot().cleanupWarning, expected); assert.doesNotMatch(f.panel.snapshot().cleanupWarning, absent);
  }
});

test('actual client failed track shutdown reaches panel as an unconfirmed microphone warning', async t => {
  const media = browser(), sockets = [];
  const panel = createPcmPanelController({ userId: 'fictional-evaluator', role: 'provider', language: 'ig', browserSupported: true, loadCapabilities: async () => capabilities,
    createSession: callbacks => createGeminiPcmSession({ ...callbacks, ...media, origin: 'https://fictional.example', createSocket(url) { const socket = new FakeSocket(url); sockets.push(socket); return socket; } }) });
  t.after(() => panel.dispose());
  await panel.load(); panel.setConsent(true); const starting = panel.start(); sockets[0].open();
  sockets[0].message({ type: 'session.ready', provider: 'google', model: 'gemini-3.8-live', language: 'ig', dataClass: 'synthetic', consentVersion: 'voice-live-synthetic-v1', sessionId: 'fictional', actorId: 'fictional-evaluator', sessionBinding: 'a'.repeat(64), expiresAt: Date.now() + 180000 });
  await starting; media.streams[0].track.stop = () => { throw new Error('Fictional track failure'); };
  const result = await panel.stop(); assert.equal(result.tracksStopped, false); assert.equal(result.contextsClosed, true);
  assert.equal(media.streams[0].track.enabled, false); assert.match(panel.snapshot().cleanupWarning, /microphone indicator/); assert.doesNotMatch(panel.snapshot().cleanupWarning, /Audio context cleanup/);

  // A replacement may run independently, but its clean result cannot erase
  // the still-live older device's unresolved cleanup evidence.
  await panel.load(); panel.setConsent(true); const replacement = panel.start(); sockets[1].open();
  sockets[1].message({ type: 'session.ready', provider: 'google', model: 'gemini-3.8-live', language: 'ig', dataClass: 'synthetic', consentVersion: 'voice-live-synthetic-v1', sessionId: 'fictional-replacement', actorId: 'fictional-evaluator', sessionBinding: 'a'.repeat(64), expiresAt: Date.now() + 180000 });
  assert.equal(await replacement, true); assert.equal(panel.snapshot().phase, 'listening');
  assert.match(panel.snapshot().cleanupWarning, /microphone indicator/);
  assert.deepEqual(await panel.stop(), { tracksStopped: true, contextsClosed: true });
  assert.equal(media.streams[0].track.readyState, 'live'); assert.equal(media.streams[1].track.readyState, 'ended');
  assert.match(panel.snapshot().cleanupWarning, /microphone indicator/); await panel.dispose();
});

test('actual pending microphone permission is reported rather than claiming verified release', async () => {
  const permission = deferred(), media = browser({ getUserMedia: () => permission.promise }), sockets = [];
  const panel = createPcmPanelController({ userId: 'fictional-evaluator', role: 'provider', language: 'ig', browserSupported: true, loadCapabilities: async () => capabilities,
    createSession: callbacks => createGeminiPcmSession({ ...callbacks, ...media, origin: 'https://fictional.example', createSocket(url) { const socket = new FakeSocket(url); sockets.push(socket); return socket; } }) });
  await panel.load(); panel.setConsent(true); const starting = panel.start(); sockets[0].open();
  sockets[0].message({ type: 'session.ready', provider: 'google', model: 'gemini-3.8-live', language: 'ig', dataClass: 'synthetic', consentVersion: 'voice-live-synthetic-v1', sessionId: 'fictional', actorId: 'fictional-evaluator', sessionBinding: 'a'.repeat(64), expiresAt: Date.now() + 180000 });
  assert.equal(media.requests(), 1); const receipt = await panel.stop(); assert.equal(receipt.permissionPending, true); assert.equal(receipt.tracksStopped, false);
  assert.match(panel.snapshot().cleanupWarning, /permission request is still pending/); assert.match(panel.snapshot().cleanupWarning, /microphone indicator/);
  const lateStream = media.stream(); permission.resolve(lateStream); await starting; await flush(); assert.equal(lateStream.track.readyState, 'ended');
});

test('automatic PCM failure surfaces actual microphone and context cleanup warnings', async () => {
  for (const action of ['socket', 'processor']) {
    const media = browser(), sockets = [];
    const panel = createPcmPanelController({ userId: 'fictional-evaluator', role: 'provider', language: 'ig', browserSupported: true, loadCapabilities: async () => capabilities,
      createSession: callbacks => createGeminiPcmSession({ ...callbacks, ...media, origin: 'https://fictional.example', createSocket(url) { const socket = new FakeSocket(url); sockets.push(socket); return socket; } }) });
    await panel.load(); panel.setConsent(true); const starting = panel.start(); sockets[0].open();
    sockets[0].message({ type: 'session.ready', provider: 'google', model: 'gemini-3.8-live', language: 'ig', dataClass: 'synthetic', consentVersion: 'voice-live-synthetic-v1', sessionId: 'fictional', actorId: 'fictional-evaluator', sessionBinding: 'a'.repeat(64), expiresAt: Date.now() + 180000 });
    await starting;
    media.streams[0].track.stop = () => { throw new Error('private track failure'); };
    media.contexts[1].close = async () => { throw new Error('private context failure'); };
    if (action === 'socket') sockets[0].emit('error'); else media.worklets[0].onprocessorerror();
    await flush();
    assert.equal(panel.snapshot().phase, 'failed'); assert.equal(panel.snapshot().consent, false);
    assert.match(panel.snapshot().cleanupWarning, /microphone indicator/, action);
    assert.match(panel.snapshot().cleanupWarning, /Audio context cleanup/, action);
    assert.match(panel.snapshot().error, /could not continue/, action);
    assert.doesNotMatch(panel.snapshot().error, /private/); await panel.dispose();
  }
});

test('a failed old session cleanup cannot overwrite replacement session state', async () => {
  const f = fixture(), old = await f.connected(); old.cleanup = deferred();
  old.callbacks.onState('failed');
  f.panel.setConsent(true); const starting = f.panel.start(), active = f.clients.at(-1);
  active.callbacks.onState('listening'); active.startPending.resolve(); await starting;
  old.cleanup.resolve({ tracksStopped: false, contextsClosed: false }); await flush();
  assert.equal(f.panel.snapshot().phase, 'listening'); assert.equal(f.panel.snapshot().error, '');
  assert.match(f.panel.snapshot().cleanupWarning, /microphone indicator/); assert.match(f.panel.snapshot().cleanupWarning, /Audio context cleanup/);
  assert.equal(active.stops, 0); await f.panel.dispose();
});

test('cleanup warnings accumulate conservatively without retaining session data or raw failures', async () => {
  const f = fixture();
  for (const receipt of [{ tracksStopped: false, contextsClosed: true }, { tracksStopped: true, contextsClosed: false }, { tracksStopped: true, contextsClosed: true, permissionPending: true }]) {
    const client = await f.connected(); client.cleanup = { promise: Promise.resolve(receipt) }; await f.panel.stop();
    assert.equal(f.panel.snapshot().error, '');
  }
  await f.connected(); await f.panel.stop();
  const warning = f.panel.snapshot().cleanupWarning;
  assert.match(warning, /microphone indicator/); assert.match(warning, /Audio context cleanup/); assert.match(warning, /permission request is still pending/);
  assert.equal((warning.match(/microphone indicator/g) || []).length, 1); await f.panel.dispose();
});

test('repeated panel Stop retains pending and completed cleanup instead of suppressing warnings', async () => {
  const f = fixture(), client = await f.connected(); client.cleanup = deferred();
  const first = f.panel.stop(), second = f.panel.stop();
  const receipt = { tracksStopped: false, contextsClosed: false };
  client.cleanup.resolve(receipt); assert.deepEqual(await first, receipt); assert.deepEqual(await second, receipt);
  assert.deepEqual(await f.panel.stop(), receipt); assert.equal(client.stops, 1);
  assert.match(f.panel.snapshot().cleanupWarning, /microphone indicator/); assert.match(f.panel.snapshot().cleanupWarning, /Audio context cleanup/);
});

test('automatic failure followed by lifecycle Stop retains its delayed cleanup warning', async () => {
  const f = fixture(), client = await f.connected(); client.cleanup = deferred();
  client.callbacks.onState('failed'); const stopped = f.panel.stop();
  client.cleanup.resolve({ tracksStopped: false, contextsClosed: false }); await stopped; await flush();
  assert.match(f.panel.snapshot().cleanupWarning, /microphone indicator/); assert.match(f.panel.snapshot().cleanupWarning, /Audio context cleanup/);
  assert.equal(client.stops, 1);
});

test('hidden then pagehide through actual PCM wiring retains uncertain device cleanup', async () => {
  const pending = deferred(), media = browser(), sockets = [];
  const panel = createPcmPanelController({ userId: 'fictional-evaluator', role: 'provider', language: 'ig', browserSupported: true, loadCapabilities: async () => capabilities,
    createSession: callbacks => createGeminiPcmSession({ ...callbacks, ...media, origin: 'https://fictional.example', createSocket(url) { const socket = new FakeSocket(url); sockets.push(socket); return socket; } }) });
  media.pageTarget.addEventListener('pagehide', () => { void panel.stop(); });
  media.documentTarget.addEventListener('visibilitychange', () => { if (media.documentTarget.visibilityState === 'hidden') void panel.stop(); });
  await panel.load(); panel.setConsent(true); const starting = panel.start(); sockets[0].open();
  sockets[0].message({ type: 'session.ready', provider: 'google', model: 'gemini-3.8-live', language: 'ig', dataClass: 'synthetic', consentVersion: 'voice-live-synthetic-v1', sessionId: 'fictional', actorId: 'fictional-evaluator', sessionBinding: 'a'.repeat(64), expiresAt: Date.now() + 180000 });
  await starting;
  media.streams[0].track.stop = () => { throw new Error('private track failure'); };
  media.contexts[1].close = async () => { await pending.promise; throw new Error('private context failure'); };
  media.documentTarget.visibilityState = 'hidden'; media.documentTarget.emit('visibilitychange'); media.pageTarget.emit('pagehide');
  pending.resolve(); await flush(); await flush();
  assert.equal(media.streams[0].track.readyState, 'live'); assert.match(panel.snapshot().cleanupWarning, /microphone indicator/); assert.match(panel.snapshot().cleanupWarning, /Audio context cleanup/);
  assert.doesNotMatch(panel.snapshot().error, /private/); await panel.dispose();
});
