# Unified PHC care-stage Clinical Copilot

This review branch builds on the protected Clinical Copilot (#16) and Groq demo adapter (#17).
All stages call the same protected `ng/services/phc/clinicalAiService.js` pipeline:
source snapshot -> centrally selected model -> strict JSON schema -> source references ->
encrypted time-limited draft -> clinician review -> explicit clinician-controlled care actions.

## Current connections

- **Patient intake:** nurse or clinician can create a source-linked intake clarification draft.
- **Triage:** documentation-only handover, not an AI severity or emergency decision. Existing deterministic patient triage remains separate and must not be replaced by a language model.
- **Clinician consultation:** clinician can generate a source-linked briefing before/during an assigned PHC encounter.
- **SOAP:** assigned clinician can review and accept a source-linked SOAP draft; chart import remains an explicit, separate unsigned note action in the existing provider EHR.
- **EMR:** encounter-scoped gap review, not a full longitudinal reconciliation or an automatic chart write.
- **Prescription:** missing documentation checklist only. No medication suggestion or prescription creation/sending; existing prescription and pharmacy safeguards remain in charge.
- **Referral:** encounter brief and documentation gaps only. Existing clinician-initiated referral creation and status transitions remain authoritative.
- **Follow-up:** reviewable, source-linked task proposals. Existing task creation requires clinician approval and explicit due date/role. No task is completed by AI.

## Privacy and activation

Default external model is **Groq GPT-OSS 120B** for synthetic non-production demos only, with a private server-side API key. The existing Groq adapter rejects any request unless all three conditions hold: the programme context is demo-only; NODE_ENV is development/test; and CLINICAL_AI_ALLOW_DEMO_GROQ=true. Programme AI enablement and clinician RBAC are independent requirements. Free API limits may change, and free-tier availability is not a legal basis for real patient-data processing.

No patient PHI is authorized for the free tier. Do not merge to production or turn on real patient traffic without a separately approved data-processing arrangement and clinical evaluation. No automatic diagnosis, prescribing, medical-record signing, referral sending, or treatment.

## Boundary of this increment

This connects all eight PHC **review stages** through one provider service and UI. It does not convert the separate US patient triage engine, legacy `/api/ai-assist` routes, pharmacy fulfilment, or hospital EHR system into autonomous AI clinical decision-makers. Those should be migrated only after their data authority and record/review models are reconciled. No production deployment is performed by this PR.

## Canonical provider encounter bridge (added)

- `server/services/linkedPhcAiService.js` verifies the currently assigned clinician and an explicit PHC-to-canonical EHR record link. It rejects ordinary encounters without an authorized PHC linkage.
- `POST /api/clinical-encounters/:encounterId/ai-review-drafts` creates a centrally configured source-linked draft for an authorized clinician. `POST /api/clinical-encounters/:encounterId/ai-review-drafts/:suggestionId/review` records the clinician's decision after verifying draft ownership.
- The provider encounter chart adds review controls for consultation, SOAP, EMR documentation gaps, prescription documentation gaps, referral context and follow-up proposals. These draft/review actions do not write or sign clinical records.
- Existing EHR import remains a separate reviewed SOAP action, retaining the normal chart signing process. Tests enforce canonical linkage and verify the absence of AI-driven prescription or signature calls in the draft UI.

## Outstanding integration and release work

Legacy US patient-side triage, old unscoped AI-assist routes, pharmacies, prescribing and independent referral-network workflows remain separate systems with different authorization contracts. Do not call the current implementation a complete cross-market AI rollout. Next: adapt each pathway to this protected service only where an actual authorized source record can be linked. Complete synthetic PostgreSQL tests, browser E2E, CI, provider privacy review, signed-off clinical testing and release approval before production activation.

## Manual prescription and referral provenance added

- **PHC referral draft:** an assigned clinician may explicitly attach an **accepted** `referral_brief` review to a manually authored, encrypted PHC referral. The backend validates programme, facility, patient, encounter, assigned clinician, freshness and replay identity. This does not choose destinations, mark a referral sent/received, or generate a clinical reason.
- **Nigeria eRx draft:** a prescriber can explicitly attach an accepted `prescription_review` with its PHC encounter. The backend re-resolves their provider account and programme membership and verifies all encounter identifiers before writing an **unsigned** digital prescription. The clinician still supplies every medication and instruction. The standard signed-prescription, pharmacy routing, pharmacist receipt and fulfilment state machines remain the only authority for medicines.
- **PHC follow-up:** source-linked tasks require a clinician-accepted draft, chosen due date and role, scoped patient/referral and a stable idempotency key. The synthetic database suite exercises referral sent -> accepted -> completed and linked task creation.
- **Consumer US eRx and DRN:** remain separate. The US EHR stores an external-prescribing intent, not a Nigeria digital prescription. The DRN referral network stores different patient and organization records; automatic copying of sensitive PHC clinical details into it is **not authorized** without an encrypted, consent-scoped bridge and receiving-organization access review.

These are audit-linked, clinician-controlled interactions, **not** autonomous prescribing or referral dispatch. A linked source is documentation provenance, not evidence that its suggestions are clinically correct.

