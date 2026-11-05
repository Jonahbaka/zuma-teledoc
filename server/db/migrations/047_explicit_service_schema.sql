-- Move service-time schema creation to an explicit, additive migration.

CREATE TABLE IF NOT EXISTS ai_agent_memory (
          id SERIAL PRIMARY KEY,
          agent_type VARCHAR(50) NOT NULL,
          memory_type VARCHAR(30) NOT NULL DEFAULT 'context',
          memory_key VARCHAR(200) NOT NULL,
          memory_value TEXT NOT NULL,
          importance FLOAT DEFAULT 0.5,
          source VARCHAR(100) DEFAULT 'conversation',
          expires_at TIMESTAMP,
          created_at TIMESTAMP DEFAULT NOW(),
          updated_at TIMESTAMP DEFAULT NOW(),
          UNIQUE(agent_type, memory_key)
        );

CREATE INDEX IF NOT EXISTS idx_agent_memory_type ON ai_agent_memory(agent_type);

CREATE INDEX IF NOT EXISTS idx_agent_memory_key ON ai_agent_memory(memory_type);

CREATE TABLE IF NOT EXISTS ai_event_queue (
          id SERIAL PRIMARY KEY,
          event_type VARCHAR(100) NOT NULL,
          payload JSONB DEFAULT '{}',
          source VARCHAR(100) DEFAULT 'system',
          severity VARCHAR(20) DEFAULT 'info',
          processed_at TIMESTAMP,
          created_at TIMESTAMP DEFAULT NOW()
        );

CREATE TABLE IF NOT EXISTS ai_event_cursors (
          consumer_id VARCHAR(100) PRIMARY KEY,
          last_event_id INTEGER DEFAULT 0,
          updated_at TIMESTAMP DEFAULT NOW()
        );

CREATE INDEX IF NOT EXISTS idx_event_queue_unprocessed ON ai_event_queue (processed_at) WHERE processed_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_event_queue_type ON ai_event_queue (event_type);

CREATE TABLE IF NOT EXISTS ai_agent_goals (
          id SERIAL PRIMARY KEY,
          agent_id VARCHAR(100) NOT NULL,
          agent_name VARCHAR(255) NOT NULL,
          timeframe VARCHAR(20) NOT NULL CHECK (timeframe IN ('daily', 'weekly', 'monthly', 'yearly', 'infinite')),
          period_start TIMESTAMP DEFAULT NOW(),
          period_label VARCHAR(100),
          
          -- Dollar metrics
          revenue_target DECIMAL(12,2) DEFAULT 0,
          revenue_actual DECIMAL(12,2) DEFAULT 0,
          cost_savings_target DECIMAL(12,2) DEFAULT 0,
          cost_savings_actual DECIMAL(12,2) DEFAULT 0,
          
          -- Energy metrics (0-100 scale)
          efficiency_target INTEGER DEFAULT 0,
          efficiency_actual INTEGER DEFAULT 0,
          velocity_target INTEGER DEFAULT 0,
          velocity_actual INTEGER DEFAULT 0,
          resonance_score DECIMAL(4,2) DEFAULT 0, -- 0.00 to 1.00
          
          -- Descriptive goals  
          objectives JSONB DEFAULT '[]',
          achievements JSONB DEFAULT '[]',
          forecast_notes TEXT,
          
          -- Frequency tuning
          intent_score INTEGER DEFAULT 3,       -- 3 = Creation
          structure_score INTEGER DEFAULT 6,    -- 6 = Optimization
          ascension_score INTEGER DEFAULT 9,    -- 9 = Liberation
          harmonic_alignment DECIMAL(4,2) DEFAULT 0, -- 0.00 to 1.00
          
          -- Status
          status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'completed', 'exceeded', 'missed')),
          created_at TIMESTAMP DEFAULT NOW(),
          updated_at TIMESTAMP DEFAULT NOW()
        );

CREATE TABLE IF NOT EXISTS ai_agent_milestones (
          id SERIAL PRIMARY KEY,
          title VARCHAR(255) NOT NULL,
          description TEXT,
          agent_id VARCHAR(100),
          
          -- Measurements
          dollars_value DECIMAL(12,2) DEFAULT 0,
          energy_value INTEGER DEFAULT 0,
          frequency_reading DECIMAL(6,2) DEFAULT 432,
          
          -- Status
          target_date TIMESTAMP,
          achieved_date TIMESTAMP,
          status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'achieved', 'exceeded')),
          
          -- Cascade level
          timeframe VARCHAR(20),
          
          created_at TIMESTAMP DEFAULT NOW()
        );

CREATE TABLE IF NOT EXISTS nova_user_profiles (
        user_id       UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        known_facts   JSONB    DEFAULT '[]'::jsonb,
        last_contact  TIMESTAMP WITH TIME ZONE,
        message_count INTEGER  DEFAULT 0,
        onboarding_done BOOLEAN DEFAULT false,
        updated_at    TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );

ALTER TABLE users ADD COLUMN IF NOT EXISTS is_test_account BOOLEAN DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_users_is_test_account ON users(is_test_account);
