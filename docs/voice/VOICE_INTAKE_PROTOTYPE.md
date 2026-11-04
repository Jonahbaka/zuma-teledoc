# DoctaRx voice intake: implementation checkpoint

Date: 3 November 2026. Base: `b449c22`. Private local branch: `codex/voice-intake-synthetic-20261103`.

## Product direction

The intended product is natural, continuous, two-way speech in Hausa, Igbo and Yoruba. The patient should be able to interrupt, correct information and continue speaking without reading a form. Native speech-to-speech carries the conversation; source evidence, translation and clinician review are separate work. The synthetic text lab is an engineering test harness, **not the requested final voice product**.

This change implements the browser audio transport and server integration seams as well as the working synthetic workflow. **No live model connection, real microphone capture, human-language benchmark, patient use, public release, push or deployment has occurred.**

## Implemented

### Working synthetic vertical slice

- `/voice-lab` is a development-only, server-flagged UI. It uses the existing authenticated client. The Express route requires current application authentication plus clinician/admin role and session ownership.
- Acknowledgment precedes a session; all input is a fixed fixture key or bounded command. No free-text patient history, arbitrary audio, patient/encounter IDs, provider keys or client model instructions are accepted.
- Hausa, Igbo and Yoruba fixture conversations stream text, support interruption and corrections, keep source turns and English fixture meanings, and produce a separate source-linked draft.
- Corrections supersede earlier facts and invalidate prior review. Pause interrupts queued output. Resume never replays cancelled text. Stale epochs/revisions and duplicate command races are rejected.
- Review is explicitly a demonstration, never a clinical approval. There is no chart-import, treatment, prescribing, patient lookup or signing operation.
- Memory is bounded by session/turn caps and independent 10-minute expiry timers. End/withdrawal removes evidence immediately when the server receives the request. Browser unload delivery is **best-effort** through the existing authenticated client; TTL is the server-side backstop. No guaranteed unload delivery is claimed.
- Fixtures are **not native-speaker reviewed**. Their presence is not evidence of model fluency or accurate clinical translation.

### Real audio integration code, not yet live-tested

- `lib/voice/liveWebRtcSession.cjs` implements browser microphone acquisition, WebRTC media tracks, speaker playback, `oai-events`, server-mediated SDP negotiation, independent transcript callbacks, and lifecycle cleanup.
- A trusted server permit is required before asking the browser for microphone access. Tracks remain disabled until `session.started`. No browser credential is sent to OpenAI.
- Device loss, permission revocation, failed/disconnected peer connection, lost lease, stop, route/account/language change and pending-permission cancellation stop local media. Queued expiry and delayed failed-start cleanup cannot change a newer session. A new session requires reauthorization. Old async results and tracks cannot replace or silence newer-session audio.
- Local speaker mute acts immediately and remains in effect across late tracks, duplicate start events and pending playback promises. The panel exposes explicit Resume speaker through the same controller instead of an independent native audio control. Natural conversational barge-in belongs to GPT-Live. It is not implemented by incorrectly sending Realtime's `response.cancel` events to GPT-Live. Neither interruption quality nor latency has been measured against a model.
- The server owns `session.close`. Local capture/playback stop immediately for privacy; WebRTC/data-channel resources remain until sideband finalization or a bounded timeout. Final usage is not inferred from a disconnected browser.
- `openAiLiveAdapter.js` constructs the documented GPT-Live JSON SDP request with a server-only credential dependency and a restricted frontend event allowlist. No fallback provider or language is substituted.
- `openAiLiveSideband.js` implements server attachment and `session.close`/`session.closed` finalization. HTTP `/hangup` is **not used**: its reference describes SIP, not the WebRTC lifecycle.
- The live broker revalidates current role/owner, synthetic evaluation scope, consent version and processor approval before connection and on a short lease. Only a trusted policy callback can approve these. Flags and client checkboxes do not grant authority.
- Delegation cannot execute tools or clinical writes. This first integration slice ends the session if a delegation event arrives. A constrained, independently authorized intake delegation handler remains future work.
- Transcript fragments remain provisional, separately timed and language-tagged. They are not marked final turns, English translations or evidence of played/heard audio. They are not imported into the synthetic fixture draft path.
- Stop is available to the authenticated owner after role removal without granting new data access. Repeated stops return a bounded owner-only terminal receipt. Unresolved creation is explicitly pending or uncertain, never confirmed closed.
- Failed termination retains an owner-scoped cleanup handle; concurrent retries are serialized. Uncertain session creation is not blindly retried. Durable reconciliation across process restarts remains a production requirement.

