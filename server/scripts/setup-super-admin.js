/**
 * Setup Super Admin Script
 * Creates a super admin account for initial platform setup
 */

require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const db = require('../db');
const bcrypt = require('bcryptjs');
const readline = require('readline');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function question(query) {
  return new Promise(resolve => rl.question(query, resolve));
}

async function setupSuperAdmin() {
  try {
    console.log('\n=== DoctaRx Super Admin Setup ===\n');
    
    // Check if super_admin role exists
    const { rows: enumCheck } = await db.query(`
      SELECT EXISTS (
        SELECT 1 FROM pg_enum 
        WHERE enumlabel = 'super_admin' 
        AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'user_role')
      ) as exists
    `);
    
    if (!enumCheck[0].exists) {
      console.log('Adding super_admin role to database...');
      await db.query(`
        DO $$ 
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM pg_enum 
            WHERE enumlabel = 'super_admin' 
            AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'user_role')
          ) THEN
            ALTER TYPE user_role ADD VALUE 'super_admin';
          END IF;
        EXCEPTION
          WHEN duplicate_object THEN null;
        END $$;
      `);
      console.log('✓ Super admin role added\n');
    }
    
    // Get user input
    const email = await question('Email: ');
    const firstName = await question('First Name: ');
    const lastName = await question('Last Name: ');
    const password = await question('Password (min 8 characters): ');
    
    if (!email || !firstName || !lastName || !password) {
      console.error('\n❌ All fields are required');
      process.exit(1);
    }
    
    if (password.length < 8) {
      console.error('\n❌ Password must be at least 8 characters');
      process.exit(1);
    }
    
    // Check if user already exists
    const { rows: existing } = await db.query(
      'SELECT id, email, role FROM users WHERE email = $1',
      [email]
    );
    
    if (existing.length > 0) {
      console.log(`\n⚠️  User with email ${email} already exists`);
      const update = await question('Update to super_admin? (y/n): ');
      
      if (update.toLowerCase() === 'y') {
        const passwordHash = await bcrypt.hash(password, 10);
        await db.query(
          `UPDATE users 
           SET role = 'super_admin', 
               password_hash = $1,
               first_name = $2,
               last_name = $3,
               is_active = true,
               is_verified = true,
               updated_at = NOW()
           WHERE email = $4
           RETURNING id, email, role`,
          [passwordHash, firstName, lastName, email]
        );
        console.log('\n✓ User updated to super_admin');
      } else {
        console.log('\nCancelled');
        process.exit(0);
      }
    } else {
      // Create new super admin
      const passwordHash = await bcrypt.hash(password, 10);
      const { rows } = await db.query(
        `INSERT INTO users (email, password_hash, first_name, last_name, role, is_active, is_verified)
         VALUES ($1, $2, $3, $4, 'super_admin', true, true)
         RETURNING id, email, role`,
        [email, passwordHash, firstName, lastName]
      );
      
      console.log('\n✓ Super admin created successfully');
      console.log(`  ID: ${rows[0].id}`);
      console.log(`  Email: ${rows[0].email}`);
      console.log(`  Role: ${rows[0].role}`);
    }
    
    console.log('\n✅ Setup complete!\n');
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Error:', error.message);
    console.error(error);
    process.exit(1);
  } finally {
    rl.close();
    await db.pool.end();
  }
}

setupSuperAdmin();

