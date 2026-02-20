/**
 * Migration v3: Fix remaining schema issues
 */
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const db = require('../db');

async function run() {
  console.log('Starting Hive OS migration v3...\n');

  // Fix ai_agent_memory — recreate with correct columns
  try {
    await db.query('DROP TABLE IF EXISTS ai_agent_memory CASCADE');
    await db.query(`CREATE TABLE ai_agent_memory (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      agent_type VARCHAR(100),
      memory_type VARCHAR(50) DEFAULT 'working',
      memory_key VARCHAR(200),
      memory_value TEXT,
      content TEXT,
      importance FLOAT DEFAULT 0.5,
      relevance_score FLOAT DEFAULT 1.0,
      access_count INTEGER DEFAULT 0,
      last_accessed_at TIMESTAMPTZ,
      expires_at TIMESTAMPTZ,
      metadata JSONB DEFAULT '{}',
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`);
    console.log('  ✅ ai_agent_memory — recreated with memory_key/memory_value');
  } catch (e) {
    console.error('  ❌ ai_agent_memory —', e.message);
  }

  // Fix ai_event_queue — add payload column and fix id type
  try {
    // Add missing columns if they don't exist
    await db.query(`ALTER TABLE ai_event_queue
      ADD COLUMN IF NOT EXISTS payload JSONB DEFAULT '{}'`);
    console.log('  ✅ ai_event_queue — added payload column');
  } catch (e) {
    // If alter fails, recreate
    try {
      await db.query('DROP TABLE IF EXISTS ai_event_queue CASCADE');
      await db.query(`CREATE TABLE ai_event_queue (
        id BIGSERIAL PRIMARY KEY,
        event_type VARCHAR(100) NOT NULL,
        event_data JSONB DEFAULT '{}',
        payload JSONB DEFAULT '{}',
        source VARCHAR(100),
        target VARCHAR(100),
        status VARCHAR(20) DEFAULT 'pending',
        priority INTEGER DEFAULT 50,
        retry_count INTEGER DEFAULT 0,
        processed_at TIMESTAMPTZ,
        error_message TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      console.log('  ✅ ai_event_queue — recreated with BIGSERIAL id + payload');
    } catch (e2) {
      console.error('  ❌ ai_event_queue —', e2.message);
    }
  }

  // Create ai_soap_suggestions table
  try {
    await db.query(`CREATE TABLE IF NOT EXISTS ai_soap_suggestions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      session_id UUID,
      provider_id UUID,
      patient_id UUID,
      soap_section VARCHAR(50),
      suggestion TEXT,
      provider_feedback VARCHAR(20),
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`);
    console.log('  ✅ ai_soap_suggestions — OK');
  } catch (e) {
    console.error('  ❌ ai_soap_suggestions —', e.message);
  }

  console.log('\nMigration v3 complete.');
  await db.pool.end();
  process.exit(0);
}

run().catch(e => { console.error(e.message); process.exit(1); });
