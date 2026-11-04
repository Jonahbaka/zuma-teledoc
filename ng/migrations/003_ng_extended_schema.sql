-- ============================================================
-- NIGERIA REGION: Extended Schema v003
-- Adds: Organizations, Subscriptions, Providers, Hospitals,
--       Feature Flags, Sponsorships, Lab Referrals, Campaigns
-- ============================================================

-- ============================================================
-- ENUMS
-- ============================================================

DO $$ BEGIN CREATE TYPE ng_subscription_status AS ENUM (
  'trial', 'active', 'past_due', 'canceled', 'expired', 'failed_payment', 'pending'
); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE ng_org_type AS ENUM (
  'company', 'ngo', 'church', 'mosque', 'school', 'government',
  'association', 'hospital', 'cooperative', 'other'
); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE ng_org_status AS ENUM (
  'pending_review', 'active', 'suspended', 'rejected', 'deactivated'
); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE ng_member_status AS ENUM (
  'active', 'inactive', 'invited', 'suspended', 'removed'
); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE ng_provider_status AS ENUM (
  'pending', 'documents_submitted', 'under_review', 'verified', 'suspended', 'rejected'
); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE ng_hospital_status AS ENUM (
  'pending_review', 'documents_submitted', 'verified', 'active', 'suspended', 'rejected'
); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE ng_integration_status AS ENUM (
  'pending', 'sandbox', 'active', 'unavailable', 'failed'
); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE ng_sponsorship_status AS ENUM (
  'active', 'paused', 'expired', 'canceled'
); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================
-- SUBSCRIPTION PLANS
-- ============================================================

CREATE TABLE IF NOT EXISTS ng_subscription_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_key VARCHAR(50) UNIQUE NOT NULL, -- basic, standard, premium, starter, growth, enterprise...
  name VARCHAR(100) NOT NULL,
  target_role VARCHAR(30) NOT NULL, -- patient, organization, provider, pharmacy
  price_monthly DECIMAL(12,2),
  price_annual DECIMAL(12,2),
  currency VARCHAR(5) DEFAULT 'NGN',
  max_members INTEGER,           -- for org plans; NULL = unlimited
  max_consultations INTEGER,     -- -1 = unlimited
  features JSONB DEFAULT '[]',
  is_active BOOLEAN DEFAULT true,
  is_custom BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Seed default plans
INSERT INTO ng_subscription_plans (plan_key, name, target_role, price_monthly, max_consultations, features) VALUES
  ('patient_basic',     'Patient Basic',        'patient',  1000,  0,  '["Platform access","Pay-per-consult","Medication search","Prescription upload"]'),
  ('patient_standard',  'Patient Standard',     'patient',  2500,  1,  '["1 general consult/month","10% medication discount","Priority support","Health records"]'),
  ('patient_premium',   'Patient Premium',      'patient',  5000,  -1, '["Unlimited general consults","20% medication discount","Priority provider access","AI health insights","Family plan"]'),
  ('org_starter',       'Org Starter',          'organization', 40000, NULL, '["Up to 25 members","Admin dashboard","Usage summaries","Billing management"]'),
  ('org_growth',        'Org Growth',           'organization', 120000, NULL, '["Up to 100 members","Bulk CSV upload","Role management","Care access groups","Invoice generation"]'),
  ('org_enterprise',    'Org Enterprise',       'organization', NULL, NULL, '["Unlimited members","Custom pricing","Dedicated manager","Custom SLA","AI analytics","On-site campaigns"]'),
  ('provider_basic',    'Provider Basic',        'provider', 10000, NULL, '["Provider dashboard","Appointment management","Digital prescriptions","Basic earnings tracking"]'),
  ('provider_pro',      'Provider Pro',          'provider', 30000, NULL, '["Featured listing","Priority routing","Advanced analytics","10% commission rate","AI clinical notes","T+1 payout"]'),
  ('pharmacy_starter',  'Pharmacy Starter',      'pharmacy', 10000, NULL, '["Dashboard access","Prescription queue","Basic inventory","T+5 settlement","50 orders/month"]'),
  ('pharmacy_growth',   'Pharmacy Growth',       'pharmacy', 30000, NULL, '["Unlimited orders","Featured placement","Advanced analytics","T+3 settlement","Delivery integration"]'),
  ('pharmacy_enterprise','Pharmacy Enterprise',  'pharmacy', 50000, NULL, '["API access","Custom sub-accounts","T+1 settlement","Priority support","Bulk dispensing"]')
