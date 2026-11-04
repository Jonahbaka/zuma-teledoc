-- ============================================================================
-- Predictive Intelligence Engine Schema
-- AI-First Predictive Data Platform for Enterprise Healthcare
-- ============================================================================

-- ============================================================================
-- SECTION 1: FEATURE STORE
-- Real-time and batch feature storage for ML models
-- ============================================================================

-- Feature definitions registry
CREATE TABLE IF NOT EXISTS ml_feature_definitions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  feature_name VARCHAR(255) NOT NULL UNIQUE,
  feature_group VARCHAR(100) NOT NULL, -- 'patient', 'clinical', 'claims', 'operational', 'social_determinants'
  data_type VARCHAR(50) NOT NULL, -- 'numeric', 'categorical', 'boolean', 'array', 'embedding'
  description TEXT,
  computation_sql TEXT, -- SQL for batch computation
  computation_window VARCHAR(50), -- '24h', '7d', '30d', '90d', '1y'
  is_real_time BOOLEAN DEFAULT false,
  is_phi BOOLEAN DEFAULT false, -- If true, requires de-identification
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Patient feature vectors (batch-computed)
CREATE TABLE IF NOT EXISTS ml_patient_features (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_hash VARCHAR(64) NOT NULL, -- SHA256 of patient_id (de-identified)
  feature_name VARCHAR(255) NOT NULL REFERENCES ml_feature_definitions(feature_name),
  feature_value DOUBLE PRECISION,
  feature_category VARCHAR(255), -- For categorical features
  feature_array JSONB, -- For array/embedding features
  computed_at TIMESTAMPTZ DEFAULT NOW(),
  valid_until TIMESTAMPTZ, -- Feature expiry (for time-sensitive features)
  source VARCHAR(100), -- 'encounter', 'claim', 'lab', 'vitals', 'rx', 'external'
  UNIQUE(patient_hash, feature_name)
);

