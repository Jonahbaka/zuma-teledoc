# Medical voice implementation status

Checked 2026-11-04. This is an internal engineering handoff, not homepage copy or a claim that clinical voice is operational.

## Product target and current boundary

DoctaRx needs real, two-way multilingual medical voice, usable by eligible providers and their patients across markets. The target is not a generated-tone or fictional conversation demonstration. Account/key onboarding is deferred at the user's direction; continue feature code and tests without credentials or patient data.

The repository currently contains implemented browser microphone/speaker transports, interruption controls, server-side session ownership, language routing, provider adapters, and controlled evaluation routes. It does **not** contain an activated clinical voice workflow. The existing consent, processor and budget policies authorize only their explicit evaluation purpose. Relabeling an evaluation permit, changing the prompt, adding an API key, or enabling a flag does not supply clinical authority.

## This change

`lib/voice/liveWebRtcSession.cjs` now:

- Attempts every acquired track's release independently; a device exception cannot skip other tracks, provider termination, or peer teardown.
- Immediately disconnects the browser peer when local microphone/speaker silence cannot be confirmed, rather than leaving a potentially transmitting peer open during the server-close timeout.
- Returns a stable receipt for duplicate Stop calls. Late microphone outcomes refresh the final receipt without hiding an earlier failed device release.
- Reports pending microphone permission immediately, even when server cleanup is slow. Late grant and denial both resolve the appropriate pending-permission concern.
- Enforces the original or shortened server deadline before late microphone activation, speaker resume, or event handling, even if the browser's timer is delayed. A later lease cannot extend the original permit.
- Bounds concurrent lease requests and cancels an outstanding ICE-gathering wait during Stop.
- Gives each HTTP lease renewal a 4-second deadline, capped by the remaining session lifetime. Missing, rejected or late renewal stops local media; Stop aborts that browser HTTP request separately from the server-owned provider-close operation. An overdue timer or response cannot revive or stop a replacement session.

`components/voice/LiveVoicePrototype.jsx` preserves device/transport cleanup warnings across replacement sessions and separately tracks outstanding permission prompts. A resolved prompt clears only its own pending state. It prevents another Start while a prior prompt is pending or the document is hidden. This remains the existing controlled evaluation UI; it has not been presented as a clinical feature or activated for clinical use.

## Provider decision still required

The existing Google adapter targets Gemini Developer API `gemini-3.8-live`, using the Zephyr live voice. Its documented language catalog is provider capability information, not evidence of clinical comprehension or validation. Igbo remains a separate experimental route and must not be described as clinically validated.

The standard [Gemini Developer API terms](https://aistudio.google.com/docs/terms) restrict clinical practice and medical advice. The standard [Google Cloud Service Specific Terms, Generative AI Services healthcare restrictions](https://cloud.google.com/terms/service-terms) also restrict clinical purposes; merely moving the same feature to Vertex/Google Cloud is not proof that clinical use is permitted. Any different applicable agreement must be verified for the exact account, service and proposed use before activation.

OpenAI is an alternative to assess, not a provider switch made by this change. Its [HIPAA-eligible functionality](https://help.openai.com/en/articles/20001069-hipaa-eligible-products-and-functionality) lists `/v1/realtime` and `/v1/live/sessions`, contingent on an executed BAA and organization Modified Retention unless OpenAI specifies otherwise. This does not establish DoctaRx account eligibility, all-market regulatory compliance, language quality, or clinical safety. An authorized organization representative must handle any healthcare agreement; no agreement, account or credential has been created or accepted here.

## Exact remaining integration inputs

1. **Approved service binding:** provider, account/organization, project, model and endpoint, processing region, applicable clinical-use agreement, retention configuration, and permitted age/market/use-case scope. Do not infer any of these from a working key.
2. **Approved existing credential access:** a server-only secret reference with authorized deployment target and enrollment/rotation metadata. Do not paste a key in chat, source, screenshots, test fixtures, browser bundles, logs or URLs. No secure key-collection form has been verified in this execution environment.
3. **Clinical session authority:** resolve the current authenticated account/session, canonical patient and encounter, current provider assignment, patient/participant consent for microphone processing by the named processor, and any required interpreter/clinician oversight from authoritative storage. Existing synthetic consent records cannot be reused.
4. **Language admission:** explicit reviewed language/model/voice combinations, native-speaker and clinical review, correction/clarification behavior, emergency escalation, and a usable human-interpreter fallback. Public provider language support alone does not supply these approvals.
5. **Clinical workflow composition:** mount a separate authorized clinical endpoint and UI using the shared media transport, retain the provider abstraction, and keep clinical actions outside model authority. Saving a transcript or importing an unsigned clinician-reviewed note requires the existing patient/encounter access, encryption, revision and audit path; voice must not create an alternative chart-write or prescription route.
6. **Operational control:** approved usage budget, concurrency and duration limits, canonical revocation/kill switch, privacy-safe incident receipts, actual provider close reconciliation, and HTTPS/proxy/browser configuration.
7. **Verification:** actual provider acceptance and two-way speech using non-patient test material, then authorized clinical validation. Verify microphone/speaker permissions, interruption, expiry/revocation, tab hiding, device loss, disconnect and cleanup on supported desktop/mobile browsers. No real speech, listening-quality or clinical-readiness claim follows from fixture tests.

## Verification boundary

The automated tests exercise the actual transport implementation with injected browser-shaped media and provider fixtures, including loopback HTTP through the real router, broker and provider adapter. They prove code-path behavior, not real microphone hardware, network/provider speech, pronunciation or clinical safety. Browser media verification is still outstanding. The previously observed browser launch restriction was not bypassed or retried in this change.

No production route was activated; no provider was switched; no credential was read/created; no patient data, deployment, paid CI or remote upload was used. The existing evaluation work is preserved as test infrastructure, not the requested product outcome.
