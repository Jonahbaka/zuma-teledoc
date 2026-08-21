#!/usr/bin/env node

const bcrypt = require('bcryptjs');
const { createSimulationPool } = require('./simulationSafety');

const DEFAULT_DEMO_PASSWORD = 'Demo12345678!';
const DEFAULT_DEMO_MFA_SECRET = 'JBSWY3DPEHPK3PXP';
const BCRYPT_ROUNDS = 10;

const DEMO_ACCOUNTS = [
  { demoRole: 'Super Admin', authRole: 'super_admin', email: 'admin@demo.doctarx.com', legacyEmail: 'ng.superadmin.demo@doctarx.test', firstName: 'Adaeze', lastName: 'Admin' },
  { demoRole: 'Hospital Admin', authRole: 'admin', email: 'hospital@demo.doctarx.com', legacyEmail: 'ng.hospital.admin.demo@doctarx.test', firstName: 'Tunde', lastName: 'Adeyemi' },
  { demoRole: 'Doctor', authRole: 'provider', email: 'doctor@demo.doctarx.com', legacyEmail: 'ng.doctor.demo@doctarx.test', firstName: 'Amina', lastName: 'Okafor', specialty: 'Family Medicine' },
  { demoRole: 'Consultant', authRole: 'provider', email: 'consultant@demo.doctarx.com', legacyEmail: 'ng.consultant.demo@doctarx.test', firstName: 'Chidi', lastName: 'Nwosu', specialty: 'Internal Medicine' },
  { demoRole: 'Nurse', authRole: 'provider', email: 'nurse@demo.doctarx.com', legacyEmail: 'ng.nurse.demo@doctarx.test', firstName: 'Kemi', lastName: 'Balogun', specialty: 'Nursing' },
  { demoRole: 'Pharmacist', authRole: 'pharmacy', email: 'pharmacy@demo.doctarx.com', legacyEmail: 'ng.pharmacist.demo@doctarx.test', firstName: 'Musa', lastName: 'Ibrahim' },
  { demoRole: 'Lab Technician', authRole: 'provider', email: 'lab@demo.doctarx.com', legacyEmail: 'ng.lab.demo@doctarx.test', firstName: 'Bisi', lastName: 'Afolayan', specialty: 'Laboratory Medicine' },
  { demoRole: 'Referral Coordinator', authRole: 'admin', email: 'referral@demo.doctarx.com', legacyEmail: 'ng.referral.demo@doctarx.test', firstName: 'Ngozi', lastName: 'Eze' },
  { demoRole: 'Patient', authRole: 'patient', email: 'patient@demo.doctarx.com', legacyEmail: 'ng.patient.demo@doctarx.test', firstName: 'Chinedu', lastName: 'Bello' },
  { demoRole: 'Government Analyst', authRole: 'patient', email: 'government@demo.doctarx.com', firstName: 'Fictional', lastName: 'Analyst', governmentRole: 'analyst', jurisdictionCode: 'AMAC', mfa: true },
  { demoRole: 'Government Checker', authRole: 'patient', email: 'checker@demo.doctarx.com', firstName: 'Fictional', lastName: 'Checker', governmentRole: 'approver', jurisdictionCode: 'AMAC', mfa: true },
  { demoRole: 'Executive', authRole: 'patient', email: 'executive@demo.doctarx.com', firstName: 'Fictional', lastName: 'Executive', governmentRole: 'executive_read_only', jurisdictionCode: 'FCT', mfa: true },
];

function getDemoPassword(env = process.env) {
  if (env.NG_DEMO_PASSWORD) return env.NG_DEMO_PASSWORD;
  if (env.ALLOW_DEFAULT_DEMO_PASSWORD === 'true') return DEFAULT_DEMO_PASSWORD;
  throw new Error('Set NG_DEMO_PASSWORD, or set ALLOW_DEFAULT_DEMO_PASSWORD=true for a non-production demo database.');
}

async function ensureColumns(client) {
  await client.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS market_scope VARCHAR(10) DEFAULT 'US'");
  await client.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS is_test_account BOOLEAN DEFAULT FALSE");
  await client.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS test_account_metadata JSONB DEFAULT '{}'::jsonb");
}