## Activation boundaries

Both API routes are mounted beside existing clinical routes in `server/index.js`. **The shipped live route constructs no provider adapter or approval-policy adapter.** Even `DOCTARX_VOICE_LIVE_PROTOTYPE_ENABLED=true` cannot make that mount live. Production rejects both prototype services regardless of flags, and the UI returns 404 outside development.

The adapter reads no environment secret by itself and has no implicit global network transport. An approved composition root must supply the network transport, credential source, sideband socket adapter and trusted policy implementation explicitly. These are exercised with fakes in tests only.

`store:false` disables provider session storage for recording/fork features. It is **not** a claim of zero provider retention or a substitute for processor terms and privacy review.

## Trusted evaluation-policy adapter (unmounted)

`syntheticEvaluationPolicy.js` is a read-only implementation of the broker's authorization seam. It requires an immutable configured provider/account/project/model/region/terms/retention binding and a trusted reader of a consistent authoritative snapshot. The reader receives the validated language to select the appropriate consent record. Each authorization re-reads the current evaluator identity and role, evaluator grant, language-specific fictional-audio consent, processor approval and budget approval. All approval and consent records must match the same configured processing binding, so updated provider approval cannot silently reuse consent for an older scope. Expired, revoked, missing, stale or mismatched records fail closed, including records that expire during the read. Reads time out without cached approval or retry.

This helper creates no approvals, stores no consent, loads no secrets and is **not mounted** in the shipped route. The authoritative database reader and actual credential-to-account/project/region binding still need implementation and independent verification. The configured binding is metadata, not proof that an API key belongs to the approved account or that an endpoint enforces the approved region/retention. Budget approval is permission metadata only (`budgetEnforced:false`), not an atomic reservation or spending cap. Fictional-audio consent is an evaluator attestation, not a guarantee that microphone content contains no patient information.

## Local rehearsal

1. Use the existing repository and normal local clinician/admin sign-in.
2. Start the development API and Next application with `NODE_ENV=development` and `DOCTARX_VOICE_SYNTHETIC_ENABLED=true` on the API/Next processes.
3. Open `/voice-lab`. It requires the fictional-test acknowledgment. The live panel explicitly remains unavailable.
4. Run `npm run test:voice` for hermetic service, HTTP, client, WebRTC-fake, broker and sideband tests.
5. `npm run e2e:voice` launches an owned loopback Next server and synthetic Express handlers. Authentication alone is a fixed test identity. It blocks external requests and forbids microphone access. Chromium must be usable in the executor. This does not test real JWT/database-session authorization or a voice provider.

6. The standalone live-panel browser suite is prepared with `npx --no-install playwright test --config=playwright.voice.config.cjs`. It uses the actual panel/controller with fake media/provider and real loopback handlers. See [synthetic browser QA](VOICE_BROWSER_QA.md) for isolation, coverage and the current execution blocker.

No new npm dependency, database schema or public repository is required by this slice. No license change has been made. Reusable protocol/transport boundaries are separated for later authorized open-source extraction; the private DoctaRx platform is not published.

## Before the first real synthetic speech evaluation

- Approve a specific provider/account, model, retention/region/terms and budget for fictional tester audio, then configure credentials through the authorized secret path. Do not paste API keys into chat, source or browser storage.
- Connect the tested evaluation-policy adapter to authoritative, consistent approval/consent records and verified provider credentials, and expose it only to permitted evaluators. Keep clinical data blocked.
- Test server-owned close and usage finalization with the actual account, including failed sideband attach and network-loss reconciliation. A process restart must not orphan a listening or billed provider session.
- Finish the bounded delegation handler so GPT-Live can collect/clarify intake without ending on delegation. It must not grant model text clinical authority.
- Test native-speaker understanding, pronunciation, code-switching, genuine interruptions, echo/noisy room, device routing, phone and headset/microphone configurations. Measure latency rather than inferring it from fixtures.
- Independently evaluate clinically consequential meaning and speaker attribution for each language. Build human-reviewed pre-consent/outage audio and interpreter/manual paths.

## Before patient use

