#!/usr/bin/env node
'use strict';

// Local structural checks only. All sockets, devices, clocks and audio contexts
// below are injected test objects. No server, provider or browser is started.
const assert = require('node:assert/strict');
const { createPcmPanelController } = require('../lib/voice/pcmPanelController.cjs');
const { createObservedPcmSession } = require('../lib/voice/observedPcmSession.cjs');
const { browser, deferred, FakeSocket } = require('../server/tests/voice/helpers/pcmBrowser.cjs');

const SUPPORTED_LANGUAGES = Object.freeze(['ha', 'ig', 'yo']);
const NOTICE = 'voice-live-synthetic-v1';
const IDENTITY = Object.freeze({ actorId: 'fictional-smoke-evaluator', sessionBinding: 'a'.repeat(64) });
const NOW = 1000;
const EVIDENCE = Object.freeze({
  evidenceType: 'synthetic_transport_fixture',
  languageAccuracy: 'not_evaluated',
  accentAcceptance: 'not_evaluated',
  realMicrophone: false,
  realProvider: false,
  activationApproved: false
});
const flush = () => new Promise(resolve => setImmediate(resolve));

// Every operation in this fixture should settle without an external event.
// Observe one full event-loop turn rather than letting a regression hang a CLI.
async function settled(promise, operation) {
  let outcome;
  const observed = Promise.resolve(promise).then(
    value => { outcome = { value }; },
    error => { outcome = { error }; }
  );
  await flush();
  assert.ok(outcome, `${operation} did not settle in the local fixture`);
  await observed;
  if (Object.hasOwn(outcome, 'error')) throw outcome.error;
  return outcome.value;
}

function fixture(language, { pendingPermission = false } = {}) {
  const permission = pendingPermission ? deferred() : null;
  const media = browser(permission ? { getUserMedia: () => permission.promise } : {});
  const sockets = [], timers = new Map(), starts = [], observations = [];
  let timerId = 0, permissionResolved = false, observationClock = 0;
  const panel = createPcmPanelController({
    userId: IDENTITY.actorId, role: 'provider', language, browserSupported: true,
    // This enabled response is fictional, not a change to application policy.
    loadCapabilities: async () => ({
      success: true, identity: IDENTITY,
      capabilities: { enabled: true, provider: 'google', model: 'gemini-3.8-live', voice: 'Zephyr',
        clinicalUse: false, consentVersion: NOTICE, languages: SUPPORTED_LANGUAGES.map(code => ({ code })) }
    }),
    createSession: callbacks => {
      const client = createObservedPcmSession({
        ...callbacks, ...media, origin: 'https://voice-evaluation.invalid', now: () => NOW,
        setTimer(fn, ms) { const id = ++timerId; timers.set(id, { fn, ms }); return id; },
        clearTimer(id) { timers.delete(id); },
        createSocket(url) { const socket = new FakeSocket(url); sockets.push(socket); return socket; }
      }, { sessionRef: `fictional-${language}-session-${observations.length + 1}`, now: () => observationClock++ });
      observations.push(client); return client;
    }
  });
  const permit = () => ({ type: 'session.ready', provider: 'google', model: 'gemini-3.8-live', language,
    dataClass: 'synthetic', consentVersion: NOTICE, sessionId: `fictional-${language}-${sockets.length}`,
    expiresAt: NOW + 180000, ...IDENTITY });
  function start() { const promise = panel.start(); starts.push(promise); return promise; }
  function ready(socket = sockets.at(-1)) { socket.open(); socket.message(permit()); }
  async function connect() {
    panel.setConsent(true);
    const starting = start();
    assert.equal(media.requests(), 0);
    ready();
    assert.equal(await settled(starting, 'Panel start'), true);
    assert.equal(panel.snapshot().phase, 'listening');
    assert.equal(new URL(sockets.at(-1).url).searchParams.get('language'), language);
    return sockets.at(-1);
  }
  function resolvePermission() {
    assert.ok(permission, 'This fixture has no pending permission');
    assert.equal(permissionResolved, false, 'Permission may only resolve once');
    permissionResolved = true;
    const stream = media.stream(); permission.resolve(stream); return stream;
  }
  async function teardown() {
    await settled(panel.dispose(), 'Panel dispose');
    if (permission && !permissionResolved) resolvePermission();
    await flush();
    await settled(Promise.all(starts), 'Outstanding panel starts');
    for (const stream of media.streams) {
      assert.equal(stream.track.readyState, 'ended', 'Fictional capture track remained live');
      assert.equal(stream.track.enabled, false, 'Fictional capture track remained enabled');
      assert.equal(stream.track.listeners.get('ended')?.size || 0, 0);
    }
    for (const context of media.contexts) assert.equal(context.state, 'closed');
    for (const node of media.nodes) assert.ok(node.stops > 0, 'Queued playback was not stopped');
    for (const worklet of media.worklets) assert.equal(worklet.port.onmessage, null);
    for (const socket of sockets) {
      assert.equal(socket.readyState, 3);
      assert.equal(socket.listeners.get('message')?.size || 0, 0);
      assert.equal(socket.listeners.get('close')?.size || 0, 0);
    }
    assert.equal(timers.size, 0, 'Fictional timers leaked');
    assert.equal(media.pageTarget.listeners.get('pagehide')?.size || 0, 0);
    assert.equal(media.documentTarget.listeners.get('visibilitychange')?.size || 0, 0);
    assert.equal(panel.snapshot().captions.length, 0);
    assert.equal(panel.snapshot().consent, false);
    return {
      status: 'passed', fictionalTracksStopped: media.streams.length,
      fictionalContextsClosed: media.contexts.length, fictionalSocketsClosed: sockets.length,
      activeCaptureTracks: 0, queuedPlaybackSources: 0, pendingTimers: 0,
      captionCount: 0, consentRetained: false
    };
  }
  return { panel, media, sockets, start, ready, permit, connect, resolvePermission, teardown,
    observations: () => observations.map(client => ({ ...client.evidence(), evidenceType: 'synthetic_transport_fixture',
      timingBasis: 'deterministic_counter_not_elapsed_time', realMicrophone: false, realProvider: false })) };
}

