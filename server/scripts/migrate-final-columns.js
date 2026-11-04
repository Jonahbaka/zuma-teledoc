/**
 * Migration: Final column additions
 */
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const db = require('../db');

async function safeAlter(sql, desc) {
  try {
    await db.query(sql);
    console.log(`  ✅ ${desc}`);
  } catch (e) {
    if (e.message.includes('already exists')) {
      console.log(`  ⏭  ${desc} (exists)`);
    } else {
      console.error(`  ❌ ${desc} — ${e.message}`);
    }
  }
}

async function run() {
  await safeAlter(`ALTER TABLE ml_models ADD COLUMN IF NOT EXISTS model_weights JSONB DEFAULT '{}'`, 'ml_models.model_weights');
  await safeAlter(`ALTER TABLE ml_models ADD COLUMN IF NOT EXISTS training_params JSONB DEFAULT '{}'`, 'ml_models.training_params');
  await safeAlter(`ALTER TABLE ml_models ADD COLUMN IF NOT EXISTS evaluation_metrics JSONB DEFAULT '{}'`, 'ml_models.evaluation_metrics');
  await safeAlter(`ALTER TABLE ai_agent_memory ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW()`, 'ai_agent_memory.updated_at');

  console.log('\nFinal column migration done.');
  await db.pool.end();
  process.exit(0);
}

run().catch(e => { console.error(e.message); process.exit(1); });
