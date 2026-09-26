# ReMeDi → DoctaRx Gap Matrix (workflow research, Nigeria PHC focus)

Date: 2026-09-26
Source studied: *ReMeDi 2.0 Software User Manual – Paramedic / Nurse*, Neurosynaptic Communications Pvt Ltd
(57 pages, nurse/paramedic workflow). Read as **workflow research only**. No ReMeDi text, screenshots,
branding, or assets were copied into DoctaRx, and none of their technology choices were adopted on
faith. Every DoctaRx status below was checked against the current code, not against a feature list.

Status vocabulary: **Implemented + validated** / **Implemented, unvalidated** / **Partial** /
**Missing** / **Not applicable (deliberately not built)**.

## 1. Matrix — registration, records, consultation

| # | ReMeDi capability (workflow) | DoctaRx status | DoctaRx evidence (file) | Gap / action |
|---|---|---|---|---|
| 1 | Nurse-assisted registration with demographics, contact, UID, address hierarchy | Implemented + validated | `phcWorkflowService.enrollPatient`, `ng_patient_identifiers` (migration 021) | None |
| 2 | Identity verification by fingerprint | Partial | `ng_patient_identifiers`, `ng_patient_identity_matches` with confidence + `pending_review` | DoctaRx uses identifier/photo/name matching. **Deliberate**: biometric enrolment at a low-resource PHC adds consent, device and data-protection burden with no demonstrated benefit in the FCT assessment. Documented, not built. |
| 3 | Patient photo capture at registration | Implemented + validated | `ng_patient_identifiers` photo capture | None |
| 4 | Patient search by ID or name; update demographics | Implemented + validated | `phcWorkflowService.searchPatients` | None |
| 5 | Appointment fixing against a doctor's slots | Implemented + validated | `ng_appointments`, `idx_ng_appointments_programme_queue` | None |
| 6 | Structured intake (present illness, past history, medications, allergies, examination, personal/family history) | Implemented + validated, strengthened this increment | `ng_clinical_encounters`, `ng_soap_notes`, plus new `ng/services/clinical/clinicalDocumentationAssistant.js` | ReMeDi's explicit field list drove the completeness rules. Gap closed. |
| 7 | Complaint entry with free text and duration | Implemented + validated | `reason_for_visit`, `chief_complaint` (encrypted at rest in the PHC path) | None |
| 8 | Edit/delete of complaints | Implemented with a safer model | Append-only note amendments; `ng_referral_events` | DoctaRx **supersedes** instead of deleting, so history is never silently lost. Intended difference. |
| 9 | Previous consultation reports filtered by date | Implemented + validated, this increment | New `GET /api/ng/clinical/patients/:id/timeline` (cursor paginated) and `.../summary` | Gap closed. |
| 10 | Uploading/viewing medical images and scanned reports | Implemented | `ng_clinical_documents` (current/superseded/entered-in-error) | Large-file behaviour on poor links still needs live validation. |
| 11 | Vitals and device measurements (pulse oximeter, spirometer, optical reader, haemoglobin) | Implemented, unvalidated | `ng_clinical_observations` (`method`, `device_id`, `unit`, `observed_at`); `ng_clinical_devices`, `ng_device_ingestion_events`, `deviceGatewayService` | **Highest-value open gap.** No physical device or validated protocol available, so no device reading is claimed. Manual entry with recorded provenance is supported and labelled. |
| 12 | Local vs remote consultation | Implemented + validated | `ng_phc_queue_entries`, `transitionQueueEntry` (claimed → in_consultation → completed) | None |
| 13 | Pause and resume a consultation | Implemented + validated | `transitionQueueEntry` allows `on_hold` and resume | None |
| 14 | Remote specialist search and referral | Implemented + validated | `ng_referral_network` (migration 013), `ng/routes/referralNetwork.js` | None |
| 15 | Referral outcome / report handoff to the facility | Implemented + validated, this increment | `ng_referral_events` append-only; legacy `ng_referrals` transitions now validated + `ng_referral_status_events` | Covered, and the transition history is now durable rather than overwritten. |
| 16 | Doctor-controlled prescribing | Implemented + validated | `ng_digital_prescriptions`, `prescriptionWorkflowService`, write restricted to clinical roles | None. This increment added an allergy safety net (`ng_prescription_allergy_alerts`). |
| 17 | Consultation completion gate | Implemented + validated | `transitionQueueEntry` requires a signed clinician note (`CLINICAL_SIGNOFF_REQUIRED`) | The manual describes no equivalent sign-off gate. |
| 18 | Recorded allergies with reaction and severity | **Missing before this increment** | New `ng_patient_allergies` (migration 024): criticality, verification, recorder, correction history | **Closed this increment.** Previously only a JSONB array. |
| 19 | Longitudinal problem list | Missing before this increment | New `ng_problem_list_items` with coded status, onset, attribution | **Closed this increment.** |
| 20 | Medication history / reconciliation | Implemented, unvalidated | `ng_medication_history` with status transitions; surfaced in the new clinical summary | A guided reconciliation step is still Partial. |
| 21 | Printable consultation report | Implemented, this increment | `GET .../summary` returns a printable, provenance-stamped summary | Print styling needs validation on a real PHC printer. |
| 22 | Consent capture before opening a record | Implemented + validated | `ng_patient_data_sharing_consents` (granted/declined/revoked/expired), enforced in `requireEnrollment` | None |
| 23 | Auditability of every clinical action | Implemented + validated | `ng_audit_lineage`, `recordProgrammeAudit`, break-glass logging in `clinicalAccessService` | None |
| 24 | Offline / low-connectivity operation | Implemented + validated in code; live validation required | `ng_phc_client_devices`, `ng_phc_sync_operations`, `ng_phc_sync_conflicts`, `lib/phc/offlineStore.js`, `offlineSyncService` | Draft recovery and conflict handling are unit-tested; real PHC network validation outstanding. |
| 25 | Aggregate programme reporting | Implemented + validated | `programmeReportingService`, `ng_indicator_source_definitions` | None |
| 26 | National reporting (DHIS2/NHMIS) | Architecture implemented; live sync fail-closed | New `ng/services/public-health/dhis2ExportService.js` (mapping, payload, PHI guard, idempotency, retry, dead-letter, reconciliation) | Live sync intentionally blocked pending FCT PHCB authorization, credentials, approved mappings, sandbox proof, sign-off. |
| 27 | Automatic diagnosis / decision support | **Not applicable — deliberately not built** | — | Unsafe autonomously. The existing AI path is drafting-only with mandatory clinician review. |
| 28 | USB/serial device drivers (optical reader, spirometer) | Not applicable (deferred) | `deviceGatewayService` records provenance but validates no hardware | Deferred until a specific device and protocol can be validated at a named facility. |

