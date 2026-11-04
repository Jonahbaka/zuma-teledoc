'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createWorkAdmissionBarrier } = require('../utils/workAdmissionBarrier');
const { backgroundWorkAllowed } = require('../utils/backgroundWorkPolicy');
const root = path.resolve(__dirname, '../..');
const turn = () => new Promise(resolve => setImmediate(resolve));
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }

function runtimeHarness({ env = {}, immutable = false, hook = async () => {}, toolError = false, finalError = false, claimError = false, rollbackError = false, noTask = false, dbOverride } = {}) {
  const trace = [], timers = [], releases = [];
  const task = { id: 'fictional-task', selected_agent_id: 'growth_partnership', input: {}, requested_by: 'fictional-user' };
  const db = {
    async getClient() {
      trace.push('acquire'); await hook('acquire');
      return {
        async query(sql) {
          const kind = sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK' ? sql : sql.includes('FOR UPDATE SKIP LOCKED') ? 'claim-select' : 'claim-update';
          trace.push(kind); await hook(kind);
          if (kind === 'claim-select' && claimError) throw new Error('Synthetic claim failure');
          if (kind === 'ROLLBACK' && rollbackError) throw new Error('Synthetic rollback failure');
          return { rows: ['claim-select', 'claim-update'].includes(kind) && !noTask ? [task] : [] };
        },
        release(discard) { trace.push('release'); releases.push(discard); },
      };
    },
    async query(sql) {
      const kind = sql.includes('INSERT INTO ai_operational_agent_tool_calls') ? 'tool-log' : sql.includes("SET status = 'failed'") ? 'failure-status' : 'final-status';
      trace.push(kind); await hook(kind);
      if (finalError && ['final-status', 'failure-status'].includes(kind)) throw new Error('Synthetic persistence failure');
      return { rows: [{ ...task, status: kind === 'failure-status' ? 'failed' : 'completed' }] };
    },
  };
  const isolated = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'server/services/agent-runtime/runtime.js'), 'utf8'), {
    module: isolated, process: { env },
    setInterval(callback, milliseconds) { const timer = { callback, milliseconds, cleared: false, unref() {} }; timers.push(timer); return timer; },
    clearInterval(timer) { timer.cleared = true; },
    require(name) {
      if (name === '../../db') return dbOverride || db;
      if (name === '../../utils/backgroundWorkPolicy') return { backgroundWorkAllowed: () => backgroundWorkAllowed(env) };
      if (name === '../../utils/runtimeStatePolicy') return { immutableRuntime: () => immutable };
      if (name === '../../utils/workAdmissionBarrier') return { createWorkAdmissionBarrier };
      if (name === './agentRegistry') return { AGENT_REGISTRY: [], getAgentById: () => ({ id: 'growth_partnership', allowedTools: ['draftPartnershipMessage'] }) };
      if (name === './toolRegistry') return { listTools: () => [], getTool: () => async () => { trace.push('tool'); await hook('tool'); if (toolError) throw new Error('Synthetic tool failure'); return { draft: 'Fictional local test only' }; } };
      assert.fail('Unexpected import: ' + name);
    },
  });
  return { runtime: isolated.exports, trace, timers, releases, env };
}

test('admission tracks work synchronously, drains every accepted operation and never reopens', async () => {
  const barrier = createWorkAdmissionBarrier(); const one = deferred(), two = deferred();
  const a = barrier.run(() => one.promise), b = barrier.run(() => two.promise);
  assert.equal(barrier.snapshot().activeCount, 2);
  const draining = barrier.drain({ timeoutMs: 1000 });
  await assert.rejects(barrier.run(() => assert.fail('No new work')), { code: 'WORKER_ADMISSION_CLOSED' });
  one.resolve(); await a; await turn(); assert.equal(barrier.snapshot().activeCount, 1);
  two.resolve(); await b; const result = await draining;
  assert.equal(result.drained, true); assert.equal(result.processFenced, false); assert.equal(result.activeCount, 0);
  await assert.rejects(barrier.run(() => {}), { code: 'WORKER_ADMISSION_CLOSED' });
});

