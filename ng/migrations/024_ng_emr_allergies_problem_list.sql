-- Nigeria EMR hardening: first-class allergies, problem list, and an
-- append-only record of clinical document versions.
--
-- Allergies were previously a JSONB array on ng_emr_records, which cannot carry
-- reaction, criticality, attribution, or a correction history. Prescribing needs
-- a queryable, attributable, non-deletable allergy list. Problems likewise had no
-- coded longitudinal list, so continuity of care could not be read from the chart.

CREATE TABLE IF NOT EXISTS ng_patient_allergies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  substance_code TEXT,
  substance_text TEXT NOT NULL,
  code_system TEXT DEFAULT 'http://snomed.info/sct',
  reaction_code TEXT,
  reaction_text TEXT,
  criticality TEXT NOT NULL DEFAULT 'unable-to-assess'
    CHECK (criticality IN ('low', 'high', 'unable-to-assess')),
  clinical_status TEXT NOT NULL DEFAULT 'active'
    CHECK (clinical_status IN ('active', 'inactive', 'resolved', 'entered-in-error')),
  verification_status TEXT NOT NULL DEFAULT 'unconfirmed'
    CHECK (verification_status IN ('unconfirmed', 'confirmed', 'refuted', 'entered-in-error')),
  category TEXT CHECK (category IN ('medication', 'food', 'environment', 'biologic')),
  onset_date DATE,
  recorded_by_user_id UUID REFERENCES users(id) ON DELETE RESTRICT,
  recorded_by_role TEXT,
  source TEXT NOT NULL DEFAULT 'clinician'
    CHECK (source IN ('clinician', 'patient_reported', 'imported')),
  note TEXT,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  superseded_by_allergy_id UUID REFERENCES ng_patient_allergies(id) ON DELETE RESTRICT,
  metadata_json JSONB NOT NULL DEFAULT '{}'::JSONB,
  CONSTRAINT ng_patient_allergy_needs_label
    CHECK (substance_text IS NOT NULL AND btrim(substance_text) <> '')
);

CREATE INDEX IF NOT EXISTS idx_ng_patient_allergies_active
  ON ng_patient_allergies (patient_user_id, clinical_status, criticality DESC);

CREATE INDEX IF NOT EXISTS idx_ng_patient_allergies_substance
  ON ng_patient_allergies (patient_user_id, lower(substance_text));

-- A single uncorrected record per substance/code per patient.
CREATE UNIQUE INDEX IF NOT EXISTS idx_ng_patient_allergies_unique_active
  ON ng_patient_allergies (patient_user_id, COALESCE(substance_code, lower(substance_text)))
  WHERE clinical_status <> 'entered-in-error' AND superseded_by_allergy_id IS NULL;

CREATE TABLE IF NOT EXISTS ng_problem_list_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  encounter_id UUID REFERENCES ng_clinical_encounters(id) ON DELETE SET NULL,
  problem_code TEXT,
  problem_text TEXT NOT NULL,
  code_system TEXT DEFAULT 'ICD-10',
  clinical_status TEXT NOT NULL DEFAULT 'active'
    CHECK (clinical_status IN ('active', 'recurrence', 'relapse', 'remission', 'resolved', 'inactive', 'entered-in-error')),
  verification_status TEXT NOT NULL DEFAULT 'unconfirmed'
    CHECK (verification_status IN ('unconfirmed', 'confirmed', 'refuted', 'entered-in-error')),
  category TEXT CHECK (category IN ('condition', 'finding')),
  severity TEXT,
  onset_date DATE,
  resolved_date DATE,
  recorded_by_user_id UUID REFERENCES users(id) ON DELETE RESTRICT,
  recorded_by_role TEXT,
  source TEXT NOT NULL DEFAULT 'clinician'
    CHECK (source IN ('clinician', 'patient_reported', 'imported')),
  note TEXT,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  superseded_by_problem_id UUID REFERENCES ng_problem_list_items(id) ON DELETE RESTRICT,
  metadata_json JSONB NOT NULL DEFAULT '{}'::JSONB,
  CONSTRAINT ng_problem_list_item_needs_label
    CHECK (problem_text IS NOT NULL AND btrim(problem_text) <> '')
);

CREATE INDEX IF NOT EXISTS idx_ng_problem_list_active
  ON ng_problem_list_items (patient_user_id, clinical_status, recorded_at DESC);

CREATE INDEX IF NOT EXISTS idx_ng_problem_list_encounter
  ON ng_problem_list_items (encounter_id);

-- Prescription safety: fast lookup of the substances a patient reacts to.
CREATE TABLE IF NOT EXISTS ng_prescription_allergy_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prescription_id UUID REFERENCES ng_digital_prescriptions(id) ON DELETE CASCADE,
  patient_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  allergy_id UUID NOT NULL REFERENCES ng_patient_allergies(id) ON DELETE CASCADE,
  medication_text TEXT NOT NULL,
  match_type TEXT NOT NULL DEFAULT 'name_match'
    CHECK (match_type IN ('name_match', 'class_match', 'manual')),
  acknowledged_by_user_id UUID REFERENCES users(id) ON DELETE RESTRICT,
  acknowledged_at TIMESTAMPTZ,
  acknowledgement_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ng_prescription_allergy_alerts_rx
  ON ng_prescription_allergy_alerts (prescription_id, created_at);
