# Immutable release foundation: local preparation and isolated rollback tests

Updated 4 November 2026. This implements independent portions of the
[full-release rollback design](RELEASE_ROLLBACK_PLAN.md). The existing primary-release
quarantine remains unchanged. **There is no production promotion adapter or CLI
activation path. This is not deployment readiness.**

## Implemented behavior

`manifest.cjs` verifies the exact local Git commit/tree and every tracked blob and
executable bit, then rejects extra source/assets outside the explicit `.next` and
`node_modules` build/dependency namespaces. An untracked `server/db.js` cannot shadow
an accepted `server/db/index.js`. Generated public assets not committed to the selected
source need a separately reviewed packaging rule; they are not silently trusted.

A complete bundle must contain the frontend build ID, backend, Nigeria/shared code,
application/components/lib/public source, package/lock files, both migration runners
and installed Next/Express dependencies. The manifest binds:

- Full source commit/tree/blob identities.
- Every regular file digest, size and mode, directory mode, and supported internal
  symlink target, including the entire frontend and dependency tree.
- Exact Node version, binary SHA-256, platform, architecture and modules ABI.
- Build ID and the core/NG migration-code inventory digest.
- A versioned, non-secret configuration descriptor identity.

The configuration digest is for an approved **non-secret descriptor** identifying
configuration and secret versions. Do not hash or place raw `.env`/secret values into
an artifact, terminal output or this metadata. Actual configuration materialization
and historical secret-version recovery remain a production adapter responsibility.

Sensitive path names are rejected at every depth; root mutable-state paths, external
or dangling symlinks, special files, hardlinks and unsafe paths are rejected. File
opens are nonblocking/no-follow with type/inode verification, so FIFO control files
cannot hang verification. The verifier is bounded by entry/file/total-size limits.
It is a path/content-integrity control, **not a general secret scanner**. A trusted,
private, non-concurrently-mutated build input and store are required. This code does
not defend against a malicious privileged local filesystem writer.

`prepareRelease` copies into a new attempt-owned staging directory, verifies the
copied tree again, fsyncs files/directories and publishes by atomic rename. A failed
copy is never advertised as a prepared release. Reuse requires matching verification
and another tree/manifest/publication-directory sync, including after an earlier
rename succeeded but its parent-directory fsync failed. Existing releases are never
overwritten with different content. There is no garbage collector or release deletion.

Content hashes and a self-consistent manifest are not trusted build provenance.
Preparation proves local tree consistency; an independently accepted manifest digest,
exact-head CI/build evidence and operator approval are still needed for release use.

## Available local CLI

The CLI has no production default paths. It does not load `.env`, install dependencies,
extract archives, contact a provider/database, run the application, migrate, call PM2,
restart or switch traffic.

```bash
# Prepare a complete, already built, private local bundle into an existing store.
# Configuration identity must reference an approved non-secret descriptor.
node scripts/immutable-release.cjs prepare \
  --store /approved/local/release-store \
  --bundle /approved/local/complete-bundle \
  --repository /approved/local/source-repository \
  --sha <complete-commit-sha> \
  --config-version <descriptor-version> \
  --config-digest <descriptor-sha256>

# Verify against an independently supplied expected manifest digest.
node scripts/immutable-release.cjs verify \
  --directory /approved/local/release-store/releases/<release-id> \
  --digest <accepted-manifest-sha256>

# Inspect or compute a read-only plan against an explicitly expected current target.
node scripts/immutable-release.cjs inspect --store /approved/local/release-store
node scripts/immutable-release.cjs plan \
  --store /approved/local/release-store \
  --current-id <current-release-id> --current-digest <accepted-current-digest> \
  --candidate-id <candidate-release-id> --candidate-digest <accepted-candidate-digest>
```

`prepare` reports `prepared-not-approved`, `verify` reports
`content-verified-not-approved`, and `plan` reports `dry-run-only` with production
promotion unavailable. No CLI `promote`, `rollback`, `recover` or `bootstrap` command
is supported. No environment/request flag can enable one. CLI errors print bounded
codes, not private path values, child output or configuration fingerprints.

## Implemented orchestration and its trust boundary

`store.cjs` includes an orchestration engine exercised only through the synthetic
fixture adapter. It does not contain a live process-manager adapter. Its caller must
supply independently reviewed, bounded methods for process inspection, configuration
verification, current schema/data compatibility, quiescence with pending-start fencing,
start and independent health/identity verification.

The engine binds one full deployment descriptor rather than independently switching
code/config pointers. It verifies the expected current release and reviewed plan under
an exclusive operation lock, validates both configurations and exact old/new migration/
release compatibility evidence, then:

