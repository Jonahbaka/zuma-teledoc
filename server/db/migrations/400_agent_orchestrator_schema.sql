-- ============================================================================
-- AI Agent Orchestrator Schema
-- DoctaRx Autonomous Agent Society
-- ============================================================================

-- ============================================================================
-- SECTION 1: AGENT REGISTRY
-- ============================================================================

CREATE TABLE IF NOT EXISTS ai_agents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_type VARCHAR(100) NOT NULL UNIQUE,
  display_name VARCHAR(255) NOT NULL,
  description TEXT,
  
  -- Configuration
  config JSONB NOT NULL DEFAULT '{}',
  system_prompt TEXT,
  capabilities JSONB DEFAULT '[]',      -- list of capability adapter names
  autonomy_level INTEGER DEFAULT 0 CHECK (autonomy_level BETWEEN 0 AND 5),
  -- 0=observe only, 1=suggest, 2=auto-execute low risk, 3=auto-execute medium, 4=auto-execute high, 5=full autonomy
  
  -- State
  status VARCHAR(20) DEFAULT 'idle' CHECK (status IN ('idle', 'running', 'paused', 'error', 'shutdown')),
  last_run_at TIMESTAMPTZ,
  last_result JSONB,
  error_message TEXT,
  run_count INTEGER DEFAULT 0,
  
  -- Scheduling
  schedule_cron VARCHAR(100),           -- cron expression for periodic runs
  next_scheduled_run TIMESTAMPTZ,
  
  -- Safety
  is_enabled BOOLEAN DEFAULT true,
  emergency_shutdown BOOLEAN DEFAULT false,
  veto_count INTEGER DEFAULT 0,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================================
-- SECTION 2: INTENTS (What agents want to do)
-- ============================================================================

CREATE TABLE IF NOT EXISTS ai_intents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL REFERENCES ai_agents(id),
  
  -- Intent definition
  intent_type VARCHAR(255) NOT NULL,      -- 'send_email', 'update_schedule', 'run_query', etc.
  intent_category VARCHAR(50) NOT NULL,    -- 'read', 'write', 'communicate', 'financial', 'external'
  parameters JSONB NOT NULL DEFAULT '{}',
  
  -- Context
  reasoning TEXT,                          -- Why the agent wants to do this
  expected_outcome TEXT,
  confidence DECIMAL(3,2) DEFAULT 0.50,
  
  -- Execution
  status VARCHAR(20) DEFAULT 'pending' CHECK (status IN (
    'pending', 'approved', 'executing', 'completed', 'failed', 'vetoed', 'expired'
  )),
  requires_approval BOOLEAN DEFAULT true,
  approved_by UUID,                        -- NULL = auto-approved per governance rules
  approved_at TIMESTAMPTZ,
  
  -- Result
  execution_result JSONB,
  execution_error TEXT,
  execution_duration_ms INTEGER,
  adapter_used VARCHAR(100),
  
  -- Safety
  risk_score DECIMAL(3,2) DEFAULT 0.50,    -- 0=no risk, 1=maximum risk
  compliance_check JSONB,                  -- Result of compliance validation
  is_reversible BOOLEAN DEFAULT true,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  executed_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ DEFAULT NOW() + INTERVAL '24 hours'
);

