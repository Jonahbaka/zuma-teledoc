# Complete-release rollback: blocked until implemented and verified

Updated 4 November 2026. This is a source-level engineering plan and safety block,
not production readiness, deployment approval, or evidence of a restore.

## Why the current release flow is unsafe

The artifact handler resets the serving checkout and replaces dependencies, merges
runtime secrets/configuration, and applies core/NG migrations before validating its
new frontend. The source deployment builder does the same in a shared live directory.
The switch script retains `.next` slots but runs them with whichever backend and
`node_modules` are currently in that directory. Restoring a frontend slot therefore
cannot restore a coherent application release. The artifact trap also does not retain
a complete previous release before these mutations. A successful health check cannot
repair those facts.

There is a second compatibility boundary: older releases apply NG migrations at
startup and create schema from routes. Current startup verifies both migration
ledgers read-only before importing routes or workers; it never invokes a migration
runner. Social, realtime analytics and testing-link schema setup now belongs to
explicit migrations, including additive migration `046_explicit_route_schema`.
Migration `047_explicit_service_schema` likewise owns service-created memory,
event, goal and Nova profile tables and the missing test-account flag. Triage no
longer alters appointment metadata during a request.
Run `npm run migrate` and `npm run ng:migrate` as a separate, reviewed phase before
starting this revision; a missing, unverified or drifted ledger blocks readiness.
Disabling schedules and realtime handlers alone does not make every service read-only.
A previous application can also become incompatible
with committed schema/data changes. An automatic database restore is not an acceptable
rollback mechanism because it can discard subsequent clinical records and cannot undo
external payments, messages or deliveries.

## Interim enforcement in this revision

- POST requests to `/api/deploy`, `/api/force-rebuild`, `/api/upload-build`,
  `/api/upload-build-binary`, and `/api/upload-build-chunked` (including `/assemble`)
  return HTTP 503 with `DEPLOYMENT_ROLLBACK_UNVERIFIED`, before upload parsing,
  authentication network calls, environment writes, job creation or process changes.
  No upload directory is created by loading the chunked route.
- Both release-command builders throw the same named error. They cannot be used to
  sidestep the HTTP guard through an internal caller.
- The switch script and root deployment script exit 78 before loading environment
  data, changing files or contacting a process manager.
- The main deployment, legacy emergency-redeploy, fresh-EC2 and optional Cloud Build
  workflows run the blocker before credentials, dependency installs, builds, uploads
  or cloud actions. Existing CI acceptance checks remain in place behind this block.
- Authenticated `/api/deploy/status` and `/api/deploy/log` retain their read behavior.
  The current `recover-ec2.yml` diagnose-only/restart-existing flow is unchanged. It
  does not reset source, install dependencies, run migrations or deploy a new release.

There is deliberately no environment/request override. Removing the block requires
a reviewed implementation with evidence, not a boolean claiming rollback was verified.
The block applies only when this source is installed; it cannot retroactively protect
an older running checkout or scripts copied from older revisions. Separate Nestora/
Nursing auxiliary deployment is outside this primary-release block. The legacy
`/api/restart` endpoint is unchanged and is not equivalent to the scoped current SSM
recovery workflow. The block is not a sandbox against an operator or IDE with
arbitrary shell/write access. This review performed
no upload, live migration, traffic switch, secret change, AWS action or production test.

## Target design for the current single-process tunnel deployment

1. **Immutable bundle.** Build a full release outside the serving directory, pinned
   to the accepted complete source SHA and runtime/platform. Include matching server,
   NG/shared code, frontend build, public assets, lockfile and production dependencies.
   Record build ID, file digests, Node/OS/architecture identity, both migration manifests
   and configuration-version identifiers. Reject path traversal, escaping symlinks,
   missing files and digest/source mismatches before extraction or promotion. Do not
   bundle `.env`, patient uploads, database dumps, keys or the mutable live checkout.
