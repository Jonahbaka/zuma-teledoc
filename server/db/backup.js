/**
 * [DB:BACKUP] AWS RDS Backup Database Connection — READ-ONLY
 *
 * Manages a read-only connection to the AWS RDS backup replica.
 * This module NEVER performs write operations. It is intentionally
 * restricted at two levels:
 *   1. SQL keyword inspection before every query (blocks write statements)
 *   2. PostgreSQL session set to READ ONLY on every new pool connection
 *
 * If BACKUP_DATABASE_URL is not set, the module gracefully no-ops and
 * readBackup() throws a configuration error instead of crashing.
 */

require('dotenv').config();

const { Pool } = require('pg');

// ─── Configuration ────────────────────────────────────────────────────────────

const BACKUP_DATABASE_URL = process.env.BACKUP_DATABASE_URL;

/** True only when the env var is present and non-empty. */
const isEnabled = Boolean(BACKUP_DATABASE_URL);

// Regex that matches any SQL keyword that performs a write or schema change.
const WRITE_KEYWORD_RE = /\b(INSERT|UPDATE|DELETE|CREATE|DROP|TRUNCATE|ALTER)\b/i;

let backupPool = null;

if (isEnabled) {
  // Strip sslmode= from the connection string — pg handles SSL via config object.
  let connectionString = BACKUP_DATABASE_URL;
  let sslConfig = { rejectUnauthorized: false }; // default for backup replica

  if (connectionString.includes('sslmode=')) {
    connectionString = connectionString
      .replace(/[?&]sslmode=[^&]+/, (match) => (match.startsWith('?') ? '?' : ''))
      .replace(/\?$/, '');
    // sslConfig already set to { rejectUnauthorized: false } above
  }

  backupPool = new Pool({
    connectionString,
    ssl: sslConfig,
    max: 3,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000
  });

  // Level 2: enforce READ ONLY at the PostgreSQL session level on every
  // new connection so even raw client.query() calls cannot write.
  backupPool.on('connect', async (client) => {
    try {
      await client.query('SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY');
      console.log('[DB:BACKUP] New read-only client connected to AWS RDS backup');
    } catch (err) {
      console.error('[DB:BACKUP] Failed to set READ ONLY session:', err.message);
    }
  });

  backupPool.on('error', (err) => {
    console.error('[DB:BACKUP] Unexpected backup pool error:', err.message);
  });
} else {
  console.warn('[DB:BACKUP] BACKUP_DATABASE_URL is not set — backup database disabled');
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Execute a read-only query against the AWS RDS backup replica.
 *
 * Enforces read-only at TWO levels:
 *   1. Regex check — throws immediately if the SQL contains write keywords.
 *   2. PostgreSQL session — the connection itself is in READ ONLY mode.
 *
 * @param {string} text   - SQL query (SELECT statements only)
 * @param {Array}  params - Parameterised query values
 * @returns {Promise<import('pg').QueryResult>}
 */
const readBackup = async (text, params) => {
  if (!isEnabled) {
    throw new Error('Backup database not configured');
  }

  // Level 1: SQL keyword inspection — reject writes before they reach the DB.
  if (WRITE_KEYWORD_RE.test(text)) {
    throw new Error(
      '[DB:BACKUP] Write operation rejected: backup database is read-only. ' +
        'SQL contained a disallowed keyword (INSERT, UPDATE, DELETE, CREATE, DROP, TRUNCATE, or ALTER).'
    );
  }

  const start = Date.now();
  try {
    const result = await backupPool.query(text, params);
    const duration = Date.now() - start;

    if (duration > 500 || process.env.DB_VERBOSE === 'true') {
      console.log('[DB:BACKUP] Executed read query', {
        text: text.substring(0, 100),
        duration,
        rows: result.rowCount
      });
    }

    return result;
  } catch (error) {
    console.error('[DB:BACKUP] Read query error:', {
      text: text.substring(0, 100),
      error: error.message
    });
    throw error;
  }
};

/**
 * Health-check the backup database connection.
 *
 * @returns {Promise<{ healthy: boolean, mode: 'read-only', timestamp?: Date, error?: string }>}
 */
const backupHealthCheck = async () => {
  if (!isEnabled) {
    return {
      healthy: false,
      mode: 'read-only',
      error: 'Backup database not configured (BACKUP_DATABASE_URL not set)'
    };
  }

  try {
    const result = await backupPool.query('SELECT NOW() AS current_time');
    return {
      healthy: true,
      mode: 'read-only',
      timestamp: result.rows[0].current_time
    };
  } catch (error) {
    console.error('[DB:BACKUP] Health check failed:', error.message);
    return {
      healthy: false,
      mode: 'read-only',
      error: error.message
    };
  }
};

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  readBackup,
  healthCheck: backupHealthCheck,
  isEnabled
};
