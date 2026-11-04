-- Preserve existing documents and make future changes attributable and versioned.
ALTER TABLE medical_records ADD COLUMN IF NOT EXISTS record_version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE medical_records ADD COLUMN IF NOT EXISTS is_voided BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS medical_record_revisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  record_id UUID NOT NULL REFERENCES medical_records(id),
  version INTEGER NOT NULL CHECK (version >= 1),
  action VARCHAR(30) NOT NULL CHECK (action IN ('recorded','baseline','corrected','voided')),
  actor_user_id UUID NOT NULL REFERENCES users(id),
  reason_protected JSONB,
  snapshot_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(record_id, version)
);
CREATE INDEX IF NOT EXISTS idx_medical_record_revisions_record ON medical_record_revisions(record_id,version);
CREATE INDEX IF NOT EXISTS idx_medical_records_patient_visible ON medical_records(patient_id,recorded_at DESC) WHERE access_restricted=FALSE AND is_voided=FALSE;

CREATE OR REPLACE FUNCTION preserve_medical_record_revision() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Retained medical record revisions are append-only';
END;
$$ LANGUAGE plpgsql;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='medical_record_revisions_immutable' AND tgrelid='medical_record_revisions'::regclass) THEN
    CREATE TRIGGER medical_record_revisions_immutable BEFORE UPDATE OR DELETE ON medical_record_revisions FOR EACH ROW EXECUTE FUNCTION preserve_medical_record_revision();
  END IF;
END $$;
