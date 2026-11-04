-- DoctaRx Nigeria PHC registered-device synchronization, governed AI drafts,
-- and programme-scoped reporting lineage.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS ng_phc_client_devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  programme_id UUID NOT NULL REFERENCES public_health_programmes(id) ON DELETE RESTRICT,
  facility_id UUID REFERENCES ng_hospitals(id) ON DELETE RESTRICT,
  device_public_id TEXT NOT NULL,
  display_name TEXT,
  public_key_jwk JSONB,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('pending','active','revoked','wiped','expired')),
  registered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  wipe_requested_at TIMESTAMPTZ,
  wipe_confirmed_at TIMESTAMPTZ,
  metadata_json JSONB NOT NULL DEFAULT '{}'::JSONB,
  UNIQUE (user_id, programme_id, device_public_id)
);

CREATE INDEX IF NOT EXISTS idx_ng_phc_client_devices_active
  ON ng_phc_client_devices (user_id, programme_id, status);

CREATE TABLE IF NOT EXISTS ng_phc_sync_operations (
  id UUID PRIMARY KEY,
  device_id UUID NOT NULL REFERENCES ng_phc_client_devices(id) ON DELETE RESTRICT,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  programme_id UUID NOT NULL REFERENCES public_health_programmes(id) ON DELETE RESTRICT,
  facility_id UUID REFERENCES ng_hospitals(id) ON DELETE RESTRICT,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('patient_registration','enrollment','encounter_draft','observation','queue_entry')),
  entity_id UUID,
  operation_type TEXT NOT NULL CHECK (operation_type IN ('create','update','submit')),
  client_record_version INTEGER,
  payload_hash CHAR(64) NOT NULL,
  status TEXT NOT NULL DEFAULT 'received' CHECK (status IN ('received','applied','conflict','rejected','failed')),
  server_record_version INTEGER,
  error_code TEXT,
  error_summary TEXT,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  applied_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_ng_phc_sync_operations_device
  ON ng_phc_sync_operations (device_id, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_ng_phc_sync_operations_status
  ON ng_phc_sync_operations (programme_id, status, received_at);

CREATE TABLE IF NOT EXISTS ng_phc_sync_conflicts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operation_id UUID NOT NULL REFERENCES ng_phc_sync_operations(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL,
  entity_id UUID,
  conflicting_fields JSONB NOT NULL DEFAULT '[]'::JSONB,
  client_value_hashes JSONB NOT NULL DEFAULT '{}'::JSONB,
  server_value_hashes JSONB NOT NULL DEFAULT '{}'::JSONB,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved_client','resolved_server','resolved_manual','discarded')),
  resolved_by UUID REFERENCES users(id) ON DELETE SET NULL,
  resolution_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_ng_phc_sync_conflicts_open
  ON ng_phc_sync_conflicts (status, created_at)
  WHERE status = 'open';

CREATE TABLE IF NOT EXISTS ng_clinical_ai_sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_key TEXT NOT NULL,
  title TEXT NOT NULL,
  publisher TEXT NOT NULL,
  source_version TEXT NOT NULL,
  jurisdiction TEXT,
  source_uri TEXT,
  content_hash CHAR(64) NOT NULL,
  approval_status TEXT NOT NULL DEFAULT 'pending' CHECK (approval_status IN ('pending','approved','rejected','retired')),
  approved_by UUID REFERENCES users(id) ON DELETE SET NULL,
  approved_at TIMESTAMPTZ,
  retired_at TIMESTAMPTZ,
  metadata_json JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (source_key, source_version)
);

CREATE TABLE IF NOT EXISTS ng_clinical_ai_suggestions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  programme_id UUID NOT NULL REFERENCES public_health_programmes(id) ON DELETE RESTRICT,
  facility_id UUID NOT NULL REFERENCES ng_hospitals(id) ON DELETE RESTRICT,
  patient_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  encounter_id UUID NOT NULL REFERENCES ng_clinical_encounters(id) ON DELETE RESTRICT,
  suggestion_type TEXT NOT NULL CHECK (suggestion_type IN ('encounter_summary','soap_draft','missing_information','follow_up_draft','coding_assistance')),
  model_provider TEXT NOT NULL,
  model_name TEXT NOT NULL,
  model_version TEXT,
  prompt_version TEXT NOT NULL,
  input_hash CHAR(64) NOT NULL,
  output_encrypted TEXT NOT NULL,
  output_iv TEXT NOT NULL,
  output_tag TEXT NOT NULL,
  source_citations_json JSONB NOT NULL DEFAULT '[]'::JSONB,
  missing_information_json JSONB NOT NULL DEFAULT '[]'::JSONB,
  validation_json JSONB NOT NULL DEFAULT '{}'::JSONB,
  status TEXT NOT NULL DEFAULT 'drafted' CHECK (status IN ('drafted','reviewed','accepted','rejected','expired')),
  requested_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_ng_clinical_ai_encounter
  ON ng_clinical_ai_suggestions (encounter_id, created_at DESC);

CREATE TABLE IF NOT EXISTS ng_clinical_ai_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  suggestion_id UUID NOT NULL REFERENCES ng_clinical_ai_suggestions(id) ON DELETE RESTRICT,
  reviewer_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  decision TEXT NOT NULL CHECK (decision IN ('accepted','accepted_with_edits','rejected')),
  edited_output_hash CHAR(64),
  edited_output_encrypted TEXT,
  edited_output_iv TEXT,
  edited_output_tag TEXT,
  rejection_reason TEXT,
  rejection_reason_encrypted TEXT,
  rejection_reason_iv TEXT,
  rejection_reason_tag TEXT,
  review_metadata_json JSONB NOT NULL DEFAULT '{}'::JSONB,
  reviewed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE ng_clinical_ai_reviews
  ADD COLUMN IF NOT EXISTS edited_output_encrypted TEXT,
  ADD COLUMN IF NOT EXISTS edited_output_iv TEXT,
  ADD COLUMN IF NOT EXISTS edited_output_tag TEXT,
  ADD COLUMN IF NOT EXISTS rejection_reason_encrypted TEXT,
  ADD COLUMN IF NOT EXISTS rejection_reason_iv TEXT,
  ADD COLUMN IF NOT EXISTS rejection_reason_tag TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_ng_clinical_ai_final_review
  ON ng_clinical_ai_reviews (suggestion_id);

CREATE INDEX IF NOT EXISTS idx_ng_clinical_ai_reviews_suggestion
  ON ng_clinical_ai_reviews (suggestion_id, reviewed_at);

CREATE TABLE IF NOT EXISTS ng_indicator_source_definitions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  indicator_id UUID NOT NULL REFERENCES public_health_indicators(id) ON DELETE RESTRICT,
  programme_id UUID NOT NULL REFERENCES public_health_programmes(id) ON DELETE RESTRICT,
  source_version INTEGER NOT NULL DEFAULT 1 CHECK (source_version > 0),
  source_table TEXT NOT NULL,
  numerator_definition_json JSONB NOT NULL,
  denominator_definition_json JSONB,
  null_policy TEXT NOT NULL DEFAULT 'unavailable' CHECK (null_policy IN ('unavailable','measured_zero')),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved','retired')),
  approved_by UUID REFERENCES users(id) ON DELETE SET NULL,
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (indicator_id, programme_id, source_version)
);

