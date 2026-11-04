-- ============================================================
-- NIGERIA REGION: clinical EMR, e-prescription, and FHIR-ready interoperability
-- Adds NG-prefixed tables only and extends existing NG integration tables.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ng_rx_status') THEN
    ALTER TYPE ng_rx_status ADD VALUE IF NOT EXISTS 'created';
    ALTER TYPE ng_rx_status ADD VALUE IF NOT EXISTS 'sent';
    ALTER TYPE ng_rx_status ADD VALUE IF NOT EXISTS 'accepted_by_pharmacy';
    ALTER TYPE ng_rx_status ADD VALUE IF NOT EXISTS 'declined_by_pharmacy';
    ALTER TYPE ng_rx_status ADD VALUE IF NOT EXISTS 'dispensed';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS ng_emr_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  chart_number TEXT UNIQUE,
  blood_type TEXT,
  allergies JSONB DEFAULT '[]'::JSONB,
  chronic_conditions JSONB DEFAULT '[]'::JSONB,
  care_team JSONB DEFAULT '[]'::JSONB,
  risk_flags JSONB DEFAULT '[]'::JSONB,
  consent_summary JSONB DEFAULT '{}'::JSONB,
  last_reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (patient_user_id)
);

CREATE TABLE IF NOT EXISTS ng_clinical_encounters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  hospital_id UUID REFERENCES ng_hospitals(id) ON DELETE SET NULL,
  appointment_id UUID,
  encounter_type TEXT DEFAULT 'telehealth',
  status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'in_progress', 'signed', 'amended', 'cancelled')),
  reason_for_visit TEXT,
  chief_complaint TEXT,
  clinical_summary TEXT,
  started_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  signed_at TIMESTAMPTZ,
  source_system TEXT DEFAULT 'doctarx_ng',
  metadata JSONB DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ng_soap_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  encounter_id UUID REFERENCES ng_clinical_encounters(id) ON DELETE CASCADE,
  patient_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  subjective TEXT,
  objective TEXT,
  assessment TEXT,
  plan TEXT,
  ai_assist_status TEXT DEFAULT 'not_requested' CHECK (ai_assist_status IN ('not_requested', 'drafted', 'reviewed', 'rejected')),
  provider_attestation TEXT,
  signed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ng_diagnoses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  encounter_id UUID REFERENCES ng_clinical_encounters(id) ON DELETE SET NULL,
  provider_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  code_system TEXT DEFAULT 'ICD-10',
  diagnosis_code TEXT,
  description TEXT NOT NULL,
  diagnosis_type TEXT DEFAULT 'working',
  clinical_status TEXT DEFAULT 'active' CHECK (clinical_status IN ('active', 'resolved', 'recurrence', 'inactive', 'entered_in_error')),
  onset_date DATE,
  resolved_date DATE,
  metadata JSONB DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ng_medication_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  encounter_id UUID REFERENCES ng_clinical_encounters(id) ON DELETE SET NULL,
  prescription_id UUID,
  medication_name TEXT NOT NULL,
  generic_name TEXT,
  dosage TEXT,
  frequency TEXT,
  route TEXT,
  duration TEXT,
  start_date DATE,
  end_date DATE,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'completed', 'stopped', 'on_hold', 'entered_in_error')),
  source TEXT DEFAULT 'provider_entered',
  metadata JSONB DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ng_lab_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  encounter_id UUID REFERENCES ng_clinical_encounters(id) ON DELETE SET NULL,
  ordering_provider_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  lab_organization_id UUID REFERENCES ng_organizations(id) ON DELETE SET NULL,
  test_name TEXT NOT NULL,
  loinc_code TEXT,
  result_value TEXT,
  unit TEXT,
  reference_range TEXT,
  abnormal_flag TEXT,
  status TEXT DEFAULT 'registered' CHECK (status IN ('registered', 'partial', 'final', 'amended', 'cancelled')),
  collected_at TIMESTAMPTZ,
  resulted_at TIMESTAMPTZ,
  report_url TEXT,
  metadata JSONB DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ng_clinical_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  encounter_id UUID REFERENCES ng_clinical_encounters(id) ON DELETE SET NULL,
  uploaded_by UUID REFERENCES users(id) ON DELETE SET NULL,
  document_type TEXT NOT NULL,
  title TEXT NOT NULL,
  storage_ref TEXT,
  mime_type TEXT,
  confidentiality TEXT DEFAULT 'restricted',
  status TEXT DEFAULT 'current' CHECK (status IN ('current', 'superseded', 'entered_in_error')),
  metadata JSONB DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ng_visit_timeline_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  encounter_id UUID REFERENCES ng_clinical_encounters(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  event_at TIMESTAMPTZ DEFAULT NOW(),
  metadata JSONB DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ng_digital_prescriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  encounter_id UUID REFERENCES ng_clinical_encounters(id) ON DELETE SET NULL,
  pharmacy_id UUID REFERENCES ng_pharmacies(id) ON DELETE SET NULL,
  prescription_number TEXT UNIQUE,
  lifecycle_status TEXT DEFAULT 'created' CHECK (lifecycle_status IN (
    'created', 'sent', 'accepted_by_pharmacy', 'declined_by_pharmacy', 'dispensed', 'cancelled', 'expired'
  )),
  route_status TEXT DEFAULT 'not_routed',
  refill_allowed BOOLEAN DEFAULT false,
  refill_count INTEGER DEFAULT 0,
  refill_limit INTEGER DEFAULT 0,
  patient_instructions TEXT,
  pharmacy_notes TEXT,
  external_integration_status TEXT DEFAULT 'not_configured',
  source_system TEXT DEFAULT 'doctarx_ng',
  audit_metadata JSONB DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  sent_at TIMESTAMPTZ,
  accepted_at TIMESTAMPTZ,
  dispensed_at TIMESTAMPTZ
);

