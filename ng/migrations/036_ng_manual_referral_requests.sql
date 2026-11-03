-- Separate manual clinician request identity; no clinical narrative is copied.
-- Existing programme idempotency and historical rows are unchanged.
ALTER TABLE ng_referrals ADD COLUMN IF NOT EXISTS manual_request_key UUID;
CREATE UNIQUE INDEX IF NOT EXISTS uq_ng_manual_referral_request
  ON ng_referrals (provider_user_id, manual_request_key)
  WHERE manual_request_key IS NOT NULL;
