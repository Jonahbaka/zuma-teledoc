'use strict';
// Only in-process upgrade owners can claim these records. Headers and frames
// cannot exempt a socket from cleanup. Every exemption has its own hard timer.
const owners = new WeakMap();
const terminalError = () => {};
function claimBoundedUpgrade(request, socket, timeoutMs) {
  if (!request || !socket || !Number.isSafeInteger(timeoutMs) || timeoutMs < 20 || timeoutMs > 5000 || owners.has(request)) throw new Error('Invalid bounded upgrade owner.');
  const record = { socket, expiresAt: Date.now() + timeoutMs };
  owners.set(request, record);
  const timer = setTimeout(() => { if (owners.get(request) === record) { owners.delete(request); socket.on('error', terminalError); socket.destroy(); } }, timeoutMs);
  timer.unref?.();
  return () => { clearTimeout(timer); if (owners.get(request) === record) owners.delete(request); };
}
// Companion to Engine.IO destroyUpgrade:false. Preserve its ordinary one-second
// unknown-upgrade cleanup while allowing a separately bounded authenticated
// owner to finish admission. Socket.IO's own path is still owned by Engine.IO.
function installBoundedUpgradeCleanup(httpServer, socketIoPath = '/socket.io/') {
  const pending = new Set();
  function upgrade(request, socket) {
    if ((request.url || '').slice(0, socketIoPath.length) === socketIoPath) return;
    const timer = setTimeout(() => {
      pending.delete(timer);
      const owner = owners.get(request);
      if (owner?.socket === socket && owner.expiresAt > Date.now()) return;
      if (socket.writable && socket.bytesWritten <= 0) { socket.on('error', terminalError); socket.end(); }
    }, 1000);
    timer.unref?.(); pending.add(timer);
  }
  function close() { httpServer.off('upgrade', upgrade); for (const timer of pending) clearTimeout(timer); pending.clear(); }
  httpServer.on('upgrade', upgrade); httpServer.once('close', close);
  return close;
}
module.exports = { claimBoundedUpgrade, installBoundedUpgradeCleanup };
