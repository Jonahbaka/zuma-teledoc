/**
 * Dual-database routing layer
 *
 * PRIMARY  → Neon PostgreSQL   (process.env.DATABASE_URL)   — all reads AND writes
 * BACKUP   → AWS RDS           (process.env.BACKUP_DATABASE_URL) — read-only mirror, verification only
 *
 * Rules enforced here:
 *   • All write operations (INSERT/UPDATE/DELETE/DDL) go to Neon exclusively.
 *   • readBackup() is the ONLY path to the AWS mirror and is blocked from writes.
 *   • No fallback-write logic. If Neon is down, the request fails fast.
 */

const primary = require('./index');
const backup = require('./backup');

// ── Primary Neon helpers (re-exported for convenience) ──────────────────────
const query       = primary.query;
const transaction = primary.transaction;
const getClient   = primary.getClient;
const getPool     = primary.getPool;

// ── Read from AWS backup (verification / DR checks only) ────────────────────
const readBackup = backup.readBackup;

// ── Combined health report ───────────────────────────────────────────────────
async function healthCheck() {
  const [neonResult, awsResult] = await Promise.allSettled([
    primary.healthCheck(),
    backup.backupHealthCheck(),
  ]);

  return {
    primary: {
      engine: 'neon',
      ...(neonResult.status === 'fulfilled'
        ? neonResult.value
        : { healthy: false, error: neonResult.reason?.message }),
    },
    backup: {
      engine: 'aws-rds',
      ...(awsResult.status === 'fulfilled'
        ? awsResult.value
        : { available: false, error: awsResult.reason?.message }),
    },
  };
}

// ── Graceful shutdown ────────────────────────────────────────────────────────
async function close() {
  await Promise.allSettled([primary.close(), backup.closeBackup()]);
}

module.exports = {
  // Primary (Neon) — all writes, all reads
  query,
  transaction,
  getClient,
  getPool,

  // Backup (AWS) — reads only, for verification
  readBackup,

  // Diagnostics
  healthCheck,
  close,

  meta: {
    primaryEngine: 'neon',
    backupEngine: 'aws-rds',
    backupWritesAllowed: false,
  },
};
