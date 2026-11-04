-- DoctaRx Nigeria PHC clinical operations, identity, credential, queue,
-- observation, referral, and follow-up records.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE UNIQUE INDEX IF NOT EXISTS uq_ng_programme_facilities_composite
  ON ng_programme_facilities (id, programme_id, facility_id);

ALTER TABLE ng_appointments
  ADD COLUMN IF NOT EXISTS programme_id UUID REFERENCES public_health_programmes(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS programme_facility_id UUID REFERENCES ng_programme_facilities(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS idempotency_key UUID,
  ADD COLUMN IF NOT EXISTS record_version INTEGER NOT NULL DEFAULT 1;

CREATE UNIQUE INDEX IF NOT EXISTS uq_ng_appointments_idempotency
  ON ng_appointments (programme_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ng_appointments_programme_queue
  ON ng_appointments (programme_id, programme_facility_id, status, scheduled_at);

ALTER TABLE ng_clinical_encounters
  ADD COLUMN IF NOT EXISTS programme_id UUID REFERENCES public_health_programmes(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS facility_id UUID REFERENCES ng_hospitals(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS programme_facility_id UUID REFERENCES ng_programme_facilities(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS enrollment_id UUID REFERENCES ng_programme_patient_enrollments(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS opened_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS idempotency_key UUID,
  ADD COLUMN IF NOT EXISTS record_version INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS suspended_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS suspension_reason TEXT,
  ADD COLUMN IF NOT EXISTS resumed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reason_for_visit_encrypted TEXT,
  ADD COLUMN IF NOT EXISTS reason_for_visit_iv VARCHAR(255),
  ADD COLUMN IF NOT EXISTS reason_for_visit_tag VARCHAR(255),
  ADD COLUMN IF NOT EXISTS chief_complaint_encrypted TEXT,
  ADD COLUMN IF NOT EXISTS chief_complaint_iv VARCHAR(255),
  ADD COLUMN IF NOT EXISTS chief_complaint_tag VARCHAR(255);

CREATE UNIQUE INDEX IF NOT EXISTS uq_ng_encounters_idempotency
  ON ng_clinical_encounters (programme_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ng_encounters_programme_patient
  ON ng_clinical_encounters (programme_id, facility_id, patient_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ng_encounters_programme_status
  ON ng_clinical_encounters (programme_id, programme_facility_id, status, created_at DESC);

DO $$ BEGIN
  ALTER TABLE ng_clinical_encounters
    ADD CONSTRAINT fk_ng_encounter_programme_facility_scope
    FOREIGN KEY (programme_facility_id, programme_id, facility_id)
    REFERENCES ng_programme_facilities (id, programme_id, facility_id)
    ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE clinical_encounters
  ALTER COLUMN provider_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS programme_id UUID REFERENCES public_health_programmes(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS facility_id UUID REFERENCES ng_hospitals(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS programme_facility_id UUID REFERENCES ng_programme_facilities(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS source_system TEXT NOT NULL DEFAULT 'doctarx_core',
  ADD COLUMN IF NOT EXISTS source_record_id UUID,
  ADD COLUMN IF NOT EXISTS idempotency_key UUID,
  ADD COLUMN IF NOT EXISTS record_version INTEGER NOT NULL DEFAULT 1;

CREATE UNIQUE INDEX IF NOT EXISTS uq_core_encounters_idempotency
  ON clinical_encounters (programme_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_core_encounters_source_record
  ON clinical_encounters (source_system, source_record_id)
  WHERE source_record_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_core_encounters_programme_patient
  ON clinical_encounters (programme_id, facility_id, patient_id, created_at DESC);

ALTER TABLE ng_referrals
  ADD COLUMN IF NOT EXISTS programme_id UUID REFERENCES public_health_programmes(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS facility_id UUID REFERENCES ng_hospitals(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS programme_facility_id UUID REFERENCES ng_programme_facilities(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS outcome_status TEXT,
  ADD COLUMN IF NOT EXISTS outcome_summary TEXT,
  ADD COLUMN IF NOT EXISTS returned_to_phc_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS due_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS closed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS idempotency_key UUID,
  ADD COLUMN IF NOT EXISTS reason_encrypted TEXT,
  ADD COLUMN IF NOT EXISTS reason_iv VARCHAR(255),
  ADD COLUMN IF NOT EXISTS reason_tag VARCHAR(255),
  ADD COLUMN IF NOT EXISTS clinical_notes_encrypted TEXT,
  ADD COLUMN IF NOT EXISTS clinical_notes_iv VARCHAR(255),
  ADD COLUMN IF NOT EXISTS clinical_notes_tag VARCHAR(255),
  ADD COLUMN IF NOT EXISTS response_summary_encrypted TEXT,
  ADD COLUMN IF NOT EXISTS response_summary_iv VARCHAR(255),
  ADD COLUMN IF NOT EXISTS response_summary_tag VARCHAR(255);

CREATE UNIQUE INDEX IF NOT EXISTS uq_ng_referrals_idempotency
  ON ng_referrals (programme_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ng_referrals_programme_due
  ON ng_referrals (programme_id, facility_id, status, due_at);

ALTER TABLE ng_digital_prescriptions
  ADD COLUMN IF NOT EXISTS programme_id UUID REFERENCES public_health_programmes(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS facility_id UUID REFERENCES ng_hospitals(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS idempotency_key UUID;

CREATE UNIQUE INDEX IF NOT EXISTS uq_ng_digital_rx_idempotency
  ON ng_digital_prescriptions (programme_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS ng_patient_identifiers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  programme_id UUID REFERENCES public_health_programmes(id) ON DELETE RESTRICT,
  facility_id UUID REFERENCES ng_hospitals(id) ON DELETE RESTRICT,
  identifier_type TEXT NOT NULL CHECK (identifier_type IN (
    'platform_patient_id','facility_mrn','programme_patient_number',
    'verified_phone','approved_government_identifier','legacy_identifier'
  )),
  value_hash CHAR(64) NOT NULL,
  value_encrypted TEXT,
  value_iv TEXT,
  value_tag TEXT,
  display_suffix TEXT,
  issuer TEXT,
  verification_status TEXT NOT NULL DEFAULT 'unverified' CHECK (verification_status IN ('unverified','verified','disputed','retired')),
  verified_by UUID REFERENCES users(id) ON DELETE SET NULL,
  verified_at TIMESTAMPTZ,
  retired_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_ng_patient_identifier_active
  ON ng_patient_identifiers (
    COALESCE(programme_id, '00000000-0000-0000-0000-000000000000'::UUID),
    identifier_type,
    value_hash
  )
  WHERE verification_status <> 'retired';
CREATE INDEX IF NOT EXISTS idx_ng_patient_identifiers_patient
  ON ng_patient_identifiers (patient_user_id, verification_status);

CREATE TABLE IF NOT EXISTS ng_patient_identity_matches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  programme_id UUID REFERENCES public_health_programmes(id) ON DELETE RESTRICT,
  candidate_patient_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  existing_patient_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  confidence NUMERIC(5,4) CHECK (confidence >= 0 AND confidence <= 1),
  evidence_json JSONB NOT NULL DEFAULT '{}'::JSONB,
  status TEXT NOT NULL DEFAULT 'pending_review' CHECK (status IN ('pending_review','confirmed_duplicate','not_duplicate','merged','reversed')),
  reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  resolution_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (candidate_patient_user_id <> existing_patient_user_id)
);

CREATE INDEX IF NOT EXISTS idx_ng_patient_identity_matches_review
  ON ng_patient_identity_matches (programme_id, status, confidence DESC);

CREATE TABLE IF NOT EXISTS ng_patient_data_sharing_consents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  programme_id UUID NOT NULL REFERENCES public_health_programmes(id) ON DELETE RESTRICT,
  facility_id UUID REFERENCES ng_hospitals(id) ON DELETE RESTRICT,
  recipient_type TEXT NOT NULL,
  recipient_id UUID,
  purpose TEXT NOT NULL,
  scope_json JSONB NOT NULL DEFAULT '{}'::JSONB,
  consent_version TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'granted' CHECK (status IN ('granted','declined','revoked','expired')),
  granted_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  recorded_by UUID REFERENCES users(id) ON DELETE SET NULL,
  signature_evidence_json JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ng_patient_consents_active
  ON ng_patient_data_sharing_consents (patient_user_id, programme_id, status, expires_at);

CREATE TABLE IF NOT EXISTS ng_provider_credentials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  provider_id UUID REFERENCES ng_providers(id) ON DELETE SET NULL,
  credential_type TEXT NOT NULL,
  issuing_authority TEXT NOT NULL,
  credential_number_encrypted TEXT,
  credential_number_hash CHAR(64),
  country_code CHAR(2) NOT NULL DEFAULT 'NG',
  jurisdiction_code TEXT,
  specialty TEXT,
  scope_of_practice_json JSONB NOT NULL DEFAULT '{}'::JSONB,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','verified','expired','suspended','revoked','rejected')),
  valid_from DATE,
  expires_on DATE,
  evidence_storage_ref TEXT,
  verified_by UUID REFERENCES users(id) ON DELETE SET NULL,
  verified_at TIMESTAMPTZ,
  verification_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_ng_provider_credential_number
  ON ng_provider_credentials (issuing_authority, credential_type, credential_number_hash)
  WHERE credential_number_hash IS NOT NULL AND status <> 'revoked';
CREATE INDEX IF NOT EXISTS idx_ng_provider_credentials_eligibility
  ON ng_provider_credentials (provider_user_id, status, expires_on);

CREATE TABLE IF NOT EXISTS ng_clinician_programme_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  provider_id UUID REFERENCES ng_providers(id) ON DELETE SET NULL,
  programme_id UUID NOT NULL REFERENCES public_health_programmes(id) ON DELETE RESTRICT,
  facility_id UUID REFERENCES ng_hospitals(id) ON DELETE RESTRICT,
  role TEXT NOT NULL DEFAULT 'remote_clinician' CHECK (role IN ('remote_clinician','clinical_supervisor','on_call_clinician')),
  specialty TEXT,
  capacity INTEGER NOT NULL DEFAULT 1 CHECK (capacity > 0),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','suspended','ended')),
  effective_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  assigned_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_ng_clinician_programme_assignment
  ON ng_clinician_programme_assignments (
    provider_user_id,
    programme_id,
    COALESCE(facility_id, '00000000-0000-0000-0000-000000000000'::UUID),
    role
  )
  WHERE status IN ('active','paused');
CREATE INDEX IF NOT EXISTS idx_ng_clinician_assignment_eligible
  ON ng_clinician_programme_assignments (programme_id, facility_id, specialty, status);

CREATE TABLE IF NOT EXISTS ng_phc_queue_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  programme_id UUID NOT NULL REFERENCES public_health_programmes(id) ON DELETE RESTRICT,
  facility_id UUID NOT NULL REFERENCES ng_hospitals(id) ON DELETE RESTRICT,
  programme_facility_id UUID NOT NULL REFERENCES ng_programme_facilities(id) ON DELETE RESTRICT,
  enrollment_id UUID NOT NULL REFERENCES ng_programme_patient_enrollments(id) ON DELETE RESTRICT,
  patient_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  encounter_id UUID NOT NULL REFERENCES ng_clinical_encounters(id) ON DELETE RESTRICT,
  requested_specialty TEXT,
  priority TEXT NOT NULL DEFAULT 'routine' CHECK (priority IN ('emergency','urgent','priority','routine')),
  priority_score INTEGER NOT NULL DEFAULT 50 CHECK (priority_score BETWEEN 0 AND 100),
  status TEXT NOT NULL DEFAULT 'waiting' CHECK (status IN (
    'draft','waiting','claimed','called','in_consultation','on_hold',
    'completed','cancelled','no_show','left_without_being_seen'
  )),
  assigned_provider_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  claimed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  hold_reason TEXT,
  escalation_reason TEXT,
  entered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  claimed_at TIMESTAMPTZ,
  consultation_started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  due_at TIMESTAMPTZ,
  idempotency_key UUID NOT NULL,
  record_version INTEGER NOT NULL DEFAULT 1,
  metadata_json JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (programme_id, idempotency_key),
  UNIQUE (encounter_id)
);

CREATE INDEX IF NOT EXISTS idx_ng_phc_queue_dispatch
  ON ng_phc_queue_entries (programme_id, facility_id, status, priority_score DESC, entered_at);
CREATE INDEX IF NOT EXISTS idx_ng_phc_queue_provider
  ON ng_phc_queue_entries (assigned_provider_user_id, status, entered_at);

DO $$ BEGIN
  ALTER TABLE ng_phc_queue_entries
    ADD CONSTRAINT fk_ng_queue_programme_facility_scope
    FOREIGN KEY (programme_facility_id, programme_id, facility_id)
    REFERENCES ng_programme_facilities (id, programme_id, facility_id)
    ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS ng_phc_queue_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  queue_entry_id UUID NOT NULL REFERENCES ng_phc_queue_entries(id) ON DELETE CASCADE,
  actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  from_status TEXT,
  to_status TEXT NOT NULL,
  reason TEXT,
  metadata_json JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ng_phc_queue_events_entry
  ON ng_phc_queue_events (queue_entry_id, created_at);

CREATE TABLE IF NOT EXISTS ng_follow_up_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  programme_id UUID NOT NULL REFERENCES public_health_programmes(id) ON DELETE RESTRICT,
  facility_id UUID NOT NULL REFERENCES ng_hospitals(id) ON DELETE RESTRICT,
  patient_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  encounter_id UUID REFERENCES ng_clinical_encounters(id) ON DELETE RESTRICT,
  referral_id UUID REFERENCES ng_referrals(id) ON DELETE RESTRICT,
  task_type TEXT NOT NULL,
  title TEXT NOT NULL,
  title_encrypted TEXT,
  title_iv VARCHAR(255),
  title_tag VARCHAR(255),
  instructions TEXT,
  instructions_encrypted TEXT,
  instructions_iv VARCHAR(255),
  instructions_tag VARCHAR(255),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','completed','waived','cancelled','overdue')),
  priority TEXT NOT NULL DEFAULT 'routine' CHECK (priority IN ('urgent','priority','routine')),
  assigned_role TEXT,
  assigned_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  due_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  completed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  closure_evidence_json JSONB NOT NULL DEFAULT '{}'::JSONB,
  idempotency_key UUID NOT NULL,
  record_version INTEGER NOT NULL DEFAULT 1,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (programme_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_ng_follow_up_worklist
  ON ng_follow_up_tasks (programme_id, facility_id, status, due_at);
CREATE INDEX IF NOT EXISTS idx_ng_follow_up_patient
  ON ng_follow_up_tasks (patient_user_id, status, due_at);

ALTER TABLE ng_follow_up_tasks
  ADD COLUMN IF NOT EXISTS title_encrypted TEXT,
  ADD COLUMN IF NOT EXISTS title_iv VARCHAR(255),
  ADD COLUMN IF NOT EXISTS title_tag VARCHAR(255),
  ADD COLUMN IF NOT EXISTS instructions_encrypted TEXT,
  ADD COLUMN IF NOT EXISTS instructions_iv VARCHAR(255),
  ADD COLUMN IF NOT EXISTS instructions_tag VARCHAR(255);

CREATE TABLE IF NOT EXISTS ng_clinical_devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  programme_id UUID REFERENCES public_health_programmes(id) ON DELETE RESTRICT,
  facility_id UUID REFERENCES ng_hospitals(id) ON DELETE RESTRICT,
  device_type TEXT NOT NULL,
  manufacturer TEXT,
  model TEXT,
  serial_number_hash CHAR(64),
  serial_number_encrypted TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('pending','active','maintenance','retired','revoked')),
  calibration_status TEXT NOT NULL DEFAULT 'unknown' CHECK (calibration_status IN ('unknown','current','due','failed','not_required')),
  calibrated_at TIMESTAMPTZ,
  calibration_due_at TIMESTAMPTZ,
  adapter_key TEXT,
  metadata_json JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_ng_clinical_device_serial
  ON ng_clinical_devices (serial_number_hash)
  WHERE serial_number_hash IS NOT NULL AND status <> 'retired';

CREATE TABLE IF NOT EXISTS ng_device_ingestion_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id UUID REFERENCES ng_clinical_devices(id) ON DELETE RESTRICT,
  programme_id UUID NOT NULL REFERENCES public_health_programmes(id) ON DELETE RESTRICT,
  facility_id UUID NOT NULL REFERENCES ng_hospitals(id) ON DELETE RESTRICT,
  payload_hash CHAR(64) NOT NULL,
  raw_payload_encrypted TEXT,
  raw_payload_iv TEXT,
  raw_payload_tag TEXT,
  status TEXT NOT NULL DEFAULT 'received' CHECK (status IN ('received','validated','quarantined','accepted','rejected')),
  validation_errors_json JSONB NOT NULL DEFAULT '[]'::JSONB,
  received_by UUID REFERENCES users(id) ON DELETE SET NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (device_id, payload_hash)
);

CREATE TABLE IF NOT EXISTS ng_clinical_observations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  programme_id UUID NOT NULL REFERENCES public_health_programmes(id) ON DELETE RESTRICT,
  facility_id UUID NOT NULL REFERENCES ng_hospitals(id) ON DELETE RESTRICT,
  patient_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  encounter_id UUID NOT NULL REFERENCES ng_clinical_encounters(id) ON DELETE RESTRICT,
  code_system TEXT NOT NULL DEFAULT 'LOINC',
  observation_code TEXT NOT NULL,
  display_name TEXT NOT NULL,
  value_type TEXT NOT NULL CHECK (value_type IN ('numeric','text','coded','boolean','quantity_pair')),
  value_numeric NUMERIC,
  value_numeric_secondary NUMERIC,
  value_text TEXT,
  value_text_encrypted TEXT,
  value_text_iv VARCHAR(255),
  value_text_tag VARCHAR(255),
  value_code TEXT,
  unit TEXT,
  reference_range_text TEXT,
  interpretation TEXT,
  method TEXT NOT NULL DEFAULT 'manual' CHECK (method IN ('manual','device','derived','imported')),
  device_id UUID REFERENCES ng_clinical_devices(id) ON DELETE RESTRICT,
  ingestion_event_id UUID REFERENCES ng_device_ingestion_events(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'preliminary' CHECK (status IN ('preliminary','final','amended','entered_in_error')),
  observed_at TIMESTAMPTZ NOT NULL,
  entered_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  confirmed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  confirmed_at TIMESTAMPTZ,
  supersedes_observation_id UUID REFERENCES ng_clinical_observations(id) ON DELETE RESTRICT,
  provenance_json JSONB NOT NULL DEFAULT '{}'::JSONB,
  idempotency_key UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (programme_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_ng_observations_encounter
  ON ng_clinical_observations (encounter_id, observed_at);
CREATE INDEX IF NOT EXISTS idx_ng_observations_patient_code
  ON ng_clinical_observations (patient_user_id, observation_code, observed_at DESC);

ALTER TABLE ng_clinical_observations
  ADD COLUMN IF NOT EXISTS value_text_encrypted TEXT,
  ADD COLUMN IF NOT EXISTS value_text_iv VARCHAR(255),
  ADD COLUMN IF NOT EXISTS value_text_tag VARCHAR(255);

CREATE TABLE IF NOT EXISTS ng_referral_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  referral_id UUID NOT NULL REFERENCES ng_referrals(id) ON DELETE CASCADE,
  actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  from_status TEXT,
  to_status TEXT NOT NULL,
  event_type TEXT NOT NULL,
  outcome_status TEXT,
  notes TEXT,
  notes_encrypted TEXT,
  notes_iv VARCHAR(255),
  notes_tag VARCHAR(255),
  metadata_json JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ng_referral_events_referral
  ON ng_referral_events (referral_id, created_at);

ALTER TABLE ng_referral_events
  ADD COLUMN IF NOT EXISTS notes_encrypted TEXT,
  ADD COLUMN IF NOT EXISTS notes_iv VARCHAR(255),
  ADD COLUMN IF NOT EXISTS notes_tag VARCHAR(255);

CREATE TABLE IF NOT EXISTS ng_clinical_record_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_table TEXT NOT NULL,
  source_id UUID NOT NULL,
  canonical_table TEXT NOT NULL,
  canonical_id UUID NOT NULL,
  migration_status TEXT NOT NULL DEFAULT 'linked' CHECK (migration_status IN ('pending','linked','verified','conflict','failed')),
  source_hash CHAR(64),
  canonical_hash CHAR(64),
  verified_at TIMESTAMPTZ,
  metadata_json JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (source_table, source_id),
  UNIQUE (canonical_table, canonical_id)
);

CREATE INDEX IF NOT EXISTS idx_ng_clinical_record_links_status
  ON ng_clinical_record_links (migration_status, source_table);
