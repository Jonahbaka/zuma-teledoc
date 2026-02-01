-- ============================================================================
-- Interoperability & Analytics Extension Schema
-- Enterprise Healthcare Integration Layer
-- ============================================================================

-- ============================================================================
-- SECTION 1: FHIR BRIDGE & CONSENT MANAGEMENT
-- ============================================================================

-- Patient Consents for Data Sharing (SMART on FHIR compliant)
CREATE TABLE IF NOT EXISTS patient_consents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  organization_id VARCHAR(255) NOT NULL,
  organization_name VARCHAR(500) NOT NULL,
  purpose VARCHAR(50) NOT NULL CHECK (purpose IN ('referral', 'treatment', 'payment', 'operations', 'research', 'all')),
  scope VARCHAR(100), -- SMART on FHIR scope string
  data_categories JSONB NOT NULL DEFAULT '[]', -- ['demographics', 'diagnoses', 'medications', etc.]
  valid_from TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  valid_until TIMESTAMPTZ,
  granted_by UUID NOT NULL REFERENCES users(id), -- patient or guardian
  status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'revoked', 'expired', 'pending')),
  revoked_at TIMESTAMPTZ,
  revoke_reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Consent Audit Log
CREATE TABLE IF NOT EXISTS consent_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  consent_id UUID REFERENCES patient_consents(id),
  patient_id UUID NOT NULL REFERENCES users(id),
  action VARCHAR(50) NOT NULL, -- 'granted', 'revoked', 'accessed', 'modified'
  details JSONB,
  ip_address INET,
  user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Connected Organizations (hospitals, clinics, labs)
CREATE TABLE IF NOT EXISTS connected_organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(500) NOT NULL,
  type VARCHAR(50) NOT NULL CHECK (type IN ('hospital', 'clinic', 'lab', 'pharmacy', 'insurance', 'other')),
  fhir_endpoint VARCHAR(500),
  fhir_version VARCHAR(10) DEFAULT 'R4',
  ehr_system VARCHAR(100), -- 'epic', 'cerner', 'allscripts', 'meditech', 'other'
  -- OAuth/SMART credentials (encrypted)
  client_id_encrypted TEXT,
  client_secret_encrypted TEXT,
  token_endpoint VARCHAR(500),
  authorize_endpoint VARCHAR(500),
  scopes TEXT[],
  -- Status
  status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('active', 'pending', 'suspended', 'revoked')),
  last_sync_at TIMESTAMPTZ,
  -- Contact info
  contact_name VARCHAR(255),
  contact_email VARCHAR(255),
  contact_phone VARCHAR(50),
  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Referral Audit Log
CREATE TABLE IF NOT EXISTS referral_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bundle_id VARCHAR(255) NOT NULL,
  patient_id UUID NOT NULL REFERENCES users(id),
  destination_org VARCHAR(500),
  specialty VARCHAR(100),
  status VARCHAR(50) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Referral Dispatch Log
CREATE TABLE IF NOT EXISTS referral_dispatch_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bundle_id VARCHAR(255) NOT NULL,
  endpoint_url VARCHAR(500),
  status VARCHAR(50) NOT NULL,
  response_data JSONB,
  dispatched_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================================
-- SECTION 2: ANALYTICS WAREHOUSE TABLES (De-identified)
-- ============================================================================

-- Analytics: Encounter Aggregates (PHI-stripped)
CREATE TABLE IF NOT EXISTS analytics_encounters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  encounter_hash VARCHAR(64) UNIQUE NOT NULL, -- SHA256 of original encounter ID
  encounter_date DATE NOT NULL,
  visit_type VARCHAR(50),
  specialty VARCHAR(100),
  duration_minutes DECIMAL(10,2),
  chief_complaint_category VARCHAR(50),
  outcome_status VARCHAR(50),
  provider_specialty VARCHAR(100),
  age_bracket VARCHAR(20),
  gender VARCHAR(20),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Analytics: Treatment Aggregates
CREATE TABLE IF NOT EXISTS analytics_treatments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  treatment_hash VARCHAR(64) UNIQUE NOT NULL,
  treatment_date DATE NOT NULL,
  medication_class VARCHAR(100),
  rxnorm_code VARCHAR(20),
  diagnosis_category VARCHAR(100),
  icd10_code VARCHAR(20),
  patient_age_bracket VARCHAR(20),
  patient_gender VARCHAR(20),
  treatment_duration_days INTEGER,
  refills_allowed INTEGER,
  provider_specialty VARCHAR(100),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Analytics: Outcome Success Metrics (The "Bird's Eye View")
