'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const source = fs.readFileSync(require.resolve('../../../components/video/LiveCaptionsOverlay.jsx'), 'utf8');
const start = source.indexOf('useEffect(() => {') + 'useEffect(() => {'.length;
const end = source.indexOf('}, [enabled, supported, resolvedSpeechLang, speakerLabel, translateOn, targetLang]);', start);
assert.ok(start > 0 && end > start, 'Exercise the shipped recognition effect');
const flush = () => new Promise(resolve => setImmediate(resolve));
function fixture(translateText = async () => 'fictional translation') {
  let recognition, lines = [], error, listening = false;
  const timers = new Map(); let timerId = 0;
  class Recognition {
    constructor() { recognition = this; this.starts = 0; this.aborts = 0; }
    start() { this.starts++; }
    abort() { this.aborts++; }
  }
  const bindings = { enabled: true, supported: true, resolvedSpeechLang: 'fr-FR', speakerLabel: 'Fictional speaker', translateOn: true,
    targetLang: 'en-US', recognitionRef: { current: null }, AbortController, getSpeechRecognition: () => Recognition,
    setError: value => { error = value; }, setListening: value => { listening = value; }, setInterim() {},
    pushLine: line => { lines = [...lines, line].slice(-6); }, setLines: update => { lines = update(lines); }, translateText,
    setTimeout(fn) { timers.set(++timerId, fn); return timerId; }, clearTimeout(id) { timers.delete(id); } };
  const cleanup = new Function(...Object.keys(bindings), source.slice(start, end))(...Object.values(bindings));
  const result = text => recognition.onresult({ resultIndex: 0, results: [Object.assign([{ transcript: text }], { isFinal: true })] });
  return { recognition, cleanup, result, timers, state: () => ({ lines, error, listening }),
    tick() { const pending = [...timers.values()]; timers.clear(); pending.forEach(fn => fn()); } };
}

test('caption fallback restarts transient recognition with delay and preserves selected language', () => {
  const f = fixture(); assert.equal(f.recognition.lang, 'fr-FR'); assert.equal(f.recognition.starts, 1);
  f.recognition.onend(); assert.equal(f.recognition.starts, 1); f.tick(); assert.equal(f.recognition.starts, 2); f.cleanup();
});
test('microphone refusal and unsupported language never cause a recognition restart loop', () => {
  for (const error of ['not-allowed', 'service-not-allowed', 'audio-capture', 'language-not-supported']) {
    const f = fixture(); f.recognition.onerror({ error }); f.recognition.onend(); f.tick();
    assert.equal(f.recognition.starts, 1); assert.equal(f.state().error, error); f.cleanup();
  }
});
test('leaving captions aborts capture and prevents delayed restart or stale recognition callbacks', () => {
  const f = fixture(), oldStart = f.recognition.onstart, oldResult = f.recognition.onresult;
  f.recognition.onend(); f.cleanup(); f.tick(); oldStart(); oldResult({ resultIndex: 0, results: [] });
  assert.equal(f.recognition.starts, 1); assert.equal(f.recognition.aborts, 1); assert.equal(f.state().listening, false);
  assert.equal(f.recognition.onresult, null); assert.deepEqual(f.state().lines, []);
});
test('leaving captions aborts active translation, drops queued text and ignores late replies', async () => {
  let finish, signal, calls = 0;
  const f = fixture(input => { calls++; signal = input.signal; return new Promise(resolve => { finish = resolve; }); });
  f.result('fictional first'); f.result('fictional second'); await flush(); assert.equal(calls, 1);
  f.cleanup(); assert.equal(signal.aborted, true); finish('late translation'); await flush();
  assert.equal(calls, 1); assert.ok(f.state().lines.every(line => line.translatedText === null));
});
test('slow translation retains at most six queued requests and exposes congestion', async () => {
  let finish; const f = fixture(() => new Promise(resolve => { finish = resolve; }));
  for (let index = 0; index < 20; index++) f.result('fictional ' + index);
  await flush(); assert.equal(f.state().error, 'translation_busy'); assert.equal(f.state().lines.length, 6);
  f.cleanup(); finish(null); await flush();
});
test('translation failure keeps original text and does not label it as translated', async () => {
  const f = fixture(async () => null); f.result('fictional source'); await flush();
  assert.equal(f.state().error, 'translation_unavailable'); assert.equal(f.state().lines[0].text, 'fictional source');
  assert.equal(f.state().lines[0].translatedText, null); f.cleanup();
});
