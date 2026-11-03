-- Optional, clinician-verified AI documentation provenance for Nigeria eRx drafts.
-- No inference can create a prescription; the existing prescriber signature,
-- pharmacy routing, receipt and dispensing state machines remain authoritative.
ALTER TABLE ng_digital_prescriptions
  ADD COLUMN IF NOT EXISTS clinical_ai_source_suggestion_id UUID REFERENCES ng_clinical_ai_suggestions(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS clinical_ai_source_encounter_id UUID REFERENCES ng_clinical_encounters(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_ng_rx_clinical_ai_source
  ON ng_digital_prescriptions (clinical_ai_source_suggestion_id)
  WHERE clinical_ai_source_suggestion_id IS NOT NULL;

ALTER TABLE ng_digital_prescriptions
  DROP CONSTRAINT IF EXISTS ng_rx_ai_provenance_pair;

ALTER TABLE ng_digital_prescriptions
  ADD CONSTRAINT ng_rx_ai_provenance_pair
  CHECK ((clinical_ai_source_suggestion_id IS NULL) = (clinical_ai_source_encounter_id IS NULL));
