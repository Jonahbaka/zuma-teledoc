# Government Data Dictionary

This dictionary documents active government-facing entities and required target entities. `Missing` entities are specifications only and must not be treated as deployed.

| Entity | Key fields | Classification | Lineage/retention note | Status |
|---|---|---|---|---|
| `ng_jurisdictions` | id, code, name, tier, parent_id, active | Master data | Version/change audit required | Active |
| `ng_user_jurisdiction_roles` | user, jurisdiction, role, facility, programme, action flags, class, expiry | Restricted authorization | Grant/revoke lineage; periodic review | Active |
| `public_health_facilities` | facility identity, code/location/ownership fields | Master/aggregate | Board-approved facility master required | Active/partial |
| `public_health_indicators` | internal key, name, programme, aggregation, DHIS2 mapping | Aggregate metadata | Definition fields/versioning incomplete | Active/partial |
| `public_health_reports` | period, type, facility, LGA, status, actors, approval | Aggregate | Approval history retained | Active |
| `public_health_report_values` | report, indicator, nullable value, metadata | Aggregate | `NULL` means unavailable; `0` means measured zero | Active; migration 018 pending apply |
| `ng_governance_submissions` | report, facility, jurisdiction, period, state, reviewer/approver/export actors | Aggregate workflow | State changes logged | Active |
| `ng_governance_workflow_logs` | submission, actor, from/to, action, timestamp | Restricted audit | Append-only intent | Active |
| `ng_audit_lineage` | actor, action, resource, jurisdiction, class, format, session/time | Restricted audit | Avoid sensitive payload duplication | Active/partial action coverage |
| `dhis2_integration_settings` | encrypted endpoint/credentials, dataset/org-unit, approvals, dry-run | Secret/restricted | Secrets encrypted and never exported | Active |
| `dhis2_sync_logs` | report, status, hashes/summaries, actor/time | Restricted audit | No credential or patient payload | Active |
| Data source registry | owner, source type, authority, contact, retention, status | Master/restricted | Required for every import | Missing |
| Import batch | checksum, source, file/system reference, mapping version, actors, state, reconciliation | Restricted staging | Immutable identity and idempotency | Missing |
| Import row/quarantine | source row ref, raw hash, normalized data, errors, duplicate link | Restricted staging | Raw data encrypted/minimum necessary; retention policy | Missing |
| Approved imported value/revision | indicator/facility/period/value, batch/row/mapping, revision/supersedes | Aggregate/possibly restricted | Never silently overwrite | Missing |
| Data-quality finding | rule, severity, owner, state, correction/review actors | Restricted workflow | Original finding retained | Missing |
| Saved government view/search | user, allowlisted filters, scope, timestamps | Restricted metadata | Search/view audit | Missing |

Operational patient tables are not part of the executive aggregate dictionary. Any authorized patient-level government use needs a separately approved data model and access purpose.
