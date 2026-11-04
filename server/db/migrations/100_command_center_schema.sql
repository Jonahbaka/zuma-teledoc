-- ============================================================================
-- Communication Command Center Schema
-- HIPAA-Compliant Email, Social, and Campaign Management
-- ============================================================================

-- ============================================================================
-- SECTION 1: EMAIL & INBOX SYSTEM
-- ============================================================================

-- Email Folders (Inbox, Sent, Drafts, Archive, Trash, Custom)
CREATE TABLE IF NOT EXISTS email_folders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,
  folder_type VARCHAR(50) NOT NULL DEFAULT 'custom' 
    CHECK (folder_type IN ('inbox', 'sent', 'drafts', 'archive', 'trash', 'spam', 'custom')),
  color VARCHAR(7), -- Hex color for UI
  icon VARCHAR(50),
  is_system BOOLEAN DEFAULT false, -- System folders cannot be deleted
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, name)
);

-- Email Labels (for categorization)
CREATE TABLE IF NOT EXISTS email_labels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID, -- NULL for user-specific labels
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,
  color VARCHAR(7) NOT NULL DEFAULT '#6366f1',
  description TEXT,
  is_system BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Email Threads (Conversation grouping)
CREATE TABLE IF NOT EXISTS email_threads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subject VARCHAR(500) NOT NULL,
  subject_normalized VARCHAR(500), -- For threading (lowercase, no Re:/Fwd:)
  participant_ids UUID[] NOT NULL, -- Array of user IDs in thread
  last_message_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  message_count INTEGER DEFAULT 1,
  has_attachments BOOLEAN DEFAULT false,
  is_starred BOOLEAN DEFAULT false,
  is_archived BOOLEAN DEFAULT false,
  priority VARCHAR(20) DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  -- AI-analyzed fields
  sentiment VARCHAR(20) CHECK (sentiment IN ('positive', 'neutral', 'negative', 'urgent', 'distressed')),
  sentiment_score DECIMAL(3,2),
  ai_summary_encrypted TEXT,
  ai_summary_iv VARCHAR(32),
  ai_summary_tag VARCHAR(32),
  -- Metadata
  external_thread_id VARCHAR(255), -- External email provider thread ID
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Email Messages
CREATE TABLE IF NOT EXISTS email_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id UUID NOT NULL REFERENCES email_threads(id) ON DELETE CASCADE,
  -- Sender/Recipient info (encrypted for PHI compliance)
  sender_id UUID REFERENCES users(id),
  sender_email_encrypted TEXT NOT NULL,
  sender_email_iv VARCHAR(32) NOT NULL,
  sender_email_tag VARCHAR(32) NOT NULL,
  sender_name_encrypted TEXT,
  sender_name_iv VARCHAR(32),
  sender_name_tag VARCHAR(32),
  -- Recipients (stored as encrypted JSON)
  recipients_encrypted TEXT NOT NULL, -- {to: [], cc: [], bcc: []}
  recipients_iv VARCHAR(32) NOT NULL,
  recipients_tag VARCHAR(32) NOT NULL,
  -- Content (encrypted)
  subject_encrypted TEXT NOT NULL,
  subject_iv VARCHAR(32) NOT NULL,
  subject_tag VARCHAR(32) NOT NULL,
  body_html_encrypted TEXT,
  body_html_iv VARCHAR(32),
  body_html_tag VARCHAR(32),
  body_text_encrypted TEXT,
  body_text_iv VARCHAR(32),
  body_text_tag VARCHAR(32),
  -- Message metadata
  message_type VARCHAR(20) DEFAULT 'email' CHECK (message_type IN ('email', 'internal', 'system', 'campaign')),
  direction VARCHAR(10) NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  status VARCHAR(20) DEFAULT 'sent' CHECK (status IN ('draft', 'queued', 'sending', 'sent', 'delivered', 'bounced', 'failed')),
  -- Tracking
  is_read BOOLEAN DEFAULT false,
  read_at TIMESTAMPTZ,
  is_starred BOOLEAN DEFAULT false,
  is_important BOOLEAN DEFAULT false,
  -- External IDs
  external_message_id VARCHAR(255), -- Message-ID header or provider ID
  in_reply_to VARCHAR(255),
  references_ids TEXT[], -- Array of Message-IDs this replies to
  -- Timestamps
  sent_at TIMESTAMPTZ,
  received_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Email Attachments
