# Internal PHC referral metadata — FHIR R4 subset

`GET /api/ng/interop/fhir/ServiceRequest?encounter={uuid}&programmeId={uuid}&facilityId={uuid}`

This is a read-only internal clinical representation, **not an external export permission, partner transport, referral dispatch, or proof of live partner compatibility**. There is no individual ServiceRequest read or write endpoint. Existing JWT/session authentication, active account/programme/facility/membership checks, current enrollment consent, no-store response and successful read audit remain required. Only `remote_clinician` is permitted: the intersection of current referral-worklist roles and current FHIR roles. Other FHIR readers do not gain referral access; referral coordinators do not gain broader FHIR access.

The query is constrained by programme, facility, authorized encounter and encounter patient. Existing enrollment policy (active/paused/transferred with granted consent) is unchanged; external disclosure consent and `canExport` policy are not implemented or widened here.

## Minimal representation and clinical semantics

Only resource identity, status, intent, priority, patient/encounter/requester references and authored timestamp are returned. These are clinician-authored local referral orders (`intent: order`), not AI proposals. No clinical narrative, reason, response summary, recipient contacts, payment data, service terminology, or free-text destination is included. Bundle entry fullUrl uses the persistent local referral UUID as `urn:uuid:...` because no individual read endpoint is provided. Patient, encounter and requester are typed logical identifier references using local `urn:doctarx:patient-user`, `urn:doctarx:clinical-encounter` and `urn:doctarx:practitioner-user` namespaces. They are not partner-recognized identifiers or externally resolvable URLs; no host is inferred from untrusted request headers. Practitioner references do not imply a provided Practitioner endpoint.

| Local request state | R4 status |
|---|---|
| draft | draft |
| sent, accepted | active |
| completed | completed |
| cancelled | revoked |
| declined or unsupported | HTTP 503 OperationOutcome |

Receiver rejection does not prove withdrawal of the original order; it is not represented as completed, revoked or an invented unknown. Unsupported metadata fails the affected page instead of silently dropping records. A successful page describes only that page, not the representability of later pages. Local status reflects the recorded workflow, not independently verified partner activity. Priority maps routine/urgent/emergency to routine/urgent/stat. The due-at deadline is deliberately omitted: it is not a scheduled appointment occurrence.

## Pagination

Strict decimal `_count` 1..200 (default 50), `_offset` 0..1000000 (default 0). At most count+1 metadata rows are read; the lookahead supplies a scoped next link. `Bundle.total` is omitted rather than claiming a count from a partial result. Invalid parameters or a page requiring a next offset beyond the supported window return 400; no unusable next link is emitted. Pagination is not a snapshot across requests.

## References and verification

- [R4 ServiceRequest](https://hl7.org/fhir/R4/servicerequest.html)
- [Request status](https://hl7.org/fhir/R4/valueset-request-status.html)
- [Request intent](https://hl7.org/fhir/R4/valueset-request-intent.html)
- [Request priority](https://hl7.org/fhir/R4/valueset-request-priority.html)

Tests extend the existing capability/HTTP suite and isolated real-JWT/PostgreSQL suite, including scope exclusion, role/consent denial, audit failure, unsupported states, minimal fields and no referral mutation. This is not a claim of full FHIR conformance or a validated partner implementation guide.