-- Correlates ICD-10 diagnoses with RxNorm medications and recovery outcomes
CREATE TABLE IF NOT EXISTS analytics_outcome_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  condition_code VARCHAR(20) NOT NULL, -- ICD-10 category or diagnosis group
  medication_class VARCHAR(100) NOT NULL, -- RxNorm therapeutic class
  treatment_plan_id VARCHAR(100),
  sample_size INTEGER NOT NULL,
  avg_recovery_days DECIMAL(10,2),
  success_rate DECIMAL(5,2), -- Percentage 0-100
  readmission_rate DECIMAL(5,2), -- Percentage 0-100
  adherence_score_avg DECIMAL(5,2), -- 0-100
  outcome_delta_avg DECIMAL(10,2), -- Change in key metrics (e.g., HbA1c drop)
  calculated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(condition_code, medication_class)
);

-- Analytics: Provider Performance Index
-- For insurance companies and quality reporting
CREATE TABLE IF NOT EXISTS analytics_provider_performance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_hash VARCHAR(64) UNIQUE NOT NULL, -- SHA256 of provider ID
  specialty VARCHAR(100),
  total_encounters INTEGER DEFAULT 0,
  completed_encounters INTEGER DEFAULT 0,
  avg_encounter_duration DECIMAL(10,2),
  patient_satisfaction_avg DECIMAL(3,2), -- 1-5 scale
  efficiency_score DECIMAL(5,2), -- Composite score
  cost_per_episode_avg DECIMAL(12,2),
  calculated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Analytics: Population Health Overview
CREATE TABLE IF NOT EXISTS analytics_population_health (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  age_bracket VARCHAR(20) NOT NULL,
  gender VARCHAR(20) NOT NULL,
  condition_category VARCHAR(100) NOT NULL,
  patient_count INTEGER NOT NULL,
  avg_encounters_per_patient DECIMAL(5,2),
  avg_medications_per_patient DECIMAL(5,2),
  chronic_condition_rate DECIMAL(5,2),
  calculated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(age_bracket, gender, condition_category)
);

-- ETL Run Log (for monitoring)
CREATE TABLE IF NOT EXISTS etl_run_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  status VARCHAR(20) NOT NULL,
  records_processed INTEGER DEFAULT 0,
  duration_ms INTEGER,
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================================
-- SECTION 3: SQL VIEWS FOR EASY QUERYING
-- ============================================================================

-- View: Treatment Efficacy Metrics
-- Goal: Shows which treatments work best for specific conditions
CREATE OR REPLACE VIEW v_treatment_efficacy AS
SELECT 
  om.condition_code,
  om.medication_class,
  om.treatment_plan_id,
  om.sample_size,
  om.avg_recovery_days,
  om.success_rate,
  om.readmission_rate,
  om.adherence_score_avg,
  om.outcome_delta_avg,
  om.calculated_at,
  -- Risk categorization
  CASE 
    WHEN om.readmission_rate > 15 THEN 'high_risk'
    WHEN om.readmission_rate > 10 THEN 'moderate_risk'
    ELSE 'low_risk'
  END as risk_category,
  -- Treatment recommendation score
  (om.success_rate * 0.4 + (100 - om.readmission_rate) * 0.3 + om.adherence_score_avg * 0.3) as recommendation_score
FROM analytics_outcome_metrics om
WHERE om.sample_size >= 5;

-- View: Provider Performance Index
-- Goal: For insurance companies and quality reporting
CREATE OR REPLACE VIEW v_provider_performance AS
SELECT 
  pp.provider_hash,
  pp.specialty,
  pp.total_encounters,
  pp.completed_encounters,
  ROUND((pp.completed_encounters::numeric / NULLIF(pp.total_encounters, 0) * 100), 2) as completion_rate,
  pp.avg_encounter_duration,
  pp.patient_satisfaction_avg,
  pp.efficiency_score,
  pp.cost_per_episode_avg,
  pp.calculated_at,
  -- Performance tier
  CASE 
    WHEN pp.efficiency_score >= 90 AND pp.patient_satisfaction_avg >= 4.5 THEN 'tier_1_excellent'
    WHEN pp.efficiency_score >= 75 AND pp.patient_satisfaction_avg >= 4.0 THEN 'tier_2_good'
    WHEN pp.efficiency_score >= 60 AND pp.patient_satisfaction_avg >= 3.5 THEN 'tier_3_acceptable'
    ELSE 'tier_4_needs_improvement'
  END as performance_tier
