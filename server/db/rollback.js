/**
 * Database Rollback Script
 * Rolls back the last migration
 */

require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const rollbackQueries = {
  '015_create_updated_at_trigger': `
    DROP TRIGGER IF EXISTS update_users_updated_at ON users;
    DROP TRIGGER IF EXISTS update_appointments_updated_at ON appointments;
    DROP TRIGGER IF EXISTS update_medical_records_updated_at ON medical_records;
    DROP TRIGGER IF EXISTS update_visits_updated_at ON visits;
    DROP TRIGGER IF EXISTS update_subscriptions_updated_at ON subscriptions;
    DROP TRIGGER IF EXISTS update_provider_schedules_updated_at ON provider_schedules;
    DROP FUNCTION IF EXISTS update_updated_at_column();
  `,
  '014_create_migrations_table': 'DROP TABLE IF EXISTS migrations CASCADE;',
  '013_create_provider_time_off_table': 'DROP TABLE IF EXISTS provider_time_off CASCADE;',
  '012_create_provider_schedule_table': 'DROP TABLE IF EXISTS provider_schedules CASCADE;',
  '011_create_audit_logs_table': 'DROP TABLE IF EXISTS audit_logs CASCADE;',
  '010_create_subscriptions_table': 'DROP TABLE IF EXISTS subscriptions CASCADE;',
  '009_create_notifications_table': 'DROP TABLE IF EXISTS notifications CASCADE;',
  '008_create_messages_table': 'DROP TABLE IF EXISTS messages CASCADE;',
  '007_create_visits_table': 'DROP TABLE IF EXISTS visits CASCADE;',
  '006_create_medical_records_table': 'DROP TABLE IF EXISTS medical_records CASCADE;',
  '005_create_appointments_table': 'DROP TABLE IF EXISTS appointments CASCADE;',
  '004_create_refresh_tokens_table': 'DROP TABLE IF EXISTS refresh_tokens CASCADE;',
  '003_create_users_table': 'DROP TABLE IF EXISTS users CASCADE;',
  '002_create_enums': `
    DROP TYPE IF EXISTS audit_action CASCADE;
    DROP TYPE IF EXISTS notification_type CASCADE;
    DROP TYPE IF EXISTS message_status CASCADE;
    DROP TYPE IF EXISTS subscription_status CASCADE;
    DROP TYPE IF EXISTS subscription_tier CASCADE;
    DROP TYPE IF EXISTS provider_status CASCADE;
    DROP TYPE IF EXISTS appointment_status CASCADE;
    DROP TYPE IF EXISTS user_role CASCADE;
  `,
  '001_create_extensions': `
    DROP EXTENSION IF EXISTS "pgcrypto";
    DROP EXTENSION IF EXISTS "uuid-ossp";
  `
};

async function rollback(count = 1) {
  const client = await pool.connect();
  
  try {
    console.log('🔄 Starting database rollback...\n');
    
    // Get last executed migrations
    const { rows: migrations } = await client.query(
      'SELECT name FROM migrations ORDER BY id DESC LIMIT $1',
      [count]
    );
    
    if (migrations.length === 0) {
      console.log('No migrations to rollback.');
      return;
    }
    
    for (const migration of migrations) {
      const rollbackQuery = rollbackQueries[migration.name];
      
      if (!rollbackQuery) {
        console.log(`⚠️  No rollback query for: ${migration.name}`);
        continue;
      }
      
      console.log(`🔙 Rolling back: ${migration.name}`);
      
      await client.query('BEGIN');
      
      try {
        await client.query(rollbackQuery);
        await client.query(
          'DELETE FROM migrations WHERE name = $1',
          [migration.name]
        );
        await client.query('COMMIT');
        console.log(`✅ Rolled back: ${migration.name}\n`);
      } catch (error) {
        await client.query('ROLLBACK');
        console.error(`❌ Rollback failed: ${migration.name}`);
        console.error(`   Error: ${error.message}\n`);
        throw error;
      }
    }
    
    console.log('==========================================');
    console.log('✅ Rollback complete!');
    console.log('==========================================\n');
    
  } catch (error) {
    console.error('Rollback failed:', error);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

// Parse command line argument for number of migrations to rollback
const count = parseInt(process.argv[2]) || 1;
rollback(count);

