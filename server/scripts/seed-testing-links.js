/**
 * Seed Testing Access Links
 * Generates initial time-limited links for demo/testing
 */

const { v4: uuidv4 } = require('uuid');
const db = require('../server/db');
const crypto = require('crypto');

async function seedTestingLinks() {
  console.log('🚀 Seeding testing access links...');
  
  try {
    // Get an admin user to be the creator
    const { rows: admins } = await db.query(
      "SELECT id FROM users WHERE role IN ('admin', 'super_admin') LIMIT 1"
    );
    
    if (admins.length === 0) {
      console.error('❌ No admin user found. Please create an admin user first.');
      process.exit(1);
    }
    
    const adminId = admins[0].id;
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://doctarx.com';
    
    const linksToCreate = [
      {
        type: 'provider',
        label: 'Demo Provider Link (Live)',
        desc: 'Full access for provider testing on doctarx.com',
        uses: 50,
        hours: 720, // 30 days
        tier: 'platinum'
      },
      {
        type: 'patient',
        label: 'Demo Patient Link (Live)',
        desc: 'Full access for patient testing on doctarx.com',
        uses: 100,
        hours: 720, // 30 days
        tier: 'gold'
      }
    ];
    
    for (const linkData of linksToCreate) {
      const token = crypto.randomBytes(32).toString('hex');
      const expiresAt = new Date(Date.now() + linkData.hours * 60 * 60 * 1000);
      
      const { rows } = await db.query(`
        INSERT INTO testing_access_links (
          token, link_type, label, description, 
          max_uses, expires_at, created_by,
          bypass_payment, bypass_subscription, grant_tier
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, true, true, $8)
        ON CONFLICT (token) DO NOTHING
        RETURNING id, token
      `, [
        token, linkData.type, linkData.label, linkData.desc,
        linkData.uses, expiresAt, adminId, linkData.tier
      ]);
      
      if (rows.length > 0) {
        const link = rows[0];
        console.log(`\n✅ Created ${linkData.type} link:`);
        console.log(`   Label: ${linkData.label}`);
        console.log(`   Access URL:   ${baseUrl}/access/${link.token}`);
        console.log(`   Login URL:    ${baseUrl}/${linkData.type}/login?test_token=${link.token}`);
        console.log(`   Register URL: ${baseUrl}/${linkData.type}/register?test_token=${link.token}`);
        console.log(`   Expires:      ${expiresAt.toLocaleString()}`);
      }
    }
    
    console.log('\n✨ Testing links seeded successfully!');
  } catch (error) {
    console.error('❌ Error seeding testing links:', error.message);
  } finally {
    process.exit();
  }
}

seedTestingLinks();
