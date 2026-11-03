# Clinical narrative encryption release notes

## Scope

The canonical mini-EHR services now encrypt new follow-up notes, amendment
reasons, allergy inactivation reasons, and medication discontinuation reasons.
Authorized responses retain their existing field names and return the decoded
text. Historical plaintext remains readable only when that field has no
protected representation. New protected values require the complete 128-bit
authentication tag, 96-bit IV, and canonical base64 ciphertext. A partial,
malformed, or unreadable protected representation fails closed rather than
returning stale plaintext. Legacy SOAP decryption compatibility is unchanged.

This does not certify compliance or establish that all clinical database fields
are encrypted. Existing plaintext history, coded diagnoses, clinical profile
fields, separate visit records, and other legacy stores require separate review.
No old rows have been backfilled or deleted by this change.

## Required release ordering

1. Verify a protected database backup and the existing dedicated 64-hex-character
   production `ENCRYPTION_KEY`, including its recovery procedure. Do not replace
   the key as part of this release. No key identifier or rotation/backfill tool is
   introduced here; an unplanned key change makes these new narratives unreadable.
2. Run the full CI checks and the isolated PostgreSQL test suite. In particular,
   verify migration 044 can be applied twice over a copy of existing legacy rows,
   then test authorized reads/writes, rejected reads, corrupted ciphertext, and
   atomic rollback when audit recording fails. Local hermetic tests do not prove
   the deployed database schema or its locks work correctly.
3. Apply additive migration `044_clinical_narrative_encryption` before starting
   the matching application version. It only adds nullable protected columns;
   it does not rewrite any historical record.
4. Coordinate replacement of every mini-EHR writer. Do not run old and new
   writers concurrently: an old writer can edit the obsolete plaintext column
   while the new reader correctly prefers an already-protected value. Use the
   approved maintenance/deployment procedure and verify the intended revision is
   running everywhere before reopening clinical writes.
5. Verify new persisted narratives are ciphertext with complete IV/tag fields,
   old plaintext columns remain null for those new writes, and authorized API
   responses still return their expected content. Use synthetic test accounts,
   not production patient content, for smoke testing.

## Rollback constraints

Leave the additive columns and existing encryption key intact. Before any new
protected narrative is written, application rollback can leave these unused
columns in place. After a protected narrative has been written, reverting to the
old application alone is not safe: old readers do not understand these fields
and can hide newly recorded information. Use a forward fix or a tested rollback
build that retains these compatible readers and writers. Do not drop columns,
clear ciphertext, or run an improvised plaintext backfill. Restore-from-backup is
not a routine application rollback because it can discard subsequent care data.

## Verification for this local change

- Hermetic narrative tests cover encryption, unchanged plaintext history,
  malformed/tampered ciphertext, current-key-only reads, missing/changed keys,
  actual service SQL parameters, explicit clearing of a legacy field, and audit
  rollback behavior.
- Existing optional PostgreSQL encounter/profile tests now cover these fields
  and verify ciphertext storage and fail-closed reads. The new optional migration
  test uses transaction-local temporary tables and retains every old value.
- PostgreSQL tests were not executed locally: no verified isolated
  `SIMULATION_DATABASE_URL` is available. No deployed schema or production data
  has been changed.
