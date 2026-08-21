# Government Data Migration Plan

Status: plan ready for review; implementation and execution are **blocked/missing**.

1. Obtain written authority, purpose, scope, steward and secure transfer method.
2. Inventory and register each source without copying credentials or identifiable samples into Git.
3. Profile schema, volume, codes, periods, missingness, duplicates, revisions and quality using an isolated environment.
4. Approve source-to-target mapping, facility/programme normalization and indicator definition versions.
5. Back up the target and record source checksums/counts/totals.
6. Run a dry import. Preserve immutable raw references; quarantine invalid rows.
7. Produce validation, duplicate and exception reports in plain language.
8. Reconcile input rows, accepted/quarantined/duplicate counts and indicator totals.
9. Obtain maker-checker approval from authorized users in the same scope.
10. Commit approved data transactionally into versioned values/read models.
11. Run post-commit reconciliation and scoped dashboard/search checks.
12. Obtain sign-off; retain lineage and the rollback/deactivation handle.
13. For rollback, deactivate the batch’s approved versions and restore the prior active revision without deleting history.

## Required fictional simulation

Use multiple fictional facilities and periods with renamed columns, missing facility codes, duplicate rows, invalid dates, late reports, conflicting totals, numerator greater than denominator and revised submissions. Prove mapping, understandable quarantine, checksum idempotency, rejection isolation, approval, atomic commit, rollback, reconciliation and searchable lineage.

## Stop conditions

Stop on unknown ownership, unapproved patient-level content, checksum mismatch, unresolved facility/indicator mappings, reconciliation difference, missing backup, failed audit write or cross-scope access. Never silently drop or coerce invalid data.