INSERT INTO ng_indicator_source_definitions
  (indicator_id, programme_id, source_version, source_table,
   numerator_definition_json, denominator_definition_json,
   null_policy, status, approved_at)
SELECT i.id, p.id, 1, definitions.source_table,
       definitions.numerator::JSONB, definitions.denominator::JSONB,
       definitions.null_policy, 'approved', NOW()
  FROM public_health_programmes p
  JOIN (VALUES
    ('new_patient_registrations','ng_programme_patient_enrollments','{"aggregate":"count","dateField":"created_at"}','null','measured_zero'),
    ('active_patients','ng_programme_patient_enrollments','{"aggregate":"count","status":["active","paused","transferred"]}','null','measured_zero'),
    ('total_consultations','ng_clinical_encounters','{"aggregate":"count","dateField":"started_at"}','null','measured_zero'),
    ('teleconsultations','ng_clinical_encounters','{"aggregate":"count","encounterType":"phc_assisted_telehealth","dateField":"started_at"}','null','measured_zero'),
    ('completed_consultations','ng_phc_queue_entries','{"aggregate":"count","status":"completed","dateField":"completed_at"}','null','measured_zero'),
    ('cancelled_consultations','ng_phc_queue_entries','{"aggregate":"count","status":"cancelled","dateField":"updated_at"}','null','measured_zero'),
    ('appointment_bookings','ng_appointments','{"aggregate":"count","dateField":"created_at"}','null','measured_zero'),
    ('referrals_created','ng_referrals','{"aggregate":"count","dateField":"created_at"}','null','measured_zero'),
    ('referrals_completed','ng_referrals','{"aggregate":"count","status":"completed","dateField":"completed_at"}','null','measured_zero'),
    ('pending_referrals','ng_referrals','{"aggregate":"count","statusNotIn":["completed","cancelled","declined"]}','null','measured_zero'),
    ('prescriptions_created','ng_digital_prescriptions','{"aggregate":"count","dateField":"created_at"}','null','measured_zero'),
    ('active_providers','ng_clinician_programme_assignments','{"aggregate":"countDistinct","field":"provider_user_id","status":"active"}','null','measured_zero'),
    ('active_facilities','ng_programme_facilities','{"aggregate":"count","status":"active"}','null','measured_zero'),
    ('reports_generated','public_health_reports','{"aggregate":"count","dateField":"created_at"}','null','measured_zero'),
    ('service_utilization','ng_phc_queue_entries','{"aggregate":"count","status":"completed","dateField":"completed_at"}','null','measured_zero')
  ) AS definitions(internal_key,source_table,numerator,denominator,null_policy)
    ON TRUE
  JOIN public_health_indicators i ON i.internal_key = definitions.internal_key
 WHERE p.status IN ('active','planning')