-- Real-time feature events (streaming)
CREATE TABLE IF NOT EXISTS ml_feature_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_hash VARCHAR(64) NOT NULL,
  event_type VARCHAR(100) NOT NULL, -- 'vital_recorded', 'lab_result', 'medication_change', 'encounter_start'
  event_data JSONB NOT NULL,
  features_computed JSONB, -- Pre-computed features from this event
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create hypertable-like partitioning for events (time-series optimization)
CREATE INDEX IF NOT EXISTS idx_feature_events_time ON ml_feature_events (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_feature_events_patient ON ml_feature_events (patient_hash, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_patient_features_lookup ON ml_patient_features (patient_hash, feature_name);

-- ============================================================================
-- SECTION 2: MODEL REGISTRY
-- Version control for ML models with A/B testing support
-- ============================================================================

-- Model definitions
CREATE TABLE IF NOT EXISTS ml_models (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  model_name VARCHAR(255) NOT NULL,
  model_version VARCHAR(50) NOT NULL,
  model_type VARCHAR(100) NOT NULL, -- 'readmission_risk', 'claims_denial', 'sepsis_warning', etc.
  algorithm VARCHAR(100) NOT NULL, -- 'xgboost', 'random_forest', 'neural_network', 'logistic_regression', 'ensemble'
  description TEXT,
  
  -- Model artifacts
  model_weights JSONB, -- Serialized model parameters/weights
  feature_names JSONB NOT NULL, -- Ordered list of features this model expects
  feature_importance JSONB, -- Feature importance scores
  hyperparameters JSONB, -- Model hyperparameters
  preprocessing_config JSONB, -- Feature scaling, encoding configs
  
  -- Performance metrics
  training_metrics JSONB, -- accuracy, precision, recall, F1, AUC-ROC
  validation_metrics JSONB,
  test_metrics JSONB,
  
  -- Lifecycle
  status VARCHAR(20) DEFAULT 'staging' CHECK (status IN ('training', 'staging', 'production', 'shadow', 'deprecated', 'archived')),
  is_champion BOOLEAN DEFAULT false, -- Current production model for this type
  champion_since TIMESTAMPTZ,
  
  -- A/B testing
  traffic_percentage DECIMAL(5,2) DEFAULT 0, -- % of traffic for shadow/canary
  ab_test_id VARCHAR(100),
  
  -- Audit
  trained_by VARCHAR(255),
  training_data_start TIMESTAMPTZ,
  training_data_end TIMESTAMPTZ,
  training_samples INTEGER,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(model_name, model_version)
);

CREATE INDEX IF NOT EXISTS idx_models_type_status ON ml_models (model_type, status);
CREATE INDEX IF NOT EXISTS idx_models_champion ON ml_models (model_type, is_champion) WHERE is_champion = true;

-- ============================================================================
-- SECTION 3: PREDICTIONS
-- Stores all predictions with full audit trail
-- ============================================================================

-- Prediction log
CREATE TABLE IF NOT EXISTS ml_predictions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  model_id UUID NOT NULL REFERENCES ml_models(id),
  model_name VARCHAR(255) NOT NULL,
  model_version VARCHAR(50) NOT NULL,
  
  -- Subject
  patient_hash VARCHAR(64), -- De-identified patient
  entity_type VARCHAR(50), -- 'patient', 'claim', 'encounter', 'appointment'
  entity_id VARCHAR(255), -- Reference to the entity
  
  -- Prediction
  prediction_type VARCHAR(100) NOT NULL, -- 'readmission_risk', 'claims_denial', etc.
  risk_score DECIMAL(5,4), -- 0.0000 to 1.0000
  risk_level VARCHAR(20), -- 'critical', 'high', 'moderate', 'low', 'minimal'
  prediction_label VARCHAR(255), -- Human-readable prediction
  confidence DECIMAL(5,4), -- Model confidence
  
  -- Explanation
  feature_contributions JSONB, -- SHAP values per feature
  explanation_text TEXT, -- Human-readable explanation
  top_risk_factors JSONB, -- Top N contributing factors
  
  -- Recommendations
  recommended_actions JSONB, -- Suggested interventions
  recommended_tests JSONB, -- Suggested diagnostic tests
  care_pathway JSONB, -- Recommended care pathway
  
  -- Outcome tracking (filled in later)
  actual_outcome VARCHAR(100),
  outcome_date TIMESTAMPTZ,
  prediction_correct BOOLEAN,
  
  -- Context
  triggered_by VARCHAR(100), -- 'real_time', 'batch', 'manual', 'scheduled'
  request_context JSONB, -- Additional context
  
  -- Timing
  inference_time_ms INTEGER, -- How long prediction took
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_predictions_patient ON ml_predictions (patient_hash, prediction_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_predictions_type ON ml_predictions (prediction_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_predictions_risk ON ml_predictions (prediction_type, risk_level, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_predictions_outcome ON ml_predictions (prediction_type, prediction_correct) WHERE actual_outcome IS NOT NULL;

-- ============================================================================
-- SECTION 4: ALERTS & ACTIONS
-- Clinical decision support alerts triggered by predictions
-- ============================================================================

CREATE TABLE IF NOT EXISTS ml_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prediction_id UUID REFERENCES ml_predictions(id),
  
  -- Alert details
  alert_type VARCHAR(100) NOT NULL, -- 'clinical', 'operational', 'financial', 'quality'
  severity VARCHAR(20) NOT NULL CHECK (severity IN ('critical', 'high', 'medium', 'low', 'info')),
  title VARCHAR(500) NOT NULL,
  message TEXT NOT NULL,
  
  -- Routing
  target_role VARCHAR(50), -- 'provider', 'nurse', 'admin', 'care_coordinator', 'billing'
  target_user_id UUID,
  department VARCHAR(100),
  
  -- Status
  status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'acknowledged', 'acted_upon', 'dismissed', 'expired', 'auto_resolved')),
  acknowledged_by UUID,
  acknowledged_at TIMESTAMPTZ,
  action_taken TEXT,
  action_taken_at TIMESTAMPTZ,
  
  -- Auto-expiry
  expires_at TIMESTAMPTZ,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_alerts_active ON ml_alerts (status, severity, created_at DESC) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_alerts_user ON ml_alerts (target_user_id, status, created_at DESC);

-- ============================================================================
-- SECTION 5: TRAINING DATA & PIPELINES
-- Manage training datasets and pipeline execution
-- ============================================================================

-- Training datasets
CREATE TABLE IF NOT EXISTS ml_training_datasets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dataset_name VARCHAR(255) NOT NULL,
  model_type VARCHAR(100) NOT NULL,
  description TEXT,
  
  -- Data specs
  record_count INTEGER,
  feature_count INTEGER,
  label_distribution JSONB, -- Class balance info
  date_range_start TIMESTAMPTZ,
  date_range_end TIMESTAMPTZ,
  
  -- Quality
  missing_data_report JSONB,
  outlier_report JSONB,
  bias_assessment JSONB, -- Fairness metrics by demographic
  
  -- Status
  status VARCHAR(20) DEFAULT 'building' CHECK (status IN ('building', 'ready', 'in_use', 'archived')),
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Pipeline execution log
CREATE TABLE IF NOT EXISTS ml_pipeline_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pipeline_type VARCHAR(100) NOT NULL, -- 'feature_engineering', 'training', 'evaluation', 'deployment'
  model_type VARCHAR(100),
  model_id UUID REFERENCES ml_models(id),
  
  -- Execution
  status VARCHAR(20) DEFAULT 'running' CHECK (status IN ('running', 'completed', 'failed', 'cancelled')),
  started_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  duration_seconds INTEGER,
  
  -- Results
  metrics JSONB,
  logs TEXT,
  error_message TEXT,
  
  -- Context
  triggered_by VARCHAR(255),
  parameters JSONB
);

-- ============================================================================
-- SECTION 6: ENTERPRISE TENANT MANAGEMENT
-- Multi-tenant support for hospitals and insurance companies
-- ============================================================================

CREATE TABLE IF NOT EXISTS ml_enterprise_tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID, -- External organization reference
  
  -- Organization info
  name VARCHAR(500) NOT NULL,
  type VARCHAR(50) NOT NULL CHECK (type IN ('hospital', 'health_system', 'insurance', 'employer', 'government')),
  tier VARCHAR(20) DEFAULT 'standard' CHECK (tier IN ('standard', 'professional', 'enterprise')),
  
  -- API access
  api_key_hash VARCHAR(64) NOT NULL, -- SHA256 of API key
  api_key_prefix VARCHAR(8) NOT NULL, -- First 8 chars for identification
  rate_limit_per_minute INTEGER DEFAULT 100,
  
  -- Data access
  allowed_models JSONB DEFAULT '["readmission_risk", "claims_denial", "no_show"]',
  allowed_endpoints JSONB DEFAULT '["predict", "batch_predict"]',
  data_retention_days INTEGER DEFAULT 365,
  
  -- Usage tracking
  total_predictions INTEGER DEFAULT 0,
  total_api_calls INTEGER DEFAULT 0,
  last_api_call_at TIMESTAMPTZ,
  
  -- Billing
  billing_model VARCHAR(50) DEFAULT 'per_prediction', -- 'per_prediction', 'monthly', 'annual'
  price_per_prediction DECIMAL(10,4),
  monthly_prediction_cap INTEGER,
  
  -- Status
  status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'trial', 'suspended', 'cancelled')),
  trial_ends_at TIMESTAMPTZ,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tenants_api_key ON ml_enterprise_tenants (api_key_prefix, status);

