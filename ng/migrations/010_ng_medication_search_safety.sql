-- ============================================================
-- NIGERIA REGION: Medication search safety, request workflow,
-- source auditability, and verified pharmacy availability
-- ============================================================

ALTER TABLE ng_drug_catalog
  ADD COLUMN IF NOT EXISTS source_name TEXT,
  ADD COLUMN IF NOT EXISTS source_type TEXT DEFAULT 'legacy_import',
  ADD COLUMN IF NOT EXISTS source_reference TEXT,
  ADD COLUMN IF NOT EXISTS source_url TEXT,
  ADD COLUMN IF NOT EXISTS source_quality_status TEXT DEFAULT 'needs_admin_review',
  ADD COLUMN IF NOT EXISTS source_verified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS is_supported BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS disabled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS disabled_by UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS disabled_reason TEXT,
  ADD COLUMN IF NOT EXISTS admin_review_notes TEXT,
  ADD COLUMN IF NOT EXISTS pharmacy_availability_mode TEXT DEFAULT 'request_confirmation';

UPDATE ng_drug_catalog
   SET source_name = COALESCE(source_name, 'NHIA medication reference import'),
       source_type = COALESCE(source_type, 'public_benefit_list'),
       source_reference = COALESCE(source_reference, 'ng/data/doctarx_nigeria_data_pack/nhia_meds_seed.csv'),
       source_quality_status = CASE
         WHEN source_quality_status IS NULL OR source_quality_status IN ('needs_admin_review', 'legacy_import')
           THEN 'reference_only'
         ELSE source_quality_status
       END,
       is_supported = true,
       pharmacy_availability_mode = COALESCE(pharmacy_availability_mode, 'request_confirmation')
 WHERE LOWER(COALESCE(source, '')) = 'nhia'
    OR source_med_code IS NOT NULL
    OR nhia_listed = true;

UPDATE ng_drug_catalog
   SET source_name = COALESCE(source_name, 'Legacy internal catalog seed'),
       source_type = COALESCE(source_type, 'legacy_seed'),
       source_reference = COALESCE(source_reference, 'ng/migrations/002_seed_drug_catalog.sql'),
       source_quality_status = COALESCE(source_quality_status, 'needs_admin_review'),
       is_supported = false,
       pharmacy_availability_mode = COALESCE(pharmacy_availability_mode, 'request_confirmation')
 WHERE COALESCE(source_med_code, '') = ''
   AND COALESCE(nhia_listed, false) = false
   AND LOWER(COALESCE(source, 'ng_seed')) IN ('ng_seed', 'featured_seed');

CREATE INDEX IF NOT EXISTS idx_ng_drugs_source_quality ON ng_drug_catalog (source_quality_status);
CREATE INDEX IF NOT EXISTS idx_ng_drugs_supported_active ON ng_drug_catalog (is_supported, is_active, disabled_at);

ALTER TABLE ng_pharmacy_inventory
  ADD COLUMN IF NOT EXISTS availability_verification_status TEXT DEFAULT 'unverified',
  ADD COLUMN IF NOT EXISTS availability_verified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS availability_verified_by UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS availability_source TEXT,
  ADD COLUMN IF NOT EXISTS availability_notes TEXT;

CREATE INDEX IF NOT EXISTS idx_ng_inventory_verified_available
  ON ng_pharmacy_inventory (drug_id, availability_verification_status, is_available, quantity_available);

CREATE TABLE IF NOT EXISTS ng_medication_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  session_id TEXT,
  medicine_catalog_id UUID REFERENCES ng_drug_catalog(id) ON DELETE SET NULL,
  starter_catalog_id TEXT,
  medicine_name TEXT NOT NULL,
  generic_name TEXT,
  dosage_strength TEXT,
  quantity_requested TEXT,
  requires_prescription BOOLEAN DEFAULT false,
  prescription_attached BOOLEAN DEFAULT false,
  prescription_attachment_url TEXT,
  prescription_notes TEXT,
  fulfillment_preference TEXT NOT NULL DEFAULT 'pharmacy_confirmation',
  preferred_pharmacy_id UUID REFERENCES ng_pharmacies(id) ON DELETE SET NULL,
  assigned_pharmacy_id UUID REFERENCES ng_pharmacies(id) ON DELETE SET NULL,
  contact_name TEXT,
  phone TEXT,
  whatsapp_number TEXT,
  email TEXT,
  state TEXT,
  city TEXT,
  lga TEXT,
  landmark TEXT,
  location_permission_status TEXT,
  location_latitude NUMERIC,
  location_longitude NUMERIC,
  location_accuracy NUMERIC,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'pending_pharmacy_confirmation',
  source_snapshot JSONB DEFAULT '{}'::JSONB,
  admin_notes TEXT,
  pharmacy_response_notes TEXT,
  pharmacy_responded_at TIMESTAMPTZ,
  confirmed_price_ngn NUMERIC(12, 2),
  pharmacy_notes TEXT,
  clarification_request TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE ng_medication_requests
  ADD COLUMN IF NOT EXISTS starter_catalog_id TEXT,
  ADD COLUMN IF NOT EXISTS dosage_strength TEXT,
  ADD COLUMN IF NOT EXISTS quantity_requested TEXT,
  ADD COLUMN IF NOT EXISTS whatsapp_number TEXT,
  ADD COLUMN IF NOT EXISTS location_permission_status TEXT,
  ADD COLUMN IF NOT EXISTS location_latitude NUMERIC,
  ADD COLUMN IF NOT EXISTS location_longitude NUMERIC,
  ADD COLUMN IF NOT EXISTS location_accuracy NUMERIC,
  ADD COLUMN IF NOT EXISTS pharmacy_response_notes TEXT,
  ADD COLUMN IF NOT EXISTS pharmacy_responded_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS confirmed_price_ngn NUMERIC(12, 2),
  ADD COLUMN IF NOT EXISTS pharmacy_notes TEXT,
  ADD COLUMN IF NOT EXISTS clarification_request TEXT;

ALTER TABLE ng_medication_requests
  ALTER COLUMN status SET DEFAULT 'pending_pharmacy_confirmation';

UPDATE ng_medication_requests
   SET status = 'pending_pharmacy_confirmation'
 WHERE status = 'pending_confirmation';

UPDATE ng_medication_requests
   SET status = 'pharmacy_reviewing'
 WHERE status = 'assigned_to_pharmacy';

UPDATE ng_medication_requests
   SET status = 'available'
 WHERE status = 'confirmed_available';

CREATE INDEX IF NOT EXISTS idx_ng_medication_requests_status ON ng_medication_requests (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ng_medication_requests_medicine ON ng_medication_requests (medicine_catalog_id);
CREATE INDEX IF NOT EXISTS idx_ng_medication_requests_pharmacy ON ng_medication_requests (preferred_pharmacy_id, assigned_pharmacy_id);

CREATE TABLE IF NOT EXISTS ng_medication_source_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  drug_catalog_id UUID REFERENCES ng_drug_catalog(id) ON DELETE CASCADE,
  inventory_id UUID REFERENCES ng_pharmacy_inventory(id) ON DELETE CASCADE,
  actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  from_status TEXT,
  to_status TEXT,
  details JSONB DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ng_medication_source_audit_drug
  ON ng_medication_source_audit_log (drug_catalog_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ng_medication_source_audit_inventory
  ON ng_medication_source_audit_log (inventory_id, created_at DESC);