CREATE TABLE IF NOT EXISTS email_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id UUID NOT NULL REFERENCES email_messages(id) ON DELETE CASCADE,
  filename_encrypted TEXT NOT NULL,
  filename_iv VARCHAR(32) NOT NULL,
  filename_tag VARCHAR(32) NOT NULL,
  content_type VARCHAR(255) NOT NULL,
  size_bytes INTEGER NOT NULL,
  storage_path_encrypted TEXT NOT NULL, -- Encrypted S3/storage path
  storage_path_iv VARCHAR(32) NOT NULL,
  storage_path_tag VARCHAR(32) NOT NULL,
  checksum VARCHAR(64), -- SHA-256 for integrity
  is_inline BOOLEAN DEFAULT false,
  content_id VARCHAR(255), -- For inline images
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Email-Folder Association (many-to-many)
CREATE TABLE IF NOT EXISTS email_message_folders (
  message_id UUID NOT NULL REFERENCES email_messages(id) ON DELETE CASCADE,
  folder_id UUID NOT NULL REFERENCES email_folders(id) ON DELETE CASCADE,
  added_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (message_id, folder_id)
);

-- Email-Label Association (many-to-many)
CREATE TABLE IF NOT EXISTS email_message_labels (
  message_id UUID NOT NULL REFERENCES email_messages(id) ON DELETE CASCADE,
  label_id UUID NOT NULL REFERENCES email_labels(id) ON DELETE CASCADE,
  added_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (message_id, label_id)
);

-- Email Tracking Events (opens, clicks)
CREATE TABLE IF NOT EXISTS email_tracking_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id UUID NOT NULL REFERENCES email_messages(id) ON DELETE CASCADE,
  campaign_id UUID, -- If from campaign
  event_type VARCHAR(20) NOT NULL CHECK (event_type IN ('open', 'click', 'bounce', 'complaint', 'unsubscribe')),
  -- Anonymized tracking data (no PII stored)
  user_agent_hash VARCHAR(64),
  ip_country VARCHAR(2),
  ip_region VARCHAR(100),
  link_url TEXT, -- For click events
  link_index INTEGER,
  -- Metadata
  raw_event_data JSONB, -- Provider webhook data (sanitized)
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================================
-- SECTION 2: SOCIAL MEDIA MANAGEMENT
-- ============================================================================

-- Social Media Connections (OAuth tokens - encrypted)
CREATE TABLE IF NOT EXISTS social_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  platform VARCHAR(20) NOT NULL CHECK (platform IN ('linkedin', 'twitter', 'facebook', 'instagram')),
  platform_user_id VARCHAR(255) NOT NULL,
  platform_username VARCHAR(255),
  -- Encrypted OAuth tokens
  access_token_encrypted TEXT NOT NULL,
  access_token_iv VARCHAR(32) NOT NULL,
  access_token_tag VARCHAR(32) NOT NULL,
  refresh_token_encrypted TEXT,
  refresh_token_iv VARCHAR(32),
  refresh_token_tag VARCHAR(32),
  token_expires_at TIMESTAMPTZ,
  -- Scopes and permissions
  scopes TEXT[],
  -- Connection status
  status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'expired', 'revoked', 'error')),
  last_sync_at TIMESTAMPTZ,
  last_error TEXT,
  -- Metadata
  profile_data JSONB, -- Non-sensitive profile info
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, platform, platform_user_id)
);