for (const stage of ['acquire', 'claim-select', 'COMMIT', 'tool', 'tool-log', 'final-status']) {
  test('real runtime drain waits through ' + stage + ' and final task persistence', async () => {
    const wait = deferred(), entered = deferred(); let paused = false;
    const h = runtimeHarness({ hook: async kind => { if (kind === stage && !paused) { paused = true; entered.resolve(); await wait.promise; } } });
    const running = h.runtime.runNextTask('fictional-task');
    assert.equal(h.runtime.getWorkerState().activeCount, 1);
    await entered.promise;
    let settled = false; const drain = h.runtime.drainAgentWorker({ timeoutMs: 1000 }).then(value => { settled = true; return value; });
    await turn(); assert.equal(settled, false);
    await assert.rejects(h.runtime.runNextTask(), { code: 'WORKER_ADMISSION_CLOSED' });
    assert.equal(h.runtime.startAgentWorker().running, false);
    wait.resolve(); assert.equal((await running).status, 'completed');
    const result = await drain; assert.equal(result.drained, true); assert.equal(result.activeCount, 0);
    assert.equal(h.trace.at(-1), 'final-status'); assert.deepEqual(h.releases, [false]);
  });
}

test('timeout reports incomplete, retains fencing and does not cancel late task completion', async () => {
  const pending = deferred(), entered = deferred();
  const h = runtimeHarness({ hook: async stage => { if (stage === 'tool') { entered.resolve(); await pending.promise; } } });
  const task = h.runtime.runNextTask(); await entered.promise;
  const result = await h.runtime.drainAgentWorker({ timeoutMs: 5 });
  assert.equal(result.drained, false); assert.equal(result.reason, 'DRAIN_TIMEOUT'); assert.equal(result.activeCount, 1);
  assert.equal(h.trace.includes('final-status'), false);
  await assert.rejects(h.runtime.runNextTask(), { code: 'WORKER_ADMISSION_CLOSED' });
  pending.resolve(); await task;
  assert.equal((await h.runtime.drainAgentWorker()).drained, true);
  assert.equal(h.runtime.getWorkerState().admissionClosed, true);
});

test('recorded task failure waits for failure-status persistence; unknown settlement stays incomplete', async () => {
  const wait = deferred(), entered = deferred();
  const recorded = runtimeHarness({ toolError: true, hook: async stage => { if (stage === 'failure-status') { entered.resolve(); await wait.promise; } } });
  const run = recorded.runtime.runNextTask(); await entered.promise;
  const draining = recorded.runtime.drainAgentWorker({ timeoutMs: 1000 });
  assert.equal(recorded.runtime.getWorkerState().activeCount, 1);
  wait.resolve(); assert.equal((await run).status, 'failed'); assert.equal((await draining).drained, true);
  const unknown = runtimeHarness({ finalError: true });
  await assert.rejects(unknown.runtime.runNextTask(), /persistence failure/);
  const result = await unknown.runtime.drainAgentWorker();
  assert.equal(result.drained, false); assert.equal(result.reason, 'WORK_SETTLEMENT_FAILED'); assert.equal(result.failedCount, 1);
  assert.equal(result.activeCount, 0); assert.equal(unknown.runtime.startAgentWorker().running, false);
});

for (const rollbackError of [false, true]) test('claim failure discards client and never certifies settlement (rollback fails: ' + rollbackError + ')', async () => {
  const h = runtimeHarness({ claimError: true, rollbackError });
  await assert.rejects(h.runtime.runNextTask(), /claim failure/);
  assert.deepEqual(h.trace, ['acquire', 'BEGIN', 'claim-select', 'ROLLBACK', 'release']);
  assert.deepEqual(h.releases, [true]);
  assert.equal((await h.runtime.drainAgentWorker()).reason, 'WORK_SETTLEMENT_FAILED');
});

test('stopped and replaced timer callbacks cannot poll, while ordinary pause remains distinct from drain', async () => {
  const h = runtimeHarness({ noTask: true });
  h.runtime.startAgentWorker(); const old = h.timers[0];
  const stopped = h.runtime.stopAgentWorker(); assert.equal(stopped.running, false); assert.equal(stopped.admissionClosed, false);
  await old.callback(); assert.deepEqual(h.trace, []);
  h.runtime.startAgentWorker(); await old.callback(); assert.deepEqual(h.trace, []);
  await h.timers[1].callback(); assert.ok(h.trace.includes('claim-select'));
  const count = h.trace.length;
  await h.runtime.drainAgentWorker();
  await h.timers[1].callback(); assert.equal(h.trace.length, count); assert.equal(h.timers[1].cleared, true);
});