ON CONFLICT (indicator_id, programme_id, source_version) DO NOTHING;

ALTER TABLE public_health_reports
  ADD COLUMN IF NOT EXISTS programme_id UUID REFERENCES public_health_programmes(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS hospital_id UUID REFERENCES ng_hospitals(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS source_definition_version INTEGER,
  ADD COLUMN IF NOT EXISTS source_reconciliation_hash CHAR(64),
  ADD COLUMN IF NOT EXISTS contains_patient_identifiers BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_public_health_reports_programme_scope
  ON public_health_reports (programme_id, hospital_id, report_period, status);

DO $$ BEGIN
  ALTER TABLE public_health_reports
    ADD CONSTRAINT public_health_reports_no_patient_identifiers
    CHECK (contains_patient_identifiers = FALSE);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE dhis2_integration_settings
  ADD COLUMN IF NOT EXISTS programme_id UUID REFERENCES public_health_programmes(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS last_validated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_validated_by UUID REFERENCES users(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_dhis2_settings_programme
  ON dhis2_integration_settings (programme_id)
  WHERE programme_id IS NOT NULL;

UPDATE public_health_programmes
   SET settings_json = settings_json || '{"clinicalAiEnabled":false,"offlineClinicalSyncEnabled":false}'::JSONB
 WHERE COALESCE(settings_json, '{}'::JSONB) ->> 'clinicalAiEnabled' IS NULL;

INSERT INTO ng_programme_feature_flags
  (programme_id, feature_key, enabled, configuration_json)
SELECT id, feature_key, FALSE, '{"requiresExplicitProgrammeApproval":true}'::JSONB
  FROM public_health_programmes
 CROSS JOIN (VALUES ('offline_clinical_sync'), ('clinical_ai')) AS flags(feature_key)
ON CONFLICT (programme_id, feature_key) DO NOTHING;
