# Migration and Rollback

## Migration set in this branch

- `ng/migrations/018_ng_public_health_missing_values.sql` drops the `NOT NULL` and default-zero constraints from `public_health_report_values.value`.
- The base migration 011 is aligned so new installations create the nullable column directly.

This is a backward-compatible schema expansion. It preserves historical zeros and allows future rows to distinguish unavailable source data (`NULL`) from a measured zero (`0`).

## Staging procedure

1. Take and verify a restorable backup of the disposable staging database.
2. Record pre-migration row counts and counts of null/zero report values.
3. Run `node ng/migrations/migrate.js` using a least-privilege migration role.
4. Verify migration 018 appears once in `ng_migrations`.
5. Generate a report with an intentionally unavailable fictional source and one measured-zero source.
6. Verify JSON returns null vs zero, CSV renders blank vs `0`, and DHIS2 preview omits/blocks the null indicator.
7. Reconcile row counts and audit entries.

## Rollback

Application rollback is preferred because making the column nullable is safe for the new code. Do not mechanically restore `NOT NULL DEFAULT 0`; that would rewrite unavailable values and violate reporting semantics. If an older application cannot handle nulls, first pause writes, deploy a compatibility fix or restore the pre-migration database backup under an approved incident plan.

## Evidence not yet available

No target PostgreSQL connection was provided in this run, so migration apply, reconciliation and restore remain blocked. SQL/unit/build validation is not a substitute for that proof.