-- Enterprise API usage log
CREATE TABLE IF NOT EXISTS ml_api_usage_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES ml_enterprise_tenants(id),
  
  endpoint VARCHAR(255) NOT NULL,
  method VARCHAR(10) NOT NULL,
  model_type VARCHAR(100),
  prediction_count INTEGER DEFAULT 1,
  
  -- Performance
  response_time_ms INTEGER,
  status_code INTEGER,
  
  -- Context
  ip_address INET,
  user_agent TEXT,
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_api_usage_tenant ON ml_api_usage_log (tenant_id, created_at DESC);

-- ============================================================================
-- SECTION 7: MODEL PERFORMANCE MONITORING
-- Drift detection and performance tracking
-- ============================================================================

CREATE TABLE IF NOT EXISTS ml_model_performance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  model_id UUID NOT NULL REFERENCES ml_models(id),
  model_type VARCHAR(100) NOT NULL,
  
  -- Performance snapshot
  evaluation_date DATE NOT NULL,
  sample_count INTEGER,
  
  -- Classification metrics
  accuracy DECIMAL(5,4),
  precision_score DECIMAL(5,4),
  recall_score DECIMAL(5,4),
  f1_score DECIMAL(5,4),
  auc_roc DECIMAL(5,4),
  auc_pr DECIMAL(5,4),
  
  -- Calibration
  brier_score DECIMAL(5,4),
  calibration_slope DECIMAL(8,4),
  
  -- Fairness metrics
  demographic_parity JSONB,
  equalized_odds JSONB,
  
  -- Drift detection
  feature_drift_score DECIMAL(5,4), -- KL divergence or PSI
  prediction_drift_score DECIMAL(5,4),
  drift_alert BOOLEAN DEFAULT false,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(model_id, evaluation_date)
);

