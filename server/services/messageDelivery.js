'use strict';

async function deliverClinicalMessage({ sockets, conversationId, recipientId, message, authorize }) {
  const senderId = message.senderId;
  if (!senderId || !recipientId || senderId === recipientId) return { queued: 0 };
  let queued = 0;
  await Promise.all(Array.from(sockets).filter(socket => [senderId, recipientId].includes(socket.userId)).map(async socket => {
    try {
      if (socket.connected === false || !await socket.authorizeDelivery?.()) return;
      // Refresh may have waited; recheck care scope after it, not merely at
      // historical room join. Never fan PHI out to cached conversation rooms.
      const authority = await authorize(senderId, recipientId);
      if (authority.conversationId !== conversationId || socket.connected === false) return;
      socket.emit('message:new', { ...message, sentByMe: socket.userId === senderId });
      if (socket.userId === recipientId) socket.emit('notification:message', {
        conversationId, messageId: message.id, senderName: message.senderName,
        preview: message.content?.substring(0, 50) || 'New message'
      });
      queued += 1;
    } catch (_) { /* Saved message remains readable through authorized HTTP. */ }
  }));
  return { queued }; // Local emit attempts, not receipt/read confirmation.
}

module.exports = { deliverClinicalMessage };
