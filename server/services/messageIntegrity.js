'use strict';
const { assertMessagingRelationship, sanitizeMessageContent } = require('./messageAuthorization');
const { keysToCamel } = require('../../lib/utils');

// Explicit allowlist: protected storage and internal retry keys never leave the service.
function publicMessage(row, content) {
  return keysToCamel({ id: row.id, conversation_id: row.conversation_id,
    sender_id: row.sender_id, recipient_id: row.recipient_id, content,
    is_urgent: row.is_urgent, has_attachment: row.has_attachment,
    attachment_name: row.attachment_name, attachment_type: row.attachment_type,
    status: row.status, created_at: row.created_at, read_at: row.read_at });
}
function assertSameMessageIntent(row, input, decrypt) {
  const content = decrypt(row.content_encrypted, row.content_iv, row.content_tag);
  if (String(row.recipient_id) !== String(input.recipientId) || content !== input.content ||
      Boolean(row.is_urgent) !== Boolean(input.isUrgent) ||
      Boolean(row.has_attachment) !== Boolean(input.attachmentName) ||
      (row.attachment_name || null) !== (input.attachmentName || null) ||
      (row.attachment_type || null) !== (input.attachmentType || null)) {
    throw Object.assign(new Error('Message retry intent does not match'), { status: 409 });
  }
  return publicMessage(row, content);
}
async function saveAuthorizedMessage({ db, senderId, input, encrypt, decrypt }) {
  const intent = { ...input, recipientId: String(input.recipientId).toLowerCase(), content: sanitizeMessageContent(input.content) };
  if (!intent.content) throw Object.assign(new Error('Message content is required'), { status: 400 });
  return db.transaction(async client => {
    // Account locks are sorted; the actual care-authority row is locked until
    // commit. A concurrent revocation either precedes this check or waits for it.
    const authority = await assertMessagingRelationship(client, senderId, intent.recipientId, { lock: true });
    const lookup = () => client.query('SELECT * FROM messages WHERE sender_id=$1 AND client_message_id=$2 LIMIT 1', [senderId, intent.clientMessageId]);
    const retry = row => ({ ...authority, deduplicated: true, message: assertSameMessageIntent(row, intent, decrypt) });
    if (intent.clientMessageId) {
      const existing = await lookup();
      if (existing.rows.length) return retry(existing.rows[0]);
    }
    const protectedContent = encrypt(intent.content);
    await client.query('SAVEPOINT message_insert');
    let row;
    try {
      const result = await client.query(`INSERT INTO messages
        (conversation_id,sender_id,recipient_id,content_encrypted,content_iv,content_tag,
         is_urgent,has_attachment,attachment_name,attachment_type,client_message_id)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [authority.conversationId,senderId,intent.recipientId,protectedContent.encrypted,protectedContent.iv,protectedContent.tag,
        Boolean(intent.isUrgent),Boolean(intent.attachmentName),intent.attachmentName||null,intent.attachmentType||null,intent.clientMessageId||null]);
      row = result.rows[0];
      await client.query('RELEASE SAVEPOINT message_insert');
    } catch (error) {
      // PostgreSQL aborts a statement-error transaction; restore the savepoint
      // before reading the winner of a concurrent unique-key race.
      await client.query('ROLLBACK TO SAVEPOINT message_insert');
      await client.query('RELEASE SAVEPOINT message_insert');
      if (error.code === '23505' && intent.clientMessageId) {
        const existing = await lookup();
        if (existing.rows.length) return retry(existing.rows[0]);
      }
      throw error;
    }
    return { ...authority, deduplicated: false, message: publicMessage(row, intent.content) };
  });
}
async function markReturnedMessagesRead(db, recipientId, ids) {
  if (!ids.length) return [];
  const result = await db.query(`UPDATE messages SET status='read',read_at=COALESCE(read_at,NOW())
    WHERE id=ANY($1::uuid[]) AND recipient_id=$2 AND NOT is_deleted_recipient
      AND status!='read' RETURNING id,status,read_at`, [ids, recipientId]);
  return result.rows;
}
module.exports = { assertSameMessageIntent, publicMessage, saveAuthorizedMessage, markReturnedMessagesRead };
