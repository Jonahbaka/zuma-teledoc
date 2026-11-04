# Release guard review — 4 November 2026

This is local engineering evidence, not production acceptance or authorization to
merge, deploy, migrate a live database, change secrets, or activate providers.

## Reviewed sources

The published-equivalent baseline was `1936f999`. The later clinical work at
`3a7e778` and voice prototype work at `6563529` were compared before editing. Neither
later head changed the deployment workflow, artifact upload command, switch script,
Nigeria migration runner, Docker runtime layout, or social scheduler findings.
This isolated correction branch is based on `3a7e778`; it does not replace or
publish the separate voice work.

## Corrections

- **Nigeria migration drift:** Load the complete on-disk SQL manifest and check all
  known recorded digests before applying any pending SQL or adopting any legacy
  digest. A later checksum mismatch can no longer arrive after an earlier pending
  migration commits. Legacy checksum adoption now warns explicitly that historical
  execution has not been verified. Existing transactional application and session
  lock cleanup are retained. Historical migration SQL was not changed.
- **Container completeness:** Include `shared/` in the production runner. The
  Nigeria region and PHC route dependencies previously failed module resolution in
  the declared runtime layout. This also preserves the destination needed by the
  separate voice prototype's shared protocols when that work is integrated.
- **Current tunnel deployment probe:** Set an explicit check-only flag only for
  the temporary PM2 health process. It binds to loopback, permits only readiness
  endpoints, disables Socket.IO/OpenClaw attachment, and skips optional startup systems, discovery bootstrap, agent task
  polling and route-import LLM verification. The serving restart and frontend
  rollback explicitly clear the flag. Normal serving middleware is preserved.
  This is not a claim that all initialization is read-only: existing schema
  readiness/migration operations still run and require deployment authorization.
- **Exact-SHA workflow acceptance:** Before installing dependencies and again
  immediately before upload, the existing deployment workflow performs read-only
  checks of the latest CI and CareOps evidence for its complete SHA, main branch
  and repository. Missing, pending, failed, fork/PR, mismatched, malformed or
  incomplete evidence fails closed. Any eligible non-completed run blocks, even
  if its run ID/start time appears older. A failed update overlapping a later green
  run also blocks; the gate does not assume retry start timestamps are current. The check does not dispatch/rerun workflows or download
  artifacts. It uses read-only Actions permission and no privileged workflow-run
  trigger. A fresh main push may stop because its CI is still running; a later
  authorized deployment attempt is then required after both workflows pass.
- **Unavailable social publishing:** Remove placeholder publisher behavior that
  manufactured provider URLs and recorded success without a provider call. Startup
  and queue polling remain inert, preserving existing records and scheduled work.
  Direct publication attempts fail with `SOCIAL_PUBLISHING_UNAVAILABLE` (503).
  The independent social publish-now, schedule and retry HTTP paths also refuse
  before target/account reads or writes instead of manufacturing successful work.
  There is no environment switch that turns the placeholders into an integration.
  A real adapter, receipt validation, atomic claim/retry semantics, and activation
  approval are future prerequisites. Existing historical status rows are not
  rewritten by this correction.

## Verification

- Code commit: `12b043e7f82495e1712bc1ece9a7c8571cfe3d2e`.
- The new container-layout, migration fail-fast and legacy-adoption tests all
  failed against the prior implementation, then passed after correction.
- Final focused release/startup selection: 44 passed, zero failed or skipped.
- Full `test:deploy-gate` on Node 22.23.4: exit 0, with 1,264 passing Node tests,
  30 database-dependent skips, no failures, the existing regression/portal checks,
  and 27/27 workflow simulations. This is not a real PostgreSQL pass.
- Python recovery/release-gate safety tests: 12 passed with mocked API responses.
- Static migration verifier: 55 SQL files, zero blocking findings or warnings.
- Full lint: zero errors and 28 existing warnings. Changed-file lint, Bash syntax
  and whitespace checks also passed. The initial resource-constrained lint was
  superseded by this successful bounded run.
- Production build: exit 0 on code commit `12b043e`, Node 22.23.4, one worker
  and a 768 MiB heap (161.2 seconds). Temporary local worker/memory settings
  were restored byte-for-byte and are not part of the code change. The existing
  local MediaPipe model was reused; package/model downloads were disabled.
