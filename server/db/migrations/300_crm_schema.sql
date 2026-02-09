-- ═══════════════════════════════════════════════════════════════
--  CRM SCHEMA — AI Agent Customer Relationship Management
--  The Organism's outreach system
-- ═══════════════════════════════════════════════════════════════

-- Contacts: providers, investors, partners, leads
CREATE TABLE IF NOT EXISTS crm_contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Identity
  first_name VARCHAR(255),
  last_name VARCHAR(255),
  email VARCHAR(255),
  phone VARCHAR(50),
  title VARCHAR(255),          -- e.g. "MD", "RN", "NP", "Investor", "CEO"
  organization VARCHAR(255),    -- e.g. "Memorial Hospital", "Y Combinator"
  
  -- Classification
  contact_type VARCHAR(50) NOT NULL DEFAULT 'lead'
    CHECK (contact_type IN ('provider', 'investor', 'partner', 'lead', 'nurse', 'admin', 'influencer', 'media')),
  specialty VARCHAR(255),       -- e.g. "Family Medicine", "Cardiology", "Venture Capital"
  sub_type VARCHAR(100),        -- e.g. "MD", "DO", "NP", "PA", "VC", "Angel"
  
  -- Source
  source VARCHAR(100),          -- e.g. "linkedin_scrape", "npi_registry", "manual", "referral", "social_media"
  source_url TEXT,              -- Original URL where found
  source_agent VARCHAR(100),    -- Which agent found this contact
  
  -- Social media
  linkedin_url TEXT,
  twitter_handle VARCHAR(100),
  website TEXT,
  npi_number VARCHAR(20),       -- National Provider Identifier
  
  -- Location
  city VARCHAR(100),
  state VARCHAR(50),
  country VARCHAR(50) DEFAULT 'US',
  
  -- CRM Pipeline
  pipeline_stage VARCHAR(50) DEFAULT 'new'
    CHECK (pipeline_stage IN ('new', 'researching', 'outreach_queued', 'contacted', 'responded', 'interested', 'negotiating', 'converted', 'lost', 'nurturing')),
  lead_score INTEGER DEFAULT 0 CHECK (lead_score >= 0 AND lead_score <= 100),
  priority VARCHAR(20) DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'critical')),
  
  -- Tags & notes
  tags TEXT[] DEFAULT '{}',
  notes TEXT,
  
  -- Agent ownership
  assigned_agent VARCHAR(100),  -- Which agent "owns" this contact
  last_contacted_at TIMESTAMP,
  next_followup_at TIMESTAMP,
  
  -- Status
  is_active BOOLEAN DEFAULT true,
  opt_out BOOLEAN DEFAULT false,  -- CAN-SPAM compliance
  
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Outreach campaigns
CREATE TABLE IF NOT EXISTS crm_campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  name VARCHAR(255) NOT NULL,
  description TEXT,
  campaign_type VARCHAR(50) NOT NULL DEFAULT 'cold_email'
    CHECK (campaign_type IN ('cold_email', 'follow_up', 'newsletter', 'social_engage', 'investor_pitch', 'partnership')),
  
  -- Targeting
  target_contact_type VARCHAR(50),  -- 'provider', 'investor', etc.
  target_specialty VARCHAR(255),
  target_tags TEXT[],
  
  -- Email content
  subject_line TEXT,
  email_template TEXT,
  
  -- Schedule
  send_time VARCHAR(20) DEFAULT 'optimal',  -- 'immediate', 'optimal', 'scheduled'
  scheduled_at TIMESTAMP,
  daily_limit INTEGER DEFAULT 50,           -- Zoho rate limits
  
  -- Stats
  total_contacts INTEGER DEFAULT 0,
  emails_sent INTEGER DEFAULT 0,
  emails_opened INTEGER DEFAULT 0,
  emails_replied INTEGER DEFAULT 0,
  emails_bounced INTEGER DEFAULT 0,
  conversions INTEGER DEFAULT 0,
  
  -- Status
  status VARCHAR(20) DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'running', 'paused', 'completed', 'cancelled')),
  created_by VARCHAR(100),       -- Agent that created it
  approved_by VARCHAR(100),      -- Operator approval
  
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Individual outreach interactions
CREATE TABLE IF NOT EXISTS crm_interactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  contact_id UUID REFERENCES crm_contacts(id) ON DELETE CASCADE,
  campaign_id UUID REFERENCES crm_campaigns(id) ON DELETE SET NULL,
  
  -- What happened
  interaction_type VARCHAR(50) NOT NULL
    CHECK (interaction_type IN ('email_sent', 'email_opened', 'email_replied', 'email_bounced',
           'social_comment', 'social_like', 'social_follow', 'social_dm',
           'call_scheduled', 'meeting_booked', 'note_added', 'stage_changed',
           'presentation_sent', 'investor_deck_sent')),
  
  -- Content
  subject TEXT,
  content TEXT,
  reply_content TEXT,
  
  -- Email tracking
  message_id VARCHAR(255),       -- SMTP message ID
  email_status VARCHAR(20),      -- 'sent', 'delivered', 'opened', 'replied', 'bounced'
  
  -- Agent that performed this
  agent_type VARCHAR(100),
  
  -- Metadata
  metadata JSONB DEFAULT '{}',
  
  created_at TIMESTAMP DEFAULT NOW()
);

