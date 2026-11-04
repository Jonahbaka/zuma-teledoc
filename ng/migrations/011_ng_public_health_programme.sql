CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public_health_programmes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'planning' CHECK (status IN ('planning', 'active', 'paused', 'archived')),
  market TEXT NOT NULL DEFAULT 'NG',
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_public_health_programmes_market_name
  ON public_health_programmes (market, name);

CREATE TABLE IF NOT EXISTS public_health_facilities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  facility_type TEXT NOT NULL DEFAULT 'facility',
  ownership_type TEXT DEFAULT 'public',
  lga TEXT,
  ward TEXT,
  city TEXT,
  state TEXT DEFAULT 'FCT',
  address TEXT,
  latitude NUMERIC(10, 7),
  longitude NUMERIC(10, 7),
  dhis2_org_unit_id TEXT,
  active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_public_health_facilities_lga ON public_health_facilities (LOWER(COALESCE(lga, '')));
CREATE INDEX IF NOT EXISTS idx_public_health_facilities_type ON public_health_facilities (facility_type, active);

CREATE TABLE IF NOT EXISTS public_health_indicators (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  programme_area TEXT NOT NULL,
  internal_key TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  description TEXT,
  aggregation_type TEXT NOT NULL DEFAULT 'count' CHECK (aggregation_type IN ('count', 'sum', 'average', 'rate', 'percentage')),
  dhis2_data_element_id TEXT,
  dhis2_category_option_combo_id TEXT,
  active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_public_health_indicators_area ON public_health_indicators (programme_area, active);

CREATE TABLE IF NOT EXISTS public_health_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_period TEXT NOT NULL,
  report_type TEXT NOT NULL DEFAULT 'monthly_aggregate',
  facility_id UUID REFERENCES public_health_facilities(id) ON DELETE SET NULL,
  lga TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'generated', 'approved', 'exported', 'sync_pending', 'synced', 'sync_failed')),
  generated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  approved_by UUID REFERENCES users(id) ON DELETE SET NULL,
  approved_at TIMESTAMPTZ,
  exported_at TIMESTAMPTZ,
  notes TEXT,
  metadata_json JSONB DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_public_health_reports_period ON public_health_reports (report_period, status);
CREATE INDEX IF NOT EXISTS idx_public_health_reports_facility ON public_health_reports (facility_id);

CREATE TABLE IF NOT EXISTS public_health_report_values (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id UUID NOT NULL REFERENCES public_health_reports(id) ON DELETE CASCADE,
  indicator_id UUID NOT NULL REFERENCES public_health_indicators(id) ON DELETE CASCADE,
  value NUMERIC,
  metadata_json JSONB DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (report_id, indicator_id)
);

CREATE INDEX IF NOT EXISTS idx_public_health_report_values_report ON public_health_report_values (report_id);

CREATE TABLE IF NOT EXISTS dhis2_integration_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  environment TEXT NOT NULL DEFAULT 'disabled' CHECK (environment IN ('disabled', 'sandbox', 'production')),
  base_url_encrypted TEXT,
  base_url_iv TEXT,
  base_url_tag TEXT,
  username_encrypted TEXT,
  username_iv TEXT,
  username_tag TEXT,
  api_token_encrypted TEXT,
  api_token_iv TEXT,
  api_token_tag TEXT,
  dataset_id TEXT,
  org_unit_id TEXT,
  attribute_option_combo_id TEXT,
  enabled BOOLEAN DEFAULT FALSE,
  dry_run_only BOOLEAN DEFAULT TRUE,
  government_approval_status TEXT NOT NULL DEFAULT 'pending' CHECK (government_approval_status IN ('pending', 'approved', 'rejected')),
  api_credentials_status TEXT NOT NULL DEFAULT 'pending' CHECK (api_credentials_status IN ('pending', 'configured', 'rejected')),
  data_sharing_agreement_status TEXT NOT NULL DEFAULT 'pending' CHECK (data_sharing_agreement_status IN ('pending', 'approved', 'rejected')),
  ndpr_review_status TEXT NOT NULL DEFAULT 'pending' CHECK (ndpr_review_status IN ('pending', 'approved', 'rejected')),
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS dhis2_sync_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id UUID REFERENCES public_health_reports(id) ON DELETE SET NULL,
  status TEXT NOT NULL,
  request_payload_hash TEXT,
  response_status TEXT,
  response_body_summary TEXT,
  error_message TEXT,
  attempted_by UUID REFERENCES users(id) ON DELETE SET NULL,
  attempted_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dhis2_sync_logs_report ON dhis2_sync_logs (report_id, attempted_at DESC);

