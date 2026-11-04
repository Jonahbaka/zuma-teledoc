'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { createMessageSchema } = require('../../lib/validation');

const ROOT = path.join(__dirname, '..', '..');
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8');

const VALID_UUID = '3f6b1f0e-6a1c-4f4a-9f2e-0b6f1d2c3a44';

test('a message may carry a client key for safe retries, and it must be a UUID', () => {
  const parsed = createMessageSchema.parse({
    recipientId: VALID_UUID,
    content: 'Patient is ready for the consultation.',
    clientMessageId: VALID_UUID,
  });
  assert.equal(parsed.clientMessageId, VALID_UUID);

  assert.throws(() => createMessageSchema.parse({
    recipientId: VALID_UUID, content: 'hello', clientMessageId: 'not-a-uuid',
  }));

  const withoutKey = createMessageSchema.parse({ recipientId: VALID_UUID, content: 'hello' });
  assert.equal(withoutKey.clientMessageId, undefined, 'the key stays optional');
});

test('the client key is optional, so older clients keep working', () => {
  const parsed = createMessageSchema.parse({ recipientId: VALID_UUID, content: 'legacy client' });
  assert.equal(parsed.recipientId, VALID_UUID);
  assert.equal(parsed.isUrgent, false);
});

test('the send path deduplicates on the client key instead of inserting twice', () => {
  const source = read('server/routes/messages.js');
  assert.match(source, /client_message_id/, 'the insert persists the client key');
  assert.match(
    source,
    /SELECT id, conversation_id[\s\S]{0,400}client_message_id/,
    'a retry looks the message up before inserting'
  );
  assert.match(source, /deduplicated:\s*true/, 'a deduplicated retry is reported, not silently accepted');
  assert.match(source, /dbError\.code === '23505'/, 'a concurrent duplicate insert is recovered');
});

test('the database enforces one stored message per client key', () => {
  const migration = read('server/db/migrations/016_message_idempotency.sql');
  assert.match(migration, /client_message_id UUID/);
  assert.match(
    migration,
    /CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_sender_client_id[\s\S]*ON messages \(sender_id, client_message_id\)/i
  );
  assert.match(migration, /WHERE client_message_id IS NOT NULL/);
});

test('message ordering has a stable tie-break so equal timestamps cannot shuffle', () => {
  const source = read('server/routes/messages.js');
  assert.match(source, /ORDER BY conversation_id, created_at DESC, id DESC/);
  assert.match(source, /ORDER BY m\.created_at DESC, m\.id DESC/);
  assert.doesNotMatch(source, /ORDER BY m\.created_at DESC\s*`/, 'no unbounded timestamp-only ordering remains');
});
