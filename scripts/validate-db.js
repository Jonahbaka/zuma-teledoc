/**
 * DoctaRx DB Validation Script
 * Validates the Neon (primary) + AWS (backup) dual-database architecture.
 *
 * Usage:  node scripts/validate-db.js
 *         npm run validate:db
 */

'use strict';

const path = require('path');

// ─── 1. Load environment variables ───────────────────────────────────────────
// Try config/.env first, fall back to root .env
const configEnvPath = path.resolve(__dirname, '../config/.env');
const rootEnvPath   = path.resolve(__dirname, '../.env');

const fs = require('fs');
if (fs.existsSync(configEnvPath)) {
  require('dotenv').config({ path: configEnvPath });
  console.log(`[ENV] Loaded environment from ${configEnvPath}`);
} else if (fs.existsSync(rootEnvPath)) {
  require('dotenv').config({ path: rootEnvPath });
  console.log(`[ENV] Loaded environment from ${rootEnvPath}`);
} else {
  console.log('[ENV] ⚠ No .env file found — relying on process environment variables');
}

// ─── 2. Import database modules ──────────────────────────────────────────────
const db = require('../server/db/index.js');

// Backup module is optional — it may not exist in all deployments
let backup = null;
let backupLoadError = null;
try {
  backup = require('../server/db/backup.js');
} catch (err) {
  backupLoadError = err.message;
}

// ─── Required tables ─────────────────────────────────────────────────────────
const REQUIRED_TABLES = ['users', 'doctors', 'patients', 'visits', 'prescriptions'];