-- Email templates library
CREATE TABLE IF NOT EXISTS crm_email_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  name VARCHAR(255) NOT NULL,
  category VARCHAR(50) NOT NULL
    CHECK (category IN ('cold_outreach', 'follow_up', 'investor_pitch', 'partnership', 'provider_invite', 'nurse_invite', 'social_intro')),
  
  subject TEXT NOT NULL,
  body TEXT NOT NULL,            -- Supports {{first_name}}, {{organization}}, {{specialty}} placeholders
  
  -- Performance
  times_used INTEGER DEFAULT 0,
  open_rate DECIMAL(5,2) DEFAULT 0,
  reply_rate DECIMAL(5,2) DEFAULT 0,
  
  -- Created by AI or manual
  created_by VARCHAR(100) DEFAULT 'system',
  is_active BOOLEAN DEFAULT true,
  
  created_at TIMESTAMP DEFAULT NOW()
);

-- Social media engagement tracking
CREATE TABLE IF NOT EXISTS crm_social_engagements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  contact_id UUID REFERENCES crm_contacts(id) ON DELETE CASCADE,
  
  platform VARCHAR(50) NOT NULL,
  post_url TEXT,
  engagement_type VARCHAR(50) NOT NULL
    CHECK (engagement_type IN ('comment', 'like', 'share', 'follow', 'dm', 'mention', 'reply')),
  
  content TEXT,                  -- What we posted/commented
  response TEXT,                 -- Their response if any
  
  agent_type VARCHAR(100),
  status VARCHAR(20) DEFAULT 'completed',
  
  created_at TIMESTAMP DEFAULT NOW()
);