ON CONFLICT (plan_key) DO NOTHING;

-- ============================================================
-- SUBSCRIPTIONS
-- ============================================================

CREATE TABLE IF NOT EXISTS ng_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subscriber_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  subscriber_org_id UUID,  -- FK to ng_organizations (added later)
  plan_id UUID REFERENCES ng_subscription_plans(id),
  plan_key VARCHAR(50),

  status ng_subscription_status DEFAULT 'pending',
  billing_cycle VARCHAR(10) DEFAULT 'monthly', -- monthly, annual

  -- Pricing (captured at creation — supports custom contracts)
  amount_per_period DECIMAL(12,2) NOT NULL,
  currency VARCHAR(5) DEFAULT 'NGN',
  max_members INTEGER,

  -- Dates
  trial_ends_at TIMESTAMPTZ,
  current_period_start TIMESTAMPTZ DEFAULT NOW(),
  current_period_end TIMESTAMPTZ,
  canceled_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,

  -- Payment
  payment_provider VARCHAR(20), -- paystack, flutterwave
  payment_customer_id VARCHAR(100),
  payment_plan_id VARCHAR(100),
  payment_subscription_id VARCHAR(100),
  last_payment_reference VARCHAR(100),
  last_payment_at TIMESTAMPTZ,
  next_payment_at TIMESTAMPTZ,
  failed_payment_attempts INTEGER DEFAULT 0,

  -- Admin overrides
  admin_notes TEXT,
  admin_overridden_by UUID REFERENCES users(id),
  custom_contract BOOLEAN DEFAULT false,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ng_subs_user ON ng_subscriptions (subscriber_user_id);
CREATE INDEX IF NOT EXISTS idx_ng_subs_org ON ng_subscriptions (subscriber_org_id);
CREATE INDEX IF NOT EXISTS idx_ng_subs_status ON ng_subscriptions (status);
CREATE INDEX IF NOT EXISTS idx_ng_subs_plan ON ng_subscriptions (plan_key);

-- ============================================================
-- ORGANIZATIONS
-- ============================================================

CREATE TABLE IF NOT EXISTS ng_organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  slug VARCHAR(255) UNIQUE NOT NULL,
  type ng_org_type NOT NULL DEFAULT 'company',
  status ng_org_status DEFAULT 'pending_review',

  -- Admin contact
  owner_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  admin_name VARCHAR(255) NOT NULL,
  admin_email VARCHAR(255) NOT NULL,
  admin_phone VARCHAR(20) NOT NULL,
  admin_title VARCHAR(100),

  -- Location
  address_line1 VARCHAR(255),
  address_line2 VARCHAR(255),
  city VARCHAR(100),
  state VARCHAR(50),
  lga VARCHAR(100),
  country VARCHAR(50) DEFAULT 'Nigeria',

  -- Contact
  email VARCHAR(255),
  phone VARCHAR(20),
  website VARCHAR(255),

  -- Legal
  rc_number VARCHAR(50),          -- CAC Registration Number
  tax_id VARCHAR(50),

  -- Plan
  subscription_id UUID REFERENCES ng_subscriptions(id),
  plan_key VARCHAR(50) DEFAULT 'org_starter',
  member_limit INTEGER DEFAULT 25,
  active_member_count INTEGER DEFAULT 0,

  -- Add-ons (JSONB flags)
  add_ons JSONB DEFAULT '{}',
  -- { priority_doctor: bool, chronic_care: bool, ai_analytics: bool }

  -- Billing
  billing_cycle VARCHAR(10) DEFAULT 'monthly',
  custom_pricing BOOLEAN DEFAULT false,
  custom_contract_notes TEXT,

  -- Verification
  verified_at TIMESTAMPTZ,
  verified_by UUID REFERENCES users(id),
  rejection_reason TEXT,

  logo_url TEXT,
  description TEXT,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ng_orgs_status ON ng_organizations (status);
