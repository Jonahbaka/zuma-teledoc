# Backup, Restore, and Migration Runbook (Nigeria PHC)

Date: 2026-09-26
Scope: the existing EC2 deployment (`.github/workflows/deploy.yml` against the running instance).
Purpose: make recovery a rehearsable procedure rather than an improvisation during an incident.

## 1. Pre-deploy gate (run before every release)

```bash
# 1. Migrations must be safe, not merely additive.
node scripts/verify-migration-safety.cjs

# 2. Full test suite.
npm test

# 3. Production build.
npm run build
```

`verify-migration-safety.cjs` fails the gate on destructive DDL, `TRUNCATE`, `DELETE` without `WHERE`,
type changes without `USING`, `NOT VALID` constraints, non-idempotent `CREATE`, and `NOT NULL` columns
added without a default. Current state: **35 migration files, 0 blocking, 0 warnings, 45 guarded
patterns accepted** (idempotency expressed as a `DO $$ ... EXCEPTION WHEN duplicate_column` handler).

## 2. Backup procedure

```bash
# Timestamp the dump so a restore is unambiguous.
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
pg_dump "$DATABASE_URL" \
  --format=custom --compress=9 \
  --file="/var/backups/doctarx-${STAMP}.dump"

# Verify the dump is readable, not merely present.
pg_restore --list "/var/backups/doctarx-${STAMP}.dump" | head -n 20
ls -l "/var/backups/doctarx-${STAMP}.dump"
```

Rules:

- Keep at least **7 daily** and **4 weekly** dumps.
- A dump that has not been listed with `pg_restore --list` is not a backup.
- The dump contains patient data. It stays on the instance, is not emailed, and is not committed.

## 3. Restore procedure (rehearse this, do not improvise it)

```bash
# 1. Stop writes. Do not skip this: a live application will write during the restore.
# 2. Restore into a scratch database first and confirm the data.
createdb doctarx_restore_test
pg_restore -d doctarx_restore_test --no-owner /var/backups/doctarx-<STAMP>.dump

# 3. Verify before promoting.
psql -d doctarx_restore_test -c "\dt"                  # tables present
psql -d doctarx_restore_test -c "SELECT count(*) FROM users;"
psql -d doctarx_restore_test -c "SELECT count(*) FROM ng_clinical_encounters;"

# 4. Only then restore over the live database.
psql -d postgres -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity
                     WHERE datname = current_database() AND pid <> pg_backend_pid();"
pg_restore -d doctarx --clean --no-owner /var/backups/doctarx-<STAMP>.dump
```

Post-restore verification checklist:

- [ ] `GET /api/health` reports healthy **and** the restored commit matches the intended release.
- [ ] A known patient record opens and its signed note digest still verifies.
- [ ] A read-only clinician can sign in; a write attempt on a foreign patient is still denied.

## 4. Rollback

- **Code-only rollback**: redeploy the previous known-good commit. Migrations here are additive, so an
  older build tolerates newer columns; columns are never dropped in a release.
- **Data rollback**: restore from the dump taken immediately before the release. There is no
  automated down-migration, deliberately: down-migrations that drop clinical columns are how records
  get lost. A forward fix is preferred.
- **Decision rule**: if a migration is suspected, stop writes, restore, and investigate. Do not
  hand-write a down-migration under time pressure.

## 5. Rehearsal status

| Exercise | Status |
|---|---|
| Static migration safety gate over all 35 migrations | **Done, passing** (`scripts/verify-migration-safety.cjs`) |
| Applying migrations to a real Postgres instance | **Not rehearsed** - requires a database URL |
| `pg_dump` + `pg_restore` round trip | **Not rehearsed** - requires a database URL and disk on the instance |
| Restore into a live production database | **Not rehearsed** - production-only, needs a maintenance window |

The three unrehearsed items need `DATABASE_URL` and instance access. They are not blocked by code,
only by credentials and a maintenance window.

## 6. Observability gaps to close before PHC rollout

- `GET /api/health` currently reports `allHealthy: false` because `BACKUP_DATABASE_URL` is unset, so
  the health check cannot confirm that a backup destination exists. Set it, or the deploy gate should
  treat that signal as a hard failure rather than a warning.
- Deploy uploads through Cloudflare time out with `524` against this origin, and the instance reports
  heap usage around 97%. Add headroom, or route deploy uploads outside the proxy.
