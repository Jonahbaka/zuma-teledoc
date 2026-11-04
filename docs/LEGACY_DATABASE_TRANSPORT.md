# Legacy command transport follow-on

This is a separate transport-only extension of `DATABASE_TRANSPORT_SECURITY.md`.
It reuses the reviewed strict parser and changes these direct pg constructors:

- `server/scripts/approve-provider.js`
- `server/scripts/setup-admin.js`
- `server/scripts/run-migration.js`
- `ng/scripts/simulationSafety.js`
- `ng/scripts/simulate-live.js`
- `ng/scripts/seed-demo-mode.js`
- `scripts/e2e-medication-delivery.cjs`

The provider/admin scripts no longer assign
`NODE_TLS_REJECT_UNAUTHORIZED='0'`. All listed constructors use explicit, validated
pg fields rather than a raw connectionString or unverified SSL object. An explicit
URL is required; an absent target cannot fall back to an ambient/default database.
Remote and production TLS retains full certificate/hostname verification. Existing
public-CA requirements, unsupported security options and fail-closed errors from
the shared parser apply unchanged.

Simulation target resolution still happens first. Its exact resolved URL is passed
to the transport parser; an ambient DATABASE_URL cannot replace the selected
SIMULATION_DATABASE_URL. Existing connection/query limits are preserved. Fixture
guards and same-target checks remain in their original positions and keep rejecting
production mode, unsafe targets or mismatched actual pools. No new force flag,
retry, alternate target, plaintext fallback or source of operational approval is
introduced.

For a permitted local plaintext fixture, NODE_ENV must already explicitly be test
or development when the pool is constructed. The patch does not relabel a
production or unlabeled process as test to obtain plaintext. Some older browser
scripts set test mode later; that later assignment is not transport authorization.
Do not add sslmode query options to a fixture URL when its independent fixture guard
requires an option-free loopback `_test` URL.

## Verification scope

Tests evaluate the actual Pool constructor expressions with synthetic environments
and mocked constructors, then inspect actual pg Client configuration without
connecting. They also load the simulation helper with mocked pg to verify target
selection, preserved limits and existing source/production-like guards. Existing
medication fixture-entrypoint tests retain their side-effect tripwires and now
recognize the shared transport dependency. The new test is registered in
`test:deploy-guard`.

No provider/admin setup, approval, SQL migration, live simulation, seeding or
browser operation was executed. Configuration tests are not workflow validation.
In particular, `seed-demo-mode.js` already imports a service before its main guard;
that service can initialize the canonical DB module and resolve DNS. This patch
preserves that ordering and does not claim whole-script imports are side-effect
free. Running any of these commands still requires the appropriate explicit
operational authorization, safe target and separately verified workflow.

The separate CronOps transport follow-on is documented in
`CRONOPS_TRANSPORT_SECURITY.md`. Backup query policy, actual infrastructure CA
trust, complete schema/writer isolation and production promotion/rollback remain
separate blockers. Deployment quarantine and immutable-serving refusal are
unchanged.
