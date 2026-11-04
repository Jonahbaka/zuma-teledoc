# Authenticated fictional PCM gateway building block

For the later disabled-default application surface, current identity correlation and credential pinning, see [application composition](VOICE_PCM_APPLICATION_COMPOSITION.md). The original isolated checkpoint below remains historical evidence, not a live deployment claim.

This separate server peer adapter connects the bounded browser PCM graph to the Gemini evaluation transport. It remains **unmounted**, disabled by default, and disabled in production regardless of the flag. There is no WebSocket upgrade route, SDK installation, key lookup, database connection, real approval store, clinical tool, patient chart write or automatic activation.

## Admission and authority

A future trusted server composition must implement `admitPeer` against the original HTTP upgrade request. It must verify the current authenticated account/session, the socket upgrade and the allowed origin before returning server-verified actor metadata. The gateway independently compares the returned origin with its configured exact HTTPS origin and requires verified upgrade status. A peer frame can never supply identity, origin, consent approval or processor approval. These injected admission checks are **test doubles** in this slice, not a new deployed authentication path or proof that cookies, CSRF, proxy headers and socket upgrades are configured correctly.

The actual session-authority and PostgreSQL snapshot-reader code recheck current account status, role, provider approval, token family, credential epoch and original token expiry around the policy await. The separate Gemini policy requires new matching Google/model/account/project/region/terms/retention scope on evaluator, consent, processor and budget records. Existing OpenAI records cannot be reused. All records remain fictional fixtures in tests; this code creates no approvals. Budget approval is permission metadata, not an atomic spending reservation or enforced financial cap. Tester consent does not prove that microphone content contains no real patient information.

Admission and policy/session waits are bounded. Original-token, minimum-approval and three-minute deadlines can only shorten. Setup is bounded to 15 seconds. Background renewal starts four seconds after each successful authority check, without overlapping reads. Data forwarding requires a successful check less than five seconds old; stalled or denied renewal closes the peer and initiates provider teardown. These are bounded observation checks, not instantaneous revocation or transactional isolation across a real database/provider.

## Duplex protocol and limits

A peer is owned by one session and cannot be attached again. At most 50 sessions and two per admitted evaluator are retained, including unresolved cleanup. Only sequential JSON messages containing fixed greeting, PCM audio, capture-end or stop are accepted. No arbitrary text, video, tools, user IDs or approval claims are accepted. Binary frames and replays terminate the session.

Input must be canonical base64 for an exact 100 ms/3,200-byte PCM16LE frame at 16 kHz. Limits are 5,000 encoded bytes per message, 16 messages per rolling second and 1,800 audio frames cumulatively. The worklet separately bounds outstanding messages and duration. Fixed greeting can be sent once per transport. The underlying provider adapter enforces its own media and transcript limits.

Output forwards only the provider adapter's bounded PCM, clear-playback, provisional transcript and turn-complete events. Each serialized event is limited to 70,000 bytes; existing plus new peer-buffered data must not exceed 131,072 bytes. Backpressure, send errors, invalid input, expiry and revocation close the peer. This is not an application-level playback acknowledgement. The browser must immediately stop its exclusively owned capture/playback graph on peer closure and respect playback generations on interruptions. That wiring is exercised with fakes, not yet mounted in a user-facing panel.

## Cleanup and privacy

A terminal error listener retains no session/media and safely consumes delayed EventEmitter peer-close errors. Stop closes local peer admission immediately and independently attempts provider stop. Pending creation, unknown creation and unconfirmed provider closure remain explicit, with owner-only cleanup authority even after admission role loss. There are no automatic create retries. Known late provider handles are retained and closed; confirmed terminal receipts are owner-scoped and expire after ten minutes. Uncertain handles remain in a bounded in-memory map pending reconciliation. Durable restart recovery and operational reconciliation are still required before activation. Confirmed socket closure is never represented as final usage accounting or retention proof.

No audio/transcript history is stored by this gateway. Incident callbacks contain only a fixed code and opaque session ID. No source frames, provider payloads or raw error text are logged. A future production composition must also control proxy/server logs, buffers, data retention and access.

## Executed evidence

Eighteen Node tests exercise the real gateway, Gemini policy, session helper, SQL reader and transport against fictional query results, an admission double, a fake duplex peer and injected fake SDK. One cross-layer test executes the actual AudioWorklet source in a VM, sends its PCM through the actual browser graph and gateway to the fake SDK, feeds model PCM back to graph buffers, interrupts queued playback, and revokes the account's family to stop the owned fake microphone. Additional tests cover account/credential/consent revocation, approval expiry during the final session read, original-token expiry, input/output bounds, replay/unknown fields, concurrent admission cancellation, late provider creation and uncertain outcomes.

This is not actual PostgreSQL, socket-upgrade/JWT integration, browser/device audio, provider SDK/account execution or language-quality acceptance. No microphone permission, real audio capture, external provider call or clinical action occurred in these tests.

## Provider and clinical gates

Google Developer API terms restrict clinical practice and medical advice. A paid key or playground acknowledgement does not resolve that restriction. This adapter is only for approved fictional nonclinical evaluation until a suitable product/agreement and clinical/privacy governance exist. See the checked primary sources and protocol constraints in [Gemini Live evaluation](GEMINI_LIVE_EVALUATION.md).
