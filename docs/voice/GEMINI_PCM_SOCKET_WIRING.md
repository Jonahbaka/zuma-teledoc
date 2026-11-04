# Authenticated fictional PCM socket and browser controller

The later [development application composition](VOICE_PCM_APPLICATION_COMPOSITION.md) installs a disabled-default capability/upgrade surface and real panel, adds HTTP/WebSocket identity correlation, coordinates bounded shared routing, and binds approved credential enrollment. The remaining paragraphs describe this earlier isolated wiring checkpoint; they are not a claim that a real speech demo has occurred.

This local, unmounted slice connects the previously separate browser PCM graph and server PCM gateway. It is not a live application demonstration. No microphone, real browser, external provider, credentials, patient data, source upload or deployment is involved in its executed tests.

## Server boundary

`createGeminiPcmUpgrade` installs an explicit HTTP upgrade handler only when a caller supplies a server. No application import installs it. It claims only `/api/voice-pcm-evaluation`, allows Hausa (`ha`), Igbo (`ig`) or Yoruba (`yo`) plus the fixed fictional-consent notice, and rejects extra/duplicate query keys. No token is accepted in the URL. The exact HTTPS origin must match. TLS is checked on the actual socket by default; forwarded headers cannot confer transport trust. Tests supply an explicitly fictional loopback transport verifier, not a production proxy bypass.

The installer parses cookies and invokes the supplied existing application authentication middleware. Runtime composition must supply the actual `authenticate` function, as the tests do. Frozen current-session metadata goes to the existing gateway. Fresh current-account, token-family, credential-version, consent, processor and budget approval checks remain the gateway's independent requirements. No client message creates those approvals.

Handshake admission times out, and both open admission sockets and unfinished authentication operations are bounded at 50. A timed-out operation retains its work slot until the underlying promise settles; cancellation is not assumed for database reads. Permanently hung operations therefore exhaust capacity and deny new sessions rather than growing work without a limit. Reads continue during admission so an observed FIN cancels it. Any data sent before the handshake completes is rejected instead of buffered. No server can know about a disconnect before the network exposes it; the regression explicitly waits for the server's end/close observation before releasing delayed authentication.

The WebSocket server rejects oversized input and disables compression. The gateway's input rate, frame/sequence limits, owner isolation, lease checks, provider teardown and uncertain-cleanup accounting are unchanged. Closing the installer removes its own listener and terminates its owned peers, not other protocols' listeners.

## Browser boundary

`createGeminiPcmSession` has no application import. It requires a fixed HTTPS origin, injected socket/media factories and explicit fictional consent. The browser supplies same-origin authentication cookies through the WebSocket handshake; this module never reads tokens, browser storage or API keys.

A valid server-ready permit precedes `getUserMedia`. Capture remains disabled until the owned PCM graph is ready. It then emits bounded 16 kHz PCM frames through the socket and plays bounded 24 kHz output. Provider interruption clears queued playback. Transcripts stay provisional, source-language-tagged and explicitly not clinically reviewed; they are not chart evidence or an English translation.

Stop, page hiding/exit, socket error/closure, permit expiry, device/graph failure and invalid/backlogged messages stop the owned media. Late permission/worklet completions cannot resurrect a stopped session or affect a replacement. A synchronous Stop from the microphone-request notification prevents requesting permission at all. Throwing status callbacks terminate without recursive notification and permanently disable that controller; a fresh controller with a healthy UI sink is required. Microphone pause sends the end marker, and speaker pause wins over a delayed resume. Cleanup does not establish hardware-level erasure, external provider retention or final billing.

## Shared-server routing remains a composition requirement

The real application's Socket.IO upgrade listener must be coordinated before mounting this handler. Engine.IO's default unknown-upgrade cleanup closes a competing socket after about one second, shorter than this installer's two-second authentication deadline. A real Socket.IO test reproduces this rejection with 1.2-second authentication and verifies no provider is created. A separate isolated fixture sets `destroyUpgrade:false` and proves the real Socket.IO client and slow authenticated voice handshake can coexist. That fixture configuration is not installed in the application and is not a recommendation to leave unknown upgrades open. An application integration needs explicit routing and bounded cleanup for unknown paths, with regression coverage for all existing protocols.

## Executed test scope

Focused tests cover actual JWT cookie verification, current-session authentication, loopback HTTP/WebSocket upgrades, the real browser controller, current-session authority/snapshot adapter, evaluation policy, gateway, provider adapter and PCM graph. SQL rows, approval records, media objects and SDK I/O remain fictional doubles. All three language selections traverse this full software chain, including PCM send/playback-shaped handling, provisional transcripts, interruption and teardown. The tests also cover admission cancellation/timeout/capacity, strict origin/query/transport rejection, malformed permits/events, visibility, backpressure, mute/resume and late-completion races.

This is not a rendered-browser pass, login/database integration, real TLS/proxy verification, provider session, duplex speech demonstration or human language/accent evaluation. The separate Google Studio typed greetings are not evidence that this application chain is live. Riko remains the separate TTS narration choice; it has not been substituted for the adapter's stock Live voice.

## Before any genuine speech demo

Complete reviewed application routing and UI composition, connect authoritative approval/session records and an approved provider credential binding, and verify a supported browser and actual audio devices. Keep the existing nonclinical evaluation restriction and production disablement. Validate provider termination/reconciliation and the approved account's usage controls. Then test fictional spoken input, genuine interruption, all three languages, and Nigerian-accent narration with human listening review. Existing approval or provider flags are not a clinical-use authorization.

Run the focused checks with `node --test server/tests/voice/gemini-pcm-client.test.js server/tests/voice/gemini-pcm-upgrade.test.js`. The full `npm test` includes them through `test:voice`.
