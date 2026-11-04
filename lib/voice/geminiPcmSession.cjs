'use strict';
const { createVoicePcmAudioGraph } = require('./pcmAudioGraph.cjs');
const { GEMINI_LIVE_LANGUAGES } = require('../../shared/voiceLanguageCatalog.cjs');
const { createLocalObservation } = require('./localObservation.cjs');
const NOTICE = 'voice-live-synthetic-v1', PATH = '/api/voice-pcm-evaluation';
const terminalError = () => {};
const closeLateOpen = event => { try { event.currentTarget.close(); } catch {} };
const fault = code => Object.assign(new Error('The fictional voice session could not continue.'), { code });

// Unmounted browser controller. Factories are supplied by the future panel;
// this module cannot read tokens, request a key, or activate a backend route.
function createGeminiPcmSession({ origin, createSocket, mediaDevices, createContext, createWorkletNode,
  onState = () => {}, onTranscript = () => {}, onError = () => {}, onObservation, now = Date.now,
  setTimer = setTimeout, clearTimer = clearTimeout, pageTarget, documentTarget } = {}) {
  if (typeof createSocket !== 'function' || typeof mediaDevices?.getUserMedia !== 'function') throw fault('PCM_CLIENT_UNCONFIGURED');
  const address = new URL(origin); if (address.protocol !== 'https:' || address.origin !== origin) throw fault('PCM_ORIGIN_INVALID');
  let current = null, generation = 0, stateSinkFailed = false, lastCleanup;
  const observation = createLocalObservation(onObservation), observe = observation.emit;
  const emit = value => {
    if (stateSinkFailed) return;
    try { onState(value); } catch { stateSinkFailed = true; void stop(); }
  };
  const error = code => { try { onError(code); } catch {} };
  const owned = r => current === r && !r.closed && r.generation === generation;
  const fresh = r => owned(r) && (!r.expiresAt || now() < r.expiresAt);
  const stopTracks = stream => {
    let tracks;
    try { tracks = stream?.getTracks?.() || []; } catch { return false; }
    for (const track of tracks) { try { track.enabled = false; track.stop(); } catch {} }
    return tracks.every(track => track.readyState === 'ended');
  };
  function send(r, type, data) {
    const payload = JSON.stringify({ type, sequence: r.sequence + 1, ...(data === undefined ? {} : { data }) });
    if (!fresh(r) || r.socket.readyState !== 1 || !Number.isSafeInteger(r.socket.bufferedAmount)
      || r.socket.bufferedAmount < 0 || r.socket.bufferedAmount + payload.length > 16000) throw fault('PCM_CLIENT_BACKPRESSURE');
    r.sequence++; r.socket.send(payload); if (type === 'audio.pcm') observe('audio.input.sent');
  }
  function release(r, reason = 'stopped', remember = false) {
    if (!r || r.closed) return r?.cleanup || Promise.resolve({ tracksStopped: true, contextsClosed: true });
    // Keep a stable receipt even if observation/state callbacks reenter Stop.
    let resolveCleanup; r.cleanup = new Promise(resolve => { resolveCleanup = resolve; });
    if (remember) lastCleanup = r.cleanup;
    r.closed = true;
    if (remember && reason === 'stopped') observe('stop.requested');
    clearTimer(r.setup); clearTimer(r.expiry); const tracksStopped = stopTracks(r.stream) && !r.mediaPending;
    pageTarget?.removeEventListener?.('pagehide', r.pagehide); documentTarget?.removeEventListener?.('visibilitychange', r.visibility);
    r.socket?.addEventListener?.('error', terminalError); r.socket?.addEventListener?.('open', closeLateOpen);
    for (const [name, listener] of Object.entries(r.listeners)) r.socket?.removeEventListener?.(name, listener);
    if (r.observedClose && !r.closeSeen) {
      // An actual browser close event is distinct from requesting close. The
      // extra observer exists only when explicitly opted in, and is bounded.
      r.closeObservationDeadline = setTimer(() => {
        r.socket?.removeEventListener?.('close', r.observedClose);
        observe('socket.close_unconfirmed');
      }, 3000);
      r.closeObservationDeadline?.unref?.();
    }
    if (r.socket) { observe('socket.close_requested'); observe('provider.close_unconfirmed'); }
    try { r.socket.close(1000, 'Fictional evaluation ended'); } catch {}
    if (!r.graph && r.mediaRequested) observe(tracksStopped ? 'microphone.stopped' : 'microphone.stop_unconfirmed');
    r.reject(fault(reason));
    try {
      const cleanup = r.graph?.stop() || { tracksStopped, contextsClosed: true, ...(r.mediaPending ? { permissionPending: true } : {}) };
      Promise.resolve(cleanup).then(resolveCleanup, () => resolveCleanup({ tracksStopped: false, contextsClosed: false }));
    } catch { resolveCleanup({ tracksStopped: false, contextsClosed: false }); }
    return r.cleanup;
  }
  async function stop() {
    generation++; const r = current; current = null;
    // A second Stop must not replace uncertain cleanup with an empty success.
    const cleanup = r ? release(r, 'stopped', true) : lastCleanup || release(null); lastCleanup = cleanup;
    emit('stopped'); return await cleanup;
  }
  function fail(r, code) {
    if (!owned(r)) { void release(r, code); return; }
    generation++; current = null; lastCleanup = release(r, code, true); emit('failed'); error(code);
  }
  async function prepareMedia(r, event) {
    try {
      if (r.readySeen || event.provider !== 'google' || event.model !== 'gemini-3.8-live' || event.language !== r.language
        || event.actorId !== r.expectedActorId || event.sessionBinding !== r.expectedSessionBinding
        || event.dataClass !== 'synthetic' || event.consentVersion !== NOTICE || typeof event.sessionId !== 'string'
        || !Number.isSafeInteger(event.expiresAt) || event.expiresAt <= now() || event.expiresAt - now() > 180000) throw fault('PCM_SERVER_PERMIT_INVALID');
      r.readySeen = true; r.expiresAt = event.expiresAt;
      observe('provider.ready');
      if (!fresh(r)) return;
      r.expiry = setTimer(() => { if (current === r) { observe('session.expired'); fail(r, 'PCM_SESSION_EXPIRED'); } }, r.expiresAt - now());
      emit('requesting_microphone');
      if (!fresh(r)) return;
      r.mediaRequested = true; observe('microphone.requested');
      if (!fresh(r)) return;
      r.mediaPending = true; let stream;
      try { stream = await mediaDevices.getUserMedia({ video: false, audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } }); }
      finally { r.mediaPending = false; }
      if (!fresh(r)) { observe(stopTracks(stream) ? 'microphone.stopped' : 'microphone.stop_unconfirmed'); return; }
      r.stream = stream; for (const track of stream.getTracks()) track.enabled = false;
      r.graph = createVoicePcmAudioGraph({ stream, createContext, createWorkletNode, expiresAt: r.expiresAt, now, setTimer, clearTimer, onObservation: observe,
        onInputPcm(bytes) {
          let raw = ''; for (const byte of bytes) raw += String.fromCharCode(byte);
          send(r, 'audio.pcm', btoa(raw));
        },
        // An expired graph still owns this session. Do not wait for a separate
        // timer before ending its socket and caller-owned generated resources.
        onState(state) { if (state.phase === 'closed' && owned(r)) fail(r, 'PCM_LOCAL_AUDIO_STOPPED'); } });
      if (r.speakerPaused) r.graph.pausePlayback();
      await r.graph.start(); if (!fresh(r)) { await r.graph.stop(); return; }
      r.graph.setCaptureEnabled(!r.microphonePaused);
      if (!r.microphonePaused) { r.captureObserved = true; observe('microphone.started'); }
      if (!fresh(r)) { await r.graph.stop(); return; }
      r.active = true; clearTimer(r.setup);
      send(r, 'greeting'); emit(r.speakerPaused ? 'speaker_paused' : 'listening'); r.resolve({ language: r.language, expiresAt: r.expiresAt });
    } catch (failure) { fail(r, failure.code || 'PCM_MICROPHONE_UNAVAILABLE'); }
  }
  function message(r, event) {
    if (!fresh(r)) { fail(r, 'PCM_SESSION_EXPIRED'); return; }
    try {
      if (typeof event.data !== 'string' || event.data.length > 70000) throw fault('PCM_SERVER_MESSAGE_INVALID');
      const value = JSON.parse(event.data);
      if (value?.type === 'session.ready') { void prepareMedia(r, value); return; }
      if (!r.active || !r.graph) throw fault('PCM_SERVER_MESSAGE_EARLY');
      if (value.type === 'playback.clear') {
        if (!Number.isSafeInteger(value.playbackEpoch) || value.playbackEpoch < r.playbackEpoch) throw fault('PCM_SERVER_EPOCH_INVALID');
        r.playbackEpoch = value.playbackEpoch; r.graph.clearPlayback(value.playbackEpoch);
      } else if (value.type === 'audio.pcm') {
        if (value.sampleRate !== 24000 || value.playbackEpoch !== r.playbackEpoch || typeof value.data !== 'string' || value.data.length > 64000) throw fault('PCM_SERVER_AUDIO_INVALID');
        const raw = atob(value.data); if (btoa(raw) !== value.data || !raw.length || raw.length % 2 || raw.length > 48000) throw fault('PCM_SERVER_AUDIO_INVALID');
        const bytes = Uint8Array.from(raw, character => character.charCodeAt(0)); r.graph.enqueuePcm(bytes, value.playbackEpoch);
      } else if (value.type === 'transcript') {
        if (!['user', 'assistant'].includes(value.speaker) || typeof value.text !== 'string' || value.text.length > 4096 || (r.transcriptChars += value.text.length) > 32768) throw fault('PCM_TRANSCRIPT_INVALID');
        onTranscript({ speaker: value.speaker, text: value.text, language: r.language, provisional: true, clinicalReviewed: false });
      } else if (value.type !== 'turn.complete') throw fault('PCM_SERVER_MESSAGE_INVALID');
    } catch (failure) { fail(r, failure.code || 'PCM_SERVER_MESSAGE_INVALID'); }
  }
  function start({ language, consentAcknowledged, consentVersion, expectedActorId, expectedSessionBinding } = {}) {
    if (stateSinkFailed) return Promise.reject(fault('PCM_STATE_SINK_FAILED'));
    if (documentTarget?.visibilityState === 'hidden') return Promise.reject(fault('PCM_PAGE_HIDDEN'));
    if (current) return Promise.reject(fault('PCM_SESSION_EXISTS'));
    if (!Object.hasOwn(GEMINI_LIVE_LANGUAGES, language) || consentAcknowledged !== true || consentVersion !== NOTICE) return Promise.reject(fault('PCM_CONSENT_REQUIRED'));
    if (typeof expectedActorId !== 'string' || !expectedActorId.length || expectedActorId.length > 128
      || typeof expectedSessionBinding !== 'string' || !/^[a-f0-9]{64}$/.test(expectedSessionBinding)) return Promise.reject(fault('PCM_IDENTITY_REQUIRED'));
    const url = new URL(PATH, origin); url.protocol = 'wss:'; url.searchParams.set('language', language); url.searchParams.set('consentVersion', NOTICE);
    const r = { generation: ++generation, language, expectedActorId, expectedSessionBinding, sequence: 0, playbackEpoch: 0, transcriptChars: 0, active: false, closed: false, listeners: {} };
    current = r; const ready = new Promise((resolve, reject) => { r.resolve = resolve; r.reject = reject; }); ready.catch(() => {});
    try {
      observe('consent.granted'); if (!fresh(r)) return ready;
      observe('start.requested'); if (!fresh(r)) return ready;
      r.socket = createSocket(url.href, `doctarx-pcm-v1.${expectedSessionBinding}`); r.listeners = { message: event => message(r, event), close: () => fail(r, 'PCM_CONNECTION_CLOSED'), error: () => fail(r, 'PCM_CONNECTION_FAILED') };
      if (typeof onObservation === 'function') {
        r.observedClose = () => { if (r.closeSeen) return; r.closeSeen = true; clearTimer(r.closeObservationDeadline); r.socket.removeEventListener('close', r.observedClose); observe('socket.closed'); };
        r.socket.addEventListener('close', r.observedClose);
      }
      for (const [name, listener] of Object.entries(r.listeners)) r.socket.addEventListener(name, listener);
      r.pagehide = () => { if (current === r) { observe('visibility.hidden'); void stop(); } }; r.visibility = () => { if (documentTarget.visibilityState === 'hidden' && current === r) { observe('visibility.hidden'); void stop(); } };
      pageTarget?.addEventListener?.('pagehide', r.pagehide); documentTarget?.addEventListener?.('visibilitychange', r.visibility);
      r.setup = setTimer(() => { if (current === r) fail(r, 'PCM_START_TIMEOUT'); }, 15000); emit('authorizing');
    } catch { fail(r, 'PCM_SOCKET_UNAVAILABLE'); }
    return ready;
  }
  function setMicrophonePaused(paused) {
    const r = current; if (!r || !fresh(r)) return;
    r.microphonePaused = paused === true;
    if (r.active) {
      try {
        r.graph.setCaptureEnabled(!r.microphonePaused);
        if (!r.microphonePaused && !r.captureObserved) { r.captureObserved = true; observe('microphone.started'); }
        else if (r.captureObserved) observe(r.microphonePaused ? 'microphone.paused' : 'microphone.resumed');
        if (fresh(r) && r.microphonePaused) send(r, 'capture.end');
      } catch { fail(r, 'PCM_CAPTURE_FAILED'); }
    }
  }
  function pauseSpeaker() { const r = current; if (!r || !fresh(r)) return; r.speakerPaused = true; r.graph?.pausePlayback(); if (fresh(r)) emit('speaker_paused'); }
  async function resumeSpeaker() { const r = current; if (!r?.active || !fresh(r)) return false; const resumed = await r.graph.resumePlayback(); if (!fresh(r) || !resumed) return false; r.speakerPaused = false; emit('listening'); return true; }
  return Object.freeze({ start, stop, setMicrophonePaused, pauseSpeaker, resumeSpeaker, observationStatus: observation.status });
}
module.exports = { createGeminiPcmSession };