CREATE INDEX IF NOT EXISTS idx_model_perf ON ml_model_performance (model_type, evaluation_date DESC);

-- ============================================================================
-- SECTION 8: MATERIALIZED VIEWS FOR FAST DASHBOARDS
-- ============================================================================

-- Current risk overview for all patients
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_patient_risk_overview AS
SELECT 
  p.patient_hash,
  MAX(CASE WHEN p.prediction_type = 'readmission_risk' THEN p.risk_score END) as readmission_risk,
  MAX(CASE WHEN p.prediction_type = 'readmission_risk' THEN p.risk_level END) as readmission_level,
  MAX(CASE WHEN p.prediction_type = 'sepsis_warning' THEN p.risk_score END) as sepsis_risk,
  MAX(CASE WHEN p.prediction_type = 'sepsis_warning' THEN p.risk_level END) as sepsis_level,
  MAX(CASE WHEN p.prediction_type = 'no_show' THEN p.risk_score END) as no_show_risk,
  MAX(CASE WHEN p.prediction_type = 'disease_progression' THEN p.risk_score END) as progression_risk,
  MAX(CASE WHEN p.prediction_type = 'cost_forecast' THEN p.risk_score END) as cost_risk,
  MAX(p.created_at) as last_prediction_at
FROM ml_predictions p
WHERE p.created_at > NOW() - INTERVAL '7 days'
GROUP BY p.patient_hash;

-- Model performance summary
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_model_performance_summary AS
SELECT 
  m.model_type,
  m.model_name,
  m.model_version,
  m.status,
  m.is_champion,
  mp.accuracy,
  mp.auc_roc,
  mp.f1_score,
  mp.drift_alert,
  mp.evaluation_date,
  COUNT(p.id) as total_predictions,
  AVG(p.inference_time_ms) as avg_inference_ms,
  SUM(CASE WHEN p.prediction_correct = true THEN 1 ELSE 0 END)::DECIMAL / 
    NULLIF(SUM(CASE WHEN p.prediction_correct IS NOT NULL THEN 1 ELSE 0 END), 0) as live_accuracy
FROM ml_models m
LEFT JOIN ml_model_performance mp ON m.id = mp.model_id 
  AND mp.evaluation_date = (SELECT MAX(evaluation_date) FROM ml_model_performance WHERE model_id = m.id)
LEFT JOIN ml_predictions p ON m.id = p.model_id AND p.created_at > NOW() - INTERVAL '30 days'
GROUP BY m.model_type, m.model_name, m.model_version, m.status, m.is_champion, 
         mp.accuracy, mp.auc_roc, mp.f1_score, mp.drift_alert, mp.evaluation_date;

-- ============================================================================
-- SECTION 9: HELPER FUNCTIONS
-- ============================================================================

-- Function to compute risk level from score
CREATE OR REPLACE FUNCTION compute_risk_level(score DECIMAL)
RETURNS VARCHAR(20) AS $$
BEGIN
  IF score >= 0.85 THEN RETURN 'critical';
  ELSIF score >= 0.65 THEN RETURN 'high';
  ELSIF score >= 0.40 THEN RETURN 'moderate';
  ELSIF score >= 0.20 THEN RETURN 'low';
  ELSE RETURN 'minimal';
  END IF;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Function to refresh materialized views
CREATE OR REPLACE FUNCTION refresh_predictive_views()
RETURNS void AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_patient_risk_overview;
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_model_performance_summary;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- GRANTS & POLICIES (Row-Level Security for multi-tenant)
-- ============================================================================

-- Enable RLS on tenant-sensitive tables
ALTER TABLE ml_api_usage_log ENABLE ROW LEVEL SECURITY;

-- Tenants can only see their own usage
CREATE POLICY tenant_usage_policy ON ml_api_usage_log
  FOR ALL
  USING (tenant_id = current_setting('app.current_tenant_id', true)::UUID);
