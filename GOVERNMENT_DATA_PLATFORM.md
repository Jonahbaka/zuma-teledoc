# Government Data Platform

Status: **Not Ready**. The current application contains aggregate public-health reports, DHIS2 readiness/dry-run paths, federated jurisdictions, scoped roles, workflow approvals, executive views and audit lineage. It does not yet contain the required existing-data import/quarantine/reconciliation subsystem or non-technical search workspace. The Nigeria health endpoint deliberately reports the complete government data platform as unavailable until those schema gates exist.

## Ownership and authority

The FCT Primary Health Care Board and other authorized institutions retain programme priorities, facility designation, indicator approval, reporting routes, data-quality oversight, access authorization and scale decisions. DoctaRx is an implementation and coordination system; it is not a national reporting authority and must complement approved NHMIS/HMIS/DHIS2 processes.

## Existing architecture

| Layer | Active implementation | Boundary |
|---|---|---|
| Operational care | appointments, encounters, SOAP, prescriptions, pharmacy and referrals | Patient-care roles and object authorization; never executive default access. |
| Aggregate programme reporting | `public_health_reports`, indicators and nullable values | Scoped government MFA/RBAC; missing values remain null. |
| Governance workflow | jurisdictions, jurisdiction roles, submissions, workflow logs | Facility/Area Council/FCT hierarchy with reviewer/approver/export gates. |
| Approved export | CSV/JSON and DHIS2 dry-run/sync services | Approval, mapping, authorization and live safety gates. |
| Audit/lineage | `ng_audit_lineage`, workflow logs | Fail-closed audit middleware for protected government actions on repaired routes. |
| Import staging | Not implemented | Required before receiving Board/facility files. |
| Approved analytics read model | Partial, computed from operational/aggregate tables | Must be separated and performance-tested before scale. |

## Required target state

Implement versioned data-source and mapping registries; checksum-idempotent import batches; raw immutable rows; normalized staging rows; understandable validation findings; duplicate links; quarantine; maker-checker review; atomic commit; revisions instead of overwrite; reconciliation reports; rollback/deactivation; and lineage from approved values to source row and actors. Add a scoped, audited PostgreSQL-backed search API and guided UI using allowlisted filters only.

No live institutional data may be accepted until the fictional migration simulation, security tests, backup/restore and authorized UAT pass.
