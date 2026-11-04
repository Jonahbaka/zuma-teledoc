# Backup, restore, and migration release safety

Updated: 2026-11-03. Scope: the main DoctaRx and Nigeria schemas, encrypted clinical
records, background workers, and the deployed release. This is an operator procedure,
not evidence that any production backup or restore has succeeded. The
[scope ledger](DOCTARX_SCOPE_LEDGER.md) remains the acceptance contract.

## 1. Required release evidence

Before authorizing a production release, record:

- Approved source SHA, build identity, configuration version, current server and NG
  migration manifests, and the previous known-good artifact. Preserve the entire
  matching server/frontend release, not only `.next`.
- Passing CI for that exact SHA, including the isolated PostgreSQL recovery job.
  Run `npm run migrations:verify`, `npm run test:release-safety`,
  `npm run test:deploy-gate`, `npm run lint`, and `npm run build` as applicable.
- A named release owner, recovery owner, approved maintenance/write-pause procedure,
  and agreed recovery point and recovery time objectives (RPO/RTO).
- A verified pre-release backup reference, capture start/end times, digest, encrypted
  storage location, retention/expiry, encryption-key version and independent restore
  evidence. A successful dump or archive listing alone is **not** restore proof.
- A tested compatibility decision for running the previous release against the new
  schema/data. Additive columns do not prove application compatibility: null handling,
  changed constraints, encryption envelopes and external-event semantics matter.

Production deployment, live migrations, traffic switching, data restoration, key
changes, retention changes and infrastructure changes require their separate approval.
Do not infer authorization from a green local test or from this runbook.

## 2. Migration behavior and limits

`npm run migrate` and `npm run ng:migrate` use a checked-out PostgreSQL connection,
transactional migration-plus-manifest writes, and separate session advisory locks
for each manifest. Run core migrations before NG migrations. The main runner bounds
lock waits to at most 30 seconds and each transactional statement to at most 15 minutes,
preserving any stricter role/session timeout. A timeout
fails the release; review the operation rather than disabling the limit blindly.
An uncertain transaction/lock cleanup destroys that connection rather than returning
it to the pool.

The server runner checks every known recorded checksum before applying any pending
migration. An unexpected change stops the run. Correct the release or create a new
reviewed forward migration; never edit a recorded digest to force success.
Older manifests without checksums receive a first-run baseline and a named warning
before each adoption, even if a later migration fails. That
baseline cannot establish what historical SQL actually ran. Before rollout, compare
legacy schemas and the previous deployed migration source with the intended release.
Keep that comparison in the release evidence. Do not treat the warning as verification.

The static migration verifier is a limited SQL pattern check, not a parser, a full
schema-compatibility proof, or a backup check. It includes on-disk SQL files but does
not independently validate every inline core migration. Do not use its destructive
bypass flag as routine deployment practice. The default deploy gate runs the static verifier before release-safety
regression tests; production backup evidence is still an operator acceptance gate,
not a machine-verified precondition of every existing deployment path.

`npm run migrate:rollback` deliberately exits nonzero without opening a database
connection. The historical implementation dropped clinical and audit tables with
`CASCADE`; it is retired. No automated destructive down-migration is supported.

## 3. Capture a backup without overstating it

Use an already approved backup destination and database connection identity. A
libpq service profile can keep the password/URL out of command arguments and logs.
Do not echo the connection string or upload database dumps as general CI artifacts.
Production backups contain sensitive data even when some columns are encrypted.

Example for an authorized operator with an existing service profile and private,
encrypted backup volume (placeholders must be resolved and reviewed first):

```bash
set -euo pipefail
umask 077
: "${BACKUP_DIR:?Approved private encrypted backup directory required}"
: "${SOURCE_SERVICE:?Existing approved source database service required}"
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
DUMP="$BACKUP_DIR/doctarx-${STAMP}.dump"
PARTIAL="${DUMP}.partial"
# Do not overwrite an existing backup. Keep a failed partial for diagnosis under
# the approved retention policy; never label it as a valid completed backup.
test ! -e "$DUMP"
test ! -e "$PARTIAL"
PGSERVICE="$SOURCE_SERVICE" pg_dump --format=custom --compress=9 --file="$PARTIAL"
pg_restore --list "$PARTIAL" > "${PARTIAL}.contents"
test -s "$PARTIAL"
mv "$PARTIAL" "$DUMP"
mv "${PARTIAL}.contents" "${DUMP}.contents"
sha256sum "$DUMP" > "${DUMP}.sha256"
```

The dump is a consistent database snapshot, but separately sampled row counts during
live writes are not necessarily its counts. For exact reconciliation, use an approved
write pause or a coordinated exported-snapshot capture and record its boundaries.
Verify tool/server version compatibility before capture and restore.

A dump on the same instance does not protect against losing that instance. Confirm
an independently recoverable approved copy, encryption, restore access and retention.
Do not create or change remote storage/access policies without approval. Replication
or a responsive `BACKUP_DATABASE_URL` connection is not proof of point-in-time backup,
retention, independent storage, or a successful restore. An absent optional replica
must not be confused with absence or presence of a real backup plan.

A PostgreSQL database dump does not contain encryption keys, application secrets,
object-storage attachments, all cluster roles/permissions, external provider state,
or every worker queue. The recovery inventory must identify each dependency and its
approved recovery process without placing secret values in the evidence bundle.

## 4. Restore rehearsal in an isolated destination

Restore only into a newly provisioned, explicitly approved isolated target. Confirm
its host/database identity and absence of live traffic. Do not run against the source,
reuse an application database, or rely on a default database name. Provisioning roles,
creating a recovery database and granting access are separate approved operations.

With the destination already created empty, an operator can run:

```bash
set -euo pipefail
: "${DUMP:?Reviewed backup file required}"
: "${RESTORE_SERVICE:?Existing approved isolated destination service required}"
sha256sum --check "${DUMP}.sha256"
pg_restore --list "$DUMP" > "${DUMP}.restore-contents"
# Restore all-or-nothing into the empty target. Never add --clean or --create
# and never point this command at the live application database.
PGSERVICE="$RESTORE_SERVICE" pg_restore \
  --exit-on-error --single-transaction --no-owner --no-acl --dbname="service=$RESTORE_SERVICE" "$DUMP"
```

`--no-owner --no-acl` avoids replaying source ownership/grants into rehearsal. This
means production-like least-privilege roles/permissions must be provisioned and tested
separately; their validity is not established by this restore command. If an approved
production recovery requires different ownership, use its reviewed recovery plan.

Validate before promotion:

- Compare all core and NG migration identities/checksums and agreed table counts,
  primary keys, foreign-key relationships, clinical audit lineage and signed-note
  digests against snapshot-consistent evidence. Empty/count-only checks are insufficient.
- Start the exact intended application artifact against the isolated restored database.
  Verify the release identity, readiness, login/session behavior, actor/patient/market
  isolation, audit writes and representative encrypted clinical fields using synthetic
  or separately authorized records. Never record plaintext PHI in test output.
- Recover the **matching historical key version** through the approved secret mechanism;
  demonstrate decryptability of protected data, then verify missing/wrong/corrupt keys
  fail closed. A fresh key cannot decrypt an old backup. Keep keys separate from dumps.
- Keep outbound email/SMS, payment/settlement, courier, DHIS2, partner exchange and other
  workers disabled or isolated from real recipients. Verify restart/idempotency using
  synthetic events before any approved external reconciliation.
- Record capture and restore timings, restore logs, artifact SHA, fixture identities,
  result of each validation, and operator/reviewer sign-off. Measure actual RPO/RTO.

Do not copy live records into a weaker-access test environment. The production restore
rehearsal needs an approved destination, data-handling controls and retention policy.

## 5. Application rollback versus data recovery

Prefer an application rollback only after the previous complete artifact is tested
against the current schema and data. Preserve the current database and evidence. Pause
new writes/worker actions if the incident warrants it; use the reviewed maintenance
procedure rather than killing arbitrary database connections.

A data restore is a separate incident recovery, not an automatic response to a failed
migration. Committed transactions after the backup can be lost, including clinical
updates. A database restore cannot undo a real charge, courier booking, notification,
claim or DHIS2 submission. Keep a recovery copy of the current state and inventory all
post-snapshot events and third-party receipts before deciding how to reconcile them.
Never blindly replay an outbox or reset idempotency/receipt records.

Require an explicit restore decision stating the destination, backup/time boundary,
expected data-loss window, reconciliation plan, operator and approver. Restore and
verify in a separate target, then perform an independently approved traffic/connection
switch. Retain the old target under the approved retention policy. This runbook does
not prescribe an in-place `--clean` restore, dropping schemas, or terminating sessions.

After an approved switch, verify deployed identity, database identity, readiness,
representative care workflows, permission denials, audit continuity and worker/event
reconciliation. Do not resume outbound operations until their state is reconciled.

## 6. Evidence status and remaining gates

The repository's `government-postgres-recovery` CI job captures a synthetic database,
restores it to a separate disposable PostgreSQL database, compares government workflow
counts and reruns migrations/workflow tests. It now also defines real-database coverage
for legacy-manifest upgrade/adoption, transaction failure, checksum drift refusal,
advisory locking and real lock-timeout expiry;
the restore fails atomically on error. Read the result for the exact proposed SHA.
The existence of that workflow is not evidence that its latest run passed.

The focused local release-safety suite uses a stubbed client when no explicit
`SIMULATION_DATABASE_URL` is supplied. The database test skips in that case and cannot
substitute for real PostgreSQL or production recovery evidence. It accepts only a
non-production loopback `_test` database with no URL overrides and uses session-local
test tables. There is no production fallback.

Still required before production readiness is claimed:

- Approved production backup source/destination and witnessed independent restore.
- Historical-key recovery and protected-record validation, plus attachment recovery.
- Actual previous-release compatibility and rollback rehearsal with agreed RPO/RTO.
- Clinical/audit and post-snapshot external-event reconciliation.
- Exact-head CI, deployment approval, monitored rollout and production identity evidence.

No production database, backup, credentials, infrastructure, or deployed application
was accessed or changed when preparing these controls.

## 7. Account lifecycle is not record erasure

The generic `DELETE /api/admin/users/:id` endpoint now refuses permanent account
removal before any target lookup or account/clinical mutation. Its former physical user deletion
could cascade through clinical tables. Existing audit foreign keys and immutable
revision records can block some deletions, but are not a complete preservation
control for every clinical record set. The admin role-management page no longer
offers that destructive action. Requests reaching the refusal attempt metadata-only
failure auditing; an audit storage failure does not undo the refusal. Authentication
or role denials occur before that route-specific audit.

Existing account deactivation/status controls, patient self-deactivation, and the
reversible test-account lifecycle are unchanged. A refused deletion does not
silently deactivate an account. Deactivation retains records; it is not erasure.

Any future erasure workflow requires separately approved institutional retention,
legal-hold and data-handling decisions, a complete dependency/backup assessment,
and independent release review. This safeguard does not prescribe a retention
period, create an erasure entitlement, or authorize database changes. Do not
replace it with a partial table-count allowlist or a production feature bypass.

This source safeguard is not evidence that production data was deleted or that a
restore was performed. Validate it on the exact proposed release alongside the
existing release gates; no real deletion is required to verify the refusal.
