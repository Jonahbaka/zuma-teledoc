/**
 * Migration v2: Fix ai_agents schema + create ai_capability_adapters
 */
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const db = require('../db');

async function run() {
  console.log('Starting Hive OS migration v2...\n');

  // Fix ai_agents — drop and recreate with correct full schema
  try {
    await db.query('DROP TABLE IF EXISTS ai_agents CASCADE');
    await db.query(`CREATE TABLE ai_agents (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      agent_type VARCHAR(100) NOT NULL UNIQUE,
      agent_name VARCHAR(200),
      display_name VARCHAR(200),
      description TEXT,
      system_prompt TEXT,
      persona TEXT,
      status VARCHAR(20) DEFAULT 'active',
      capabilities JSONB DEFAULT '[]',
      tool_permissions JSONB DEFAULT '[]',
      sandbox_config JSONB DEFAULT '{}',
      autonomy_level VARCHAR(20) DEFAULT 'supervised',
      config JSONB DEFAULT '{}',
      last_active_at TIMESTAMPTZ,
      message_count INTEGER DEFAULT 0,
      error_count INTEGER DEFAULT 0,
      metadata JSONB DEFAULT '{}',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )`);
    console.log('  ✅ ai_agents — recreated with correct schema');
  } catch (e) {
    console.error('  ❌ ai_agents —', e.message);
  }

  // Create ai_capability_adapters
  try {
    await db.query(`CREATE TABLE IF NOT EXISTS ai_capability_adapters (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      adapter_name VARCHAR(200) NOT NULL UNIQUE,
      display_name VARCHAR(200),
      adapter_type VARCHAR(50),
      supported_intents JSONB DEFAULT '[]',
      is_enabled BOOLEAN DEFAULT true,
      config JSONB DEFAULT '{}',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )`);
    console.log('  ✅ ai_capability_adapters — OK');
  } catch (e) {
    console.error('  ❌ ai_capability_adapters —', e.message);
  }

  // Create ai_agent_memory if not exists (persistent memory)
  try {
    await db.query(`CREATE TABLE IF NOT EXISTS ai_agent_memory (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      agent_type VARCHAR(100),
      memory_type VARCHAR(50) DEFAULT 'working',
      content TEXT,
      embedding VECTOR(1536),
      relevance_score FLOAT DEFAULT 1.0,
      access_count INTEGER DEFAULT 0,
      last_accessed_at TIMESTAMPTZ,
      expires_at TIMESTAMPTZ,
      metadata JSONB DEFAULT '{}',
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`);
    console.log('  ✅ ai_agent_memory — OK');
  } catch (e) {
    // Vector extension may not be installed; create without it
    try {
      await db.query(`CREATE TABLE IF NOT EXISTS ai_agent_memory (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        agent_type VARCHAR(100),
        memory_type VARCHAR(50) DEFAULT 'working',
        content TEXT,
        relevance_score FLOAT DEFAULT 1.0,
        access_count INTEGER DEFAULT 0,
        last_accessed_at TIMESTAMPTZ,
        expires_at TIMESTAMPTZ,
        metadata JSONB DEFAULT '{}',
        created_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      console.log('  ✅ ai_agent_memory — OK (no vector extension)');
    } catch (e2) {
      console.error('  ❌ ai_agent_memory —', e2.message);
    }
  }

  // Create ai_agent_results if not exists
  try {
    await db.query(`CREATE TABLE IF NOT EXISTS ai_agent_results (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      agent_type VARCHAR(100),
      result_type VARCHAR(100),
      title VARCHAR(500),
      agent_name VARCHAR(200),
      content TEXT,
      metrics JSONB DEFAULT '{}',
      tags JSONB DEFAULT '[]',
      priority INTEGER DEFAULT 50,
      reviewed BOOLEAN DEFAULT false,
      reviewed_by UUID,
      reviewed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`);
    console.log('  ✅ ai_agent_results — OK');
  } catch (e) {
    console.error('  ❌ ai_agent_results —', e.message);
  }

  console.log('\nMigration v2 complete.');
  await db.pool.end();
  process.exit(0);
}

run().catch(e => { console.error(e.message); process.exit(1); });
