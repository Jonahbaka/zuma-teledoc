-- DoctaRx Nigeria discovery schema starter
-- Adapt into the repo migration style. Use PostGIS geography when available; otherwise use Haversine over latitude/longitude.

CREATE TABLE IF NOT EXISTS ng_data_sources (
  id BIGSERIAL PRIMARY KEY,
  source_key TEXT NOT NULL UNIQUE,
  source_url TEXT NOT NULL,
  source_name TEXT NOT NULL,
  extracted_at TIMESTAMPTZ,
  notes TEXT
);

CREATE TABLE IF NOT EXISTS ng_hmos (
  id BIGSERIAL PRIMARY KEY,
  nhia_hmo_id TEXT UNIQUE,
  organization_name TEXT NOT NULL,
  website TEXT,
  address TEXT,
  email TEXT,
  phone TEXT,
  state_hint TEXT,
  source_url TEXT,
  extracted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ng_sshias (
  id BIGSERIAL PRIMARY KEY,
  state TEXT NOT NULL,
  organization_name TEXT NOT NULL,
  director TEXT,
  phone TEXT,
  email TEXT,
  website TEXT,
  address TEXT,
  source_url TEXT,
  extracted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (state, organization_name)
);

CREATE TABLE IF NOT EXISTS ng_providers (
  id BIGSERIAL PRIMARY KEY,
  external_source TEXT NOT NULL,
  external_id TEXT,
  provider_name TEXT NOT NULL,
  provider_type TEXT NOT NULL CHECK (provider_type IN ('hospital','clinic','pharmacy','laboratory','diagnostics','doctor','healthcare_provider')),
  state TEXT,
  lga TEXT,
  city TEXT,
  address TEXT,
  phone TEXT,
  email TEXT,
  website TEXT,
  accepts_nhia BOOLEAN DEFAULT false,
  accepts_cash BOOLEAN DEFAULT true,
  accepts_hmo BOOLEAN DEFAULT false,
  telehealth_enabled BOOLEAN DEFAULT false,
  verification_status TEXT NOT NULL DEFAULT 'seed' CHECK (verification_status IN ('seed','pending_manual_verification','verified','rejected','stale')),
  source_url TEXT,
  extracted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (external_source, provider_name, address)
);

CREATE TABLE IF NOT EXISTS ng_provider_locations (
  id BIGSERIAL PRIMARY KEY,
  provider_id BIGINT NOT NULL REFERENCES ng_providers(id) ON DELETE CASCADE,
  latitude NUMERIC(10,7),
  longitude NUMERIC(10,7),
  geocode_query TEXT,
  geocode_provider TEXT,
  geocode_confidence TEXT DEFAULT 'pending' CHECK (geocode_confidence IN ('exact','street','city','state','failed','pending')),
  geocoded_at TIMESTAMPTZ,
  UNIQUE (provider_id)
);

CREATE TABLE IF NOT EXISTS ng_medicines (
  id BIGSERIAL PRIMARY KEY,
  nhis_code TEXT UNIQUE,
  medicine_name TEXT NOT NULL,
  dosage_form TEXT,
  strength TEXT,
  presentation TEXT,
  category_hint TEXT,
  prescription_class TEXT NOT NULL DEFAULT 'clinical_review_required',
  searchable_text TEXT GENERATED ALWAYS AS (lower(coalesce(medicine_name,'') || ' ' || coalesce(strength,'') || ' ' || coalesce(dosage_form,''))) STORED,
  source_url TEXT,
  extracted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ng_featured_medicines (
  id BIGSERIAL PRIMARY KEY,
  display_order INTEGER NOT NULL,
  display_name TEXT NOT NULL,
  medicine_id BIGINT REFERENCES ng_medicines(id) ON DELETE SET NULL,
  use_case TEXT,
  safety_label TEXT NOT NULL,
  storefront_action TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  source_url TEXT,
  extracted_at TIMESTAMPTZ,
  UNIQUE (display_name)
);

CREATE TABLE IF NOT EXISTS ng_provider_medicine_availability (
  id BIGSERIAL PRIMARY KEY,
  provider_id BIGINT NOT NULL REFERENCES ng_providers(id) ON DELETE CASCADE,
  medicine_id BIGINT NOT NULL REFERENCES ng_medicines(id) ON DELETE CASCADE,
  availability_status TEXT NOT NULL DEFAULT 'unknown' CHECK (availability_status IN ('unknown','in_stock','low_stock','out_of_stock','call_to_confirm')),
  last_confirmed_at TIMESTAMPTZ,
  confirmation_source TEXT,
  UNIQUE (provider_id, medicine_id)
);

CREATE TABLE IF NOT EXISTS ng_location_search_events (
  id BIGSERIAL PRIMARY KEY,
  user_id TEXT,
  request_type TEXT NOT NULL,
  provider_type TEXT,
  state TEXT,
  lga TEXT,
  city TEXT,
  radius_km NUMERIC(6,2),
  used_device_location BOOLEAN DEFAULT false,
  result_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ng_providers_type_state_lga ON ng_providers(provider_type, state, lga);
CREATE INDEX IF NOT EXISTS idx_ng_provider_locations_lat_lng ON ng_provider_locations(latitude, longitude);
CREATE INDEX IF NOT EXISTS idx_ng_medicines_searchable ON ng_medicines(searchable_text);
CREATE INDEX IF NOT EXISTS idx_ng_featured_medicines_active_order ON ng_featured_medicines(active, display_order);
