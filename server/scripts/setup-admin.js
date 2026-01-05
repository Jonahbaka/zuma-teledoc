/**
 * Setup Admin Script
 * Creates the initial admin user for the system
 * Run: node server/scripts/setup-admin.js
 */

require('dotenv').config();
const bcrypt = require('bcryptjs');
const readline = require('readline');

// Force SSL mode
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

const question = (prompt) => {
  return new Promise((resolve) => {
    rl.question(prompt, resolve);
  });
};

async function main() {
  console.log('\n=== Docta. Admin Setup ===\n');
  
  try {
    // Check database connection
    const { rows: dbCheck } = await pool.query('SELECT NOW()');
    console.log('✅ Database connected\n');
    
    // Check for existing admins
    const { rows: existingAdmins } = await pool.query(
      "SELECT id, email, first_name, last_name FROM users WHERE role = 'admin'"
    );
    
    if (existingAdmins.length > 0) {
      console.log('Existing admin accounts:');
      existingAdmins.forEach((admin, i) => {
        console.log(`  ${i + 1}. ${admin.email} (${admin.first_name} ${admin.last_name})`);
      });
      console.log('');
    }
    
    // Get admin details
    const email = await question('Admin Email: ');
    const password = await question('Admin Password: ');
    const firstName = await question('First Name: ');
    const lastName = await question('Last Name: ');
    
    // Validate
    if (!email || !password || !firstName || !lastName) {
      console.log('\n❌ All fields are required');
      process.exit(1);
    }
    
    if (password.length < 8) {
      console.log('\n❌ Password must be at least 8 characters');
      process.exit(1);
    }
    
    // Check if email exists
    const { rows: existing } = await pool.query(
      'SELECT id FROM users WHERE email = $1',
      [email]
    );
    
    if (existing.length > 0) {
      console.log('\n❌ An account with this email already exists');
      process.exit(1);
    }
    
    // Hash password
    const passwordHash = await bcrypt.hash(password, 12);
    
    // Create admin
    const { rows } = await pool.query(
      `INSERT INTO users (
        email, password_hash, role, first_name, last_name,
        is_active, is_verified
      ) VALUES ($1, $2, 'admin', $3, $4, true, true)
      RETURNING id, email`,
      [email, passwordHash, firstName, lastName]
    );
    
    // Create subscription
    await pool.query(
      `INSERT INTO subscriptions (user_id, tier, status) VALUES ($1, 'enterprise', 'active')`,
      [rows[0].id]
    );
    
    console.log('\n✅ Admin account created successfully!');
    console.log(`   Email: ${email}`);
    console.log(`   Role: admin`);
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://doctarx.com';
    console.log(`\n🔗 Login at: ${baseUrl}/secure/admin`);
    console.log(`🔗 Admin Portal: ${baseUrl}/admin/dashboard`);
    
  } catch (error) {
    console.error('\n❌ Error:', error.message);
  } finally {
    rl.close();
    await pool.end();
  }
}

main();




