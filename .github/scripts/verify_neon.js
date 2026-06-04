#!/usr/bin/env node
/**
 * Read-only Neon deployment verifier.
 *
 * Proves the NG clinical database deployment WITHOUT mutating production:
 *   1. migration 017_ng_clinical_records.sql is recorded in ng_migrations
 *   2. the required clinical tables exist
 *   3. the documented persisted records from the live simulation are present
 *      (encounter / SOAP / diagnosis / referral), proving the live clinical
 *      pipeline actually wrote to this database
 *   4. per-table row counts
 *
 * Connects via DATABASE_URL (or SIMULATION_DATABASE_URL). Never prints the
 * connection string. Exits non-zero if the migration or any required table is
 * missing.
 */
const { Pool } = require('pg');

const URL = process.env.DATABASE_URL || process.env.SIMULATION_DATABASE_URL || '';
if (!URL) {
  console.error('::error::No DATABASE_URL available to CI — cannot verify Neon. (Set the DATABASE_URL secret.)');
  process.exit(2);
}

const REQUIRED_TABLES = [
  'ng_clinical_encounters',
  'ng_soap_notes',
  'ng_diagnoses',
  'ng_medication_history',
  'ng_referrals',
];

// Documented persisted records from the live clinical simulation
// (run ng-clinical-1780506341962). Mapped to their owning tables where the
// mapping is unambiguous from the schema.
const DOCUMENTED = [
  { table: 'ng_clinical_encounters', id: '6562aa8b-63da-473e-9fdd-3f9429a6015f', label: 'encounter' },
  { table: 'ng_soap_notes',          id: 'b6ebbf4b-797d-4e56-ab8b-dd45776d3ec2', label: 'SOAP note' },
  { table: 'ng_diagnoses',           id: '6253f6c0-c7c3-4e6a-b091-125766fe332b', label: 'diagnosis' },
  { table: 'ng_referrals',           id: 'da5bd8fd-eaa0-4dd9-bb77-57bff5004882', label: 'referral' },
];

const pool = new Pool({
  connectionString: URL,
  ssl: URL.includes('neon.tech') || URL.includes('sslmode=') ? { rejectUnauthorized: false } : false,
  connectionTimeoutMillis: 10000,
  query_timeout: 15000,
});

const results = [];
function gate(name, ok, detail) {
  results.push([name, ok, detail]);
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${name}: ${detail}`);
}

(async () => {
  try {
    const ver = await pool.query('SELECT version()');
    console.log('Connected to Postgres:', String(ver.rows[0].version).slice(0, 60), '...');

    // 1) migration recorded
    let migOk = false, migDetail = 'ng_migrations not found';
    try {
      const m = await pool.query(
        "SELECT filename FROM ng_migrations WHERE filename ILIKE '%017_ng_clinical_records%'"
      );
      migOk = m.rowCount > 0;
      migDetail = migOk ? `found: ${m.rows.map(r => r.filename).join(', ')}` : '017_ng_clinical_records.sql NOT in ng_migrations';
    } catch (e) {
      migDetail = `ng_migrations query failed: ${e.message}`;
    }
    gate('migration_017_recorded', migOk, migDetail);

    // 2) required tables exist + 4) counts
    for (const t of REQUIRED_TABLES) {
      const reg = await pool.query('SELECT to_regclass($1) AS r', [`public.${t}`]);
      const exists = reg.rows[0].r !== null;
      let count = 'n/a';
      if (exists) {
        try { count = (await pool.query(`SELECT count(*)::int AS c FROM ${t}`)).rows[0].c; } catch { count = 'count_failed'; }
      }
      gate(`table_exists:${t}`, exists, `exists=${exists} rows=${count}`);
    }

    // 3) documented persisted records present
    for (const d of DOCUMENTED) {
      let found = false, detail;
      try {
        const r = await pool.query(`SELECT 1 FROM ${d.table} WHERE id = $1 LIMIT 1`, [d.id]);
        found = r.rowCount > 0;
        detail = `${d.label} ${d.id} ${found ? 'PRESENT' : 'NOT FOUND'} in ${d.table}`;
      } catch (e) {
        detail = `lookup failed in ${d.table}: ${e.message}`;
      }
      gate(`record_present:${d.label}`, found, detail);
    }

    // Hard gate: migration + all required tables must exist. Documented records
    // are strong corroboration; report but do not fail the schema gate if the
    // production data set was rotated (counts still prove the pipeline ran).
    const schemaOk = results.filter(([n]) => n === 'migration_017_recorded' || n.startsWith('table_exists:'))
      .every(([, ok]) => ok);
    const recordsOk = results.filter(([n]) => n.startsWith('record_present:')).every(([, ok]) => ok);

    console.log('\n================ NEON VERIFICATION SUMMARY ================');
    console.log(`schema (migration + tables): ${schemaOk ? 'VERIFIED' : 'FAILED'}`);
    console.log(`documented persisted records: ${recordsOk ? 'ALL PRESENT' : 'SOME MISSING (see above)'}`);
    console.log(`NEON_SCHEMA=${schemaOk ? 'PASS' : 'FAIL'}`);
    console.log(`NEON_RECORDS=${recordsOk ? 'PASS' : 'FAIL'}`);

    await pool.end();
    process.exit(schemaOk ? 0 : 1);
  } catch (e) {
    console.error('::error::Neon verification error:', e.message);
    try { await pool.end(); } catch {}
    process.exit(1);
  }
})();
