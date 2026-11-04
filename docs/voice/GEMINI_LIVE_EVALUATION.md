# Separate Gemini Live evaluation transport

The [offline spoken-demo evaluation kit](VOICE_EVALUATION_KIT.md) adds 22 reviewer scenarios, local synthetic lifecycle smoke checks and a file-bound evidence analyzer. It does not provide recorded speech or a language-quality pass and does not activate this transport.

Later local slices add an unmounted gateway and [authenticated PCM socket/controller wiring](GEMINI_PCM_SOCKET_WIRING.md). They do not activate the application or change the provider/patient-use restrictions described here.

This is an **unmounted, nonclinical protocol adapter**. The application still ships with live voice disabled. The existing GPT-Live WebRTC/SDP broker is unchanged: Gemini's PCM/WebSocket transport cannot be substituted for its SDP adapter. No SDK was installed, no credential was read or created, no provider was called by this code, and no HTTP or WebSocket gateway was added.

## Implemented seam

`createGeminiLiveEvaluationTransport` requires an explicitly injected `connectLive` function matching the official Google GenAI SDK's `ai.live.connect` shape. There is no network or environment fallback. Its fixed model is `gemini-3.8-live`, with stock voice `Zephyr`. Hausa, Igbo and Yoruba are evaluation selections in the system instructions, not claims of measured quality or clinical suitability. Riko is the user's separately accepted Gemini TTS narration voice; it was not present in the inspected Live playground voice menu and is not silently mapped to Zephyr.

The handle exists before asynchronous connection completes. It accepts input only after both a connection handle and `setupComplete`. It supports raw, little-endian signed 16-bit mono PCM at 16 kHz, an explicit end-of-microphone-stream signal and a fixed fictional greeting prompt allowed once per session. There is no arbitrary text, image, video or tool API. Output emits bounded 24 kHz PCM, unreviewed transcript events and turn/interruption markers. The consumer must actually stop and empty playback on `playback.clear`; this module does not render or play audio itself.

Input chunks are at most 16,000 bytes (500 ms), output chunks 48,000 bytes (1 second). Session totals are at most 180 seconds' worth of each PCM stream. A three-minute wall-clock deadline also applies. Setup times out after ten seconds and close observation after three seconds. Transcripts are limited to 4,096 characters per event and 32,768 per session. These are adapter validation limits, not a provider quota, enforced financial cap or proof of backpressure in a future network gateway.

A provider interruption increments the playback generation and clears output. Audio in the same message is discarded rather than requeued. Later valid audio carries the new generation. Generation/turn completion does not prove speaker playback, semantic correctness, clinical review or provider billing finalization. Input/output transcripts have independent ordering and must not be joined into a clinical evidence record without further provenance work.

Cancellation, timeout and expiry suppress later media. A connection arriving after Stop is closed. A missing/malformed connection handle retains explicit creation uncertainty; any usable close handle is kept for teardown. Concurrent Stop shares one cleanup attempt; an absent close callback is explicitly unconfirmed. A later close callback updates the receipt. Socket closure is not final provider accounting or retention confirmation. Tool requests, malformed media, excessive payloads and provider errors fail closed without executing a tool or exposing raw error details.

## Composition still required

Before any application integration, implement and independently review an authenticated, owner-isolated PCM gateway with the current-session/evaluation checks already required by the voice broker. It must enforce fresh consent/processor approval on active sessions, revoke access in the background, bound queue lengths and rate, ensure browser capture/playback teardown, preserve uncertain cleanup for durable reconciliation, and carry reliable trace/usage information without logging audio. A boolean assertion cannot establish that microphone content is fictional. This adapter is not an authorization boundary and must never be exposed directly as a public socket.

Actual browser resampling, echo cancellation, microphone permission/revocation, device loss, barge-in playback, sustained network loss, provider SDK/account/region/retention behavior, and language/accent acceptance remain unverified. Fake PCM tests establish protocol and lifecycle behavior only. Neither the existing 32 unexecuted browser cases nor the separate provider playground proves this adapter works end-to-end.

## Material provider-terms gate

Google's current Developer API terms state: “You may not use the Services in clinical practice, to provide medical advice”. The full restriction also covers uses requiring medical-device regulatory clearance. Free-service content may be used for product improvement and reviewed by people. A paid API key alone does not remove the clinical-use restriction. The user's approval of the playground acknowledgement covers a fictional demonstration, not permission or contractual suitability for patient use. A suitable provider product/agreement and clinical/privacy review remain required.

## Primary references checked 2026-11-03

- SDK connect, callbacks, PCM input/output and transcripts: https://aistudio.google.com/docs/live-api/get-started-sdk
- Current model configuration: https://aistudio.google.com/docs/models/gemini-3.8-live
- Setup, activity handling, interruption, audioStreamEnd and transcript ordering: https://aistudio.google.com/api-reference/live
- Pricing and free-tier data-use distinction: https://aistudio.google.com/docs/pricing
- Studio no-charge usage unless a paid key is linked: https://ai.google.dev/gemini-api/docs/billing/
- Current terms, clinical restriction and unpaid data use: https://aistudio.google.com/docs/terms
- TTS is a separate surface: https://aistudio.google.com/docs/speech-generation

## Separate provider-playground observation

On 2026-11-03, the already signed-in Google AI Studio Live playground showed Gemini 3.8 Live, Zephyr, no API key selected, and tools/search off. After the user approved its explicit terms acknowledgement, a fictional typed Hausa greeting prompt produced a transcript and an audio player while the page reported a live stream. No microphone/camera was enabled. The browser subsequently became unresponsive during audio retrieval and cleanup; no downloaded audio or confirmed disconnect was obtained. The old tab disappeared from inventory, which is not proof of provider-side finalization. A later Igbo attempt encountered a browser renderer crash (Chromium Error 9) before its Run could be verified. At that checkpoint Igbo/Yoruba were not demonstrated. After browser recovery, a later fictional typed-input test produced Igbo and Yoruba transcripts with three-second audio players in the same Live/Zephyr session, and Disconnect was verified by the Start new stream UI. Supported audio exports timed out, so no downloaded audio or listening-quality assessment was established. The later successful disconnect does not retrospectively prove finalization of the earlier lost session. Spoken input, interruptions, accent quality and DoctaRx integration remain unverified. These playground observations are not passing adapter or rendered-application tests.
