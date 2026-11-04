/**
 * Approve Provider Script
 * Approves pending provider accounts directly
 * Run: node server/scripts/approve-provider.js
 */

require('dotenv').config();

// Force SSL mode
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function main() {
  console.log('\n=== DoctaRx Provider Approval ===\n');
  
  try {
    // Check database connection
    await pool.query('SELECT NOW()');
    console.log('✅ Database connected\n');
    
    // Get pending providers
    const { rows: pendingProviders } = await pool.query(
      `SELECT id, email, first_name, last_name, license_number, specialty, created_at
       FROM users 
       WHERE role = 'provider' AND provider_status = 'pending'
       ORDER BY created_at DESC`
    );
    
    if (pendingProviders.length === 0) {
      console.log('No pending provider applications found.\n');
      
      // Show all providers
      const { rows: allProviders } = await pool.query(
        `SELECT id, email, first_name, last_name, provider_status
         FROM users WHERE role = 'provider'`
      );
      
      if (allProviders.length > 0) {
        console.log('All providers:');
        allProviders.forEach((p) => {
          console.log(`  - ${p.email} (${p.first_name} ${p.last_name}) - Status: ${p.provider_status}`);
        });
      }
      
      process.exit(0);
    }
    
    console.log(`Found ${pendingProviders.length} pending provider(s):\n`);
    
    pendingProviders.forEach((provider, i) => {
      console.log(`${i + 1}. ${provider.email}`);
      console.log(`   Name: ${provider.first_name} ${provider.last_name}`);
      console.log(`   License: ${provider.license_number || 'N/A'}`);
      console.log(`   Specialty: ${provider.specialty || 'N/A'}`);
      console.log(`   Registered: ${new Date(provider.created_at).toLocaleString()}`);
      console.log('');
    });
    
    // Approve all pending providers
    const providerIds = pendingProviders.map(p => p.id);
    
    await pool.query(
      `UPDATE users 
       SET provider_status = 'approved', 
           is_verified = true,
           updated_at = NOW()
       WHERE id = ANY($1)`,
      [providerIds]
    );
    
    console.log(`✅ Approved ${pendingProviders.length} provider(s)!`);
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://doctarx.com';
    console.log(`\nThey can now log in at: ${baseUrl}/provider/login`);
    
  } catch (error) {
    console.error('\n❌ Error:', error.message);
  } finally {
    await pool.end();
  }
}

main();




