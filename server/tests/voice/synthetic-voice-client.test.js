'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createSyntheticSessionController } = require('../../../lib/voice/syntheticSessionController.cjs');
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
const session = (id = 'one', revision = 1) => ({ id, revision, epoch: revision, status: 'active' });

test('late creation after end/unmount is cleaned up and never resurrects the view', async () => {
  const pending = deferred(); const calls = []; const updates = [];
  const controller = createSyntheticSessionController({ request(path, body) { calls.push({ path, body }); return path === '/sessions' ? pending.promise : Promise.resolve({}); }, onChange: state => updates.push(state) });
  const start = controller.start('ha', 'v1');
  await controller.end();
  pending.resolve({ session: session() }); await start;
  assert.equal(controller.getSnapshot().session, null);
  assert.equal(calls.filter(call => call.body.action === 'end').length, 1);
  assert.equal(updates.filter(Boolean).length, 0);
  const later = deferred(); const cleanup = [];
  const disposed = createSyntheticSessionController({ request(path, body) { cleanup.push(body); return path === '/sessions' ? later.promise : Promise.resolve({}); } });
  const inFlight = disposed.start('yo', 'v1'); await disposed.dispose(); later.resolve({ session: session('two') }); await inFlight;
  assert.equal(cleanup.at(-1).action, 'end');
});

test('end aborts pending output locally and ignores its late response', async () => {
  const output = deferred(); const calls = []; let capturedSignal;
  const controller = createSyntheticSessionController({ request(path, body, options) {
    calls.push(body); if (path === '/sessions') return Promise.resolve({ session: session() });
    if (body.action === 'advance_output') { capturedSignal = options.signal; return output.promise; }
    return Promise.resolve({});
  } });
  await controller.start('ha', 'v1'); const advance = controller.command('advance_output');
  await controller.end('revoke_consent');
  assert.equal(capturedSignal.aborted, true);
  output.resolve({ session: session('one', 2) }); await advance;
  assert.equal(controller.getSnapshot().session, null);
  assert.equal(controller.getSnapshot().busy, false);
  assert.equal(calls.at(-1).action, 'revoke_consent');
});

test('repeated clicks do not create duplicate sessions or duplicate commands', async () => {
  const creating = deferred(); const advancing = deferred(); let starts = 0, advances = 0;
  const controller = createSyntheticSessionController({ request(path) {
    if (path === '/sessions') { starts++; return creating.promise; } advances++; return advancing.promise;
  } });
  const first = controller.start('ha', 'v1'); await controller.start('ha', 'v1');
  assert.equal(starts, 1); creating.resolve({ session: session() }); await first;
  const advance = controller.command('advance_output'); await controller.command('advance_output');
  assert.equal(advances, 1); advancing.resolve({ session: session('one', 2) }); await advance;
  assert.equal(controller.getSnapshot().session.revision, 2);
});

test('ambiguous mutation failure reads current state once instead of replaying action', async () => {
  const calls = []; const errors = [];
  const controller = createSyntheticSessionController({ request(path, body) {
    calls.push({ path, body });
    if (path === '/sessions') return Promise.resolve({ session: session() });
    if (body) return Promise.reject(new Error('connection lost after commit'));
    return Promise.resolve({ session: session('one', 2) });
  }, onError: error => errors.push(error) });
  await controller.start('ha', 'v1'); await controller.command('fixture', { fixtureId: 'duration' });
  assert.equal(controller.getSnapshot().session.revision, 2);
  assert.equal(calls.filter(call => call.body?.action === 'fixture').length, 1);
  assert.equal(calls.filter(call => call.body === undefined).length, 1);
  assert.equal(errors.length, 1);
});

test('an old failed request cannot erase a newer conversation', async () => {
  const advancing = deferred(); let starts = 0;
  const controller = createSyntheticSessionController({ request(path, body) {
    if (path === '/sessions') return Promise.resolve({ session: session(String(++starts)) });
    if (body?.action === 'advance_output') return advancing.promise;
    return Promise.resolve({});
  } });
  await controller.start('ha', 'v1'); const advance = controller.command('advance_output');
  await controller.end(); await controller.start('ig', 'v1');
  advancing.reject(new Error('old request failed')); await advance;
  assert.equal(controller.getSnapshot().session.id, '2');
});
