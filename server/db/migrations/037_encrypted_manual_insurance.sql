-- Forward-only storage for patient-entered insurance identity. Existing card,
-- coverage and account records are not backfilled or rewritten.
ALTER TABLE patient_insurance ADD COLUMN IF NOT EXISTS manual_identity_encrypted JSONB;
ALTER TABLE patient_insurance ADD COLUMN IF NOT EXISTS manual_submission_key UUID;
ALTER TABLE patient_insurance ADD COLUMN IF NOT EXISTS manual_submission_digest VARCHAR(64);
ALTER TABLE patient_insurance ADD COLUMN IF NOT EXISTS is_verified BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE patient_insurance ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ;

DO $$ BEGIN
  ALTER TABLE patient_insurance ADD CONSTRAINT patient_insurance_manual_identity_check
    CHECK ((manual_submission_key IS NULL AND manual_identity_encrypted IS NULL AND manual_submission_digest IS NULL) OR (
      manual_submission_key IS NOT NULL AND COALESCE(jsonb_typeof(manual_identity_encrypted) = 'object'
      AND manual_identity_encrypted->>'algorithm' = 'aes-256-gcm'
      AND manual_identity_encrypted->>'version' = '1'
      AND manual_identity_encrypted->>'aad' = 'doctarx.manual-insurance.v1:' || user_id::text || ':' || manual_submission_key::text
      AND LENGTH(manual_identity_encrypted->>'encrypted') > 0
      AND manual_identity_encrypted->>'iv' ~ '^[a-f0-9]{24}$'
      AND manual_identity_encrypted->>'tag' ~ '^[a-f0-9]{32}$'
      AND manual_submission_digest ~ '^[a-f0-9]{64}$', FALSE)
    ));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_patient_insurance_manual_retry
  ON patient_insurance(user_id,manual_submission_key) WHERE manual_submission_key IS NOT NULL;
