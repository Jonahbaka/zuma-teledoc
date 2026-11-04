'use strict';
// Local, synchronous metadata hooks only. Observability is never a media or
// authorization dependency. Do not leak raw callback errors into an export.
function createLocalObservation(callback) {
  let status = callback === undefined ? 'disabled' : typeof callback === 'function' ? 'observing' : 'incomplete';
  let emitting = false;
  return Object.freeze({
    emit(type) {
      if (status !== 'observing') return;
      if (emitting) { status = 'incomplete'; return; }
      emitting = true;
      try {
        const result = callback(type);
        if (result && typeof result.then === 'function') {
          status = 'incomplete'; Promise.resolve(result).catch(() => {});
        }
      } catch { status = 'incomplete'; }
      finally { emitting = false; }
    },
    status: () => status,
  });
}
module.exports = { createLocalObservation };
