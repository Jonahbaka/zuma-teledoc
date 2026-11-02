-- Extend the protected Clinical Copilot draft registry to cover all PHC care stages.
-- Additive constraint replacement preserves existing data and earlier types.
ALTER TABLE ng_clinical_ai_suggestions
  DROP CONSTRAINT IF EXISTS ng_clinical_ai_suggestions_suggestion_type_check;

ALTER TABLE ng_clinical_ai_suggestions
  ADD CONSTRAINT ng_clinical_ai_suggestions_suggestion_type_check
  CHECK (suggestion_type IN (
    'intake_review', 'triage_review', 'consultation_brief', 'soap_draft',
    'encounter_summary', 'missing_information', 'emr_reconciliation',
    'prescription_review', 'referral_brief', 'follow_up_draft',
    'coding_assistance'
  ));
