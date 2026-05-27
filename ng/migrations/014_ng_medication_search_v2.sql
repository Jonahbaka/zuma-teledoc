-- =============================================================================
-- 014_ng_medication_search_v2.sql
-- DoctaRx Nigeria — Medication Search v2
--
-- Adds fuzzy + alias-aware lookup over the existing ng_drug_catalog:
--   * brand alias table (Coartem → Artemether-Lumefantrine, Augmentin → ...)
--   * drug interaction table (severity + mechanism)
--   * trigram GiST indexes for name / brand / generic / alias
-- Reuses existing pg_trgm extension (enabled in 002_seed_drug_catalog.sql)
-- and existing tsvector full-text GIN index on ng_drug_catalog.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ---------------------------------------------------------------------------
-- Brand aliases — many-to-one mapping into ng_drug_catalog
-- A single generic (e.g. artemether-lumefantrine) can be reached by many
-- street brand names (Coartem, Lonart, Amatem, Lumefan, ACT-AL, etc.).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ng_drug_brand_aliases (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  drug_id         UUID REFERENCES ng_drug_catalog(id) ON DELETE CASCADE,
  alias_name      TEXT NOT NULL,
  alias_normalized TEXT NOT NULL,            -- lowercased, punctuation stripped
  generic_name    TEXT,                       -- canonical for matching when drug_id null
  locale          TEXT DEFAULT 'NG',
  source          TEXT,                       -- 'curated' | 'nafdac' | 'crowd'
  is_active       BOOLEAN DEFAULT TRUE,
  popularity      INTEGER DEFAULT 0,          -- boost frequent street names
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ng_alias_norm     ON ng_drug_brand_aliases (alias_normalized);
CREATE INDEX IF NOT EXISTS idx_ng_alias_generic  ON ng_drug_brand_aliases (LOWER(generic_name));
CREATE INDEX IF NOT EXISTS idx_ng_alias_drug     ON ng_drug_brand_aliases (drug_id);
CREATE INDEX IF NOT EXISTS idx_ng_alias_trgm
  ON ng_drug_brand_aliases USING GIN (alias_normalized gin_trgm_ops);

-- Fuzzy trigram indexes on the catalog itself
CREATE INDEX IF NOT EXISTS idx_ng_drug_name_trgm
  ON ng_drug_catalog USING GIN (LOWER(name) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_ng_drug_generic_trgm
  ON ng_drug_catalog USING GIN (LOWER(COALESCE(generic_name,'')) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_ng_drug_brand_trgm
  ON ng_drug_catalog USING GIN (LOWER(COALESCE(brand_name,'')) gin_trgm_ops);

-- ---------------------------------------------------------------------------
-- Interactions — minimal directional pair table.
-- For symmetric pairs we keep two rows (a→b, b→a) so lookups stay simple.
-- ---------------------------------------------------------------------------
DO $$ BEGIN CREATE TYPE ng_drug_interaction_severity AS ENUM (
  'low','moderate','high','contraindicated'
); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS ng_drug_interactions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  drug_a_generic  TEXT NOT NULL,
  drug_b_generic  TEXT NOT NULL,
  severity        ng_drug_interaction_severity NOT NULL,
  mechanism       TEXT,
  effect          TEXT,
  management      TEXT,
  source          TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (drug_a_generic, drug_b_generic)
);

CREATE INDEX IF NOT EXISTS idx_ng_inter_a ON ng_drug_interactions (LOWER(drug_a_generic));
CREATE INDEX IF NOT EXISTS idx_ng_inter_b ON ng_drug_interactions (LOWER(drug_b_generic));

-- ---------------------------------------------------------------------------
-- Seed Nigerian street brand aliases (curated, common-clinic vocabulary).
-- drug_id is NULL — service will resolve to a catalog row by generic_name
-- match. This keeps the seed independent of catalog row UUIDs.
-- ---------------------------------------------------------------------------
INSERT INTO ng_drug_brand_aliases (alias_name, alias_normalized, generic_name, source, popularity) VALUES
  -- Antimalarials (ACT)
  ('Coartem',     'coartem',     'artemether-lumefantrine', 'curated', 100),
  ('Lonart',      'lonart',      'artemether-lumefantrine', 'curated', 90),
  ('Amatem',      'amatem',      'artemether-lumefantrine', 'curated', 60),
  ('Lumefan',     'lumefan',     'artemether-lumefantrine', 'curated', 40),
  ('Lumefantrine','lumefantrine','artemether-lumefantrine', 'curated', 30),
  ('ACT-AL',      'act-al',      'artemether-lumefantrine', 'curated', 25),

  -- Antibiotics
  ('Augmentin',   'augmentin',   'amoxicillin-clavulanate', 'curated', 95),
  ('Klavox',      'klavox',      'amoxicillin-clavulanate', 'curated', 30),
  ('Amoxil',      'amoxil',      'amoxicillin',             'curated', 70),
  ('Ampiclox',    'ampiclox',    'ampicillin-cloxacillin',  'curated', 80),
  ('Flagyl',      'flagyl',      'metronidazole',           'curated', 90),
  ('Septrin',     'septrin',     'cotrimoxazole',           'curated', 80),
  ('Bactrim',     'bactrim',     'cotrimoxazole',           'curated', 40),
  ('Zithromax',   'zithromax',   'azithromycin',            'curated', 70),
  ('Zithromex',   'zithromex',   'azithromycin',            'curated', 35),
  ('Ciproxin',    'ciproxin',    'ciprofloxacin',           'curated', 65),
  ('Cipro',       'cipro',       'ciprofloxacin',           'curated', 75),
  ('Rocephin',    'rocephin',    'ceftriaxone',             'curated', 55),

  -- Analgesics / antipyretics
  ('Panadol',     'panadol',     'paracetamol',             'curated', 100),
  ('Emzor Paracetamol', 'emzor paracetamol', 'paracetamol', 'curated', 70),
  ('Brufen',      'brufen',      'ibuprofen',               'curated', 90),
  ('Voltaren',    'voltaren',    'diclofenac',              'curated', 80),
  ('Cataflam',    'cataflam',    'diclofenac',              'curated', 50),

  -- Antihypertensives
  ('Norvasc',     'norvasc',     'amlodipine',              'curated', 85),
  ('Amlovas',     'amlovas',     'amlodipine',              'curated', 30),
  ('Cozaar',      'cozaar',      'losartan',                'curated', 70),
  ('Losacar',     'losacar',     'losartan',                'curated', 25),
  ('Lasix',       'lasix',       'furosemide',              'curated', 75),

  -- Diabetes
  ('Glucophage',  'glucophage',  'metformin',               'curated', 85),
  ('Glucovance',  'glucovance',  'metformin-glibenclamide', 'curated', 30),
  ('Diabinese',   'diabinese',   'chlorpropamide',          'curated', 20),

  -- Asthma / respiratory
  ('Ventolin',    'ventolin',    'salbutamol',              'curated', 90),
  ('Asthalin',    'asthalin',    'salbutamol',              'curated', 30),

  -- GI / acid
  ('Omez',        'omez',        'omeprazole',              'curated', 50),
  ('Losec',       'losec',       'omeprazole',              'curated', 30),
  ('Zantac',      'zantac',      'ranitidine',              'curated', 40),
  ('Tagamet',     'tagamet',     'cimetidine',              'curated', 25),

  -- Antifungals
  ('Diflucan',    'diflucan',    'fluconazole',             'curated', 55),

  -- Pediatric staples / ORS
  ('ORS',         'ors',         'oral rehydration salts',  'curated', 95),
  ('Z-Salts',     'z-salts',     'oral rehydration salts',  'curated', 30),

  -- Anti-emetics / GI
  ('Phenergan',   'phenergan',   'promethazine',            'curated', 35),
  ('Maxolon',     'maxolon',     'metoclopramide',          'curated', 30)
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- Seed common, clinically-important interactions (demo-grade).
-- Stored both directions so a single lookup (drug_a) returns all pairs.
-- ---------------------------------------------------------------------------
INSERT INTO ng_drug_interactions
  (drug_a_generic, drug_b_generic, severity, mechanism, effect, management) VALUES
  ('warfarin',     'ibuprofen',     'high',           'NSAID inhibits platelet function; displaces warfarin',
   'Increased bleeding risk', 'Avoid; use paracetamol instead'),
  ('warfarin',     'diclofenac',    'high',           'NSAID; CYP2C9 interaction',
   'Increased bleeding risk', 'Avoid combination'),
  ('warfarin',     'azithromycin',  'moderate',       'May potentiate warfarin effect',
   'Bleeding risk', 'Monitor INR closely'),
  ('warfarin',     'cotrimoxazole', 'high',           'CYP2C9 inhibition',
   'Marked INR increase', 'Avoid; consider alternative antibiotic'),
  ('warfarin',     'metronidazole', 'high',           'CYP2C9 inhibition',
   'Marked INR increase', 'Reduce warfarin or avoid'),
  ('ciprofloxacin','theophylline',  'moderate',       'CYP1A2 inhibition',
   'Increased theophylline levels', 'Monitor theophylline; reduce dose'),
  ('metformin',    'contrast media','high',           'Renal stress + lactic acidosis risk',
   'Lactic acidosis', 'Hold metformin 48h around contrast study'),
  ('paracetamol',  'alcohol',       'moderate',       'Hepatotoxicity potentiated',
   'Liver injury risk', 'Limit alcohol; max 2g paracetamol/24h'),
  ('amlodipine',   'simvastatin',   'moderate',       'CYP3A4 interaction',
   'Increased simvastatin levels (myopathy)', 'Max simvastatin 20 mg with amlodipine'),
  ('losartan',     'potassium',     'moderate',       'Hyperkalemia risk',
   'Elevated serum potassium', 'Monitor K+, avoid K-sparing diuretics together'),
  ('artemether-lumefantrine','quinine','high',        'QT prolongation',
   'Cardiac arrhythmia risk', 'Avoid concurrent use'),
  ('clopidogrel',  'omeprazole',    'moderate',       'CYP2C19 inhibition reduces clopidogrel activation',
   'Reduced antiplatelet effect', 'Use pantoprazole instead'),
  ('ace_inhibitor','spironolactone','high',           'Both retain potassium',
   'Hyperkalemia', 'Monitor K+; avoid in CKD')
ON CONFLICT DO NOTHING;

-- Mirror symmetric pairs
INSERT INTO ng_drug_interactions
  (drug_a_generic, drug_b_generic, severity, mechanism, effect, management)
SELECT drug_b_generic, drug_a_generic, severity, mechanism, effect, management
  FROM ng_drug_interactions
 WHERE drug_b_generic IS NOT NULL
ON CONFLICT DO NOTHING;