- No real PostgreSQL migration, Docker image build/runtime, live PM2 deployment,
  real social publication, real LLM call, production secret, or backup was used.
  Docker is not installed in this executor; the runtime-layout regression is not
  a substitute for a full image build and authenticated runtime smoke test.

## Reviewed follow-up corrections

Commit `212fa8b` closes the independent social route, realtime candidate bypass and
workflow chronology gaps. Independent review passed 37 focused Node tests and 16
Python tests. The full lint/build/gate figures above belong to `12b043e`, not this
later revision or a future integrated release.

## Interim rollback quarantine

The later quarantine blocks primary mutation routes, command builders, the switch
script and deployment workflows before unsafe release changes. Authenticated status
reads and current SSM diagnosis/restart-existing remain available. See the
[full-release rollback plan](RELEASE_ROLLBACK_PLAN.md) for the exact scope, tests,
implementation still required and evidence needed to lift the block. This is a
safety improvement, not deployment readiness or a completed rollback system.

Quarantine verification: 24 focused deployment/tunnel tests passed, including real
HTTP route stacks, real shell refusal and real Multer import checks. The combined
release/startup/migration/auxiliary selection passed 56 tests with no skips; Python
checks passed 16 tests. Changed-file lint, Bash syntax, YAML parsing and whitespace
checks passed. Final integrated full build/lint/gate remain separate acceptance.

## Remaining verified release issues

These findings describe this review branch; separately reviewed sibling corrections
must be reconciled against the final integrated SHA before final acceptance.

1. `server/routes/upload-build-binary.js` changes the live source checkout and
   dependencies, then runs migrations before validating the uploaded artifact.
   The switch/rollback paths retain frontend directories rather than a complete
   matching server/frontend/dependency/configuration release. A failed candidate
   therefore cannot prove application rollback compatibility. Use an isolated
   full release directory and an approved compatibility/rollback rehearsal.
2. The historical nginx blue/green branch is not the verified current tunnel
   deployment path and was not redesigned here. Its worker overlap and full-release
   rollback behavior remain unverified.
3. Sentry initialization uses `requestHandler`, `tracingHandler` and `errorHandler`,
   all absent in the installed `@sentry/node` 10.70.0. With a DSN set, startup throws
   before routes finish loading. A current API compatibility correction and
   privacy/PHI scrubbing tests are needed before activating telemetry.
4. Database TLS configuration disables certificate verification for Neon and the
   backup pool, and silently degrades some non-Neon configurations. This needs a
   fail-closed, provider-compatible trust policy and isolated TLS regression tests.
   No live credentials or network security settings were inspected or changed.
5. The optional Cloud Run path has no `.dockerignore`; its broad builder COPY can
   include local secrets, uploads and unrelated generated output. It also permits
   20 application instances despite the repository's explicit single-process
   Socket.IO/presence constraint. Do not treat the Docker copy fix as Cloud Run
   readiness or permission to deploy a different infrastructure profile.
6. The default CI workflow installs with audit disabled and has no dependency
   audit step, despite an older readiness document listing that as required.
   No current vulnerability assessment is established by the local test results.
7. The CronOps HTTP checker accepts all 2xx–4xx responses and disables certificate
   verification. A missing endpoint can appear healthy; this does not establish
   trusted production monitoring or alert delivery.

## Evidence and approval gates still required

- Passing full checks for the final integrated SHA, including real isolated
  PostgreSQL workflows, restore reconciliation and authenticated browser flows.
- A witnessed independent production backup/restore, matching historical key and
  attachment recovery, retention controls, and agreed RPO/RTO and recovery owner.
- Actual previous-release compatibility against new schema/data and rehearsal of
  complete application rollback. A database replica or an archive listing is not
  proof of recoverability.
- Approved production source/target, migration manifest, release owner, monitored
  rollout and production identity evidence. No Actions run, upload, merge or
  deployment was started by this review.
- Separate clinical/privacy/institutional approvals and verified provider contracts
  for patient voice, external AI, DHIS2, imaging, payments, messaging and delivery.
  Existing fail-closed gates must remain in force until those conditions are met.

The older blanket readiness statements in root-level documentation are not evidence
that these later identified conditions have been met.

GitHub API contract reference: [workflow-run read endpoints](https://docs.github.com/en/rest/actions/workflow-runs#list-workflow-runs-for-a-workflow).
