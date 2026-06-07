'use strict';

/**
 * server/routes/neonVerify.js
 * One-time read-only Neon schema verifier. Mounted at /api/neon-verify.
 * Protected by X-Neon-Verify header. Returns no secret values.
 * Remove this file after verification is complete.
 */

const express = require('express');
const router = express.Router();

const VERIFY_TOKEN = 'neon-verify-67b1fe4-doctarx-ng';

router.get('/', async (req, res) => {
  if (req.headers['x-neon-verify'] !== VERIFY_TOKEN) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  const result = {
    commit: process.env.GIT_COMMIT || 'unknown',
    timestamp: new Date().toISOString(),
    vault_path: null,
    loaded_keys: [],
    DATABASE_URL_SET: false,
    DATABASE_URL_NEON: false,
    DATABASE_URL_SSL: false,
    tables: {},
    clinical_migrations: [],
    NEON_SCHEMA: 'FAIL',
    error: null,
  };

  try {
    // Load secrets via vault
    const { bootstrapProductionSecrets } = require('../services/productionSecrets');
    const info = bootstrapProductionSecrets({ requiredKeys: ['DATABASE_URL'] });
    result.vault_path = info.vaultPath;
    result.loaded_keys = info.loadedKeys;
  } catch (err) {
    result.error = 'secret_load_failed: ' + err.message;
    return res.json(result);
  }

  const url = process.env.DATABASE_URL || '';
  result.DATABASE_URL_SET = Boolean(url);
  result.DATABASE_URL_NEON = /neon\.tech/i.test(url);
  result.DATABASE_URL_SSL = /sslmode=require|sslmode=verify-full/i.test(url);

  if (!result.DATABASE_URL_SET) {
    result.error = 'DATABASE_URL_missing';
    return res.json(result);
  }

  let pool;
  try {
    const { Pool } = require('pg');
    pool = new Pool({
      connectionString: url,
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 10000,
    });
  } catch (err) {
    result.error = 'pool_create_failed: ' + err.message;
    return res.json(result);
  }

  try {
    const required = [
      'ng_clinical_encounters',
      'ng_soap_notes',
      'ng_diagnoses',
      'ng_medication_history',
      'ng_referrals',
    ];

    let allPass = true;
    for (const table of required) {
      try {
        const exists = await pool.query('SELECT to_regclass($1) AS r', [`public.${table}`]);
        if (!exists.rows[0].r) {
          result.tables[table] = { exists: false, rows: null };
          allPass = false;
        } else {
          const count = await pool.query(`SELECT count(*)::int AS c FROM ${table}`);
          result.tables[table] = { exists: true, rows: count.rows[0].c };
        }
      } catch (err) {
        result.tables[table] = { exists: false, rows: null, error: err.message };
        allPass = false;
      }
    }

    // Check migration records
    try {
      const mig = await pool.query(
        `SELECT filename, executed_at FROM ng_migrations
         WHERE filename ILIKE '%017%' OR filename ILIKE '%clinical%'
         ORDER BY executed_at DESC LIMIT 20`
      );
      result.clinical_migrations = mig.rows.map(r => ({
        filename: r.filename,
        executed_at: r.executed_at,
      }));
    } catch (err) {
      result.clinical_migrations = [{ error: err.message }];
    }

    result.NEON_SCHEMA = allPass ? 'PASS' : 'FAIL';
  } catch (err) {
    result.error = 'verification_error: ' + err.message;
  } finally {
    try { await pool.end(); } catch {}
  }

  res.json(result);
});

module.exports = router;
