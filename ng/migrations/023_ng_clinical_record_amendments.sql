-- Nigeria clinical record integrity: encounter sign-off, append-only note
-- amendments, and append-only referral status history.
--
-- Existing schema (017/021) already permits encounter status 'signed' and
-- carries ng_soap_notes.signed_at / provider_attestation, but nothing wrote
-- them, and a note could be appended to another clinician's encounter. This
-- migration adds the storage required to sign an encounter, to amend a signed
-- note without overwriting it, and to keep every referral status change.

ALTER TABLE ng_soap_notes
  ADD COLUMN IF NOT EXISTS amends_note_id UUID REFERENCES ng_soap_notes(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS amendment_reason TEXT,
  ADD COLUMN IF NOT EXISTS is_current BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS content_hash CHAR(64);

CREATE INDEX IF NOT EXISTS idx_ng_soap_notes_amendments
  ON ng_soap_notes (encounter_id, is_current, created_at DESC);

CREATE TABLE IF NOT EXISTS ng_clinical_record_amendments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  encounter_id UUID NOT NULL REFERENCES ng_clinical_encounters(id) ON DELETE CASCADE,
  record_type TEXT NOT NULL CHECK (record_type IN ('soap_note','diagnosis','clinical_document','encounter_summary')),
  original_record_id UUID NOT NULL,
  amendment_record_id UUID REFERENCES ng_soap_notes(id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  reason_code TEXT,
  author_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  author_provider_id UUID,
  covering_user_id UUID REFERENCES users(id) ON DELETE RESTRICT,
  original_snapshot JSONB NOT NULL DEFAULT '{}'::JSONB,
  original_content_hash CHAR(64) NOT NULL,
  amended_content_hash CHAR(64),
  status TEXT NOT NULL DEFAULT 'recorded' CHECK (status IN ('recorded','withdrawn')),
  metadata_json JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ng_record_amendments_encounter
  ON ng_clinical_record_amendments (encounter_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ng_record_amendments_author
  ON ng_clinical_record_amendments (author_user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS ng_referral_status_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  referral_id UUID NOT NULL REFERENCES ng_referrals(id) ON DELETE CASCADE,
  from_status TEXT,
  to_status TEXT NOT NULL,
  reason TEXT,
  actor_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  actor_role TEXT,
  ip_address INET,
  user_agent TEXT,
  metadata_json JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ng_referral_status_events_referral
  ON ng_referral_status_events (referral_id, created_at ASC);
