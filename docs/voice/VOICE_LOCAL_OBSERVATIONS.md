# Opt-in local PCM lifecycle observations

The offline evaluation kit can now collect metadata from the actual PCM session and audio-graph code instead of reconstructing every transport event by hand. This is an explicit local evaluation composition. **The application does not install the observer, enable live voice, record audio or send logs.** Normal authorization, consent, HTTPS and provider requirements remain unchanged.

## What is implemented

`createObservedPcmSession` wraps one `createGeminiPcmSession` attempt with the bounded `createEvaluationTrace` collector. The caller supplies the existing authorized session factories and a local, non-identifying session reference. Each accepted start, verified server-ready permit, microphone request/enable, successful PCM send, WebAudio scheduling, mute/resume, Stop and cleanup callback produces only a named event, relative monotonic timestamp and that local reference.

The wrapper is single-use, including failed starts. Create a new wrapper with a distinct local reference for a new attempt. Late permission and close events stay with the old wrapper. It does not contain provider session IDs, actor IDs, session bindings, URLs, keys, transcript text or PCM bytes. Use a local label such as `evaluation-ha-1`, never a real account identifier or secret.

```js
const { createObservedPcmSession } = require('./lib/voice/observedPcmSession.cjs');

// existingAuthorizedFactories and validatedStartInput are supplied by an
// independently authorized harness. This example does not establish approval.
const session = createObservedPcmSession(existingAuthorizedFactories, {
  sessionRef: 'evaluation-ha-1',
});
await session.start(validatedStartInput);
// Carry out the separately consented, fictional evaluation.
await session.stop();
const snapshot = session.evidence();
```

`evidence()` returns a detached metadata snapshot, not a completed evaluation verdict. Later cleanup events can change a later snapshot. `not_started` means no start was attempted; `local_observations_only` means collection has not failed; `incomplete` means events were lost through an invalid clock, overflow or failed observer. None means the session, provider cleanup or language evaluation passed. Do not merge separate relative-clock traces without aligning their clock origins.

Direct low-level users may supply a synchronous `onObservation(type)` callback to the session or graph. A throwing, asynchronous or reentrant callback is disabled and the observation status becomes `incomplete`. Promise rejections are suppressed without exposing their text. Observability never becomes a prerequisite for local media teardown. Reentrant Stop calls from teardown callbacks share the original cleanup operation and do not manufacture a successful release receipt. Automatic failures and repeated Stop retain microphone/context uncertainty; a callback announcing a closed graph does not by itself confirm that its audio contexts have finished closing. The dedicated wrapper manages this callback itself and rejects a competing callback option.

## Evidence distinctions

- `consent.granted` records the client accepting its required current-consent input, not independent proof of a person's click or consent validity. The normal server remains the authority.
- `provider.ready` records the fully validated gateway-ready permit. It is not an independently authenticated observation of Google's internal state.
- `microphone.started` records first successful local capture enable. A session muted while permission is pending does not emit it until capture is actually enabled. Pause/resume is not track termination or detected speech end.
- `audio.input.sent` records successful local socket submission, not provider receipt or comprehension.
- `audio.output.scheduled` records successful WebAudio scheduling. It **never** produces `audio.output.started` or proves a person heard anything. Node-ended and queue-drained events are local scheduling observations only.
- `playback.cleared` records successful local queue cleanup, not acoustic silence. If source stop/disconnect fails, uncertainty stays visible through later empty clears. Confirmed audio-context closure can subsequently resolve that local uncertainty.
- `socket.close_requested` is a request. `socket.closed` requires an actual close event. Opted-in close observation is bounded to three seconds; absent closure becomes `socket.close_unconfirmed`, and its extra listener is removed. It does not block local microphone cleanup while waiting.
- Browser socket closure never emits `provider.closed`. The browser reports `provider.close_unconfirmed`; independent server/provider evidence is still needed.

The analyzer treats scheduling as active queued work for consent/readiness/after-stop checks, but never counts it as audible speech or interruption evidence. Audio sent while a reported microphone pause is active is a violation. Unconfirmed local cleanup remains missing evidence until a corresponding actual cleanup observation arrives.

This layer does not own the panel's caption store or checkbox. It therefore does not manufacture `captions.cleared` or a checkbox-specific `consent.withdrawn` event. Explicit UI observations, real audio, interruption-onset/audible-stop evidence and provider finalization remain separate. A raw observer trace should normally remain an incomplete spoken-demo record in the analyzer.

## Reproducible local demonstration

```sh
node --test server/tests/voice/pcm-local-observation.test.js
node scripts/evaluate-voice.cjs smoke
```

Each synthetic smoke check now includes its session-scoped `localObservations`. These come from the actual local session/graph path with injected sockets, devices and silent PCM. Their timestamps are **deterministic counters, not elapsed milliseconds or latency measurements**. Each export labels that timing basis and retains `realMicrophone: false`, `realProvider: false`, `audiblePlaybackVerified: false`, `providerClosureVerified: false`, `languageQualityValidated: false` and `activationApproved: false`.

Tests cover observer failures, late permission, callback-triggered Stop, initially muted capture, repeated Stop, socket-close uncertainty, failed source/context cleanup, scheduling versus audible evidence and metadata privacy. No real microphone, speaker, network provider, credential enrollment, upload or application activation is exercised.

See [the evidence runbook](VOICE_EVALUATION_KIT.md) for the remaining human reference, recordings and review requirements.
