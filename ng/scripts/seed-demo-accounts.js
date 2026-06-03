#!/usr/bin/env node

const bcrypt = require('bcryptjs');
const { createSimulationPool } = require('./simulationSafety');

const DEFAULT_DEMO_PASSWORD = 'DoctaRxDemo!2026';
const BCRYPT_ROUNDS = 10;

const DEMO_ACCOUNTS = [
  { demoRole: 'Super Admin', authRole: 'super_admin', email: 'ng.superadmin.demo@doctarx.test', firstName: 'Adaeze', lastName: 'Admin' },
  { demoRole: 'Hospital Admin', authRole: 'admin', email: 'ng.hospital.admin.demo@doctarx.test', firstName: 'Tunde', lastName: 'Adeyemi' },
  { demoRole: 'Doctor', authRole: 'provider', email: 'ng.doctor.demo@doctarx.test', firstName: 'Amina', lastName: 'Okafor', specialty: 'Family Medicine' },
  { demoRole: 'Consultant', authRole: 'provider', email: 'ng.consultant.demo@doctarx.test', firstName: 'Chidi', lastName: 'Nwosu', specialty: 'Internal Medicine' },
  { demoRole: 'Nurse', authRole: 'provider', email: 'ng.nurse.demo@doctarx.test', firstName: 'Kemi', lastName: 'Balogun', specialty: 'Nursing' },
  { demoRole: 'Pharmacist', authRole: 'pharmacy', email: 'ng.pharmacist.demo@doctarx.test', firstName: 'Musa', lastName: 'Ibrahim' },
  { demoRole: 'Lab Technician', authRole: 'provider', email: 'ng.lab.demo@doctarx.test', firstName: 'Bisi', lastName: 'Afolayan', specialty: 'Laboratory Medicine' },
  { demoRole: 'Referral Coordinator', authRole: 'admin', email: 'ng.referral.demo@doctarx.test', firstName: 'Ngozi', lastName: 'Eze' },
  { demoRole: 'Patient', authRole: 'patient', email: 'ng.patient.demo@doctarx.test', firstName: 'Chinedu', lastName: 'Bello' },
];

function getDemoPassword(env = process.env) {
  if (env.NG_DEMO_PASSWORD) return env.NG_DEMO_PASSWORD;
  if (env.ALLOW_DEFAULT_DEMO_PASSWORD === 'true') return DEFAULT_DEMO_PASSWORD;
  throw new Error('Set NG_DEMO_PASSWORD, or set ALLOW_DEFAULT_DEMO_PASSWORD=true for a non-production demo database.');
}

async function ensureColumns(client) {
  await client.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS market_scope VARCHAR(10) DEFAULT 'US'");
  await client.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS test_account_metadata JSONB DEFAULT '{}'::jsonb");
}

async function upsertDemoAccount(client, account, passwordHash) {
  const providerStatus = account.authRole === 'provider' ? 'approved' : null;
  const metadata = {
    demo: true,
    demoRole: account.demoRole,
    market: 'NG',
    seededBy: 'ng/scripts/seed-demo-accounts.js',
    seededAt: new Date().toISOString(),
  };

  const result = await client.query(
    `INSERT INTO users (
       email, password_hash, role, first_name, last_name,
       is_active, is_verified, email_verified_at,
       hipaa_consent_at, terms_accepted_at,
       country, provider_status, specialty, credentials,
       license_number, license_state, market_scope, test_account_metadata,
       created_at, updated_at
     ) VALUES (
       $1,$2,$3,$4,$5,
       TRUE, TRUE, NOW(),
       NOW(), NOW(),
       'Nigeria', $6, $7, $8,
       $9, $10, 'NG', $11::jsonb,
       NOW(), NOW()
     )
     ON CONFLICT (email, role) DO UPDATE SET
       password_hash = EXCLUDED.password_hash,
       role = EXCLUDED.role,
       first_name = EXCLUDED.first_name,
       last_name = EXCLUDED.last_name,
       is_active = TRUE,
       is_verified = TRUE,
       email_verified_at = COALESCE(users.email_verified_at, NOW()),
       hipaa_consent_at = COALESCE(users.hipaa_consent_at, NOW()),
       terms_accepted_at = COALESCE(users.terms_accepted_at, NOW()),
       country = 'Nigeria',
       provider_status = EXCLUDED.provider_status,
       specialty = COALESCE(EXCLUDED.specialty, users.specialty),
       credentials = COALESCE(EXCLUDED.credentials, users.credentials),
       license_number = COALESCE(EXCLUDED.license_number, users.license_number),
       license_state = COALESCE(EXCLUDED.license_state, users.license_state),
       market_scope = 'NG',
       test_account_metadata = COALESCE(users.test_account_metadata, '{}'::jsonb) || EXCLUDED.test_account_metadata,
       updated_at = NOW()
     RETURNING id, email, role, first_name, last_name, test_account_metadata`,
    [
      account.email,
      passwordHash,
      account.authRole,
      account.firstName,
      account.lastName,
      providerStatus,
      account.specialty || null,
      account.authRole === 'provider' ? 'MD' : null,
      account.authRole === 'provider' ? `MDCN-DEMO-${account.demoRole.replace(/\W+/g, '').toUpperCase()}` : null,
      account.authRole === 'provider' ? 'Lagos' : null,
      JSON.stringify(metadata),
    ]
  );

  return result.rows[0];
}

async function seedDemoAccounts({ pool, password, dryRun = false } = {}) {
  if (dryRun) {
    return {
      dryRun: true,
      accounts: DEMO_ACCOUNTS.map((account, index) => ({
        id: `dry-run-user-${index + 1}`,
        email: account.email,
        role: account.authRole,
        demoRole: account.demoRole,
      })),
    };
  }

  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await ensureColumns(client);
    const accounts = [];
    for (const account of DEMO_ACCOUNTS) {
      const row = await upsertDemoAccount(client, account, passwordHash);
      accounts.push({ ...row, demoRole: account.demoRole });
    }
    await client.query('COMMIT');
    return { dryRun: false, accounts };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  if (dryRun) {
    console.log(JSON.stringify(await seedDemoAccounts({ dryRun: true }), null, 2));
    return;
  }

  const password = getDemoPassword();
  const { pool, source, redactedUrl } = createSimulationPool();
  try {
    const result = await seedDemoAccounts({ pool, password });
    console.log(JSON.stringify({
      ok: true,
      source,
      database: redactedUrl,
      passwordSource: process.env.NG_DEMO_PASSWORD ? 'NG_DEMO_PASSWORD' : 'ALLOW_DEFAULT_DEMO_PASSWORD',
      accounts: result.accounts.map((account) => ({
        email: account.email,
        role: account.role,
        demoRole: account.demoRole,
      })),
    }, null, 2));
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  DEMO_ACCOUNTS,
  getDemoPassword,
  seedDemoAccounts,
};