2. **Separate state.** Use an approved immutable release-root layout with a stable
   serving target and explicit previous target. Identify separately managed uploads,
   logs, secrets and other writable state. Bind each release to an approved secret and
   configuration version without copying values into artifacts or logs. Retain the
   previous complete bundle and matching runtime/dependencies until the recovery
   owner approves expiry. Confirm disk capacity, ownership and same-filesystem atomic
   rename behavior on the actual host; do not infer them from the repository.
3. **Prepare without modifying the live release.** Stage and verify the bundle in a
   fresh directory. Never `git reset`, install dependencies, merge `.env`, copy public
   assets or clean files in the serving directory. Preparation failures must leave
   current/previous targets, current process, runtime configuration and state intact.
4. **Separate schema application from startup.** Move route-import DDL and startup
   migrations into an explicit authorized migration phase. Candidate mode must use
   a strictly read-only schema-manifest compatibility check and no optional workers,
   providers, Socket.IO or OpenClaw. Test both the old and new complete applications
   against a synthetic restored database at the proposed schema before approval.
   If either is incompatible, refuse automatic promotion/rollback and require an
   approved maintenance and data-recovery plan. Never generate automatic down SQL.
5. **Promote one writer.** Acquire a cross-process release lock and revalidate the
   expected current release immediately before switching. The tunnel target and
   single PM2 writer constraint remain unchanged. Use a tested same-filesystem atomic
   serving-target replacement, then start/restart the exact named process with the
   selected absolute release directory and configuration identity. Do not run two
   serving workers against shared state. Capture previous target in a durable,
   atomically written journal before the first mutation; do not rely on shell memory.
6. **Verify and recover.** Require authenticated release/commit/build identity plus
   bounded API/NG health before recording success. On failure, select the complete
   previous bundle/configuration, restart only the named application and independently
   verify its identity and health. Report rollback failure separately and retain both
   bundles/journal for the recovery owner. Never report success solely because a
   symlink changed or PM2 accepted a command. Reconcile workers/outbox effects before
   resuming external work. A failed or interrupted attempt must be recoverable using
   the journal without starting a second release concurrently.

## Implemented independent foundation

A local-only [immutable release foundation](IMMUTABLE_RELEASE_FOUNDATION.md) now
implements full-tree preparation/verification, durable journals, explicit process
quiescence and complete-release rollback orchestration exercised with synthetic
real-process fixtures. It does not supply a production adapter, execute migrations
or lift the quarantine. Its exact capabilities, unsupported activation paths and
remaining production prerequisites are documented separately.

## Required realistic acceptance tests

Before replacing the blocker, run local tests with real temporary files and actual
shell/process boundaries for staging failure, malformed or malicious archives, checksum
mismatch, disk/permission failures, concurrent deploys, stale current identity, failure
between journal and rename, process-start failure, wrong health identity, candidate
failure, rollback failure and process termination at each state transition. Assert the
old backend, frontend, dependencies and configuration remain a matching set throughout;
a `.next`-only assertion is insufficient.

Then run isolated PostgreSQL compatibility tests with the exact old/new bundles and
both migration manifests, restore reconciliation and encrypted-record/attachment checks.
Finally obtain an approved witnessed rehearsal on the intended deployment profile,
including tunnel/PM2 identity, persistent state, secret-version recovery, bounded
RPO/RTO, rollback-failure alerting and operator recovery. Existing stub-only tests cannot
stand in for these results.

The current regression suite proves the interim refusal, absence of request-side writes,
workflow guard ordering and preservation of authenticated status reads. It does not
complete or claim production acceptance of the target architecture above. Historical switch internals are tested
only with an explicit test-fixture guard stub; the actual entrypoint is tested separately
and always refuses. These tests cannot justify lifting the release block.

## Remaining operator decisions

Confirm the approved host, complete release/state/configuration layout, retained previous
bundle and runtime identity, source/target backup evidence, migration compatibility,
release/recovery owners, write pause, maintenance window and RPO/RTO. Full-release
packaging and promotion are code work still required; backup/restore and final live
acceptance additionally require authorized infrastructure access and human decisions.
See [backup and restore procedure](backup-restore-runbook.md) for data recovery boundaries.
