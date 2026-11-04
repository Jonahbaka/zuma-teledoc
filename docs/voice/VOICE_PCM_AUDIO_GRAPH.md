# Browser PCM capture and playback building block

The separate [authenticated PCM socket/controller slice](GEMINI_PCM_SOCKET_WIRING.md) now composes this graph in isolated loopback tests. It remains unmounted; the real-browser and live-provider limits below still apply.

`lib/voice/pcmAudioGraph.cjs` and `public/voice/pcm-capture-worklet.js` implement a real Web Audio/AudioWorklet-shaped media path for a future authenticated PCM gateway. They are **not mounted in the application**. No microphone permission, browser capture, external model request or live activation occurred while developing/testing this slice.

## Media path

The caller must first obtain current server authorization, explicit microphone consent and an audio-only MediaStream through the browser's permission flow. It then transfers exclusive ownership of that stream (mixed audio/video streams are rejected) and newly created audio contexts to the graph. The graph itself never calls getUserMedia, selects a device, loads a remote module or connects to a provider.

A 16 kHz capture AudioContext asks the browser to perform input resampling. A separate 24 kHz playback AudioContext preserves the provider output rate. Actual supported rates are checked; unsupported rates fail closed instead of pretending to have resampled audio. Browser resampling, quality, latency, echo cancellation and hardware compatibility still require real-device testing. The caller should request appropriate mono/echo-cancellation/noise-suppression constraints, while recognizing that those are browser hints rather than proven audio quality.

The local worklet averages available input channels, clamps samples, encodes signed PCM16 little-endian and emits 100 ms (3,200-byte) transferred buffers. It does not assume a fixed browser render-quantum size. Its output is always silent, so microphone input is not played locally. Partial sample buffers are cleared on mute/stop. The worklet allows at most four unacknowledged 100 ms buffers (12,800 bytes) and stops processing on a stalled consumer; acknowledgements must match both frame sequence and capture generation. It also independently limits cumulative capture to 1,800 frames across all mute/resume generations. Thus a blocked main thread cannot accumulate an unbounded microphone-message backlog, although native track release still depends on the main thread/browser. Capture starts disabled and may be enabled only after the caller has a ready authorized provider/gateway. A new capture generation on every mute/resume prevents older queued frames crossing that boundary.

The main graph validates frame size and a three-minute input budget before invoking a synchronous, bounded input sink. Throwing or returning an asynchronous promise stops capture rather than building an unbounded send queue. A future socket sink must check bufferedAmount and its own authenticated rate limits before returning; this module is not a network backpressure implementation or authorization boundary.

Incoming 24 kHz PCM16LE is converted to AudioBuffers and scheduled in order. At most two seconds and 32 sources may be queued; overflow stops the session rather than allowing delayed conversation to grow. Provider interruptions must call clearPlayback with their new generation, which stops every queued source; old-generation chunks are rejected. Speaker mute discards later audio, and a delayed Resume cannot undo a newer mute. Resuming never replays discarded audio.

If a queued source cannot be stopped or disconnected during interruption or speaker mute, the graph terminates rather than scheduling another turn over uncertain output. Context closure is then requested, and only its actual cleanup result can clear playback uncertainty. Reentrant teardown uses the same stable cleanup promise.

## Privacy and lifecycle

Stop immediately disables/stops owned tracks, disconnects the worklet/source, removes listeners and clears queued playback. Device-ended, processor errors, unexpected audio-context suspension/closure, deadline expiry, malformed audio and sink failures use the same teardown. Late worklet loads, frames and resume completions cannot restart a stopped graph. Separate instances do not share contexts or an audio element.

The returned cleanup receipt distinguishes stopped tracks from context closure. Audio-context close observation is bounded at 1.5 seconds and may remain unconfirmed; a failed track stop is not reported as verified release. Disabling a track is not a promise of hardware-level shutdown or guaranteed memory erasure. No audio is intentionally persisted by this module, but browser/runtime buffering and provider retention are separate concerns.

The caller must forward consent revocation, page exit/visibility policy, server lease denial and provider errors to Stop and must terminate the remote session separately. The local deadline is at most three minutes and must be derived from the server permit, never treated as a client-created approval. This graph cannot prove microphone content is fictional. Production and patient-use gates remain unchanged.

## Executed evidence and remaining integration

Twenty-two Node tests use fake MediaStream/Web Audio objects plus execution of the actual worklet source in an isolated VM. They cover PCM framing, channel mix/clamp, silence, unresponsive-consumer/ACK limits, independent cumulative capture limits, mixed-stream refusal, buffering limits, sample-rate refusal, interruption generations, stale capture frames, speaker mute/resume races, stop during module load, expiry/device/processor/context failure, independent graph ownership and uncertain cleanup. No actual AudioContext, microphone, speaker or browser was exercised.

A reviewed authenticated PCM socket gateway, user-gesture/permission UI, fresh consent/session lease checks, provider composition, browser/device tests and language/accent evaluation are still required. The existing OpenAI WebRTC path is untouched. The Gemini Developer API clinical-use restriction is also unchanged; this is a nonclinical evaluation building block, not a patient service.

## Platform references

- AudioContext sample-rate configuration: https://developer.mozilla.org/en-US/docs/Web/API/AudioContext/AudioContext
- Worklet process/input/output behavior: https://developer.mozilla.org/en-US/docs/Web/API/AudioWorkletProcessor/process
- Worklet processor failure event: https://developer.mozilla.org/en-US/docs/Web/API/AudioWorkletNode/processorerror_event
- Provider PCM formats: https://aistudio.google.com/docs/live-api/get-started-sdk