const caption = socket => socket.message({ type: 'transcript', speaker: 'assistant',
  text: 'Fictional transport marker; this is not a language sample.' });
const play = (socket, playbackEpoch = 0) => socket.message({ type: 'audio.pcm',
  data: Buffer.alloc(480).toString('base64'), sampleRate: 24000, playbackEpoch });

const CHECKS = Object.freeze([
  {
    id: 'consent_required', name: 'Consent is required before creating a session',
    async run(f) {
      assert.equal(await f.start(), false);
      assert.equal(f.sockets.length, 0); assert.equal(f.media.requests(), 0);
      return { startAccepted: false, fictionalSocketsCreated: 0, fictionalMicrophoneRequests: 0 };
    }
  },
  {
    id: 'start_deduplicated', name: 'Repeated starts create only one owned session',
    async run(f) {
      f.panel.setConsent(true);
      const first = f.start();
      assert.equal(await f.start(), false); assert.equal(f.sockets.length, 1);
      assert.equal(f.media.requests(), 0);
      f.ready(); assert.equal(await settled(first, 'First start'), true);
      assert.equal(await f.start(), false); assert.equal(f.sockets.length, 1);
      assert.equal(f.media.requests(), 1);
      f.media.frame();
      assert.equal(f.sockets[0].sent.filter(event => event.type === 'audio.pcm').length, 1);
      return { fictionalSocketsCreated: 1, fictionalMicrophoneRequests: 1, syntheticPcmFramesSent: 1,
        pendingDuplicateAccepted: false, activeDuplicateAccepted: false };
    }
  },
  {
    id: 'pending_start_stop_blocks_late_permit', name: 'Stopping a pending start prevents later microphone acquisition',
    async run(f) {
      f.panel.setConsent(true); const starting = f.start(), socket = f.sockets[0];
      const receipt = await settled(f.panel.stop(), 'Pending start stop');
      assert.equal(await settled(starting, 'Cancelled start'), false);
      // Deliver even a late open and a valid-looking old permit to the old socket.
      f.ready(socket); await flush();
      assert.equal(f.media.requests(), 0); assert.equal(f.media.contexts.length, 0);
      assert.equal(socket.readyState, 3); assert.equal(f.panel.snapshot().phase, 'stopped');
      assert.deepEqual(receipt, { tracksStopped: true, contextsClosed: true });
      return { cancelledStartAccepted: false, fictionalMicrophoneRequestsAfterCancel: 0,
        fictionalAudioContextsCreated: 0, oldSocketClosed: true };
    }
  },
  {
    id: 'pending_permission_stop_disables_late_stream', name: 'A late fictional permission result is stopped without enabling capture',
    options: { pendingPermission: true },
    async run(f) {
      f.panel.setConsent(true); const starting = f.start(); f.ready();
      assert.equal(f.media.requests(), 1);
      const receipt = await settled(f.panel.stop(), 'Pending permission stop');
      assert.equal(receipt.permissionPending, true); assert.equal(receipt.tracksStopped, false);
      assert.match(f.panel.snapshot().cleanupWarning, /permission request is still pending/);
      const lateStream = f.resolvePermission(); await flush();
      assert.equal(await settled(starting, 'Cancelled permission start'), false);
      assert.equal(lateStream.track.readyState, 'ended'); assert.equal(lateStream.track.enabled, false);
      assert.equal(f.media.contexts.length, 0); assert.equal(f.media.worklets.length, 0);
      assert.equal(f.sockets[0].sent.length, 0);
      return { permissionPendingWasReported: true, immediateReleaseWasUnconfirmed: true,
        lateFictionalTrackStopped: true, fictionalAudioContextsCreated: 0, syntheticPcmFramesSent: 0 };
    }
  },
  {
    id: 'owned_capture_stop_clears_captions', name: 'Stop releases owned capture and clears captions',
    async run(f) {
      const socket = await f.connect(); f.media.frame(); caption(socket); play(socket);
      assert.equal(f.panel.snapshot().captions.length, 1);
      assert.equal(f.panel.snapshot().captions[0].language, new URL(socket.url).searchParams.get('language'));
      assert.equal(f.media.streams[0].track.enabled, true);
      const stopping = f.panel.stop();
      assert.equal(f.media.streams[0].track.readyState, 'ended');
      assert.equal(f.panel.snapshot().captions.length, 0);
      const framesBeforeLateDelivery = socket.sent.length; f.media.frame(); caption(socket);
      assert.equal(socket.sent.length, framesBeforeLateDelivery);
      assert.equal(f.panel.snapshot().captions.length, 0);
      assert.deepEqual(await settled(stopping, 'Owned capture stop'), { tracksStopped: true, contextsClosed: true });
      return { captureWasEnabled: true, fictionalTrackStopped: true, captionsBeforeStop: 1,
        captionsAfterStop: 0, syntheticFramesSentAfterStop: 0, queuedPlaybackStopped: true };
    }
  },
  {
    id: 'consent_withdrawal_clears_captions', name: 'Consent withdrawal stops capture and clears captions',
    async run(f) {
      const socket = await f.connect(); f.media.frame(); caption(socket); play(socket);
      assert.equal(f.panel.snapshot().captions.length, 1);
      f.panel.setConsent(false);
      assert.equal(f.media.streams[0].track.readyState, 'ended');
      assert.equal(f.panel.snapshot().captions.length, 0); assert.equal(f.panel.snapshot().consent, false);
      const sent = socket.sent.length; f.media.frame(); caption(socket); await flush();
      assert.equal(socket.sent.length, sent); assert.equal(f.panel.snapshot().captions.length, 0);
      assert.equal(await f.start(), false); assert.equal(f.sockets.length, 1);
      return { fictionalTrackStopped: true, captionsBeforeWithdrawal: 1, captionsAfterWithdrawal: 0,
        syntheticFramesSentAfterWithdrawal: 0, restartWithoutAcknowledgmentAccepted: false };
    }
  },
  {
    id: 'interruption_clears_queued_pcm', name: 'An injected interruption event clears all queued PCM playback',
    async run(f) {
      const socket = await f.connect(); play(socket); play(socket);
      assert.equal(f.media.nodes.length, 2); assert.ok(f.media.nodes.every(node => node.stops === 0));
      socket.message({ type: 'playback.clear', playbackEpoch: 1 });
      assert.ok(f.media.nodes.every(node => node.stops === 1));
      assert.ok(f.media.nodes.every(node => node.onended === null));
      assert.equal(f.panel.snapshot().phase, 'listening');
      play(socket, 1); assert.equal(f.media.nodes.length, 3); assert.equal(f.media.nodes[2].stops, 0);
      return { queuedPcmSourcesBeforeInterruption: 2, stoppedPcmSourcesAfterInterruption: 2,
        queuedPcmSourcesImmediatelyAfterInterruption: 0, freshEpochPlaybackAccepted: true,
        interruptionOrigin: 'injected_playback_clear_event', humanBargeInDetection: 'not_evaluated' };
    }
  },
  {
    id: 'renewed_acknowledgment_required', name: 'Old sessions and old consent cannot restart capture',
    async run(f) {
      const oldSocket = await f.connect(); caption(oldSocket);
      await settled(f.panel.stop(), 'Old session stop');
      assert.equal(await f.start(), false); assert.equal(f.sockets.length, 1);
      f.ready(oldSocket); caption(oldSocket); await flush();
      assert.equal(f.media.requests(), 1); assert.equal(f.panel.snapshot().captions.length, 0);
      f.panel.setConsent(true); const restart = f.start(), newSocket = f.sockets[1];
      assert.notEqual(oldSocket, newSocket); f.ready(newSocket);
      assert.equal(await settled(restart, 'Fresh acknowledged start'), true);
      assert.equal(f.media.requests(), 2); caption(oldSocket);
      assert.equal(f.panel.snapshot().captions.length, 0);
      assert.equal(f.media.streams[0].track.readyState, 'ended');
      assert.equal(f.media.streams[1].track.enabled, true);
      assert.equal(newSocket.readyState, 1);
      return { restartWithoutAcknowledgmentAccepted: false, lateOldPermitCreatedCapture: false,
        renewedAcknowledgmentAccepted: true, freshSessionCreated: true, staleCaptionsAccepted: false,
        oldFictionalTrackStopped: true, newFictionalTrackEnabled: true };
    }
  }
]);

