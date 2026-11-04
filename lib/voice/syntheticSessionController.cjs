'use strict';

// Transport is injected; the controller never captures microphones, plays a
// fallback language, stores transcripts, or opens a model-provider connection.
function createSyntheticSessionController({ request, onChange = () => {}, onError = () => {} }) {
  let generation = 0;
  let current = null;
  let busy = false;
  let disposed = false;
  const pending = new Set();
  function emit() { if (!disposed) onChange(current, busy); }
  async function send(path, body, { signal } = {}) {
    return request(path, body, { signal });
  }
  // Unload delivery through the shared authenticated client is best-effort.
  // The server's independent ten-minute TTL is the cleanup backstop.
  function terminal(session, action = 'end') {
    if (!session) return Promise.resolve();
    return send(`/sessions/${session.id}/commands`, { action, epoch: session.epoch, expectedRevision: session.revision });
  }
  async function start(language, noticeVersion) {
    if (disposed || busy || current) return;
    const captured = ++generation; busy = true; emit();
    // Do not abort create: if the server created it, consume its id and close it
    // when the view is disposed rather than leak an unknown session until TTL.
    try {
      const { session } = await send('/sessions', { language, consent: { noticeVersion, processing: true, syntheticOnly: true } });
      if (disposed || captured !== generation) { await terminal(session); return; }
      current = session;
    } catch (error) { if (!disposed && captured === generation) onError(error); }
    finally { if (captured === generation) { busy = false; emit(); } }
  }
  async function command(action, extra = {}) {
    if (disposed || busy || !current) return;
    const captured = generation;
    const controller = new AbortController(); pending.add(controller);
    busy = true; emit();
    try {
      const { session } = await send(`/sessions/${current.id}/commands`, { action, expectedRevision: current.revision, epoch: current.epoch, ...extra }, { signal: controller.signal });
      if (!disposed && captured === generation) current = session;
    } catch (error) {
      if (!disposed && captured === generation && error.name !== 'AbortError') {
        // Never blindly retry a possibly executed mutation. Reconcile by read.
        try {
          const result = await send(`/sessions/${current.id}`, undefined, { signal: controller.signal });
          if (!disposed && captured === generation) current = result.session;
        } catch { if (!disposed && captured === generation) current = null; }
        if (!disposed && captured === generation) onError(error);
      }
    } finally { pending.delete(controller); if (captured === generation) { busy = false; emit(); } }
  }
  async function end(action = 'end') {
    const session = current;
    generation++; current = null; busy = false;
    for (const controller of pending) controller.abort(); pending.clear(); emit();
    try { await terminal(session, action); }
    catch (error) { if (!disposed) onError(error); }
  }
  function dispose() { disposed = true; return end(); }
  return { start, command, end, dispose, getSnapshot: () => ({ session: current, busy }) };
}
module.exports = { createSyntheticSessionController };