1. Durably records intent before external mutations.
2. Quiesces every managed writer and pending start before replacing the serving target.
3. Revalidates compatibility/content/configuration and atomically selects the candidate.
4. Starts by absolute immutable release identity, then checks actual process and health
   identity before success. A symlink rename or accepted start command is not success.
5. On failure, re-quiesces, revalidates and selects the **complete** prior release/config,
   starts it and independently verifies identity/health. No down migration, database
   restore, external-event replay or data deletion occurs.

Unknown processes, changed evidence, missing previous content/configuration, failed
quiescence or failed rollback health produce `RECOVERY_REQUIRED`, not optimistic
success. Journal/file fsync uncertainty retains the operation lock independently of
whatever journal bytes happen to be visible. Completed attempt evidence is archived
before another attempt; incomplete or malformed journals are never overwritten by a
new promotion.

A killed coordinator leaves a hard lock. It is never cleared from PID absence, age or
an environment flag. `planInterruptedRecovery` is read-only, reconciles the actual
selected/process identity against the journal and verifies prior release evidence,
then explicitly requires exclusive fencing. It does not execute recovery or unlock
anything. A missing/terminal journal with a surviving lock still requires operator
investigation and cannot be treated as permission to deploy.

The actual production adapter must cover **all writers**, including CronOps and other
agents, not merely the application PID. Its `inspect`/`quiesce` contract must identify
and fence unknown or delayed starts; health/PID/timeouts alone cannot prove quiescence.
The fixture adapter is Linux-only and deliberately refuses real application source.
It is not a deployable PM2 implementation.
There is also a spawn-before-registry-write interruption window in the fixture:
its retained operation lock prevents another promotion, but it is not a production
orphan-process fence. The future adapter must independently discover/fence managed
processes even when the coordinator dies before recording a child.

## Test evidence and limits

Run `npm run test:immutable-release`; it is also included in `test:deploy-guard`.
The Linux fixtures use temporary Git repositories, real copied bundles, real loopback
child processes and a synthetic backend/frontend/dependency/configuration tuple.
They never run DoctaRx, real SQL, package installation or external-provider calls.

Coverage includes complete promotion and rollback on start/health failures, modified
previous content, configuration/compatibility failures, foreign processes, an actual
timed-out spawned candidate, source-shadowing and nested-secret rejection, FIFO/dangling
control files, corrupt journals, overlapping roots and failed-publication retry.
Coordinator SIGKILL tests cover before/after journal and serving-target rename boundaries,
plus process stop/spawn/start/health boundaries. A specific fault test leaves a visible
terminal journal after directory fsync failure, makes both recovery writes fail, and
requires the independent operation lock to remain.

Verified locally on Node 22.23.4: 55/55 foundation tests passed with no skips
(77.7 seconds), plus 56/56 existing release/startup/migration/auxiliary guard tests.
Changed-file lint, Node syntax and whitespace checks passed. Independent review
found and prompted fixes for source shadowing, nested secret paths, FIFO reads,
journal durability and partial-start fencing. The final test run includes those fixes.

These are process-interruption and injected-filesystem-failure tests, not a physical
power-loss test. They do not establish real PostgreSQL compatibility, runtime backup,
actual host ownership/filesystem durability, PM2/Cloudflare behavior or production
restore evidence. Non-Linux environments explicitly skip the Linux process fixture.

## Concrete blockers before production activation

- Split startup NG migrations and route-import DDL from read-only candidate readiness.
- Move uploads and every writable runtime path out of source directories under an
  approved state layout. Isolate agent-IDE/dynamic skill writes and retain proper
  ownership/read-only boundaries for release code.
- Define/fence every application and CronOps/other worker across interrupted operations.
- Implement immutable build/process identity independent of `APP_BUILD_ID` overrides
  or a mutable Git checkout. Independently verify actual process cwd/runtime/config.
- Retain and safely materialize versioned configuration/secrets. The foundation detects
  a different Node binary/ABI and refuses; it does not install or switch Node runtimes.
- Supply real isolated old/new-schema/data compatibility evidence, including records
  written after candidate startup, backups, historical keys and attachments.
- Implement and review a production process adapter and explicitly fenced interrupted
  recovery. Confirm target host, filesystem, capacity, state/configuration layout,
  release/recovery owners, RPO/RTO and a witnessed authorized rehearsal.

Only then can a separately reviewed change replace the existing release quarantine.
A passing foundation test or a prepared digest is not authority to lift that block.
