create extension if not exists pgcrypto;

create table if not exists providers (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  source_provider_id text,
  provider_name text not null,
  normalized_name text,
  provider_type text,
  provider_subtype text,
  accreditation_authority text,
  accreditation_status text,
  address_raw text,
  street_address text,
  city text,
  lga text,
  state text,
  country text default 'Nigeria',
  postal_code text,
  latitude double precision,
  longitude double precision,
  geocode_quality text,
  phone text[],
  email text[],
  website text,
  opening_hours jsonb,
  services jsonb,
  specialties jsonb,
  insurances jsonb,
  payer_ids jsonb,
  pharmacy_inventory_hint jsonb,
  telehealth_capable boolean,
  emergency_capable boolean,
  maternity_capable boolean,
  pediatric_capable boolean,
  optical_capable boolean,
  dental_capable boolean,
  gym_spa boolean,
  trust_score numeric,
  popularity_score numeric,
  data_confidence numeric,
  last_verified_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists providers_state_idx on providers(state);
create index if not exists providers_type_idx on providers(provider_type);
create index if not exists providers_geo_idx on providers(latitude, longitude);

create table if not exists payer_networks (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  payer_name text not null,
  payer_type text not null, -- HMO, TPA, state_scheme, private_plan
  payer_code text,
  website text,
  address_raw text,
  email text[],
  phone text[],
  state text,
  metadata jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists med_catalog (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  source_med_code text,
  generic_name text not null,
  brand_name text,
  form text,
  strength text,
  route text,
  pack_size text,
  therapeutic_class text,
  symptom_tags text[],
  disease_tags text[],
  controlled boolean default false,
  prescription_required boolean default false,
  nhia_listed boolean default false,
  otc_candidate boolean,
  pediatric_safe_hint boolean,
  pregnancy_caution boolean,
  price_ngn numeric,
  price_notes text,
  metadata jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists med_catalog_generic_idx on med_catalog(generic_name);
create index if not exists med_catalog_class_idx on med_catalog(therapeutic_class);

create table if not exists service_price_catalog (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  code text,
  service_name text not null,
  specialty text,
  price_ngn numeric,
  metadata jsonb,
  created_at timestamptz default now()
);

create table if not exists provider_meds (
  provider_id uuid references providers(id) on delete cascade,
  med_id uuid references med_catalog(id) on delete cascade,
  stock_status text,
  stock_confidence numeric,
  price_ngn numeric,
  last_seen_at timestamptz,
  primary key(provider_id, med_id)
);

create table if not exists provider_search_logs (
  id uuid primary key default gen_random_uuid(),
  patient_session_id text,
  lat double precision,
  lng double precision,
  state text,
  query text,
  symptom_tags text[],
  preferred_provider_types text[],
  sort_mode text,
  selected_provider_id uuid,
  created_at timestamptz default now()
);
