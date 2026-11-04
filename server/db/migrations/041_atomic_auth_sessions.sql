-- Additive session-family lineage for rotation/logout and credential epochs.
-- Existing access tokens (without an epoch) remain epoch 0 until expiry or a
-- password change. Existing refresh tokens each start a distinct family.
ALTER TABLE users ADD COLUMN IF NOT EXISTS credential_version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE refresh_tokens ADD COLUMN IF NOT EXISTS family_id UUID NOT NULL DEFAULT uuid_generate_v4();
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user_family ON refresh_tokens(user_id,family_id);
