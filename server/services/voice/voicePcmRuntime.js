'use strict';
const express = require('express');
const { createGeminiPcmUpgrade } = require('./geminiPcmUpgrade');
const { createGeminiEvaluationPolicy } = require('./geminiEvaluationPolicy');
const { createGeminiCredentialBinding } = require('./geminiCredentialBinding');
const { GEMINI_LIVE_LANGUAGE_CATALOG } = require('../../../shared/voiceLanguageCatalog.cjs');
const { createGeminiLiveEvaluationTransport, MODEL, VOICE } = require('./geminiLiveEvaluationTransport');
const { createPostgresVoiceSessionReader } = require('./postgresVoiceSessionReader');
const { createVoiceSessionAuthority } = require('./voiceSessionAuthority');
const { publicVoiceSessionIdentity } = require('./voiceSessionBinding');
const NOTICE = 'voice-live-synthetic-v1';
// The application installs this with no composition, so flags alone cannot
// enable it. An approved evaluation must explicitly inject all dependencies.
function createVoicePcmRuntime({ httpServer, authenticate, expectedOrigin, env = {}, composition, verifyTransport, ...gatewayOptions } = {}) {
  const environment = Object.freeze({ NODE_ENV: env.NODE_ENV, DOCTARX_VOICE_GEMINI_PCM_ENABLED: env.DOCTARX_VOICE_GEMINI_PCM_ENABLED });
  let assertSession, authorize, provider;
  const configured = ['test', 'development'].includes(environment.NODE_ENV) && environment.DOCTARX_VOICE_GEMINI_PCM_ENABLED === 'true'
    && composition?.sessionPool && typeof composition.readApprovalSnapshot === 'function' && composition.providerBinding && composition.credential;
  if (configured) {
    assertSession = createVoiceSessionAuthority({ readSessionSnapshot: createPostgresVoiceSessionReader({ pool: composition.sessionPool }) });
    // This development application surface is restricted to the no-charge
    // evaluation. A positive budget or paid-project cap is not an alternative.
    const policy = createGeminiEvaluationPolicy({ evaluationId: composition.evaluationId, providerBinding: composition.providerBinding,
      readApprovalSnapshot: composition.readApprovalSnapshot, requireFreeTier: true });
    const credential = createGeminiCredentialBinding({ ...composition.credential, providerBinding: composition.providerBinding });
    authorize = async input => {
      const approval = await policy(input), enrollment = await credential.assertCurrentBinding();
      return { ...approval, validUntil: Math.min(approval.validUntil, enrollment.expiresAt),
        credentialBinding: { credentialRef: enrollment.credentialRef, revision: enrollment.revision, fingerprintSha256: enrollment.fingerprintSha256 } };
    };
    provider = createGeminiLiveEvaluationTransport({ connectLive: credential.connectLive });
  }
  const upgrade = createGeminiPcmUpgrade({ ...gatewayOptions, httpServer, authenticate, expectedOrigin, env: environment, assertSession, authorize, provider, ...(verifyTransport ? { verifyTransport } : {}) });
  const capabilities = () => ({ enabled: upgrade.capabilities().enabled, provider: 'google', model: MODEL, voice: VOICE, billingMode: 'free_tier_only',
    languages: GEMINI_LIVE_LANGUAGE_CATALOG.map(({ code, name, support }) => ({ code, name, support })), consentVersion: NOTICE, clinicalUse: false });
  const router = express.Router();
  router.use((_req, res, next) => { res.set('Cache-Control', 'private, no-store'); next(); });
  router.use(typeof authenticate === 'function' ? authenticate : (_req, res) => res.status(401).json({ success: false, code: 'VOICE_AUTH_REQUIRED' }));
  router.get('/capabilities', (req, res) => {
    if (!req.user?.id || !['provider', 'admin', 'super_admin'].includes(req.user.role)) return res.status(403).json({ success: false, code: 'VOICE_ACCESS_DENIED' });
    try { res.json({ success: true, capabilities: capabilities(), identity: publicVoiceSessionIdentity({ id: req.user.id, voiceAuth: req.authSessionContext }) }); }
    catch { res.status(403).json({ success: false, code: 'VOICE_CURRENT_SESSION_REQUIRED' }); }
  });
  return Object.freeze({ router, capabilities, close: () => upgrade.close() });
}
module.exports = { createVoicePcmRuntime };
