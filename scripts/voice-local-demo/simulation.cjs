'use strict';
// A generated-tone fixture, never a provider implementation or speech sample.
const { GEMINI_LIVE_LANGUAGES } = require('../../shared/voiceLanguageCatalog.cjs');
const NOTICE = 'voice-live-synthetic-v1';
const IDENTITY = Object.freeze({ actorId: 'local-generated-tone-demo', sessionBinding: 'f'.repeat(64) });
const ORIGIN = 'https://local-voice-fixture.invalid';
const fault = () => new Error('The local generated-tone fixture could not continue.');
function toneBase64(frames = 6000) {
  const bytes = new Uint8Array(frames * 2), view = new DataView(bytes.buffer);
  for (let i = 0; i < frames; i++) {
    const envelope = Math.min(1, i / 240, (frames - 1 - i) / 240);
    view.setInt16(i * 2, Math.round(Math.sin(2 * Math.PI * 440 * i / 24000) * envelope * 983), true);
  }
  let raw = ''; for (const byte of bytes) raw += String.fromCharCode(byte);
  return btoa(raw);
}
function createSimulatedSocket({ url, protocol, language, now = Date.now, schedule = queueMicrotask, onMetrics = () => {} }) {
  const address = new URL(url);
  if (!Object.hasOwn(GEMINI_LIVE_LANGUAGES, language) || address.origin !== ORIGIN.replace('https:', 'wss:')
    || address.pathname !== '/api/voice-pcm-evaluation' || address.searchParams.get('language') !== language
    || address.searchParams.get('consentVersion') !== NOTICE || protocol !== `doctarx-pcm-v1.${IDENTITY.sessionBinding}`) throw fault();
  const listeners = new Map(); let sequence = 0, epoch = 0, greeting = false, replied = false, readyState = 0;
  const metrics = { generatedInputFrames: 0, generatedInputBytes: 0, outputToneAttempts: 0, injectedInterruptions: 0 };
  const emit = (name, extra = {}) => { for (const callback of [...listeners.get(name) || []]) callback({ currentTarget: socket, ...extra }); };
  const message = value => { if (socket.readyState === 1) emit('message', { data: JSON.stringify(value) }); };
  const report = () => { try { onMetrics({ ...metrics }); } catch { socket.close(); } };
  function reply(frames = 6000) {
    if (socket.readyState !== 1 || !greeting) return false;
    metrics.outputToneAttempts++; report();
    message({ type: 'transcript', speaker: 'assistant', text: `Generated tone for routing code ${language}. No speech or translation is being produced.` });
    message({ type: 'audio.pcm', data: toneBase64(frames), sampleRate: 24000, playbackEpoch: epoch });
    message({ type: 'turn.complete', playbackEpoch: epoch }); return socket.readyState === 1;
  }
  const socket = {
    get readyState() { return readyState; }, bufferedAmount: 0,
    addEventListener(name, callback) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(callback); },
    removeEventListener(name, callback) { listeners.get(name)?.delete(callback); },
    send(raw) {
      if (socket.readyState !== 1 || typeof raw !== 'string' || raw.length > 5000) throw fault();
      const value = JSON.parse(raw);
      if (value.sequence !== ++sequence) throw fault();
      if (value.type === 'greeting' && !greeting) { greeting = true; reply(); return; }
      if (value.type === 'capture.end') return;
      if (value.type !== 'audio.pcm' || typeof value.data !== 'string' || value.data.length !== 4268) throw fault();
      const decoded = atob(value.data); if (decoded.length !== 3200 || btoa(decoded) !== value.data || metrics.generatedInputFrames >= 300) throw fault();
      metrics.generatedInputFrames++; metrics.generatedInputBytes += decoded.length; report();
      if (metrics.generatedInputFrames === 5 && !replied) {
        replied = true; message({ type: 'transcript', speaker: 'user', text: 'Five generated input frames reached the simulated provider. No microphone was used.' }); reply();
      }
    },
    close() { if (socket.readyState === 3) return; readyState = 3; emit('close'); },
    reply: () => reply(24000),
    interrupt() { if (socket.readyState !== 1) return false; epoch++; metrics.injectedInterruptions++; report(); message({ type: 'playback.clear', playbackEpoch: epoch }); return true; },
    metrics: () => ({ ...metrics })
  };
  schedule(() => {
    if (socket.readyState !== 0) return;
    readyState = 1; emit('open');
    message({ type: 'session.ready', provider: 'google', model: 'gemini-3.8-live', language, dataClass: 'synthetic', consentVersion: NOTICE,
      sessionId: 'local-generated-tone-fixture', expiresAt: now() + 30000, ...IDENTITY });
  });
  return Object.freeze(socket);
}
module.exports = { createSimulatedSocket, toneBase64, IDENTITY, NOTICE, ORIGIN };