ALTER TABLE ng_digital_prescriptions
  ADD COLUMN IF NOT EXISTS patient_user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS provider_user_id UUID REFERENCES users(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS encounter_id UUID REFERENCES ng_clinical_encounters(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS pharmacy_id UUID REFERENCES ng_pharmacies(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS prescription_number TEXT,
  ADD COLUMN IF NOT EXISTS lifecycle_status TEXT DEFAULT 'created',
  ADD COLUMN IF NOT EXISTS route_status TEXT DEFAULT 'not_routed',
  ADD COLUMN IF NOT EXISTS refill_allowed BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS refill_count INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS refill_limit INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS patient_instructions TEXT,
  ADD COLUMN IF NOT EXISTS pharmacy_notes TEXT,
  ADD COLUMN IF NOT EXISTS external_integration_status TEXT DEFAULT 'not_configured',
  ADD COLUMN IF NOT EXISTS source_system TEXT DEFAULT 'doctarx_ng',
  ADD COLUMN IF NOT EXISTS audit_metadata JSONB DEFAULT '{}'::JSONB,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS accepted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS dispensed_at TIMESTAMPTZ;

ALTER TABLE ng_digital_prescriptions
  ALTER COLUMN provider_id DROP NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_ng_digital_rx_number_unique ON ng_digital_prescriptions (prescription_number);

CREATE TABLE IF NOT EXISTS ng_digital_prescription_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prescription_id UUID NOT NULL REFERENCES ng_digital_prescriptions(id) ON DELETE CASCADE,
  drug_catalog_id UUID,
  medication_name TEXT NOT NULL,
  generic_name TEXT,
  dosage TEXT NOT NULL,
  frequency TEXT NOT NULL,
  duration TEXT NOT NULL,
  quantity TEXT,
  route TEXT,
  substitution_allowed BOOLEAN DEFAULT true,
  nafdac_number TEXT,
  metadata JSONB DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE ng_digital_prescription_items
  ADD COLUMN IF NOT EXISTS prescription_id UUID REFERENCES ng_digital_prescriptions(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS drug_catalog_id UUID,
  ADD COLUMN IF NOT EXISTS medication_name TEXT,
  ADD COLUMN IF NOT EXISTS generic_name TEXT,
  ADD COLUMN IF NOT EXISTS dosage TEXT,
  ADD COLUMN IF NOT EXISTS frequency TEXT,
  ADD COLUMN IF NOT EXISTS duration TEXT,
  ADD COLUMN IF NOT EXISTS quantity TEXT,
  ADD COLUMN IF NOT EXISTS route TEXT,
  ADD COLUMN IF NOT EXISTS substitution_allowed BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS nafdac_number TEXT,
  ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::JSONB,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();

CREATE TABLE IF NOT EXISTS ng_prescription_audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prescription_id UUID REFERENCES ng_digital_prescriptions(id) ON DELETE CASCADE,
  actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  from_status TEXT,
  to_status TEXT,
  message TEXT,
  metadata JSONB DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE ng_prescription_audit_logs
  ADD COLUMN IF NOT EXISTS prescription_id UUID REFERENCES ng_digital_prescriptions(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS action TEXT,
  ADD COLUMN IF NOT EXISTS from_status TEXT,
  ADD COLUMN IF NOT EXISTS to_status TEXT,
  ADD COLUMN IF NOT EXISTS message TEXT,
  ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::JSONB,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();

CREATE TABLE IF NOT EXISTS ng_referrals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  provider_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  source_organization_id UUID REFERENCES ng_organizations(id) ON DELETE SET NULL,
  target_organization_id UUID REFERENCES ng_organizations(id) ON DELETE SET NULL,
  target_hospital_id UUID REFERENCES ng_hospitals(id) ON DELETE SET NULL,
  encounter_id UUID REFERENCES ng_clinical_encounters(id) ON DELETE SET NULL,
  target_name TEXT,
  destination_type TEXT DEFAULT 'internal',
  referral_type TEXT DEFAULT 'specialist',
  priority TEXT DEFAULT 'routine' CHECK (priority IN ('routine', 'urgent', 'emergency')),
  status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'sent', 'accepted', 'declined', 'completed', 'cancelled')),
  reason TEXT,
  clinical_summary_ref TEXT,
  clinical_notes TEXT,
  response_summary TEXT,
  audit_metadata JSONB DEFAULT '{}'::JSONB,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE ng_referrals
  ADD COLUMN IF NOT EXISTS patient_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS provider_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source_organization_id UUID REFERENCES ng_organizations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS target_organization_id UUID REFERENCES ng_organizations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS target_hospital_id UUID REFERENCES ng_hospitals(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS encounter_id UUID REFERENCES ng_clinical_encounters(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS target_name TEXT,
  ADD COLUMN IF NOT EXISTS destination_type TEXT DEFAULT 'internal',
  ADD COLUMN IF NOT EXISTS referral_type TEXT DEFAULT 'specialist',
  ADD COLUMN IF NOT EXISTS priority TEXT DEFAULT 'routine',
  ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'draft',
  ADD COLUMN IF NOT EXISTS reason TEXT,
  ADD COLUMN IF NOT EXISTS clinical_summary_ref TEXT,
  ADD COLUMN IF NOT EXISTS clinical_notes TEXT,
  ADD COLUMN IF NOT EXISTS response_summary TEXT,
  ADD COLUMN IF NOT EXISTS audit_metadata JSONB DEFAULT '{}'::JSONB,
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_ng_referrals_status ON ng_referrals (status);
CREATE INDEX IF NOT EXISTS idx_ng_referrals_patient ON ng_referrals (patient_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ng_referrals_provider ON ng_referrals (provider_user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS ng_fhir_resources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  encounter_id UUID REFERENCES ng_clinical_encounters(id) ON DELETE SET NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  resource_version INTEGER NOT NULL DEFAULT 1,
  local_table TEXT,
  local_id UUID,
  direction TEXT DEFAULT 'outbound' CHECK (direction IN ('inbound', 'outbound', 'bidirectional')),
  status TEXT DEFAULT 'current' CHECK (status IN ('draft', 'current', 'superseded', 'entered_in_error')),
  resource JSONB NOT NULL,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  last_accessed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (resource_type, resource_id, resource_version)
);

CREATE INDEX IF NOT EXISTS idx_ng_fhir_resources_patient ON ng_fhir_resources (patient_user_id, resource_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ng_fhir_resources_local ON ng_fhir_resources (local_table, local_id);
CREATE INDEX IF NOT EXISTS idx_ng_fhir_resources_created_by ON ng_fhir_resources (created_by, created_at DESC);

CREATE TABLE IF NOT EXISTS ng_smart_access_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash TEXT UNIQUE NOT NULL,
  actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  actor_role TEXT,
  scopes TEXT[] DEFAULT ARRAY[]::TEXT[],
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'revoked', 'expired')),
  expires_at TIMESTAMPTZ NOT NULL,
  last_used_at TIMESTAMPTZ,
  metadata JSONB DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ng_smart_tokens_actor ON ng_smart_access_tokens (actor_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ng_smart_tokens_status ON ng_smart_access_tokens (status, expires_at);

CREATE TABLE IF NOT EXISTS ng_smart_access_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token_id UUID REFERENCES ng_smart_access_tokens(id) ON DELETE SET NULL,
  actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  request_method TEXT,
  request_path TEXT,
  response_status INTEGER,
  request_payload JSONB DEFAULT '{}'::JSONB,
  response_payload JSONB DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ng_smart_logs_token ON ng_smart_access_logs (token_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ng_smart_logs_actor ON ng_smart_access_logs (actor_user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS ng_integrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID REFERENCES ng_organizations(id) ON DELETE SET NULL,
  hospital_id UUID REFERENCES ng_hospitals(id) ON DELETE SET NULL,
  pharmacy_id UUID REFERENCES ng_pharmacies(id) ON DELETE SET NULL,
  integration_name TEXT NOT NULL,
  organization_type TEXT CHECK (organization_type IN ('hospital', 'clinic', 'pharmacy', 'lab', 'hmo', 'corporate_employer', 'government', 'other')),
  integration_type TEXT NOT NULL DEFAULT 'pending' CHECK (integration_type IN ('manual', 'api', 'fhir_r4', 'whatsapp_assisted', 'pending')),
  connection_status TEXT NOT NULL DEFAULT 'pending' CHECK (connection_status IN ('active', 'pending', 'sandbox', 'unavailable', 'configured', 'error')),
  auth_mode TEXT DEFAULT 'not_configured',
  smart_on_fhir_status TEXT DEFAULT 'unavailable',
  supported_capabilities TEXT[] DEFAULT ARRAY[]::TEXT[],
  last_sync_at TIMESTAMPTZ,
  admin_notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ng_integrations_status ON ng_integrations (connection_status);
CREATE INDEX IF NOT EXISTS idx_ng_integrations_type ON ng_integrations (integration_type);

CREATE TABLE IF NOT EXISTS ng_exchange_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  encounter_id UUID REFERENCES ng_clinical_encounters(id) ON DELETE SET NULL,
  referral_id UUID REFERENCES ng_referrals(id) ON DELETE SET NULL,
  integration_id UUID REFERENCES ng_integrations(id) ON DELETE SET NULL,
  exchange_type TEXT NOT NULL CHECK (exchange_type IN (
    'referral',
    'care_summary',
    'medication_update',
    'lab_result',
    'encounter_summary',
    'patient_record'
  )),
  direction TEXT NOT NULL DEFAULT 'outbound' CHECK (direction IN ('inbound', 'outbound', 'internal')),
  status TEXT NOT NULL DEFAULT 'created' CHECK (status IN ('created', 'sent', 'received', 'accepted', 'failed', 'cancelled')),
  payload JSONB DEFAULT '{}'::JSONB,
  response_payload JSONB DEFAULT '{}'::JSONB,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  received_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ng_exchange_patient ON ng_exchange_messages (patient_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ng_exchange_created_by ON ng_exchange_messages (created_by, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ng_exchange_type_status ON ng_exchange_messages (exchange_type, status);

ALTER TABLE ng_referrals
  ADD COLUMN IF NOT EXISTS fhir_resource_id UUID REFERENCES ng_fhir_resources(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS exchange_message_id UUID REFERENCES ng_exchange_messages(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS ng_integrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID REFERENCES ng_organizations(id) ON DELETE SET NULL,
  hospital_id UUID REFERENCES ng_hospitals(id) ON DELETE SET NULL,
  pharmacy_id UUID REFERENCES ng_pharmacies(id) ON DELETE SET NULL,
  integration_name TEXT NOT NULL,
  organization_type TEXT CHECK (organization_type IN ('hospital', 'clinic', 'pharmacy', 'lab', 'hmo', 'corporate_employer', 'government', 'other')),
  integration_type TEXT NOT NULL DEFAULT 'pending' CHECK (integration_type IN ('manual', 'api', 'fhir_r4', 'whatsapp_assisted', 'pending')),
  connection_status TEXT NOT NULL DEFAULT 'pending' CHECK (connection_status IN ('active', 'pending', 'sandbox', 'unavailable', 'configured', 'error')),
  auth_mode TEXT DEFAULT 'not_configured',
  smart_on_fhir_status TEXT DEFAULT 'unavailable',
  supported_capabilities TEXT[] DEFAULT ARRAY[]::TEXT[],
  last_sync_at TIMESTAMPTZ,
  admin_notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ng_integrations_status ON ng_integrations (connection_status);
CREATE INDEX IF NOT EXISTS idx_ng_integrations_type ON ng_integrations (integration_type);

ALTER TABLE ng_integrations
  ADD COLUMN IF NOT EXISTS fhir_base_url TEXT,
  ADD COLUMN IF NOT EXISTS smart_client_id TEXT,
  ADD COLUMN IF NOT EXISTS smart_scopes TEXT[] DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN IF NOT EXISTS authorization_endpoint TEXT,
  ADD COLUMN IF NOT EXISTS token_endpoint TEXT,
  ADD COLUMN IF NOT EXISTS last_sync_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_tested_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_error TEXT,
  ADD COLUMN IF NOT EXISTS capability_statement JSONB DEFAULT '{}'::JSONB,
  ADD COLUMN IF NOT EXISTS exchange_config JSONB DEFAULT '{}'::JSONB;

CREATE TABLE IF NOT EXISTS ng_fhir_resource_mappings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  integration_id UUID REFERENCES ng_integrations(id) ON DELETE CASCADE,
  resource_type TEXT NOT NULL,
  local_table TEXT NOT NULL,
  local_id UUID,
  external_resource_id TEXT,
  sync_direction TEXT DEFAULT 'bidirectional' CHECK (sync_direction IN ('inbound', 'outbound', 'bidirectional')),
  sync_status TEXT DEFAULT 'pending' CHECK (sync_status IN ('pending', 'synced', 'error', 'unavailable')),
  last_synced_at TIMESTAMPTZ,
  last_error TEXT,
  metadata JSONB DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ng_smart_auth_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  integration_id UUID REFERENCES ng_integrations(id) ON DELETE CASCADE,
  actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  state_hash TEXT NOT NULL,
  scopes TEXT[] DEFAULT ARRAY[]::TEXT[],
  status TEXT DEFAULT 'created' CHECK (status IN ('created', 'authorized', 'token_exchanged', 'expired', 'failed')),
  expires_at TIMESTAMPTZ,
  metadata JSONB DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ng_emr_records_patient ON ng_emr_records (patient_user_id);
CREATE INDEX IF NOT EXISTS idx_ng_clinical_encounters_patient ON ng_clinical_encounters (patient_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ng_soap_notes_patient ON ng_soap_notes (patient_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ng_diagnoses_patient ON ng_diagnoses (patient_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ng_medication_history_patient ON ng_medication_history (patient_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ng_lab_results_patient ON ng_lab_results (patient_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ng_clinical_documents_patient ON ng_clinical_documents (patient_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ng_visit_timeline_patient ON ng_visit_timeline_events (patient_user_id, event_at DESC);
CREATE INDEX IF NOT EXISTS idx_ng_digital_rx_patient ON ng_digital_prescriptions (patient_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ng_digital_rx_provider ON ng_digital_prescriptions (provider_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ng_digital_rx_pharmacy ON ng_digital_prescriptions (pharmacy_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ng_digital_rx_status ON ng_digital_prescriptions (lifecycle_status);
CREATE INDEX IF NOT EXISTS idx_ng_rx_audit_prescription ON ng_prescription_audit_logs (prescription_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ng_fhir_mappings_integration ON ng_fhir_resource_mappings (integration_id, resource_type);
CREATE INDEX IF NOT EXISTS idx_ng_smart_sessions_integration ON ng_smart_auth_sessions (integration_id, created_at DESC);
