-- Preserve existing prescriptions; private patient submissions require review.
ALTER TABLE ng_prescriptions ADD COLUMN IF NOT EXISTS image_data_encrypted JSONB;
ALTER TABLE ng_prescriptions ADD COLUMN IF NOT EXISTS submitted_text_encrypted JSONB;
ALTER TABLE ng_prescriptions ADD COLUMN IF NOT EXISTS image_mime TEXT;
