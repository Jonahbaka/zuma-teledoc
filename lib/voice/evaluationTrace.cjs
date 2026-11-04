'use strict';
// Opt-in local metadata only. Call record only after observing the named event.
// This collector never requests devices, records audio/text, sends data, or
// attests that a provider or human observation actually occurred.
const TRACE_EVENTS = Object.freeze([
  'consent.granted', 'consent.withdrawn', 'start.attempted', 'start.denied', 'start.requested', 'provider.ready',
  'microphone.requested', 'microphone.started', 'microphone.stopped',
  'audio.input.sent', 'input.speech.ended', 'audio.output.queued', 'audio.output.started', 'audio.output.stopped',
  'interrupt.detected', 'playback.cleared', 'stop.requested', 'socket.closed', 'provider.closed',
  'provider.close_unconfirmed', 'captions.cleared', 'visibility.hidden', 'language.changed', 'session.expired',
  'audio.output.scheduled', 'audio.output.node_ended', 'playback.queue_drained', 'playback.clear_unconfirmed',
  'microphone.stop_unconfirmed', 'microphone.paused', 'microphone.resumed',
  'socket.close_requested', 'socket.close_unconfirmed', 'audio.contexts.closed', 'audio.contexts.close_unconfirmed',
]);
const invalid = () => Object.assign(new Error('Invalid local evaluation trace.'), { code: 'VOICE_EVALUATION_TRACE_INVALID' });
function createEvaluationTrace({ now = () => performance.now(), maxEvents = 5000, sessionRef = 'session-1' } = {}) {
  if (typeof now !== 'function' || !Number.isInteger(maxEvents) || maxEvents < 1 || maxEvents > 5000
    || typeof sessionRef !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(sessionRef)) throw invalid();
  const start = now(); if (!Number.isFinite(start)) throw invalid();
  let finished = false, last = 0; const events = [];
  const snapshot = () => events.map(event => Object.freeze({ ...event }));
  return Object.freeze({
    record(type) {
      if (finished || !TRACE_EVENTS.includes(type) || events.length >= maxEvents) throw invalid();
      const atMs = Math.floor(now() - start);
      if (!Number.isSafeInteger(atMs) || atMs < last || atMs > 600000) throw invalid();
      last = atMs; const event = Object.freeze({ type, atMs, sessionRef }); events.push(event); return event;
    },
    snapshot,
    finish() { finished = true; return Object.freeze(snapshot()); },
  });
}
module.exports = { TRACE_EVENTS, createEvaluationTrace };
