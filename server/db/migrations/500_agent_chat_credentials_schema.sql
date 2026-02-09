-- =========================================================================
-- Migration 500: Agent Chat + Credential Vault + Extended Agents
-- PROJECT GENESIS — Communication & World Interface Layer
-- =========================================================================

-- Agent Chat Messages (Operator <-> Agent communication)
CREATE TABLE IF NOT EXISTS ai_chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL DEFAULT gen_random_uuid(),
  sender_type VARCHAR(20) NOT NULL CHECK (sender_type IN ('operator', 'agent', 'system')),
  sender_id VARCHAR(100) NOT NULL, -- user ID or agent type
  sender_name VARCHAR(200) NOT NULL,
  recipient_type VARCHAR(20) NOT NULL CHECK (recipient_type IN ('operator', 'agent', 'all', 'group')),
  recipient_id VARCHAR(100), -- specific agent type or NULL for broadcast
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

-- Credential Vault (AES-256-GCM encrypted platform credentials)
CREATE TABLE IF NOT EXISTS ai_credential_vault (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  platform VARCHAR(100) NOT NULL, -- 'twitter', 'linkedin', 'facebook', 'instagram', 'tiktok', etc.
  platform_display_name VARCHAR(200) NOT NULL,
  account_label VARCHAR(200), -- friendly label: "DoctaRx Main", "Marketing Acct"
  username_encrypted TEXT,
  username_iv VARCHAR(64),
  username_tag VARCHAR(64),
  password_encrypted TEXT,
  password_iv VARCHAR(64),
  password_tag VARCHAR(64),
  api_key_encrypted TEXT,
  api_key_iv VARCHAR(64),
  api_key_tag VARCHAR(64),
  api_secret_encrypted TEXT,
  api_secret_iv VARCHAR(64),
  api_secret_tag VARCHAR(64),
  extra_data_encrypted TEXT, -- additional tokens, cookies, etc. as JSON
  extra_data_iv VARCHAR(64),
  extra_data_tag VARCHAR(64),
  status VARCHAR(30) DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'expired', 'revoked')),
  last_verified_at TIMESTAMPTZ,
  assigned_agents TEXT[] DEFAULT '{}', -- which agents can access this credential
  added_by UUID, -- operator who added it
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_credential_vault_platform ON ai_credential_vault(platform);
CREATE INDEX IF NOT EXISTS idx_credential_vault_status ON ai_credential_vault(status);

-- Agent Results Tracking (tangible, measurable outcomes)
CREATE TABLE IF NOT EXISTS ai_agent_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_type VARCHAR(50) NOT NULL,
  agent_name VARCHAR(200) NOT NULL,
  result_type VARCHAR(50) NOT NULL, -- 'metric', 'action_completed', 'account_created', 'post_published', 'research_finding', 'financial_report'
  title VARCHAR(500) NOT NULL,
  description TEXT,
  metrics JSONB DEFAULT '{}', -- measurable data: { views: 100, clicks: 50, revenue: 500, etc. }
  evidence JSONB DEFAULT '{}', -- proof: { screenshot_url: '', api_response: {}, etc. }
  status VARCHAR(30) DEFAULT 'reported' CHECK (status IN ('reported', 'verified', 'disputed', 'archived')),
  period_start TIMESTAMPTZ,
  period_end TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_results_agent ON ai_agent_results(agent_type);
CREATE INDEX IF NOT EXISTS idx_agent_results_type ON ai_agent_results(result_type);
CREATE INDEX IF NOT EXISTS idx_agent_results_created ON ai_agent_results(created_at DESC);

-- Agent Account Registry (accounts created by agents on platforms)
CREATE TABLE IF NOT EXISTS ai_platform_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  platform VARCHAR(100) NOT NULL,
  account_type VARCHAR(50) NOT NULL, -- 'social_media', 'business', 'advertising', 'analytics', 'email_marketing'
  account_name VARCHAR(200),
  account_url TEXT,
  created_by_agent VARCHAR(50) NOT NULL,
  credential_id UUID REFERENCES ai_credential_vault(id),
  status VARCHAR(30) DEFAULT 'active',
  purpose TEXT,
  metrics JSONB DEFAULT '{}', -- followers, engagement, etc.
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_platform_accounts_platform ON ai_platform_accounts(platform);
CREATE INDEX IF NOT EXISTS idx_platform_accounts_agent ON ai_platform_accounts(created_by_agent);