-- Social Posts
CREATE TABLE IF NOT EXISTS social_posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  connection_id UUID REFERENCES social_connections(id) ON DELETE SET NULL,
  campaign_id UUID, -- If part of a campaign
  -- Content
  content_encrypted TEXT NOT NULL,
  content_iv VARCHAR(32) NOT NULL,
  content_tag VARCHAR(32) NOT NULL,
  content_plain_preview VARCHAR(100), -- Non-sensitive preview for lists
  -- Platform-specific
  platform VARCHAR(20) NOT NULL,
  platform_post_id VARCHAR(255), -- External post ID after publishing
  post_type VARCHAR(20) DEFAULT 'text' CHECK (post_type IN ('text', 'image', 'video', 'link', 'carousel')),
  -- Media (encrypted paths)
  media_urls_encrypted TEXT,
  media_urls_iv VARCHAR(32),
  media_urls_tag VARCHAR(32),
  -- Scheduling
  status VARCHAR(20) DEFAULT 'draft' CHECK (status IN ('draft', 'scheduled', 'publishing', 'published', 'failed', 'deleted')),
  scheduled_for TIMESTAMPTZ,
  published_at TIMESTAMPTZ,
  -- Analytics (updated via webhooks/polling)
  likes_count INTEGER DEFAULT 0,
  comments_count INTEGER DEFAULT 0,
  shares_count INTEGER DEFAULT 0,
  impressions INTEGER DEFAULT 0,
  engagement_rate DECIMAL(5,2),
  -- AI Generation metadata
  ai_generated BOOLEAN DEFAULT false,
  ai_prompt_used TEXT,
  original_post_id UUID REFERENCES social_posts(id), -- If this is a variation
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Social Post Variations (AI-generated platform-specific versions)
CREATE TABLE IF NOT EXISTS social_post_variations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_post_id UUID NOT NULL REFERENCES social_posts(id) ON DELETE CASCADE,
  platform VARCHAR(20) NOT NULL,
  content_encrypted TEXT NOT NULL,
  content_iv VARCHAR(32) NOT NULL,
  content_tag VARCHAR(32) NOT NULL,
  tone VARCHAR(50), -- 'professional', 'casual', 'short', 'visual_caption'
  character_count INTEGER,
  ai_model VARCHAR(50),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================================
-- SECTION 3: CAMPAIGN MANAGEMENT
-- ============================================================================

-- User Segments (for targeting)
CREATE TABLE IF NOT EXISTS campaign_segments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  description TEXT,
  -- Segment criteria (JSON for flexible querying)
  criteria JSONB NOT NULL, -- e.g., {"conditions": [{"field": "diagnosis", "op": "contains", "value": "diabetes"}]}
  -- Computed values
  estimated_count INTEGER DEFAULT 0,
  last_computed_at TIMESTAMPTZ,
  -- Status
  is_active BOOLEAN DEFAULT true,
  is_system BOOLEAN DEFAULT false, -- System segments like "All Patients"
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Campaigns
CREATE TABLE IF NOT EXISTS campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  description TEXT,
  -- Type and channel
  campaign_type VARCHAR(30) NOT NULL CHECK (campaign_type IN ('email', 'social', 'multi_channel', 'newsletter', 'announcement')),
  channels VARCHAR(20)[] DEFAULT ARRAY['email'], -- ['email', 'linkedin', 'twitter', etc.]
  -- Content
  template_id UUID, -- Reference to email template
  subject_line VARCHAR(500),
  content_encrypted TEXT,
  content_iv VARCHAR(32),
  content_tag VARCHAR(32),
  -- Targeting
  segment_id UUID REFERENCES campaign_segments(id),
  recipient_count INTEGER DEFAULT 0,
  -- Scheduling
  status VARCHAR(20) DEFAULT 'draft' CHECK (status IN ('draft', 'scheduled', 'sending', 'paused', 'completed', 'cancelled')),
  scheduled_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  -- Throttling
  send_rate_per_hour INTEGER DEFAULT 1000, -- Rate limiting
  batch_size INTEGER DEFAULT 100,
  -- Analytics
  sent_count INTEGER DEFAULT 0,
  delivered_count INTEGER DEFAULT 0,
  opened_count INTEGER DEFAULT 0,
  clicked_count INTEGER DEFAULT 0,
  bounced_count INTEGER DEFAULT 0,
  unsubscribed_count INTEGER DEFAULT 0,
  -- A/B Testing
  is_ab_test BOOLEAN DEFAULT false,
  ab_test_config JSONB,
  -- Compliance
  includes_unsubscribe_link BOOLEAN DEFAULT true,
  physical_address_included BOOLEAN DEFAULT true,
  -- Creator
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Campaign Recipients (tracks individual sends)
CREATE TABLE IF NOT EXISTS campaign_recipients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id),
  -- Contact info (encrypted)
  email_encrypted TEXT,
  email_iv VARCHAR(32),
  email_tag VARCHAR(32),
  -- Personalization variables
  merge_fields JSONB, -- Encrypted personalization data
  -- Delivery status
  status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'queued', 'sent', 'delivered', 'opened', 'clicked', 'bounced', 'failed', 'unsubscribed')),
  sent_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  opened_at TIMESTAMPTZ,
  clicked_at TIMESTAMPTZ,
  bounced_at TIMESTAMPTZ,
  bounce_type VARCHAR(20), -- 'soft', 'hard'
  bounce_reason TEXT,
  -- Tracking
  message_id UUID REFERENCES email_messages(id),
  external_message_id VARCHAR(255),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Campaign A/B Test Variants
