'use strict';
// Requires an explicitly supplied server WebSocket constructor. No socket or
// credential is allocated by importing this module.
function createOpenAiLiveSideband({ createSocket }) {
  if (typeof createSocket !== 'function') throw new Error('A server socket adapter is required.');
  return async function attach({ url, credentialProvider, onEvent }) {
    if (!/^wss:\/\/api\.openai\.com\/v1\/live\/sessions\/[A-Za-z0-9_-]{1,200}\/attach$/.test(url)) throw new Error('Unapproved sideband URL.');
    const credential = await credentialProvider();
    if (!credential) throw new Error('A server credential is required.');
    return new Promise((resolve, reject) => {
      const socket = createSocket(url, { headers: { Authorization: `Bearer ${credential}` }, maxPayload: 16384 });
      let opened = false, closed = false, finalEvent = null, finalWait = null, finalPromise = null, finishTimeout;
      const timeout = setTimeout(() => { close(); reject(new Error('Sideband attach timed out.')); }, 10000); timeout.unref?.();
      function close() {
        if (closed) return; closed = true; clearTimeout(timeout); clearTimeout(finishTimeout);
        finalWait?.reject(new Error('Final session close was not confirmed.')); finalWait = null; socket.close();
      }
      function finish() {
        if (finalEvent) return Promise.resolve(finalEvent);
        if (closed) return Promise.reject(new Error('Sideband is closed.'));
        if (finalPromise) return finalPromise;
        finalPromise = new Promise((done, failed) => {
          finalWait = { resolve: done, reject: failed };
          finishTimeout = setTimeout(() => { close(); }, 15000); finishTimeout.unref?.();
          try { socket.send(JSON.stringify({ type: 'session.close' })); } catch { close(); }
        });
        return finalPromise;
      }
      socket.on('open', () => { if (closed) return; opened = true; clearTimeout(timeout); resolve({ close, finish, isClosed: () => closed }); });
      socket.on('message', raw => {
        if (closed || raw.length > 16384) return;
        let event; try { event = JSON.parse(String(raw)); } catch { return; }
        if (!event || typeof event !== 'object' || typeof event.type !== 'string') return;
        if (event.type === 'session.closed') {
          finalEvent = { closed: true }; clearTimeout(finishTimeout); finalWait?.resolve(finalEvent); finalWait = null;
        }
        onEvent(event);
      });
      socket.on('error', () => { if (closed) return; close(); if (!opened) reject(new Error('Sideband attach failed.')); else onEvent({ type: 'error' }); });
      socket.on('close', () => { if (closed) return; close(); if (!opened) reject(new Error('Sideband closed before attach.')); else if (!finalEvent) onEvent({ type: 'error' }); });
    });
  };
}
module.exports = { createOpenAiLiveSideband };
