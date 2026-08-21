# Government Data Platform

Status: **Implemented and release-gated**. The platform accepts authorized existing-data files into an isolated PostgreSQL workflow, preserves immutable source evidence, validates and quarantines records, requires maker-checker approval, commits approved observations atomically, supports reconciliation and rollback, and exposes only scoped approved records to search and executive aggregates.

## Ownership and authority

The FCT Primary Health Care Board and other authorized institutions retain programme priorities, facility designation, indicator approval, reporting routes, data-quality oversight, access authorization, and scale decisions. DoctaRx is an implementation and coordination system; it is not a national reporting authority and must complement approved NHMIS/HMIS/DHIS2 processes.

## Active architecture

| Layer | Implementation | Boundary |
|---|---|---|
| Operational care | Appointments, encounters, SOAP, prescriptions, pharmacy, and referrals | Patient-care roles and object authorization; never executive default access. |
| Source and mapping registry | Versioned sources, approved file types, field mappings, source metadata, and checksums | Government data-officer/steward permissions and scoped audit. |
| Import staging | Immutable raw rows, normalized staging, understandable validation findings, quarantine, duplicates, and checksum idempotency | No staged row becomes reportable before approval and commit. |
| Approval and commit | Maker-checker state machine, atomic approved-record/indicator commit, reconciliation report, rollback/deactivation, and lineage | Transactional authorization, actor separation, and jurisdiction/facility/programme scope. |
| Approved search | Allowlisted PostgreSQL filters, autocomplete, recent searches, saved views, and CSV/JSON export | Active MFA, assigned scope, audited access, and approved records only. |
| Executive aggregates | Approved observations, definitions, targets, quality status, freshness, sources, and missing-value semantics | Aggregate-only executive permission; no patient identifiers. |
| DHIS2 boundary | Readiness, mapping, preview/dry-run, approval, and guarded sync | Live sync remains disabled until authorized institutional configuration is complete. |
| Audit and lineage | Government audit events, workflow logs, source batch/row links, approval actors, and rollback history | Protected operations fail closed if audit/lineage cannot be persisted. |

Automated migration, PostgreSQL workflow, scope-isolation, backup/restore, reconciliation, and authenticated desktop/mobile browser gates must pass for every release. Institutional data may be introduced only through an approved environment and governance process; presentation/demo records must never be mixed with real users.
