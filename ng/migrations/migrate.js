/**
 * Nigeria Migration Runner
 * Runs SQL migrations for the NG region tables
 * Does NOT touch existing US tables
 */

const fs = require('fs');
const path = require('path');

async function runNgMigrations(pool) {
  console.log('[NG] Running Nigeria region migrations...');

  // Create migrations tracking table if not exists
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ng_migrations (
      id SERIAL PRIMARY KEY,
      filename VARCHAR(255) UNIQUE NOT NULL,
      executed_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  // Get already-run migrations
  const executed = await pool.query('SELECT filename FROM ng_migrations');
  const executedFiles = new Set(executed.rows.map(r => r.filename));

  // Get migration files
  const migrationsDir = path.join(__dirname);
  const files = fs.readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql'))
    .sort();

  let ran = 0;

  for (const file of files) {
    if (executedFiles.has(file)) {
      console.log(`[NG] Skipping (already run): ${file}`);
      continue;
    }

    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');

    try {
      await pool.query('BEGIN');
      await pool.query(sql);
      await pool.query('INSERT INTO ng_migrations (filename) VALUES ($1)', [file]);
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
  const pool = getPool();
  runNgMigrations(pool)
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
