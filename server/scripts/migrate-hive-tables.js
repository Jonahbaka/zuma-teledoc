/**
 * Migration: Create all missing Hive OS tables
 * Creates ai_audit_log, ai_governance_policies, ai_event_queue, ai_intents,
 * ai_proposals, ai_agents, ml_models, ml_feature_definitions
 */
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const db = require('../db');

const MIGRATIONS = [
  {
    name: 'ai_audit_log',
    sql: `CREATE TABLE IF NOT EXISTS ai_audit_log (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      action_type VARCHAR(100),
      action_details JSONB DEFAULT '{}',
      skill_id UUID,
      agent_type VARCHAR(50),
      agent_id VARCHAR(100),
      outcome VARCHAR(50),
      error_message TEXT,
      duration_ms INTEGER,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`
  },
  {
    name: 'ai_governance_policies',
    sql: `CREATE TABLE IF NOT EXISTS ai_governance_policies (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      policy_name VARCHAR(200) NOT NULL UNIQUE,
      description TEXT,
      policy_type VARCHAR(50),
      rules JSONB DEFAULT '{}',
      is_enabled BOOLEAN DEFAULT true,
      priority INTEGER DEFAULT 50,
      created_by UUID,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )`
  },
  {
    name: 'ai_event_queue',
    sql: `CREATE TABLE IF NOT EXISTS ai_event_queue (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      event_type VARCHAR(100) NOT NULL,
      event_data JSONB DEFAULT '{}',
      source VARCHAR(100),
      target VARCHAR(100),
      status VARCHAR(20) DEFAULT 'pending',
      priority INTEGER DEFAULT 50,
      retry_count INTEGER DEFAULT 0,
      processed_at TIMESTAMPTZ,
      error_message TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`
  },
  {
    name: 'ai_intents',
    sql: `CREATE TABLE IF NOT EXISTS ai_intents (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      intent_name VARCHAR(200) NOT NULL,
      description TEXT,
      trigger_patterns JSONB DEFAULT '[]',
      agent_type VARCHAR(50),
      skill_name VARCHAR(100),
      parameters JSONB DEFAULT '{}',
      is_enabled BOOLEAN DEFAULT true,
      priority INTEGER DEFAULT 50,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )`
  },
  {
    name: 'ai_proposals',
    sql: `CREATE TABLE IF NOT EXISTS ai_proposals (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      proposal_type VARCHAR(100),
      title VARCHAR(500),
      description TEXT,
      proposed_by VARCHAR(100),
      proposed_action JSONB DEFAULT '{}',
      status VARCHAR(20) DEFAULT 'pending',
      votes_for INTEGER DEFAULT 0,
      votes_against INTEGER DEFAULT 0,
      approved_by UUID,
      approved_at TIMESTAMPTZ,
      rejection_reason TEXT,
      executed_at TIMESTAMPTZ,
      expires_at TIMESTAMPTZ,
      metadata JSONB DEFAULT '{}',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )`
  },
  {
    name: 'ai_agents',
    sql: `CREATE TABLE IF NOT EXISTS ai_agents (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      agent_name VARCHAR(200) NOT NULL,
      agent_type VARCHAR(50) NOT NULL,
      display_name VARCHAR(200),
      persona TEXT,
      status VARCHAR(20) DEFAULT 'active',
      capabilities JSONB DEFAULT '[]',
      tool_permissions JSONB DEFAULT '[]',
      sandbox_config JSONB DEFAULT '{}',
      last_active_at TIMESTAMPTZ,
      message_count INTEGER DEFAULT 0,
      error_count INTEGER DEFAULT 0,
      metadata JSONB DEFAULT '{}',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )`
  },
  {
    name: 'ml_models',
    sql: `CREATE TABLE IF NOT EXISTS ml_models (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      model_name VARCHAR(200) NOT NULL,
      model_version VARCHAR(50),
      model_type VARCHAR(100),
      description TEXT,
      parameters JSONB DEFAULT '{}',
      performance_metrics JSONB DEFAULT '{}',
      is_active BOOLEAN DEFAULT false,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(model_name, model_version)
    )`
  },
  {
    name: 'ml_feature_definitions',
    sql: `CREATE TABLE IF NOT EXISTS ml_feature_definitions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      feature_name VARCHAR(200) NOT NULL UNIQUE,
      feature_type VARCHAR(50),
      description TEXT,
      data_source VARCHAR(100),
      computation_logic JSONB DEFAULT '{}',
      is_enabled BOOLEAN DEFAULT true,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`
  },
  {
    name: 'video_sessions',
    sql: `CREATE TABLE IF NOT EXISTS video_sessions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      patient_id UUID,
      provider_id UUID,
      status VARCHAR(50) DEFAULT 'scheduled',
      appointment_type VARCHAR(50) DEFAULT 'routine',
      notes TEXT,
      scheduled_at TIMESTAMPTZ,
      started_at TIMESTAMPTZ,
      ended_at TIMESTAMPTZ,
      duration_minutes INTEGER,
      room_id VARCHAR(200),
      recording_url TEXT,
      metadata JSONB DEFAULT '{}',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )`
  }
];

async function run() {
  console.log('Starting Hive OS table migrations...\n');
  let success = 0;
  let failed = 0;

  for (const { name, sql } of MIGRATIONS) {
    try {
      await db.query(sql);
      console.log(`  ✅ ${name} — OK`);
      success++;
    } catch (e) {
      console.error(`  ❌ ${name} — ${e.message}`);
      failed++;
    }
  }

  console.log(`\nComplete: ${success} created, ${failed} failed`);

  await db.pool.end();
  process.exit(failed > 0 ? 1 : 0);
}

run();
