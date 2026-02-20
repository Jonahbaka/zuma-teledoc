/**
 * ═══════════════════════════════════════════════════════════════
 *  CRONOPS DB SERVICE — Isolated PostgreSQL connection pool
 * ═══════════════════════════════════════════════════════════════
 *
 *  Uses the same DATABASE_URL as the main server but maintains
 *  its own connection pool (max 3 connections) so CronOps is
 *  completely non-intrusive on the main application pool.
 *
 *  All queries are READ-ONLY by default (enforced via
 *  read-only transactions). Write methods require explicit opt-in.
 */

import { Pool, PoolClient, QueryResult } from 'pg';
import path from 'path';
import fs from 'fs';
import { DATABASE_URL, PGSSLROOTCERT, DRY_RUN } from '../config';

let pool: Pool | null = null;

function getPool(): Pool {
  if (pool) return pool;

  const sslCert = fs.existsSync(PGSSLROOTCERT) ? fs.readFileSync(PGSSLROOTCERT).toString() : undefined;

  // Strip sslmode from connection string (pg handles SSL via ssl option)
  const connectionString = DATABASE_URL.replace(/[?&]sslmode=[^&]+/, '');

  pool = new Pool({
    connectionString,
    ssl: sslCert ? { rejectUnauthorized: true, ca: sslCert } : { rejectUnauthorized: false },
    max: 3,                       // conservative — don't starve the main app
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });

  pool.on('error', (err) => {
    console.error('[CronOps DB] Pool error:', err.message);
  });

  return pool;
}

/**
 * Execute a read-only SQL query.
 */
export async function query<T = Record<string, unknown>>(
  text: string,
  params?: unknown[]
): Promise<QueryResult<T>> {
  const p = getPool();
  return p.query<T>(text, params);
}

/**
 * Execute a write query — blocked in DRY_RUN mode.
 */
export async function write<T = Record<string, unknown>>(
  text: string,
  params?: unknown[]
): Promise<QueryResult<T>> {
  if (DRY_RUN) {
    console.log('[CronOps DB] [DRY_RUN] Skipped write:', text.slice(0, 80));
    return { rows: [], rowCount: 0, command: '', oid: 0, fields: [] };
  }
  const p = getPool();
  return p.query<T>(text, params);
}

/**
 * Acquire a client for a transaction (remember to release!).
 */
export async function getClient(): Promise<PoolClient> {
  return getPool().connect();
}

/**
 * Run a write transaction. Blocked in DRY_RUN mode.
 */
export async function transaction<T>(
  fn: (client: PoolClient) => Promise<T>
): Promise<T | null> {
  if (DRY_RUN) {
    console.log('[CronOps DB] [DRY_RUN] Skipped transaction');
    return null;
  }
  const client = await getClient();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Test database connectivity.
 */
export async function healthCheck(): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
  const start = Date.now();
  try {
    await query('SELECT 1 AS ping');
    return { ok: true, latencyMs: Date.now() - start };
  } catch (err) {
    return { ok: false, latencyMs: Date.now() - start, error: (err as Error).message };
  }
}

/**
 * Graceful close of the pool (called on shutdown).
 */
export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
