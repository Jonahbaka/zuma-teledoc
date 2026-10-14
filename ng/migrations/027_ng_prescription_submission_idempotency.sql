ALTER TABLE ng_prescriptions ADD COLUMN IF NOT EXISTS submission_key UUID;
ALTER TABLE ng_prescriptions ADD COLUMN IF NOT EXISTS submission_digest TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS ng_prescription_submission_key_unique
  ON ng_prescriptions (patient_user_id, submission_key);
