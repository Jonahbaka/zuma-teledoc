-- =============================================================================
-- 013_ng_referral_network.sql
-- DoctaRx Referral Network (DRN)
-- Nationwide referral marketplace: agents, orgs, listings, referrals,
-- state machine, events, commissions, QR slips, specialist profiles.
--
-- Reuses: users(id), ng_providers(id), ng_hospitals(id), ng_jurisdictions(id).
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
DO $$ BEGIN CREATE TYPE drn_org_type AS ENUM (
  'hospital','clinic','lab','pharmacy','diagnostic_center',
  'specialist_practice','ambulance','community_health'
); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE drn_referral_status AS ENUM (
  'draft','sent','received','accepted','declined','scheduled',
  'in_progress','completed','cancelled','no_show','expired'
); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE drn_urgency AS ENUM (
  'routine','urgent','emergency'
); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE drn_agent_status AS ENUM (
  'pending','active','suspended','retired'
); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE drn_commission_status AS ENUM (
  'accrued','approved','paid','clawed_back','void'
); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------------------------------------------------------------------------
-- Receiving organisations (hospitals + non-hospital orgs: labs/pharms/etc.)
-- For hospitals, hospital_id back-references ng_hospitals to avoid duplication.
-- For non-hospital orgs, hospital_id is NULL and address fields live here.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS drn_organizations (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id         UUID UNIQUE REFERENCES ng_hospitals(id) ON DELETE CASCADE,
  jurisdiction_id     UUID REFERENCES ng_jurisdictions(id) ON DELETE SET NULL,
  org_type            drn_org_type NOT NULL,
  name                TEXT NOT NULL,
  slug                TEXT UNIQUE,
  contact_name        TEXT,
  contact_phone       TEXT,
  contact_email       TEXT,
  address_line        TEXT,
  city                TEXT,
  state               TEXT,
  lga                 TEXT,
  latitude            DECIMAL(10,8),
  longitude           DECIMAL(11,8),
  whatsapp_phone      TEXT,
  accepts_referrals   BOOLEAN DEFAULT TRUE,
  emergency_capable   BOOLEAN DEFAULT FALSE,
  open_hours_json     JSONB DEFAULT '{}'::JSONB,
  rating_avg          DECIMAL(3,2) DEFAULT 0,
  rating_count        INTEGER DEFAULT 0,
  active              BOOLEAN DEFAULT TRUE,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_drn_org_type   ON drn_organizations (org_type, active);
CREATE INDEX IF NOT EXISTS idx_drn_org_geo    ON drn_organizations (state, lga);
CREATE INDEX IF NOT EXISTS idx_drn_org_juris  ON drn_organizations (jurisdiction_id);
CREATE INDEX IF NOT EXISTS idx_drn_org_name_trgm
  ON drn_organizations USING GIN (name gin_trgm_ops);

-- ---------------------------------------------------------------------------
-- Marketplace listings — discoverable services offered by an org/specialist
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS drn_marketplace_listings (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     UUID NOT NULL REFERENCES drn_organizations(id) ON DELETE CASCADE,
  provider_id         UUID REFERENCES ng_providers(id) ON DELETE SET NULL,
  specialty           TEXT NOT NULL,          -- e.g. cardiology, obstetrics, mri, full_blood_count
  service_kind        TEXT NOT NULL,          -- consultation | imaging | lab | procedure | pharmacy
  title               TEXT NOT NULL,
  description         TEXT,
  price_min_naira     DECIMAL(12,2),
  price_max_naira     DECIMAL(12,2),
  avg_wait_minutes    INTEGER,
  accepts_emergency   BOOLEAN DEFAULT FALSE,
  accepts_insurance   BOOLEAN DEFAULT FALSE,
  hmo_codes           TEXT[],
  acceptance_rate     DECIMAL(5,2) DEFAULT 100.00,
  total_referrals     INTEGER DEFAULT 0,
  completed_referrals INTEGER DEFAULT 0,
  active              BOOLEAN DEFAULT TRUE,
  featured            BOOLEAN DEFAULT FALSE,
  featured_until      TIMESTAMPTZ,
  metadata_json       JSONB DEFAULT '{}'::JSONB,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_drn_listing_org       ON drn_marketplace_listings (organization_id, active);
CREATE INDEX IF NOT EXISTS idx_drn_listing_specialty ON drn_marketplace_listings (specialty, active);
CREATE INDEX IF NOT EXISTS idx_drn_listing_service   ON drn_marketplace_listings (service_kind, active);
CREATE INDEX IF NOT EXISTS idx_drn_listing_featured  ON drn_marketplace_listings (featured, featured_until);

-- ---------------------------------------------------------------------------
-- Field agents — humans who onboard patients & coordinate referrals
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS drn_agents (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  agent_code          TEXT UNIQUE NOT NULL,       -- short human code e.g. AMAC-A001
  full_name           TEXT NOT NULL,
  phone               TEXT NOT NULL,
  whatsapp_phone      TEXT,
  email               TEXT,
  home_jurisdiction   UUID REFERENCES ng_jurisdictions(id) ON DELETE SET NULL,
  posted_at_org       UUID REFERENCES drn_organizations(id) ON DELETE SET NULL,
  status              drn_agent_status DEFAULT 'pending',
  commission_rate     DECIMAL(5,2) DEFAULT 5.00,  -- % of referral service fee
  bank_name           TEXT,
  bank_account_number TEXT,
  bank_account_name   TEXT,
  total_referrals     INTEGER DEFAULT 0,
  total_completed     INTEGER DEFAULT 0,
  total_earned_naira  DECIMAL(15,2) DEFAULT 0,
  pending_payout      DECIMAL(15,2) DEFAULT 0,
  recruited_by        UUID REFERENCES drn_agents(id) ON DELETE SET NULL,
  notes               TEXT,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_drn_agents_status ON drn_agents (status);
CREATE INDEX IF NOT EXISTS idx_drn_agents_org    ON drn_agents (posted_at_org);
CREATE INDEX IF NOT EXISTS idx_drn_agents_juris  ON drn_agents (home_jurisdiction);

-- ---------------------------------------------------------------------------
-- The referral record itself + state machine
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS drn_referrals (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ref_code              TEXT UNIQUE NOT NULL,     -- short readable: DRN-2026-A8K3PQ
  status                drn_referral_status NOT NULL DEFAULT 'draft',
  urgency               drn_urgency NOT NULL DEFAULT 'routine',

  patient_user_id       UUID REFERENCES users(id) ON DELETE SET NULL,
  patient_name          TEXT,                     -- snapshot if no user record
  patient_phone         TEXT,
  patient_age           INTEGER,
  patient_sex           TEXT,

  originating_provider  UUID REFERENCES ng_providers(id) ON DELETE SET NULL,
  originating_org       UUID REFERENCES drn_organizations(id) ON DELETE SET NULL,
  originating_agent     UUID REFERENCES drn_agents(id) ON DELETE SET NULL,

  destination_org       UUID REFERENCES drn_organizations(id) ON DELETE SET NULL,
  destination_listing   UUID REFERENCES drn_marketplace_listings(id) ON DELETE SET NULL,
  destination_provider  UUID REFERENCES ng_providers(id) ON DELETE SET NULL,

  specialty             TEXT NOT NULL,
  service_kind          TEXT,
  reason                TEXT NOT NULL,
  clinical_summary      TEXT,
  attached_soap_id      UUID,                     -- soft FK to SOAP note
  attached_files_json   JSONB DEFAULT '[]'::JSONB,

  scheduled_at          TIMESTAMPTZ,
  completed_at          TIMESTAMPTZ,
  cancelled_at          TIMESTAMPTZ,
  cancellation_reason   TEXT,

  service_fee_naira     DECIMAL(12,2),
  match_score           DECIMAL(5,2),             -- 0..100 ai matching score
  match_reasoning_json  JSONB DEFAULT '{}'::JSONB,

  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW(),
  expires_at            TIMESTAMPTZ              -- auto-expire if not accepted
);

CREATE INDEX IF NOT EXISTS idx_drn_ref_status      ON drn_referrals (status);
CREATE INDEX IF NOT EXISTS idx_drn_ref_dest_org    ON drn_referrals (destination_org, status);
CREATE INDEX IF NOT EXISTS idx_drn_ref_origin_org  ON drn_referrals (originating_org, status);
CREATE INDEX IF NOT EXISTS idx_drn_ref_agent       ON drn_referrals (originating_agent);
CREATE INDEX IF NOT EXISTS idx_drn_ref_specialty   ON drn_referrals (specialty, urgency);
CREATE INDEX IF NOT EXISTS idx_drn_ref_created     ON drn_referrals (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_drn_ref_expires     ON drn_referrals (expires_at) WHERE status IN ('sent','received');

-- ---------------------------------------------------------------------------
-- Referral events (audit + state transitions)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS drn_referral_events (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  referral_id   UUID NOT NULL REFERENCES drn_referrals(id) ON DELETE CASCADE,
  actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  actor_kind    TEXT NOT NULL,            -- provider | agent | facility | patient | system
  event_kind    TEXT NOT NULL,            -- created | sent | viewed | accepted | declined | scheduled | arrived | completed | cancelled | no_show | qr_scanned
  from_status   drn_referral_status,
  to_status     drn_referral_status,
  notes         TEXT,
  payload_json  JSONB DEFAULT '{}'::JSONB,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_drn_events_ref     ON drn_referral_events (referral_id, created_at);
CREATE INDEX IF NOT EXISTS idx_drn_events_kind    ON drn_referral_events (event_kind);

-- ---------------------------------------------------------------------------
-- Commissions ledger (per referral, can split between agent / originator / platform)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS drn_commissions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  referral_id     UUID NOT NULL REFERENCES drn_referrals(id) ON DELETE CASCADE,
  beneficiary_kind TEXT NOT NULL,        -- agent | originating_provider | originating_org | platform
  agent_id        UUID REFERENCES drn_agents(id) ON DELETE SET NULL,
  provider_id     UUID REFERENCES ng_providers(id) ON DELETE SET NULL,
  organization_id UUID REFERENCES drn_organizations(id) ON DELETE SET NULL,
  amount_naira    DECIMAL(12,2) NOT NULL,
  rate_pct        DECIMAL(5,2),
  status          drn_commission_status NOT NULL DEFAULT 'accrued',
  approved_at     TIMESTAMPTZ,
  paid_at         TIMESTAMPTZ,
  payout_ref      TEXT,
  notes           TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_drn_comm_ref     ON drn_commissions (referral_id);
CREATE INDEX IF NOT EXISTS idx_drn_comm_agent   ON drn_commissions (agent_id, status);
CREATE INDEX IF NOT EXISTS idx_drn_comm_status  ON drn_commissions (status, created_at);

-- ---------------------------------------------------------------------------
-- QR / share tokens for patient-facing referral slips
-- token_hash stored, raw token shown once on creation. Pattern mirrors
-- ng_portal_access_tokens from migration 012.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS drn_qr_tokens (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  referral_id   UUID NOT NULL REFERENCES drn_referrals(id) ON DELETE CASCADE,
  token_hash    TEXT NOT NULL UNIQUE,
  token_prefix  TEXT NOT NULL,             -- first 8 chars for display
  scope         TEXT NOT NULL DEFAULT 'patient_slip', -- patient_slip | facility_verify
  created_by    UUID REFERENCES users(id) ON DELETE SET NULL,
  expires_at    TIMESTAMPTZ,
  used_at       TIMESTAMPTZ,
  scan_count    INTEGER DEFAULT 0,
  last_scanned_ip TEXT,
  revoked_at    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_drn_qr_ref     ON drn_qr_tokens (referral_id);
CREATE INDEX IF NOT EXISTS idx_drn_qr_expires ON drn_qr_tokens (expires_at);

-- ---------------------------------------------------------------------------
-- Specialist directory snapshot for AI matching (denormalized for speed)
-- Refreshed by service; rows keyed by provider_id.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS drn_specialist_profiles (
  provider_id          UUID PRIMARY KEY REFERENCES ng_providers(id) ON DELETE CASCADE,
  organization_id      UUID REFERENCES drn_organizations(id) ON DELETE SET NULL,
  specialty            TEXT NOT NULL,
  sub_specialty        TEXT,
  state                TEXT,
  lga                  TEXT,
  latitude             DECIMAL(10,8),
  longitude            DECIMAL(11,8),
  consult_fee_naira    DECIMAL(12,2),
  avg_wait_minutes     INTEGER,
  rating_avg           DECIMAL(3,2) DEFAULT 0,
  rating_count         INTEGER DEFAULT 0,
  acceptance_rate      DECIMAL(5,2) DEFAULT 100.00,
  total_referrals      INTEGER DEFAULT 0,
  completed_referrals  INTEGER DEFAULT 0,
  accepts_emergency    BOOLEAN DEFAULT FALSE,
  accepts_insurance    BOOLEAN DEFAULT FALSE,
  languages            TEXT[],
  refreshed_at         TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_drn_spec_specialty  ON drn_specialist_profiles (specialty, state);
CREATE INDEX IF NOT EXISTS idx_drn_spec_geo        ON drn_specialist_profiles (state, lga);

-- ---------------------------------------------------------------------------
-- Referral heatmap aggregate (materialized by service; one row per cell)
-- cell_key e.g. 'state:FCT|lga:AMAC|specialty:obstetrics|week:2026-21'
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS drn_heatmap_cells (
  cell_key       TEXT PRIMARY KEY,
  state          TEXT,
  lga            TEXT,
  specialty      TEXT,
  period_start   DATE,
  period_end     DATE,
  referral_count INTEGER DEFAULT 0,
  completed_count INTEGER DEFAULT 0,
  cancelled_count INTEGER DEFAULT 0,
  median_match_score DECIMAL(5,2),
  underserved_score  DECIMAL(5,2),   -- 0..100, higher = bigger gap
  refreshed_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_drn_heat_geo       ON drn_heatmap_cells (state, lga);
CREATE INDEX IF NOT EXISTS idx_drn_heat_specialty ON drn_heatmap_cells (specialty);
CREATE INDEX IF NOT EXISTS idx_drn_heat_period    ON drn_heatmap_cells (period_start, period_end);

-- ---------------------------------------------------------------------------
-- Seed minimal demo orgs in FCT to make portals usable on day one.
-- Idempotent via slug uniqueness.
-- ---------------------------------------------------------------------------
INSERT INTO drn_organizations
  (org_type, name, slug, city, state, lga, accepts_referrals, emergency_capable, contact_phone)
VALUES
  ('hospital','National Hospital Abuja','natl-hosp-abuja','Central Area','FCT','AMAC',TRUE,TRUE,'+2349000000001'),
  ('hospital','Maitama District Hospital','maitama-dh','Maitama','FCT','AMAC',TRUE,TRUE,'+2349000000002'),
  ('hospital','Wuse District Hospital','wuse-dh','Wuse','FCT','AMAC',TRUE,FALSE,'+2349000000003'),
  ('clinic','Lugbe PHC','lugbe-phc','Lugbe','FCT','AMAC',TRUE,FALSE,'+2349000000004'),
  ('lab','Clina-Lancet Lab Wuse','clina-lancet-wuse','Wuse','FCT','AMAC',TRUE,FALSE,'+2349000000005'),
  ('pharmacy','HealthPlus Garki','healthplus-garki','Garki','FCT','AMAC',TRUE,FALSE,'+2349000000006'),
  ('diagnostic_center','Bridge Clinic Diagnostics','bridge-diag','Jabi','FCT','AMAC',TRUE,FALSE,'+2349000000007')
ON CONFLICT (slug) DO NOTHING;
