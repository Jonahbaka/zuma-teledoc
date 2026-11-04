-- Protect new clinical narrative writes without rewriting existing clinical
-- history. Legacy plaintext remains readable until separately reviewed and
-- migrated; this migration does not backfill, clear, or delete any old value.
-- Deploy this additive schema before the matching application writers.
ALTER TABLE clinical_notes ADD COLUMN IF NOT EXISTS follow_up_notes_encrypted TEXT;
ALTER TABLE clinical_notes ADD COLUMN IF NOT EXISTS follow_up_notes_iv VARCHAR(255);
ALTER TABLE clinical_notes ADD COLUMN IF NOT EXISTS follow_up_notes_tag VARCHAR(255);
ALTER TABLE clinical_notes ADD COLUMN IF NOT EXISTS amendment_reason_encrypted TEXT;
ALTER TABLE clinical_notes ADD COLUMN IF NOT EXISTS amendment_reason_iv VARCHAR(255);
ALTER TABLE clinical_notes ADD COLUMN IF NOT EXISTS amendment_reason_tag VARCHAR(255);
ALTER TABLE patient_allergies ADD COLUMN IF NOT EXISTS inactivation_reason_encrypted TEXT;
ALTER TABLE patient_allergies ADD COLUMN IF NOT EXISTS inactivation_reason_iv VARCHAR(255);
ALTER TABLE patient_allergies ADD COLUMN IF NOT EXISTS inactivation_reason_tag VARCHAR(255);
ALTER TABLE patient_medications ADD COLUMN IF NOT EXISTS discontinuation_reason_encrypted TEXT;
ALTER TABLE patient_medications ADD COLUMN IF NOT EXISTS discontinuation_reason_iv VARCHAR(255);
ALTER TABLE patient_medications ADD COLUMN IF NOT EXISTS discontinuation_reason_tag VARCHAR(255);
