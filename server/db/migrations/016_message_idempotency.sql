-- Idempotent message sending.
--
-- On the intermittent connections described in the FCT PHCB assessment, clients
-- retry after a timeout. Without a client-supplied key, a retry that actually
-- succeeded server-side would create a duplicate clinical message. This lets the
-- client retry safely: the same (sender, client_message_id) is stored once.

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS client_message_id UUID;

CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_sender_client_id
  ON messages (sender_id, client_message_id)
  WHERE client_message_id IS NOT NULL;

-- Stable ordering when two messages share a created_at timestamp.
CREATE INDEX IF NOT EXISTS idx_messages_conversation_created_id
  ON messages (conversation_id, created_at DESC, id DESC);
