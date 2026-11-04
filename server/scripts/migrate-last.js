require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const db = require('../db');
async function run() {
  const alters = [
    [`ALTER TABLE ml_models ADD COLUMN IF NOT EXISTS feature_names JSONB DEFAULT '[]'`, 'ml_models.feature_names'],
    [`ALTER TABLE ml_models ADD COLUMN IF NOT EXISTS target_variable VARCHAR(200)`, 'ml_models.target_variable'],
    [`ALTER TABLE ai_agent_memory ADD COLUMN IF NOT EXISTS conversation_id UUID`, 'ai_agent_memory.conversation_id'],
  ];
  for (const [sql, desc] of alters) {
    try { await db.query(sql); console.log('  OK', desc); }
    catch(e) { console.log('  SKIP', desc, e.message.substring(0, 60)); }
  }
  try {
    await db.query('CREATE UNIQUE INDEX IF NOT EXISTS uq_agent_memory_key ON ai_agent_memory (agent_type, memory_key) WHERE memory_key IS NOT NULL');
    console.log('  OK unique index on ai_agent_memory');
  } catch(e) { console.log('  SKIP unique index', e.message.substring(0, 60)); }
  console.log('Done.');
  await db.pool.end();
}
run().catch(e => { console.error(e.message); process.exit(1); });
