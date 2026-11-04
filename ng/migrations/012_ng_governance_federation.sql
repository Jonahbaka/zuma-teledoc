-- =============================================================================
-- 012_ng_governance_federation.sql
-- DoctaRx Nigeria — Federated Governance Architecture
-- Hierarchy: FMOH → FCT/State → Area Council → Facility → Provider
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------------
-- Jurisdiction hierarchy
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ng_jurisdictions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code          TEXT NOT NULL UNIQUE,                -- e.g. 'FMOH', 'FCT', 'AMAC', 'FACILITY:uuid'
  name          TEXT NOT NULL,
  tier          TEXT NOT NULL CHECK (tier IN ('national','state','area_council','facility','provider')),
  parent_id     UUID REFERENCES ng_jurisdictions(id) ON DELETE SET NULL,
  metadata_json JSONB DEFAULT '{}'::JSONB,
  active        BOOLEAN DEFAULT TRUE,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ng_jurisdictions_tier   ON ng_jurisdictions (tier, active);
CREATE INDEX IF NOT EXISTS idx_ng_jurisdictions_parent ON ng_jurisdictions (parent_id);

-- Seed canonical Nigerian jurisdictions
INSERT INTO ng_jurisdictions (code, name, tier) VALUES
  ('FMOH',  'Federal Ministry of Health',                       'national'),
  ('FCT',   'FCT Administration / HSES',                        'state'),
  ('AMAC',  'Abuja Municipal Area Council',                     'area_council'),
  ('BWARI', 'Bwari Area Council',                               'area_council'),
  ('GWAGW', 'Gwagwalada Area Council',                          'area_council'),
  ('KUJE',  'Kuje Area Council',                                'area_council'),
  ('KWALI', 'Kwali Area Council',                               'area_council'),
  ('ABAJI', 'Abaji Area Council',                               'area_council')
ON CONFLICT (code) DO NOTHING;

-- Wire area-council parents to FCT
UPDATE ng_jurisdictions child
SET    parent_id = parent.id
FROM   ng_jurisdictions parent
WHERE  parent.code = 'FCT'
  AND  child.tier  = 'area_council'
  AND  child.parent_id IS NULL;

-- Wire FCT parent to FMOH
UPDATE ng_jurisdictions child
SET    parent_id = parent.id
FROM   ng_jurisdictions parent
WHERE  parent.code = 'FMOH'
  AND  child.code  = 'FCT'
  AND  child.parent_id IS NULL;

-- ---------------------------------------------------------------------------
-- Jurisdiction-scoped user roles  (RBAC + ABAC)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ng_user_jurisdiction_roles (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  jurisdiction_id  UUID NOT NULL REFERENCES ng_jurisdictions(id) ON DELETE CASCADE,
  role             TEXT NOT NULL CHECK (role IN (
                     'super_admin','platform_admin','executive_read_only',
                     'programme_admin','facility_admin','provider',
                     'analyst','reviewer','approver'
                   )),
  -- Scope attributes
  facility_id      UUID REFERENCES public_health_facilities(id) ON DELETE SET NULL,
  programme_area   TEXT,                  -- restrict to specific programme
  can_export       BOOLEAN DEFAULT FALSE,
  can_approve      BOOLEAN DEFAULT FALSE,
  can_view_aggregate BOOLEAN DEFAULT TRUE,
  data_class_level TEXT NOT NULL DEFAULT 'aggregate' CHECK (data_class_level IN ('aggregate','operational','sensitive')),
  granted_by       UUID REFERENCES users(id) ON DELETE SET NULL,
  granted_at       TIMESTAMPTZ DEFAULT NOW(),
  expires_at       TIMESTAMPTZ,
  active           BOOLEAN DEFAULT TRUE,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id, jurisdiction_id, role)
);

CREATE INDEX IF NOT EXISTS idx_ng_ujr_user         ON ng_user_jurisdiction_roles (user_id, active);
CREATE INDEX IF NOT EXISTS idx_ng_ujr_jurisdiction ON ng_user_jurisdiction_roles (jurisdiction_id, role);

-- ---------------------------------------------------------------------------
-- Governance workflow
-- Facility submission → Area Council review → FCTA approval → DHIS2-ready export
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ng_governance_submissions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id         UUID NOT NULL REFERENCES public_health_reports(id) ON DELETE CASCADE,
  facility_id       UUID REFERENCES public_health_facilities(id) ON DELETE SET NULL,
  submitter_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  jurisdiction_id   UUID REFERENCES ng_jurisdictions(id) ON DELETE SET NULL, -- originating jurisdiction
  submission_period TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'submitted' CHECK (status IN (
                      'submitted','area_council_review','fcta_review',
                      'approved','rejected','dhis2_ready','exported'
                    )),
  reviewer_user_id  UUID REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at       TIMESTAMPTZ,
  reviewer_notes    TEXT,
  approver_user_id  UUID REFERENCES users(id) ON DELETE SET NULL,
  approved_at       TIMESTAMPTZ,
  approver_notes    TEXT,
  exported_by       UUID REFERENCES users(id) ON DELETE SET NULL,
  exported_at       TIMESTAMPTZ,
  metadata_json     JSONB DEFAULT '{}'::JSONB,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ng_gov_submissions_report ON ng_governance_submissions (report_id);
