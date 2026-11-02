# DoctaRx AI release gate: end-to-end continuity audit

**Scope:** Review branch #18 depends on #17 (Groq synthetic-only provider), which depends on #16 (PHC safety foundation). No release to production while any required item is unverified.

| Stage | Current reviewed integration | Required release verification | Status |
| --- | --- | --- | --- |
| Patient registration/intake | PHC programme-scoped factual intake review; separate consumer intake | Patient consent, identity matching, duplicate handling, facility/market isolation, source reference audit | PHC draft wired; consumer flow pending |
| Triage | Factual clinician handover, independent abstaining patient triage | Emergency escalation independent of LLM, no invented routine urgency, patient-to-clinician assignment | Partial; clinician triage sign-off pending |
| Consultation | Clinician-owned, PHC-linked consultation brief | Video failure/reconnect, consent, assigned clinician, encounter ownership, no PHI leak | Draft wired; E2E pending |
| SOAP | Protected source-linked draft and explicit clinician review | Editing, stale source rejection, patient crossover, encrypted storage, one-time unsigned note import, signature separate | Integration tests present; final CI pending |
| EMR | Encounter-scoped documentation gap review | Longitudinal problem/allergy/medication history, amendments, exports and encounter versioning | **Not** full record reconciliation |
| Prescribing | Documentation-only checklist | Allergies, interactions, indication, contraindications, clinician identity/signature, pharmacy handoff and replay | Clinical Rx automation not connected |
| Referral | Documentation-only context brief; independent referral network | Consent, destination access, specialist match safety, explicit send, receipt, closure, status reconciliation | Operational automation not connected |
| Pharmacy | Existing order and dispense operations | Verify exact signed Rx, stock status, split fulfilment, substitution authorization, delivery audit and idempotency | Groq not authorized to order/dispense |
| Follow-up | Reviewable source-linked proposals and separate assigned tasks | Due date, assigned role, duplicate replay, status transitions, notification, overdue escalation | PHC integration present; browser E2E pending |

## Absolute blockers

1. All PR #16, #17, #18 checks pass on **the exact final commit**, including synthetic PostgreSQL, browser, privacy and auth tests.
2. Run an end-to-end fictional patient journey with records, clinician review, SOAP import, clinician-authored Rx, pharmacy fulfilment, referral acknowledgement and follow-up closure. Confirm no shared record is silently lost or duplicated.
3. Verify refusal/error behavior: empty output, provider timeout, rate limit, unlinked encounter, expired draft, stale evidence, mismatched patient, revoked membership, no clinician, missing vital signs, duplicate orders and failed notifications.
4. Real-patient information must not be sent to Groq free-tier API. Validate provider data-processing arrangement, retention, applicable privacy requirements and a separate rollout authorization.
5. Clinical reviewer signs off on any AI-related text used in patient care, especially intake/triage and medication/referral decisions.
6. Test a reversible deployment and migration/rollback plan with application owner approval; confirm secrets, kill switch, logs/alerts, audit trails and operational support.

**Release verdict:** NOT READY. This is a verification register, not proof the gates have passed. Each row must be confirmed by CI evidence or a human release approver before promoting code.
