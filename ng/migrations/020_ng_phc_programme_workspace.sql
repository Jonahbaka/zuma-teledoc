-- DoctaRx Nigeria PHC programme workspace and facility isolation.
-- Additive only: existing commercial and public-health records remain valid.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE public_health_programmes
  ADD COLUMN IF NOT EXISTS programme_key TEXT,
  ADD COLUMN IF NOT EXISTS slug TEXT,
  ADD COLUMN IF NOT EXISTS sponsor_organization_id UUID REFERENCES ng_organizations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS jurisdiction_id UUID REFERENCES ng_jurisdictions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS settings_json JSONB NOT NULL DEFAULT '{}'::JSONB,
  ADD COLUMN IF NOT EXISTS data_sharing_policy_json JSONB NOT NULL DEFAULT '{}'::JSONB,
  ADD COLUMN IF NOT EXISTS demo_only BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;

UPDATE public_health_programmes
   SET programme_key = COALESCE(
         programme_key,
         'programme_' || SUBSTRING(REPLACE(id::TEXT, '-', '') FROM 1 FOR 12)
       ),
       slug = COALESCE(
         slug,
         LOWER(REGEXP_REPLACE(TRIM(name), '[^a-zA-Z0-9]+', '-', 'g'))
       )
 WHERE programme_key IS NULL OR slug IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_public_health_programmes_key
  ON public_health_programmes (programme_key)
  WHERE programme_key IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_public_health_programmes_slug
  ON public_health_programmes (slug)
  WHERE slug IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_public_health_programmes_scope
  ON public_health_programmes (jurisdiction_id, status, demo_only);

ALTER TABLE ng_hospitals
  ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES ng_organizations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS ownership_type TEXT,
  ADD COLUMN IF NOT EXISTS ward TEXT,
  ADD COLUMN IF NOT EXISTS facility_code TEXT,
  ADD COLUMN IF NOT EXISTS dhis2_org_unit_id TEXT,
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS uq_ng_hospitals_facility_code
  ON ng_hospitals (facility_code)
  WHERE facility_code IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ng_hospitals_org
  ON ng_hospitals (organization_id, status);

ALTER TABLE public_health_facilities
  ADD COLUMN IF NOT EXISTS hospital_id UUID REFERENCES ng_hospitals(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_public_health_facilities_hospital
  ON public_health_facilities (hospital_id)
  WHERE hospital_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS ng_programme_facilities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  programme_id UUID NOT NULL REFERENCES public_health_programmes(id) ON DELETE RESTRICT,
  facility_id UUID NOT NULL REFERENCES ng_hospitals(id) ON DELETE RESTRICT,
  public_health_facility_id UUID REFERENCES public_health_facilities(id) ON DELETE SET NULL,
  jurisdiction_id UUID REFERENCES ng_jurisdictions(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'planning' CHECK (status IN ('planning','active','paused','closed')),
  is_primary BOOLEAN NOT NULL DEFAULT FALSE,
  configuration_json JSONB NOT NULL DEFAULT '{}'::JSONB,
  effective_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (programme_id, facility_id)
);

CREATE INDEX IF NOT EXISTS idx_ng_programme_facilities_programme
  ON ng_programme_facilities (programme_id, status, facility_id);
CREATE INDEX IF NOT EXISTS idx_ng_programme_facilities_facility
  ON ng_programme_facilities (facility_id, status, programme_id);

CREATE TABLE IF NOT EXISTS ng_programme_memberships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  programme_id UUID NOT NULL REFERENCES public_health_programmes(id) ON DELETE RESTRICT,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  facility_id UUID REFERENCES ng_hospitals(id) ON DELETE RESTRICT,
  role TEXT NOT NULL CHECK (role IN (
    'phc_nurse','remote_clinician','facility_coordinator','facility_admin',
    'referral_coordinator','lab_technician','pharmacist','programme_admin',
    'government_analyst','government_reviewer','government_approver',
    'executive_read_only','support','platform_admin'
  )),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('invited','active','suspended','expired','revoked')),
  permissions_json JSONB NOT NULL DEFAULT '{}'::JSONB,
  can_export BOOLEAN NOT NULL DEFAULT FALSE,
  can_approve BOOLEAN NOT NULL DEFAULT FALSE,
  granted_by UUID REFERENCES users(id) ON DELETE SET NULL,
  effective_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_ng_programme_membership_scope
  ON ng_programme_memberships (
    programme_id,
    user_id,
    role,
    COALESCE(facility_id, '00000000-0000-0000-0000-000000000000'::UUID)
  )
  WHERE status IN ('invited','active','suspended');

CREATE INDEX IF NOT EXISTS idx_ng_programme_memberships_user
  ON ng_programme_memberships (user_id, status, programme_id);
