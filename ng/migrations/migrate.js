/**
 * Nigeria Migration Runner
 * Runs SQL migrations for the NG region tables
 * Does NOT touch existing US tables
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function checksum(sql) {
  return crypto.createHash('sha256').update(sql, 'utf8').digest('hex');
}

async function runNgMigrations(pool) {
  console.log('[NG] Running Nigeria region migrations...');

  // Create migrations tracking table if not exists
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ng_migrations (
      id SERIAL PRIMARY KEY,
      filename VARCHAR(255) UNIQUE NOT NULL,
      checksum CHAR(64),
      executed_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query('ALTER TABLE ng_migrations ADD COLUMN IF NOT EXISTS checksum CHAR(64)');

  // Get already-run migrations
  const executed = await pool.query('SELECT filename, checksum FROM ng_migrations');
  const executedFiles = new Map(executed.rows.map(r => [r.filename, r.checksum?.trim() || null]));

  // Get migration files
  const migrationsDir = path.join(__dirname);
  const files = fs.readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql'))
    .sort();

  let ran = 0;

  for (const file of files) {
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
    const digest = checksum(sql);
    if (executedFiles.has(file)) {
      const recorded = executedFiles.get(file);
      if (recorded && recorded !== digest) {
        throw new Error(`[NG] Migration checksum mismatch: ${file}`);
      }
      if (!recorded) {
        await pool.query('UPDATE ng_migrations SET checksum = $2 WHERE filename = $1 AND checksum IS NULL', [file, digest]);
      }
      console.log(`[NG] Skipping (already run): ${file}`);
      continue;
    }

    try {
      await pool.query('BEGIN');
      await pool.query(sql);
      await pool.query('INSERT INTO ng_migrations (filename, checksum) VALUES ($1, $2)', [file, digest]);
      await pool.query('COMMIT');
      console.log(`[NG] ✓ Migrated: ${file}`);
      ran++;
    } catch (err) {
      await pool.query('ROLLBACK');
      console.error(`[NG] ✗ Migration failed: ${file}`, err.message);
      throw err;
    }
  }

  console.log(`[NG] Migrations complete. Ran ${ran} new migration(s).`);
  return { ran, total: files.length };
}

// Allow standalone execution
if (require.main === module) {
  const { getPool } = require('../../server/db');
  Promise.resolve(getPool())
    .then(pool => runNgMigrations(pool))
    .then(result => {
      console.log('[NG] Migration result:', result);
      process.exit(0);
    })
    .catch(err => {
      console.error('[NG] Migration failed:', err);
      process.exit(1);
    });
}

module.exports = { runNgMigrations };
