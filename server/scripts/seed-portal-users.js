/**
 * Seed Portal Users
 * Creates admin, patient, and provider accounts with direct DB insertion
 * Bypasses registration validation for seeding purposes
 */

require('dotenv').config();
const bcrypt = require('bcryptjs');
const db = require('../db');

const BCRYPT_ROUNDS = 12;

const USERS = [
  {
    email: 'approversweb@gmail.com',
    password: 'password1',
    firstName: 'Admin',
    lastName: 'Approver',
    role: 'admin',
    accessLevel: 'gold_monthly',
  },
  {
    email: 'jonahbaka00@gmail.com',
    password: 'password1',
    firstName: 'Jonah',
    lastName: 'Baka',
    role: 'patient',
    accessLevel: 'gold_monthly',
  },
  {
    email: 'iamjonah.baka@gmail.com',
    password: 'password1',
    firstName: 'Dr. Jonah',
    lastName: 'Baka',
    role: 'provider',
    accessLevel: 'gold_monthly',
    providerStatus: 'approved',
    specialty: 'General Practice',
    credentials: 'MD',
    npiNumber: '1234567890',
    licenseNumber: 'MD-2024-001',
    licenseState: 'Lagos',
    bio: 'Board-certified general practitioner with expertise in telemedicine.',
  },
];

async function seed() {
  console.log('Starting portal user seeding...\n');

  try {
    // Test connection
    const health = await db.healthCheck();
    if (!health.healthy) {
      console.error('Database not reachable:', health.error);
      process.exit(1);
    }
    console.log('Database connected:', health.timestamp);

    // Step 1: Find and remove existing test/dev users (excluding the new ones we're about to create)
    // First, get all existing users to show what we're removing
    const existing = await db.query(
      `SELECT id, email, role, first_name, last_name, created_at FROM users ORDER BY created_at`
    );
    console.log(`\nFound ${existing.rows.length} existing user(s):`);
    existing.rows.forEach(u => {
      console.log(`  - ${u.email} (${u.role}) — ${u.first_name} ${u.last_name}`);
    });

    if (existing.rows.length > 0) {
      const existingIds = existing.rows.map(u => u.id);

      // Clean up foreign key references before deleting users
      console.log('\nCleaning up related records...');

      const cleanupTables = [
        { table: 'refresh_tokens', column: 'user_id' },
        { table: 'notifications', column: 'user_id' },
        { table: 'messages', column: 'sender_id' },
        { table: 'messages', column: 'receiver_id' },
        { table: 'audit_logs', column: 'user_id' },
        { table: 'appointments', column: 'patient_id' },
        { table: 'appointments', column: 'provider_id' },
        { table: 'medical_records', column: 'patient_id' },
        { table: 'medical_records', column: 'provider_id' },
        { table: 'visits', column: 'patient_id' },
        { table: 'visits', column: 'provider_id' },
        { table: 'subscriptions', column: 'user_id' },
        { table: 'stripe_customers', column: 'user_id' },
        { table: 'insurance_cards', column: 'user_id' },
        { table: 'provider_schedules', column: 'provider_id' },
        { table: 'provider_time_off', column: 'provider_id' },
        { table: 'prescriptions', column: 'patient_id' },
        { table: 'prescriptions', column: 'provider_id' },
        { table: 'prior_authorizations', column: 'patient_id' },
        { table: 'claims', column: 'patient_id' },
        { table: 'triage_sessions', column: 'patient_id' },
        { table: 'clinical_encounters', column: 'patient_id' },
        { table: 'clinical_encounters', column: 'provider_id' },
        { table: 'crm_contacts', column: 'user_id' },
        // NG tables
        { table: 'ng_pharmacies', column: 'owner_user_id' },
        { table: 'ng_pharmacies', column: 'verified_by' },
        { table: 'ng_prescriptions', column: 'patient_user_id' },
        { table: 'ng_prescriptions', column: 'verified_by_pharmacist' },
        { table: 'ng_orders', column: 'patient_user_id' },
        { table: 'ng_compliance_audit_log', column: 'actor_user_id' },
        { table: 'ng_pharmacy_reviews', column: 'patient_user_id' },
      ];

      for (const { table, column } of cleanupTables) {
        try {
          const result = await db.query(
            `DELETE FROM ${table} WHERE ${column} = ANY($1::uuid[])`,
            [existingIds]
          );
          if (result.rowCount > 0) {
            console.log(`  Cleaned ${result.rowCount} row(s) from ${table}`);
          }
        } catch (err) {
          // Table might not exist yet — that's fine
          if (!err.message.includes('does not exist')) {
            console.log(`  Skipped ${table}.${column}: ${err.message.substring(0, 60)}`);
          }
        }
      }

      // Delete all existing users
      const deleted = await db.query('DELETE FROM users RETURNING email');
      console.log(`\nRemoved ${deleted.rowCount} existing user(s)`);
    }

    // Step 2: Create new users
    console.log('\nCreating new portal users...\n');

    for (const user of USERS) {
      const passwordHash = await bcrypt.hash(user.password, BCRYPT_ROUNDS);

      const result = await db.query(
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
          0, 'Nigeria',
          NOW(), NOW()
        ) RETURNING id, email, role, access_level, provider_status`,
        [
          user.email,
          passwordHash,
          user.role,
          user.firstName,
          user.lastName,
          user.accessLevel || 'gold_monthly',
          user.providerStatus || null,
          user.specialty || null,
          user.credentials || null,
          user.npiNumber || null,
          user.licenseNumber || null,
          user.licenseState || null,
          user.bio || null,
        ]
      );

      const created = result.rows[0];
      console.log(`  ✓ ${created.role.toUpperCase().padEnd(10)} ${created.email}`);
      console.log(`    ID: ${created.id}`);
      console.log(`    Access: ${created.access_level}${created.provider_status ? ` | Provider: ${created.provider_status}` : ''}`);
      console.log('');

      // Create a free subscription record for each user
      try {
        await db.query(
          `INSERT INTO subscriptions (user_id, tier, status, start_date)
           VALUES ($1, 'gold', 'active', NOW())
           ON CONFLICT DO NOTHING`,
          [created.id]
        );
      } catch (err) {
        // subscriptions table might have different schema
      }
    }

    console.log('========================================');
    console.log('All portal users created successfully!');
    console.log('========================================\n');
    console.log('Login credentials (same password for all):');
    console.log('  Password: password1\n');
    console.log('Portals:');
    console.log('  Admin:    approversweb@gmail.com');
    console.log('  Patient:  jonahbaka00@gmail.com');
    console.log('  Provider: iamjonah.baka@gmail.com');
    console.log('');

  } catch (err) {
    console.error('\nSeed failed:', err.message);
    console.error(err.stack);
    process.exit(1);
  } finally {
    await db.close();
  }
}

seed();
