-- Government data intake, reconciliation, lineage, and indexed search.
-- This migration is additive. Official records are soft-rolled back so source
-- evidence and audit history remain available for review.

CREATE TABLE IF NOT EXISTS ng_government_data_sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  source_type TEXT NOT NULL CHECK (source_type IN ('csv','xlsx','json','api','dhis2')),
  description TEXT,
  jurisdiction_id UUID NOT NULL REFERENCES ng_jurisdictions(id) ON DELETE RESTRICT,
  facility_id UUID REFERENCES public_health_facilities(id) ON DELETE RESTRICT,
  programme_area TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','revoked')),
  configuration_json JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public_health_indicators ADD COLUMN IF NOT EXISTS target_value NUMERIC;

INSERT INTO public_health_indicators (programme_area,internal_key,display_name,description,aggregation_type,target_value)
VALUES
  ('maternal_health','pnc_within_24h_percentage','PNC within 24 hours','Percentage of eligible births receiving postnatal care within 24 hours.','percentage',90),
  ('maternal_health','anc_eight_component_completeness_percentage','Eight-component ANC completeness','Percentage of ANC contacts with all eight required care components documented.','percentage',90),
  ('referrals','referral_completion_percentage','Referral completion','Percentage of initiated referrals completed in the reporting period.','percentage',90),
  ('referrals','referral_response_time_hours','Referral response time','Average hours from referral initiation to first receiving-facility response.','average',24),
  ('referrals','unresolved_cases','Unresolved cases','Cases that remain unresolved at the end of the reporting period.','count',0),
  ('service_utilization','service_utilization','Service utilization','Completed public-health service encounters in the reporting period.','count',NULL),
  ('continuity_of_care','continuity_of_care_percentage','Continuity of care','Percentage of eligible care episodes with the required follow-up completed.','percentage',85),
  ('reporting','reporting_completeness_percentage','Reporting completeness','Percentage of expected facility reports received with required fields.','percentage',95),
  ('reporting','reporting_timeliness_percentage','Reporting timeliness','Percentage of expected facility reports submitted by the deadline.','percentage',90),
  ('reporting','data_quality_pass_percentage','Data-quality status','Percentage of validated records passing configured quality rules.','percentage',95),
  ('reporting','dhis2_readiness_percentage','DHIS2 readiness','Percentage of approved observations with complete DHIS2 facility and indicator mappings.','percentage',100)
ON CONFLICT (internal_key) DO NOTHING;
CREATE INDEX IF NOT EXISTS idx_ng_gov_sources_scope
  ON ng_government_data_sources (jurisdiction_id, facility_id, programme_area, status);

CREATE TABLE IF NOT EXISTS ng_government_source_files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id UUID NOT NULL REFERENCES ng_government_data_sources(id) ON DELETE RESTRICT,
  original_filename TEXT NOT NULL,
  media_type TEXT NOT NULL,
  byte_size BIGINT NOT NULL CHECK (byte_size >= 0),
  sha256_checksum CHAR(64) NOT NULL,
  storage_key TEXT,
  uploaded_by UUID REFERENCES users(id) ON DELETE SET NULL,
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (source_id, sha256_checksum)
);

CREATE TABLE IF NOT EXISTS ng_government_data_mappings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id UUID NOT NULL REFERENCES ng_government_data_sources(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version > 0),
  field_map_json JSONB NOT NULL,
  transformations_json JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  retired_at TIMESTAMPTZ,
  UNIQUE (source_id, version)
);