CREATE TABLE IF NOT EXISTS campaign_ab_variants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  variant_name VARCHAR(50) NOT NULL, -- 'A', 'B', 'C'
  subject_line VARCHAR(500),
  content_encrypted TEXT,
  content_iv VARCHAR(32),
  content_tag VARCHAR(32),
  percentage INTEGER DEFAULT 50, -- % of audience
  -- Results
  sent_count INTEGER DEFAULT 0,
  opened_count INTEGER DEFAULT 0,
  clicked_count INTEGER DEFAULT 0,
  is_winner BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================================
-- SECTION 4: AI HEALTHBOT
-- ============================================================================

-- HealthBot Conversations
CREATE TABLE IF NOT EXISTS healthbot_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title VARCHAR(255),
  context_type VARCHAR(30) CHECK (context_type IN ('general', 'email_draft', 'campaign', 'social', 'analysis')),
  context_reference_id UUID, -- ID of email/campaign being worked on
  -- Status
  status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  message_count INTEGER DEFAULT 0,
  -- Timestamps
  last_message_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- HealthBot Messages
CREATE TABLE IF NOT EXISTS healthbot_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES healthbot_conversations(id) ON DELETE CASCADE,
  role VARCHAR(20) NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  -- Content (encrypted for privacy)
  content_encrypted TEXT NOT NULL,
  content_iv VARCHAR(32) NOT NULL,
  content_tag VARCHAR(32) NOT NULL,
  -- For generated content
  generated_content_type VARCHAR(30), -- 'email_draft', 'social_post', 'reply_suggestion'
  generated_content_id UUID, -- Reference to created content
  -- AI metadata
  model_used VARCHAR(50),
  tokens_used INTEGER,
  latency_ms INTEGER,
  -- Feedback
  user_rating INTEGER CHECK (user_rating BETWEEN 1 AND 5),
  user_feedback TEXT,
  was_used BOOLEAN, -- If generated content was actually used
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- HealthBot Knowledge Base (RAG)
CREATE TABLE IF NOT EXISTS healthbot_knowledge_base (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title VARCHAR(255) NOT NULL,
  content_type VARCHAR(30) NOT NULL CHECK (content_type IN ('faq', 'article', 'snippet', 'template', 'policy')),
  -- Content (NOT encrypted - this is public/general health info)
  content TEXT NOT NULL,
  summary TEXT,
  -- Vector embedding for RAG
  embedding VECTOR(1536), -- OpenAI embedding dimension
  -- Categorization
  category VARCHAR(100),
  tags TEXT[],
  -- Source
  source_url TEXT,
  source_name VARCHAR(255),
  -- Status
  is_active BOOLEAN DEFAULT true,
  is_verified BOOLEAN DEFAULT false,
  verified_by UUID REFERENCES users(id),
  verified_at TIMESTAMPTZ,
  -- Timestamps
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- PHI Redaction Log (audit trail for compliance)
CREATE TABLE IF NOT EXISTS phi_redaction_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  operation_type VARCHAR(30) NOT NULL, -- 'ai_query', 'export', 'share'
  original_hash VARCHAR(64), -- SHA-256 of original (for audit)
  redacted_fields TEXT[], -- List of redacted field types
  destination VARCHAR(100), -- 'openai', 'anthropic', etc.
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================================
-- SECTION 5: EMAIL TEMPLATES
-- ============================================================================

CREATE TABLE IF NOT EXISTS email_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  category VARCHAR(50) NOT NULL,
  subject VARCHAR(500) NOT NULL,
  body_html TEXT NOT NULL,
  body_text TEXT,
  -- Preview
  preview_text VARCHAR(200),
  thumbnail_url TEXT,
  -- Variables
  available_variables TEXT[], -- ['firstName', 'lastName', 'appointmentDate']
  -- Status
  is_active BOOLEAN DEFAULT true,
  is_system BOOLEAN DEFAULT false,
  -- Versioning
  version INTEGER DEFAULT 1,
  parent_template_id UUID REFERENCES email_templates(id),
  -- Creator
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================================
-- SECTION 6: UNSUBSCRIBE MANAGEMENT
-- ============================================================================

CREATE TABLE IF NOT EXISTS email_unsubscribes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email_hash VARCHAR(64) NOT NULL UNIQUE, -- SHA-256 of email for lookup
  user_id UUID REFERENCES users(id),
  reason VARCHAR(100),
  source VARCHAR(50), -- 'campaign', 'manual', 'bounce'
  campaign_id UUID REFERENCES campaigns(id),
  unsubscribed_at TIMESTAMPTZ DEFAULT NOW(),
  -- Resubscribe tracking
  resubscribed_at TIMESTAMPTZ,
  is_active BOOLEAN DEFAULT true
);