CREATE INDEX IF NOT EXISTS idx_ng_orgs_type ON ng_organizations (type);
CREATE INDEX IF NOT EXISTS idx_ng_orgs_slug ON ng_organizations (slug);

-- FK from subscriptions to orgs
DO $$ BEGIN
  ALTER TABLE ng_subscriptions ADD CONSTRAINT fk_subs_org
    FOREIGN KEY (subscriber_org_id) REFERENCES ng_organizations(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================
-- ORGANIZATION MEMBERS
-- ============================================================

DO $$ BEGIN CREATE TYPE ng_org_role AS ENUM (
  'owner', 'admin', 'hr', 'billing_manager', 'member'
); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS ng_organization_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES ng_organizations(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,

  -- Invite info (before user creates account)
  invite_email VARCHAR(255),
  invite_phone VARCHAR(20),
  invite_token VARCHAR(100) UNIQUE,
  invited_at TIMESTAMPTZ,

  -- Member info
  full_name VARCHAR(255),
  employee_id VARCHAR(50),
  department VARCHAR(100),
  designation VARCHAR(100),

  role ng_org_role DEFAULT 'member',
  status ng_member_status DEFAULT 'invited',

  -- Access group / plan tier within org
  access_group VARCHAR(50) DEFAULT 'standard',
  care_credits INTEGER DEFAULT 0, -- consultation credits from org

  -- Dates
  joined_at TIMESTAMPTZ,
  last_active_at TIMESTAMPTZ,
  removed_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ng_org_members_org ON ng_organization_members (org_id);
CREATE INDEX IF NOT EXISTS idx_ng_org_members_user ON ng_organization_members (user_id);
CREATE INDEX IF NOT EXISTS idx_ng_org_members_status ON ng_organization_members (status);

-- ============================================================
-- PROVIDERS (Nigeria)
-- ============================================================

DO $$ BEGIN CREATE TYPE ng_provider_specialty AS ENUM (
  'general_practice', 'internal_medicine', 'pediatrics', 'obstetrics_gynecology',
  'cardiology', 'dermatology', 'psychiatry', 'orthopedics', 'ophthalmology',
  'ent', 'urology', 'neurology', 'oncology', 'radiology', 'surgery', 'other'
); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS ng_providers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID UNIQUE REFERENCES users(id) ON DELETE CASCADE,

  -- Personal
  full_name VARCHAR(255) NOT NULL,
  email VARCHAR(255) NOT NULL,
  phone VARCHAR(20) NOT NULL,
  photo_url TEXT,
  gender VARCHAR(20),
  mdcn_number VARCHAR(50) UNIQUE,    -- MDCN Folio Number

  -- Specialty
  specialty ng_provider_specialty DEFAULT 'general_practice',
  sub_specialty VARCHAR(100),
  years_experience INTEGER DEFAULT 0,
  qualifications JSONB DEFAULT '[]',  -- [{degree, institution, year}]

  -- Location / Practice
  practice_name VARCHAR(255),
  practice_address VARCHAR(255),
  practice_city VARCHAR(100),
  practice_state VARCHAR(50),
  primary_hospital_id UUID,           -- FK to ng_hospitals

  -- Status
  status ng_provider_status DEFAULT 'pending',
  rejection_reason TEXT,
  verified_at TIMESTAMPTZ,
  verified_by UUID REFERENCES users(id),

  -- Availability
  is_available BOOLEAN DEFAULT false,
  availability_schedule JSONB DEFAULT '{}',
  consult_fee_general DECIMAL(12,2) DEFAULT 3000,
  consult_fee_specialist DECIMAL(12,2) DEFAULT 8000,

  -- Monetization
  subscription_id UUID REFERENCES ng_subscriptions(id),
  plan_key VARCHAR(50) DEFAULT 'provider_basic',
  commission_rate DECIMAL(5,2) DEFAULT 15.00,  -- platform commission %
  is_featured BOOLEAN DEFAULT false,
  featured_expires_at TIMESTAMPTZ,

  -- Earnings (summary; detail in ng_provider_earnings)
  total_consultations INTEGER DEFAULT 0,
  total_earned DECIMAL(15,2) DEFAULT 0,
  total_paid_out DECIMAL(15,2) DEFAULT 0,
  pending_payout DECIMAL(15,2) DEFAULT 0,

  -- Bank for payouts
  bank_name VARCHAR(100),
  bank_account_number VARCHAR(20),
  bank_account_name VARCHAR(255),
  bank_code VARCHAR(10),

  bio TEXT,
  languages TEXT[],

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ng_providers_status ON ng_providers (status);
CREATE INDEX IF NOT EXISTS idx_ng_providers_specialty ON ng_providers (specialty);
CREATE INDEX IF NOT EXISTS idx_ng_providers_state ON ng_providers (practice_state);
CREATE INDEX IF NOT EXISTS idx_ng_providers_featured ON ng_providers (is_featured);

-- Provider earnings ledger
CREATE TABLE IF NOT EXISTS ng_provider_earnings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id UUID NOT NULL REFERENCES ng_providers(id) ON DELETE CASCADE,
  appointment_id UUID,              -- FK to appointments when built
  patient_user_id UUID REFERENCES users(id),

  consult_amount DECIMAL(12,2) NOT NULL,
  platform_commission DECIMAL(12,2) NOT NULL,
  provider_net DECIMAL(12,2) NOT NULL,

  status VARCHAR(20) DEFAULT 'pending', -- pending, paid_out, held
  payment_reference VARCHAR(100),
  paid_out_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ng_provider_earnings_provider ON ng_provider_earnings (provider_id);
CREATE INDEX IF NOT EXISTS idx_ng_provider_earnings_status ON ng_provider_earnings (status);

-- ============================================================
-- HOSPITALS / CLINICS
-- ============================================================

CREATE TABLE IF NOT EXISTS ng_hospitals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  slug VARCHAR(255) UNIQUE NOT NULL,
  facility_type VARCHAR(50) NOT NULL,
  status ng_hospital_status DEFAULT 'pending_review',

  -- Owner / Contact person
  owner_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  contact_name VARCHAR(255) NOT NULL,
  contact_email VARCHAR(255) NOT NULL,
  contact_phone VARCHAR(20) NOT NULL,
  contact_title VARCHAR(100),

  -- Location
  address_line1 VARCHAR(255) NOT NULL,
  address_line2 VARCHAR(255),
  city VARCHAR(100) NOT NULL,
  state VARCHAR(50) NOT NULL,
  lga VARCHAR(100),
  latitude DECIMAL(10,8),
  longitude DECIMAL(11,8),

  -- Contact
  phone VARCHAR(20),
  email VARCHAR(255),
  website VARCHAR(255),

  -- Licensing
  nhis_code VARCHAR(50),
  cac_number VARCHAR(50),
  facility_license_number VARCHAR(50),
  license_expiry DATE,

  -- Departments (JSONB)
  departments JSONB DEFAULT '[]',
  bed_count INTEGER,
  has_pharmacy BOOLEAN DEFAULT false,
  has_lab BOOLEAN DEFAULT false,

  -- Verification
  verified_at TIMESTAMPTZ,
  verified_by UUID REFERENCES users(id),
  rejection_reason TEXT,

  -- Monetization
  is_featured BOOLEAN DEFAULT false,
  featured_expires_at TIMESTAMPTZ,
  subscription_id UUID REFERENCES ng_subscriptions(id),

  -- Integration (FHIR / future)
  integration_status ng_integration_status DEFAULT 'pending',
  fhir_endpoint TEXT,
  integration_notes TEXT,

  logo_url TEXT,
  description TEXT,
  total_staff INTEGER DEFAULT 0,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ng_hospitals_status ON ng_hospitals (status);
CREATE INDEX IF NOT EXISTS idx_ng_hospitals_state ON ng_hospitals (state);
CREATE INDEX IF NOT EXISTS idx_ng_hospitals_slug ON ng_hospitals (slug);

-- FK from providers to hospitals
DO $$ BEGIN
  ALTER TABLE ng_providers ADD CONSTRAINT fk_provider_hospital
    FOREIGN KEY (primary_hospital_id) REFERENCES ng_hospitals(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Hospital staff
DO $$ BEGIN CREATE TYPE ng_staff_role AS ENUM (
  'doctor', 'nurse', 'pharmacist', 'lab_technician', 'receptionist', 'admin', 'other'
); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS ng_hospital_staff (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id UUID NOT NULL REFERENCES ng_hospitals(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  provider_id UUID REFERENCES ng_providers(id) ON DELETE SET NULL,

  full_name VARCHAR(255) NOT NULL,
  email VARCHAR(255),
  phone VARCHAR(20),
  role ng_staff_role DEFAULT 'doctor',
  department VARCHAR(100),
  designation VARCHAR(100),
  mdcn_or_license VARCHAR(50),

  status VARCHAR(20) DEFAULT 'active',
  joined_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ng_hospital_staff_hospital ON ng_hospital_staff (hospital_id);
CREATE INDEX IF NOT EXISTS idx_ng_hospital_staff_role ON ng_hospital_staff (role);

-- ============================================================
-- APPOINTMENTS (Nigeria)
-- ============================================================

DO $$ BEGIN CREATE TYPE ng_appointment_type AS ENUM (
  'general', 'specialist', 'follow_up', 'mental_health', 'pediatric', 'maternal'
); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE ng_appointment_mode AS ENUM (
  'video', 'audio', 'chat', 'in_person'
); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE ng_appointment_status AS ENUM (
  'pending', 'confirmed', 'in_progress', 'completed', 'canceled', 'no_show', 'rescheduled'
); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS ng_appointments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_user_id UUID NOT NULL REFERENCES users(id),
  provider_id UUID NOT NULL REFERENCES ng_providers(id),
  hospital_id UUID REFERENCES ng_hospitals(id),

  appointment_type ng_appointment_type DEFAULT 'general',
  mode ng_appointment_mode DEFAULT 'video',
  status ng_appointment_status DEFAULT 'pending',

  scheduled_at TIMESTAMPTZ NOT NULL,
  duration_minutes INTEGER DEFAULT 30,
  timezone VARCHAR(50) DEFAULT 'Africa/Lagos',

  chief_complaint TEXT,
  notes TEXT,

  -- Fees
  consult_fee DECIMAL(12,2) NOT NULL,
  platform_fee DECIMAL(12,2) DEFAULT 0,
  total_amount DECIMAL(12,2) NOT NULL,

  -- Payment
  payment_status VARCHAR(20) DEFAULT 'pending',
  payment_reference VARCHAR(100),
  paid_at TIMESTAMPTZ,
  payment_provider VARCHAR(20),

  -- Subscription
  covered_by_subscription BOOLEAN DEFAULT false,
  subscription_id UUID REFERENCES ng_subscriptions(id),
  org_member_id UUID REFERENCES ng_organization_members(id),

  -- Video call
  call_room_id VARCHAR(100),
  call_started_at TIMESTAMPTZ,
  call_ended_at TIMESTAMPTZ,

  -- Outcome
  diagnosis TEXT,
  prescription_id UUID REFERENCES ng_prescriptions(id),
  follow_up_recommended BOOLEAN DEFAULT false,
  follow_up_date DATE,

  cancellation_reason TEXT,
  canceled_by VARCHAR(20),   -- patient, provider, system
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ng_appt_patient ON ng_appointments (patient_user_id);
CREATE INDEX IF NOT EXISTS idx_ng_appt_provider ON ng_appointments (provider_id);
CREATE INDEX IF NOT EXISTS idx_ng_appt_status ON ng_appointments (status);
CREATE INDEX IF NOT EXISTS idx_ng_appt_scheduled ON ng_appointments (scheduled_at);

-- ============================================================
-- FEATURE FLAGS
-- ============================================================

CREATE TABLE IF NOT EXISTS ng_feature_flags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  feature_key VARCHAR(100) UNIQUE NOT NULL,
  display_name VARCHAR(255) NOT NULL,
  description TEXT,
  status VARCHAR(30) DEFAULT 'nigeria_pending',
  -- available, coming_soon, admin_only, provider_only, pharmacy_only,
  -- corporate_only, us_only, nigeria_pending, subscription_required, plan_restricted
  required_plan VARCHAR(50),          -- e.g., patient_premium
  required_role VARCHAR(30),
  enabled_for_org_ids UUID[],
  enabled_for_user_ids UUID[],
  notes TEXT,
  updated_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Seed core feature flags
INSERT INTO ng_feature_flags (feature_key, display_name, status) VALUES
  ('video_consultation',    'Video Consultation',           'nigeria_pending'),
  ('ai_triage',             'AI Triage',                    'nigeria_pending'),
  ('ai_clinical_notes',     'AI Clinical Notes',            'provider_only'),
  ('iprescribe_integration','iPrescribe Integration',       'us_only'),
  ('nhia_hmo',              'NHIA/HMO Integration',         'nigeria_pending'),
  ('fhir_r4',               'FHIR R4 Interoperability',     'nigeria_pending'),
  ('whatsapp_dispense',     'WhatsApp Dispense Flow',       'nigeria_pending'),
  ('lab_referrals',         'Lab & Diagnostic Referrals',   'nigeria_pending'),
  ('health_campaigns',      'Corporate Health Campaigns',   'coming_soon'),
  ('insurance_claims',      'Insurance Claims',             'us_only'),
  ('prior_auth',            'Prior Authorization',          'us_only'),
  ('epic_integration',      'Epic EHR Integration',         'us_only'),
  ('cerner_integration',    'Cerner Integration',           'us_only'),
  ('imaging_review',        'Medical Imaging Review',       'nigeria_pending'),
  ('ai_analytics',          'AI Health Analytics Dashboard','plan_restricted'),
  ('bulk_member_upload',    'Bulk Member CSV Upload',       'available'),
  ('subscription_management','Subscription Management',     'available'),
  ('digital_prescriptions', 'Digital Prescriptions',        'available'),
  ('pharmacy_search',       'Pharmacy Search',              'available'),
  ('appointment_booking',   'Appointment Booking',          'available')
ON CONFLICT (feature_key) DO NOTHING;

-- ============================================================
-- SPONSORSHIPS / FEATURED LISTINGS
-- ============================================================

CREATE TABLE IF NOT EXISTS ng_sponsorships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type VARCHAR(30) NOT NULL,  -- hospital, pharmacy, provider, medication
  entity_id UUID NOT NULL,
  entity_name VARCHAR(255),

  status ng_sponsorship_status DEFAULT 'active',
  visibility_level VARCHAR(20) DEFAULT 'standard', -- standard, premium, platinum

  price_monthly DECIMAL(12,2) NOT NULL,
  currency VARCHAR(5) DEFAULT 'NGN',

  starts_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ends_at TIMESTAMPTZ NOT NULL,

  payment_reference VARCHAR(100),
  paid_at TIMESTAMPTZ,

  -- Display
  badge_label VARCHAR(50) DEFAULT 'Sponsored',
  priority_rank INTEGER DEFAULT 100,

  admin_notes TEXT,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ng_sponsor_entity ON ng_sponsorships (entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_ng_sponsor_status ON ng_sponsorships (status);
CREATE INDEX IF NOT EXISTS idx_ng_sponsor_ends ON ng_sponsorships (ends_at);

-- ============================================================
-- DIGITAL PRESCRIPTIONS (NG Provider-generated)
-- ============================================================

CREATE TABLE IF NOT EXISTS ng_digital_prescriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id UUID NOT NULL REFERENCES ng_providers(id),
  patient_user_id UUID NOT NULL REFERENCES users(id),
  appointment_id UUID REFERENCES ng_appointments(id),

  prescription_number VARCHAR(50) UNIQUE,
  prescription_date DATE DEFAULT CURRENT_DATE,
  expires_at DATE DEFAULT (CURRENT_DATE + 30),

  -- Medications
  items JSONB NOT NULL DEFAULT '[]',
  -- [{drug_name, generic_name, dosage, frequency, duration, quantity, notes, drug_id}]

  -- Routing
  preferred_pharmacy_id UUID REFERENCES ng_pharmacies(id),
  routed_pharmacy_id UUID REFERENCES ng_pharmacies(id),
  routed_at TIMESTAMPTZ,

  -- Status
  status VARCHAR(30) DEFAULT 'active',
  -- active, routed, dispensing, dispensed, partially_dispensed, canceled, expired

  dispense_status VARCHAR(30) DEFAULT 'pending',
  dispensed_at TIMESTAMPTZ,
  dispensed_by_pharmacy_id UUID REFERENCES ng_pharmacies(id),

  -- Order
  order_id UUID REFERENCES ng_orders(id),

  diagnosis VARCHAR(255),
  notes TEXT,
  is_controlled BOOLEAN DEFAULT false,
  requires_id_verification BOOLEAN DEFAULT false,
  refill_count INTEGER DEFAULT 0,
  max_refills INTEGER DEFAULT 0,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ng_digirx_provider ON ng_digital_prescriptions (provider_id);
CREATE INDEX IF NOT EXISTS idx_ng_digirx_patient ON ng_digital_prescriptions (patient_user_id);
CREATE INDEX IF NOT EXISTS idx_ng_digirx_status ON ng_digital_prescriptions (status);
CREATE INDEX IF NOT EXISTS idx_ng_digirx_number ON ng_digital_prescriptions (prescription_number);

-- ============================================================
-- WHATSAPP DISPENSE SERVICE LAYER
-- ============================================================

CREATE TABLE IF NOT EXISTS ng_whatsapp_dispense_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prescription_id UUID REFERENCES ng_digital_prescriptions(id),
  pharmacy_id UUID REFERENCES ng_pharmacies(id),
  patient_user_id UUID REFERENCES users(id),

  patient_phone VARCHAR(20) NOT NULL,
  pharmacy_whatsapp VARCHAR(20),

  status VARCHAR(30) DEFAULT 'pending',
  -- pending, sent_to_pharmacy, pharmacy_confirmed, ready_for_pickup, dispensed, failed

  message_sent_at TIMESTAMPTZ,
  pharmacy_responded_at TIMESTAMPTZ,
  dispense_confirmed_at TIMESTAMPTZ,

  -- WhatsApp provider integration (future)
  wa_provider VARCHAR(30),           -- e.g., twilio, meta_cloud, whatsapp_business
  wa_message_id VARCHAR(100),
  wa_status VARCHAR(30),

  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- LAB REFERRALS
-- ============================================================

CREATE TABLE IF NOT EXISTS ng_lab_referrals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id UUID REFERENCES ng_providers(id),
  patient_user_id UUID NOT NULL REFERENCES users(id),
  appointment_id UUID REFERENCES ng_appointments(id),

  lab_name VARCHAR(255),
  lab_address TEXT,

  tests JSONB DEFAULT '[]',          -- [{test_name, test_code, urgency}]
  diagnosis_context TEXT,
  notes TEXT,

  status VARCHAR(30) DEFAULT 'issued',
  -- issued, sent_to_lab, sample_collected, results_ready, results_reviewed

  commission_percent DECIMAL(5,2) DEFAULT 10.00,
  lab_fee DECIMAL(12,2),
  platform_commission DECIMAL(12,2),

  results_url TEXT,
  results_received_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ng_lab_patient ON ng_lab_referrals (patient_user_id);
CREATE INDEX IF NOT EXISTS idx_ng_lab_status ON ng_lab_referrals (status);

-- ============================================================
-- HOSPITAL INTEGRATIONS
-- ============================================================

CREATE TABLE IF NOT EXISTS ng_hospital_integrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id UUID NOT NULL REFERENCES ng_hospitals(id) ON DELETE CASCADE,

  integration_type VARCHAR(30) NOT NULL,
  -- manual, api, fhir_r4, whatsapp_assisted, hl7_v2

  status ng_integration_status DEFAULT 'pending',
  capabilities JSONB DEFAULT '[]',
  -- [referrals, care_summaries, medications, lab_results, encounters]

  endpoint_url TEXT,
  auth_type VARCHAR(20),             -- oauth2, api_key, smart_fhir, none
  last_sync_at TIMESTAMPTZ,
  last_error TEXT,
  last_test_at TIMESTAMPTZ,

  admin_notes TEXT,
  configured_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- HEALTH CAMPAIGNS
-- ============================================================

CREATE TABLE IF NOT EXISTS ng_health_campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID REFERENCES ng_organizations(id),
  hospital_id UUID REFERENCES ng_hospitals(id),

  title VARCHAR(255) NOT NULL,
  description TEXT,
  campaign_type VARCHAR(50),
  -- corporate_wellness, community_drive, church_health_day, school_screening

  location TEXT,
  state VARCHAR(50),
  lga VARCHAR(100),

  scheduled_at TIMESTAMPTZ,
  duration_hours INTEGER,

  fee DECIMAL(12,2),
  payment_status VARCHAR(20) DEFAULT 'pending',
  payment_reference VARCHAR(100),

  status VARCHAR(20) DEFAULT 'planned',
  -- planned, confirmed, in_progress, completed, canceled

  attendee_count INTEGER DEFAULT 0,
  outcome_notes TEXT,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- BILLING RECORDS (NG platform level)
-- ============================================================

CREATE TABLE IF NOT EXISTS ng_billing_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id UUID REFERENCES ng_subscriptions(id),
  subscriber_user_id UUID REFERENCES users(id),
  subscriber_org_id UUID REFERENCES ng_organizations(id),

  billing_type VARCHAR(30) NOT NULL,
  -- subscription, consultation, medication, pharmacy_fee, org_plan,
  -- sponsorship, campaign, lab_referral, provider_subscription

  description TEXT NOT NULL,
  amount DECIMAL(12,2) NOT NULL,
  currency VARCHAR(5) DEFAULT 'NGN',
  status VARCHAR(20) DEFAULT 'pending',
  -- pending, paid, failed, refunded, waived

  payment_provider VARCHAR(20),
  payment_reference VARCHAR(100),
  payment_channel VARCHAR(30),  -- card, bank_transfer, ussd, wallet

  invoice_number VARCHAR(50) UNIQUE,
  invoice_pdf_url TEXT,

  paid_at TIMESTAMPTZ,
  due_at TIMESTAMPTZ,
  period_start TIMESTAMPTZ,
  period_end TIMESTAMPTZ,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ng_billing_user ON ng_billing_records (subscriber_user_id);
CREATE INDEX IF NOT EXISTS idx_ng_billing_org ON ng_billing_records (subscriber_org_id);
CREATE INDEX IF NOT EXISTS idx_ng_billing_status ON ng_billing_records (status);
CREATE INDEX IF NOT EXISTS idx_ng_billing_type ON ng_billing_records (billing_type);

-- ============================================================
-- NG AUDIT LOG EXTENSION
-- ============================================================

ALTER TABLE ng_compliance_audit_log
  ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES ng_organizations(id),
  ADD COLUMN IF NOT EXISTS provider_id UUID REFERENCES ng_providers(id),
  ADD COLUMN IF NOT EXISTS hospital_id_ref UUID REFERENCES ng_hospitals(id);

-- ============================================================
-- MESSAGES (Nigeria)
-- ============================================================

CREATE TABLE IF NOT EXISTS ng_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_user_id UUID NOT NULL REFERENCES users(id),
  recipient_user_id UUID NOT NULL REFERENCES users(id),
  appointment_id UUID REFERENCES ng_appointments(id),

  body TEXT NOT NULL,
  is_read BOOLEAN DEFAULT false,
  read_at TIMESTAMPTZ,

  attachment_url TEXT,
  attachment_type VARCHAR(30),

  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ng_messages_recipient ON ng_messages (recipient_user_id, is_read);
CREATE INDEX IF NOT EXISTS idx_ng_messages_sender ON ng_messages (sender_user_id);
CREATE INDEX IF NOT EXISTS idx_ng_messages_appt ON ng_messages (appointment_id);

-- ============================================================
-- NG PLATFORM ANALYTICS EXTENSION
-- ============================================================

ALTER TABLE ng_platform_revenue
  ADD COLUMN IF NOT EXISTS consultation_revenue DECIMAL(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS subscription_org_revenue DECIMAL(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS provider_subscription_revenue DECIMAL(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sponsorship_revenue DECIMAL(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS lab_commission_revenue DECIMAL(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS campaign_revenue DECIMAL(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_consultations INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS active_orgs INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS active_providers INTEGER DEFAULT 0;
