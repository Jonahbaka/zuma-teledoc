-- Private commercial configuration. No partner, agreement, credential or clinical
-- record is seeded by this migration. Existing orders retain their agreed fees.
CREATE TABLE IF NOT EXISTS ng_pharmacy_commercial_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','testing','active','suspended')),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  fees JSONB NOT NULL DEFAULT '{}',
  approvals JSONB NOT NULL DEFAULT '{}',
  settings JSONB NOT NULL DEFAULT '{}',
  created_by UUID NOT NULL REFERENCES users(id),
  updated_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (jsonb_typeof(fees)='object' AND jsonb_typeof(approvals)='object' AND jsonb_typeof(settings)='object')
);
CREATE TABLE IF NOT EXISTS ng_pharmacy_commercial_branches (
  pharmacy_id UUID PRIMARY KEY REFERENCES ng_pharmacies(id),
  profile_id UUID NOT NULL REFERENCES ng_pharmacy_commercial_profiles(id),
  partner_branch_reference TEXT NOT NULL,
  approval_reference TEXT NOT NULL,
  approved_by UUID NOT NULL REFERENCES users(id),
  approved_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE ng_medication_fulfillments
  ADD COLUMN IF NOT EXISTS commercial_snapshot JSONB,
  ADD COLUMN IF NOT EXISTS pharmacy_data_consent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS pharmacy_quote_reference UUID,
  ADD COLUMN IF NOT EXISTS pharmacy_quote_expires_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS ng_pharmacy_commercial_branches_profile ON ng_pharmacy_commercial_branches(profile_id);
