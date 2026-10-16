-- Preserve legacy history while permitting the encrypted clinical service to
-- record new history without copying PHI into obsolete plaintext name columns.
-- Existing rows are neither rewritten nor removed. Alternative-content checks
-- are fully validated; any unexpected deployed drift requires explicit review.
ALTER TABLE patient_allergies ALTER COLUMN allergy_name DROP NOT NULL;
ALTER TABLE patient_problems ALTER COLUMN problem_name DROP NOT NULL;
ALTER TABLE patient_medications ALTER COLUMN medication_name DROP NOT NULL;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='patient_allergies_recorded_content' AND conrelid='patient_allergies'::regclass) THEN
    ALTER TABLE patient_allergies ADD CONSTRAINT patient_allergies_recorded_content CHECK (
      allergy_name IS NOT NULL OR
      (allergen_encrypted IS NOT NULL AND allergen_iv IS NOT NULL AND allergen_tag IS NOT NULL)
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='patient_problems_recorded_content' AND conrelid='patient_problems'::regclass) THEN
    ALTER TABLE patient_problems ADD CONSTRAINT patient_problems_recorded_content CHECK (
      problem_name IS NOT NULL OR NULLIF(BTRIM(icd10_code),'') IS NOT NULL OR NULLIF(BTRIM(icd10_description),'') IS NOT NULL OR
      (problem_description_encrypted IS NOT NULL AND problem_description_iv IS NOT NULL AND problem_description_tag IS NOT NULL)
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='patient_medications_recorded_content' AND conrelid='patient_medications'::regclass) THEN
    ALTER TABLE patient_medications ADD CONSTRAINT patient_medications_recorded_content CHECK (
      medication_name IS NOT NULL OR
      (medication_name_encrypted IS NOT NULL AND medication_name_iv IS NOT NULL AND medication_name_tag IS NOT NULL)
    );
  END IF;
END $$;
