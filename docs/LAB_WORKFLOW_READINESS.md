# Laboratory workflow implementation boundary

## Verified source scope

As of 4 November 2026, the implemented laboratory surface is an internal,
programme-scoped read of existing results. It is not an operational laboratory
ordering or result-management service.

- `ng/migrations/017_ng_clinical_records.sql` defines `ng_lab_results` with a
  plaintext result, optional encounter/provider/laboratory links, status, dates,
  interpretation, and a report URL. It does not define orders, specimen events,
  deduplication keys, revision history, critical-result assignments or receipts.
- `ng/services/interop/clinicalFhirService.js` reads results for the authorized
  encounter **and** patient. The existing programme, facility, active enrollment
  and consent checks apply before result access.
- `ng/routes/clinicalFhir.js` exports a read-only FHIR DiagnosticReport search.
  It requires an audit write before returning the result, sends `private,
  no-store`, preserves recorded status/interpretation and does not export report
  URLs. It does not place orders, ingest results or acknowledge critical values.
- Hospital integration and administrative feature controls keep laboratory
  integration unavailable even if old persisted flags say active or enabled.
- Simulation inserts are synthetic fixtures, not a supported clinical API.

The mapper understands optional `result_value_encrypted`, `result_value_iv`,
and `result_value_tag` fields. No registered migration or active result writer
currently provisions those fields. Encrypted mapper fixtures therefore do not
establish a persisted encrypted laboratory workflow. Existing plaintext data
needs a reviewed migration/retention plan before stronger protection claims.

## Defensive read correction

Any non-null/defined protection field now requires a complete, nonempty string
triple and successful decryption. Missing, empty or wrongly typed ciphertext
cannot revive a stale plaintext result when IV/tag or another protection field
remains. Failure returns a generic 503 OperationOutcome for the entire search,
including malformed rows outside the requested page. No successful-read audit
or partial clinical bundle is returned for that failed read.

All-null/absent triples keep the legacy plaintext behavior. This is not a
backfill, a new encryption-key policy, result ingestion, revision verification,
or critical-result handoff. Source interpretation is preserved verbatim; no
threshold, urgency, recipient, receipt or clinical action is inferred.

## Decisions and implementation required before clinical activation

These are acceptance prerequisites, not implemented functionality or approved
clinical policy.

1. **Authority and ownership:** identify clinical order authors, authorized
   result recorders/verifiers, specimen handlers and critical-result recipients
   for each programme/facility/market. Agree who owns unattended and after-hours
   results. Administrative access and a simulation role do not confer clinical
   writer authority.
2. **Orders:** define a reviewed test catalogue, patient/encounter matching,
   verified requester, partner identifiers and cancellation rules. Persist
   canonical request intent and retry identity before transmission. Distinguish
   saved local intent, partner acceptance and actual collection. Do not equate
   an HTTP response with fulfilment.
3. **Specimens:** agree permitted collection, identification, custody, rejection
   and recollection events with the operating laboratory. Store actor, source,
   timestamp and immutable linkage. Do not infer specimen quality or a safe
   collection window from timestamps alone.
4. **Result ingestion:** select the authorized manual or partner channel and
   verify its sender contract. Validate patient/order/specimen associations,
   source status, terminology/units and provenance. Reject ambiguous matches.
   Implement exact-retry deduplication, conflicting-payload handling, protected
   persisted values and atomic audit. An unavailable source is not a negative
   clinical finding.
5. **Corrections:** retain original report versions and attribution; link
   amendments and entered-in-error records without silently replacing the
   prior result. Define reconciliation when a report was already read or acted
   on. Do not silently relabel an amendment as a first final report.
6. **Critical-result handoff:** agree source criticality rules and human
   responsibility. Implement a durable notification queue, escalation/recovery,
   current authorized-recipient checks, and separately attributable delivery,
   receipt, clinical acknowledgment and documented action. A stored critical
   flag or notification dispatch is not acknowledgment. Clinical acceptance is
   required for thresholds, timing and escalation.
7. **Release:** verify synthetic end-to-end order/specimen/result/correction
   journeys against an isolated migrated database and real API/browser paths.
   Exercise concurrency, duplicate/conflicting deliveries, revoked consent or
   authority, wrong patient/facility/market, audit failures, interrupted clients,
   notification outages and unresolved results. Review operational ownership,
   partner acceptance, monitoring, migration/rollback and deployment identity
   before enabling any control. No existing feature flag is an activation gate
   that can substitute for this work.

## Evidence for this correction

- Reproduced the pre-fix HTTP defect: a result with null ciphertext and surviving
  IV/tag returned 200 instead of the expected 503.
- Focused command: `node --test ng/tests/phc-fhir-capability.test.js
  ng/tests/fhir-emr-r4.test.js ng/tests/lab-readiness-ui.test.js
  ng/tests/hospital-integration-read.test.js`.
- Result: 42 passed, 1 PostgreSQL test skipped, no failures. Tests execute the
  real mapper and Express route with synthetic query responses, check the
  pinned official R4 JSON schema, preserve all supported statuses and absent
  values, and cover read authorization, audit failure and unavailable UI states.
- Changed-file lint, full `npm run lint` (0 errors, 28 existing warnings) and
  `git diff --check` passed. An independent review found no blocking issue and
  reran all 14 focused capability tests successfully. Aggregate build/test
  evidence must be attached to the final integrated commit separately.
- No production database, real patient data, partner traffic, clinical write,
  migration, deployment or live operational acceptance was exercised. The
  PostgreSQL test was skipped because no authorized isolated database URL was
  configured. The repository-required `$promptpay-zuma-operator` skill was not
  available in this executor.
