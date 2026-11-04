# CronOps transport security

CronOps is a separate PM2 process in `ecosystem.config.js`, running its source
with `ts-node` in the full repository checkout. Its database and HTTP(S) probes
must not bypass the primary server's transport requirements.

## Database

`cronops/services/db.ts` uses `server/db/connectionConfig.js`. It passes the exact
configured DATABASE_URL, NODE_ENV and PGSSLROOTCERT without a raw pg
connectionString. The shared parser enforces authenticated TLS and the original
hostname/IP identity for production and remote connections. Invalid or weakened
transport options fail before constructing a pool. Pool size and timeout settings,
lazy initialization, shutdown and the existing DRY_RUN write gate are preserved.

CronOps no longer silently selects the repository's RDS CA bundle or disables
verification when a CA file is missing. With no PGSSLROOTCERT, the normal Node
trust store applies. An explicitly configured CA file must exist and pass the
shared bounded public-certificate validation. An operator must verify the correct
CA for the actual primary database; a bundle for a different provider is not a
compatibility fix. No real trust configuration or database connection was changed
or verified here. See `DATABASE_TRANSPORT_SECURITY.md` for strict option support.

Plaintext is limited to explicit development/test loopback configurations. CronOps
already defaults NODE_ENV to production; an unlabeled CronOps process therefore
cannot opt into local plaintext. Database health/pool errors are bounded rather
than echoing driver errors or credentials into routine reports.

## HTTP and HTTPS probes

Health and security probes use the pure `services/transport.ts` policy before
opening a request. HTTPS requires TLS 1.2 or newer, a trusted certificate and the
original target identity. Certificate errors are unsuccessful checks, never a
reason to retry without verification. A process with global TLS verification
disabled, invalid/credential-bearing target URL, unsupported protocol or unknown
NODE_ENV is refused. HTTP is allowed only for explicit development/test loopback
URLs. Production, unlabeled and remote HTTP probes fail closed.

HTTPS uses Node's normal trust configuration, not the database CA file. If an
internal HTTPS service uses a private CA, the operator must separately provision
and verify the intended trust configuration, for example an appropriate public
certificate bundle through NODE_EXTRA_CA_CERTS at process start. This patch does
not set environment variables, install trust, accept self-signed certificates,
change system security or contact any service. Real application URL, certificates
and provider reachability remain unverified.

## Evidence and scope

`server/tests/cronops-transport-security.test.js` transpiles the actual TypeScript
source with every non-pure dependency trapped. It verifies actual Pool options,
strict configuration failures, preserved pool limits/dry-run behavior, lazy reuse,
close, explicit trust config, target identity and the three actual probe request
paths. A real loopback-only HTTPS server with ephemeral synthetic certificates
proves untrusted TLS cannot reach its HTTP handler; the same test server accepts
a request with its explicitly supplied test CA and matching IP identity. Fixtures
are removed afterward, and neither process trust nor production config changes.
The shared canonical database suite separately tests actual pg/TLS handshakes.

These tests do not run CronOps tasks, its scheduler, npm audit, reporting, SQL,
notifications, Stripe, Google or other production dependencies. The separate follow-on in `CRONOPS_TOOLCHAIN.md` installs the declared package
toolchain from its lockfile and validates standalone type checking. The transport
transpilation fixtures alone are not a claim of complete package type safety.
Source execution in a complete release checkout is supported; a detached compiled
`cronops/dist` deployment is not.

The probes' existing HTTP 2xx–4xx reachability classification is not changed by
this TLS patch and is not a full application-readiness assertion. The existing
database `query` API is not technically enforced read-only despite its old comment,
and the scheduler can run operational tasks. That existing
behavior, runtime output paths, scheduler fencing, report privacy, backup policy,
actual infrastructure trust, complete schema coverage and production promotion /
rollback remain separate review requirements. Deployment quarantine and sealed
production-serving refusal are unchanged. This transport patch is not deployment
approval or a claim of complete production readiness.
