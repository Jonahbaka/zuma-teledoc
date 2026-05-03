-- ============================================================
-- NIGERIA REGION: Pharmacy onboarding operational fields
-- Keeps pharmacy onboarding inside DoctaRx Nigeria, not a separate product.
-- ============================================================

DO $$ BEGIN
  ALTER TABLE ng_pharmacies ADD COLUMN legal_business_name VARCHAR(255);
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE ng_pharmacies ADD COLUMN branch_name VARCHAR(255);
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE ng_pharmacies ADD COLUMN pickup_enabled BOOLEAN DEFAULT TRUE;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE ng_pharmacies ADD COLUMN service_categories JSONB DEFAULT '[]'::JSONB;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE ng_pharmacies ADD COLUMN onboarding_notes TEXT;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

