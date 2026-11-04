# Read-only release checks and runtime-state preparation

This is preparatory code, not a production promotion adapter. The primary-release
quarantine remains enabled with no environment bypass. A sealed release cannot
start the ordinary application yet. Nothing here runs a migration, promotes a
release, changes a production service, or establishes database rollback safety.

## Separate candidate process

`DOCTARX_DEPLOY_CHECK=true node server/index.js` now selects a dedicated Node HTTP
server before Express, Next, Sentry, route imports, schema setup, agents, uploads,
realtime handlers or background workers. It binds only to `127.0.0.1`. The process
must receive configuration explicitly; a sealed source does not load `.env`.
Ordinary unsealed serving retains its existing dotenv and initialization behavior.

The candidate verifies the complete immutable artifact using the externally
supplied `DOCTARX_RELEASE_DIGEST`, including the exact runtime identity. Verification
is bound to the executing source directory, not the caller's working directory.
It then compares both canonical migration ledgers with the packaged definitions:

- One explicit READ COMMITTED, READ ONLY transaction, checked with
  `SHOW transaction_read_only`.
- Shared transaction advisory locks using the canonical migration-runner keys,
  followed by one combined ledger SELECT snapshot.
- Local lock/statement timeouts capped at 2/5 seconds, preserving stricter limits.
- Exact names and SHA-256 checksums. Missing, duplicate, unknown, altered or NULL
  legacy checksums refuse success. There is no checksum adoption or repair.
- Failed connections are discarded. Checks succeed only after pool cleanup.

Migration definition imports no longer load dotenv, create a database pool or
read transport configuration. The mutation runner loads those only when it must
construct its own pool; its SQL and migration ordering are unchanged.

`DATABASE_URL` must identify PostgreSQL, user, host and database. The check pool
uses certificate/hostname-verified remote TLS and bounded connection/query timeouts.
The shared strict parser accepts `sslmode`, `application_name` and optional
`channel_binding=prefer|disable`; required channel binding, URL certificate paths
and other unsupported security options fail closed. Public custom CA material is
supported through the bounded `PGSSLROOTCERT` file reader. Only explicit test-mode
loopback `sslmode=disable` permits no TLS in this candidate checker. See
`DATABASE_TRANSPORT_SECURITY.md` for the supported transport and configuration
requirements; real database trust/identity still requires infrastructure testing.

HTTP meaning is intentionally narrow:

- `/health`: listener is alive, never serving readiness.
- `/api/release-check`, `/api/health`, `/api/ng/health`: 200 only after artifact and
  migration-history checks finish; status is `checks_passed`, not `healthy`.
- `/readyz`: always 503. `initialized`, `nextReady`, `servingReady`,
  `productionReady`, `applicationSchemaVerified` and `dataCompatibilityVerified`
  remain false.
- Other paths/methods: 503. No Socket.IO, PCM, OpenClaw or upgrade listeners.

These are one-time check results, not a live schema monitor. Ledger agreement is
not proof of actual table/column/index definitions, compatible data, clinical
workflows or a Next.js serving process. The old blue/green script's serving-health
expectations are deliberately not satisfied. That script remains quarantined.

## Storage and source-writing boundaries

`server/utils/runtimeStatePolicy.js` detects immutable mode from either
`DOCTARX_IMMUTABLE_RELEASE=true` or the presence of `release-manifest.json` in the
executing source. Setting the flag false cannot downgrade a sealed artifact.
Ordinary serving rejects this mode before its application imports with
`IMMUTABLE_SERVING_UNVERIFIED`.

For explicitly configured external storage, `DOCTARX_STATE_ROOT` must be an
existing absolute real directory, separate from the complete source/release store.
The recognizable `<store>/releases/<id>` layout is always checked; a conflicting
`DOCTARX_RELEASE_STORE_ROOT` is rejected. Root-directory overlap, non-directories
and symlink aliases in these opted-in paths are rejected before creating storage.

- Public upload root: `<state>/public/uploads`.
- Agent-chat upload root: `<state>/private/agent-chat`, created lazily with mode 0700.
- No explicit state root in ordinary legacy mode: preserve `<source>/uploads` and
  `<source>/server/uploads/agent-chat`, including existing legacy symlink storage.
- Candidate mode cannot create upload directories. Merely importing agentChat's
  real Multer configuration no longer creates a directory.

The configured root must be controlled by the service operator, not writable by
untrusted users. Path checks do not replace OS ownership, read-only source mounts,
process isolation or a race-resistant storage adapter. The helper is not a sandbox.
Switching roots does not migrate existing files or rewrite historical absolute
agent-chat paths. Do not activate it before a file inventory and compatibility plan.

Credential-document privacy is a separate patch. When combined, its authorized
reader and static-denial wrapper must use the same resolved public upload root;
never restore a plain static mount that bypasses that wrapper. This patch does not
change credential-document records or migrate their files. The creator route is
also maintained separately and its early deny middleware must be preserved.

The IDE service refuses filesystem mutation, subprocess/shell execution, all Git
helpers (including nominal reads), arbitrary SQL, subagent create/deactivation and
process termination in sealed/check mode. DevOps auto-fixes refuse before touching
files. Packaged dynamic skills remain readable, but source-directory creation and
watching are disabled in immutable mode. Legacy ordinary behavior is preserved.
These service-level guards are defense in depth, not an audit of every application
writer or permission to run untrusted code in the serving process.

## Remaining release blockers

1. Ordinary startup still contains legacy schema/seed work. Request-time modules
   also contain DDL. Historical ledgers do not cover the complete application:
   `server/index.js` agent setup and NG bootstrap, social import initialization,
   testingLinks, adminTestAccountService, triage, realtime analytics, Nova profile,
   memory/event/goal services need a reviewed append-only migration/catalog plan.
2. The canonical core list omits historical social and agent-chat SQL files;
   additional runtime-created relations have no complete tracked migration. Do
   not claim schema completeness or copy unknown production tables into a new
   migration without reconciling existing definitions and clinical data.
3. A real PostgreSQL verification/lock-concurrency test on an authorized disposable
   database, and read-only production schema reconciliation, remain outstanding.
   Unit tests here use synthetic ledgers, never real credentials or user data.
4. Full runtime writer inventory, Next cache behavior under read-only source,
   background-worker ownership/fencing, existing upload retention, stable external
   state permissions and rollback-compatible data still need verification.
5. The immutable foundation has only a local synthetic process adapter. Production
   service/proxy mappings, config identity, health probes, OS fencing, backup/restore
   evidence and an approved promotion/rollback drill remain unverified.

Do not remove the serving refusal or primary-release quarantine based on these
checks alone. See `IMMUTABLE_RELEASE_FOUNDATION.md` and `RELEASE_ROLLBACK_PLAN.md`.

## Local regression coverage

`server/tests/runtime-isolation.test.js` covers the read-only query sequence and
failure cleanup; missing/drifted/unknown/NULL histories; strict pool configuration;
actual loopback HTTP boundaries; artifact-before-DB and cleanup-before-success;
entrypoint import isolation; executing-root identity; side-effect-free migration
manifest imports; root/store/symlink rejection and legacy compatibility; real
Multer lazy storage; and IDE/DevOps/dynamic-skill boundaries. It is included in
`test:deploy-guard`. No real migration, upload, external post or deployment is run.
