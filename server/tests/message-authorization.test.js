const assert = require('node:assert/strict');
const test = require('node:test');

const {
  assertMessagingRelationship,
  getConversationId,
  sanitizeMessageContent
} = require('../services/messageAuthorization');
const { authorizeRealtimeConversation } = require('../services/socketService');

const patient = { id: '00000000-0000-4000-8000-000000000001', role: 'patient', is_active: true, market_scope: 'US' };
const provider = { id: '00000000-0000-4000-8000-000000000002', role: 'provider', is_active: true, market_scope: 'US' };
const otherProvider = { id: '00000000-0000-4000-8000-000000000003', role: 'provider', is_active: true, market_scope: 'US' };
const ngProvider = { id: '00000000-0000-4000-8000-000000000004', role: 'provider', is_active: true, market_scope: 'NG' };

function fakeDb(users, relationshipRows = []) {
  return {
    async query(sql) {
      if (sql.includes('FROM users')) return { rows: users };
      return { rows: relationshipRows };
    }
  };
}

test('conversation IDs are stable regardless of account order', () => {
  assert.equal(
    getConversationId(patient.id, provider.id),
    getConversationId(provider.id, patient.id)
  );
});

test('patient/provider messaging requires a clinical relationship', async () => {
  await assert.rejects(
    assertMessagingRelationship(fakeDb([patient, provider]), patient.id, provider.id),
    (error) => error.status === 403 && error.code === 'MESSAGING_RELATIONSHIP_FORBIDDEN'
  );

  const result = await assertMessagingRelationship(
    fakeDb([patient, provider], [{ '?column?': 1 }]),
    patient.id,
    provider.id
  );
  assert.equal(result.conversationId, getConversationId(patient.id, provider.id));
});

test('provider collaboration is restricted to the same market', async () => {
  await assertMessagingRelationship(fakeDb([provider, otherProvider]), provider.id, otherProvider.id);
  await assert.rejects(
    assertMessagingRelationship(fakeDb([provider, ngProvider]), provider.id, ngProvider.id),
    /Cross-market conversations/
  );
});

test('message sanitization preserves clinical formatting and removes control bytes', () => {
  assert.equal(
    sanitizeMessageContent('  BP 120/80\u0000\nFollow up\tFriday\u0007  '),
    'BP 120/80\nFollow up\tFriday'
  );
});

test('realtime room authorization rejects a modified conversation identifier', async () => {
  const socket = { userId: patient.id };
  await assert.rejects(
    authorizeRealtimeConversation(
      socket,
      { recipientId: provider.id, conversationId: '00000000-0000-4000-8000-000000000099' },
      fakeDb([patient, provider], [{ '?column?': 1 }])
    ),
    (error) => error.status === 403 && /identifier/.test(error.message)
  );
});

test('realtime room authorization returns only the server-derived room identifier', async () => {
  const result = await authorizeRealtimeConversation(
    { userId: patient.id },
    { recipientId: provider.id },
    fakeDb([patient, provider], [{ '?column?': 1 }])
  );
  assert.equal(result.conversationId, getConversationId(patient.id, provider.id));
});
