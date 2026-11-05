'use strict';

function stopPreviewStream(stream) {
  for (const track of stream?.getTracks?.() || []) {
    try { track.stop(); } catch {}
  }
}

// Owns local-only preflight captures. A late browser permission response must
// never reactivate a preview after Stop, joining the room, or unmounting.
function createLocalMediaPreview() {
  const generations = { camera: 0, microphone: 0 };
  const streams = {};
  const pending = {};
  const stop = (kind) => {
    generations[kind] += 1;
    pending[kind] = false;
    stopPreviewStream(streams[kind]);
    delete streams[kind];
  };
  return {
    stop,
    close() { stop('camera'); stop('microphone'); },
    async start(kind, getUserMedia) {
      if (pending[kind] || streams[kind]) return null;
      const ticket = ++generations[kind];
      pending[kind] = true;
      try {
        const stream = await getUserMedia(kind === 'camera' ? { video: true, audio: false } : { video: false, audio: true });
        if (generations[kind] !== ticket) {
          stopPreviewStream(stream);
          return null;
        }
        streams[kind] = stream;
        return stream;
      } catch (error) {
        if (generations[kind] === ticket) throw error;
        return null;
      } finally {
        if (generations[kind] === ticket) pending[kind] = false;
      }
    },
  };
}

module.exports = { createLocalMediaPreview };