FROM analytics_provider_performance pp;

-- View: Population Health Dashboard
CREATE OR REPLACE VIEW v_population_health_dashboard AS
SELECT 
  ph.age_bracket,
  ph.gender,
  ph.condition_category,
  ph.patient_count,
  ph.avg_encounters_per_patient,
  ph.avg_medications_per_patient,
  ph.chronic_condition_rate,
  ph.calculated_at,
  -- Population segment
  CASE 
    WHEN ph.age_bracket = 'pediatric' THEN 'pediatric_population'
    WHEN ph.age_bracket = '65+' THEN 'senior_population'
    WHEN ph.chronic_condition_rate > 30 THEN 'high_risk_chronic'
    ELSE 'general_population'
  END as population_segment
FROM analytics_population_health ph;

-- ============================================================================
-- SECTION 4: INDEXES
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_patient_consents_patient ON patient_consents(patient_id);
CREATE INDEX IF NOT EXISTS idx_patient_consents_org ON patient_consents(organization_id);
CREATE INDEX IF NOT EXISTS idx_patient_consents_status ON patient_consents(status) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_consent_audit_consent ON consent_audit_log(consent_id);
CREATE INDEX IF NOT EXISTS idx_consent_audit_patient ON consent_audit_log(patient_id);

CREATE INDEX IF NOT EXISTS idx_analytics_encounters_date ON analytics_encounters(encounter_date);
CREATE INDEX IF NOT EXISTS idx_analytics_encounters_specialty ON analytics_encounters(specialty);
CREATE INDEX IF NOT EXISTS idx_analytics_encounters_outcome ON analytics_encounters(outcome_status);

CREATE INDEX IF NOT EXISTS idx_analytics_treatments_date ON analytics_treatments(treatment_date);
CREATE INDEX IF NOT EXISTS idx_analytics_treatments_medication ON analytics_treatments(medication_class);
CREATE INDEX IF NOT EXISTS idx_analytics_treatments_diagnosis ON analytics_treatments(diagnosis_category);

CREATE INDEX IF NOT EXISTS idx_analytics_outcomes_condition ON analytics_outcome_metrics(condition_code);
CREATE INDEX IF NOT EXISTS idx_analytics_outcomes_medication ON analytics_outcome_metrics(medication_class);

CREATE INDEX IF NOT EXISTS idx_referral_audit_patient ON referral_audit_log(patient_id);
CREATE INDEX IF NOT EXISTS idx_referral_audit_bundle ON referral_audit_log(bundle_id);

-- ============================================================================
-- SECTION 5: HELPER FUNCTIONS
-- ============================================================================

-- Function to anonymize a patient ID
CREATE OR REPLACE FUNCTION anonymize_patient_id(patient_id UUID)
RETURNS VARCHAR(64) AS $$
BEGIN
  RETURN encode(sha256(patient_id::text::bytea), 'hex');
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Function to get age bracket from date of birth
CREATE OR REPLACE FUNCTION get_age_bracket(dob DATE)
RETURNS VARCHAR(20) AS $$
DECLARE
  age INTEGER;
BEGIN
  age := EXTRACT(YEAR FROM AGE(NOW(), dob));
  RETURN CASE 
    WHEN age < 18 THEN 'pediatric'
    WHEN age BETWEEN 18 AND 35 THEN '18-35'
    WHEN age BETWEEN 36 AND 50 THEN '36-50'
    WHEN age BETWEEN 51 AND 65 THEN '51-65'
    ELSE '65+'
  END;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- ============================================================================
-- SECTION 6: GRANTS FOR API ACCESS
-- ============================================================================

-- Create analytics read-only role (for external systems)
-- DO $$
-- BEGIN
--   IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'analytics_reader') THEN
--     CREATE ROLE analytics_reader WITH LOGIN PASSWORD 'your-secure-password';
--   END IF;
-- END
-- $$;

-- Grant read access to analytics views
-- GRANT SELECT ON v_treatment_efficacy TO analytics_reader;
-- GRANT SELECT ON v_provider_performance TO analytics_reader;
-- GRANT SELECT ON v_population_health_dashboard TO analytics_reader;
