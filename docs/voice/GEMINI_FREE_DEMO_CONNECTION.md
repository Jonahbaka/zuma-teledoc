# Secure connection checklist for a fictional, no-charge voice demo

Checked against official Google documentation on 2026-11-03. This is a readiness checklist, not an activation record. The application remains disabled by default and in production. No credentials or authoritative approvals have been supplied, and there is no genuine spoken DoctaRx demo yet.

## Exact service and unresolved account details

Use the **Gemini Developer API**, `gemini-3.8-live`, through the server-owned WebSocket candidate. The official SDK is an offline protocol reference, not a required application dependency. Do not substitute Vertex AI or infer API credentials from an AI Studio login. The intended Google account, exact Google Cloud project ID and named development server still need to be selected and verified. Each key belongs to a project. New AI Studio authorization keys are service-account-bound and restricted to the Generative Language API by default. See [API-key setup](https://aistudio.google.com/docs/api-key), [Live SDK setup](https://aistudio.google.com/docs/live-api/get-started-sdk) and [WebSocket reference](https://aistudio.google.com/api-reference/live).

The current executor has no Google/Gemini API-key, project or region environment configuration (presence checks only). `@google/genai` is not an application dependency; version 2.32.0 was installed separately in an isolated test directory from the official npm registry with lifecycle scripts disabled. This does not establish whether the user's Google account has existing keys, projects or billing. No real key values were inspected.

## Zero-charge prerequisites

1. Verify the selected project's actual Free Tier status, billing disabled, eligibility and model availability using non-secret provider metadata. Do not create another project/key merely to work around ineligibility.
2. Verify the current model's Free Tier terms and quota. Google currently lists Gemini 3.8 Live input/output as free; request rejection and capacity limits remain possible. Keep tools, paid models and fallback providers disabled. See [pricing](https://aistudio.google.com/docs/pricing#gemini-3.8-live) and [limits](https://aistudio.google.com/docs/rate-limits).
3. If Free Tier is unavailable for that project/account, stop. A new key in the same project does not repair eligibility, and a paid upgrade does not unlock free quota. Paid-project spend caps can overshoot because enforcement is delayed, so they cannot substitute for a no-charge condition. See [free-tier restrictions](https://aistudio.google.com/docs/troubleshooting#free-tier-unavailable) and [billing](https://aistudio.google.com/docs/billing).
4. Supply current, authoritative evaluation, tester consent, processing, credential-enrollment and billing/eligibility records to the existing read-only adapters. No real adapter is implemented here for Google billing/eligibility. Do not mark a UI observation as a fresh verified source merely by changing its timestamp.

The application policy validates an explicit `free_tier_only` zero-charge record plus matching verified billing evidence and denies any positive budget. This is not an atomic provider spending cap or proof that Google will never charge an externally changed project. That assurance and any billing-change protection must be established outside the current code before activation.

## Credential approval and secure configuration

After the account, project and server are identified, any creation of a new API/authorization key, service-account grant or persistent server configuration of an existing key needs specific action-time approval. Merely approving the free Studio test does not authorize those actions. No credential was created, read, copied or configured in this work.

Use an approved secure server-side secret mechanism. Never paste keys into chat, commit them to source, put them in browser code, use them in screenshots or include them in logs. Google documents environment variables and secret stores for server-side use. No concrete secure input/vault tool for this server has been verified, so this checklist does not claim one is available. See [key security](https://aistudio.google.com/docs/api-key#critical-security-rules).

The offline script `scripts/validate-gemini-sdk-offline.cjs` checks the pinned official 2.32.0 SDK using fictional keys and WebSocket doubles with all real networking blocked. It exposed the SDK's private pre-setup socket, which prevents immediate cleanup of a hung handshake. The SDK comparison factory is now test-only and must not be used for live evaluation.

The unmounted `geminiOwnedWebSocketClient.js` candidate avoids that ownership gap and uses the existing `ws` dependency. Its exact setup/realtime frames match the pinned SDK for all three languages. Actual loopback tests verify termination while connecting, closure before setup completion and a bounded termination fallback when a peer ignores graceful close. No external provider was contacted. Account, approval, billing evidence and real HTTPS/device validation remain prerequisites.

## Restrictions and honest demo evidence

Google's Developer API terms prohibit clinical practice, medical advice and regulated medical-device use. Unpaid content may be used for product improvement and human review. Use fictional, nonclinical adult dialogue without personal or confidential information. Current terms also distinguish EEA/UK/Switzerland client availability, which requires Paid Services. Nigeria appears in Google's supported-region list. See [terms](https://aistudio.google.com/docs/terms) and [regions](https://aistudio.google.com/docs/available-regions).

Prior AI Studio evidence consists of typed fictional prompts, displayed Hausa/Igbo/Yoruba response text and visible audio players. It does not demonstrate spoken input, actual DoctaRx routing, audio quality or native-speaker acceptance. Riko is a separate Nigerian-English TTS narration sample; the current Live path uses Zephyr.

A completed demo requires real HTTPS/device testing, fictional spoken input, interruption, output listening, all three language checks, explicit stop/closure evidence and human language/accent review. No deployment, real-patient use, source upload or paid use is authorized by this checklist.
