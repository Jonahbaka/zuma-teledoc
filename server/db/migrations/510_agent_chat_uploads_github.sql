-- =========================================================================
-- Migration 510: Agent Chat Uploads + GitHub Integration Support
-- PROJECT GENESIS — Operator uploads for agent analysis
-- =========================================================================

-- Uploaded files stored on disk with DB metadata + extracted text (when possible).
CREATE TABLE IF NOT EXISTS ai_uploaded_files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  uploader_id UUID, -- operator/admin user id
  original_name TEXT NOT NULL,
  stored_name TEXT NOT NULL,
  mime_type VARCHAR(200) NOT NULL,
  size_bytes BIGINT NOT NULL DEFAULT 0,
  sha256 VARCHAR(64) NOT NULL,
  storage_path TEXT NOT NULL,
  extracted_text TEXT,
  extraction_status VARCHAR(30) DEFAULT 'pending' CHECK (extraction_status IN ('pending', 'extracted', 'skipped', 'failed')),
  extraction_error TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_uploaded_files_created ON ai_uploaded_files(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_uploaded_files_sha ON ai_uploaded_files(sha256);

-- Optional link table (many uploads can be attached to many chat messages).
CREATE TABLE IF NOT EXISTS ai_chat_message_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id UUID NOT NULL REFERENCES ai_chat_messages(id) ON DELETE CASCADE,
  file_id UUID NOT NULL REFERENCES ai_uploaded_files(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (message_id, file_id)
);

CREATE INDEX IF NOT EXISTS idx_chat_attachments_message ON ai_chat_message_attachments(message_id);
CREATE INDEX IF NOT EXISTS idx_chat_attachments_file ON ai_chat_message_attachments(file_id);