CREATE TABLE IF NOT EXISTS ng_government_import_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id UUID NOT NULL REFERENCES ng_government_data_sources(id) ON DELETE RESTRICT,
  source_file_id UUID REFERENCES ng_government_source_files(id) ON DELETE RESTRICT,
  mapping_id UUID REFERENCES ng_government_data_mappings(id) ON DELETE RESTRICT,
  idempotency_key TEXT NOT NULL UNIQUE,
  sha256_checksum CHAR(64) NOT NULL,
  jurisdiction_id UUID NOT NULL REFERENCES ng_jurisdictions(id) ON DELETE RESTRICT,
  facility_id UUID REFERENCES public_health_facilities(id) ON DELETE RESTRICT,
  programme_area TEXT NOT NULL,
  reporting_period TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN (
    'draft','previewed','validated','submitted','approved','rejected',
    'committed','rolled_back','failed'
  )),
  row_count INTEGER NOT NULL DEFAULT 0 CHECK (row_count >= 0),
  valid_count INTEGER NOT NULL DEFAULT 0 CHECK (valid_count >= 0),
  duplicate_count INTEGER NOT NULL DEFAULT 0 CHECK (duplicate_count >= 0),
  quarantined_count INTEGER NOT NULL DEFAULT 0 CHECK (quarantined_count >= 0),
  imported_by UUID REFERENCES users(id) ON DELETE SET NULL,
  submitted_at TIMESTAMPTZ,
  approved_by UUID REFERENCES users(id) ON DELETE SET NULL,
  approved_at TIMESTAMPTZ,
  rejected_by UUID REFERENCES users(id) ON DELETE SET NULL,
  rejected_at TIMESTAMPTZ,
  decision_notes TEXT,
  committed_at TIMESTAMPTZ,
  rolled_back_by UUID REFERENCES users(id) ON DELETE SET NULL,
  rolled_back_at TIMESTAMPTZ,
  rollback_reason TEXT,
  metadata_json JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ng_gov_batches_scope
  ON ng_government_import_batches (jurisdiction_id, facility_id, programme_area, reporting_period, status);
CREATE INDEX IF NOT EXISTS idx_ng_gov_batches_created ON ng_government_import_batches (created_at DESC);

CREATE TABLE IF NOT EXISTS ng_government_import_rows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id UUID NOT NULL REFERENCES ng_government_import_batches(id) ON DELETE RESTRICT,
  source_row_number INTEGER NOT NULL CHECK (source_row_number > 0),
  source_payload_json JSONB NOT NULL,
  mapped_payload_json JSONB NOT NULL DEFAULT '{}'::JSONB,
  row_checksum CHAR(64) NOT NULL,
  validation_status TEXT NOT NULL DEFAULT 'pending' CHECK (validation_status IN ('pending','valid','invalid','duplicate')),
  duplicate_of_row_id UUID REFERENCES ng_government_import_rows(id) ON DELETE SET NULL,
  duplicate_of_record_id UUID,
  committed_record_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (batch_id, source_row_number)
);
CREATE INDEX IF NOT EXISTS idx_ng_gov_rows_batch_status
  ON ng_government_import_rows (batch_id, validation_status);
CREATE INDEX IF NOT EXISTS idx_ng_gov_rows_checksum ON ng_government_import_rows (row_checksum);

CREATE TABLE IF NOT EXISTS ng_data_quality_findings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id UUID NOT NULL REFERENCES ng_government_import_batches(id) ON DELETE RESTRICT,
  import_row_id UUID REFERENCES ng_government_import_rows(id) ON DELETE RESTRICT,
  finding_code TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('info','warning','error')),
  field_name TEXT,
  technical_message TEXT NOT NULL,
  plain_language_message TEXT NOT NULL,
  resolution_status TEXT NOT NULL DEFAULT 'open' CHECK (resolution_status IN ('open','accepted','corrected','dismissed')),
  resolved_by UUID REFERENCES users(id) ON DELETE SET NULL,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ng_dq_findings_batch
  ON ng_data_quality_findings (batch_id, severity, resolution_status);

CREATE TABLE IF NOT EXISTS ng_government_quarantined_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id UUID NOT NULL REFERENCES ng_government_import_batches(id) ON DELETE RESTRICT,
  import_row_id UUID NOT NULL UNIQUE REFERENCES ng_government_import_rows(id) ON DELETE RESTRICT,
  reason_codes TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  payload_json JSONB NOT NULL,
  released_by UUID REFERENCES users(id) ON DELETE SET NULL,
  released_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ng_government_import_decisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id UUID NOT NULL REFERENCES ng_government_import_batches(id) ON DELETE RESTRICT,
  decision TEXT NOT NULL CHECK (decision IN ('submit','approve','reject','rollback')),
  actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ng_gov_decisions_batch ON ng_government_import_decisions (batch_id, created_at);