function selectedLanguages(options) {
  const invalid = () => Object.assign(new TypeError('Provide only a nonempty, unique languages array containing ha, ig or yo.'),
    { code: 'VOICE_SMOKE_OPTIONS_INVALID' });
  if (!options || typeof options !== 'object' || Array.isArray(options)
    || Object.keys(options).some(key => key !== 'languages')) throw invalid();
  const languages = options.languages === undefined ? SUPPORTED_LANGUAGES : options.languages;
  if (!Array.isArray(languages) || languages.length < 1 || languages.length > 3
    || [...languages].some(language => !SUPPORTED_LANGUAGES.includes(language))
    || new Set(languages).size !== languages.length) throw invalid();
  return [...languages];
}

function failureDetail(error, stage) {
  return { stage, code: typeof error?.code === 'string' ? error.code : 'VOICE_SMOKE_CHECK_FAILED',
    message: error instanceof Error ? error.message : String(error) };
}

async function runVoiceEvaluationSmoke(options = {}) {
  const languages = selectedLanguages(options), results = [];
  for (const language of languages) {
    const structuralChecks = [];
    for (const check of CHECKS) {
      let f, observed, teardown;
      const failures = [];
      try {
        f = fixture(language, check.options); await f.panel.load();
        assert.equal(f.panel.snapshot().capability?.enabled, true);
        observed = await check.run(f);
      } catch (error) { failures.push(failureDetail(error, 'structural_check')); }
      finally {
        if (f) {
          try { teardown = await f.teardown(); }
          catch (error) { failures.push(failureDetail(error, 'teardown')); teardown = { status: 'failed' }; }
        }
      }
      structuralChecks.push({ id: check.id, name: check.name, status: failures.length ? 'failed' : 'passed',
        ...(observed ? { observed } : {}), teardown: teardown || { status: 'not_started' },
        localObservations: f ? f.observations() : [],
        ...(failures.length ? { failures } : {}) });
    }
    results.push({ language, ...EVIDENCE,
      structuralStatus: structuralChecks.every(check => check.status === 'passed') ? 'passed' : 'failed', structuralChecks });
  }
  const checks = results.flatMap(result => result.structuralChecks);
  return {
    schemaVersion: 1, mode: 'local_pcm_structural_smoke', ...EVIDENCE, languages,
    structuralStatus: checks.every(check => check.status === 'passed') ? 'passed' : 'failed',
    summary: { structuralChecks: checks.length, passed: checks.filter(check => check.status === 'passed').length,
      failed: checks.filter(check => check.status === 'failed').length },
    limitations: [
      'Language codes are exercised as routing and caption metadata, not as spoken language.',
      'Silent generated PCM bytes and an English transport marker are not native-speaker gold samples.',
      'Injected playback.clear tests queue teardown, not provider interruption detection or human barge-in.',
      'Local observation traces use deterministic counter timestamps, not measured latency; scheduled WebAudio is not audible speech and socket closure is not provider finalization.',
      'No conversation accuracy, accent acceptance, clinical safety or real-device behavior is validated.',
      'No provider, credential, application activation or deployment is authorized by this report.'
    ],
    results
  };
}

module.exports = { runVoiceEvaluationSmoke };

if (require.main === module) {
  (async () => {
    if (process.argv.length !== 2) throw new Error('This local-only smoke CLI takes no arguments; import runVoiceEvaluationSmoke to select languages.');
    const report = await runVoiceEvaluationSmoke();
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (report.structuralStatus !== 'passed') process.exitCode = 1;
  })().catch(error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
}
