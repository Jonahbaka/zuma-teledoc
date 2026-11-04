'use strict';
const { randomUUID } = require('node:crypto');
const { MODEL, LANGUAGES } = require('./geminiLiveEvaluationTransport');
const { publicVoiceSessionIdentity } = require('./voiceSessionBinding');
const NOTICE = 'voice-live-synthetic-v1';
// EventEmitter peers may report errors after close; this terminal handler
// retains no session, media, identity or raw error details.
const terminalPeerError = () => {};
const fault = (code, statusCode = 403) => Object.assign(new Error('The fictional voice evaluation is unavailable.'), { code, statusCode });

// Unmounted server-side peer adapter. No HTTP upgrade, JWT acceptance, origin
// bypass, SDK import, credential lookup, real approvals or database is installed.
// admitPeer must authenticate the original server request, verify its upgrade
// and origin, and return server-verified actor metadata. Never use peer frames.
function createGeminiPcmGateway({ env = {}, expectedOrigin, admitPeer, assertSession, authorize, provider, now = Date.now,
  setTimer = setTimeout, clearTimer = clearTimeout, onIncident = () => {} } = {}) {
  const sessions = new Map(), receipts = new Map(), usedPeers = new WeakSet();
  let originValid = false;
  try { originValid = new URL(expectedOrigin).protocol === 'https:' && new URL(expectedOrigin).origin === expectedOrigin; } catch {}
  const enabled = () => ['development', 'test'].includes(env.NODE_ENV) && env.DOCTARX_VOICE_GEMINI_PCM_ENABLED === 'true'
    && originValid && typeof admitPeer === 'function'
    && typeof assertSession === 'function' && typeof authorize === 'function' && typeof provider?.open === 'function';
  const timer = (fn, ms) => { const id = setTimer(fn, ms); id?.unref?.(); return id; };
  function incident(code, id) { try { onIncident({ code, sessionId: id }); } catch {} }
  function bounded(operation, ms = 1000) {
    let deadline;
    return Promise.race([Promise.resolve().then(operation), new Promise((_, reject) => { deadline = timer(() => reject(fault('PCM_AUTHORITY_TIMEOUT', 503)), ms); })]).finally(() => clearTimer(deadline));
  }
  function fresh(s) {
    if (s.stopped || now() >= s.expiresAt) throw fault('PCM_SESSION_EXPIRED');
  }
  function trimReceipts() { for (const [id, record] of receipts) if (record.expiresAt <= now()) receipts.delete(id); }
  function remember(s, receipt) {
    trimReceipts(); if (receipts.size >= 100) receipts.delete(receipts.keys().next().value);
    receipts.set(s.id, { actorId: s.actor?.id, expiresAt: now() + 600000, receipt }); sessions.delete(s.id);
  }
  function scheduleDeadline(s) { clearTimer(s.deadline); s.deadline = timer(() => void stopSession(s, 'expired'), Math.max(0, s.expiresAt - now())); }
  function closePeer(s) {
    if (!s.peerErrorsHandled) { s.peer.on('error', terminalPeerError); s.peerErrorsHandled = true; }
    s.peer.off('message', s.message); s.peer.off('close', s.closed); s.peer.off('error', s.errored);
    try { s.peer.close(1000, 'Voice evaluation ended'); } catch { incident('PCM_PEER_CLOSE_UNCONFIRMED', s.id); }
  }
  function receipt(s, result) {
    return Object.freeze({ stopped: s.stopped, localCaptureMustStop: true, providerFinalUsageConfirmed: false,
      providerCleanupConfirmed: !s.openAttempted || result?.transportClosedConfirmed === true,
      providerCreationPending: result?.creationPending === true, providerOutcomeUncertain: s.creationUncertain || result?.creationOutcomeUncertain === true });
  }
  function stopSession(s, reason = 'stopped') {
    if (s.stopping) return s.stopping;
    s.stopped = true; s.phase = 'closed'; clearTimer(s.deadline); clearTimer(s.renewal); clearTimer(s.setup);
    // Close immediately so no more peer input/output is accepted. The browser
    // must stop owned media on close; provider cleanup is independent.
    closePeer(s);
    s.stopping = (async () => {
      let result;
      if (s.handle) {
        try { result = await bounded(() => s.handle.stop(reason), 3500); }
        catch { incident('PCM_PROVIDER_CLEANUP_UNCONFIRMED', s.id); }
      }
      if (!result && typeof s.handle?.status === 'function') { try { result = s.handle.status(); } catch {} }
      const final = receipt(s, result);
      if (final.providerCleanupConfirmed && !final.providerCreationPending && !final.providerOutcomeUncertain) remember(s, final);
      else incident('PCM_PROVIDER_CLEANUP_UNCONFIRMED', s.id);
      return final;
    })();
    return s.stopping.finally(() => { s.stopping = null; });
  }
  function send(s, event) {
    if (s.stopped || s.phase !== 'active') return;
    try {
      fresh(s);
      if (now() - s.checkedAt >= 5000) throw fault('PCM_LEASE_STALE');
      const value = JSON.stringify(event), bytes = Buffer.byteLength(value);
      if (s.peer.readyState !== 1 || !Number.isSafeInteger(s.peer.bufferedAmount) || s.peer.bufferedAmount < 0
        || bytes > 70000 || s.peer.bufferedAmount + bytes > 131072) throw fault('PCM_OUTPUT_BACKPRESSURE');
      s.peer.send(value, error => { if (error) void stopSession(s, 'peer_send_failed'); });
    } catch { void stopSession(s, 'output_failed'); }
  }
  async function authority(s) {
    fresh(s); if (!enabled()) throw fault('PCM_GATEWAY_DISABLED', 503);
    await bounded(() => assertSession(s.actor)); fresh(s);
    const approval = await bounded(() => authorize({ actor: s.actor, language: s.language, context: { consentVersion: NOTICE } })); fresh(s);
    await bounded(() => assertSession(s.actor)); fresh(s);
    const at = now();
    if (approval?.actorId !== s.actor.id || approval.language !== s.language || approval.dataClass !== 'synthetic'
      || approval.consentActive !== true || approval.providerApproved !== true || approval.consentVersion !== NOTICE
      || approval.providerBinding?.provider !== 'google' || approval.providerBinding?.model !== MODEL
      || !Number.isSafeInteger(approval.observedAt) || approval.observedAt > at || at - approval.observedAt > 1000
      || !Number.isSafeInteger(approval.validUntil) || approval.validUntil <= at) throw fault('PCM_APPROVAL_REQUIRED');
    let credentialBinding = null;
    if (approval.credentialBinding !== undefined) {
      const value = approval.credentialBinding;
      if (!value || ['credentialRef', 'revision'].some(key => typeof value[key] !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(value[key]))
        || typeof value.fingerprintSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(value.fingerprintSha256)) throw fault('PCM_CREDENTIAL_BINDING_REQUIRED');
      credentialBinding = JSON.stringify([value.credentialRef, value.revision, value.fingerprintSha256]);
    }
    if (s.bindingEstablished && s.credentialBinding !== credentialBinding) throw fault('PCM_CREDENTIAL_BINDING_CHANGED');
    s.bindingEstablished = true; s.credentialBinding = credentialBinding;
    s.expiresAt = Math.min(s.expiresAt, s.actor.voiceAuth.expiresAt, approval.validUntil); fresh(s);
    s.checkedAt = at; scheduleDeadline(s);
  }
  function renew(s) {
    s.renewal = timer(async () => {
      try { await authority(s); if (!s.stopped) renew(s); }
      catch { await stopSession(s, 'authority_revoked'); }
    }, 4000);
  }
  function receive(s, raw, binary) {
    try {
      fresh(s);
      if (s.phase !== 'active' || now() - s.checkedAt >= 5000 || binary === true || !(typeof raw === 'string' || Buffer.isBuffer(raw))) throw fault('PCM_MESSAGE_DENIED');
      if (Buffer.byteLength(raw) > 5000) throw fault('PCM_MESSAGE_TOO_LARGE');
      const at = now(); s.incoming = s.incoming.filter(t => t > at - 1000);
      if (s.incoming.length >= 16) throw fault('PCM_INPUT_RATE_LIMIT'); s.incoming.push(at);
      const value = JSON.parse(raw.toString());
      if (!value || Array.isArray(value) || !Number.isSafeInteger(value.sequence) || value.sequence !== s.sequence + 1
        || Object.keys(value).some(key => !['type', 'sequence', 'data'].includes(key))) throw fault('PCM_MESSAGE_INVALID');
      s.sequence = value.sequence;
      if (value.type === 'stop' && value.data === undefined) { void stopSession(s); return; }
      if (value.type === 'greeting' && value.data === undefined) { s.handle.sendGreeting(); return; }
      if (value.type === 'capture.end' && value.data === undefined) { s.handle.endAudio(); return; }
      if (value.type !== 'audio.pcm' || typeof value.data !== 'string' || value.data.length !== 4268) throw fault('PCM_MESSAGE_INVALID');
      const bytes = Buffer.from(value.data, 'base64');
      if (bytes.length !== 3200 || bytes.toString('base64') !== value.data || ++s.inputFrames > 1800) throw fault('PCM_INPUT_LIMIT');
      s.handle.sendPcm(value.data);
    } catch { void stopSession(s, 'input_denied'); }
  }
  function attach({ request, peer, language, consentVersion } = {}) {
    if (!enabled()) throw fault('PCM_GATEWAY_DISABLED', 503);
    if (!Object.hasOwn(LANGUAGES, language) || consentVersion !== NOTICE || !peer || ['on', 'off', 'send', 'close'].some(name => typeof peer[name] !== 'function')) throw fault('PCM_ADMISSION_INVALID');
    if (usedPeers.has(peer) || peer.readyState !== 1) throw fault('PCM_PEER_ALREADY_USED');
    if (sessions.size >= 50) throw fault('PCM_CAPACITY_LIMIT', 429);
    const s = { id: randomUUID(), peer, language, phase: 'admitting', actor: null, expiresAt: now() + 15000,
      sequence: 0, inputFrames: 0, incoming: [], checkedAt: 0, stopped: false, openAttempted: false, creationUncertain: false };
    usedPeers.add(peer); sessions.set(s.id, s);
    s.message = (raw, binary) => receive(s, raw, binary); s.closed = () => void stopSession(s, 'peer_closed'); s.errored = () => void stopSession(s, 'peer_error');
    peer.on('message', s.message); peer.on('close', s.closed); peer.on('error', s.errored);
    s.setup = timer(() => void stopSession(s, 'setup_expired'), 15000);
    const ready = (async () => {
      try {
        const admission = await bounded(() => admitPeer({ request, peer })); fresh(s);
        if (admission?.upgradeVerified !== true || admission.origin !== expectedOrigin || !admission.actor?.id
          || !['provider', 'admin', 'super_admin'].includes(admission.actor.role) || admission.actor.voiceAuth?.userId !== admission.actor.id
          || !Number.isSafeInteger(admission.actor.voiceAuth.expiresAt) || admission.actor.voiceAuth.expiresAt <= now()) throw fault('PCM_PEER_UNAUTHENTICATED');
        s.actor = Object.freeze({ id: admission.actor.id, role: admission.actor.role, voiceAuth: Object.freeze({ ...admission.actor.voiceAuth }) });
        if ([...sessions.values()].filter(other => other.actor?.id === s.actor.id).length > 2) throw fault('PCM_OWNER_CAPACITY_LIMIT', 429);
        s.expiresAt = Math.min(now() + 180000, s.actor.voiceAuth.expiresAt); await authority(s); fresh(s);
        s.phase = 'connecting'; s.openAttempted = true;
        try { s.handle = provider.open({ language, onEvent(event) {
          if (s.stopped) return;
          if (event?.type === 'session.closed' || event?.type === 'error') { void stopSession(s, 'provider_closed'); return; }
          if (['audio.pcm', 'playback.clear', 'transcript', 'turn.complete'].includes(event?.type)) send(s, event);
        } }); } catch { s.creationUncertain = true; throw fault('PCM_PROVIDER_CREATION_UNCERTAIN', 503); }
        if (!s.handle || typeof s.handle.stop !== 'function' || typeof s.handle.ready?.then !== 'function' || ['sendPcm', 'sendGreeting', 'endAudio'].some(name => typeof s.handle[name] !== 'function')) {
          s.creationUncertain = true; throw fault('PCM_PROVIDER_HANDLE_INVALID', 503);
        }
        await bounded(() => s.handle.ready, 11000); fresh(s); await authority(s); fresh(s);
        clearTimer(s.setup); s.phase = 'active'; renew(s);
        const result = Object.freeze({ sessionId: s.id, language, provider: 'google', model: MODEL, dataClass: 'synthetic', consentVersion: NOTICE, expiresAt: s.expiresAt, ...publicVoiceSessionIdentity(s.actor) });
        send(s, { type: 'session.ready', ...result }); fresh(s); return result;
      } catch (error) { await stopSession(s, 'admission_failed'); throw fault(error.code || 'PCM_ADMISSION_FAILED', error.statusCode || 403); }
    })(); ready.catch(() => {});
    return Object.freeze({ sessionId: s.id, ready, stop: () => stopSession(s), status: () => ({ phase: s.phase, expiresAt: s.expiresAt }) });
  }
  async function stop(actor, sessionId) {
    if (!actor?.id) throw fault('PCM_OWNER_REQUIRED');
    const s = sessions.get(sessionId);
    if (s?.actor?.id === actor.id) return stopSession(s);
    trimReceipts(); const record = receipts.get(sessionId);
    if (record?.actorId === actor.id) return record.receipt;
    throw fault('PCM_SESSION_UNAVAILABLE', 404);
  }
  return Object.freeze({ attach, stop, capabilities: () => ({ enabled: enabled(), clinicalUse: false, mounted: false }),
    close: async () => { await Promise.all([...sessions.values()].map(s => stopSession(s))); receipts.clear(); } });
}
module.exports = { createGeminiPcmGateway };
