'use strict';
const { sessionConfiguration } = require('../../../shared/voice/liveProtocol.cjs');
const ORIGIN = 'https://api.openai.com';
const validId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(value);
const unavailable = code => Object.assign(new Error('The live voice provider is unavailable.'), { code, statusCode: 503 });

// Deliberately no default global fetch, environment-key lookup or socket. An
// approved composition root must supply these after provider/privacy review.
// The shipped route does NOT instantiate this adapter with real dependencies.
function createOpenAiLiveAdapter({ fetchImpl, credentialProvider, attachSideband } = {}) {
  if (typeof fetchImpl !== 'function' || typeof credentialProvider !== 'function' || typeof attachSideband !== 'function') throw unavailable('VOICE_PROVIDER_NOT_CONFIGURED');
  async function post(path, body) {
    const key = await credentialProvider();
    if (!key || typeof key !== 'string') throw unavailable('VOICE_PROVIDER_NOT_CONFIGURED');
    let response;
    try {
      response = await fetchImpl(`${ORIGIN}${path}`, { method: 'POST', redirect: 'error',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(15000) });
    } catch { throw unavailable('VOICE_PROVIDER_OUTCOME_UNCERTAIN'); }
    if (!response.ok) throw unavailable('VOICE_PROVIDER_REJECTED');
    return response;
  }
  async function terminate(sessionId, existingSideband) {
    if (!validId(sessionId)) throw unavailable('VOICE_PROVIDER_RESPONSE_INVALID');
    // HTTP /hangup is documented for SIP. WebRTC termination uses the trusted
    // sideband session.close protocol and waits for session.closed instead.
    let sideband = existingSideband;
    try {
      if (!sideband || sideband.isClosed?.()) sideband = await attachSideband({
        url: `wss://api.openai.com/v1/live/sessions/${sessionId}/attach`, credentialProvider, onEvent() {},
      });
      if (typeof sideband?.finish !== 'function') throw unavailable('VOICE_SIDEBAND_UNAVAILABLE');
      await sideband.finish();
      return { providerFinalUsageConfirmed: false };
    } catch { throw unavailable('VOICE_PROVIDER_CLEANUP_UNCONFIRMED'); }
    finally { sideband?.close?.(); }
  }
  async function connect({ sdp, language, onEvent }) {
    if (typeof sdp !== 'string' || !sdp.startsWith('v=0') || sdp.length > 65536) throw unavailable('VOICE_SDP_INVALID');
    const response = await post('/v1/live/sessions', { session: sessionConfiguration(language), transport: { type: 'webrtc', sdp } });
    let result;
    try { result = await response.json(); } catch { throw unavailable('VOICE_PROVIDER_OUTCOME_UNCERTAIN'); }
    const providerSessionId = result?.session?.id;
    if (!validId(providerSessionId)) throw unavailable('VOICE_PROVIDER_OUTCOME_UNCERTAIN');
    let sideband;
    try {
      if (result.transport?.type !== 'webrtc' || typeof result.transport.sdp !== 'string' || !result.transport.sdp.startsWith('v=0') || result.transport.sdp.length > 65536) throw unavailable('VOICE_PROVIDER_RESPONSE_INVALID');
      // Attach only to this server-created session. Never accept a client-owned
      // provider id. The server is the sole authority for delegated work.
      sideband = await attachSideband({ url: `wss://api.openai.com/v1/live/sessions/${providerSessionId}/attach`,
        credentialProvider, onEvent });
      if (!sideband || typeof sideband.close !== 'function' || typeof sideband.finish !== 'function') throw unavailable('VOICE_SIDEBAND_UNAVAILABLE');
      return { providerSessionId, sdp: result.transport.sdp, sideband };
    } catch (error) {
      try { await terminate(providerSessionId, sideband); } catch {
        sideband?.close?.();
        const failure = unavailable('VOICE_PROVIDER_CLEANUP_UNCONFIRMED');
        // Preserve only a server-owned cleanup handle, never return it to the
        // frontend. The broker keeps it for an explicit termination retry.
        failure.cleanupConnection = { providerSessionId, sideband: { close() {}, isClosed: () => true } };
        throw failure;
      }
      throw unavailable('VOICE_PROVIDER_SETUP_FAILED');
    }
  }
  return { connect, terminate };
}
module.exports = { createOpenAiLiveAdapter };