test('manual runs are tracked alongside polling; returned state cannot reopen worker admission', async () => {
  const wait = deferred(), entered = deferred();
  const h = runtimeHarness({ hook: async stage => { if (stage === 'tool') { entered.resolve(); await wait.promise; } } });
  h.runtime.startAgentWorker(); const poll = h.timers[0].callback(); await entered.promise;
  const manual = h.runtime.runNextTask('other'); await turn(); assert.equal(h.runtime.getWorkerState().activeCount, 2);
  const snapshot = h.runtime.stopAgentWorker(); assert.equal(snapshot.busy, true);
  assert.throws(() => { snapshot.admissionClosed = false; }, TypeError);
  const draining = h.runtime.drainAgentWorker({ timeoutMs: 1000 });
  wait.resolve(); await Promise.all([poll, manual]); assert.equal((await draining).drained, true);
});

test('candidate, immutable and explicitly disabled executions refuse before database or timer activity', async () => {
  for (const options of [{ env: { DOCTARX_DEPLOY_CHECK: 'true' } }, { env: { AGENT_RUNTIME_DISABLED: 'true' } }, { immutable: true }]) {
    const h = runtimeHarness(options);
    await assert.rejects(h.runtime.runNextTask(), { code: 'AGENT_EXECUTION_DISABLED' });
    assert.equal(h.runtime.startAgentWorker().running, false);
    assert.deepEqual(h.trace, []); assert.deepEqual(h.timers, []);
  }
  const h = runtimeHarness({ env: { DISABLE_SCHEDULERS: 'true' }, noTask: true });
  assert.equal(h.runtime.startAgentWorker().running, false);
  assert.equal(await h.runtime.runNextTask(), null, 'scheduler-only disable preserves explicit manual execution');
});

test('configuration changes and invalid poll intervals cannot leave an active timer', async () => {
  const h = runtimeHarness({ noTask: true }); h.runtime.startAgentWorker();
  h.env.DISABLE_SCHEDULERS = 'true'; await h.timers[0].callback(); assert.deepEqual(h.trace, []);
  h.runtime.startAgentWorker(); assert.equal(h.timers[0].cleared, true);
  delete h.env.DISABLE_SCHEDULERS;
  for (const intervalMs of [0, -1, NaN, Infinity, 1.5, 86400001]) assert.throws(() => h.runtime.startAgentWorker({ intervalMs }), /poll interval/);
  assert.equal(h.runtime.getWorkerState().running, false);
  await assert.rejects(h.runtime.drainAgentWorker({ timeoutMs: 0 }), /Drain timeout/);
  await assert.rejects(h.runtime.runNextTask(), { code: 'WORKER_ADMISSION_CLOSED' });
});

function shutdownHarness({ drain, voice = async () => {} }) {
  const source = fs.readFileSync(path.join(root, 'server/index.js'), 'utf8');
  const section = source.slice(source.indexOf('  // Graceful shutdown'), source.indexOf('  // Capture uncaught exceptions'));
  const trace = [], handlers = {}, exits = [];
  vm.runInNewContext(section, {
    console: { log() {} },
    operationalAgentRuntime: { drainAgentWorker(options) { trace.push('drain'); assert.equal(options.timeoutMs, 10000); return drain(); } },
    voicePcmRuntime: { async close() { trace.push('voice'); await voice(); } },
    db: { async close() { trace.push('db'); } },
    require(name) { assert.equal(name, './services/nemoclaw'); return { async shutdown() { trace.push('nemo'); } }; },
    process: { on(signal, handler) { handlers[signal] = handler; }, exit(code) { exits.push(code); } },
  });
  return { handlers, trace, exits };
}

test('actual signal handler is single-flight and drains before voice, Nemo and DB close', async () => {
  const wait = deferred(); const h = shutdownHarness({ drain: () => wait.promise });
  const shutdown = h.handlers.SIGTERM(); await h.handlers.SIGINT();
  assert.deepEqual(h.trace, ['drain']); assert.deepEqual(h.exits, []);
  wait.resolve({ drained: true }); await shutdown;
  assert.deepEqual(h.trace, ['drain', 'voice', 'nemo', 'db']); assert.deepEqual(h.exits, [0]);
});

