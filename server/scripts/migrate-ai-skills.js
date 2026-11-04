/**
 * Migration: Create ai_skills table
 */
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const db = require('../db');

const CREATE_SQL = [
  'CREATE TABLE IF NOT EXISTS ai_skills (',
  '  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),',
  '  skill_name VARCHAR(100) NOT NULL UNIQUE,',
  '  display_name VARCHAR(200),',
  '  description TEXT,',
  '  category VARCHAR(50),',
  '  skill_type VARCHAR(50),',
  '  steps JSONB DEFAULT \'[]\',',
  '  input_schema JSONB DEFAULT \'{}\',',
  '  output_schema JSONB DEFAULT \'{}\',',
  '  required_capabilities JSONB DEFAULT \'[]\',',
  '  required_approvals JSONB DEFAULT \'[]\',',
  '  required_data JSONB DEFAULT \'[]\',',
  '  risk_level VARCHAR(20) DEFAULT \'medium\',',
  '  is_reversible BOOLEAN DEFAULT true,',
  '  involves_phi BOOLEAN DEFAULT false,',
  '  involves_financial BOOLEAN DEFAULT false,',
  '  involves_external BOOLEAN DEFAULT false,',
  '  source VARCHAR(50) DEFAULT \'internal\',',
  '  source_url TEXT,',
  '  version VARCHAR(20) DEFAULT \'1.0.0\',',
  '  compliance_status VARCHAR(20) DEFAULT \'pending\',',
  '  is_enabled BOOLEAN DEFAULT false,',
  '  validated_by UUID,',
  '  validated_at TIMESTAMPTZ,',
  '  compliance_notes TEXT,',
  '  created_at TIMESTAMPTZ DEFAULT NOW(),',
  '  updated_at TIMESTAMPTZ DEFAULT NOW()',
  ')',
].join('\n');

async function run() {
  try {
    await db.query(CREATE_SQL);
    console.log('SUCCESS: ai_skills table created');
    const count = await db.query('SELECT COUNT(*) FROM ai_skills');
    console.log('Current skill count:', count.rows[0].count);
  } catch (e) {
    console.error('ERROR:', e.message);
    process.exit(1);
  } finally {
    await db.pool.end();
  }
}

run();
