'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { createGeminiLiveEvaluationTransport, configuration, LIMITS, MODEL, VOICE } = require('../../services/voice/geminiLiveEvaluationTransport');
const flush = () => new Promise(resolve => setImmediate(resolve));
const pcm = bytes => Buffer.alloc(bytes).toString('base64');
function fixture({ deferred = false, acknowledgeClose = true } = {}) {
  let clock = 1000; let request; let resolveConnect; let closes = 0;
  const timers = new Map(); let next = 0; const events = []; const sent = [];
  const sdk = { sendRealtimeInput: value => sent.push(value), close() { closes++; if (acknowledgeClose) request.callbacks.onclose({}); } };
  const transport = createGeminiLiveEvaluationTransport({ now: () => clock,
    setTimer(fn, ms) { const id = ++next; timers.set(id, { fn, ms }); return id; }, clearTimer: id => timers.delete(id),
    connectLive: value => { request = value; return deferred ? new Promise(resolve => { resolveConnect = resolve; }) : sdk; },
  });
  const open = (language = 'ha') => transport.open({ language, onEvent: event => events.push(event) });
  return { open, events, sent, timers, sdk, request: () => request, closes: () => closes,
    resolve: () => resolveConnect(sdk), advance: ms => { clock += ms; },
    message: value => request.callbacks.onmessage(value),
    fire(ms) { const found = [...timers.values()].find(item => item.ms === ms); assert.ok(found); found.fn(); },
    async start(language) { const handle = open(language); await flush(); request.callbacks.onmessage({ setupComplete: {} }); await handle.ready; return handle; },
  };
}
test('injected connector required; no default network, SDK, credential, route or tools composition', () => {
  assert.throws(() => createGeminiLiveEvaluationTransport(), { code: 'GEMINI_NOT_CONFIGURED' });
  const source = fs.readFileSync(require.resolve('../../services/voice/geminiLiveEvaluationTransport'), 'utf8');
  assert.doesNotMatch(source, /process\.env|require\(['"](?:@google|ws)|fetch\(|new WebSocket|apiKey:/);
  const route = fs.readFileSync(require.resolve('../../routes/voiceLive'), 'utf8');
  assert.doesNotMatch(route, /geminiLiveEvaluationTransport|createGemini/);
});
for (const [language, name] of Object.entries({ ha: 'Hausa', ig: 'Igbo', yo: 'Yoruba' })) {
  test(`${name} uses separate native PCM config and fixture-only text, not a support claim`, async () => {
    const f = fixture(); const handle = await f.start(language); const request = f.request();
    assert.equal(request.model, MODEL); assert.equal(VOICE, 'Zephyr');
    assert.equal(request.config.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName, 'Zephyr');
    assert.deepEqual(request.config.responseModalities, ['AUDIO']);
    assert.match(request.config.systemInstruction, new RegExp(name));
    assert.match(request.config.systemInstruction, /nonclinical/);
    assert.equal(request.config.tools, undefined); assert.equal(request.config.thinkingConfig, undefined);
    handle.sendGreeting(); assert.match(f.sent[0].text, new RegExp(name));
    assert.equal(handle.sendText, undefined); await handle.stop();
  });
}
test('unsupported language fails before provider creation', () => {
  const f = fixture(); assert.throws(() => f.open('xx'), { code: 'GEMINI_LANGUAGE_INVALID' }); assert.equal(f.request(), undefined);
  assert.throws(() => configuration('__proto__'), { code: 'GEMINI_LANGUAGE_INVALID' });
});
test('waits for SDK handle plus setup before accepting audio', async () => {
  const f = fixture({ deferred: true }); const handle = f.open(); await flush();
  f.message({ setupComplete: {} }); assert.equal(handle.status().phase, 'connecting');
  assert.throws(() => handle.sendPcm(pcm(2)), { code: 'GEMINI_SESSION_NOT_READY' });
  f.resolve(); await handle.ready; handle.sendPcm(pcm(320)); handle.endAudio();
  assert.deepEqual(f.sent, [{ audio: { data: pcm(320), mimeType: 'audio/pcm;rate=16000' } }, { audioStreamEnd: true }]);
  await handle.stop();
});
test('PCM validation rejects malformed, noncanonical, odd and oversized chunks before SDK send', async () => {
  const f = fixture(); const handle = await f.start();
  for (const value of ['', 'AAAA=', 'AA==', 'AA A=', 'AB==', pcm(LIMITS.inputChunkBytes + 2), { data: 'AAAA' }]) {
    assert.throws(() => handle.sendPcm(value), { code: 'GEMINI_AUDIO_INVALID' });
  }
  assert.equal(f.sent.length, 0); await handle.stop();
});
test('input/output session byte bounds fail closed', async () => {
  const f = fixture(); const handle = await f.start();
  const chunk = pcm(LIMITS.inputChunkBytes);
  for (let i = 0; i < LIMITS.inputBytes / LIMITS.inputChunkBytes; i++) handle.sendPcm(chunk);
  assert.throws(() => handle.sendPcm(pcm(2)), { code: 'GEMINI_INPUT_LIMIT' }); assert.equal(f.closes(), 1);
  const g = fixture(); const other = await g.start(); const data = pcm(LIMITS.outputChunkBytes);
  for (let i = 0; i <= LIMITS.outputBytes / LIMITS.outputChunkBytes; i++) g.message({ serverContent: { modelTurn: { parts: [{ inlineData: { data, mimeType: 'audio/pcm;rate=24000' } }] } } });
  assert.equal(g.closes(), 1); assert.ok(g.events.some(event => event.code === 'GEMINI_OUTPUT_LIMIT')); await other.stop();
});
test('audio, transcripts and turn signals retain provenance; interrupt clears before further audio', async () => {
  const f = fixture(); const handle = await f.start();
  const audio = { modelTurn: { parts: [{ inlineData: { data: pcm(10), mimeType: 'audio/pcm;rate=24000' } }] } };
  f.message({ serverContent: { ...audio, outputTranscription: { text: 'Fictional greeting' }, turnComplete: true } });
  assert.equal(f.events.find(event => event.type === 'audio.pcm').sampleRate, 24000);
  assert.equal(f.events.find(event => event.type === 'transcript').evidence, 'provider_unreviewed');
  assert.equal(f.events.find(event => event.type === 'turn.complete').playbackConfirmed, false);
  const count = f.events.filter(event => event.type === 'audio.pcm').length;
  f.message({ serverContent: { ...audio, interrupted: true } });
  assert.equal(f.events.at(-1).type, 'playback.clear'); assert.equal(f.events.at(-1).reason, 'interrupted');
  assert.equal(f.events.filter(event => event.type === 'audio.pcm').length, count);
  f.message({ serverContent: audio }); assert.equal(f.events.at(-1).playbackEpoch, 1); await handle.stop();
});
test('stop discards late media and is idempotent without claiming final usage', async () => {
  const f = fixture(); const handle = await f.start(); const result = await handle.stop(); const count = f.events.length;
  f.message({ serverContent: { outputTranscription: { text: 'late' } } });
  assert.equal(f.events.length, count); assert.equal(result.transportClosedConfirmed, true); assert.equal(result.providerFinalUsageConfirmed, false);
  assert.equal((await handle.stop()).transportClosedConfirmed, true); assert.equal(f.closes(), 1);
  assert.throws(() => handle.sendGreeting(), { code: 'GEMINI_SESSION_NOT_READY' });
});
test('stop before connector invocation prevents any creation', async () => {
  const f = fixture(); const handle = f.open(); const stopped = handle.stop(); await flush();
  assert.equal(f.request(), undefined); await assert.rejects(handle.ready, { code: 'GEMINI_SESSION_STOPPED' });
  f.fire(LIMITS.closeMs); assert.equal((await stopped).transportClosedConfirmed, false);
});
test('late connection after cancellation is closed, never made ready', async () => {
  const f = fixture({ deferred: true }); const handle = f.open(); await flush(); const stopping = handle.stop();
  f.resolve(); await flush(); assert.equal((await stopping).transportClosedConfirmed, true);
  assert.equal(f.closes(), 1); assert.equal(f.events.some(event => event.type === 'session.ready'), false);
});
test('setup timeout retains late cleanup and never resolves ready', async () => {
  const f = fixture({ deferred: true }); const handle = f.open(); await flush(); f.fire(LIMITS.setupMs);
  await assert.rejects(handle.ready, { code: 'GEMINI_SETUP_TIMEOUT' }); f.resolve(); await flush(); assert.equal(f.closes(), 1);
});
test('close timeout reports uncertainty; late onclose updates the receipt', async () => {
  const f = fixture({ acknowledgeClose: false }); const handle = await f.start(); const one = handle.stop(); const two = handle.stop();
  assert.equal(one, two); f.fire(LIMITS.closeMs); assert.equal((await one).transportClosedConfirmed, false); assert.equal(f.closes(), 1);
  f.request().callbacks.onclose({}); assert.equal((await handle.stop()).transportClosedConfirmed, true);
  assert.equal(handle.status().providerFinalUsageConfirmed, false);
});
test('expiry stops even if timer callback is delayed; late provider output suppressed', async () => {
  const f = fixture(); const handle = await f.start(); f.advance(LIMITS.lifetimeMs);
  f.message({ serverContent: { outputTranscription: { text: 'expired' } } });
  assert.equal(f.closes(), 1); assert.equal(f.events.some(event => event.text === 'expired'), false);
  assert.throws(() => handle.sendPcm(pcm(2)), { code: 'GEMINI_SESSION_NOT_READY' });
});
test('tool calls, malformed content and unsupported audio terminate rather than execute', async () => {
  for (const message of [ { toolCall: { functionCalls: [{ name: 'save_chart' }] } }, { serverContent: { modelTurn: { parts: [{ functionCall: { name: 'save_chart' } }] } } },
    { serverContent: { modelTurn: { parts: [{ inlineData: { data: pcm(2), mimeType: 'audio/wav' } }] } } },
    { serverContent: { outputTranscription: { text: 'x'.repeat(LIMITS.transcriptChunkChars + 1) } } }, { goAway: {} } ]) {
    const f = fixture(); const handle = await f.start(); f.message(message); assert.equal(f.closes(), 1); assert.equal(f.sent.length, 0); await handle.stop();
  }
});
test('SDK error text is never exposed to event sink', async () => {
  const f = fixture(); const handle = await f.start(); f.request().callbacks.onerror({ message: 'PRIVATE PROVIDER DETAIL' });
  assert.equal(f.closes(), 1); assert.doesNotMatch(JSON.stringify(f.events), /PRIVATE/); await handle.stop();
});

test('fixed greeting can be sent only once; text cannot bypass PCM totals indefinitely', async () => {
  const f = fixture(); const handle = await f.start(); handle.sendGreeting();
  assert.throws(() => handle.sendGreeting(), { code: 'GEMINI_GREETING_ALREADY_SENT' });
  assert.equal(f.sent.length, 1); await handle.stop();
});
test('missing or malformed SDK handles retain explicit creation uncertainty', async () => {
  for (const value of [undefined, { sendRealtimeInput() {} }, { close() {} }]) {
    const timers = new Map(); let callbacks; let id = 0;
    const adapter = createGeminiLiveEvaluationTransport({ connectLive: async request => { callbacks = request.callbacks; return value; },
      setTimer(fn, ms) { timers.set(++id, { fn, ms }); return id; }, clearTimer: key => timers.delete(key) });
    const handle = adapter.open({ language: 'ig', onEvent() {} });
    await assert.rejects(handle.ready, { code: 'GEMINI_HANDLE_INVALID' });
    assert.equal(handle.status().creationPending, false);
    assert.equal(handle.status().creationOutcomeUncertain, true);
    const stop = handle.stop(); [...timers.values()].find(timer => timer.ms === LIMITS.closeMs).fn();
    assert.equal((await stop).transportClosedConfirmed, false);
    callbacks.onclose({}); assert.equal((await handle.stop()).transportClosedConfirmed, true);
    assert.equal(handle.status().providerFinalUsageConfirmed, false);
  }
});
test('invalid send method still retains a usable close handle', async () => {
  let callbacks; let closes = 0;
  const adapter = createGeminiLiveEvaluationTransport({ connectLive: async request => { callbacks = request.callbacks; return { close() { closes++; callbacks.onclose({}); } }; } });
  const handle = adapter.open({ language: 'yo', onEvent() {} });
  await assert.rejects(handle.ready, { code: 'GEMINI_HANDLE_INVALID' });
  assert.equal(closes, 1); assert.equal((await handle.stop()).transportClosedConfirmed, true);
  assert.equal(handle.status().creationOutcomeUncertain, true);
});
