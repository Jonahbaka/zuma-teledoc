-- Forward-only delivery scheduling and explicit, audited operator commands.
ALTER TABLE dhis2_integration_settings ADD COLUMN IF NOT EXISTS api_version TEXT;
ALTER TABLE dhis2_integration_settings ADD COLUMN IF NOT EXISTS profile_approval_reference TEXT;
ALTER TABLE dhis2_integration_settings ADD COLUMN IF NOT EXISTS async_import_enabled BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE ng_dhis2_delivery_jobs ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0);
ALTER TABLE ng_dhis2_delivery_jobs ADD COLUMN IF NOT EXISTS next_attempt_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE ng_dhis2_delivery_jobs ADD COLUMN IF NOT EXISTS first_attempt_at TIMESTAMPTZ;
ALTER TABLE ng_dhis2_delivery_jobs ADD COLUMN IF NOT EXISTS poll_deadline_at TIMESTAMPTZ;
ALTER TABLE ng_dhis2_delivery_jobs ADD COLUMN IF NOT EXISTS api_version TEXT;
ALTER TABLE ng_dhis2_delivery_jobs ADD COLUMN IF NOT EXISTS profile_approval_reference TEXT;
ALTER TABLE ng_dhis2_delivery_jobs ADD COLUMN IF NOT EXISTS async_import_enabled BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE ng_dhis2_delivery_jobs ADD COLUMN IF NOT EXISTS remote_job_type TEXT;
ALTER TABLE ng_dhis2_delivery_jobs ADD COLUMN IF NOT EXISTS authorized_by UUID REFERENCES users(id) ON DELETE RESTRICT;
ALTER TABLE ng_dhis2_delivery_jobs ADD COLUMN IF NOT EXISTS operator_retry_budget INTEGER NOT NULL DEFAULT 0 CHECK (operator_retry_budget BETWEEN 0 AND 1);
ALTER TABLE ng_dhis2_delivery_jobs ADD COLUMN IF NOT EXISTS resolution_code TEXT;
ALTER TABLE ng_dhis2_delivery_jobs ADD COLUMN IF NOT EXISTS resolution_reason TEXT;
ALTER TABLE ng_dhis2_delivery_jobs ADD COLUMN IF NOT EXISTS resolved_by UUID REFERENCES users(id) ON DELETE RESTRICT;
ALTER TABLE ng_dhis2_delivery_jobs ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ;

UPDATE ng_dhis2_delivery_jobs SET authorized_by=created_by WHERE authorized_by IS NULL;
UPDATE ng_dhis2_delivery_jobs SET next_attempt_at=NULL WHERE status IN ('confirmed','rejected','failed') AND operator_retry_budget=0;
CREATE INDEX IF NOT EXISTS idx_ng_dhis2_delivery_due ON ng_dhis2_delivery_jobs(next_attempt_at,created_at)
  WHERE status IN ('queued','submitting','reconciliation') OR operator_retry_budget>0;

CREATE TABLE IF NOT EXISTS ng_dhis2_delivery_commands (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES ng_dhis2_delivery_jobs(id) ON DELETE RESTRICT,
  actor_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  command_key UUID NOT NULL,
  body_hash CHAR(64) NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('reconcile','close')),
  expected_version INTEGER NOT NULL CHECK (expected_version>0),
  reason TEXT NOT NULL CHECK (length(reason) BETWEEN 3 AND 500),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(job_id,command_key)
);
