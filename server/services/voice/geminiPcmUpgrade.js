'use strict';
const { GEMINI_LIVE_LANGUAGES } = require('../../../shared/voiceLanguageCatalog.cjs');
const { WebSocketServer } = require('ws');
const cookieParser = require('cookie-parser');
const { createGeminiPcmGateway } = require('./geminiPcmGateway');
const { claimBoundedUpgrade } = require('../boundedUpgradeRouting');
const { publicVoiceSessionIdentity } = require('./voiceSessionBinding');
const PATH = '/api/voice-pcm-evaluation';
const terminalError = () => {};
const fault = () => new Error('Voice upgrade denied.');

// Explicit installer: the application supplies no approved composition and
// therefore mounts it disabled. authenticate must be the existing server
// middleware. TLS is checked from the actual socket
// unless a trusted deployment supplies an explicit transport verifier. Never
// derive trust from client-controlled Forwarded/X-Forwarded-* headers here.
function createGeminiPcmUpgrade({ httpServer, authenticate, expectedOrigin, env = {}, assertSession, authorize, provider,
  verifyTransport = request => request.socket.encrypted === true, authTimeoutMs = 2000, ...gatewayOptions } = {}) {
  if (!httpServer?.on || !httpServer?.off || !Number.isSafeInteger(authTimeoutMs) || authTimeoutMs < 20 || authTimeoutMs > 5000) throw fault();
  const admissions = new WeakMap(), pending = new Set(); let closed = false, inFlightAuthentications = 0;
  const gateway = createGeminiPcmGateway({ ...gatewayOptions, env, expectedOrigin, assertSession, authorize, provider,
    async admitPeer({ request, peer }) {
      const admission = admissions.get(request); admissions.delete(request);
      if (!admission || admission.peer !== peer) throw fault();
      return { actor: admission.actor, origin: expectedOrigin, upgradeVerified: true };
    } });
  const wss = new WebSocketServer({ noServer: true, maxPayload: 5000, perMessageDeflate: false });
  wss.on('error', terminalError); const parseCookies = cookieParser();
  const configured = () => !closed && gateway.capabilities().enabled && typeof authenticate === 'function' && typeof verifyTransport === 'function';
  function reject(socket, status = 403) {
    socket.on('error', terminalError);
    try { socket.end(`HTTP/1.1 ${status} Voice Upgrade Denied\r\nConnection: close\r\nContent-Length: 0\r\nCache-Control: no-store\r\n\r\n`); } catch {}
    socket.destroy();
  }
  function claim(request) {
    const raw = request.url || '', path = raw.split('?')[0]; let parsed;
    try { parsed = new URL(raw, 'https://invalid.example'); } catch { return { claimed: path.startsWith(PATH), valid: false }; }
    const claimed = path === PATH || path.startsWith(`${PATH}/`) || parsed.pathname === PATH;
    if (!claimed) return { claimed: false };
    const keys = [...parsed.searchParams.keys()];
    const valid = raw.length <= 512 && path === PATH && parsed.pathname === PATH && request.method === 'GET'
      && keys.length === 2 && new Set(keys).size === 2 && keys.every(key => ['language', 'consentVersion'].includes(key))
      && Object.hasOwn(GEMINI_LIVE_LANGUAGES, parsed.searchParams.get('language')) && parsed.searchParams.get('consentVersion') === 'voice-live-synthetic-v1';
    return { claimed, valid, language: parsed.searchParams.get('language') };
  }
  function runAuthentication(request) {
    return new Promise((resolve, rejectAuth) => {
      const response = { status() { return this; }, json() { rejectAuth(fault()); return this; } };
      request.originalUrl = request.url;
      try {
        parseCookies(request, response, error => {
          if (error) { rejectAuth(fault()); return; }
          try { Promise.resolve(authenticate(request, response, error => error ? rejectAuth(fault()) : resolve())).catch(() => rejectAuth(fault())); }
          catch { rejectAuth(fault()); }
        });
      } catch { rejectAuth(fault()); }
    });
  }
  function upgrade(request, socket, head) {
    const route = claim(request); if (!route.claimed) return;
    const protocol = request.headers['sec-websocket-protocol'];
    if (!route.valid || !configured() || request.headers.origin !== expectedOrigin || typeof protocol !== 'string' || !/^doctarx-pcm-v1\.[a-f0-9]{64}$/.test(protocol)
      || head.length !== 0 || pending.size >= 50 || inFlightAuthentications >= 50) { reject(socket); return; }
    let releaseOwner;
    try { releaseOwner = claimBoundedUpgrade(request, socket, authTimeoutMs); } catch { reject(socket); return; }
    pending.add(socket); let active = true, deadline, cancel;
    const cancelled = new Promise((_, rejectCancel) => { cancel = () => rejectCancel(fault()); });
    const lost = () => { active = false; cancel(); };
    // Keep reads flowing while authentication awaits: a paused socket can hide
    // FIN and create a provider for a caller who has already disconnected.
    // Frames before the handshake completes are never accepted or buffered.
    const earlyData = () => { lost(); reject(socket); };
    socket.on('close', lost); socket.on('end', lost); socket.on('error', lost); socket.on('data', earlyData); socket.resume();
    deadline = setTimeout(() => { active = false; cancel(); reject(socket, 408); }, authTimeoutMs); deadline.unref?.();
    const fresh = () => active && !closed && !socket.destroyed && !socket.readableEnded && configured();
    (async () => {
      try {
        // Timed-out sockets release their network resources, but an injected
        // database/transport verifier may not support cancellation. Keep its
        // bounded work slot until it really settles, including after close.
        inFlightAuthentications++;
        const admission = (async () => {
          if (await verifyTransport(request) !== true) throw fault();
          if (!fresh()) throw fault(); await runAuthentication(request);
          if (!fresh() || !request.user?.id || request.authSessionContext?.userId !== request.user.id) throw fault();
          const actor = Object.freeze({ id: request.user.id, role: request.user.role, voiceAuth: Object.freeze({ ...request.authSessionContext }) });
          if (protocol !== `doctarx-pcm-v1.${publicVoiceSessionIdentity(actor).sessionBinding}`) throw fault();
          return actor;
        })().finally(() => { inFlightAuthentications--; });
        const actor = await Promise.race([admission, cancelled]);
        if (!fresh()) throw fault();
        clearTimeout(deadline); pending.delete(socket); socket.off('close', lost); socket.off('end', lost); socket.off('error', lost); socket.off('data', earlyData); socket.on('error', terminalError);
        // handleUpgrade validates the WebSocket handshake itself. Only this
        // dedicated path is claimed; other upgrade handlers are untouched.
        wss.handleUpgrade(request, socket, head, peer => {
          if (!fresh()) { peer.terminate(); return; }
          admissions.set(request, { actor, peer });
          try { gateway.attach({ request, peer, language: route.language, consentVersion: 'voice-live-synthetic-v1' }).ready.catch(() => {}); }
          catch { admissions.delete(request); peer.close(1008, 'Voice evaluation unavailable'); }
        });
        socket.resume();
      } catch { reject(socket); }
      finally { releaseOwner(); clearTimeout(deadline); pending.delete(socket); socket.off('close', lost); socket.off('end', lost); socket.off('error', lost); socket.off('data', earlyData); }
    })();
  }
  httpServer.on('upgrade', upgrade);
  return Object.freeze({ capabilities: gateway.capabilities,
    async close() {
      if (closed) return; closed = true; httpServer.off('upgrade', upgrade);
      for (const socket of pending) reject(socket); pending.clear();
      await gateway.close(); for (const peer of wss.clients) peer.terminate();
      await new Promise(resolve => wss.close(() => resolve()));
    } });
}
module.exports = { createGeminiPcmUpgrade, PATH };