CREATE INDEX IF NOT EXISTS idx_intents_agent ON ai_intents (agent_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_intents_pending ON ai_intents (status, created_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_intents_approval ON ai_intents (requires_approval, status) WHERE status = 'pending' AND requires_approval = true;

-- ============================================================================
-- SECTION 3: PROPOSALS (Agent recommendations to humans)
-- ============================================================================

CREATE TABLE IF NOT EXISTS ai_proposals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL REFERENCES ai_agents(id),
  
  -- Proposal content
  title VARCHAR(500) NOT NULL,
  summary TEXT NOT NULL,
  detailed_plan JSONB,                     -- Step-by-step plan
  rationale TEXT NOT NULL,                 -- Why this is recommended
  
  -- Classification
  category VARCHAR(50) NOT NULL,           -- 'operations', 'growth', 'finance', 'compliance', 'corporate', 'clinical'
  priority VARCHAR(20) DEFAULT 'medium' CHECK (priority IN ('critical', 'high', 'medium', 'low')),
  estimated_impact JSONB,                  -- { revenue: +5000, efficiency: +12%, risk: 'low' }
  estimated_cost DECIMAL(12,2),
  
  -- Scoring (from Governance Agent)
  governance_score JSONB,                  -- { risk, reversibility, legality, cost, impact, overall }
  overall_score DECIMAL(3,2),
  
  -- Approval workflow
  status VARCHAR(20) DEFAULT 'draft' CHECK (status IN (
    'draft', 'pending_review', 'approved', 'rejected', 'executing', 'completed', 'cancelled'
  )),
  reviewed_by UUID,
  review_notes TEXT,
  reviewed_at TIMESTAMPTZ,
  
  -- Execution
  intents JSONB DEFAULT '[]',              -- List of intent IDs that implement this proposal
  execution_progress DECIMAL(3,2) DEFAULT 0,
  execution_log JSONB DEFAULT '[]',
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_proposals_status ON ai_proposals (status, priority, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_proposals_agent ON ai_proposals (agent_id, status, created_at DESC);

-- ============================================================================
-- SECTION 4: SKILL REGISTRY
-- ============================================================================

CREATE TABLE IF NOT EXISTS ai_skills (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Skill identity
  skill_name VARCHAR(255) NOT NULL UNIQUE,
  display_name VARCHAR(500) NOT NULL,
  description TEXT NOT NULL,
  category VARCHAR(100) NOT NULL,          -- 'corporate', 'financial', 'marketing', 'operations', 'compliance', 'clinical'
  
  -- Skill definition
  skill_type VARCHAR(50) NOT NULL,         -- 'workflow', 'query', 'automation', 'integration', 'analysis'
  steps JSONB NOT NULL,                    -- Ordered list of intents/actions
  input_schema JSONB,                      -- Expected input parameters
  output_schema JSONB,                     -- Expected output format
  
  -- Requirements
  required_capabilities JSONB DEFAULT '[]',-- Which adapters are needed
  required_approvals JSONB DEFAULT '[]',   -- Who must approve before use
  required_data JSONB DEFAULT '[]',        -- What data sources are needed
  
  -- Validation
  compliance_status VARCHAR(20) DEFAULT 'pending' CHECK (compliance_status IN (
    'pending', 'approved', 'rejected', 'suspended', 'under_review'
  )),
  compliance_notes TEXT,
  validated_by UUID,
  validated_at TIMESTAMPTZ,
  
  -- Risk assessment
  risk_level VARCHAR(20) DEFAULT 'medium' CHECK (risk_level IN ('critical', 'high', 'medium', 'low', 'minimal')),
  is_reversible BOOLEAN DEFAULT true,
  involves_phi BOOLEAN DEFAULT false,
  involves_financial BOOLEAN DEFAULT false,
  involves_external BOOLEAN DEFAULT false,
  
  -- Usage
  is_enabled BOOLEAN DEFAULT false,        -- Only enabled after compliance approval
  use_count INTEGER DEFAULT 0,
  last_used_at TIMESTAMPTZ,
  success_rate DECIMAL(3,2),
  avg_duration_ms INTEGER,
  
  -- Provenance
  source VARCHAR(100) DEFAULT 'internal',  -- 'internal', 'template', 'discovered', 'imported'
  source_url TEXT,
  version VARCHAR(20) DEFAULT '1.0.0',
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_skills_category ON ai_skills (category, compliance_status, is_enabled);

-- Skill execution log
CREATE TABLE IF NOT EXISTS ai_skill_executions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  skill_id UUID NOT NULL REFERENCES ai_skills(id),
  agent_id UUID NOT NULL REFERENCES ai_agents(id),
  proposal_id UUID REFERENCES ai_proposals(id),
  
  -- Execution
  input_data JSONB,
  output_data JSONB,
  status VARCHAR(20) DEFAULT 'running' CHECK (status IN ('running', 'completed', 'failed', 'cancelled')),
  error_message TEXT,
  duration_ms INTEGER,
  
  -- Sandbox
  is_sandbox BOOLEAN DEFAULT false,
  sandbox_result JSONB,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

-- ============================================================================
-- SECTION 5: CAPABILITY ADAPTERS
-- ============================================================================

CREATE TABLE IF NOT EXISTS ai_capability_adapters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  adapter_name VARCHAR(255) NOT NULL UNIQUE,
  display_name VARCHAR(500) NOT NULL,
  description TEXT,
  adapter_type VARCHAR(50) NOT NULL,       -- 'api', 'database', 'email', 'browser', 'messaging', 'payment', 'physical'
  
  -- Configuration
  config JSONB DEFAULT '{}',               -- Adapter-specific configuration
  supported_intents JSONB DEFAULT '[]',    -- Which intent types this adapter handles
  
  -- Status
  is_enabled BOOLEAN DEFAULT true,
  health_status VARCHAR(20) DEFAULT 'unknown',
  last_health_check TIMESTAMPTZ,
  
  -- Safety
  requires_approval_above_risk DECIMAL(3,2) DEFAULT 0.50,
  max_executions_per_hour INTEGER DEFAULT 100,
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================================
-- SECTION 6: GOVERNANCE & AUDIT
-- ============================================================================

-- Complete audit trail of all agent actions
CREATE TABLE IF NOT EXISTS ai_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Who
  agent_id UUID REFERENCES ai_agents(id),
  agent_type VARCHAR(100),
  
  -- What
  action_type VARCHAR(100) NOT NULL,       -- 'proposal_created', 'intent_executed', 'skill_used', 'veto_issued', etc.
  action_details JSONB NOT NULL,
  
  -- References
  intent_id UUID REFERENCES ai_intents(id),
  proposal_id UUID REFERENCES ai_proposals(id),
  skill_id UUID REFERENCES ai_skills(id),
  
  -- Context
  reasoning TEXT,
  risk_assessment JSONB,
  compliance_check JSONB,
  
  -- Outcome
  outcome VARCHAR(20),                     -- 'success', 'failure', 'vetoed', 'pending'
  outcome_details JSONB,
  
  -- Safety
  involved_phi BOOLEAN DEFAULT false,
  involved_financial BOOLEAN DEFAULT false,
  human_approved BOOLEAN,
  approved_by UUID,
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_agent ON ai_audit_log (agent_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_action ON ai_audit_log (action_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_time ON ai_audit_log (created_at DESC);

-- Governance policies
CREATE TABLE IF NOT EXISTS ai_governance_policies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  policy_name VARCHAR(255) NOT NULL UNIQUE,
  description TEXT NOT NULL,
  
  -- Rule definition
  rule_type VARCHAR(50) NOT NULL,          -- 'auto_approve', 'require_approval', 'auto_reject', 'escalate'
  conditions JSONB NOT NULL,               -- Conditions that trigger this policy
  actions JSONB NOT NULL,                  -- What happens when triggered
  
  -- Scope
  applies_to_agents JSONB DEFAULT '["*"]', -- Which agents this applies to
  applies_to_intents JSONB DEFAULT '["*"]',-- Which intent types
  
  -- Priority (higher = evaluated first)
  priority INTEGER DEFAULT 100,
  is_enabled BOOLEAN DEFAULT true,
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================================
-- SECTION 7: AGENT COMMUNICATION (Inter-agent messages)
-- ============================================================================

CREATE TABLE IF NOT EXISTS ai_agent_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  from_agent_id UUID NOT NULL REFERENCES ai_agents(id),
  to_agent_id UUID NOT NULL REFERENCES ai_agents(id),
  
  message_type VARCHAR(50) NOT NULL,       -- 'request', 'response', 'alert', 'veto', 'approval', 'info'
  subject VARCHAR(500),
  content JSONB NOT NULL,
  
  -- Reference
  proposal_id UUID REFERENCES ai_proposals(id),
  intent_id UUID REFERENCES ai_intents(id),
  
  is_read BOOLEAN DEFAULT false,
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_messages ON ai_agent_messages (to_agent_id, is_read, created_at DESC);

-- ============================================================================
-- SECTION 8: DAILY BRIEFINGS
-- ============================================================================

CREATE TABLE IF NOT EXISTS ai_briefings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  briefing_date DATE NOT NULL,
  agent_id UUID REFERENCES ai_agents(id),  -- NULL = system-wide briefing
  
  -- Content
  title VARCHAR(500) NOT NULL,
  summary TEXT NOT NULL,
  key_metrics JSONB,
  insights JSONB DEFAULT '[]',
  recommendations JSONB DEFAULT '[]',
  alerts JSONB DEFAULT '[]',
  
  -- Classification
  category VARCHAR(50) NOT NULL,
  priority VARCHAR(20) DEFAULT 'medium',
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(briefing_date, agent_id)
);

CREATE INDEX IF NOT EXISTS idx_briefings_date ON ai_briefings (briefing_date DESC);