CREATE TABLE IF NOT EXISTS public_health_forecasts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  forecast_type TEXT NOT NULL DEFAULT 'operational_demand',
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  forecast_range_days INTEGER NOT NULL CHECK (forecast_range_days IN (7, 14, 30)),
  metric_key TEXT NOT NULL,
  predicted_value NUMERIC NOT NULL DEFAULT 0,
  confidence_label TEXT NOT NULL DEFAULT 'insufficient_data' CHECK (confidence_label IN ('insufficient_data', 'low', 'medium', 'high')),
  method TEXT NOT NULL,
  metadata_json JSONB DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_public_health_forecasts_metric ON public_health_forecasts (metric_key, forecast_range_days, created_at DESC);

CREATE TABLE IF NOT EXISTS public_health_insights (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  insight_type TEXT NOT NULL DEFAULT 'planning',
  severity TEXT NOT NULL DEFAULT 'info' CHECK (severity IN ('info', 'warning', 'critical')),
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  metric_key TEXT,
  related_facility_id UUID REFERENCES public_health_facilities(id) ON DELETE SET NULL,
  related_lga TEXT,
  period TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_public_health_insights_period ON public_health_insights (period, severity, created_at DESC);

CREATE TABLE IF NOT EXISTS public_health_audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  resource_type TEXT,
  resource_id UUID,
  metadata_json JSONB DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_public_health_audit_actor ON public_health_audit_logs (actor_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_public_health_audit_resource ON public_health_audit_logs (resource_type, resource_id, created_at DESC);

INSERT INTO public_health_programmes (name, description, status, market)
VALUES (
  'DoctaRx Nigeria Public Health Intelligence Programme',
  'Integration-ready care-delivery visibility, aggregate reporting, forecasting, and DHIS2/NHMIS readiness for Nigeria public-health stakeholders.',
  'planning',
  'NG'
)
ON CONFLICT (market, name) DO NOTHING;

INSERT INTO public_health_indicators (programme_area, internal_key, display_name, description, aggregation_type)
VALUES
  ('patient_access', 'total_consultations', 'Total consultations', 'All Nigeria-market consultations captured by DoctaRx.', 'count'),
  ('teleconsultation', 'teleconsultations', 'Teleconsultations', 'Consultations delivered or booked as video/audio telehealth.', 'count'),
  ('teleconsultation', 'completed_consultations', 'Completed consultations', 'Consultations marked completed.', 'count'),
  ('teleconsultation', 'cancelled_consultations', 'Cancelled consultations', 'Consultations cancelled before completion.', 'count'),
  ('teleconsultation', 'failed_video_sessions', 'Failed video sessions', 'Video sessions that failed or were cancelled before completion where captured.', 'count'),
  ('teleconsultation', 'audio_fallback_sessions', 'Audio fallback sessions', 'Consultations marked phone/audio or fallback where captured.', 'count'),
  ('patient_access', 'active_patients', 'Active patients', 'Active Nigeria patient accounts.', 'count'),
  ('patient_access', 'new_patient_registrations', 'New patient registrations', 'Nigeria patient accounts created in the reporting period.', 'count'),
  ('patient_access', 'appointment_bookings', 'Appointment bookings', 'Appointments created in the reporting period.', 'count'),
  ('patient_access', 'followup_appointments', 'Follow-up appointments', 'Appointments categorized as follow-up where captured.', 'count'),
  ('referrals', 'referrals_created', 'Referrals created', 'PHC, public hospital, specialist, pharmacy, or lab referrals created.', 'count'),
  ('referrals', 'referrals_completed', 'Referrals completed', 'Referrals completed in the reporting period.', 'count'),
  ('referrals', 'pending_referrals', 'Pending referrals', 'Referrals that remain sent, accepted, or pending clarification.', 'count'),
  ('pharmacy', 'prescriptions_created', 'Prescriptions created', 'Prescription records created in Nigeria workflows.', 'count'),
  ('pharmacy', 'pharmacy_referrals', 'Pharmacy referrals', 'Prescription/dispense requests routed to pharmacy workflows.', 'count'),
  ('laboratory', 'lab_referrals', 'Lab referrals', 'Diagnostic/lab referrals where captured.', 'count'),
  ('facilities', 'active_providers', 'Active providers', 'Active approved Nigeria providers.', 'count'),
  ('facilities', 'active_facilities', 'Active facilities', 'Configured active public-health facilities.', 'count'),
  ('communications', 'notifications_sent', 'SMS/WhatsApp notifications sent', 'Notification hooks or logs captured for Nigeria workflows.', 'count'),
  ('reporting', 'reports_generated', 'Public-health reports generated', 'Public-health aggregate reports generated.', 'count'),
  ('cancer_care', 'cancer_related_referrals', 'Cancer-care support referrals', 'Cancer/oncology/screening-related coordination referrals where tagged.', 'count')
ON CONFLICT (internal_key) DO NOTHING;

INSERT INTO dhis2_integration_settings (environment, enabled, dry_run_only)
SELECT 'disabled', FALSE, TRUE
WHERE NOT EXISTS (SELECT 1 FROM dhis2_integration_settings);
