'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
// Execute the actual callback so this regression cannot pass against an unrelated model.
const source = fs.readFileSync(path.join(__dirname, '../../components/ng/phc/PhcWorkspace.jsx'), 'utf8');
const prefix = 'const refreshWorklists = useCallback(';
const start = source.indexOf(prefix);
const end = source.indexOf('\n  }, [context]);', start);
assert.ok(start >= 0 && end > start, 'Update the callback harness if its declaration changes.');
const callback = source.slice(start + prefix.length, end) + '\n  }';
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function harness() {
  const context = { programme_role: 'phc_nurse' };
  const currentContext = { current: context }, version = { current: 0 };
  const requests = [], writes = [], state = { tasks: [], busy: '', error: '' };
  const api = { listFollowUps() { const d = deferred(); requests.push(d); return d.promise; } };
  const factory = new Function('context', 'currentContext', 'worklistRequestVersion', 'phcAPI',
    'CLINICAL_QUEUE_ROLES', 'FOLLOW_UP_ROLES', 'REPORTING_ROLES', 'setBusy', 'setError',
    'setQueue', 'setFollowUps', 'setReports', 'setReferrals', 'errorMessage', `return (${callback});`);
  const noop = () => {};
  const refresh = factory(context, currentContext, version, api, new Set(), new Set(['phc_nurse']), new Set(),
    value => { state.busy = value; writes.push(['busy', value]); }, value => { state.error = value; writes.push(['error', value]); },
    noop, value => { state.tasks = value; writes.push(['tasks', value]); }, noop, noop, error => error.message);
  return { refresh, requests, state, version, currentContext, writes };
}
test('older worklist success cannot overwrite a newer completed task', async () => {
  const h = harness(); const old = h.refresh(); const latest = h.refresh();
  h.requests[1].resolve({ data: { tasks: [{ id: 'task', status: 'completed', record_version: 3 }] } }); await latest;
  h.requests[0].resolve({ data: { tasks: [{ id: 'task', status: 'open', record_version: 1 }] } }); await old;
  assert.equal(h.state.tasks[0].status, 'completed'); assert.equal(h.state.tasks[0].record_version, 3);
});
test('older failed refresh cannot set an error or clear a newer request busy state', async () => {
  const h = harness(); const old = h.refresh(); const latest = h.refresh();
  h.requests[0].reject(new Error('stale failure')); await old;
  assert.equal(h.state.error, ''); assert.equal(h.state.busy, 'refresh');
  h.requests[1].resolve({ data: { tasks: [] } }); await latest; assert.equal(h.state.busy, '');
});
test('confirmed mutation invalidates a pre-mutation worklist response', async () => {
  assert.match(source, /worklistRequestVersion\.current \+= 1;\s*setFollowUps\(\(tasks\)/);
  const h = harness(); const old = h.refresh();
  h.version.current += 1; h.state.tasks = [{ status: 'completed', record_version: 3 }];
  h.requests[0].resolve({ data: { tasks: [{ status: 'open', record_version: 1 }] } }); await old;
  assert.equal(h.state.tasks[0].status, 'completed');
});
test('context switch prevents old callback requests and late responses from modifying worklists', async () => {
  const h = harness(); const old = h.refresh(); h.currentContext.current = { programme_role: 'phc_nurse' };
  await h.refresh(); assert.equal(h.requests.length, 1);
  h.requests[0].resolve({ data: { tasks: [{ status: 'open' }] } }); await old;
  assert.deepEqual(h.state.tasks, []);
});
