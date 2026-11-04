# Unmounted PostgreSQL voice session reader

The current-session authority checker now has a concrete, minimal SQL adapter: `createPostgresVoiceSessionReader`. It remains unmounted. Creating the reader does not open a connection or load the application's database module, dotenv configuration or credentials. The caller must explicitly supply a PostgreSQL Pool/Client-compatible `query(config)` implementation.

The reader selects only account ID, canonical role, active/approval/password-change state, credential version, and the requested refresh-token family's owner/expiry. It never selects passwords, token hashes, contact details or clinical records. Both identifiers are validated and supplied as bound UUID parameters; returned ownership is checked again. Additional result fields are not forwarded.

## Consistency and family semantics

One SELECT reads the principal and a lateral aggregate of the matching family's unrevoked, unexpired rows. This follows `authSessionService.assertCurrentSession`: any active row in the exact user/family is sufficient. Consumed predecessors do not invalidate an active rotation successor; revoking the entire family removes authority. A row from another user cannot revive it. The latest expiry among currently active rows supplies the family bound.

Under PostgreSQL's ordinary read-committed behavior, a single SELECT observes a consistent statement snapshot. It does not lock the user against later changes or promise instantaneous revocation. The voice broker's repeated checks, original-token deadline and background revocation remain necessary. Composition must use a fresh authoritative primary/read-committed source, not a stale replica or a long-lived repeatable-read transaction. The injected dependency is trusted infrastructure, not client input.

The observation timestamp is derived from PostgreSQL `statement_timestamp()`, not stamped when the result arrives. Future/stale timestamps, more than one second of local elapsed time, malformed or multiple rows, missing principal, mismatched owners, missing booleans and invalid integer representations fail closed. Database/server clock synchronization is an operational requirement; drift fails closed. No active family becomes an explicit inactive snapshot, never legacy token acceptance. Canonical role aliases match the authentication middleware without importing its credential-dependent module.

## Timeout boundaries

The query config requests a 750 ms node-postgres `query_timeout`. The installed pg 8.21.0 client source uses this to reject the query callback/remove queued work; it does not establish server-side cancellation of an already-running statement. The existing session-authority checker independently stops waiting after one second. A delayed result cannot become fresh authority.

This code does not modify a database setting, create a pool, provision a read-only account or cancel remote queries. Before activation, the approved composition must verify connection/acquisition limits, maximum pool size, read-only access, bounded server statement/lock timeouts, correct primary routing and lifecycle behavior. Do not pass the repository's string-only logging wrapper directly: this adapter requires a query-config-compatible Pool/Client interface. Do not log raw query errors or credentials.

## Test evidence

Fourteen focused tests execute the reader with a fictional query source, including strict shapes, role aliases, ownership, epoch/approval/role changes, stale observations, mutation during I/O and stalled-reader rejection. The eighteen-case actual JWT/loopback HTTP suite now uses this real SQL adapter with fictional query results, while keeping the real verifier, middleware, current-session policy, authority checker and broker. Background fake-provider termination is still exercised for revocation and original token expiry. Database/membership/evaluation-policy/provider I/O remain doubles. SQL has not been executed against a real PostgreSQL server locally.

A separate opt-in PostgreSQL test is prepared. It requires both `DOCTARX_VOICE_DB_TEST=true` and an explicitly authorized `SIMULATION_DATABASE_URL` targeting a loopback database ending `_test`, without URL options. Only then is pg loaded and a connection created. All rows live in connection-local temporary `users`/`refresh_tokens` tables inside a rollback-only transaction. The test covers SQL parsing/types, active successor, revoked/expired/cross-owner families and credential/role changes. It is skipped by default and has not run locally. It is not a full production-schema/RLS or concurrent-writer test, even when enabled.

No live provider, patient data, new credential, production auth acceptance change, application mount or publication is included. Actual DB/SDK/browser acceptance and durable provider cleanup remain separate gates.

## References

- Existing auth family rules: `server/services/authSessionService.js`, `server/db/migrations/041_atomic_auth_sessions.sql`.
- PostgreSQL statement snapshots: https://www.postgresql.org/docs/current/transaction-iso.html
- node-postgres client/query configuration: https://node-postgres.com/apis/client
- Installed timeout implementation checked in `node_modules/pg/lib/client.js` (pg 8.21.0). This dependency is not changed by the adapter.

## Independent account status

The snapshot includes users.account_status separately from is_active. Voice authority requires the exact value `active`; suspended, revoked, inactive, deleted, unknown, missing and legacy/null states cannot admit or renew a voice session. Null remains visible as null in the snapshot, rather than silently inheriting active status. This is deliberately stricter than legacy discovery paths that coalesce null. No user rows are backfilled and generic authentication acceptance is unchanged. A future activation must resolve any legitimate legacy account through its normal account-governance process.

The actual-JWT/HTTP test uses a fictional SQL result to suspend an account during an active fake-provider session and observes independent background termination. The opt-in PostgreSQL test also covers statuses when an authorized disposable target is supplied; it remains skipped locally. This is not evidence of actual production database or provider execution.
