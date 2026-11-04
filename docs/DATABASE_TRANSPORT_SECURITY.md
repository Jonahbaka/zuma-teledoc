# Database transport hardening

This patch hardens the canonical runtime connection pool, canonical core migration
pool, read-only release-history checker, and active backup pool. It does not deploy,
contact a real database, change host/network settings or change production secrets.
Primary-release quarantine and immutable-serving refusal remain in force.

## Defects corrected

Previously the main pool could use `rejectUnauthorized:false`, Neon IPv4 resolution
always disabled certificate verification, and the backup and migration pools had
similar insecure fallbacks. Raw connection strings could also replace an explicit
SSL object through node-postgres URL parsing.

All hardened entries now use `server/db/connectionConfig.js` and pass explicit
connection fields to pg, without `connectionString`. The configured server identity
is pinned with Node's standard `tls.checkServerIdentity`, independently of the dial
address. The verified mode uses certificate-chain validation, hostname/IP matching
and minimum TLS 1.2. There is no fallback to unverified TLS or plaintext after a
connection or certificate error.

The Neon helper recognizes only the parsed `neon.tech` domain/suffix. A username,
password, database name or forged suffix containing that text cannot select its
routing behavior. Its bounded IPv4 lookup changes only the dial address; SNI and
certificate identity remain bound to the original DNS hostname. The canonical
migration and backup pool use ordinary pg resolution with the same verified TLS.

This matches the installed pg driver's behavior: URL SSL fields can replace an SSL
object, and a preconnected IP socket needs an explicit certificate identity. See
[node-postgres SSL documentation](https://node-postgres.com/features/ssl) and
[Node TLS identity verification](https://nodejs.org/api/tls.html#tlscheckserveridentityhostname-cert).

## Supported configuration

- Production requires `DATABASE_URL` identifying PostgreSQL host, user, database
  and password. The backup uses `BACKUP_DATABASE_URL` and also requires TLS.
- Remote connections use verified TLS even when NODE_ENV is unset, development or
  test, and even when no sslmode was supplied.
- `sslmode=require`, `verify-ca` and `verify-full` all use full certificate and
  hostname verification here. They never select a weaker compatibility behavior.
- `disable`, `prefer`, `allow`, `no-verify`, ambiguous/duplicate query fields and
  conflicting URL/environment sslmodes are rejected for protected connections.
- Explicit NODE_ENV=development/test may use loopback or an explicit local Unix
  socket without TLS. Production and unlabeled loopback still require TLS. Candidate checks
  keep the stricter exception: only test mode plus explicit loopback
  `sslmode=disable`. This does not enable immutable serving.
- Known NODE_ENV values are unset/empty, development, test and production. Unknown
  values fail closed rather than accidentally selecting a development policy.
- URL options are limited to `sslmode`, `application_name`, and
  `channel_binding=prefer|disable`. The installed pg supports preferring SCRAM-PLUS
  when offered, but does not enforce required channel binding. A configuration
  requiring it is rejected, not silently weakened. Such a deployment needs a
  reviewed driver/authentication implementation before use.
- URL `sslkey`, `sslcert`, `sslrootcert`, host/user/password overrides, libpq
  compatibility switches and arbitrary options are rejected. Active native-driver
  mode, PGOPTIONS, PGREPLICATION, client-key/certificate/CRL/SSL-negotiation options
  are unsupported and fail closed. Mutual TLS is not implemented by this patch.
- `NODE_TLS_REJECT_UNAUTHORIZED=0` is rejected. No code changes that setting.
- An explicitly empty local URL password cannot inherit a different PGPASSWORD
  through pg's truthiness fallback. Local no-URL development retains the ordinary
  PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE configuration path.

## Public CA requirements

By default verified TLS uses Node's trusted root store. If the database uses a
private/provider CA, `PGSSLROOTCERT` must identify the intended public PEM bundle.
The backup can use `BACKUP_PGSSLROOTCERT` independently; otherwise it uses
PGSSLROOTCERT. No CA certificate is downloaded or selected automatically.

The configured file must be an ordinary, nonempty public-certificate file of at
most 1 MiB. Final symlinks, FIFOs, directories, oversized content, malformed
certificates, non-certificate material and private-key-bearing files are rejected.
The reader uses no-follow/nonblocking bounded reads and detects changes during
reading. Configuration errors return bounded codes, not DSNs, passwords or paths.
Trusted operator ownership is still required; this is not hostile-host fencing.

A supplied CA bundle is the trust source for that connection, not an automatic
addition to all system roots. Missing/invalid configured material is an error,
never a reason to turn certificate verification off. Certificate expiry and peer
identity are verified by the actual TLS handshake.

**Deployment requirement:** the current Dockerfile sets PGSSLROOTCERT to an RDS
bundle. That bundle must not be assumed to trust a Neon primary. Operators must
review the actual primary and backup destinations and their separate trust
configuration. For example, a public-CA primary and private-CA backup need correctly
scoped trust sources. No existing environment, CA file, credential or provider trust
chain was inspected or changed in this work. Do not remove a required security
option just to make a blocked configuration connect.

## Evidence and remaining boundaries

The focused tests instantiate the actual pg Client and exercise local synthetic
PostgreSQL SSL negotiation. Temporary test-only certificates and keys are generated
and deleted. Matching DNS/IP and Neon-style IP dialing succeed; trusted wrong-host
certificates, untrusted roots and a server refusing TLS fail before encrypted
PostgreSQL startup. No external hostname is resolved and no SQL, real provider or
real credentials are used. Tests also cover malicious/ambiguous URLs, ambient
configuration, CA file hazards, DNS failures and the actual pool entrypoint code.
They require Linux-compatible filesystem semantics, OpenSSL, mkfifo and permitted
loopback test listeners. Missing capabilities must be reported, not counted as a
passing handshake test.

`server/tests/database-transport-security.test.js` is registered in
`test:deploy-guard`. Synthetic success is not proof of production reachability,
provider certificates, database grants, migration compatibility or backup/restore.
Those checks still require the authorized target environment and operator review.

The backup module's existing SQL/read-only enforcement is a separate boundary;
this patch does not certify its query policy or disaster-recovery readiness.
The separate follow-on in `LEGACY_DATABASE_TRANSPORT.md` converts the seven direct
pg pools in server/scripts, ng/scripts and scripts without executing their
workflows. That transport hardening does not authorize or validate administrative,
fixture or migration operations. The separate CronOps database and HTTPS probe
policy is documented in `CRONOPS_TRANSPORT_SECURITY.md`; it does not certify
scheduler tasks or live trust. Do not use unreviewed entrypoints as a
transport-policy workaround.
