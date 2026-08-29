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

const DEMO_PROGRAMME_ROLES = {
  'Super Admin': 'platform_admin',
  'Hospital Admin': 'facility_admin',
  Doctor: 'remote_clinician',
  Consultant: 'remote_clinician',
  Nurse: 'phc_nurse',
  Pharmacist: 'pharmacist',
  'Lab Technician': 'lab_technician',
  'Referral Coordinator': 'referral_coordinator',
  'Government Analyst': 'government_analyst',
  'Government Checker': 'government_approver',
  Executive: 'executive_read_only',
};

function demoProviderSpecialty(account) {
  if (account.demoRole === 'Consultant') return 'internal_medicine';
  return account.demoRole === 'Doctor' ? 'general_practice' : 'other';
}

async function ensureDemoProgrammeScope(client, accounts) {
  const programme = await client.query(
    `SELECT id FROM public_health_programmes
      WHERE programme_key = 'developer_demo' AND demo_only = TRUE
      LIMIT 1`
  );
  if (!programme.rows.length) {
    throw new Error('Developer demo programme is unavailable. Run Nigeria migrations first.');
  }
  const programmeId = programme.rows[0].id;

  const facilityResult = await client.query(
    `INSERT INTO ng_hospitals
       (name, slug, facility_type, status,
        contact_name, contact_email, contact_phone,
        address_line1, city, state, lga,
        ownership_type, facility_code, description)
     VALUES
       ('DoctaRx Synthetic PHC', 'developer-demo-phc', 'primary_health_centre', 'active',
        'Developer Demo Operator', 'demo-facility@demo.doctarx.com', '+2340000000000',
        'Synthetic Data Only', 'Abuja', 'FCT', 'AMAC',
        'demo', 'DEMO-PHC-001',
        'Developer-only synthetic facility. Real patient data is prohibited.')
     ON CONFLICT (slug) DO UPDATE SET
       status = 'active',
       ownership_type = 'demo',
       facility_code = 'DEMO-PHC-001',
       description = EXCLUDED.description,
       updated_at = NOW()
     RETURNING id`,
  );
  const facilityId = facilityResult.rows[0].id;

  await client.query(
    `INSERT INTO ng_clinical_devices
       (programme_id, facility_id, device_type, manufacturer, model,
        status, calibration_status, adapter_key, metadata_json)
     SELECT $1,$2,'synthetic_vital_sign_monitor','DoctaRx Test Fixture','Gateway Mock v1',
            'active','not_required','mock_device_v1',
            '{"synthetic":true,"clinicalUse":false,"developerOnly":true}'::JSONB
      WHERE NOT EXISTS (
        SELECT 1 FROM ng_clinical_devices
         WHERE programme_id=$1 AND facility_id=$2 AND adapter_key='mock_device_v1'
           AND status <> 'retired'
      )`,
    [programmeId, facilityId]
  );

  const reportingFacility = await client.query(
    `INSERT INTO public_health_facilities
       (name, facility_type, ownership_type, lga, city, state, address, active, hospital_id)
     SELECT 'DoctaRx Synthetic PHC', 'phc', 'demo', 'AMAC', 'Abuja', 'FCT',
            'Synthetic Data Only', TRUE, $1
      WHERE NOT EXISTS (
        SELECT 1 FROM public_health_facilities WHERE hospital_id = $1
      )
     RETURNING id`,
    [facilityId]
  );
  let reportingFacilityId = reportingFacility.rows[0]?.id;
  if (!reportingFacilityId) {
    const existing = await client.query(
      'SELECT id FROM public_health_facilities WHERE hospital_id = $1 LIMIT 1',
      [facilityId]
    );
    reportingFacilityId = existing.rows[0].id;
  }

  const programmeFacility = await client.query(
    `INSERT INTO ng_programme_facilities
       (programme_id, facility_id, public_health_facility_id, status, is_primary,
        configuration_json, effective_at)
     VALUES ($1, $2, $3, 'active', TRUE, '{"syntheticDataOnly":true}'::JSONB, NOW())
     ON CONFLICT (programme_id, facility_id) DO UPDATE SET
       public_health_facility_id = EXCLUDED.public_health_facility_id,
       status = 'active',
       is_primary = TRUE,
       configuration_json = EXCLUDED.configuration_json,
       ended_at = NULL,
       updated_at = NOW()
     RETURNING id`,
    [programmeId, facilityId, reportingFacilityId]
  );

  const providerIds = new Map();
  for (const account of DEMO_ACCOUNTS.filter((item) => item.authRole === 'provider')) {
    const user = accounts.find((item) => item.email === account.email);
    const provider = await client.query(
      `INSERT INTO ng_providers
         (user_id, full_name, email, phone, mdcn_number, specialty,
          status, verified_at, is_available, primary_hospital_id,
          practice_name, practice_city, practice_state)
       VALUES ($1, $2, $3, '+2340000000000', $4, $5, 'verified', NOW(), TRUE, $6,
               'DoctaRx Synthetic PHC', 'Abuja', 'FCT')
       ON CONFLICT (user_id) DO UPDATE SET
         full_name = EXCLUDED.full_name,
         email = EXCLUDED.email,
         mdcn_number = EXCLUDED.mdcn_number,
         specialty = EXCLUDED.specialty,
         status = 'verified',
         verified_at = COALESCE(ng_providers.verified_at, NOW()),
         is_available = TRUE,
         primary_hospital_id = EXCLUDED.primary_hospital_id,
         updated_at = NOW()
       RETURNING id`,
      [
        user.id,
        `${account.firstName} ${account.lastName}`,
        account.email,
        `MDCN-DEMO-${account.demoRole.replace(/\W+/g, '').toUpperCase()}`,
        demoProviderSpecialty(account),
        facilityId,
      ]
    );
    providerIds.set(account.email, provider.rows[0].id);
  }

  for (const account of DEMO_ACCOUNTS) {
    const user = accounts.find((item) => item.email === account.email);
    const programmeRole = DEMO_PROGRAMME_ROLES[account.demoRole];
    if (programmeRole) {
      await client.query(
        `INSERT INTO ng_programme_memberships
           (programme_id, user_id, facility_id, role, status, permissions_json,
            can_export, can_approve, effective_at)
         SELECT $1, $2, $3, $4, 'active', '{"syntheticDataOnly":true}'::JSONB,
                $5, $6, NOW()
          WHERE NOT EXISTS (
            SELECT 1 FROM ng_programme_memberships
             WHERE programme_id = $1 AND user_id = $2 AND facility_id = $3
               AND role = $4 AND status IN ('invited','active','suspended')
          )`,
        [
          programmeId,
          user.id,
          facilityId,
          programmeRole,
          ['government_analyst', 'government_approver'].includes(programmeRole),
          programmeRole === 'government_approver',
        ]
      );
      await client.query(
        `UPDATE ng_programme_memberships
            SET status = 'active', expires_at = NULL, revoked_at = NULL,
                permissions_json = '{"syntheticDataOnly":true}'::JSONB,
                updated_at = NOW()
          WHERE programme_id = $1 AND user_id = $2 AND facility_id = $3 AND role = $4`,
        [programmeId, user.id, facilityId, programmeRole]
      );
    }

    const staffRole = {
      Doctor: 'doctor', Consultant: 'doctor', Nurse: 'nurse',
      Pharmacist: 'pharmacist', 'Lab Technician': 'lab_technician',
      'Hospital Admin': 'admin', 'Referral Coordinator': 'admin',
    }[account.demoRole];
    if (staffRole) {
      await client.query(
        `INSERT INTO ng_hospital_staff
           (hospital_id, user_id, provider_id, full_name, email, phone, role,
            designation, mdcn_or_license, status)
         SELECT $1, $2, $3, $4, $5, '+2340000000000', $6, $7, $8, 'active'
          WHERE NOT EXISTS (
            SELECT 1 FROM ng_hospital_staff WHERE hospital_id = $1 AND user_id = $2
          )`,
        [
          facilityId,
          user.id,
          providerIds.get(account.email) || null,
          `${account.firstName} ${account.lastName}`,
          account.email,
          staffRole,
          account.demoRole,
          account.authRole === 'provider' ? `DEMO-${account.demoRole.replace(/\W+/g, '').toUpperCase()}` : null,
        ]
      );
    }

    if (['Doctor', 'Consultant'].includes(account.demoRole)) {
      await client.query(
        `INSERT INTO ng_clinician_programme_assignments
           (provider_user_id, provider_id, programme_id, facility_id, role,
            specialty, capacity, status, effective_at)
         SELECT $1, $2, $3, $4, 'remote_clinician', $5, 3, 'active', NOW()
          WHERE NOT EXISTS (
            SELECT 1 FROM ng_clinician_programme_assignments
             WHERE provider_user_id = $1 AND programme_id = $3 AND facility_id = $4
               AND role = 'remote_clinician' AND status IN ('active','paused')
          )`,
        [user.id, providerIds.get(account.email), programmeId, facilityId, account.specialty]
      );
      await client.query(
        `INSERT INTO ng_provider_credentials
           (provider_user_id, provider_id, credential_type, issuing_authority,
            credential_number_hash, country_code, jurisdiction_code, specialty,
            status, valid_from, expires_on, verified_by, verified_at, verification_notes)
         SELECT $1, $2, 'medical_practice_license', 'MDCN-DEMO',
                ENCODE(DIGEST($3, 'sha256'), 'hex'), 'NG', 'FCT', $4,
                'verified', CURRENT_DATE, CURRENT_DATE + INTERVAL '10 years', $1, NOW(),
                'Synthetic developer credential; never valid for real clinical work.'
          WHERE NOT EXISTS (
            SELECT 1 FROM ng_provider_credentials
             WHERE provider_user_id = $1 AND issuing_authority = 'MDCN-DEMO'
               AND credential_type = 'medical_practice_license' AND status <> 'revoked'
          )`,
        [user.id, providerIds.get(account.email), `DEMO-${account.demoRole}`, account.specialty]
      );
    }
  }

  const patient = accounts.find((item) => item.email === 'patient@demo.doctarx.com');
  await client.query(
    `INSERT INTO ng_programme_patient_enrollments
       (programme_id, patient_user_id, facility_id, local_patient_number,
        status, consent_status, consent_version, consented_at, consented_by,
        enrolled_by, metadata_json)
     SELECT $1, $2, $3, 'DEMO-PATIENT-001', 'active', 'granted',
            'developer-demo-v1', NOW(), $2, $2, '{"syntheticDataOnly":true}'::JSONB
      WHERE NOT EXISTS (
        SELECT 1 FROM ng_programme_patient_enrollments
         WHERE programme_id = $1 AND patient_user_id = $2
           AND status IN ('pending','active','paused','transferred')
      )`,
    [programmeId, patient.id, facilityId]
  );

  return { programmeId, facilityId, programmeFacilityId: programmeFacility.rows[0].id };
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
    const demoProgramme = await ensureDemoProgrammeScope(client, accounts);
    await client.query('COMMIT');
    return { dryRun: false, accounts, demoProgramme };
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
  ensureDemoProgrammeScope,
};
