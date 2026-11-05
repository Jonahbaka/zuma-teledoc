# PM2 release activation

The legacy HTTP upload/deploy paths remain quarantined. The operator-only
`scripts/release/pm2-adapter.cjs` integrates complete prepared releases with the
existing durable promotion/rollback engine. It does not run migrations or restore
a database automatically.

Before activation, restore the encrypted production snapshot into a private
database, compare historical migration definitions, migrate the restore explicitly,
and exercise both applications against the upgraded schema. Retain evidence of
protected-field readback and full application readiness. Evidence is specific to
both bundle digests and the actual schema fingerprint. Recheck that fingerprint
before selection and rollback. A different schema requires another rehearsal.

Store configuration, secrets, attachments and application logs outside releases.
Private configuration and evidence files must be mode 0600 with no symlink or
hard-link aliases. Freeze configuration for the entire operation. Mount published
release directories read-only before starting them. A sealed server verifies its
entire bundle, Node runtime, selected directory, configuration identity and external
state layout before listening. Startup separately verifies migration history before
initializing routes, realtime and workers. The release identity endpoint requires a
private 256-bit credential and full application readiness; it does not trust git or
an environment-provided build ID. Sealed serving binds loopback for the existing
Cloudflare tunnel.

The adapter fences the named PM2 application, rejects additional managed writers,
removes restart entries before switching, checks the old PID and listening port,
and independently verifies process cwd, executable, backend, configuration and
HTTP identity. The release-store journal and exclusive lock remain authoritative.
An interrupted operation requires operator inspection and explicit fencing; never
delete a stale lock based only on a PID or elapsed time.

For the first conversion from the legacy checkout, retain the old checkout and
encrypted database/state/configuration backups. The legacy application cannot read
all newly protected clinical fields and is not a valid automatic fallback after
new writes. Bootstrap a rehearsed compatible baseline during a write pause, then
use the complete-release engine for the final promotion. Never restore an earlier
database over newer clinical writes as an automatic rollback.