CREATE INDEX IF NOT EXISTS idx_ng_programme_memberships_scope
  ON ng_programme_memberships (programme_id, facility_id, role, status);

CREATE TABLE IF NOT EXISTS ng_programme_patient_enrollments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  programme_id UUID NOT NULL REFERENCES public_health_programmes(id) ON DELETE RESTRICT,
  patient_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  facility_id UUID NOT NULL REFERENCES ng_hospitals(id) ON DELETE RESTRICT,
  local_patient_number TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('pending','active','paused','completed','withdrawn','transferred')),
  consent_status TEXT NOT NULL DEFAULT 'pending' CHECK (consent_status IN ('pending','granted','declined','revoked','expired')),
  consent_version TEXT,
  consented_at TIMESTAMPTZ,
  consented_by UUID REFERENCES users(id) ON DELETE SET NULL,
  enrolled_by UUID REFERENCES users(id) ON DELETE SET NULL,
  enrolled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at TIMESTAMPTZ,
  metadata_json JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_ng_programme_patient_active
  ON ng_programme_patient_enrollments (programme_id, patient_user_id)
  WHERE status IN ('pending','active','paused','transferred');

CREATE UNIQUE INDEX IF NOT EXISTS uq_ng_programme_patient_local_number
  ON ng_programme_patient_enrollments (programme_id, facility_id, local_patient_number)
  WHERE local_patient_number IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ng_programme_patient_facility
  ON ng_programme_patient_enrollments (programme_id, facility_id, status);
CREATE INDEX IF NOT EXISTS idx_ng_programme_patient_user
  ON ng_programme_patient_enrollments (patient_user_id, status);

CREATE TABLE IF NOT EXISTS ng_programme_components (
  programme_id UUID NOT NULL REFERENCES public_health_programmes(id) ON DELETE CASCADE,
  programme_space_id UUID NOT NULL REFERENCES ng_programme_spaces(id) ON DELETE RESTRICT,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  configuration_json JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (programme_id, programme_space_id)
);

CREATE TABLE IF NOT EXISTS ng_programme_feature_flags (
  programme_id UUID NOT NULL REFERENCES public_health_programmes(id) ON DELETE CASCADE,
  feature_key TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  configuration_json JSONB NOT NULL DEFAULT '{}'::JSONB,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (programme_id, feature_key)
);

CREATE TABLE IF NOT EXISTS ng_programme_audit_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  programme_id UUID REFERENCES public_health_programmes(id) ON DELETE RESTRICT,
  facility_id UUID REFERENCES ng_hospitals(id) ON DELETE RESTRICT,
  actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  patient_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id UUID,
  purpose TEXT,
  data_class TEXT NOT NULL DEFAULT 'operational' CHECK (data_class IN ('aggregate','operational','sensitive')),
  metadata_json JSONB NOT NULL DEFAULT '{}'::JSONB,
  ip_address INET,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ng_programme_audit_scope
  ON ng_programme_audit_events (programme_id, facility_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ng_programme_audit_patient
  ON ng_programme_audit_events (patient_user_id, created_at DESC)
  WHERE patient_user_id IS NOT NULL;

INSERT INTO public_health_programmes
  (name, description, status, market, programme_key, slug, demo_only, settings_json, data_sharing_policy_json)
VALUES
  ('DoctaRx Developer Demonstration Programme',
   'Synthetic developer-only programme. It must never contain real patient, clinical, government, payment, or institutional data.',
   'active', 'NG', 'developer_demo', 'developer-demo', TRUE,
   '{"syntheticDataOnly":true,"externalSideEffects":false}'::JSONB,
   '{"realPatientData":false,"crossProgrammeAccess":false}'::JSONB)
ON CONFLICT (market, name) DO UPDATE SET
  programme_key = EXCLUDED.programme_key,
  slug = EXCLUDED.slug,
  demo_only = TRUE,
  settings_json = EXCLUDED.settings_json,
  data_sharing_policy_json = EXCLUDED.data_sharing_policy_json,
  updated_at = NOW();

INSERT INTO ng_programme_feature_flags (programme_id, feature_key, enabled, configuration_json)
SELECT id, feature_key, FALSE, '{"blockedForDemo":true}'::JSONB
  FROM public_health_programmes
 CROSS JOIN (VALUES
   ('real_patient_data'),
   ('external_messaging'),
   ('payments'),
   ('dhis2_live_sync'),
   ('external_referral_delivery')
 ) AS flags(feature_key)
 WHERE programme_key = 'developer_demo'
ON CONFLICT (programme_id, feature_key) DO UPDATE SET
  enabled = FALSE,
  configuration_json = EXCLUDED.configuration_json,
  updated_at = NOW();
