'use strict';
const { createPcmPanelController } = require('../../lib/voice/pcmPanelController.cjs');
const { createObservedPcmSession } = require('../../lib/voice/observedPcmSession.cjs');
const { GEMINI_LIVE_LANGUAGE_CATALOG } = require('../../shared/voiceLanguageCatalog.cjs');
const { createSimulatedSocket, IDENTITY, NOTICE, ORIGIN } = require('./simulation.cjs');
const { createGeneratedSource } = require('./generatedSource.cjs');
const canReplaceDemoController = (receipt, snapshot) => !snapshot?.cleanupWarning
  && (!receipt || (receipt.tracksStopped === true && receipt.contextsClosed === true && receipt.permissionPending !== true));
function createLocalDemoController({ language, createContext, createWorkletNode, pageTarget, documentTarget, onChange = () => {}, now = Date.now } = {}) {
  let socket, activeClient, disposed = false, attempt = 0, metrics = {}, latestEvidence = null, generatedSourceCleanup = null, generatedSourceStatus = null;
  const publish = () => { if (!disposed) onChange({ ...panel.snapshot(), metrics: { ...metrics } }); };
  const panel = createPcmPanelController({ userId: IDENTITY.actorId, role: 'provider', language, browserSupported: true,
    loadCapabilities: async () => ({ success: true, identity: IDENTITY, capabilities: { enabled: true, provider: 'google', model: 'gemini-3.8-live', voice: 'Zephyr',
      clinicalUse: false, consentVersion: NOTICE, languages: GEMINI_LIVE_LANGUAGE_CATALOG.map(({ code }) => ({ code })) } }), onChange: publish,
    createSession(callbacks) {
      const sessionAttempt = ++attempt; let source, sourceCleanup;
      generatedSourceStatus = null; generatedSourceCleanup = null; latestEvidence = null; metrics = {};
      const client = createObservedPcmSession({ ...callbacks, origin: ORIGIN, now, pageTarget, documentTarget,
        createContext, createWorkletNode,
        mediaDevices: { async getUserMedia() { source = createGeneratedSource({ createContext }); if (sessionAttempt === attempt) { generatedSourceStatus = source.status; generatedSourceCleanup = null; } return await source.ready; } },
        createSocket(url, protocol) { metrics = {}; socket = createSimulatedSocket({ url, protocol, language, now, onMetrics(value) { metrics = value; publish(); } }); return socket; }
      }, { sessionRef: `local-generated-tone-${sessionAttempt}` });
      activeClient = client;
      return { ...client, async stop() {
        const ending = client.stop(); sourceCleanup ||= source?.stop() || Promise.resolve({ tracksStopped: true, contextsClosed: true });
        const [receipt, generated] = await Promise.all([ending, sourceCleanup]);
        if (sessionAttempt === attempt) { latestEvidence = client.evidence(); generatedSourceCleanup = source ? { ...generated } : null; }
        return { ...receipt, tracksStopped: receipt.tracksStopped && generated.tracksStopped, contextsClosed: receipt.contextsClosed && generated.contextsClosed };
      } };
    }
  });
  function evidence() {
    return { mode: 'local_generated_tone_demo', language, realProvider: false, realMicrophone: false, generatedAudio: true,
      speechOrTranslation: false, audiblePlaybackVerified: false, languageQualityValidated: false, clinicalUse: false, activationApproved: false,
      metrics: { ...metrics }, generatedSourceStatus: generatedSourceStatus?.() || null, generatedSourceCleanup, localObservations: activeClient?.evidence() || latestEvidence, panelPhase: panel.snapshot().phase, cleanupWarning: panel.snapshot().cleanupWarning };
  }
  const hide = () => { if (documentTarget?.visibilityState === 'hidden') void panel.stop(); };
  const stop = () => { void panel.stop(); };
  pageTarget?.addEventListener?.('pagehide', stop); documentTarget?.addEventListener?.('visibilitychange', hide);
  return Object.freeze({ load: panel.load, setConsent: panel.setConsent, start: panel.start, stop: panel.stop,
    setMicrophonePaused: panel.setMicrophonePaused, pauseSpeaker: panel.pauseSpeaker, resumeSpeaker: panel.resumeSpeaker,
    reply: () => socket?.reply() || false, interrupt: () => socket?.interrupt() || false, evidence, snapshot: panel.snapshot,
    async dispose() { if (disposed) return; disposed = true; pageTarget?.removeEventListener?.('pagehide', stop); documentTarget?.removeEventListener?.('visibilitychange', hide); await panel.dispose(); }
  });
}
module.exports = { createLocalDemoController, canReplaceDemoController };
