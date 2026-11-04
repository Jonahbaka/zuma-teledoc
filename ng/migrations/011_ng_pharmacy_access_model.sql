-- ============================================================
-- NIGERIA REGION: Pharmacy portal, provider trial, and access model
-- Adds operational fields without creating a separate pharmacy product.
-- ============================================================

-- Market/account metadata on the shared users table.
DO $$ BEGIN
  ALTER TABLE users ADD COLUMN market_scope VARCHAR(10) DEFAULT 'US';
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE users ADD COLUMN account_status VARCHAR(30) DEFAULT 'active';
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE users ADD COLUMN is_test_account BOOLEAN DEFAULT FALSE;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE users ADD COLUMN organization_id UUID;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE users ADD COLUMN coverage_status VARCHAR(40) DEFAULT 'self_pay';
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE users ADD COLUMN coverage_start_at TIMESTAMPTZ;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE users ADD COLUMN coverage_end_at TIMESTAMPTZ;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- Pharmacy operational profile fields for Nigeria.
DO $$ BEGIN
  ALTER TABLE ng_pharmacies ADD COLUMN whatsapp_business_number VARCHAR(20);
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE ng_pharmacies ADD COLUMN preferred_prescription_receiving_method VARCHAR(40) DEFAULT 'dashboard';
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE ng_pharmacies ADD COLUMN notification_preferences JSONB DEFAULT '{"dashboard": true, "whatsapp": false}'::JSONB;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE ng_pharmacies ADD COLUMN accepts_bank_transfer BOOLEAN DEFAULT TRUE;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE ng_pharmacies ADD COLUMN accepts_pos BOOLEAN DEFAULT TRUE;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE ng_pharmacies ADD COLUMN accepts_cash BOOLEAN DEFAULT TRUE;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE ng_pharmacies ADD COLUMN account_status VARCHAR(40) DEFAULT 'pending_onboarding';
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE ng_pharmacies ADD COLUMN onboarding_status VARCHAR(40) DEFAULT 'profile_submitted';
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- Provider trial, usage, and subscription gate fields.
DO $$ BEGIN
  ALTER TABLE ng_providers ADD COLUMN trial_start_at TIMESTAMPTZ;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE ng_providers ADD COLUMN trial_end_at TIMESTAMPTZ;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE ng_providers ADD COLUMN trial_status VARCHAR(30) DEFAULT 'not_started';
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE ng_providers ADD COLUMN subscription_status VARCHAR(30) DEFAULT 'inactive';
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE ng_providers ADD COLUMN subscription_start_at TIMESTAMPTZ;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE ng_providers ADD COLUMN subscription_end_at TIMESTAMPTZ;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE ng_providers ADD COLUMN access_status VARCHAR(40) DEFAULT 'pending_approval';
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE ng_providers ADD COLUMN consultations_count INTEGER DEFAULT 0;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE ng_providers ADD COLUMN appointments_count INTEGER DEFAULT 0;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE ng_providers ADD COLUMN prescriptions_count INTEGER DEFAULT 0;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE ng_providers ADD COLUMN video_calls_count INTEGER DEFAULT 0;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE ng_providers ADD COLUMN messages_count INTEGER DEFAULT 0;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE ng_providers ADD COLUMN days_active_count INTEGER DEFAULT 0;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE ng_providers ADD COLUMN last_active_at TIMESTAMPTZ;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS ng_provider_usage_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  provider_id UUID REFERENCES ng_providers(id) ON DELETE CASCADE,
  role VARCHAR(30) DEFAULT 'provider',
  event_type VARCHAR(80) NOT NULL,
  event_count INTEGER DEFAULT 1,
  country VARCHAR(20) DEFAULT 'Nigeria',
  metadata JSONB DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ng_provider_usage_user ON ng_provider_usage_events (provider_user_id);
CREATE INDEX IF NOT EXISTS idx_ng_provider_usage_provider ON ng_provider_usage_events (provider_id);
CREATE INDEX IF NOT EXISTS idx_ng_provider_usage_type ON ng_provider_usage_events (event_type);

