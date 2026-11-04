'use strict';

// In-process execution admission only. This is not a distributed lock, durable
// queue lease, database fence, or proof that the whole application is quiescent.
function createWorkAdmissionBarrier() {
  let closed = false;
  let failedCount = 0;
  const active = new Set();
  const idleListeners = new Set();
  function snapshot() { return Object.freeze({ admissionClosed: closed, activeCount: active.size, failedCount, idle: active.size === 0 }); }
  function closeAdmission() { closed = true; return snapshot(); }
  function run(work) {
    if (closed) return Promise.reject(Object.assign(new Error('Worker execution admission is closed.'), { code: 'WORKER_ADMISSION_CLOSED', status: 503 }));
    if (typeof work !== 'function') return Promise.reject(new TypeError('Work must be a function.'));
    // Register synchronously, including work whose first database acquire is
    // still pending. A drain in the same turn must see the accepted operation.
    const operation = Promise.resolve().then(work);
    active.add(operation);
    const settle = () => {
      active.delete(operation);
      if (!active.size) for (const listener of [...idleListeners]) listener();
    };
    operation.then(settle, () => { failedCount += 1; settle(); });
    return operation;
  }
  function drain({ timeoutMs = 10000 } = {}) {
    closeAdmission();
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000) {
      return Promise.reject(new RangeError('Drain timeout must be an integer from 1 to 30000 milliseconds.'));
    }
    const result = () => Object.freeze({ ...snapshot(), drained: active.size === 0 && failedCount === 0,
      reason: active.size ? 'DRAIN_TIMEOUT' : failedCount ? 'WORK_SETTLEMENT_FAILED' : null,
      scope: 'in_process_execution_only', processFenced: false });
    if (!active.size) return Promise.resolve(result());
    return new Promise(resolve => {
      let timer;
      const finish = () => {
        idleListeners.delete(onIdle);
        clearTimeout(timer);
        resolve(result());
      };
      const onIdle = () => finish();
      idleListeners.add(onIdle);
      // Keep this timer referenced: an awaited drain cannot silently disappear
      // when no other handle happens to keep the process alive.
      timer = setTimeout(finish, timeoutMs);
    });
  }
  return Object.freeze({ run, drain, closeAdmission, snapshot });
}
module.exports = { createWorkAdmissionBarrier };
