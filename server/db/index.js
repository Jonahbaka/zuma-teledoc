/**
 * PostgreSQL Database Connection Pool
 * Production-ready with SSL/TLS support for Neon (primary) and AWS RDS (backup).
 *
 * Neon endpoints advertise both A and AAAA records; many networks cannot route
 * IPv6, causing ETIMEDOUT on the default dual-stack lookup. We pre-resolve to
 * IPv4 and pass servername for TLS SNI before creating the Pool.
 * All other URL types follow the original synchronous path.
 */

require('dotenv').config();

const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
const { resolveNeonUrl } = require('./resolve-neon-url');

// ─── SSL config for non-Neon URLs ────────────────────────────────────────────
function buildSslConfig(rawUrl) {
  if (!rawUrl || !rawUrl.includes('sslmode=')) return false;

  const certPath = process.env.PGSSLROOTCERT
    ? path.resolve(process.cwd(), process.env.PGSSLROOTCERT)
    : null;

  if (rawUrl.includes('sslmode=verify-full') && certPath && fs.existsSync(certPath)) {
    return { rejectUnauthorized: true, ca: fs.readFileSync(certPath).toString() };
  }
  return { rejectUnauthorized: false };
}

// ─── Lazy pool (initialized on first use after Neon IPv4 resolution) ─────────
let _pool = null;
let _poolInit = null;

async function initPool() {
  const rawUrl = process.env.DATABASE_URL;
  const isNeon = rawUrl && rawUrl.includes('neon.tech');

  let connectionString, ssl;

  if (isNeon) {
    ({ connectionString, ssl } = await resolveNeonUrl(rawUrl));
  } else {
    ssl = buildSslConfig(rawUrl);
    connectionString = rawUrl
      ? rawUrl.replace(/[?&]sslmode=[^&]+/, (m) => (m.startsWith('?') ? '?' : '')).replace(/\?$/, '')
      : rawUrl;
  }

  const pool = new Pool({
    connectionString,
    ssl,
    max: isNeon ? 5 : (parseInt(process.env.DB_POOL_MAX) || 10),
    keepAlive: true,
    keepAliveInitialDelayMillis: parseInt(process.env.DB_KEEPALIVE_DELAY_MS, 10) || 10000,
    idleTimeoutMillis: parseInt(process.env.DB_POOL_IDLE_TIMEOUT_MS, 10) || 30000,
    connectionTimeoutMillis: isNeon ? 15000 : (parseInt(process.env.DB_POOL_CONN_TIMEOUT_MS, 10) || 8000),
    query_timeout: parseInt(process.env.DB_QUERY_TIMEOUT_MS, 10) || 8000,
    allowExitOnIdle: false,
  });

  pool.on('error', (err) => {
    console.error('Unexpected database pool error:', err);
    // DO NOT process.exit() — kills Cloud Run containers before port binds
  });

  pool.on('connect', () => {
    console.log('New client connected to PostgreSQL');
  });

  return pool;
}

function getPoolInstance() {
  if (_pool) return Promise.resolve(_pool);
  if (!_poolInit) {
    _poolInit = initPool().then((p) => {
      _pool = p;
      return p;
    });
  }
  return _poolInit;
}

// ─── Public API ──────────────────────────────────────────────────────────────

const query = async (text, params) => {
  const pool = await getPoolInstance();
  const start = Date.now();
  try {
    const result = await pool.query(text, params);
    const duration = Date.now() - start;
    if (duration > 500 || process.env.DB_VERBOSE === 'true') {
      console.log('Executed query', { text: text.substring(0, 100), duration, rows: result.rowCount });
    }
    return result;
  } catch (error) {
    console.error('Database query error:', { text: text.substring(0, 100), error: error.message });
    throw error;
  }
};

const getClient = async () => {
  const pool = await getPoolInstance();
  const client = await pool.connect();
  const originalQuery = client.query.bind(client);
  const release = client.release.bind(client);

  const timeout = setTimeout(() => {
    console.error('Client has been checked out for more than 30 seconds!');
  }, 30000);

  client.release = () => { clearTimeout(timeout); return release(); };
  client.query = (...args) => originalQuery(...args);
  return client;
};

const transaction = async (callback) => {
  const client = await getClient();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

const healthCheck = async () => {
  try {
    const result = await query('SELECT NOW() as current_time');
    return { healthy: true, timestamp: result.rows[0].current_time };
  } catch (error) {
    return { healthy: false, error: error.message };
  }
};

const close = async () => {
  if (_pool) {
    await _pool.end();
    _pool = null;
    _poolInit = null;
    console.log('Database pool closed');
  }
};

const getPool = async () => getPoolInstance();

module.exports = {
  query,
  getClient,
  getPool,
  transaction,
  healthCheck,
  close,
};
