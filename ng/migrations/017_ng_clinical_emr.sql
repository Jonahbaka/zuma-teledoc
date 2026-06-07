-- 017_ng_clinical_emr.sql
-- Core clinical EMR tables: encounters, SOAP notes, diagnoses, medication history, referrals

CREATE TABLE IF NOT EXISTS ng_clinical_encounters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider_id UUID REFERENCES users(id) ON DELETE SET NULL,
  facility_id UUID REFERENCES public_health_facilities(id) ON DELETE SET NULL,
  encounter_type TEXT NOT NULL DEFAULT 'outpatient'
    CHECK (encounter_type IN ('outpatient', 'inpatient', 'telehealth', 'emergency', 'homecare')),
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'in_progress', 'closed', 'cancelled')),
  chief_complaint TEXT,
  encounter_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  duration_minutes INTEGER,
  notes TEXT,
  metadata_json JSONB DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ng_clinical_enc_patient
  ON ng_clinical_encounters (patient_id, encounter_date DESC);
CREATE INDEX IF NOT EXISTS idx_ng_clinical_enc_provider
  ON ng_clinical_encounters (provider_id, status);
CREATE INDEX IF NOT EXISTS idx_ng_clinical_enc_facility
  ON ng_clinical_encounters (facility_id, encounter_date DESC);

CREATE TABLE IF NOT EXISTS ng_soap_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  encounter_id UUID NOT NULL REFERENCES ng_clinical_encounters(id) ON DELETE CASCADE,
  author_id UUID REFERENCES users(id) ON DELETE SET NULL,
  template_key TEXT,
  subjective TEXT,
  objective TEXT,
  assessment TEXT,
  plan TEXT,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'finalized', 'amended')),
  finalized_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ng_soap_notes_encounter ON ng_soap_notes (encounter_id);
CREATE INDEX IF NOT EXISTS idx_ng_soap_notes_author ON ng_soap_notes (author_id, created_at DESC);

CREATE TABLE IF NOT EXISTS ng_diagnoses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  encounter_id UUID NOT NULL REFERENCES ng_clinical_encounters(id) ON DELETE CASCADE,
  patient_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider_id UUID REFERENCES users(id) ON DELETE SET NULL,
  icd10_code TEXT,
  description TEXT NOT NULL,
  diagnosis_type TEXT NOT NULL DEFAULT 'primary'
    CHECK (diagnosis_type IN ('primary', 'secondary', 'differential', 'rule_out')),
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'resolved', 'chronic', 'ruled_out')),
  diagnosed_at TIMESTAMPTZ DEFAULT NOW(),
  resolved_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ng_diagnoses_encounter ON ng_diagnoses (encounter_id);
CREATE INDEX IF NOT EXISTS idx_ng_diagnoses_patient ON ng_diagnoses (patient_id, status);
CREATE INDEX IF NOT EXISTS idx_ng_diagnoses_icd10
  ON ng_diagnoses (icd10_code) WHERE icd10_code IS NOT NULL;

CREATE TABLE IF NOT EXISTS ng_medication_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  encounter_id UUID REFERENCES ng_clinical_encounters(id) ON DELETE SET NULL,
  prescription_id UUID REFERENCES ng_prescriptions(id) ON DELETE SET NULL,
  drug_id UUID REFERENCES ng_drug_catalog(id) ON DELETE SET NULL,
  drug_name TEXT NOT NULL,
  dosage TEXT,
  frequency TEXT,
  route TEXT DEFAULT 'oral',
  start_date DATE,
  end_date DATE,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'discontinued', 'completed', 'on_hold', 'never_taken')),
  reason_for_use TEXT,
  discontinued_reason TEXT,
  recorded_by UUID REFERENCES users(id) ON DELETE SET NULL,
  source TEXT NOT NULL DEFAULT 'prescription'
    CHECK (source IN ('prescription', 'self_reported', 'transfer', 'inpatient', 'historical')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ng_med_history_patient
  ON ng_medication_history (patient_id, status);
CREATE INDEX IF NOT EXISTS idx_ng_med_history_encounter
  ON ng_medication_history (encounter_id) WHERE encounter_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ng_med_history_drug
  ON ng_medication_history (drug_id) WHERE drug_id IS NOT NULL;

-- Base clinical referral table (distinct from drn_referrals marketplace table)
CREATE TABLE IF NOT EXISTS ng_referrals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  encounter_id UUID REFERENCES ng_clinical_encounters(id) ON DELETE SET NULL,
  patient_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  referring_provider_id UUID REFERENCES users(id) ON DELETE SET NULL,
  receiving_provider_id UUID REFERENCES users(id) ON DELETE SET NULL,
  referring_facility_id UUID REFERENCES public_health_facilities(id) ON DELETE SET NULL,
  receiving_facility_id UUID REFERENCES public_health_facilities(id) ON DELETE SET NULL,
  referral_type TEXT NOT NULL DEFAULT 'specialist'
    CHECK (referral_type IN (
      'specialist', 'laboratory', 'pharmacy', 'physiotherapy',
      'mental_health', 'emergency', 'surgery', 'radiology', 'nutrition', 'other'
    )),
  urgency TEXT NOT NULL DEFAULT 'routine'
    CHECK (urgency IN ('routine', 'urgent', 'emergency')),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'sent', 'accepted', 'declined', 'completed', 'cancelled')),
  reason TEXT NOT NULL,
  clinical_notes TEXT,
  diagnosis_summary TEXT,
  referral_code TEXT UNIQUE DEFAULT LEFT(gen_random_uuid()::TEXT, 8),
  drn_referral_id UUID,
  accepted_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  metadata_json JSONB DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ng_referrals_patient ON ng_referrals (patient_id, status);
CREATE INDEX IF NOT EXISTS idx_ng_referrals_referring_provider
  ON ng_referrals (referring_provider_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ng_referrals_status ON ng_referrals (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ng_referrals_encounter
  ON ng_referrals (encounter_id) WHERE encounter_id IS NOT NULL;