## 2. What this comparison changed in DoctaRx

1. **First-class allergies and problem list** (migration 024) — the two genuine record-model gaps the
   manual made obvious.
2. **Prescription allergy alerting** — the manual captures "other allergies or sensitivities" and
   "medical allergies" as free text; DoctaRx now has queryable, attributed records a prescribing check
   can use.
3. **Longitudinal timeline and printable clinical summary** — the manual's date-filtered past-reports
   list, done properly as a cursor-paginated continuity view.
4. **Immutable amendments and durable referral history** — the manual permits edit and delete of
   clinical entries; DoctaRx supersedes instead, and retains every referral transition.
5. **A documentation-completeness rule set** derived from the manual's own intake field list, used to
   prompt a clinician rather than to assert anything.

## 3. Deliberate non-adoptions

- Fingerprint identity capture: consent and data-protection burden with no demonstrated need here.
- USB/serial device drivers until hardware and protocol can be validated at a named facility.
- Camera capture per vital point: adds bandwidth cost on the links the FCT assessment describes;
  upload of existing images is supported instead.
- Any automatic diagnosis or treatment recommendation.

## 4. Still open

- A guided medication-reconciliation step in the PHC workspace.
- A print-optimised consultation summary layout.
- Image/document upload tuned and measured on a constrained link.
