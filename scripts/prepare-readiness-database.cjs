'use strict';

// Provision only an empty, explicitly selected disposable database. Never reset
// an existing developer's accounts or reuse a production connection implicitly.
const crypto = require('node:crypto');
const { fixtureTargetSafety } = require('../ng/scripts/fixtureTargetSafety');
const { createSimulationPool } = require('../ng/scripts/simulationSafety');
const { seedDemoAccounts } = require('../ng/scripts/seed-demo-accounts');

async function main() {
  if (process.env.NODE_ENV !== 'test' || process.env.DATABASE_URL !== process.env.SIMULATION_DATABASE_URL) {
    throw new Error('Explicit matching test database URLs and NODE_ENV=test are required');
  }
  const safety = fixtureTargetSafety({ source: 'SIMULATION_DATABASE_URL' });
  if (safety.skipped) throw new Error(safety.reason);
  const { pool } = createSimulationPool();
  try {
    const actual = fixtureTargetSafety({ source: 'SIMULATION_DATABASE_URL', pool });
    if (actual.skipped) throw new Error(actual.reason);
    const existing = await pool.query('SELECT count(*)::integer AS count FROM users');
    if (existing.rows[0].count !== 0) throw new Error('Readiness provisioning requires an empty users table; existing work is preserved');
    const result = await seedDemoAccounts({ pool, password: crypto.randomBytes(48).toString('base64url') });
    if (result.skipped || !result.demoProgramme || result.accounts.length !== 12) throw new Error('Fictional readiness fixture provisioning failed');
    console.log('READINESS_FIXTURES: 12 fictional accounts and isolated programme provisioned');
  } finally {
    await pool.end();
  }
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
