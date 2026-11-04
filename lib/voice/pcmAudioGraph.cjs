'use strict';
const { createLocalObservation } = require('./localObservation.cjs');
// Unmounted browser media building block. Its caller owns authenticated consent,
// server leases and getUserMedia. This module never requests a microphone or
// contacts a provider; supplied tracks and contexts become exclusively owned.
const WORKLET_URL = '/voice/pcm-capture-worklet.js';
const fail = code => Object.assign(new Error('Voice audio could not continue.'), { code });
function createVoicePcmAudioGraph({ stream, createContext, createWorkletNode, onInputPcm, onState = () => {}, onObservation, expiresAt, now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  const tracks = stream?.getAudioTracks?.(), allTracks = stream?.getTracks?.();
  if (!Array.isArray(tracks) || !Array.isArray(allTracks) || allTracks.length !== tracks.length || allTracks.some(track => track?.kind !== 'audio' || !tracks.includes(track)) || !tracks.length || tracks.some(track => track?.readyState !== 'live' || typeof track.stop !== 'function') || typeof createContext !== 'function' || typeof createWorkletNode !== 'function' || typeof onInputPcm !== 'function'
    || !Number.isSafeInteger(expiresAt) || expiresAt <= now() || expiresAt - now() > 180000) throw fail('PCM_AUDIO_NOT_AUTHORIZED');
  let phase = 'idle', capture = false, captureEpoch = 0, paused = false, playbackEpoch = 0, playbackAction = 0, nextPlayAt = 0, inputBytes = 0, lastSequence = 0;
  let captureContext, playbackContext, source, worklet, expiryTimer, closePromise, playbackClearUnconfirmed = false;
  const sources = new Set();
  // Optional local metadata sink. Never send PCM, transcript, identity or keys.
  // Instrumentation must not interfere with media ownership or cleanup.
  const observation = createLocalObservation(onObservation), observe = observation.emit;
  const live = () => phase !== 'closed' && now() < expiresAt;
  const emit = state => { try { onState(state); } catch { stop('state_sink_failed'); } };
  const timer = (fn, ms) => { const id = setTimer(fn, ms); id?.unref?.(); return id; };
  function clearPlayback(epoch = playbackEpoch) {
    if (!Number.isSafeInteger(epoch) || epoch < playbackEpoch) return;
    playbackEpoch = epoch; nextPlayAt = 0;
    let confirmed = true;
    for (const node of sources) { node.onended = null; try { node.stop(); } catch { confirmed = false; } try { node.disconnect(); } catch { confirmed = false; } }
    sources.clear();
    if (!confirmed) playbackClearUnconfirmed = true;
    observe(playbackClearUnconfirmed ? 'playback.clear_unconfirmed' : 'playback.cleared');
    // Do not mix a new turn with output we could not stop or disconnect. End
    // local capture and close the owning contexts; their receipt remains the
    // only confirmation of cleanup. Stop calls this method too.
    if (!confirmed && phase !== 'closed') stop('playback_clear_failed');
  }
  function disableCapture() {
    capture = false; captureEpoch++;
    for (const track of tracks) { try { track.enabled = false; } catch {} }
    try { worklet?.port.postMessage({ type: 'capture', enabled: false, epoch: captureEpoch }); } catch {}
  }
  function stop(reason = 'stopped') {
    if (phase === 'closed') return closePromise;
    // Publish one cleanup operation before any callback can reenter Stop.
    // The terminal state is synchronous; context confirmation remains async.
    let resolveClose; closePromise = new Promise(resolve => { resolveClose = resolve; });
    phase = 'closed'; playbackAction++; clearTimer(expiryTimer); disableCapture(); clearPlayback();
    try { worklet?.port.postMessage({ type: 'stop' }); } catch {}
    if (worklet) { worklet.port.onmessage = null; worklet.onprocessorerror = null; }
    for (const context of [captureContext, playbackContext]) if (context) context.onstatechange = null;
    for (const node of [source, worklet]) { try { node?.disconnect(); } catch {} }
    for (const track of tracks) { track.removeEventListener?.('ended', deviceEnded); try { track.stop(); } catch {} }
    observe(tracks.every(track => track.readyState === 'ended') ? 'microphone.stopped' : 'microphone.stop_unconfirmed');
    emit({ phase: 'closed', reason });
    void (async () => {
      let deadline;
      const closes = [captureContext, playbackContext].filter(Boolean).map(context => Promise.resolve().then(() => context.close()));
      try {
        const result = await Promise.race([Promise.allSettled(closes), new Promise(resolve => { deadline = timer(() => resolve(null), 1500); })]);
        const contextsClosed = Array.isArray(result) && result.every(item => item.status === 'fulfilled');
        observe(contextsClosed ? 'audio.contexts.closed' : 'audio.contexts.close_unconfirmed');
        if (contextsClosed && playbackClearUnconfirmed) { playbackClearUnconfirmed = false; observe('playback.cleared'); }
        return { tracksStopped: tracks.every(track => track.readyState === 'ended'), contextsClosed };
      } finally { clearTimer(deadline); }
    })().then(resolveClose, () => resolveClose({ tracksStopped: tracks.every(track => track.readyState === 'ended'), contextsClosed: false }));
    return closePromise;
  }
  function deviceEnded() { stop('microphone_ended'); }
  for (const track of tracks) { track.enabled = false; track.addEventListener?.('ended', deviceEnded); }
  expiryTimer = timer(() => stop('expired'), expiresAt - now());
  async function start() {
    if (phase !== 'idle' || !live()) { if (!live()) stop('expired'); throw fail('PCM_AUDIO_NOT_READY'); }
    phase = 'starting';
    try {
      captureContext = createContext({ sampleRate: 16000, latencyHint: 'interactive' });
      playbackContext = createContext({ sampleRate: 24000, latencyHint: 'interactive' });
      for (const context of [captureContext, playbackContext]) context.onstatechange = () => { if (phase === 'ready' && context.state !== 'running') stop('audio_context_interrupted'); };
      if (captureContext.sampleRate !== 16000 || playbackContext.sampleRate !== 24000) throw fail('PCM_CONTEXT_RATE_UNSUPPORTED');
      await captureContext.audioWorklet.addModule(WORKLET_URL);
      if (!live()) throw fail('PCM_AUDIO_STOPPED');
      source = captureContext.createMediaStreamSource(stream);
      worklet = createWorkletNode(captureContext, 'doctarx-pcm16-capture', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
      worklet.port.onmessage = ({ data }) => {
        if (!live()) { stop('expired'); return; }
        if (data?.type === 'error') { stop('capture_processor_failed'); return; }
        if (!Number.isSafeInteger(data?.epoch) || data.epoch < 0) { stop('capture_frame_invalid'); return; }
        if (data?.type !== 'pcm16' || !(data.buffer instanceof ArrayBuffer) || data.buffer.byteLength !== 3200 || !Number.isSafeInteger(data.sequence) || data.sequence <= lastSequence) { stop('capture_frame_invalid'); return; }
        lastSequence = data.sequence;
        if (phase !== 'ready' || !capture || data.epoch !== captureEpoch) {
          try { worklet.port.postMessage({ type: 'ack', epoch: data.epoch, sequence: data.sequence }); } catch { stop('capture_control_failed'); }
          return;
        }
        inputBytes += data.buffer.byteLength;
        if (inputBytes > 5760000) { stop('capture_duration_limit'); return; }
        try {
          const result = onInputPcm(new Uint8Array(data.buffer));
          if (result && typeof result.then === 'function') { Promise.resolve(result).catch(() => {}); stop('async_input_sink_unsupported'); return; }
          worklet.port.postMessage({ type: 'ack', epoch: data.epoch, sequence: data.sequence });
        } catch { stop('input_sink_failed'); }
      };
      worklet.onprocessorerror = () => stop('capture_processor_failed');
      source.connect(worklet); worklet.connect(captureContext.destination);
      await captureContext.resume();
      if (!live()) throw fail('PCM_AUDIO_STOPPED');
      // Start is called from the user's gesture; the browser may still reject
      // playback. No audio or microphone is automatically resumed later.
      const action = ++playbackAction;
      await playbackContext.resume();
      if (!live()) throw fail('PCM_AUDIO_STOPPED');
      if (captureContext.state !== 'running' || playbackContext.state !== 'running') throw fail('PCM_CONTEXT_NOT_RUNNING');
      if (action !== playbackAction) { phase = 'ready'; emit({ phase, speakerPaused: paused }); return; }
      phase = 'ready'; emit({ phase, speakerPaused: paused });
    } catch (error) { await stop(error.code || 'audio_start_failed'); throw fail(error.code || 'PCM_AUDIO_START_FAILED'); }
  }
  function setCaptureEnabled(enabled) {
    if (!live() || phase !== 'ready') { if (!live()) stop('expired'); throw fail('PCM_AUDIO_NOT_READY'); }
    try {
      capture = enabled === true; captureEpoch++;
      worklet.port.postMessage({ type: 'capture', enabled: capture, epoch: captureEpoch });
      for (const track of tracks) track.enabled = capture;
    } catch { stop('capture_control_failed'); throw fail('PCM_CAPTURE_CONTROL_FAILED'); }
  }
  function pausePlayback() { playbackAction++; paused = true; clearPlayback(); emit({ phase, speakerPaused: true }); }
  async function resumePlayback() {
    if (!live() || phase !== 'ready') throw fail('PCM_AUDIO_NOT_READY');
    const action = ++playbackAction;
    try { await playbackContext.resume(); } catch { stop('playback_resume_failed'); throw fail('PCM_PLAYBACK_RESUME_FAILED'); }
    if (!live() || phase !== 'ready' || action !== playbackAction) return false;
    if (playbackContext.state !== 'running') { stop('playback_context_interrupted'); return false; }
    paused = false; emit({ phase, speakerPaused: false }); return true;
  }
  function enqueuePcm(bytes, epoch) {
    if (!live()) { stop('expired'); return false; }
    if (phase !== 'ready' || paused || epoch !== playbackEpoch) return false;
    if (!(bytes instanceof Uint8Array) || !bytes.byteLength || bytes.byteLength % 2 || bytes.byteLength > 48000) { stop('playback_frame_invalid'); return false; }
    const startAt = Math.max(playbackContext.currentTime + 0.01, nextPlayAt);
    const duration = bytes.byteLength / 48000;
    if (sources.size >= 32 || startAt + duration - playbackContext.currentTime > 2) { stop('playback_queue_limit'); return false; }
    try {
      const buffer = playbackContext.createBuffer(1, bytes.byteLength / 2, 24000), samples = buffer.getChannelData(0), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      for (let i = 0; i < samples.length; i++) samples[i] = view.getInt16(i * 2, true) / 32768;
      const node = playbackContext.createBufferSource(); node.buffer = buffer; node.connect(playbackContext.destination);
      node.onended = () => { sources.delete(node); try { node.disconnect(); } catch {} observe('audio.output.node_ended'); if (!sources.size) observe('playback.queue_drained'); };
      sources.add(node); node.start(startAt); nextPlayAt = startAt + duration;
      observe('audio.output.scheduled'); return true;
    } catch { stop('playback_failed'); return false; }
  }
  return Object.freeze({ start, setCaptureEnabled, enqueuePcm, clearPlayback, pausePlayback, resumePlayback, stop,
    observationStatus: observation.status,
    status: () => Object.freeze({ phase, captureEnabled: capture, captureEpoch, speakerPaused: paused, playbackEpoch, queuedSources: sources.size }) });
}
module.exports = { createVoicePcmAudioGraph, WORKLET_URL };