for (const throws of [false, true]) test('incomplete/failed drain never closes DB or reports clean exit (throws: ' + throws + ')', async () => {
  const h = shutdownHarness({ drain: () => throws ? Promise.reject(new Error('Synthetic drain error')) : Promise.resolve({ drained: false }) });
  await h.handlers.SIGTERM(); await h.handlers.SIGINT();
  assert.deepEqual(h.trace, ['drain']); assert.deepEqual(h.exits, [1]);
});

test('both authenticated manual-run endpoints return unavailable instead of false idle/success after fencing', async () => {
  const h = runtimeHarness(); await h.runtime.drainAgentWorker();
  const routes = new Map(), isolated = { exports: {} };
  const authenticate = () => {}, authorize = () => {};
  const router = new Proxy({}, { get: (_target, method) => (...args) => { if (method === 'post') routes.set(args[0], args.slice(1)); } });
  vm.runInNewContext(fs.readFileSync(path.join(root, 'server/routes/agentOps.js'), 'utf8'), {
    module: isolated, console: { error() {} }, process: { env: {} },
    require(name) {
      if (name === 'express') return { Router: () => router };
      if (name === '../middleware/auth') return { authenticate, requireRole: () => authorize };
      if (name === '../services/agent-runtime/runtime') return h.runtime;
      if (name === '../db' || name === '../services/agent-orchestrator') return {};
      assert.fail('Unexpected route dependency: ' + name);
    },
  });
  for (const route of ['/runtime/run-next', '/runtime/tasks/:id/run']) {
    const chain = routes.get(route); assert.equal(chain[0], authenticate); assert.equal(chain[1], authorize);
    const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(value) { this.body = value; return this; } };
    await chain.at(-1)({ params: { id: 'fictional' } }, res);
    assert.equal(res.statusCode, 503); assert.equal(res.body.success, false); assert.equal(res.body.code, 'WORKER_ADMISSION_CLOSED');
  }
  assert.deepEqual(h.trace, []);
});

function realDbWrapper({ claimFailure = false } = {}) {
  const released = [], cleared = [], timers = [], queries = [];
  const pool = {
    on() {}, async end() {},
    async connect() {
      const client = {
        async query(sql) {
          queries.push(sql);
          if (claimFailure && (sql.includes('FOR UPDATE SKIP LOCKED') || sql === 'ROLLBACK')) throw new Error('Synthetic database failure');
          return { rows: [] };
        },
        release(...args) { assert.equal(this, client); released.push(args); },
      };
      return client;
    },
  };
  const isolated = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'server/db/index.js'), 'utf8'), {
    module: isolated, process: { env: {} }, console: { log() {}, error() {} },
    setTimeout(callback) { const timer = { callback }; timers.push(timer); return timer; },
    clearTimeout(timer) { cleared.push(timer); },
    require(name) {
      if (name === 'dotenv') return { config() {} };
      if (name === 'pg') return { Pool: function Pool() { return pool; } };
      if (name === 'path') return path;
      if (name === 'fs') return fs;
      if (name === './connectionConfig') return require('../db/connectionConfig');
      if (name === './resolve-neon-url') return { resolveNeonConfig() { assert.fail('No external resolution'); } };
      assert.fail('Unexpected DB dependency: ' + name);
    },
  });
  return { db: isolated.exports, released, cleared, timers, queries };
}

test('real getClient wrapper preserves ordinary, boolean and error release arguments', async () => {
  const h = realDbWrapper(); const error = new Error('Synthetic discard marker');
  for (const args of [[], [false], [true], [error]]) {
    const client = await h.db.getClient(); client.release(...args);
  }
  assert.deepEqual(h.released, [[], [false], [true], [error]]);
  assert.deepEqual(h.cleared, h.timers);
});

test('claim rollback failure crosses the actual DB wrapper and destroys rather than reuses its client', async () => {
  const db = realDbWrapper({ claimFailure: true });
  const h = runtimeHarness({ dbOverride: db.db });
  await assert.rejects(h.runtime.runNextTask(), /database failure/);
  assert.deepEqual(db.released, [[true]]);
  assert.ok(db.queries.includes('ROLLBACK'));
  assert.equal((await h.runtime.drainAgentWorker()).reason, 'WORK_SETTLEMENT_FAILED');
});
