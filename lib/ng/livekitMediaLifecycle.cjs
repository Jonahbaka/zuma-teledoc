'use strict';

async function disposeMediaRoom(room) {
  if (!room) return;
  // A permission prompt can resolve after disconnect. Stop any newly published
  // tracks as well as asking the SDK to release its transport and local tracks.
  room.removeAllListeners?.();
  for (const publication of room.localParticipant?.trackPublications?.values?.() || []) {
    try { publication.track?.stop(); } catch {}
  }
  try { await room.disconnect(true); } catch {}
}

function connectionQuality(value) {
  return ['excellent', 'good', 'poor', 'lost'].includes(value) ? value : 'unknown';
}

function createMediaSessionController() {
  let generation = 0;
  let active = null;
  let busy = false;
  const current = (ticket, room) => ticket === generation && (!room || room === active);

  return {
    get room() { return active; },
    current,
    async close() {
      generation += 1;
      const previous = active;
      active = null;
      busy = false;
      await disposeMediaRoom(previous);
    },
    async connect({ getToken, createRoom, onRoom }) {
      const ticket = ++generation;
      const previous = active;
      active = null;
      busy = false;
      await disposeMediaRoom(previous);
      if (!current(ticket)) return null;
      let room;
      try {
        const token = await getToken();
        if (!current(ticket)) return null;
        room = createRoom();
        active = room;
        const isCurrent = () => current(ticket, room);
        onRoom(room, token, isCurrent);
        await room.connect(token.livekitUrl, token.token, { autoSubscribe: true });
        if (!isCurrent()) {
          await disposeMediaRoom(room);
          return null;
        }
        // Joining never starts capture. Each device requires an explicit action.
        return room;
      } catch (error) {
        const failedCurrent = current(ticket);
        if (active === room) active = null;
        await disposeMediaRoom(room);
        if (failedCurrent && current(ticket)) throw error;
        return null;
      }
    },
    async act(action, onSuccess, onError) {
      const room = active;
      const ticket = generation;
      if (!room || room.state !== 'connected' || busy) return false;
      busy = true;
      try {
        await action(room);
        if (!current(ticket, room)) {
          await disposeMediaRoom(room);
          return false;
        }
        onSuccess?.(room);
        return true;
      } catch (error) {
        if (current(ticket, room)) onError?.(error);
        else await disposeMediaRoom(room);
        return false;
      } finally {
        if (current(ticket, room)) busy = false;
      }
    },
  };
}

module.exports = { connectionQuality, createMediaSessionController, disposeMediaRoom };
