'use strict';
const { createHash } = require('node:crypto');
// A correlation label only, never a bearer token or authorization grant. The
// browser compares HTTP and WebSocket identities before asking for its mic.
function publicVoiceSessionIdentity(actor) {
  const context = actor?.voiceAuth;
  if (typeof actor?.id !== 'string' || context?.userId !== actor.id || typeof context.familyId !== 'string'
    || !Number.isSafeInteger(context.credentialVersion) || !Number.isSafeInteger(context.expiresAt)) throw new Error('Verified voice identity required.');
  const sessionBinding = createHash('sha256').update(JSON.stringify(['voice-session-correlation-v1', actor.id, context.familyId, context.credentialVersion, context.expiresAt])).digest('hex');
  return Object.freeze({ actorId: actor.id, sessionBinding });
}
module.exports = { publicVoiceSessionIdentity };
