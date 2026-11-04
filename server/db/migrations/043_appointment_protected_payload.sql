-- Preparation only. No existing records are rewritten, no key is read, and no
-- writer is activated. Readers/writers must be converted together before use.
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS protected_payload JSONB
  CHECK (protected_payload IS NULL OR (
    jsonb_typeof(protected_payload) = 'object'
    AND protected_payload ?& ARRAY['version','encrypted','iv','tag']
    AND protected_payload->'version' = '1'::jsonb
    AND jsonb_typeof(protected_payload->'encrypted') = 'string'
    AND jsonb_typeof(protected_payload->'iv') = 'string'
    AND jsonb_typeof(protected_payload->'tag') = 'string'
  ));