// ─── Main validation routine ─────────────────────────────────────────────────
async function main() {
  console.log('\n════════════════════════════════════════════════════════');
  console.log(' DOCTARX DATABASE VALIDATION — starting checks…');
  console.log('════════════════════════════════════════════════════════\n');

  // Accumulated results for the final report
  const report = {
    neon:          null,   // 'PASS' | 'FAIL'
    schemaTables:  0,      // number of tables found out of 5
    backup:        null,   // 'CONFIGURED' | 'NOT CONFIGURED' | 'FAIL'
    writeBlock:    null,   // 'PASS' | 'FAIL' | 'SKIPPED'
    neonConfig:    null,   // 'PASS' | 'FAIL'
  };

  // ── STEP 1: Neon connection ────────────────────────────────────────────────
  console.log('── STEP 1: Neon connection ──────────────────────────────');
  try {
    const health = await db.healthCheck();
    if (health.healthy) {
      const ts = health.timestamp ? new Date(health.timestamp).toISOString() : new Date().toISOString();
      console.log(`[NEON] ✓ Connected — ${ts}`);
      report.neon = 'PASS';
    } else {
      const errMsg = health.error || 'unknown error';
      console.log(`[NEON] ✗ Connection failed — ${errMsg}`);
      report.neon = 'FAIL';
    }
  } catch (err) {
    console.log(`[NEON] ✗ Connection failed — ${err.message}`);
    report.neon = 'FAIL';
  }

  // ── STEP 2: Schema verification ───────────────────────────────────────────
  console.log('\n── STEP 2: Schema verification ─────────────────────────');
  let missingTables = 0;

  if (report.neon === 'FAIL') {
    console.log('[SCHEMA] ⚠ Skipped — Neon connection unavailable');
    missingTables = REQUIRED_TABLES.length;
  } else {
    try {
      const tableList = REQUIRED_TABLES.map((_, i) => `$${i + 1}`).join(', ');
      const sql = `
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name IN (${tableList})
      `;
      const result = await db.query(sql, REQUIRED_TABLES);
      const foundSet = new Set(result.rows.map(r => r.table_name));

      for (const table of REQUIRED_TABLES) {
        if (foundSet.has(table)) {
          console.log(`[SCHEMA] ✓ Table '${table}' exists`);
          report.schemaTables++;
        } else {
          console.log(`[SCHEMA] ✗ Table '${table}' MISSING`);
          missingTables++;
        }
      }
    } catch (err) {
      console.log(`[SCHEMA] ✗ Schema query failed — ${err.message}`);
      missingTables = REQUIRED_TABLES.length;
    }
  }

  // ── STEP 3: AWS backup connection ─────────────────────────────────────────
  console.log('\n── STEP 3: AWS backup connection ────────────────────────');
  const backupUrl = process.env.BACKUP_DATABASE_URL;
  let backupEnabled = false;

  if (!backupUrl) {
    console.log('[BACKUP] ⚠ BACKUP_DATABASE_URL not set — backup verification skipped');
    report.backup = 'NOT CONFIGURED';
  } else if (!backup) {
    console.log(`[BACKUP] ⚠ Backup module not found (${backupLoadError}) — backup verification skipped`);
    report.backup = 'NOT CONFIGURED';
  } else {
    try {
      // The backup module must export a healthCheck function (backupHealthCheck or healthCheck)
      const backupHealthFn = backup.backupHealthCheck || backup.healthCheck;
      if (typeof backupHealthFn !== 'function') {
        throw new Error('No healthCheck function exported from backup module');
      }

      const health = await backupHealthFn();
      if (health && health.healthy) {
        const ts = health.timestamp ? new Date(health.timestamp).toISOString() : new Date().toISOString();
        console.log(`[BACKUP] ✓ Connected — ${ts}`);
        backupEnabled = true;
        report.backup = 'CONFIGURED';
      } else {
        const errMsg = (health && health.error) ? health.error : 'unknown error';
        console.log(`[BACKUP] ✗ Health check failed — ${errMsg}`);
        report.backup = 'FAIL';
      }

      // Attempt a read query to confirm connectivity
      const readFn = backup.readBackup || backup.query;
      if (typeof readFn === 'function') {
        try {
          const readResult = await readFn('SELECT NOW() as ts');
          const ts = readResult && readResult.rows && readResult.rows[0]
            ? new Date(readResult.rows[0].ts).toISOString()
            : new Date().toISOString();
          console.log(`[BACKUP] ✓ Read query succeeded — ${ts}`);
        } catch (readErr) {
          console.log(`[BACKUP] ⚠ Read query failed — ${readErr.message}`);
        }
      }
    } catch (err) {
      console.log(`[BACKUP] ✗ Connection failed — ${err.message}`);
      report.backup = 'FAIL';
    }
  }

  // ── STEP 4: AWS write-block verification ──────────────────────────────────
  console.log('\n── STEP 4: AWS write-block verification ─────────────────');
  if (!backupEnabled) {
    console.log('[BACKUP] ⚠ Write-block check skipped — backup not enabled');
    report.writeBlock = 'SKIPPED';
  } else {
    const readFn = backup.readBackup || backup.query;
    if (typeof readFn !== 'function') {
      console.log('[BACKUP] ⚠ Write-block check skipped — no query function available');
      report.writeBlock = 'SKIPPED';
    } else {
      try {
        await readFn('INSERT INTO users(email) VALUES ($1)', ['test@test.com']);
        // If we reach here, the write was NOT blocked — critical failure
        console.log('[BACKUP] ✗ CRITICAL: Write succeeded on backup — IMMEDIATE ACTION REQUIRED');
        report.writeBlock = 'FAIL';
      } catch (_err) {
        // Expected — the backup DB should be read-only
        console.log('[BACKUP] ✓ Write blocked — read-only enforcement confirmed');
        report.writeBlock = 'PASS';
      }
    }
  }

  // ── STEP 5: System independence check ────────────────────────────────────
  console.log('\n── STEP 5: System independence check ────────────────────');
  const dbUrl = process.env.DATABASE_URL;
  if (dbUrl && dbUrl.includes('neon.tech')) {
    console.log('[CONFIG] ✓ Neon is primary (neon.tech detected)');
    report.neonConfig = 'PASS';
  } else if (!dbUrl) {
    console.log('[CONFIG] ✗ DATABASE_URL is not set');
    report.neonConfig = 'FAIL';
  } else {
    console.log('[CONFIG] ✗ DATABASE_URL does not point to Neon');
    report.neonConfig = 'FAIL';
  }

  // ── FINAL REPORT ──────────────────────────────────────────────────────────
  console.log('\n════════════════════════════════════════════════════════');
  console.log(' DOCTARX DB VALIDATION REPORT');
  console.log('════════════════════════════════════════════════════════');

  // Determine blockers
  const blockers = [];
  if (report.neon !== 'PASS')       blockers.push('Neon connection failed');
  if (report.schemaTables < 5)      blockers.push(`Schema incomplete (${report.schemaTables}/5 tables present)`);
  if (report.writeBlock === 'FAIL') blockers.push('Backup write-block NOT enforced — critical security issue');
  const productionReady = blockers.length === 0;

  console.log(`Neon (primary):        ${report.neon}`);
  console.log(`Schema:                ${report.schemaTables}/5 tables present`);
  console.log(`AWS backup:            ${report.backup}`);
  console.log(`Backup write-block:    ${report.writeBlock}`);
  console.log(`Neon primary config:   ${report.neonConfig}`);
  console.log(`Production ready:      ${productionReady ? 'YES' : 'NO'}`);

  if (!productionReady) {
    console.log('\nBlockers:');
    blockers.forEach(b => console.log(`  - ${b}`));
  }

  console.log('════════════════════════════════════════════════════════\n');

  // Close the primary pool gracefully so Node can exit cleanly
  try {
    await db.close();
  } catch (_) { /* ignore close errors */ }

  // Exit 0 only when Neon is up AND all 5 schema tables exist
  const criticalPass = report.neon === 'PASS' && report.schemaTables === 5;
  process.exit(criticalPass ? 0 : 1);
}

main().catch(err => {
  console.error('[FATAL] Unhandled error in validation script:', err);
  process.exit(1);
});
