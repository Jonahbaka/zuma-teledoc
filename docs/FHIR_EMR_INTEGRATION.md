# DoctaRx HL7 FHIR R4 EMR and pharmacy integration

DoctaRx maps the canonical EMR, signed prescriptions and verified dispensing workflow to FHIR **4.0.1 (R4)** JSON. The operational database remains the authoritative clinical and financial store. Adding a FHIR representation never creates a diagnosis, signs a prescription, changes a price, asserts payment, dispenses medicines or books a courier.

## Clinical EMR interface

Base: `/api/ng/interop/fhir`. `GET metadata` describes the actual supported operations. The current account, clinical programme role, active programme/facility membership, patient enrollment and current consent are required. Supply `programmeId` and `facilityId`, or the corresponding existing scope headers.

| Resource | Supported read |
| --- | --- |
| Patient | `Patient/{patient-user-uuid}` |
| Encounter | `Encounter/{phc-encounter-uuid}` |
| Observation | `Observation?encounter={phc-encounter-uuid}` |
| AllergyIntolerance | `AllergyIntolerance?encounter={phc-encounter-uuid}` |
| Condition | `Condition?encounter={phc-encounter-uuid}` |
| DiagnosticReport | `DiagnosticReport?encounter={phc-encounter-uuid}` |

Searches return FHIR searchset Bundles with `_count` (maximum 200), local `_offset` and next links. Allergies and conditions are the enrolled patient's longitudinal lists, including properly marked entered-in-error records. Laboratory reports belong to the selected encounter and include their recorded result as a contained Observation. Missing data remains absent or explicitly unknown; an empty list is not a clinical assertion of no allergies or disease. Numeric laboratory results are not guessed from free text. Private report storage URLs are not exported.

## Medication exchange interface

Base: `/api/ng/medication-fhir`. `GET metadata` returns its CapabilityStatement. The ordinary DoctaRx bearer JWT/session authentication is required; this interface does not implement SMART launch or a partner OAuth server.

`GET Bundle/{order-uuid}` returns the order-scoped collection Bundle. `GET {resourceType}?order={order-uuid}` returns a searchset. `GET {resourceType}/{resource-uuid}?order={order-uuid}` reads a single resource belonging to that same authorized order. Supported resources are Patient, Practitioner, Organization, Medication, MedicationRequest, MedicationDispense and Provenance. Unrestricted patient/bulk searches and generic FHIR writes are rejected.

- Patients can read their own order. A managing pharmacist needs patient-authorized pharmacy data sharing. A prescription author can read the authored order. Administrators are checked against their current database role. Foreign patient/pharmacy identities cannot read another order even when they know resource IDs.
- A signed prescription produces one MedicationRequest per medicine, with stable item IDs, prescription grouping, exact quantities and recorded directions. A pharmacist-reviewed uploaded prescription is marked `reportedBoolean: true`; it does not claim a DoctaRx prescriber signature.
- A verified stock/prescription handover records one encrypted, append-only MedicationDispense snapshot per order product in the same transaction. An invoice, payment, pharmacy preparation or courier booking cannot create that clinical fact. Legacy histories without these snapshots are not backfilled with invented dispensing evidence.
- Dispense resources carry the actual medicine identity, quantity, pharmacist, authorizing MedicationRequest and preparation time. Patient handover time is included only after collection or proven delivery. Provenance links the dispensing pharmacist, pharmacy and source prescription. A dispense is not proof that the patient took the medicine.
- Each response is audited before being returned. FHIR exports are private/no-store. The patient, pharmacy and medication administration screens offer **Export FHIR medication record** after pharmacy confirmation.

Catalogue codes are explicitly DoctaRx local identifiers. Do not relabel them as SNOMED CT, RxNorm, GTIN, NAFDAC or external partner identifiers. Quantities use the existing reviewed dispensing units; external pack/unit conversion must be agreed and validated. No automatic medicine-name, strength, pack or unit equivalence is assumed.

## Connecting a pharmacy partner

FHIR reduces custom mapping work; it does not prove that an external partner accepts the same version, profiles, resources or authentication. Obtain the partner's official API/CapabilityStatement, sandbox credentials and commercial/data-sharing approvals before enabling a connection. Validate product/branch/patient identifier crosswalks, strength/form/pack/units, required profiles and value sets, reservation and cancellation rules, signed/replayed events, partial-fill policies and reconciliation.

Live external pharmacy connections remain disabled until those specifications, credentials, agreements and acceptance results exist. No external endpoint has been invented and no live patient record is sent by this release. Partner inbound writes must go through an authenticated adapter to the existing verified workflow; accepting an arbitrary `MedicationDispense` POST would bypass clinical and payment controls and is deliberately unsupported.

## Validation and limits

The pinned, unmodified official HL7 R4 JSON schema is compressed in the test fixtures and verified by SHA-256. Tests validate actual HTTP exports, capabilities, required structure, stable references, encryption, read authorization and append-only facts. Official JSON-schema validation is a base structure check; it is not terminology validation, a full FHIR invariant evaluation, certification, US Core conformance or a partner-specific implementation-guide acceptance.

No history, batch, transaction, bulk-data, subscription, generic write or SMART/OAuth capability is advertised by these subsets. These can be added against the chosen partner contract without replacing the canonical EMR or weakening its authorization, consent and audit controls.

References: [HL7 R4](https://hl7.org/fhir/R4/), [MedicationRequest](https://hl7.org/fhir/R4/medicationrequest.html), [MedicationDispense](https://hl7.org/fhir/R4/medicationdispense.html), [CapabilityStatement](https://hl7.org/fhir/R4/capabilitystatement.html).
