-- ============================================================
-- NIGERIA REGION: Provider discovery, payer directories,
-- medicine merchandising, and fallback support
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pg_trgm;

ALTER TABLE ng_drug_catalog
  ADD COLUMN IF NOT EXISTS source VARCHAR(50) DEFAULT 'ng_seed',
  ADD COLUMN IF NOT EXISTS source_med_code TEXT,
  ADD COLUMN IF NOT EXISTS route VARCHAR(100),
  ADD COLUMN IF NOT EXISTS therapeutic_class TEXT,
  ADD COLUMN IF NOT EXISTS symptom_tags TEXT[] DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN IF NOT EXISTS disease_tags TEXT[] DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN IF NOT EXISTS controlled BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS nhia_listed BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS otc_candidate BOOLEAN,
  ADD COLUMN IF NOT EXISTS pediatric_safe_hint BOOLEAN,
  ADD COLUMN IF NOT EXISTS pregnancy_caution BOOLEAN,
  ADD COLUMN IF NOT EXISTS price_ngn DECIMAL(12, 2),
  ADD COLUMN IF NOT EXISTS price_notes TEXT,
  ADD COLUMN IF NOT EXISTS featured_category TEXT,
  ADD COLUMN IF NOT EXISTS listing_status TEXT,
  ADD COLUMN IF NOT EXISTS access_mode TEXT,
  ADD COLUMN IF NOT EXISTS product_logic_note TEXT;

CREATE INDEX IF NOT EXISTS idx_ng_drugs_featured_category ON ng_drug_catalog (featured_category);
CREATE INDEX IF NOT EXISTS idx_ng_drugs_access_mode ON ng_drug_catalog (access_mode);
CREATE INDEX IF NOT EXISTS idx_ng_drugs_source_med_code ON ng_drug_catalog (source_med_code);
CREATE INDEX IF NOT EXISTS idx_ng_drugs_symptom_tags ON ng_drug_catalog USING GIN (symptom_tags);
CREATE INDEX IF NOT EXISTS idx_ng_drugs_disease_tags ON ng_drug_catalog USING GIN (disease_tags);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ng_drugs_name_unique ON ng_drug_catalog (name);

CREATE TABLE IF NOT EXISTS ng_payer_networks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dedupe_key TEXT NOT NULL UNIQUE,
  source TEXT NOT NULL,
  payer_name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  payer_type TEXT NOT NULL,
  payer_code TEXT,
  website TEXT,
  address_raw TEXT,
  email TEXT[] DEFAULT ARRAY[]::TEXT[],
  phone TEXT[] DEFAULT ARRAY[]::TEXT[],
  state TEXT,
  metadata JSONB DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ng_payers_name ON ng_payer_networks (normalized_name);
CREATE INDEX IF NOT EXISTS idx_ng_payers_type ON ng_payer_networks (payer_type);

CREATE TABLE IF NOT EXISTS ng_state_insurance_agencies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dedupe_key TEXT NOT NULL UNIQUE,
  source TEXT NOT NULL,
  agency_name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  website TEXT,
  address_raw TEXT,
  email TEXT[] DEFAULT ARRAY[]::TEXT[],
  phone TEXT[] DEFAULT ARRAY[]::TEXT[],
  state TEXT,
  metadata JSONB DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ng_state_agencies_name ON ng_state_insurance_agencies (normalized_name);
CREATE INDEX IF NOT EXISTS idx_ng_state_agencies_state ON ng_state_insurance_agencies (state);

