'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..', '..');
let helpers;
test.before(async () => { helpers = await import(pathToFileURL(path.join(root, 'lib/ng/adminWorkspaceData.js')).href); });

test('unknown or malformed metrics are unavailable while recorded zero remains visible', () => {
  for (const value of [null, undefined, '', false, [], {}, -1, Infinity, 'invalid']) {
    assert.equal(helpers.formatCount(value), '—');
    assert.equal(helpers.formatMoney(value), '—');
  }
  assert.equal(helpers.formatCount('0'), '0');
  assert.match(helpers.formatMoney('0.00'), /0\.00/);
  assert.equal(helpers.formatCount('1.5'), '—');
});

test('a failed or malformed list response cannot be advertised as a confirmed empty list', () => {
  for (const value of [null, {}, { providers: null }, { success: false, providers: [] }, { error: 'Unavailable', providers: [] }]) assert.throws(() => helpers.requireRows(value, 'providers'));
  assert.deepEqual(helpers.requireRows({ providers: [] }, 'providers'), []);
  assert.throws(() => helpers.requireSuccess({}));
  assert.throws(() => helpers.requireSuccess({ success: false }));
  assert.throws(() => helpers.requireSuccess({ success: true, error: 'Action failed' }));
  assert.equal(helpers.requireSuccess({ success: true }).success, true);
});

test('switching account or filter hides the previous records before the replacement request completes', () => {
  const state = { key: 'old-account:pending', data: ['previous-account-record'], loading: false, error: null };
  const next = helpers.currentResource(state, 'new-account:active');
  assert.equal(next.loading, true);
  assert.equal(next.data, null);
  assert.equal(next.error, null);
});

function resourceHarness(get) {
  const source = fs.readFileSync(path.join(root, 'components/ng/admin/AdminWorkspaceTools.jsx'), 'utf8');
  const start = source.indexOf('  const refresh = useCallback(');
  const end = source.indexOf('  useEffect(() => {', start);
  assert.ok(start > 0 && end > start);
  const state = [];
  const context = { gate: { current: helpers.createRequestGate() }, controller: { current: null }, selector: { current: data => helpers.requireRows(data, 'rows') }, api: { get }, AbortController, useCallback: callback => callback, setState: value => state.push(value) };
  vm.runInNewContext('function makeRefresh(key) {\n' + source.slice(start, end) + '\nreturn refresh; }\nglobalThis.makeRefresh = makeRefresh;', context);
  return { ...context, state };
}

test('a slower old-filter response cannot replace newer records and its request is aborted', async () => {
  let resolveOld; let oldSignal;
  const h = resourceHarness(async (url, options) => {
    if (url === '/old') { oldSignal = options.signal; return new Promise(resolve => { resolveOld = resolve; }); }
    return { data: { rows: ['new-record'] } };
  });
  const old = h.makeRefresh(JSON.stringify({ url: '/old', params: { status: 'pending' }, userId: 'admin-1' }))();
  await h.makeRefresh(JSON.stringify({ url: '/new', params: { status: 'active' }, userId: 'admin-1' }))();
  assert.equal(oldSignal.aborted, true);
  resolveOld({ data: { rows: ['old-record'] } });
  const result = await old;
  assert.equal(result.current, false);
  assert.deepEqual(h.state.at(-1).data, ['new-record']);
  assert.equal(h.state.at(-1).loading, false);
});

test('an administrative load failure remains an error and a retry can recover a real empty result', async () => {
  let fail = true;
  const h = resourceHarness(async () => { if (fail) throw { response: { status: 503 } }; return { data: { rows: [] } }; });
  const refresh = h.makeRefresh(JSON.stringify({ url: '/records', params: {}, userId: 'admin-1' }));
  const first = await refresh();
  assert.equal(first.ok, false);
  assert.equal(h.state.at(-1).data, null);
  assert.match(h.state.at(-1).error, /could not be loaded/);
  fail = false;
  const recovered = await refresh();
  assert.equal(recovered.ok, true);
  assert.deepEqual(recovered.data, []);
  assert.equal(h.state.at(-1).error, null);
});

test('cancelled workspace loads cannot publish private records after unmount', async () => {
  let finish;
  const h = resourceHarness(() => new Promise(resolve => { finish = resolve; }));
  const pending = h.makeRefresh(JSON.stringify({ url: '/records', params: {}, userId: 'admin-1' }))();
  h.gate.current.cancel(); h.controller.current.abort();
  finish({ data: { rows: ['private-record'] } });
  assert.equal((await pending).current, false);
  assert.equal(h.state.length, 1, 'only the initial loading state was published');
});

test('registration status filters and decision payloads match the active server contracts', () => {
  const source = fs.readFileSync(path.join(root, 'components/ng/admin/AdminRegistrations.jsx'), 'utf8');
  assert.match(source, /action: selected\.decision/);
  assert.doesNotMatch(source, /approved:\s*approve/);
  assert.match(source, /organizations:.*initial: 'pending_review'.*approved: \['active'\]/);
  assert.match(source, /hospitals:.*initial: 'pending_review'/);
  const subscriptions = fs.readFileSync(path.join(root, 'app/ng/admin/subscriptions/page.js'), 'utf8');
  assert.match(subscriptions, /'canceled'/);
  assert.doesNotMatch(subscriptions, /Est\. MRR|summary\.mrr|setSubs\(s => s\.filter/);
});

function actionHarness() {
  const source = fs.readFileSync(path.join(root, 'components/ng/admin/AdminWorkspaceTools.jsx'), 'utf8');
  const start = source.indexOf('  const run = async (id, operation) => {');
  const end = source.indexOf('  return { pending:', start);
  assert.ok(start > 0 && end > start);
  const state = [];
  const context = { context: { current: 'account-1:pending' }, active: { current: true }, busy: { current: false }, setState: value => state.push(value), rerender() {} };
  vm.runInNewContext(source.slice(start, end) + '\nglobalThis.run = run;', context);
  return { ...context, state };
}

test('failed admin mutations surface failure without advertising a saved action', async () => {
  const h = actionHarness();
  const result = await h.run('notification-1', async () => { throw { response: { data: { error: 'Access denied' } } }; });
  assert.equal(result, null);
  assert.equal(h.state.at(-1).notice.type, 'error');
  assert.equal(h.state.at(-1).notice.message, 'Access denied');
  assert.equal(h.busy.current, false);
});

test('double-clicked admin actions send once and stale account/filter completion is suppressed', async () => {
  let finish; let sent = 0; let currentGuard;
  const h = actionHarness();
  const pending = h.run('registration-1', isCurrent => { sent += 1; currentGuard = isCurrent; return new Promise(resolve => { finish = resolve; }); });
  assert.equal(await h.run('registration-1', async () => { sent += 1; }), null);
  assert.equal(sent, 1);
  h.context.current = 'account-2:verified';
  assert.equal(currentGuard(), false, 'operation must skip an old-context refresh');
  finish({ message: 'Decision recorded.' });
  assert.equal(await pending, null);
  assert.equal(h.state.length, 1, 'no stale success or record mutation is published');
  assert.equal(h.busy.current, false);
});

test('unmounted admin actions do not publish a success message', async () => {
  let finish;
  const h = actionHarness();
  const pending = h.run('subscription-1', () => new Promise(resolve => { finish = resolve; }));
  h.active.current = false;
  finish({ message: 'Subscription activated.' });
  assert.equal(await pending, null);
  assert.equal(h.state.length, 1);
});
