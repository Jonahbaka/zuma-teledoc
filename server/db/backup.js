/**
 * AWS Backup Database — Read-only mirror
 *
 * Activated only when BACKUP_DATABASE_URL is set. Every query is checked for
 * write keywords before execution so that a misconfigured caller cannot mutate
 * the backup. Neon is the only source of truth; this module never falls back
 * to writes under any circumstances.
 */

require('dotenv').config();
const { Pool } = require('pg');

// SQL keywords that indicate a write/DDL intent.
const WRITE_PATTERN = /^\s*(INSERT|UPDATE|DELETE|CREATE|DROP|ALTER|TRUNCATE|REPLACE|MERGE|UPSERT|GRANT|REVOKE|LOCK\b|CALL|EXECUTE|DO\b)/i;

function guardWrite(sql) {
  if (WRITE_PATTERN.test(sql)) {
    const preview = sql.replace(/\s+/g, ' ').slice(0, 120);
    throw new Error(`[backup-db] Write operation blocked on read-only AWS mirror: ${preview}`);
  }
}

function buildPool() {
  const url = process.env.BACKUP_DATABASE_URL;
  if (!url) return null;

  let connectionString = url;
  let ssl = false;

  if (url.includes('sslmode=')) {
    const certPath = process.env.BACKUP_PGSSLROOTCERT
      ? require('path').resolve(process.cwd(), process.env.BACKUP_PGSSLROOTCERT)
      : null;
    const fs = require('fs');
    ssl =
      url.includes('sslmode=verify-full') && certPath && fs.existsSync(certPath)
        ? { rejectUnauthorized: true, ca: fs.readFileSync(certPath).toString() }
        : { rejectUnauthorized: false };

    connectionString = url
      .replace(/[?&]sslmode=[^&]+/, m => (m.startsWith('?') ? '?' : ''))
      .replace(/\?$/, '');
  }

  const pool = new Pool({
    connectionString,
    ssl,
    max: parseInt(process.env.BACKUP_DB_POOL_MAX) || 3,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
    // Enforce read-only at session level on every new connection.
    options: '-c default_transaction_read_only=on',
  });

  pool.on('error', err => console.error('[backup-db] Pool error:', err.message));
  return pool;
}

let _pool = null;

function getBackupPool() {
  if (!_pool) _pool = buildPool();
  return _pool;
}

async function readBackup(sql, params) {
  guardWrite(sql);
  const pool = getBackupPool();
  if (!pool) throw new Error('[backup-db] BACKUP_DATABASE_URL is not configured');
  return pool.query(sql, params);
}

async function backupHealthCheck() {
  const pool = getBackupPool();
  if (!pool) return { available: false, reason: 'BACKUP_DATABASE_URL not set' };
  try {
    const result = await pool.query(
      "SELECT NOW() AS ts, current_setting('transaction_read_only') AS read_only"
    );
    return {
      available: true,
      timestamp: result.rows[0].ts,
      sessionReadOnly: result.rows[0].read_only === 'on',
    };
  } catch (err) {
    return { available: false, error: err.message };
  }
}

async function closeBackup() {
  if (_pool) {
    await _pool.end();
    _pool = null;
  }
}

module.exports = {
  readBackup,
  backupHealthCheck,
  closeBackup,
  isConfigured: () => !!process.env.BACKUP_DATABASE_URL,
};
