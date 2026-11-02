/**
 * Nigeria region migration runner.
 *
 * A checked-out PostgreSQL client is required for BEGIN/COMMIT and schema
 * changes; pool.query can use different clients for adjacent statements.
 * A session advisory lock serializes concurrent startup/release invocations.
 * No destructive down migration is executed here.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const NG_LOCK_KEY = 'doctarx_ng_migrations_v1';

function checksum(sql) {
  return crypto.createHash('sha256').update(sql, 'utf8').digest('hex');
}

async function runNgMigrations(pool) {
  if (!pool || typeof pool.connect !== 'function') {
    throw new Error('[NG] A PostgreSQL connection pool is required for transactional migrations.');
  }
  const client = await pool.connect();
  let locked = false;
  let ran = 0;
  const migrationsDir = __dirname;
  const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort();

  try {
    // Hold the lock over the manifest read and all migration transactions.
    // The 30-second lock timeout avoids indefinite startup hangs.
    await client.query("SET lock_timeout TO '30s'");
    await client.query('SELECT pg_advisory_lock(hashtext($1))', [NG_LOCK_KEY]);
    locked = true;
    await client.query('SET lock_timeout TO DEFAULT');

    await client.query('BEGIN');
    try {
      await client.query('CREATE TABLE IF NOT EXISTS ng_migrations (' +
        'id SERIAL PRIMARY KEY, filename VARCHAR(255) UNIQUE NOT NULL,' +
        'checksum CHAR(64), executed_at TIMESTAMPTZ DEFAULT NOW())');
      await client.query('ALTER TABLE ng_migrations ADD COLUMN IF NOT EXISTS checksum CHAR(64)');
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }

    const executed = await client.query('SELECT filename, checksum FROM ng_migrations');
    const executedFiles = new Map(executed.rows.map(r => [r.filename, r.checksum?.trim() || null]));

    for (const file of files) {
      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
      const digest = checksum(sql);

      if (executedFiles.has(file)) {
        const recorded = executedFiles.get(file);
        if (recorded && recorded !== digest) {
          throw new Error('[NG] Migration checksum mismatch: ' + file);
        }
        if (!recorded) {
          await client.query(
            'UPDATE ng_migrations SET checksum=$2 WHERE filename=$1 AND checksum IS NULL',
            [file, digest]
          );
        }
        continue;
      }

      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO ng_migrations (filename, checksum) VALUES ($1, $2)', [file, digest]);
        await client.query('COMMIT');
        executedFiles.set(file, digest);
        ran += 1;
        console.log('[NG] Migrated: ' + file);
      } catch (error) {
        await client.query('ROLLBACK');
        console.error('[NG] Migration failed: ' + file + ' (' + (error.code || 'SQL_ERROR') + ')');
        throw error;
      }
    }

    console.log('[NG] Migration manifest verified; ' + ran + ' new, ' + files.length + ' total.');
    return { ran, total: files.length };
  } finally {
    if (locked) {
      try { await client.query('SELECT pg_advisory_unlock(hashtext($1))', [NG_LOCK_KEY]); }
      catch (_error) { /* Disconnect also releases the session lock. */ }
    }
    try { await client.query('SET lock_timeout TO DEFAULT'); } catch (_error) {}
    client.release();
  }
}

if (require.main === module) {
  const { getPool } = require('../../server/db');
  const pool = getPool();
  runNgMigrations(pool)
    .then(result => { console.log('[NG] Migration result:', result); process.exitCode = 0; })
    .catch(error => { console.error('[NG] Migration failed:', error.code || error.message); process.exitCode = 1; })
    .finally(async () => {
      try { await pool.end(); } catch (_error) {}
    });
}

module.exports = { runNgMigrations, NG_LOCK_KEY, checksum };
