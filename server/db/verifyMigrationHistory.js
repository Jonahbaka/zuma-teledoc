'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const hash = text => crypto.createHash('sha256').update(text, 'utf8').digest('hex');
const LOCKS = ['doctarx_server_migrations_v1', 'doctarx_ng_migrations_v1'];
function failure(code) { return Object.assign(new Error('Migration history verification failed.'), { code }); }
function loadExpectedHistory() {
  // Import definitions only. Neither runner is invoked, no pool is constructed.
  const core = require('./migrate').getMigrations().map(entry => ({ name: entry.name, checksum: hash(entry.up) }));
  const directory = path.resolve(__dirname, '../../ng/migrations');
  const ng = fs.readdirSync(directory).filter(name => name.endsWith('.sql')).sort().map(name => ({ name, checksum: hash(fs.readFileSync(path.join(directory, name), 'utf8')) }));
  return { core, ng };
}
function checkHistory(rows, expected, namespace) {
  if (!Array.isArray(rows) || !Array.isArray(expected) || !expected.length) throw failure('MIGRATION_MANIFEST_INVALID');
  const wanted = new Map();
  for (const entry of expected) {
    if (typeof entry?.name !== 'string' || !entry.name || !/^[a-f0-9]{64}$/.test(entry.checksum || '') || wanted.has(entry.name)) throw failure('MIGRATION_MANIFEST_INVALID');
    wanted.set(entry.name, entry.checksum);
  }
  const found = new Set();
  for (const row of rows) {
    const checksum = typeof row?.checksum === 'string' ? row.checksum.trim() : '';
    if (typeof row?.name !== 'string' || found.has(row.name)) throw failure('MIGRATION_HISTORY_INVALID');
    if (!wanted.has(row.name)) throw failure('MIGRATION_HISTORY_NEWER_OR_UNKNOWN');
    if (!/^[a-f0-9]{64}$/.test(checksum)) throw failure('MIGRATION_HISTORY_UNVERIFIED');
    if (checksum !== wanted.get(row.name)) throw failure('MIGRATION_HISTORY_DRIFT');
    found.add(row.name);
  }
  if (found.size !== wanted.size) throw failure('MIGRATION_HISTORY_PENDING');
  return { namespace, count: wanted.size, digest: hash(JSON.stringify([...wanted].sort(([a], [b]) => a.localeCompare(b)))) };
}
async function verifyMigrationHistory(pool, expected = loadExpectedHistory()) {
  if (!pool || typeof pool.connect !== 'function') throw failure('SCHEMA_CHECK_POOL_REQUIRED');
  let client, transaction = false, discard = false;
  try {
    client = await pool.connect();
    await client.query('BEGIN ISOLATION LEVEL READ COMMITTED READ ONLY');
    transaction = true;
    for (const [name, limit] of [['lock_timeout', 2000], ['statement_timeout', 5000]]) {
      await client.query('SELECT pg_catalog.set_config($1, LEAST(COALESCE(NULLIF(setting::bigint, 0), $2::bigint), $2::bigint)::text, true) FROM pg_catalog.pg_settings WHERE name = $1', [name, limit]);
    }
    const readOnly = await client.query('SHOW transaction_read_only');
    if (readOnly.rows?.[0]?.transaction_read_only !== 'on') throw failure('SCHEMA_CHECK_NOT_READ_ONLY');
    // Transaction-scoped shared locks coordinate with the canonical runners.
    // The ledger SELECT below uses one READ COMMITTED snapshot after both locks.
    for (const key of LOCKS) await client.query('SELECT pg_catalog.pg_advisory_xact_lock_shared(pg_catalog.hashtext($1))', [key]);
    const result = await client.query("SELECT 'core' AS namespace, name, checksum FROM public.migrations UNION ALL SELECT 'ng' AS namespace, filename AS name, checksum FROM public.ng_migrations");
    if (!Array.isArray(result.rows) || result.rows.some(row => !['core', 'ng'].includes(row.namespace))) throw failure('MIGRATION_HISTORY_INVALID');
    const core = checkHistory(result.rows.filter(row => row.namespace === 'core'), expected.core, 'core');
    const ng = checkHistory(result.rows.filter(row => row.namespace === 'ng'), expected.ng, 'ng');
    await client.query('COMMIT'); transaction = false;
    return { migrationHistoryVerified: true, core, ng, applicationSchemaVerified: false, dataCompatibilityVerified: false };
  } catch (error) {
    discard = true;
    if (transaction && client) { try { await client.query('ROLLBACK'); transaction = false; } catch { discard = true; } }
    // Native database errors may contain private details; expose only bounded codes.
    if (/^(MIGRATION_|SCHEMA_CHECK_)/.test(error?.code || '')) throw error;
    throw failure('SCHEMA_CHECK_UNAVAILABLE');
  } finally {
    if (client) client.release(discard || transaction);
  }
}
function createSchemaCheckPool(env = process.env) {
  const { buildDatabaseConfig } = require('./connectionConfig');
  let connection;
  try { connection = buildDatabaseConfig(env, { requireUrl: true, forceTls: env.NODE_ENV !== 'test', requireExplicitPlaintext: true }); }
  catch { throw failure('SCHEMA_CHECK_DATABASE_CONFIGURATION'); }
  const { Pool } = require('pg');
  return new Pool({ ...connection, application_name: 'doctarx-read-only-release-check', max: 1,
    connectionTimeoutMillis: 5000, idleTimeoutMillis: 1000, query_timeout: 10000 });
}
module.exports = { loadExpectedHistory, checkHistory, verifyMigrationHistory, createSchemaCheckPool, LOCKS };
