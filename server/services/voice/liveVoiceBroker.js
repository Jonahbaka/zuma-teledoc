'use strict';
const { randomUUID } = require('node:crypto');
const { LANGUAGES } = require('../../../shared/voice/liveProtocol.cjs');
function fail(statusCode, code) { throw Object.assign(new Error('The live voice prototype is unavailable in this context.'), { statusCode, code }); }
function strict(value, keys) { if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key))) fail(400, 'VOICE_INPUT_INVALID'); }
const unavailablePolicy = async () => fail(503, 'VOICE_POLICY_NOT_CONFIGURED');
const unavailableSessionAuthority = async () => fail(503, 'VOICE_SESSION_POLICY_UNCONFIGURED');

// Synthetic-only live-audio composition seam, not clinical consent storage.
// A later clinical integration must independently resolve the canonical
// encounter, assignment, current consent, processor and language approvals.
function createLiveVoiceBroker({ env = process.env, authorize = unavailablePolicy, assertSession = unavailableSessionAuthority, provider = null, now = Date.now, onEvidence = () => {}, onIncident = () => {} } = {}) {
  const permits = new Map();
  const receipts = new Map();
  function remember(permit, result) {
    for (const [key, receipt] of receipts) if (receipt.expiresAt <= now()) receipts.delete(key);
    if (receipts.size >= 100) receipts.delete(receipts.keys().next().value);
    receipts.set(permit.id, { actorId: permit.actorId, expiresAt: now() + 600000, result });
    return result;
  }
  const enabled = () => ['development', 'test'].includes(env.NODE_ENV) && env.DOCTARX_VOICE_LIVE_PROTOTYPE_ENABLED === 'true' && !!provider && typeof authorize === 'function' && authorize !== unavailablePolicy && typeof assertSession === 'function' && assertSession !== unavailableSessionAuthority;
  const capabilities = () => ({ enabled: enabled(), liveAudioImplemented: true, providerVerified: false, clinicalUse: false,
    mode: 'synthetic_evaluation_only', consentVersion: 'voice-live-synthetic-v1', reason: enabled() ? 'evaluation_dependencies_configured' : 'requires_current_session_policy_provider_and_credentials' });
  function owner(actor, permitId) {
    if (!actor?.id || !['provider', 'admin', 'super_admin'].includes(actor.role)) fail(403, 'VOICE_ACCESS_DENIED');
    const permit = permits.get(permitId);
    if (!permit || permit.actorId !== actor.id || permit.auth && (actor.voiceAuth?.familyId !== permit.auth.familyId || actor.voiceAuth?.credentialVersion !== permit.auth.credentialVersion)) fail(404, 'VOICE_SESSION_UNAVAILABLE');
    return permit;
  }
  function freshApproval(approval) {
    const at = now();
    if (!Number.isSafeInteger(at) || !Number.isSafeInteger(approval?.observedAt) || approval.observedAt > at || at - approval.observedAt > 1000
      || !Number.isSafeInteger(approval?.validUntil) || approval.validUntil <= at) fail(403, 'VOICE_EVALUATION_APPROVAL_EXPIRED');
  }
  function scheduleExpiry(permit) {
    clearTimeout(permit.expiryTimer);
    permit.expiryTimer = setTimeout(() => { void stopPermit(permit); }, Math.max(0, permit.expiresAt - now())); permit.expiryTimer.unref?.();
  }
  async function authority(actor, language, context) {
    if (!enabled()) fail(503, 'VOICE_LIVE_DISABLED');
    if (!actor?.id || !['provider', 'admin', 'super_admin'].includes(actor.role)) fail(403, 'VOICE_ACCESS_DENIED');
    if (!Object.hasOwn(LANGUAGES, language)) fail(400, 'VOICE_LANGUAGE_INVALID');
    await assertSession(actor);
    const approval = await authorize({ actor, language, context });
    // Approval I/O may have waited while credentials or a family were revoked.
    await assertSession(actor);
    if (approval?.actorId !== actor.id || approval.language !== language || approval.dataClass !== 'synthetic' || approval.consentActive !== true || approval.providerApproved !== true || !approval.consentVersion)
      fail(403, 'VOICE_CONSENT_REQUIRED');
    freshApproval(approval);
    return approval;
  }
  async function stopPermit(permit) {
    if (permit.stopping) return permit.stopping;
    permit.stopping = finalizeStop(permit);
    try { return await permit.stopping; } finally { permit.stopping = null; }
  }
  async function finalizeStop(permit) {
    permit.stopped = true; clearTimeout(permit.expiryTimer); clearInterval(permit.leaseTimer);
    if (permit.connection) {
      const connection = permit.connection;
      try { await provider.terminate(connection.providerSessionId, connection.sideband); }
      catch {
        connection.sideband.close();
        onIncident({ code: 'VOICE_PROVIDER_CLEANUP_UNCONFIRMED', permitId: permit.id, providerSessionId: connection.providerSessionId });
        // Keep this owner-scoped handle so an explicit stop retry can reconcile
        // termination. Do not silently lose a potentially billable session.
        return { stopped: false, localCaptureMustStop: true, providerCleanupConfirmed: false, providerFinalUsageConfirmed: false };
      }
      connection.sideband.close(); permit.connection = null;
    }
    if (permit.connecting || permit.creationUncertain) {
      return { stopped: false, providerCleanupConfirmed: false, providerCreationPending: permit.connecting, providerOutcomeUncertain: !!permit.creationUncertain, providerFinalUsageConfirmed: false };
    }
    permits.delete(permit.id);
    return remember(permit, { stopped: true, providerCleanupConfirmed: true, providerFinalUsageConfirmed: false });
  }
  async function reserve(actor, input) {
    strict(input, ['language', 'consentVersion']);
    const approval = await authority(actor, input.language, { consentVersion: input.consentVersion });
    freshApproval(approval);
    if (input.consentVersion !== 'voice-live-synthetic-v1' || input.consentVersion !== approval.consentVersion) fail(403, 'VOICE_CONSENT_REQUIRED');
    if (permits.size >= 50 || [...permits.values()].filter(item => item.actorId === actor.id).length >= 2) fail(429, 'VOICE_CAPACITY_LIMIT');
    const auth = actor.voiceAuth ? Object.freeze({ ...actor.voiceAuth }) : null;
    const permit = { id: randomUUID(), actorId: actor.id, auth, language: input.language, consentVersion: approval.consentVersion,
      expiresAt: Math.min(now() + 180000, auth?.expiresAt ?? Infinity, approval.validUntil), stopped: false, connecting: false, connection: null };
    scheduleExpiry(permit);
    permits.set(permit.id, permit);
    return { permitId: permit.id, expiresAt: permit.expiresAt, language: permit.language, dataClass: 'synthetic', provider: 'openai-gpt-live', consentVersion: permit.consentVersion };
  }
  function currentPermit(permit) {
    if (permit.stopped || now() >= permit.expiresAt) fail(404, 'VOICE_SESSION_UNAVAILABLE');
  }
  async function check(actor, permit) {
    if (permit.stopped || now() >= permit.expiresAt) { await stopPermit(permit); fail(404, 'VOICE_SESSION_UNAVAILABLE'); }
    const boundActor = permit.auth ? Object.freeze({ ...actor, voiceAuth: permit.auth }) : actor;
    const approval = await authority(boundActor, permit.language, { consentVersion: permit.consentVersion });
    freshApproval(approval);
    // Cancellation/expiry can happen while either trusted reader is pending.
    if (permit.stopped || now() >= permit.expiresAt) { await stopPermit(permit); fail(404, 'VOICE_SESSION_UNAVAILABLE'); }
    if (approval.consentVersion !== permit.consentVersion) { await stopPermit(permit); fail(403, 'VOICE_CONSENT_REQUIRED'); }
    if (approval.validUntil < permit.expiresAt) { permit.expiresAt = approval.validUntil; scheduleExpiry(permit); }
    return approval;
  }
  async function connect(actor, permitId, input) {
    strict(input, ['sdp']);
    const permit = owner(actor, permitId);
    if (permit.connecting || permit.connection) fail(409, 'VOICE_CONNECTION_EXISTS');
    permit.connecting = true;
    try {
      const admission = await check(actor, permit); freshApproval(admission); currentPermit(permit);
      if (typeof input.sdp !== 'string' || !input.sdp.startsWith('v=0') || input.sdp.length > 65536) fail(400, 'VOICE_SDP_INVALID');
      const connection = await provider.connect({ sdp: input.sdp, language: permit.language,
        onEvent(event) {
          if (permit.stopped || !event || typeof event.type !== 'string') return;
          // Model/tool output is never authorization. Delegation is denied in
          // this slice; no patient lookup, tools, chart import or signing exists.
          if (event?.type?.startsWith('session.delegation')) { void stopPermit(permit); return; }
          if (['session.input_transcript.delta', 'session.output_transcript.delta'].includes(event?.type) && typeof event.delta === 'string' && event.delta.length <= 4096 && Number.isFinite(event.start_ms) && Number.isFinite(event.end_ms) && event.start_ms >= 0 && event.end_ms >= event.start_ms)
            onEvidence({ permitId: permit.id, language: permit.language, event: { type: event.type, delta: event.delta, start_ms: event.start_ms, end_ms: event.end_ms }, clinicalReady: false, translationStatus: 'unverified', final: false });
          if (event?.type === 'session.closed' || event?.type === 'error') void stopPermit(permit);
        } });
      permit.connecting = false; permit.connection = connection;
      if (permit.stopped) { permits.set(permit.id, permit); await stopPermit(permit); fail(409, 'VOICE_SESSION_STOPPED'); }
      const connectedApproval = await check(actor, permit); freshApproval(connectedApproval); currentPermit(permit);
      permit.leaseTimer = setInterval(() => { check(actor, permit).catch(() => stopPermit(permit)); }, 5000); permit.leaseTimer.unref?.();
      return { permitId: permit.id, transport: { type: 'webrtc', sdp: connection.sdp }, expiresAt: permit.expiresAt };
    } catch (error) {
      permit.connecting = false;
      if (error.code === 'VOICE_PROVIDER_OUTCOME_UNCERTAIN') {
        permit.creationUncertain = true;
        onIncident({ code: error.code, permitId: permit.id });
      }
      if (error.cleanupConnection) {
        permit.connection = error.cleanupConnection; permit.stopped = true;
        clearTimeout(permit.expiryTimer); clearInterval(permit.leaseTimer); permits.set(permit.id, permit);
        onIncident({ code: 'VOICE_PROVIDER_CLEANUP_UNCONFIRMED', permitId: permit.id, providerSessionId: permit.connection.providerSessionId });
      } else await stopPermit(permit);
      throw error;
    } finally { permit.connecting = false; }
  }
  async function stop(actor, permitId) {
    // Cleanup is allowed for the authenticated owner even after role removal.
    // It grants no creation, data-read or provider configuration authority.
    if (!actor?.id) fail(403, 'VOICE_ACCESS_DENIED');
    const permit = permits.get(permitId);
    if (permit) {
      if (permit.actorId !== actor.id) fail(404, 'VOICE_SESSION_UNAVAILABLE');
      return stopPermit(permit);
    }
    const receipt = receipts.get(permitId);
    if (receipt && receipt.expiresAt > now() && receipt.actorId === actor.id) return { ...receipt.result };
    fail(404, 'VOICE_SESSION_UNAVAILABLE');
  }
  async function lease(actor, permitId) { const permit = owner(actor, permitId); try { const approval = await check(actor, permit); freshApproval(approval); currentPermit(permit); return { active: true, expiresAt: permit.expiresAt }; } catch (error) { await stopPermit(permit); throw error; } }
  return { capabilities, reserve, connect, stop, lease, close: async () => { await Promise.all([...permits.values()].map(stopPermit)); receipts.clear(); } };
}
module.exports = { createLiveVoiceBroker };
