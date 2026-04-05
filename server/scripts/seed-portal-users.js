/**
 * Portal account reconciler.
 *
 * Safely aligns the production patient/provider/admin login accounts with the
 * expected role -> email mapping without deleting unrelated users or data.
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

const bcrypt = require('bcryptjs');
const db = require('../db');

const BCRYPT_ROUNDS = 12;
const SHARED_PASSWORD = 'password1';

const PORTAL_ACCOUNTS = [
  {
    key: 'patient',
    role: 'patient',
    targetEmail: 'jonahbaka00@gmail.com',
    legacyEmails: ['joahbaka00@gmail.com'],
    firstName: 'Jonah',
    lastName: 'Baka',
    accessLevel: 'gold_monthly',
    tier: 'gold',
    country: 'Nigeria',
  },
  {
    key: 'provider',
    role: 'provider',
    targetEmail: 'approversweb@gmail.com',
    legacyEmails: ['iamjonah.baka@gmail.com'],
    firstName: 'Jonah',
    lastName: 'Baka',
    accessLevel: 'gold_monthly',
    tier: 'gold',
    country: 'Nigeria',
    providerStatus: 'approved',
    specialty: 'General Practice',
    credentials: 'MD',
    npiNumber: '1234567890',
    licenseNumber: 'MD-2024-001',
    licenseState: 'Lagos',
    bio: 'Board-certified general practitioner with expertise in telemedicine.',
  },
  {
    key: 'admin',
    role: 'admin',
    targetEmail: 'iamjonah.baka@gmail.com',
    legacyEmails: ['approversweb@gmail.com'],
    firstName: 'Jonah',
    lastName: 'Baka',
    accessLevel: 'gold_monthly',
    tier: 'gold',
    country: 'Nigeria',
  },
  {
    key: 'pharmacy',
    role: 'pharmacy',
    targetEmail: 'evolvedu@outlook.com',
    legacyEmails: [],
    firstName: 'DoctaRx',
    lastName: 'Pharmacy',
    accessLevel: 'gold_monthly',
    tier: 'gold',
    country: 'United States',
  },
];

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function unique(values) {
  return [...new Set(values)];
}

function buildLookupEmails() {
  return unique(
    PORTAL_ACCOUNTS.flatMap((account) => [account.targetEmail, ...account.legacyEmails]).map(normalizeEmail)
  );
}

function selectCandidate(rows, account) {
  const targetEmail = normalizeEmail(account.targetEmail);
  const legacyEmails = new Set(account.legacyEmails.map(normalizeEmail));

  return (
    rows.find((row) => row.role === account.role && normalizeEmail(row.email) === targetEmail) ||
    rows.find((row) => row.role === account.role && legacyEmails.has(normalizeEmail(row.email))) ||
    rows.find((row) => normalizeEmail(row.email) === targetEmail) ||
    rows.find((row) => legacyEmails.has(normalizeEmail(row.email))) ||
    null
  );
}

async function ensureSubscription(client, userId, tier) {
  const { rows } = await client.query(
    `SELECT id
       FROM subscriptions
      WHERE user_id = $1
      ORDER BY updated_at DESC NULLS LAST, created_at DESC
      LIMIT 1`,
    [userId]
  );

  if (rows.length === 0) {
    await client.query(
      `INSERT INTO subscriptions (
         user_id, tier, status, current_period_start, current_period_end
       ) VALUES ($1, $2, 'active', NOW(), NOW() + INTERVAL '30 days')`,
      [userId, tier]
    );
    return;
  }

  await client.query(
    `UPDATE subscriptions
        SET tier = $2,
            status = 'active',
            current_period_start = COALESCE(current_period_start, NOW()),
            current_period_end = COALESCE(current_period_end, NOW() + INTERVAL '30 days'),
            updated_at = NOW()
      WHERE id = $1`,
    [rows[0].id, tier]
  );
}

async function stageEmailMove(client, rowId, accountKey) {
  const placeholderEmail = `portal-reconcile+${accountKey}-${Date.now()}@doctarx.invalid`;
  await client.query(
    `UPDATE users
        SET email = $1,
            updated_at = NOW()
      WHERE id = $2`,
    [placeholderEmail, rowId]
  );
}

async function updateExistingUser(client, rowId, account, passwordHash) {
  await client.query(
    `UPDATE users
        SET email = $1,
            password_hash = $2,
            role = $3,
            first_name = $4,
            last_name = $5,
            is_active = TRUE,
            is_verified = TRUE,
            email_verified_at = COALESCE(email_verified_at, NOW()),
            failed_login_attempts = 0,
            locked_until = NULL,
            access_level = $6,
            country = $7,
            hipaa_consent_at = COALESCE(hipaa_consent_at, NOW()),
            terms_accepted_at = COALESCE(terms_accepted_at, NOW()),
            updated_at = NOW()
      WHERE id = $8`,
    [
      normalizeEmail(account.targetEmail),
      passwordHash,
      account.role,
      account.firstName,
      account.lastName,
      account.accessLevel,
      account.country,
      rowId,
    ]
  );

  if (account.role === 'provider') {
    await client.query(
      `UPDATE users
          SET provider_status = $2,
              specialty = $3,
              credentials = $4,
              npi_number = $5,
              license_number = $6,
              license_state = $7,
              bio = $8,
              updated_at = NOW()
        WHERE id = $1`,
      [
        rowId,
        account.providerStatus,
        account.specialty,
        account.credentials,
        account.npiNumber,
        account.licenseNumber,
        account.licenseState,
        account.bio,
      ]
    );
    return;
  }

  await client.query(
    `UPDATE users
        SET provider_status = NULL,
            updated_at = NOW()
      WHERE id = $1`,
    [rowId]
  );
}

async function insertNewUser(client, account, passwordHash) {
  const { rows } = await client.query(
    `INSERT INTO users (
       email, password_hash, role, first_name, last_name,
       is_active, is_verified, email_verified_at,
       hipaa_consent_at, terms_accepted_at,
       access_level, provider_status, specialty, credentials,
       npi_number, license_number, license_state, bio,
       failed_login_attempts, country,
       created_at, updated_at
     ) VALUES (
       $1, $2, $3, $4, $5,
       TRUE, TRUE, NOW(),
       NOW(), NOW(),
       $6, $7, $8, $9,
       $10, $11, $12, $13,
       0, $14,
       NOW(), NOW()
     )
     RETURNING id`,
    [
      normalizeEmail(account.targetEmail),
      passwordHash,
      account.role,
      account.firstName,
      account.lastName,
      account.accessLevel,
      account.role === 'provider' ? account.providerStatus : null,
      account.role === 'provider' ? account.specialty : null,
      account.role === 'provider' ? account.credentials : null,
      account.role === 'provider' ? account.npiNumber : null,
      account.role === 'provider' ? account.licenseNumber : null,
      account.role === 'provider' ? account.licenseState : null,
      account.role === 'provider' ? account.bio : null,
      account.country,
    ]
  );

  return rows[0].id;
}

async function reconcile() {
  console.log('Reconciling portal accounts...\n');

  const health = await db.healthCheck();
  if (!health.healthy) {
    throw new Error(`Database not reachable: ${health.error}`);
  }

  console.log(`Database connected: ${health.timestamp}\n`);

  const client = await db.getClient();

  try {
    await client.query('BEGIN');

    const lookupEmails = buildLookupEmails();
    const { rows: existingRows } = await client.query(
      `SELECT id, email, role, first_name, last_name
         FROM users
        WHERE email = ANY($1::text[])
        ORDER BY created_at ASC`,
      [lookupEmails]
    );

    const selectedRows = new Map();
    for (const account of PORTAL_ACCOUNTS) {
      const candidate = selectCandidate(existingRows, account);
      if (candidate) {
        selectedRows.set(account.key, candidate);
      }
    }

    for (const account of PORTAL_ACCOUNTS) {
      const candidate = selectedRows.get(account.key);
      if (candidate && normalizeEmail(candidate.email) !== normalizeEmail(account.targetEmail)) {
        await stageEmailMove(client, candidate.id, account.key);
      }
    }

    for (const account of PORTAL_ACCOUNTS) {
      const passwordHash = await bcrypt.hash(SHARED_PASSWORD, BCRYPT_ROUNDS);
      const candidate = selectedRows.get(account.key);
      let userId = candidate?.id || null;

      if (userId) {
        await updateExistingUser(client, userId, account, passwordHash);
      } else {
        userId = await insertNewUser(client, account, passwordHash);
      }

      await ensureSubscription(client, userId, account.tier);
    }

    await client.query('COMMIT');

    const { rows: finalRows } = await db.query(
      `SELECT email, role, first_name, last_name, provider_status, access_level
         FROM users
        WHERE email = ANY($1::text[])
        ORDER BY role ASC`,
      [PORTAL_ACCOUNTS.map((account) => normalizeEmail(account.targetEmail))]
    );

    console.log('Portal accounts reconciled successfully.\n');
    console.log(`Shared password: ${SHARED_PASSWORD}\n`);

    for (const row of finalRows) {
      const providerSuffix = row.provider_status ? ` | provider_status=${row.provider_status}` : '';
      console.log(
        `${String(row.role).toUpperCase().padEnd(9)} ${row.email} | ${row.first_name} ${row.last_name} | access=${row.access_level}${providerSuffix}`
      );
    }
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

reconcile()
  .catch((error) => {
    console.error('\nPortal reconciliation failed:', error.message);
    console.error(error.stack);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.close();
  });
