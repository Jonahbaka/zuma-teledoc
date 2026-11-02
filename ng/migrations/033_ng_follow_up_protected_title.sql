-- Follow-up service writes protected title material and deliberately leaves the
-- legacy plaintext column NULL. Preserve old rows without decrypting/backfilling
-- clinical content, while requiring a title in one supported representation.
ALTER TABLE ng_follow_up_tasks ALTER COLUMN title DROP NOT NULL;
ALTER TABLE ng_follow_up_tasks
  ADD CONSTRAINT ng_follow_up_title_required CHECK (
    title IS NOT NULL OR (
      title_encrypted IS NOT NULL AND length(title_encrypted) > 0
      AND title_iv IS NOT NULL AND length(title_iv) > 0
      AND title_tag IS NOT NULL AND length(title_tag) > 0
    )
  );
