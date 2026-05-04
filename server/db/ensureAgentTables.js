/**
 * Ensure Agent Tables — runs on server startup
 * Creates missing tables required by agent-chat, credential vault, CRM, etc.
 * All statements use IF NOT EXISTS so re-runs are safe.
 */

const db = require('./index');

const TABLES_SQL = `
-- Agent Chat Messages
CREATE TABLE IF NOT EXISTS ai_chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL DEFAULT gen_random_uuid(),
  sender_type VARCHAR(20) NOT NULL CHECK (sender_type IN ('operator', 'agent', 'system')),
  sender_id VARCHAR(100) NOT NULL,
  sender_name VARCHAR(200) NOT NULL,
  recipient_type VARCHAR(20) NOT NULL CHECK (recipient_type IN ('operator', 'agent', 'all', 'group')),
  recipient_id VARCHAR(100),
  content TEXT NOT NULL,
  message_type VARCHAR(30) DEFAULT 'text' CHECK (message_type IN ('text', 'report', 'alert', 'request', 'approval', 'result', 'credential_request')),
  metadata JSONB DEFAULT '{}',
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_chat_messages_conversation ON ai_chat_messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_sender ON ai_chat_messages(sender_type, sender_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_recipient ON ai_chat_messages(recipient_type, recipient_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_created ON ai_chat_messages(created_at DESC);

-- Credential Vault
CREATE TABLE IF NOT EXISTS ai_credential_vault (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  platform VARCHAR(100) NOT NULL,
  platform_display_name VARCHAR(200) NOT NULL,
  account_label VARCHAR(200),
  username_encrypted TEXT, username_iv VARCHAR(64), username_tag VARCHAR(64),
  password_encrypted TEXT, password_iv VARCHAR(64), password_tag VARCHAR(64),
  api_key_encrypted TEXT, api_key_iv VARCHAR(64), api_key_tag VARCHAR(64),
  api_secret_encrypted TEXT, api_secret_iv VARCHAR(64), api_secret_tag VARCHAR(64),
  extra_data_encrypted TEXT, extra_data_iv VARCHAR(64), extra_data_tag VARCHAR(64),
  status VARCHAR(30) DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'expired', 'revoked')),
  last_verified_at TIMESTAMPTZ,
  assigned_agents TEXT[] DEFAULT '{}',
  added_by UUID,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_credential_vault_platform ON ai_credential_vault(platform);
CREATE INDEX IF NOT EXISTS idx_credential_vault_status ON ai_credential_vault(status);

-- Agent Results Tracking
CREATE TABLE IF NOT EXISTS ai_agent_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_type VARCHAR(100) NOT NULL,
  agent_name VARCHAR(200),
  result_type VARCHAR(50) DEFAULT 'general',
  title VARCHAR(500),
  description TEXT,
  metrics JSONB DEFAULT '{}',
  evidence JSONB DEFAULT '{}',
  verified BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_agent_results_type ON ai_agent_results(agent_type);
CREATE INDEX IF NOT EXISTS idx_agent_results_created ON ai_agent_results(created_at DESC);

-- Uploaded files for agent analysis
CREATE TABLE IF NOT EXISTS ai_uploaded_files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  uploader_id UUID,
  original_name TEXT NOT NULL,
  stored_name TEXT NOT NULL,
  mime_type VARCHAR(200) NOT NULL,
  size_bytes BIGINT NOT NULL DEFAULT 0,
  sha256 VARCHAR(64) NOT NULL,
  storage_path TEXT NOT NULL,
  extracted_text TEXT,
  extraction_status VARCHAR(30) DEFAULT 'pending' CHECK (extraction_status IN ('pending', 'extracted', 'skipped', 'failed')),
  extraction_error TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_uploaded_files_created ON ai_uploaded_files(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_uploaded_files_sha ON ai_uploaded_files(sha256);

-- Chat message attachments
CREATE TABLE IF NOT EXISTS ai_chat_message_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id UUID NOT NULL REFERENCES ai_chat_messages(id) ON DELETE CASCADE,
  file_id UUID NOT NULL REFERENCES ai_uploaded_files(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (message_id, file_id)
);
CREATE INDEX IF NOT EXISTS idx_chat_attachments_message ON ai_chat_message_attachments(message_id);
CREATE INDEX IF NOT EXISTS idx_chat_attachments_file ON ai_chat_message_attachments(file_id);

-- CRM Contacts (full schema matching 300_crm_schema.sql)
CREATE TABLE IF NOT EXISTS crm_contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  first_name VARCHAR(255),
  last_name VARCHAR(255),
  email VARCHAR(255),
  phone VARCHAR(50),
  title VARCHAR(255),
  organization VARCHAR(255),
  contact_type VARCHAR(50) NOT NULL DEFAULT 'lead'
    CHECK (contact_type IN ('provider', 'investor', 'partner', 'lead', 'nurse', 'admin', 'influencer', 'media')),
  specialty VARCHAR(255),
  sub_type VARCHAR(100),
  source VARCHAR(100),
  source_url TEXT,
  source_agent VARCHAR(100),
  linkedin_url TEXT,
  twitter_handle VARCHAR(100),
  website TEXT,
  npi_number VARCHAR(20),
  city VARCHAR(100),
  state VARCHAR(50),
  country VARCHAR(50) DEFAULT 'US',
  pipeline_stage VARCHAR(50) DEFAULT 'new'
    CHECK (pipeline_stage IN ('new', 'researching', 'outreach_queued', 'contacted', 'responded', 'interested', 'negotiating', 'converted', 'lost', 'nurturing')),
  lead_score INTEGER DEFAULT 0 CHECK (lead_score >= 0 AND lead_score <= 100),
  priority VARCHAR(20) DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'critical')),
  tags TEXT[] DEFAULT '{}',
  notes TEXT,
  assigned_agent VARCHAR(100),
  last_contacted_at TIMESTAMP,
  next_followup_at TIMESTAMP,
  is_active BOOLEAN DEFAULT true,
  opt_out BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_crm_contacts_type ON crm_contacts(contact_type);
CREATE INDEX IF NOT EXISTS idx_crm_contacts_stage ON crm_contacts(pipeline_stage);
CREATE INDEX IF NOT EXISTS idx_crm_contacts_email ON crm_contacts(email);
CREATE INDEX IF NOT EXISTS idx_crm_contacts_agent ON crm_contacts(assigned_agent);

-- CRM Campaigns
CREATE TABLE IF NOT EXISTS crm_campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  description TEXT,
  campaign_type VARCHAR(50) NOT NULL DEFAULT 'cold_email'
    CHECK (campaign_type IN ('cold_email', 'follow_up', 'newsletter', 'social_engage', 'investor_pitch', 'partnership')),
  target_contact_type VARCHAR(50),
  target_specialty VARCHAR(255),
  target_tags TEXT[],
  subject_line TEXT,
  email_template TEXT,
  send_time VARCHAR(20) DEFAULT 'optimal',
  scheduled_at TIMESTAMP,
  daily_limit INTEGER DEFAULT 50,
  total_contacts INTEGER DEFAULT 0,
  emails_sent INTEGER DEFAULT 0,
  emails_opened INTEGER DEFAULT 0,
  emails_replied INTEGER DEFAULT 0,
  emails_bounced INTEGER DEFAULT 0,
  conversions INTEGER DEFAULT 0,
  status VARCHAR(20) DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'running', 'paused', 'completed', 'cancelled')),
  created_by VARCHAR(100),
  approved_by VARCHAR(100),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_crm_campaigns_status ON crm_campaigns(status);

-- CRM Interactions
CREATE TABLE IF NOT EXISTS crm_interactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id UUID REFERENCES crm_contacts(id) ON DELETE CASCADE,
  campaign_id UUID REFERENCES crm_campaigns(id) ON DELETE SET NULL,
  interaction_type VARCHAR(50) NOT NULL,
  subject TEXT,
  content TEXT,
  reply_content TEXT,
  message_id VARCHAR(255),
  email_status VARCHAR(20),
  agent_type VARCHAR(100),
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_crm_interactions_contact ON crm_interactions(contact_id);
CREATE INDEX IF NOT EXISTS idx_crm_interactions_campaign ON crm_interactions(campaign_id);

-- CRM Email Templates
CREATE TABLE IF NOT EXISTS crm_email_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  category VARCHAR(50) NOT NULL DEFAULT 'general',
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  times_used INTEGER DEFAULT 0,
  open_rate DECIMAL(5,2) DEFAULT 0,
  reply_rate DECIMAL(5,2) DEFAULT 0,
  created_by VARCHAR(100) DEFAULT 'system',
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW()
);

-- CRM Scrape Sources
CREATE TABLE IF NOT EXISTS crm_scrape_sources (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  url TEXT NOT NULL,
  source_type VARCHAR(50) NOT NULL,
  scrape_frequency VARCHAR(20) DEFAULT 'weekly',
  last_scraped_at TIMESTAMP,
  contacts_found INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Persistent Agent Memory
CREATE TABLE IF NOT EXISTS ai_agent_memory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_type VARCHAR(100) NOT NULL,
  memory_type VARCHAR(50) DEFAULT 'fact',
  content TEXT NOT NULL,
  importance INTEGER DEFAULT 5,
  source VARCHAR(200),
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_agent_memory_type ON ai_agent_memory(agent_type);
CREATE INDEX IF NOT EXISTS idx_agent_memory_created ON ai_agent_memory(created_at DESC);

-- Operational Agent Runtime: persisted task queue, tool logs, approvals, and budget controls.
CREATE TABLE IF NOT EXISTS ai_operational_agent_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  task_type VARCHAR(120) NOT NULL DEFAULT 'general',
  requested_by UUID,
  selected_agent_id VARCHAR(120),
  selected_agent_name TEXT,
  status VARCHAR(40) NOT NULL DEFAULT 'queued'
    CHECK (status IN ('draft', 'queued', 'running', 'waiting_approval', 'completed', 'failed', 'cancelled')),
  risk_level VARCHAR(30) NOT NULL DEFAULT 'low',
  requires_approval BOOLEAN NOT NULL DEFAULT FALSE,
  input JSONB NOT NULL DEFAULT '{}',
  result JSONB,
  error TEXT,
  model_provider VARCHAR(80),
  model_name VARCHAR(160),
  prompt_version VARCHAR(80) DEFAULT 'operational-agent-runtime-v1',
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  estimated_cost_usd NUMERIC(12, 6) NOT NULL DEFAULT 0,
  max_tool_calls INTEGER NOT NULL DEFAULT 6,
  max_tokens INTEGER NOT NULL DEFAULT 1200,
  queued_at TIMESTAMPTZ DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_operational_agent_tasks_status ON ai_operational_agent_tasks(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_operational_agent_tasks_agent ON ai_operational_agent_tasks(selected_agent_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_operational_agent_tasks_requested_by ON ai_operational_agent_tasks(requested_by, created_at DESC);

CREATE TABLE IF NOT EXISTS ai_operational_agent_tool_calls (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES ai_operational_agent_tasks(id) ON DELETE CASCADE,
  agent_id VARCHAR(120) NOT NULL,
  tool_name VARCHAR(160) NOT NULL,
  status VARCHAR(40) NOT NULL DEFAULT 'completed'
    CHECK (status IN ('queued', 'running', 'completed', 'failed', 'skipped')),
  input_summary JSONB NOT NULL DEFAULT '{}',
  output_summary JSONB,
  error TEXT,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_operational_agent_tool_calls_task ON ai_operational_agent_tool_calls(task_id, created_at);

CREATE TABLE IF NOT EXISTS ai_operational_agent_approvals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES ai_operational_agent_tasks(id) ON DELETE CASCADE,
  agent_id VARCHAR(120) NOT NULL,
  action_type VARCHAR(120) NOT NULL,
  risk_level VARCHAR(30) NOT NULL DEFAULT 'medium',
  status VARCHAR(40) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'expired')),
  proposed_action JSONB NOT NULL DEFAULT '{}',
  decision_notes TEXT,
  requested_by UUID,
  decided_by UUID,
  decided_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_operational_agent_approvals_status ON ai_operational_agent_approvals(status, created_at DESC);

CREATE TABLE IF NOT EXISTS ai_operational_agent_budget_settings (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  daily_budget_usd NUMERIC(12, 2) DEFAULT 5.00,
  monthly_budget_usd NUMERIC(12, 2) DEFAULT 100.00,
  simple_model VARCHAR(160) DEFAULT 'gemini-2.0-flash',
  strong_model VARCHAR(160) DEFAULT 'claude-sonnet-4-6',
  updated_by UUID,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
INSERT INTO ai_operational_agent_budget_settings (id)
VALUES (1)
ON CONFLICT (id) DO NOTHING;
`;

async function ensureAgentTables() {
  try {
    await db.query(TABLES_SQL);
    console.log('✅ Agent/CRM/Credential tables: verified');
    return true;
  } catch (err) {
    console.error('⚠️ Agent tables migration warning:', err.message);
    return false;
  }
}

module.exports = ensureAgentTables;