CREATE TABLE IF NOT EXISTS ng_provider_match_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  match_key TEXT NOT NULL UNIQUE,
  canonical_name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  provider_type TEXT,
  provider_subtype TEXT,
  accreditation_authority TEXT,
  accreditation_status TEXT,
  address_raw TEXT,
  city TEXT,
  lga TEXT,
  state TEXT,
  country TEXT DEFAULT 'Nigeria',
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  geocode_quality TEXT DEFAULT 'unresolved',
  address_confidence TEXT DEFAULT 'unresolved',
  phone TEXT[] DEFAULT ARRAY[]::TEXT[],
  email TEXT[] DEFAULT ARRAY[]::TEXT[],
  website TEXT,
  opening_hours JSONB DEFAULT '{}'::JSONB,
  services JSONB DEFAULT '[]'::JSONB,
  specialties JSONB DEFAULT '[]'::JSONB,
  insurances JSONB DEFAULT '[]'::JSONB,
  payer_ids JSONB DEFAULT '[]'::JSONB,
  source_badges TEXT[] DEFAULT ARRAY[]::TEXT[],
  accepted_payment_types TEXT[] DEFAULT ARRAY['cash', 'self_pay']::TEXT[],
  telehealth_capable BOOLEAN DEFAULT false,
  emergency_capable BOOLEAN DEFAULT false,
  maternity_capable BOOLEAN DEFAULT false,
  pediatric_capable BOOLEAN DEFAULT false,
  optical_capable BOOLEAN DEFAULT false,
  dental_capable BOOLEAN DEFAULT false,
  pharmacy_relevant BOOLEAN DEFAULT false,
  lab_relevant BOOLEAN DEFAULT false,
  gym_spa BOOLEAN DEFAULT false,
  trust_score NUMERIC DEFAULT 0.50,
  popularity_score NUMERIC DEFAULT 0.50,
  data_confidence NUMERIC DEFAULT 0.50,
  source_count INTEGER DEFAULT 1,
  last_verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ng_provider_groups_name ON ng_provider_match_groups USING GIN (normalized_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_ng_provider_groups_state ON ng_provider_match_groups (state);
CREATE INDEX IF NOT EXISTS idx_ng_provider_groups_type ON ng_provider_match_groups (provider_type);
CREATE INDEX IF NOT EXISTS idx_ng_provider_groups_city ON ng_provider_match_groups (city);

CREATE TABLE IF NOT EXISTS ng_provider_directory_rows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  match_group_id UUID REFERENCES ng_provider_match_groups(id) ON DELETE CASCADE,
  dedupe_key TEXT NOT NULL UNIQUE,
  source TEXT NOT NULL,
  source_provider_id TEXT,
  provider_name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  provider_type TEXT,
  provider_subtype TEXT,
  accreditation_authority TEXT,
  accreditation_status TEXT,
  address_raw TEXT,
  street_address TEXT,
  city TEXT,
  lga TEXT,
  state TEXT,
  country TEXT DEFAULT 'Nigeria',
  postal_code TEXT,
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  geocode_quality TEXT,
  phone TEXT[] DEFAULT ARRAY[]::TEXT[],
  email TEXT[] DEFAULT ARRAY[]::TEXT[],
  website TEXT,
  opening_hours JSONB DEFAULT '{}'::JSONB,
  services JSONB DEFAULT '[]'::JSONB,
  specialties JSONB DEFAULT '[]'::JSONB,
  insurances JSONB DEFAULT '[]'::JSONB,
  payer_ids JSONB DEFAULT '[]'::JSONB,
  metadata JSONB DEFAULT '{}'::JSONB,
  telehealth_capable BOOLEAN DEFAULT false,
  emergency_capable BOOLEAN DEFAULT false,
  maternity_capable BOOLEAN DEFAULT false,
  pediatric_capable BOOLEAN DEFAULT false,
  optical_capable BOOLEAN DEFAULT false,
  dental_capable BOOLEAN DEFAULT false,
  gym_spa BOOLEAN DEFAULT false,
  trust_score NUMERIC DEFAULT 0.50,
  popularity_score NUMERIC DEFAULT 0.50,
  data_confidence NUMERIC DEFAULT 0.50,
  last_verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ng_provider_rows_group ON ng_provider_directory_rows (match_group_id);

CREATE TABLE IF NOT EXISTS ng_provider_search_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_session_id TEXT,
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  state TEXT,
  city TEXT,
  lga TEXT,
  query TEXT,
  symptom_tags TEXT[] DEFAULT ARRAY[]::TEXT[],
  preferred_provider_types TEXT[] DEFAULT ARRAY[]::TEXT[],
  sort_mode TEXT,
  location_source TEXT,
  selected_provider_id UUID,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ng_discovery_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type TEXT NOT NULL,
  session_id TEXT,
  provider_reference TEXT,
  med_reference TEXT,
  query TEXT,
  payload JSONB DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ng_discovery_events_type ON ng_discovery_events (event_type);
CREATE INDEX IF NOT EXISTS idx_ng_discovery_events_created ON ng_discovery_events (created_at DESC);

CREATE TABLE IF NOT EXISTS ng_care_fallback_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_type TEXT NOT NULL,
  contact_name TEXT,
  phone TEXT,
  email TEXT,
  preferred_contact_method TEXT,
  symptom TEXT,
  care_need TEXT,
  state TEXT,
  city TEXT,
  landmark TEXT,
  notes TEXT,
  status TEXT DEFAULT 'new',
  payload JSONB DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ng_fallback_requests_type ON ng_care_fallback_requests (request_type);
CREATE INDEX IF NOT EXISTS idx_ng_fallback_requests_created ON ng_care_fallback_requests (created_at DESC);