-- Scraping sources registry
CREATE TABLE IF NOT EXISTS crm_scrape_sources (
  id SERIAL PRIMARY KEY,
  
  name VARCHAR(255) NOT NULL,
  url TEXT NOT NULL,
  source_type VARCHAR(50) NOT NULL
    CHECK (source_type IN ('provider_directory', 'npi_registry', 'linkedin', 'twitter', 'hospital_staff', 'nursing_board', 'investor_list', 'accelerator', 'conference')),
  
  -- Scraping config
  scrape_frequency VARCHAR(20) DEFAULT 'weekly',
  last_scraped_at TIMESTAMP,
  contacts_found INTEGER DEFAULT 0,
  
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_crm_contacts_type ON crm_contacts(contact_type);
CREATE INDEX IF NOT EXISTS idx_crm_contacts_stage ON crm_contacts(pipeline_stage);
CREATE INDEX IF NOT EXISTS idx_crm_contacts_email ON crm_contacts(email);
CREATE INDEX IF NOT EXISTS idx_crm_contacts_agent ON crm_contacts(assigned_agent);
CREATE INDEX IF NOT EXISTS idx_crm_interactions_contact ON crm_interactions(contact_id);
CREATE INDEX IF NOT EXISTS idx_crm_interactions_campaign ON crm_interactions(campaign_id);
CREATE INDEX IF NOT EXISTS idx_crm_campaigns_status ON crm_campaigns(status);

-- Seed default scraping sources
INSERT INTO crm_scrape_sources (name, url, source_type) VALUES
  ('NPI Registry', 'https://npiregistry.cms.hhs.gov/', 'npi_registry'),
  ('Doximity Provider Directory', 'https://www.doximity.com/', 'provider_directory'),
  ('Zocdoc Provider Profiles', 'https://www.zocdoc.com/', 'provider_directory'),
  ('Healthgrades', 'https://www.healthgrades.com/', 'provider_directory'),
  ('Vitals.com', 'https://www.vitals.com/', 'provider_directory'),
  ('WebMD Provider Directory', 'https://doctor.webmd.com/', 'provider_directory'),
  ('LinkedIn Healthcare', 'https://www.linkedin.com/', 'linkedin'),
  ('Twitter Healthcare', 'https://twitter.com/', 'twitter'),
  ('AngelList Health', 'https://angel.co/', 'investor_list'),
  ('Y Combinator Companies', 'https://www.ycombinator.com/companies', 'accelerator'),
  ('Crunchbase Healthcare', 'https://www.crunchbase.com/', 'investor_list'),
  ('AANP (Nurse Practitioners)', 'https://www.aanp.org/', 'nursing_board'),
  ('AMA Physician Finder', 'https://www.ama-assn.org/', 'provider_directory'),
  ('Teladoc Providers', 'https://www.teladoc.com/', 'provider_directory'),
  ('Amwell Providers', 'https://www.amwell.com/', 'provider_directory'),
  ('MDLive Directory', 'https://www.mdlive.com/', 'provider_directory'),
  ('Healthcare Conference List', 'https://www.healthcareconferences.com/', 'conference')
ON CONFLICT DO NOTHING;

-- Seed default email templates
INSERT INTO crm_email_templates (name, category, subject, body, created_by) VALUES
(
  'Provider Cold Outreach',
  'cold_outreach',
  'Earn More, See More Patients — DoctaRx Telehealth Platform',
  'Hi {{first_name}},

I noticed your practice in {{specialty}} and wanted to reach out. DoctaRx is a new telehealth platform that is helping {{specialty}} providers like you expand their patient reach without the overhead.

Here''s what sets us apart:
• Instant credentialing (hours, not weeks)
• AI-powered patient matching
• Built-in e-prescribing & clinical documentation
• Keep 100% of your consultation fees

We''re currently onboarding providers and would love to have you. Would you be open to a quick 10-minute demo?

Best,
DoctaRx Team
info@doctarx.com | doctarx.com',
  'growth-agent'
),
(
  'Investor Cold Outreach',
  'investor_pitch',
  'DoctaRx — AI-First Telehealth Disrupting a $400B Market',
  'Hi {{first_name}},

I''m reaching out because {{organization}} has been active in digital health investing, and I believe DoctaRx aligns with your thesis.

DoctaRx is building the AI-first telehealth operating system:
• Autonomous AI agents handle operations, compliance, and growth
• Predictive patient intelligence reduces no-shows by 40%
• Provider marketplace with instant credentialing
• $79/visit model with 85%+ margins

We''re currently raising our seed round and would love to share our deck.

Would {{first_name}} be available for a brief call this week?

Best,
The DoctaRx Team
info@doctarx.com',
  'growth-agent'
),
(
  'Nurse Practitioner Outreach',
  'provider_invite',
  'NPs Welcome — Grow Your Practice with DoctaRx Telehealth',
  'Hi {{first_name}},

DoctaRx is actively welcoming Nurse Practitioners to our telehealth platform. We believe NPs are the backbone of accessible healthcare, and we''ve built tools specifically for your workflow.

Why NPs love DoctaRx:
• Full prescribing authority support
• AI-assisted SOAP notes
• Flexible scheduling — see patients from anywhere
• No franchise fees or platform cuts

Join 100+ providers already on the platform. Sign up takes less than 5 minutes.

Visit: doctarx.com/provider/register

Best,
DoctaRx Team',
  'growth-agent'
),
(
  'Follow Up #1',
  'follow_up',
  'Quick follow-up — DoctaRx Telehealth',
  'Hi {{first_name}},

Just following up on my previous email about DoctaRx. I understand you''re busy, so I''ll keep this brief.

We''re seeing strong early traction with {{specialty}} providers and I''d hate for you to miss the early-mover advantage.

Here''s a 2-min video overview: [link]

Happy to answer any questions. Just reply to this email.

Best,
DoctaRx Team',
  'growth-agent'
),
(
  'Investor Social Comment',
  'social_intro',
  'N/A — Social Media Comment Template',
  'Great insight, {{first_name}}. This aligns with what we''re building at DoctaRx — an AI-first telehealth platform where autonomous agents handle operations so doctors can focus on healing. The intersection of AI + healthcare is exactly where the next wave of value creation happens. Would love to connect.',
  'growth-agent'
)
ON CONFLICT DO NOTHING;