-- ============================================================================
-- INDEXES
-- ============================================================================

-- Email indexes
CREATE INDEX IF NOT EXISTS idx_email_threads_last_message ON email_threads(last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_email_threads_participants ON email_threads USING GIN(participant_ids);
CREATE INDEX IF NOT EXISTS idx_email_messages_thread ON email_messages(thread_id);
CREATE INDEX IF NOT EXISTS idx_email_messages_sender ON email_messages(sender_id);
CREATE INDEX IF NOT EXISTS idx_email_messages_sent_at ON email_messages(sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_email_tracking_message ON email_tracking_events(message_id);
CREATE INDEX IF NOT EXISTS idx_email_tracking_campaign ON email_tracking_events(campaign_id);

-- Social indexes
CREATE INDEX IF NOT EXISTS idx_social_connections_user ON social_connections(user_id);
CREATE INDEX IF NOT EXISTS idx_social_connections_platform ON social_connections(platform);
CREATE INDEX IF NOT EXISTS idx_social_posts_user ON social_posts(user_id);
CREATE INDEX IF NOT EXISTS idx_social_posts_scheduled ON social_posts(scheduled_for) WHERE status = 'scheduled';
CREATE INDEX IF NOT EXISTS idx_social_posts_campaign ON social_posts(campaign_id);

-- Campaign indexes
CREATE INDEX IF NOT EXISTS idx_campaigns_status ON campaigns(status);
CREATE INDEX IF NOT EXISTS idx_campaigns_scheduled ON campaigns(scheduled_at) WHERE status = 'scheduled';
CREATE INDEX IF NOT EXISTS idx_campaign_recipients_campaign ON campaign_recipients(campaign_id);
CREATE INDEX IF NOT EXISTS idx_campaign_recipients_status ON campaign_recipients(status);

-- HealthBot indexes
CREATE INDEX IF NOT EXISTS idx_healthbot_conversations_user ON healthbot_conversations(user_id);
CREATE INDEX IF NOT EXISTS idx_healthbot_messages_conversation ON healthbot_messages(conversation_id);

-- Knowledge base vector index (requires pgvector extension)
-- CREATE INDEX IF NOT EXISTS idx_knowledge_embedding ON healthbot_knowledge_base USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- Unsubscribe index
CREATE INDEX IF NOT EXISTS idx_unsubscribes_hash ON email_unsubscribes(email_hash);

-- ============================================================================
-- TRIGGERS
-- ============================================================================

-- Update thread timestamp on new message
CREATE OR REPLACE FUNCTION update_thread_on_message()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE email_threads
  SET 
    last_message_at = NEW.created_at,
    message_count = message_count + 1,
    updated_at = NOW()
  WHERE id = NEW.thread_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_thread_on_message
AFTER INSERT ON email_messages
FOR EACH ROW
EXECUTE FUNCTION update_thread_on_message();

-- Update conversation timestamp on new message
CREATE OR REPLACE FUNCTION update_conversation_on_message()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE healthbot_conversations
  SET 
    last_message_at = NEW.created_at,
    message_count = message_count + 1
  WHERE id = NEW.conversation_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_conversation_on_message
AFTER INSERT ON healthbot_messages
FOR EACH ROW
EXECUTE FUNCTION update_conversation_on_message();

-- ============================================================================
-- DEFAULT DATA
-- ============================================================================

-- Insert system email folders for new users (via application code)
-- Insert default segments
INSERT INTO campaign_segments (id, name, description, criteria, is_system)
VALUES 
  ('00000000-0000-0000-0000-000000000001', 'All Patients', 'All registered patients', '{"conditions": [{"field": "role", "op": "equals", "value": "patient"}]}', true),
  ('00000000-0000-0000-0000-000000000002', 'All Providers', 'All healthcare providers', '{"conditions": [{"field": "role", "op": "equals", "value": "provider"}]}', true),
  ('00000000-0000-0000-0000-000000000003', 'Active Patients', 'Patients with appointments in last 90 days', '{"conditions": [{"field": "role", "op": "equals", "value": "patient"}, {"field": "last_appointment", "op": "within_days", "value": 90}]}', true)
ON CONFLICT DO NOTHING;

