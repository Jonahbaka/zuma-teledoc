'use strict';
const LEASE_RENEWAL_TIMEOUT_MS = 4000, LEASE_RENEWAL_INTERVAL_MS = 5000;

// Actual browser media implementation. Imported by the separate live panel;
// the shipped backend refuses permits, so no microphone can open there.
// Native duplex audio stays on WebRTC; transcript callbacks are independent.
function createLiveWebRtcSession({ broker, mediaDevices, PeerConnection, MediaStreamClass, audioElement, onState = () => {}, onTranscript = () => {}, onError = () => {}, onCleanup = () => {}, now = Date.now, AbortControllerClass = globalThis.AbortController, timers = {
  setTimeout: (...args) => globalThis.setTimeout(...args), clearTimeout: (...args) => globalThis.clearTimeout(...args),
  setInterval: (...args) => globalThis.setInterval(...args), clearInterval: (...args) => globalThis.clearInterval(...args),
} }) {
  let epoch = 0, state = 'idle', current = null, lastStopped = null;
  const notifyError = message => { try { onError(message); } catch {} };
  const emit = next => { state = next; try { onState(next); } catch { if (current) void stop(); } };
  const emptyReceipt = Object.freeze({ tracksStopped: true, playbackStopped: true, transportClosed: true, providerCleanupConfirmed: true, providerFinalUsageConfirmed: false, permissionPending: false, cleanupPending: false });
  function receipt(resource) {
    return Object.freeze({ ...resource.cleanup, permissionPending: resource.capturePending === true, cleanupPending: resource.cleanupSettled === false });
  }
  function reportCleanup(resource) {
    const result = receipt(resource);
    try { onCleanup(result); } catch {}
    return result;
  }
  function refreshCleanup(resource) {
    const result = reportCleanup(resource);
    if (resource.cleanupSettled) resource.cleanupPromise = Promise.resolve(result);
  }
  function closeTransports(resource) {
    try { resource.channel?.close(); } catch { resource.cleanup.transportClosed = false; }
    try { resource.peer?.close(); } catch { resource.cleanup.transportClosed = false; }
  }
  function stopTrack(track) {
    let released = true;
    try { track.enabled = false; } catch { released = false; }
    // One device throwing must not prevent release of the other tracks, the
    // speaker, the server-owned session or the peer connection.
    try { track.stop(); } catch { released = false; }
    try { if (track.readyState !== undefined && track.readyState !== 'ended') released = false; } catch { released = false; }
    return released;
  }
  function silence(resource, stream = resource?.stream) {
    if (!resource) return;
    if (stream) {
      try { for (const track of stream.getTracks()) if (!stopTrack(track)) resource.cleanup.tracksStopped = false; }
      catch { resource.cleanup.tracksStopped = false; }
    }
    if (resource.outputStream) {
      // Never detach a replacement session's speaker from a late old cleanup.
      try {
        if (audioElement.srcObject === resource.outputStream) {
          try { audioElement.pause(); } catch { resource.cleanup.playbackStopped = false; }
          try { audioElement.srcObject = null; } catch { resource.cleanup.playbackStopped = false; }
        }
      } catch { resource.cleanup.playbackStopped = false; }
    }
    for (const track of resource.outputTracks) if (!stopTrack(track)) resource.cleanup.playbackStopped = false;
    resource.outputTracks.clear();
  }
  const owned = resource => current === resource && !resource.closed;
  function cancelRenewal(resource) {
    const request = resource.leaseRequest;
    if (!request) return;
    resource.leaseRequest = null; timers.clearTimeout(request.timer);
    // Aborting browser HTTP is not proof that the server canceled its work.
    // Session cleanup remains the separate server-owned Stop operation.
    try { request.controller.abort(); } catch {}
  }
  function renewalTimedOut(resource, request) {
    if (!owned(resource) || resource.leaseRequest !== request) return;
    notifyError('Voice permission renewal timed out. Ending the voice session.'); void stop();
  }
  function fresh(resource) {
    if (!owned(resource)) return false;
    // Timer callbacks can be delayed by a suspended tab. Never enable capture
    // or speaker playback after the permit expires, even before the timer runs.
    if (resource.permit && now() >= resource.permit.expiresAt) { void stop(); return false; }
    if (resource.leaseRequest && now() >= resource.leaseRequest.deadlineAt) { renewalTimedOut(resource, resource.leaseRequest); return false; }
    return true;
  }
  async function play(resource, explicit = false) {
    if (!resource?.connected || !fresh(resource) || resource.playbackPaused && !explicit) return;
    const action = ++resource.playbackEpoch;
    if (explicit) resource.playbackPaused = false;
    try {
      await audioElement.play();
      if (!fresh(resource)) return;
      if (resource.playbackEpoch !== action) {
        if (resource.playbackPaused) audioElement.pause();
        return;
      }
      resource.playbackPaused = false;
      if (explicit) emit('listening');
    } catch {
      if (!fresh(resource) || resource.playbackEpoch !== action) return;
      resource.playbackPaused = true; emit('playback_blocked');
      if (explicit) notifyError('Select Resume speaker to hear the assistant.');
    }
  }
  function release(resource, retryProvider = false) {
    if (!resource) return Promise.resolve(emptyReceipt);
    if (resource.cleanupPromise && !retryProvider) return resource.cleanupPromise;
    // Publish the stable promise before any callback or asynchronous provider
    // close. Repeated Stop/pagehide/visibilitychange share this same receipt.
    let complete;
    const pending = new Promise(resolve => { complete = resolve; });
    resource.cleanupPromise = pending;
    const cleanupRound = (resource.cleanupRound || 0) + 1; resource.cleanupRound = cleanupRound;
    resource.closed = true; resource.cleanupSettled = false;
    if (resource.permit) resource.cleanup.providerCleanupConfirmed = false;
    silence(resource);
    // If local muting/release fails, do not leave an enabled track connected
    // while a slow server close is pending. The sideband can finalize without
    // the browser peer, and the UI needs the local warning immediately.
    if (!resource.cleanup.tracksStopped || !resource.cleanup.playbackStopped) closeTransports(resource);
    if (!resource.cleanup.tracksStopped || !resource.cleanup.playbackStopped || resource.capturePending) reportCleanup(resource);
    timers.clearTimeout(resource.expiry); timers.clearTimeout(resource.startTimeout); timers.clearInterval(resource.lease); cancelRenewal(resource);
    resource.cancelIce?.();
    void (async () => {
      let finalizationTimeout;
      try {
        if (resource.permit) {
          resource.cleanup.providerCleanupConfirmed = false;
          const result = await Promise.race([
            broker.stop(resource.permit.permitId),
            new Promise((_, reject) => { finalizationTimeout = timers.setTimeout(() => reject(new Error('Voice close timed out.')), 17000); }),
          ]);
          if (resource.cleanupRound === cleanupRound) resource.cleanup.providerCleanupConfirmed = result?.providerCleanupConfirmed === true;
          // No close receipt is evidence of final accounting by itself.
          if (!resource.cleanup.providerCleanupConfirmed) notifyError('Provider termination is not yet confirmed.');
        }
      } catch { if (resource.cleanupRound === cleanupRound) resource.cleanup.providerCleanupConfirmed = false; notifyError('Server termination could not be confirmed.'); }
      finally {
        timers.clearTimeout(finalizationTimeout);
        closeTransports(resource);
        if (resource.cleanupRound === cleanupRound) resource.cleanupSettled = true;
        complete(reportCleanup(resource));
      }
    })();
    return pending;
  }
  function stop() {
    if (!current) return lastStopped ? release(lastStopped) : Promise.resolve(emptyReceipt);
    epoch++; const resource = current; current = null; lastStopped = resource;
    // release synchronously silences local media, before waiting on server I/O.
    const ending = release(resource); emit('stopped'); return ending;
  }
  async function start({ language, consentVersion, consentAcknowledged }) {
    if (!['idle', 'stopped', 'failed'].includes(state)) return;
    if (!consentAcknowledged) { notifyError('Consent is required before opening the microphone.'); return; }
    const captured = ++epoch;
    const resource = { permit: null, stream: null, peer: null, channel: null, closed: false, connected: false, playbackPaused: false, playbackEpoch: 0, capturePending: false, outputTracks: new Set(), cleanup: { ...emptyReceipt } };
    current = resource; emit('authorizing');
    const isFresh = () => captured === epoch && fresh(resource);
    try {
      if (!isFresh()) return;
      resource.permit = await broker.reserve({ language, consentVersion });
      if (!isFresh()) { await release(resource, true); return; }
      if (resource.permit.language !== language || resource.permit.dataClass !== 'synthetic' || resource.permit.provider !== 'openai-gpt-live' || !Number.isSafeInteger(resource.permit.expiresAt) || resource.permit.expiresAt <= now()) throw new Error('Unapproved voice permit.');
      resource.expiry = timers.setTimeout(() => { if (isFresh()) void stop(); }, resource.permit.expiresAt - now());
      emit('requesting_microphone');
      if (!isFresh()) return;
      resource.capturePending = true;
      let stream, captureFailure, captureRejected = false;
      try { stream = await mediaDevices.getUserMedia({ video: false, audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } }); }
      catch (failure) { captureRejected = true; captureFailure = failure; }
      finally { resource.capturePending = false; }
      if (captureRejected) {
        if (!isFresh()) { refreshCleanup(resource); return; }
        throw captureFailure;
      }
      // Permission can resolve after cancel, logout or a second start.
      if (!isFresh()) { silence(resource, stream); refreshCleanup(resource); return; }
      resource.stream = stream;
      stream.getTracks().forEach(track => {
        track.enabled = false;
        track.addEventListener?.('ended', () => { if (isFresh()) { notifyError('Microphone permission or device connection ended.'); void stop(); } });
      });
      const peer = new PeerConnection({ iceServers: [] }); resource.peer = peer;
      const channel = peer.createDataChannel('oai-events'); resource.channel = channel;
      peer.addEventListener('track', event => {
        if (!isFresh()) { if (!stopTrack(event.track)) { resource.cleanup.playbackStopped = false; refreshCleanup(resource); } return; }
        resource.outputTracks.add(event.track);
        try {
          resource.outputStream = new MediaStreamClass([event.track]); audioElement.srcObject = resource.outputStream;
          if (resource.connected) void play(resource);
        } catch { notifyError('Speaker setup failed. Ending the voice session.'); void stop(); }
      });
      peer.addEventListener('connectionstatechange', () => {
        if (isFresh() && ['failed', 'closed', 'disconnected'].includes(peer.connectionState)) { notifyError('Connection interrupted. Restart with fresh consent to reconnect.'); void stop(); }
      });
      channel.addEventListener('message', message => {
        if (!isFresh() || typeof message.data !== 'string' || message.data.length > 16384) return;
        let event; try { event = JSON.parse(message.data); } catch { return; }
        if (!event || typeof event !== 'object' || typeof event.type !== 'string') return;
        if (event.type === 'session.started') {
          if (resource.connected) return;
          resource.connected = true; timers.clearTimeout(resource.startTimeout);
          try { stream.getAudioTracks().forEach(track => { track.enabled = true; }); }
          catch { notifyError('Microphone activation failed. Ending the voice session.'); void stop(); return; }
          emit('listening');
          if (audioElement.srcObject) void play(resource);
        } else if (event.type === 'session.closed') { void stop(); }
        else if (event.type === 'error') { notifyError('The voice provider reported an error.'); void stop(); }
        else if (['session.input_transcript.delta', 'session.output_transcript.delta'].includes(event.type) && typeof event.delta === 'string' && event.delta.length <= 4096 && Number.isFinite(event.start_ms) && Number.isFinite(event.end_ms) && event.start_ms >= 0 && event.end_ms >= event.start_ms) {
          // Fragments have no final-turn guarantee and do not prove playback.
          try { onTranscript({ speaker: event.type === 'session.input_transcript.delta' ? 'patient' : 'assistant', text: event.delta,
            startMs: event.start_ms, endMs: event.end_ms, epoch: captured, final: false, heardAudio: null, language, translationStatus: 'unverified' }); } catch { notifyError('Live captions could not be displayed.'); void stop(); }
        }
      });
      channel.addEventListener('close', () => { if (isFresh()) { notifyError('Voice event connection closed.'); void stop(); } });
      for (const track of stream.getAudioTracks()) peer.addTrack(track, stream);
      emit('connecting');
      if (!isFresh()) return;
      resource.startTimeout = timers.setTimeout(() => { if (isFresh()) { notifyError('Voice connection timed out.'); void stop(); } }, 20000);
      const offer = await peer.createOffer(); if (!isFresh()) return;
      await peer.setLocalDescription(offer); if (!isFresh()) return;
      if (peer.iceGatheringState !== 'complete') {
        await new Promise((resolve, reject) => {
          let settled = false, timeout;
          function finish(error) {
            if (settled) return; settled = true; timers.clearTimeout(timeout);
            peer.removeEventListener('icegatheringstatechange', changed); resource.cancelIce = null;
            if (error) reject(error); else resolve();
          }
          resource.cancelIce = () => finish(new Error('ICE gathering stopped.'));
          timeout = timers.setTimeout(() => finish(new Error('ICE gathering timed out.')), 8000);
          function changed() { if (peer.iceGatheringState === 'complete') finish(); }
          peer.addEventListener('icegatheringstatechange', changed); changed();
        });
      }
      if (!isFresh()) return;
      const answer = await broker.connect(resource.permit.permitId, { sdp: peer.localDescription.sdp });
      if (!isFresh()) { await release(resource, true); return; }
      if (answer.transport?.type !== 'webrtc' || typeof answer.transport.sdp !== 'string') throw new Error('Invalid voice answer.');
      if (answer.expiresAt !== undefined) {
        if (!Number.isSafeInteger(answer.expiresAt) || answer.expiresAt <= now()) throw new Error('Expired voice answer.');
        resource.permit.expiresAt = Math.min(resource.permit.expiresAt, answer.expiresAt);
        timers.clearTimeout(resource.expiry);
        resource.expiry = timers.setTimeout(() => { if (owned(resource)) void stop(); }, resource.permit.expiresAt - now());
      }
      await peer.setRemoteDescription({ type: 'answer', sdp: answer.transport.sdp });
      if (!isFresh()) return;
      resource.lease = timers.setInterval(() => {
        if (!isFresh() || resource.leaseRequest) return;
        let request;
        try {
          request = { controller: new AbortControllerClass(), deadlineAt: Math.min(now() + LEASE_RENEWAL_TIMEOUT_MS, resource.permit.expiresAt) };
          resource.leaseRequest = request;
          request.timer = timers.setTimeout(() => renewalTimedOut(resource, request), request.deadlineAt - now());
        } catch { notifyError('Voice permission could not be renewed.'); void stop(); return; }
        Promise.resolve().then(() => {
          // A Stop can happen before this queued dispatch. Do not send even a
          // read-only renewal after its owning session has ended.
          if (!isFresh() || resource.leaseRequest !== request) return;
          return broker.lease(resource.permit.permitId, { signal: request.controller.signal });
        }).then(result => {
          // Check the absolute deadline before accepting a late response: a
          // suspended browser may deliver this before its overdue timer.
          if (!isFresh() || resource.leaseRequest !== request) return;
          if (!result || result.active !== true) { void stop(); return; }
          if (result.expiresAt !== undefined) {
            if (!Number.isSafeInteger(result.expiresAt) || result.expiresAt <= now()) { void stop(); return; }
            resource.permit.expiresAt = Math.min(resource.permit.expiresAt, result.expiresAt);
            timers.clearTimeout(resource.expiry);
            resource.expiry = timers.setTimeout(() => { if (owned(resource)) void stop(); }, resource.permit.expiresAt - now());
          }
          // Invalidate this request before another interval, and before an
          // already-queued old timeout can affect the same active session.
          timers.clearTimeout(request.timer); resource.leaseRequest = null;
        }).catch(() => { if (isFresh() && resource.leaseRequest === request) { notifyError('Voice permission could not be renewed.'); void stop(); } }).finally(() => {
          timers.clearTimeout(request.timer);
          if (resource.leaseRequest === request) resource.leaseRequest = null;
        });
      }, LEASE_RENEWAL_INTERVAL_MS);
    } catch {
      if (isFresh()) {
        notifyError('Live voice could not start. No clinical action was performed.');
        const stoppedEpoch = epoch + 1; await stop();
        if (epoch === stoppedEpoch && current === null) emit('failed');
      }
    }
  }
  function interruptPlayback() {
    if (!current?.connected || !fresh(current)) return;
    // Local immediate mute is honest: GPT-Live does not expose Realtime's
    // response.cancel. Full-duplex conversational interruption is model-owned.
    current.playbackEpoch++; current.playbackPaused = true;
    try { audioElement.pause(); emit('playback_paused'); } catch { notifyError('Speaker mute could not be confirmed. Ending the voice session.'); void stop(); }
  }
  async function resumePlayback() { await play(current, true); }
  // Pause is a privacy boundary: terminate rather than leave a paid listener.
  // A later resume uses a NEW server-authorized session; no replay of old audio.
  return { start, stop, pause: stop, interruptPlayback, resumePlayback, getState: () => state };
}
// UI-level concerns deliberately survive session replacements: a clean new
// microphone does not establish that a failed older microphone was released.
function mergeLiveCleanupConcerns(previous = {}, result, scope = 'current') {
  const pending = new Set(previous.permissionScopes || []);
  if (result?.permissionPending === true) pending.add(scope); else pending.delete(scope);
  return Object.freeze({
    microphone: !!previous.microphone || result?.tracksStopped !== true,
    speaker: !!previous.speaker || result?.playbackStopped !== true,
    transport: !!previous.transport || result?.transportClosed !== true,
    provider: !!previous.provider || result?.cleanupPending !== true && result?.providerCleanupConfirmed !== true,
    permission: pending.size > 0, permissionScopes: Object.freeze([...pending]),
  });
}
function liveCleanupWarning(concerns = {}) {
  return [
    concerns.microphone && 'Microphone release could not be confirmed. Check your browser microphone indicator.',
    concerns.speaker && 'Speaker release could not be confirmed. Close this tab if audio remains active.',
    concerns.transport && 'The voice connection could not be fully closed. Close this tab.',
    concerns.provider && 'Provider termination is not confirmed. The server session may need reconciliation.',
    concerns.permission && 'Dismiss any pending microphone permission prompt. A later granted stream will receive a stop request.'
  ].filter(Boolean).join(' ');
}
module.exports = { createLiveWebRtcSession, mergeLiveCleanupConcerns, liveCleanupWarning, LEASE_RENEWAL_TIMEOUT_MS, LEASE_RENEWAL_INTERVAL_MS };
