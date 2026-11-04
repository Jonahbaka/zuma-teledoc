-- ============================================================
-- NIGERIA REGION: Core Database Schema
-- Pharmacy-first digital health platform
-- All tables prefixed with ng_ to avoid conflicts with US tables
-- ============================================================

-- Region enum
DO $$ BEGIN
  CREATE TYPE region_code AS ENUM ('US', 'NG', 'GH', 'KE', 'ZA');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Add region column to existing users table if not exists
DO $$ BEGIN
  ALTER TABLE users ADD COLUMN region region_code DEFAULT 'US';
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE users ADD COLUMN phone_number VARCHAR(20);
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- ============================================================
-- PHARMACY TABLES
-- ============================================================

-- Pharmacy registration status
DO $$ BEGIN
  CREATE TYPE ng_pharmacy_status AS ENUM (
    'pending_review', 'documents_submitted', 'under_verification',
    'approved', 'suspended', 'rejected', 'deactivated'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Registered pharmacies
CREATE TABLE IF NOT EXISTS ng_pharmacies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  slug VARCHAR(255) UNIQUE NOT NULL,
  owner_user_id UUID REFERENCES users(id) ON DELETE SET NULL,

  -- PCN Registration
  pcn_license_number VARCHAR(50) UNIQUE NOT NULL,
  pcn_license_expiry DATE NOT NULL,
  pcn_license_document_url TEXT,
  nafdac_registration_number VARCHAR(50),

  -- Superintendent Pharmacist
  superintendent_name VARCHAR(255) NOT NULL,
  superintendent_pcn_number VARCHAR(50) NOT NULL,
  superintendent_phone VARCHAR(20) NOT NULL,
  superintendent_email VARCHAR(255),
  superintendent_license_url TEXT,

  -- Location
  address_line1 VARCHAR(255) NOT NULL,
  address_line2 VARCHAR(255),
  city VARCHAR(100) NOT NULL,
  state VARCHAR(50) NOT NULL,
  lga VARCHAR(100), -- Local Government Area
  postal_code VARCHAR(10),
  latitude DECIMAL(10, 8),
  longitude DECIMAL(11, 8),
  geolocation POINT,

  -- Contact
  phone VARCHAR(20) NOT NULL,
  whatsapp VARCHAR(20),
  email VARCHAR(255) NOT NULL,
  website VARCHAR(255),

  -- Operations
  status ng_pharmacy_status DEFAULT 'pending_review',
  operating_hours JSONB DEFAULT '{}',
  delivery_enabled BOOLEAN DEFAULT false,
  delivery_radius_km DECIMAL(5, 2) DEFAULT 10.00,
  minimum_order_amount DECIMAL(12, 2) DEFAULT 500.00,

  -- Financial
  bank_name VARCHAR(100),
  bank_account_number VARCHAR(20),
  bank_account_name VARCHAR(255),
  bank_code VARCHAR(10),
  paystack_subaccount_code VARCHAR(50),
  flutterwave_subaccount_id VARCHAR(50),
  settlement_schedule VARCHAR(20) DEFAULT 'T+3',

  -- Subscription
  subscription_tier VARCHAR(20) DEFAULT 'basic',
  subscription_expires_at TIMESTAMPTZ,

  -- Metadata
  rating DECIMAL(3, 2) DEFAULT 0.00,
  total_orders INTEGER DEFAULT 0,
  total_revenue DECIMAL(15, 2) DEFAULT 0.00,
  is_featured BOOLEAN DEFAULT false,
  verified_at TIMESTAMPTZ,
  verified_by UUID REFERENCES users(id),

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Spatial index for geo queries
CREATE INDEX IF NOT EXISTS idx_ng_pharmacies_location ON ng_pharmacies USING GIST (geolocation);
CREATE INDEX IF NOT EXISTS idx_ng_pharmacies_state ON ng_pharmacies (state);
CREATE INDEX IF NOT EXISTS idx_ng_pharmacies_status ON ng_pharmacies (status);
CREATE INDEX IF NOT EXISTS idx_ng_pharmacies_slug ON ng_pharmacies (slug);

-- ============================================================
-- DRUG CATALOG
-- ============================================================

DO $$ BEGIN
  CREATE TYPE ng_drug_category AS ENUM (
    'prescription', 'otc', 'controlled', 'herbal', 'cosmetic', 'medical_device'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS ng_drug_catalog (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nafdac_number VARCHAR(50),
  name VARCHAR(255) NOT NULL,
  generic_name VARCHAR(255),
  brand_name VARCHAR(255),
  manufacturer VARCHAR(255),
  category ng_drug_category DEFAULT 'otc',

  -- Classification
  atc_code VARCHAR(10), -- WHO ATC classification
  schedule VARCHAR(20), -- Controlled substance schedule
  requires_prescription BOOLEAN DEFAULT false,

  -- Details
  dosage_form VARCHAR(100), -- tablet, capsule, syrup, injection, etc.
  strength VARCHAR(100), -- e.g., "500mg", "10mg/5ml"
  pack_size VARCHAR(50), -- e.g., "10 tablets", "100ml"
  description TEXT,
  contraindications TEXT,
  side_effects TEXT,
  interactions TEXT,

  -- Pricing
  reference_price DECIMAL(12, 2), -- EMDEX reference price
  min_price DECIMAL(12, 2),
  max_price DECIMAL(12, 2),

  -- Substitution
  substitution_group VARCHAR(100), -- Generic equivalence group
  is_generic BOOLEAN DEFAULT false,
  brand_equivalent_id UUID REFERENCES ng_drug_catalog(id),

  -- Status
  is_active BOOLEAN DEFAULT true,
  nafdac_approved BOOLEAN DEFAULT true,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ng_drugs_name ON ng_drug_catalog USING gin (to_tsvector('english', name || ' ' || COALESCE(generic_name, '') || ' ' || COALESCE(brand_name, '')));
CREATE INDEX IF NOT EXISTS idx_ng_drugs_generic ON ng_drug_catalog (generic_name);
CREATE INDEX IF NOT EXISTS idx_ng_drugs_nafdac ON ng_drug_catalog (nafdac_number);
CREATE INDEX IF NOT EXISTS idx_ng_drugs_category ON ng_drug_catalog (category);
CREATE INDEX IF NOT EXISTS idx_ng_drugs_substitution ON ng_drug_catalog (substitution_group);

-- ============================================================
-- PHARMACY INVENTORY
-- ============================================================

CREATE TABLE IF NOT EXISTS ng_pharmacy_inventory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id UUID NOT NULL REFERENCES ng_pharmacies(id) ON DELETE CASCADE,
  drug_id UUID NOT NULL REFERENCES ng_drug_catalog(id) ON DELETE CASCADE,

  -- Stock
  quantity_available INTEGER NOT NULL DEFAULT 0,
  quantity_reserved INTEGER DEFAULT 0,
  reorder_level INTEGER DEFAULT 10,
  batch_number VARCHAR(50),
  expiry_date DATE,

  -- Pricing
  cost_price DECIMAL(12, 2) NOT NULL,
  selling_price DECIMAL(12, 2) NOT NULL,
  markup_percent DECIMAL(5, 2),
  discount_percent DECIMAL(5, 2) DEFAULT 0,

  -- Status
  is_available BOOLEAN DEFAULT true,
  last_restocked_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(pharmacy_id, drug_id, batch_number)
);

CREATE INDEX IF NOT EXISTS idx_ng_inventory_pharmacy ON ng_pharmacy_inventory (pharmacy_id);
CREATE INDEX IF NOT EXISTS idx_ng_inventory_drug ON ng_pharmacy_inventory (drug_id);
CREATE INDEX IF NOT EXISTS idx_ng_inventory_available ON ng_pharmacy_inventory (is_available, quantity_available);
CREATE INDEX IF NOT EXISTS idx_ng_inventory_expiry ON ng_pharmacy_inventory (expiry_date);

-- ============================================================
-- PRESCRIPTIONS (Nigeria-specific)
-- ============================================================

DO $$ BEGIN
  CREATE TYPE ng_prescription_status AS ENUM (
    'uploaded', 'parsing', 'parsed', 'verified', 'matched',
    'dispensing', 'dispensed', 'rejected', 'expired'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS ng_prescriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_user_id UUID NOT NULL REFERENCES users(id),

  -- Prescription source
  image_url TEXT, -- uploaded prescription image
  ocr_raw_text TEXT, -- OCR output
  ocr_confidence DECIMAL(5, 2), -- OCR confidence score

  -- Parsed prescription data
  prescriber_name VARCHAR(255),
  prescriber_license VARCHAR(50),
  prescriber_facility VARCHAR(255),
  prescription_date DATE,

  -- Items (stored as JSONB array)
  items JSONB DEFAULT '[]',
  -- Each item: { drug_name, generic_name, dosage, frequency, duration, quantity, notes }

  -- Processing
  status ng_prescription_status DEFAULT 'uploaded',
  verified_by_pharmacist UUID REFERENCES users(id),
  verified_at TIMESTAMPTZ,
  rejection_reason TEXT,

  -- Compliance
  is_controlled_substance BOOLEAN DEFAULT false,
  requires_id_verification BOOLEAN DEFAULT false,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '30 days')
);

CREATE INDEX IF NOT EXISTS idx_ng_prescriptions_patient ON ng_prescriptions (patient_user_id);
CREATE INDEX IF NOT EXISTS idx_ng_prescriptions_status ON ng_prescriptions (status);

-- ============================================================
-- ORDERS
-- ============================================================

DO $$ BEGIN
  CREATE TYPE ng_order_status AS ENUM (
    'pending', 'confirmed', 'preparing', 'ready_for_pickup',
    'dispatched', 'in_transit', 'delivered', 'cancelled', 'refunded'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE ng_payment_method AS ENUM (
    'card', 'bank_transfer', 'ussd', 'mobile_money', 'wallet', 'cash_on_delivery'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS ng_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number VARCHAR(20) UNIQUE NOT NULL, -- e.g., NG-RX-20260319-0001
  patient_user_id UUID NOT NULL REFERENCES users(id),
  pharmacy_id UUID NOT NULL REFERENCES ng_pharmacies(id),
  prescription_id UUID REFERENCES ng_prescriptions(id),

  -- Items
  items JSONB NOT NULL DEFAULT '[]',
  -- Each: { drug_id, drug_name, quantity, unit_price, total_price, is_prescription, substituted_from }

  -- Pricing
  subtotal DECIMAL(12, 2) NOT NULL,
  platform_fee DECIMAL(12, 2) DEFAULT 0, -- RX fee (₦100–₦500)
  delivery_fee DECIMAL(12, 2) DEFAULT 0,
  vat_amount DECIMAL(12, 2) DEFAULT 0,
  discount_amount DECIMAL(12, 2) DEFAULT 0,
  total_amount DECIMAL(12, 2) NOT NULL,

  -- Payment
  payment_method ng_payment_method,
  payment_provider VARCHAR(20), -- paystack or flutterwave
  payment_reference VARCHAR(100),
  payment_status VARCHAR(20) DEFAULT 'pending',
  paid_at TIMESTAMPTZ,

  -- Delivery
  delivery_type VARCHAR(20) DEFAULT 'delivery', -- delivery, pickup
  delivery_address JSONB,
  delivery_partner VARCHAR(20), -- gokada, kwik, maxng
  delivery_tracking_id VARCHAR(100),
  delivery_rider_name VARCHAR(100),
  delivery_rider_phone VARCHAR(20),
  estimated_delivery_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,

  -- Status
  status ng_order_status DEFAULT 'pending',
  notes TEXT,
  cancellation_reason TEXT,

  -- Settlement
  pharmacy_payout_amount DECIMAL(12, 2),
  pharmacy_payout_status VARCHAR(20) DEFAULT 'pending',
  pharmacy_payout_reference VARCHAR(100),
  pharmacy_payout_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ng_orders_patient ON ng_orders (patient_user_id);
CREATE INDEX IF NOT EXISTS idx_ng_orders_pharmacy ON ng_orders (pharmacy_id);
CREATE INDEX IF NOT EXISTS idx_ng_orders_status ON ng_orders (status);
CREATE INDEX IF NOT EXISTS idx_ng_orders_number ON ng_orders (order_number);
CREATE INDEX IF NOT EXISTS idx_ng_orders_payment ON ng_orders (payment_reference);
CREATE INDEX IF NOT EXISTS idx_ng_orders_created ON ng_orders (created_at DESC);

-- ============================================================
-- PHARMACY WALLET / SETTLEMENTS
-- ============================================================

CREATE TABLE IF NOT EXISTS ng_pharmacy_wallets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id UUID UNIQUE NOT NULL REFERENCES ng_pharmacies(id) ON DELETE CASCADE,

  balance DECIMAL(15, 2) DEFAULT 0.00,
  pending_balance DECIMAL(15, 2) DEFAULT 0.00,
  total_earned DECIMAL(15, 2) DEFAULT 0.00,
  total_withdrawn DECIMAL(15, 2) DEFAULT 0.00,

  last_settlement_at TIMESTAMPTZ,
  auto_settle BOOLEAN DEFAULT true,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ng_wallet_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id UUID NOT NULL REFERENCES ng_pharmacy_wallets(id),
  pharmacy_id UUID NOT NULL REFERENCES ng_pharmacies(id),
  order_id UUID REFERENCES ng_orders(id),

  type VARCHAR(20) NOT NULL, -- credit, debit, settlement, refund, fee, subscription
  amount DECIMAL(12, 2) NOT NULL,
  balance_after DECIMAL(15, 2) NOT NULL,

  description TEXT,
  reference VARCHAR(100),
  payment_provider VARCHAR(20),

  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ng_wallet_tx_pharmacy ON ng_wallet_transactions (pharmacy_id);
CREATE INDEX IF NOT EXISTS idx_ng_wallet_tx_created ON ng_wallet_transactions (created_at DESC);

-- ============================================================
-- COMPLIANCE / AUDIT LOGS
-- ============================================================

CREATE TABLE IF NOT EXISTS ng_compliance_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Actor
  actor_user_id UUID REFERENCES users(id),
  actor_type VARCHAR(50), -- patient, pharmacist, admin, system
  actor_ip VARCHAR(45),

  -- Action
  action VARCHAR(100) NOT NULL, -- e.g., prescription.dispensed, pharmacy.verified, order.created
  resource_type VARCHAR(50), -- pharmacy, prescription, order, drug, inventory
  resource_id UUID,

  -- Details
  details JSONB DEFAULT '{}',
  compliance_flags TEXT[], -- PCN, NDPA, NAFDAC
  severity VARCHAR(20) DEFAULT 'info', -- info, warning, critical

  -- Context
  pharmacy_id UUID REFERENCES ng_pharmacies(id),
  region VARCHAR(5) DEFAULT 'NG',

  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ng_audit_action ON ng_compliance_audit_log (action);
CREATE INDEX IF NOT EXISTS idx_ng_audit_pharmacy ON ng_compliance_audit_log (pharmacy_id);
CREATE INDEX IF NOT EXISTS idx_ng_audit_resource ON ng_compliance_audit_log (resource_type, resource_id);
CREATE INDEX IF NOT EXISTS idx_ng_audit_created ON ng_compliance_audit_log (created_at DESC);

-- ============================================================
-- DELIVERY TRACKING
-- ============================================================

CREATE TABLE IF NOT EXISTS ng_delivery_tracking (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES ng_orders(id) ON DELETE CASCADE,

  partner VARCHAR(20) NOT NULL, -- gokada, kwik, maxng
  partner_tracking_id VARCHAR(100),
  rider_name VARCHAR(100),
  rider_phone VARCHAR(20),
  rider_photo_url TEXT,

  pickup_location JSONB, -- { lat, lng, address }
  dropoff_location JSONB, -- { lat, lng, address }
  current_location JSONB, -- { lat, lng, updated_at }

  status VARCHAR(30) DEFAULT 'pending',
  -- pending, assigned, picked_up, in_transit, arrived, delivered, failed

  estimated_pickup_at TIMESTAMPTZ,
  actual_pickup_at TIMESTAMPTZ,
  estimated_delivery_at TIMESTAMPTZ,
  actual_delivery_at TIMESTAMPTZ,

  delivery_proof_url TEXT, -- photo/signature
  recipient_name VARCHAR(255),

  distance_km DECIMAL(8, 2),
  cost DECIMAL(12, 2),

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ng_delivery_order ON ng_delivery_tracking (order_id);
CREATE INDEX IF NOT EXISTS idx_ng_delivery_status ON ng_delivery_tracking (status);

-- ============================================================
-- PHARMACY RATINGS & REVIEWS
-- ============================================================

CREATE TABLE IF NOT EXISTS ng_pharmacy_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id UUID NOT NULL REFERENCES ng_pharmacies(id) ON DELETE CASCADE,
  patient_user_id UUID NOT NULL REFERENCES users(id),
  order_id UUID REFERENCES ng_orders(id),

  rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
  review TEXT,

  -- Aspects
  delivery_rating INTEGER CHECK (delivery_rating >= 1 AND delivery_rating <= 5),
  service_rating INTEGER CHECK (service_rating >= 1 AND service_rating <= 5),
  price_rating INTEGER CHECK (price_rating >= 1 AND price_rating <= 5),

  is_verified_purchase BOOLEAN DEFAULT false,
  is_visible BOOLEAN DEFAULT true,

  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ng_reviews_pharmacy ON ng_pharmacy_reviews (pharmacy_id);

-- ============================================================
-- PLATFORM ANALYTICS / REVENUE TRACKING
-- ============================================================

CREATE TABLE IF NOT EXISTS ng_platform_revenue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  date DATE NOT NULL,
  pharmacy_id UUID REFERENCES ng_pharmacies(id),

  -- Revenue breakdown
  rx_fee_revenue DECIMAL(12, 2) DEFAULT 0, -- per-transaction RX fees
  subscription_revenue DECIMAL(12, 2) DEFAULT 0, -- SaaS fees
  delivery_markup_revenue DECIMAL(12, 2) DEFAULT 0, -- delivery margins
  margin_share_revenue DECIMAL(12, 2) DEFAULT 0, -- medication margin share

  -- Volume
  total_orders INTEGER DEFAULT 0,
  total_gmv DECIMAL(15, 2) DEFAULT 0, -- Gross Merchandise Value

  created_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(date, pharmacy_id)
);

CREATE INDEX IF NOT EXISTS idx_ng_revenue_date ON ng_platform_revenue (date DESC);
