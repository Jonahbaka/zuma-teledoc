/**
 * PostgreSQL Database Connection Pool
 * Production-ready with SSL/TLS support for AWS RDS
 */

const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

// Database configuration
let connectionString = process.env.DATABASE_URL;

// Configure SSL
let sslConfig = false;
if (process.env.DATABASE_URL && process.env.DATABASE_URL.includes('sslmode=')) {
  const certPath = process.env.PGSSLROOTCERT
    ? path.resolve(process.cwd(), process.env.PGSSLROOTCERT)
    : null;

  if (process.env.DATABASE_URL.includes('sslmode=verify-full') && certPath && fs.existsSync(certPath)) {
    // AWS RDS: full certificate verification with the global bundle
    sslConfig = {
      rejectUnauthorized: true,
      ca: fs.readFileSync(certPath).toString()
    };
  } else {
    // Fallback: SSL required but no cert provided
    sslConfig = { rejectUnauthorized: false };
  }

  // Strip sslmode param — pg handles SSL via the config object above
  connectionString = connectionString.replace(/[?&]sslmode=[^&]+/, (match) =>
    match.startsWith('?') ? '?' : ''
  ).replace(/\?$/, '');
}

const dbConfig = {
  connectionString,
  ssl: sslConfig,
  max: parseInt(process.env.DB_POOL_MAX) || 10,
  // Keep connections stable on serverless-ish environments
  keepAlive: true,
  keepAliveInitialDelayMillis: parseInt(process.env.DB_KEEPALIVE_DELAY_MS, 10) || 10000,

  // Timeouts tuned for responsiveness (avoid long hangs).
  idleTimeoutMillis: parseInt(process.env.DB_POOL_IDLE_TIMEOUT_MS, 10) || 30000,
  connectionTimeoutMillis: parseInt(process.env.DB_POOL_CONN_TIMEOUT_MS, 10) || 8000,
  query_timeout: parseInt(process.env.DB_QUERY_TIMEOUT_MS, 10) || 8000,

  allowExitOnIdle: false
};

const pool = new Pool(dbConfig);

// Connection error handling - DO NOT exit, just log
pool.on('error', (err) => {
  console.error('Unexpected database pool error:', err);
  // DO NOT process.exit() - this kills Cloud Run containers before port binds
});

pool.on('connect', () => {
  console.log('New client connected to PostgreSQL');
});

/**
 * Execute a query with parameters
 * @param {string} text - SQL query
 * @param {Array} params - Query parameters
 * @returns {Promise<Object>} Query result
 */
const query = async (text, params) => {
  const start = Date.now();
  try {
    const result = await pool.query(text, params);
    const duration = Date.now() - start;

    // Only log slow queries (>500ms) or in verbose mode to reduce noise
    if (duration > 500 || process.env.DB_VERBOSE === 'true') {
      console.log('Executed query', { text: text.substring(0, 100), duration, rows: result.rowCount });
    }

    return result;
  } catch (error) {
    console.error('Database query error:', { text: text.substring(0, 100), error: error.message });
    throw error;
  }
};

/**
 * Get a client from the pool for transactions
 * @returns {Promise<Object>} Database client
 */
const getClient = async () => {
  const client = await pool.connect();
  const originalQuery = client.query.bind(client);
  const release = client.release.bind(client);

  // Track query timeout
  const timeout = setTimeout(() => {
    console.error('Client has been checked out for more than 30 seconds!');
  }, 30000);

  client.release = () => {
    clearTimeout(timeout);
    return release();
  };

  client.query = (...args) => {
    return originalQuery(...args);
  };

  return client;
};

/**
 * Execute a transaction with multiple queries
 * @param {Function} callback - Function that receives client and executes queries
 * @returns {Promise<*>} Transaction result
 */
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

/**
 * Check database connection health
 * @returns {Promise<boolean>} Connection status
 */
const healthCheck = async () => {
  try {
    const result = await query('SELECT NOW() as current_time');
    return { healthy: true, timestamp: result.rows[0].current_time };
  } catch (error) {
    return { healthy: false, error: error.message };
  }
};

/**
 * Close all connections in the pool
 */
const close = async () => {
  await pool.end();
  console.log('Database pool closed');
};

module.exports = {
  query,
  getClient,
  transaction,
  healthCheck,
  close,
  pool
};

