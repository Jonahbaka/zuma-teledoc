'use strict';
const { createGeminiPcmSession } = require('./geminiPcmSession.cjs');
const { createEvaluationTrace } = require('./evaluationTrace.cjs');

// Explicit local evaluation composition, not imported by the application. One
// wrapper owns one attempted session, so late permission/socket observations
// cannot be attributed to a replacement session. It records metadata only.
function createObservedPcmSession(options, { sessionRef, now = () => performance.now(), maxEvents = 5000 } = {}) {
  if (!options || typeof options !== 'object' || Object.hasOwn(options, 'onObservation') || typeof sessionRef !== 'string') {
    throw Object.assign(new Error('Use a dedicated local observation wrapper.'), { code: 'PCM_OBSERVATION_OPTIONS_INVALID' });
  }
  const trace = createEvaluationTrace({ sessionRef, now, maxEvents });
  let attempted = false;
  const client = createGeminiPcmSession({ ...options, onObservation: type => { trace.record(type); } });
  return Object.freeze({
    async start(input) {
      if (attempted) throw Object.assign(new Error('Create a new observed session for another attempt.'), { code: 'PCM_OBSERVATION_SESSION_USED' });
      attempted = true; return await client.start(input);
    },
    stop: client.stop, setMicrophonePaused: client.setMicrophonePaused, pauseSpeaker: client.pauseSpeaker, resumeSpeaker: client.resumeSpeaker,
    evidence() {
      return Object.freeze({ schemaVersion: 'pcm-local-observations-v1',
        status: client.observationStatus() !== 'observing' ? 'incomplete' : attempted ? 'local_observations_only' : 'not_started',
        provenance: 'local_software_callbacks_not_independently_attested', trace: trace.snapshot(),
        audioRecorded: false, transcriptRecorded: false, audiblePlaybackVerified: false, providerClosureVerified: false,
        languageQualityValidated: false, activationApproved: false });
    },
  });
}
module.exports = { createObservedPcmSession };
