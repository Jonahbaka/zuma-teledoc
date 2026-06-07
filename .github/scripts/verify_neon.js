#!/usr/bin/env node
/**
 * Neon DB schema verifier for NG clinical tables.
 * Run on EC2 with: node -r dotenv/config .github/scripts/verify_neon.js
 */

const { Pool } = require('pg');

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL missing — cannot verify Neon');
  process.exit(2);
}

const pool = new Pool({
  connectionString: url,
  ssl: /neon\.tech|sslmode=/i.test(url) ? { rejectUnauthorized: false } : false,
});

const required = [
  'ng_clinical_encounters',
  'ng_soap_notes',
  'ng_diagnoses',
  'ng_medication_history',
  'ng_referrals',
];

(async () => {
  try {
    console.log('Connected to Neon/Postgres');

    for (const table of required) {
      const exists = await pool.query('SELECT to_regclass($1) AS r', [`public.${table}`]);
      if (!exists.rows[0].r) {
        console.error(`[FAIL] table missing: ${table}`);
        process.exitCode = 1;
        continue;
      }
      const count = await pool.query(`SELECT count(*)::int AS c FROM ${table}`);
      console.log(`[PASS] ${table}: rows=${count.rows[0].c}`);
    }

    const mig = await pool.query(
      `SELECT filename, executed_at FROM ng_migrations
       WHERE filename ILIKE '%clinical%'
       ORDER BY executed_at DESC LIMIT 10`
    ).catch(() => ({ rows: [] }));
    console.log('clinical migrations:', mig.rows);

    console.log(process.exitCode ? 'NEON_SCHEMA=FAIL' : 'NEON_SCHEMA=PASS');
  } finally {
    await pool.end();
  }
})();
