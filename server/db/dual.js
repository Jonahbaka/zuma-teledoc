/**
 * DoctaRx Dual-Database Abstraction Layer
 * ════════════════════════════════════════════════════════════════════════════
 * ALL WRITES → Neon (primary, process.env.DATABASE_URL)
 * BACKUP     → AWS RDS read-only replica (process.env.BACKUP_DATABASE_URL)
 *
 * Rules that MUST NOT be violated:
 *  • query(), transaction(), and getClient() always target the primary Neon DB.
 *  • The backup connection is strictly read-only; no fallback writes are ever
 *    sent there. backupWritesAllowed is permanently false.
 *  • readBackup() is provided solely for disaster-recovery read checks and
 *    analytics that must run against the RDS replica rather than Neon.
 *  • There is NO automatic failover. If Neon is unavailable, write calls will
 *    throw — callers must handle that at the application layer.
 * ════════════════════════════════════════════════════════════════════════════
 */

const primary = require('./index');
const {
  readBackup,
  healthCheck: backupHealthCheck,
  isEnabled: backupEnabled
} = require('./backup');

// ─── Write operations — primary (Neon) only ───────────────────────────────────

/**
 * Execute a query against the primary Neon database.
 * For SELECT statements against the backup replica, use readBackup() instead.
 *
 * @param {string} text   - SQL query
 * @param {Array}  params - Parameterised query values
 * @returns {Promise<import('pg').QueryResult>}
 */
const query = (text, params) => primary.query(text, params);

/**
 * Execute a transaction on the primary Neon database.
 * Callback receives a pg client pre-wrapped in BEGIN/COMMIT/ROLLBACK.
 *
 * @param {function(import('pg').PoolClient): Promise<*>} callback
 * @returns {Promise<*>}
 */
const transaction = (callback) => primary.transaction(callback);

/**
 * Acquire a raw client from the primary Neon pool.
 * Caller is responsible for calling client.release() when done.
 *
 * @returns {Promise<import('pg').PoolClient>}
 */
const getClient = () => primary.getClient();

// ─── Health check — parallel primary + backup ─────────────────────────────────

/**
 * Run health checks against both databases in parallel.
 *
 * @returns {Promise<{
 *   primary: { healthy: boolean, timestamp?: Date, error?: string },
 *   backup:  { healthy: boolean, mode: 'read-only', timestamp?: Date, error?: string },
 *   allHealthy: boolean
 * }>}
 */
const healthCheck = async () => {
  const [primaryResult, backupResult] = await Promise.all([
    primary.healthCheck(),
    backupHealthCheck()
  ]);

  return {
    primary: primaryResult,
    backup: backupResult,
    allHealthy: primaryResult.healthy && backupResult.healthy
  };
};

// ─── Metadata ─────────────────────────────────────────────────────────────────

/**
 * Static metadata describing this abstraction layer's routing policy.
 * Useful for introspection endpoints and audit logging.
 */
const metadata = {
  writesTo: 'primary',          // All writes target the Neon primary
  backupWritesAllowed: false    // Immutable — backup is permanently read-only
};

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  // Write operations → primary (Neon)
  query,
  transaction,
  getClient,

  // Aggregate health check
  healthCheck,

  // Read-only backup access (disaster-recovery / analytics reads only)
  readBackup,
  backupEnabled,

  // Routing policy metadata
  metadata
};