CREATE TABLE IF NOT EXISTS ng_government_import_reconciliations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id UUID NOT NULL REFERENCES ng_government_import_batches(id) ON DELETE RESTRICT,
  stage TEXT NOT NULL CHECK (stage IN ('validation','approval','commit','rollback')),
  source_row_count INTEGER NOT NULL,
  valid_row_count INTEGER NOT NULL,
  duplicate_row_count INTEGER NOT NULL,
  quarantined_row_count INTEGER NOT NULL,
  missing_value_count INTEGER NOT NULL,
  observed_numeric_total NUMERIC,
  reconciled BOOLEAN NOT NULL,
  detail_json JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ng_gov_reconciliation_batch
  ON ng_government_import_reconciliations (batch_id, created_at DESC);

CREATE TABLE IF NOT EXISTS ng_government_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id UUID NOT NULL REFERENCES ng_government_import_batches(id) ON DELETE RESTRICT,
  import_row_id UUID NOT NULL UNIQUE REFERENCES ng_government_import_rows(id) ON DELETE RESTRICT,
  source_id UUID NOT NULL REFERENCES ng_government_data_sources(id) ON DELETE RESTRICT,
  mapping_id UUID REFERENCES ng_government_data_mappings(id) ON DELETE RESTRICT,
  jurisdiction_id UUID NOT NULL REFERENCES ng_jurisdictions(id) ON DELETE RESTRICT,
  facility_id UUID REFERENCES public_health_facilities(id) ON DELETE RESTRICT,
  programme_area TEXT NOT NULL,
  indicator_id UUID REFERENCES public_health_indicators(id) ON DELETE RESTRICT,
  reporting_period TEXT NOT NULL,
  observation_date DATE,
  record_key TEXT NOT NULL,
  title TEXT NOT NULL,
  observed_value NUMERIC,
  unit TEXT,
  approval_status TEXT NOT NULL DEFAULT 'approved' CHECK (approval_status IN ('pending','approved','rejected')),
  referral_status TEXT,
  data_quality_status TEXT NOT NULL DEFAULT 'valid' CHECK (data_quality_status IN ('valid','warning','invalid')),
  data_json JSONB NOT NULL DEFAULT '{}'::JSONB,
  search_vector TSVECTOR,
  approved_by UUID REFERENCES users(id) ON DELETE SET NULL,
  approved_at TIMESTAMPTZ,
  rolled_back_by UUID REFERENCES users(id) ON DELETE SET NULL,
  rolled_back_at TIMESTAMPTZ,
  rollback_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE ng_government_import_rows
  ADD CONSTRAINT fk_ng_gov_rows_duplicate_record
  FOREIGN KEY (duplicate_of_record_id) REFERENCES ng_government_records(id) ON DELETE SET NULL;