-- Pharmacy fulfillment response state for provider-generated prescriptions.
DO $$ BEGIN
  ALTER TABLE ng_digital_prescriptions ADD COLUMN pharmacy_response_status VARCHAR(40) DEFAULT 'pending_pharmacy_confirmation';
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE ng_digital_prescriptions ADD COLUMN confirmed_price_ngn DECIMAL(12,2);
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE ng_digital_prescriptions ADD COLUMN pharmacy_notes TEXT;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE ng_digital_prescriptions ADD COLUMN clarification_request TEXT;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE ng_digital_prescriptions ADD COLUMN fulfillment_preference VARCHAR(40) DEFAULT 'pickup_or_delivery';
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE ng_digital_prescriptions ADD COLUMN pharmacy_responded_at TIMESTAMPTZ;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE ng_digital_prescriptions ADD COLUMN ready_at TIMESTAMPTZ;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE ng_digital_prescriptions ADD COLUMN fulfilled_at TIMESTAMPTZ;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE ng_digital_prescriptions ADD COLUMN cancelled_at TIMESTAMPTZ;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_ng_digirx_pharmacy_route
  ON ng_digital_prescriptions (routed_pharmacy_id, preferred_pharmacy_id);

-- WhatsApp/manual notification queue. This avoids fake WhatsApp success when an API provider is not configured.
CREATE TABLE IF NOT EXISTS ng_whatsapp_notification_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  notification_type VARCHAR(80) NOT NULL DEFAULT 'pharmacy_prescription',
  prescription_id UUID REFERENCES ng_digital_prescriptions(id) ON DELETE SET NULL,
  medication_request_id UUID REFERENCES ng_medication_requests(id) ON DELETE SET NULL,
  pharmacy_id UUID REFERENCES ng_pharmacies(id) ON DELETE SET NULL,
  recipient_phone VARCHAR(30),
  status VARCHAR(40) DEFAULT 'manual_fallback_pending',
  message_preview TEXT,
  secure_action_url TEXT,
  provider_response JSONB DEFAULT '{}'::JSONB,
  metadata JSONB DEFAULT '{}'::JSONB,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ng_whatsapp_log_status ON ng_whatsapp_notification_log (status);
CREATE INDEX IF NOT EXISTS idx_ng_whatsapp_log_pharmacy ON ng_whatsapp_notification_log (pharmacy_id);

-- Manual/admin payment activation readiness for provider and organisation subscriptions.
CREATE TABLE IF NOT EXISTS ng_manual_payment_confirmations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_type VARCHAR(40) NOT NULL,
  subject_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  organization_id UUID REFERENCES ng_organizations(id) ON DELETE SET NULL,
  plan_key VARCHAR(80),
  amount_ngn DECIMAL(12,2),
  payment_method VARCHAR(40) DEFAULT 'bank_transfer',
  payment_reference VARCHAR(120),
  status VARCHAR(40) DEFAULT 'pending_admin_confirmation',
  period_start TIMESTAMPTZ,
  period_end TIMESTAMPTZ,
  notes TEXT,
  confirmed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  confirmed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ng_manual_payment_subject ON ng_manual_payment_confirmations (subject_type, subject_user_id);

-- Patients register free; consultation payment/organisation coverage happens per visit or org plan.
UPDATE ng_subscription_plans
   SET name = 'Patient Free Access',
       price_monthly = 0,
       price_annual = 0,
       max_consultations = 0,
       features = '["Free patient account","Book and pay per consultation","Medication search","Prescription and pharmacy request tracking","Organisation coverage when assigned"]'::JSONB,
       is_active = TRUE,
       updated_at = NOW()
 WHERE plan_key = 'patient_basic';

UPDATE ng_subscription_plans
   SET is_active = FALSE,
       updated_at = NOW()
 WHERE plan_key IN ('patient_standard', 'patient_premium');
