/**
 * Migration v4: Final column fixes for Hive OS tables
 */
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const db = require('../db');

async function safeAlter(table, sql, desc) {
  try {
    await db.query(sql);
    console.log(`  ✅ ${desc}`);
  } catch (e) {
    if (e.message.includes('already exists')) {
      console.log(`  ⏭  ${desc} (already exists)`);
    } else {
      console.error(`  ❌ ${desc} — ${e.message}`);
    }
  }
}

async function run() {
  console.log('Starting Hive OS migration v4...\n');

  // ml_models — add algorithm column
  await safeAlter('ml_models',
    `ALTER TABLE ml_models ADD COLUMN IF NOT EXISTS algorithm VARCHAR(100)`,
    'ml_models.algorithm');
  await safeAlter('ml_models',
    `ALTER TABLE ml_models ADD COLUMN IF NOT EXISTS features JSONB DEFAULT '[]'`,
    'ml_models.features');
  await safeAlter('ml_models',
    `ALTER TABLE ml_models ADD COLUMN IF NOT EXISTS hyperparameters JSONB DEFAULT '{}'`,
    'ml_models.hyperparameters');
  await safeAlter('ml_models',
    `ALTER TABLE ml_models ADD COLUMN IF NOT EXISTS training_data_info JSONB DEFAULT '{}'`,
    'ml_models.training_data_info');

  // ai_event_queue — add severity column + fix id to BIGSERIAL
  // The table may have UUID id - need to recreate with BIGSERIAL
  try {
    await db.query('DROP TABLE IF EXISTS ai_event_queue CASCADE');
    await db.query(`CREATE TABLE ai_event_queue (
      id BIGSERIAL PRIMARY KEY,
      event_type VARCHAR(100) NOT NULL,
      event_data JSONB DEFAULT '{}',
      payload JSONB DEFAULT '{}',
      source VARCHAR(100),
      target VARCHAR(100),
      severity VARCHAR(20) DEFAULT 'info',
      status VARCHAR(20) DEFAULT 'pending',
      priority INTEGER DEFAULT 50,
      retry_count INTEGER DEFAULT 0,
      processed_at TIMESTAMPTZ,
      error_message TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`);
    console.log('  ✅ ai_event_queue — recreated with BIGSERIAL + severity');
  } catch (e) {
    console.error('  ❌ ai_event_queue —', e.message);
  }

  // ai_agent_memory — add source column
  await safeAlter('ai_agent_memory',
    `ALTER TABLE ai_agent_memory ADD COLUMN IF NOT EXISTS source VARCHAR(100)`,
    'ai_agent_memory.source');
  await safeAlter('ai_agent_memory',
    `ALTER TABLE ai_agent_memory ADD COLUMN IF NOT EXISTS tags JSONB DEFAULT '[]'`,
    'ai_agent_memory.tags');

  console.log('\nMigration v4 complete.');
  await db.pool.end();
  process.exit(0);
}

run().catch(e => { console.error(e.message); process.exit(1); });