ALTER TABLE ng_government_import_rows
  ADD CONSTRAINT fk_ng_gov_rows_committed_record
  FOREIGN KEY (committed_record_id) REFERENCES ng_government_records(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_ng_gov_records_search ON ng_government_records USING GIN (search_vector);
CREATE INDEX IF NOT EXISTS idx_ng_gov_records_scope
  ON ng_government_records (jurisdiction_id, facility_id, programme_area, reporting_period, approval_status)
  WHERE rolled_back_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_ng_gov_records_filters
  ON ng_government_records (indicator_id, referral_status, data_quality_status, observation_date)
  WHERE rolled_back_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_ng_gov_records_active_scope_key
  ON ng_government_records (
    jurisdiction_id,
    COALESCE(facility_id, '00000000-0000-0000-0000-000000000000'::UUID),
    programme_area,
    reporting_period,
    record_key
  ) WHERE rolled_back_at IS NULL;

CREATE OR REPLACE FUNCTION ng_government_records_search_vector_update()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.search_vector := to_tsvector('simple', concat_ws(' ',
    NEW.record_key, NEW.title, NEW.programme_area, NEW.reporting_period,
    NEW.referral_status, NEW.data_quality_status, NEW.data_json::TEXT
  ));
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_ng_gov_records_search_vector ON ng_government_records;
CREATE TRIGGER trg_ng_gov_records_search_vector
BEFORE INSERT OR UPDATE OF record_key, title, programme_area, reporting_period,
  referral_status, data_quality_status, data_json
ON ng_government_records
FOR EACH ROW EXECUTE FUNCTION ng_government_records_search_vector_update();

CREATE TABLE IF NOT EXISTS ng_indicator_observations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  government_record_id UUID NOT NULL UNIQUE REFERENCES ng_government_records(id) ON DELETE RESTRICT,
  indicator_id UUID NOT NULL REFERENCES public_health_indicators(id) ON DELETE RESTRICT,
  jurisdiction_id UUID NOT NULL REFERENCES ng_jurisdictions(id) ON DELETE RESTRICT,
  facility_id UUID REFERENCES public_health_facilities(id) ON DELETE RESTRICT,
  programme_area TEXT NOT NULL,
  reporting_period TEXT NOT NULL,
  observed_value NUMERIC,
  unit TEXT,
  source_batch_id UUID NOT NULL REFERENCES ng_government_import_batches(id) ON DELETE RESTRICT,
  validation_status TEXT NOT NULL DEFAULT 'valid',
  approved_at TIMESTAMPTZ NOT NULL,
  rolled_back_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ng_indicator_observations_scope
  ON ng_indicator_observations (indicator_id, jurisdiction_id, facility_id, programme_area, reporting_period)
  WHERE rolled_back_at IS NULL;

CREATE TABLE IF NOT EXISTS ng_government_import_lineage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id UUID NOT NULL REFERENCES ng_government_import_batches(id) ON DELETE RESTRICT,
  import_row_id UUID REFERENCES ng_government_import_rows(id) ON DELETE RESTRICT,
  government_record_id UUID REFERENCES ng_government_records(id) ON DELETE RESTRICT,
  source_file_id UUID REFERENCES ng_government_source_files(id) ON DELETE RESTRICT,
  mapping_id UUID REFERENCES ng_government_data_mappings(id) ON DELETE RESTRICT,
  importing_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  approving_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('staged','validated','quarantined','approved','committed','rolled_back')),
  detail_json JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ng_gov_lineage_batch ON ng_government_import_lineage (batch_id, created_at);
CREATE INDEX IF NOT EXISTS idx_ng_gov_lineage_record ON ng_government_import_lineage (government_record_id, created_at);

CREATE TABLE IF NOT EXISTS ng_government_saved_views (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  filters_json JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, name)
);

CREATE TABLE IF NOT EXISTS ng_government_recent_searches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  query_text TEXT NOT NULL,
  filters_json JSONB NOT NULL DEFAULT '{}'::JSONB,
  result_count INTEGER NOT NULL DEFAULT 0,
  searched_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ng_gov_recent_user ON ng_government_recent_searches (user_id, searched_at DESC);

CREATE TABLE IF NOT EXISTS ng_government_account_invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL,
  token_hash CHAR(64) NOT NULL UNIQUE,
  jurisdiction_id UUID NOT NULL REFERENCES ng_jurisdictions(id) ON DELETE RESTRICT,
  facility_id UUID REFERENCES public_health_facilities(id) ON DELETE RESTRICT,
  programme_area TEXT,
  government_role TEXT NOT NULL CHECK (government_role IN (
    'provider','facility_admin','analyst','reviewer','approver','programme_admin',
    'executive_read_only','platform_admin'
  )),
  can_export BOOLEAN NOT NULL DEFAULT FALSE,
  can_approve BOOLEAN NOT NULL DEFAULT FALSE,
  data_class_level TEXT NOT NULL DEFAULT 'aggregate' CHECK (data_class_level IN ('aggregate','operational','sensitive')),
  invited_by UUID REFERENCES users(id) ON DELETE SET NULL,
  invited_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  accepted_by UUID REFERENCES users(id) ON DELETE SET NULL,
  accepted_at TIMESTAMPTZ,
  revoked_by UUID REFERENCES users(id) ON DELETE SET NULL,
  revoked_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_ng_gov_invitations_email ON ng_government_account_invitations (LOWER(email),expires_at);

-- Extend the existing fail-closed audit vocabulary for this data platform.
ALTER TABLE ng_audit_lineage DROP CONSTRAINT IF EXISTS ng_audit_lineage_action_check;
ALTER TABLE ng_audit_lineage ADD CONSTRAINT ng_audit_lineage_action_check CHECK (action IN (
  'view','search','export','approve','reject','modify','import','validate','rollback',
  'sync','dry_run','submit','review','generate','login','logout',
  'permission_grant','permission_revoke'
));
