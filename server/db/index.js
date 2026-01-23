/**
 * PostgreSQL Database Connection Pool
 * Production-ready with SSL/TLS support for Aiven Cloud
 */

const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

// Database configuration
let connectionString = process.env.DATABASE_URL;

// Log database connection info (without password)
if (connectionString) {
  const sanitized = connectionString.replace(/\/\/[^:]+:[^@]+@/, '//***:***@');
  console.log('📊 DATABASE_URL configured:', sanitized);
} else {
  console.error('❌ DATABASE_URL is NOT SET! Will default to localhost:5432');
}

// Configure SSL for Aiven Cloud
let sslConfig = false;
if (process.env.DATABASE_URL && (process.env.DATABASE_URL.includes('aivencloud.com') || process.env.DATABASE_URL.includes('sslmode=require'))) {
  // For Aiven Cloud, use SSL but allow self-signed certificates
  // This matches the migration scripts configuration
  sslConfig = {
    rejectUnauthorized: false
  };
  // Remove sslmode=require from connection string as we handle SSL in config
  if (connectionString && connectionString.includes('sslmode=require')) {
    connectionString = connectionString.replace(/[?&]sslmode=require/, '');
  }
}

const dbConfig = {
  connectionString,
  ssl: sslConfig,
  max: parseInt(process.env.DB_POOL_MAX) || 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
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

    if (process.env.NODE_ENV !== 'production') {
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