function getDemoMfaSecret(env = process.env) {
  if (env.NG_DEMO_MFA_SECRET) return env.NG_DEMO_MFA_SECRET;
  if (env.ALLOW_DEFAULT_DEMO_PASSWORD === 'true') return DEFAULT_DEMO_MFA_SECRET;
  throw new Error('Set NG_DEMO_MFA_SECRET for government demo accounts.');
}

async function migrateLegacyEmail(client, account) {
  if (!account.legacyEmail || account.legacyEmail === account.email) return;

  const existing = await client.query(
    'SELECT id FROM users WHERE email = $1 AND role = $2 LIMIT 1',
    [account.email, account.authRole]
  );
  if (existing.rows.length) return;

  await client.query(
    `UPDATE users
        SET email = $1,
            updated_at = NOW()
      WHERE id = (
        SELECT id FROM users
         WHERE email = $2 AND role = $3
         ORDER BY updated_at DESC NULLS LAST, created_at DESC
         LIMIT 1
      )`,
    [account.email, account.legacyEmail, account.authRole]
  );
}

async function upsertDemoAccount(client, account, passwordHash, mfaSecret) {
  const providerStatus = account.authRole === 'provider' ? 'approved' : null;
  const metadata = {
    demo: true,
    testAccount: true,
    developerOnly: true,
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
       license_number, license_state, market_scope, is_test_account, test_account_metadata,
       mfa_enabled, mfa_secret,
       created_at, updated_at
     ) VALUES (
       $1,$2,$3,$4,$5,
       TRUE, TRUE, NOW(),
       NOW(), NOW(),
       'Nigeria', $6, $7, $8,
       $9, $10, 'NG', TRUE, $11::jsonb,
       $12, $13,
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
       is_test_account = TRUE,
       test_account_metadata = COALESCE(users.test_account_metadata, '{}'::jsonb) || EXCLUDED.test_account_metadata,
       mfa_enabled = EXCLUDED.mfa_enabled,
       mfa_secret = EXCLUDED.mfa_secret,
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
      account.mfa === true,
      account.mfa === true ? mfaSecret : null,
    ]
  );

  return result.rows[0];
}

async function ensureGovernmentScopes(client, accounts) {
  const governmentAccounts = DEMO_ACCOUNTS.filter((account) => account.governmentRole);
  for (const account of governmentAccounts) {
    const user = accounts.find((item) => item.email === account.email);
    if (!user) throw new Error(`Government demo account was not created: ${account.email}`);

    const jurisdiction = await client.query(
      'SELECT id FROM ng_jurisdictions WHERE code = $1 LIMIT 1',
      [account.jurisdictionCode]
    );
    if (!jurisdiction.rows.length) {
      throw new Error(`Government demo jurisdiction is unavailable: ${account.jurisdictionCode}`);
    }

    const canApprove = account.governmentRole === 'approver';
    const canExport = account.governmentRole !== 'executive_read_only';
    await client.query(
      `INSERT INTO ng_user_jurisdiction_roles
         (user_id, jurisdiction_id, role, facility_id, programme_area,
          can_export, can_approve, can_view_aggregate, data_class_level, active)
       VALUES ($1, $2, $3, NULL, NULL, $4, $5, TRUE, 'aggregate', TRUE)
       ON CONFLICT (user_id, jurisdiction_id, role) DO UPDATE SET
         can_export = EXCLUDED.can_export,
         can_approve = EXCLUDED.can_approve,
         can_view_aggregate = TRUE,
         data_class_level = 'aggregate',
         active = TRUE`,
      [user.id, jurisdiction.rows[0].id, account.governmentRole, canExport, canApprove]
    );
  }
}

async function seedDemoAccounts({ pool, password, mfaSecret = DEFAULT_DEMO_MFA_SECRET, dryRun = false } = {}) {
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
      await migrateLegacyEmail(client, account);
      const row = await upsertDemoAccount(client, account, passwordHash, mfaSecret);
      accounts.push({ ...row, demoRole: account.demoRole });
    }
    await ensureGovernmentScopes(client, accounts);
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
  const mfaSecret = getDemoMfaSecret();
  const { pool, source, redactedUrl } = createSimulationPool();
  try {
    const result = await seedDemoAccounts({ pool, password, mfaSecret });
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
  getDemoMfaSecret,
  seedDemoAccounts,
};