This slice is insufficient for patient use. Required work includes canonical encounter/assignment authorization, durable consent and revocation, approved processor and language policies, encrypted evidence and retention workers, audit/incident operations, qualified bilingual review, separate chart import and clinician signature, shared-device controls, validated session/device loss behavior, emergency-human handoff design, clinical/privacy/security review, and a narrowly supervised rollout. Do not repurpose the fictional consent acknowledgment as patient consent.

## Protocol sources, fetched 3 November 2026

These are protocol documentation, not evidence of an authenticated provider run:

- WebRTC setup, microphone/speaker tracks, SDP JSON and `session.started`: https://developers.openai.com/api/docs/guides/voice-webrtc
- GPT-Live session configuration, client/server event allowlists and `store`: https://developers.openai.com/api/reference/resources/live/methods/create
- Sideband `wss://api.openai.com/v1/live/sessions/{session_id}/attach`: https://developers.openai.com/api/docs/guides/voice-server-controls
- Transcript fragment timing, full-duplex captions, close/finalization: https://developers.openai.com/api/docs/guides/live-conversations
- SIP-only HTTP hangup reference, deliberately not used for WebRTC: https://developers.openai.com/api/reference/resources/live/subresources/sessions/methods/hangup

- Client delegation event metadata and task boundaries: https://developers.openai.com/api/docs/guides/live-delegation

## Verification checkpoint

- Voice-focused tests: **77 passed, 0 failed, 0 skipped**. Includes actual loopback HTTP handlers with injected test identity, fake WebRTC media/permission races, provider-request shape, sideband close, uncertain cleanup and owner-only stop receipts.
- Playback/lifecycle regression checks include old-session cleanup/expiry races and latest-mute-wins behavior. The UI resume/generation assertion is a source contract, not a rendered-browser pass.
- Trusted evaluation-policy checks: **20 of the 77 tests** cover current records, configured provider identity and approval versions, revocation/expiry, language-specific consent, timeout, broker lease revalidation and the unmounted boundary. All authority records are fictional; no live database or provider binding is verified.
- Cross-layer synthetic end-to-end coverage: **6 of the 77 tests** exercise the browser media controller through actual loopback HTTP routes, the real broker/provider adapter and a fake provider sideband. They use the actual evaluation-policy adapter with fictional authoritative records and cover all three languages, source/caption separation, server-owned close and role/consent/processor-approval revocation. Provider network and microphone dependencies remain fake.
- Existing clinical/auth/media regression selection: **22 passed, 0 failed, 2 database-dependent tests skipped**. No database authorization pass is claimed.
- Full repository lint: **passed with 28 pre-existing warnings, 0 errors**. Changed voice files have no lint findings. An initial lint attempt scanned generated output and was killed; generated voice output is now explicitly excluded, and the clean scan passed.
- Standalone browser-fixture boundary checks: **3 of the 77 tests** passed. The bundle compiled and Playwright discovered **22 desktop/mobile cases**, but none has executed in a browser. The supported cloud browser could not reach the owned loopback probe.
- Development Next route compilation: `/voice-lab` compiled and returned HTTP 200. This establishes compilation, **not rendered browser interaction**.
- Rendered Chromium automation: **blocked before browser launch** by the executor Unix-socket restriction. The approved escalation attempt failed during sandbox setup at a read-only path. No alternative bypass was attempted and no screenshots, axe pass or user-interaction pass are claimed.
- Full production build: **passed on exact runtime code commit `1ac68512`** with Node 22.23.4, a 768 MiB heap, one worker and memory optimizations. It compiled, checked types and generated all 241 static pages in 400.1 seconds; the dynamic `/voice-lab` route was included. Sampled total RSS peaked at 1,155,332 KiB. Two earlier attempts were killed by the environment (exit 137 and a worker SIGKILL). The successful runner restored the original Next configuration exactly.
- Production HTTP probe: a completed HEAD request returned **404** for `/voice-lab` with both prototype flags enabled in production. The earlier response-body read timed out. This checks the HTTP gate, not rendered interaction.
- Actual OpenAI calls, real microphone/speaker tests, human/native-language evaluation, network/device latency, production rollout, remote push and publication: **not performed**.

A successful fake transport test checks the application contract and cancellation behavior. It does not prove a model will speak fluently, obey clinical constraints or produce a faithful transcript. The source code is reviewable progress toward the requested live conversation, not a clinically ready release.
