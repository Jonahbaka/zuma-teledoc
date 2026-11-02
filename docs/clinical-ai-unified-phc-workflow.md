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
