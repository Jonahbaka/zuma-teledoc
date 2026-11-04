# DoctaRx Competitive and Standards Landscape

Date: 2026-09-26 (all URLs retrieved on this date)
Purpose: inform engineering decisions for the Nigeria PHC rollout. This is workflow and
capability research. No competitor branding, text, or UI has been copied into DoctaRx; every
comparison below points at DoctaRx code and at a decision.

## 1. Standards we must interoperate with

| Source | URL | Observed | DoctaRx position | Decision |
|---|---|---|---|---|
| DHIS2 Platform developer docs (data values / dataValueSets) | https://docs.dhis2.org/en/develop/using-the-api/dhis-core-version-241/data.html | `POST /api/dataValues` and `dataValueSets` take `dataElement`, `orgUnit`, `period`, `value`, optional `comment`. **The period on the wire is a period identifier such as `202201`, not a display label.** Re-submitting an existing value updates it (201 Created); a validation failure returns **409 Conflict**. | `ng/services/public-health/dhis2ExportService.js` builds the payload and treats 409 as a reconciliation signal | **Action taken:** our export originally sent the human label ("September 2026") as the period. Corrected to emit the ISO identifier (`202609`) on the wire while keeping the label for reports, and the month range is now validated on both paths. Covered by tests. |
| DHIS2 aggregate data model | same as above | Aggregate values are counts per data element / org unit / period. Individual-level data is a separate tracker concept, not aggregate export. | Our export is aggregate-only by design | Keep the `assertNoPatientIdentifiers` guard on every payload build. |
| Open mHealth / FHIR-shaped Nigerian IGs | Nigeria FHIR Community implementation guides (build.fhir.org/ig/Nigeria-FHIR-Community) | Nigeria-specific FHIR profiles for national use cases. | `ng_observation` uses LOINC-style codes; `ng_clinical_records` keeps a `fhir_resources` table (migration 017) | Mapping readiness exists; a full FHIR export is not built. Do not claim FHIR conformance. |

## 2. Products and workflows studied

| Product / class | Source | Observed capability | Relevance to PHC | DoctaRx support | Decision |
|---|---|---|---|---|---|
| ReMeDi 2.0 (Neurosynaptic) | Nurse/paramedic user manual supplied with this assignment (57 pp.) | Nurse-led registration, image/fingerprint capture, slot-based scheduling, structured local consultation, connected vitals devices, pause/resume, prior-record image review, report handoff | Closest comparable to a nurse-assisted PHC workflow | See `docs/remedi-gap-matrix.md` | Adopted the workflow insight, not the design: first-class allergies/problem list, longitudinal timeline, immutable amendments, durable referral history. No fingerprint enrolment, no device drivers without hardware. |
| Generic PHC/EHR practice (OpenEMR / OpenMRS class) | Their public project documentation | Mature problem lists, allergy lists with reaction/severity, encounter sign-off, amendment/audit trails, print summaries | Establishes what a "clinical standard" EMR is expected to carry | Allergies and problem list were **missing** before this increment | Closed: `ng_patient_allergies`, `ng_problem_list_items`, sign-off, amendments, clinical summary, timeline. |
| Offline-first mobile health records | Product documentation for offline-capable record apps | Local write queue, conflict surfaces, explicit "saved on device / not yet synced" state | Directly matches the FCT power/connectivity findings | Offline store, sync operations, sync conflicts, draft recovery | Strengthened the visible side: `ConnectivityBanner` now states plainly what is saved locally and what has not reached the server. |

## 3. Patterns we deliberately did not copy

- **Camera-per-vital-point capture** (ReMeDi). It multiplies bandwidth on exactly the links the FCT
  assessment describes; image upload of existing records is supported instead.
- **Biometric enrolment** (ReMeDi fingerprint). Consent, device, and data-protection burden with no
  demonstrated need in the assessed facilities.
- **Hardware-bound device drivers** before a specific device and protocol can be validated at a named
  facility. No device reading is claimed anywhere in the product.
- **Automatic diagnosis/triage.** Out of scope; unsafe autonomously. The existing AI path is
  drafting-only with mandatory clinician review, and the new documentation assistant makes no clinical
  assertions at all.

## 4. How this fed the code

- A DHIS2 period bug was found by reading the official API contract and fixed before any credentialed
  work existed.
- The ReMeDi matrix drove three concrete schema additions and two API endpoints.
- The "saved on device" pattern became a first-class UI state rather than a hidden behaviour.

## 5. Limits of this research

Sources were the supplied manual, official platform documentation, and general product documentation.
Live sandbox behaviour of DHIS2, real-device integration, and in-country competitor deployments have
**not** been observed. Nothing here is evidence of competitor performance or of any clinical outcome.