CREATE INDEX IF NOT EXISTS idx_ng_gov_submissions_status ON ng_governance_submissions (status, submission_period);
CREATE INDEX IF NOT EXISTS idx_ng_gov_submissions_jur    ON ng_governance_submissions (jurisdiction_id, status);

-- ---------------------------------------------------------------------------
-- Governance workflow audit trail (every state transition recorded)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ng_governance_workflow_logs (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id    UUID NOT NULL REFERENCES ng_governance_submissions(id) ON DELETE CASCADE,
  actor_user_id    UUID REFERENCES users(id) ON DELETE SET NULL,
  from_status      TEXT,
  to_status        TEXT NOT NULL,
  action           TEXT NOT NULL,
  notes            TEXT,
  ip_address       INET,
  user_agent       TEXT,
  metadata_json    JSONB DEFAULT '{}'::JSONB,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ng_govlog_submission ON ng_governance_workflow_logs (submission_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ng_govlog_actor      ON ng_governance_workflow_logs (actor_user_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- Extended audit lineage (view / export / approve / modify / sync events)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ng_audit_lineage (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id    UUID REFERENCES users(id) ON DELETE SET NULL,
  action           TEXT NOT NULL CHECK (action IN (
                     'view','export','approve','reject','modify',
                     'sync','dry_run','submit','review','generate',
                     'login','logout','permission_grant','permission_revoke'
                   )),
  resource_type    TEXT,                  -- e.g. 'report','indicator','submission','dashboard'
  resource_id      UUID,
  jurisdiction_id  UUID REFERENCES ng_jurisdictions(id) ON DELETE SET NULL,
  jurisdiction_scope TEXT,               -- human-readable scope label
  data_class       TEXT DEFAULT 'aggregate',
  export_format    TEXT,                 -- csv, json, dhis2_preview
  ip_address       INET,
  user_agent       TEXT,
  session_id       TEXT,
  metadata_json    JSONB DEFAULT '{}'::JSONB,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ng_audit_lin_actor      ON ng_audit_lineage (actor_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ng_audit_lin_resource   ON ng_audit_lineage (resource_type, resource_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ng_audit_lin_action     ON ng_audit_lineage (action, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ng_audit_lin_jur        ON ng_audit_lineage (jurisdiction_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- Portal access tokens (read-only bearer tokens for executive dashboards)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ng_portal_access_tokens (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash       TEXT NOT NULL UNIQUE,  -- SHA-256 of the raw token
  label            TEXT NOT NULL,
  portal           TEXT NOT NULL CHECK (portal IN (
                     'fmoh','fcta_hses','amac','facility','provider','executive_view'
                   )),
  jurisdiction_id  UUID REFERENCES ng_jurisdictions(id) ON DELETE CASCADE,
  created_by       UUID REFERENCES users(id) ON DELETE SET NULL,
  expires_at       TIMESTAMPTZ,
  last_used_at     TIMESTAMPTZ,
  active           BOOLEAN DEFAULT TRUE,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ng_pat_token      ON ng_portal_access_tokens (token_hash, active);
CREATE INDEX IF NOT EXISTS idx_ng_pat_portal     ON ng_portal_access_tokens (portal, active);
CREATE INDEX IF NOT EXISTS idx_ng_pat_jur        ON ng_portal_access_tokens (jurisdiction_id);

-- ---------------------------------------------------------------------------
-- Programme space isolation
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ng_programme_spaces (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  programme_key    TEXT NOT NULL UNIQUE,
  display_name     TEXT NOT NULL,
  description      TEXT,
  tier             TEXT NOT NULL DEFAULT 'facility' CHECK (tier IN ('national','state','area_council','facility')),
  active           BOOLEAN DEFAULT TRUE,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO ng_programme_spaces (programme_key, display_name, description, tier) VALUES
  ('primary_healthcare',          'Primary Healthcare Strengthening',          'PHC patient access, follow-up, referral, care continuity visibility.',                'facility'),
  ('teleconsultation_access',     'Teleconsultation & Digital Access',         'Digital access via telemedicine, remote follow-up, appointment booking.',             'facility'),
  ('referral_coordination',       'Referral Coordination',                     'PHC, hospital, specialist, pharmacy, and lab referral tracking.',                    'facility'),
  ('pharmacy_coordination',       'Pharmacy Coordination',                     'Prescription records, pharmacy routing, medicine demand visibility.',                 'facility'),
  ('laboratory_coordination',     'Laboratory & Diagnostic Coordination',      'Lab referral tracking, diagnostic request workflows, lab utilization reporting.',     'facility'),
  ('cancer_care_coordination',    'Cancer Care Coordination',                  'Cancer/oncology/screening referrals, patient navigation, specialist workflow.',       'facility'),
  ('maternal_health',             'Maternal Health',                           'Maternal and child health appointment, referral, and follow-up visibility.',          'facility'),
  ('nhmis_dhis2_reporting',       'NHMIS/DHIS2-Ready Reporting',               'Structured aggregate reports mappable to official NHMIS/DHIS2 datasets.',            'area_council'),
  ('public_health_intelligence',  'Public Health Intelligence',                'Dashboards, utilization trends, location intelligence, executive summaries.',        'state'),
  ('emergency_coordination',      'Emergency Coordination',                    'Emergency routing, escalation tracking, and response visibility.',                   'facility')
ON CONFLICT (programme_key) DO NOTHING;
