'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..', '..');

function controller(query) {
  const source = fs.readFileSync(path.join(root, 'server/routes/admin.js'), 'utf8').replace(/\r\n/g, '\n');
  const start = source.indexOf("router.get('/dashboard', async (req, res) => {");
  const end = source.indexOf('\n/**\n * GET /api/admin/users', start);
  assert.ok(start > 0 && end > start, 'dashboard route boundary is valid');
  let handler;
  vm.runInNewContext(source.slice(start, end), {
    router: { get(_path, callback) { handler = callback; } },
    db: { query }, logger: { warn() {}, error() {} },
  });
  return async () => {
    let body; let status = 200;
    await handler({ user: { id: 'existing-admin' } }, {
      json(value) { body = value; }, status(value) { status = value; return this; },
    });
    return { status, body: JSON.parse(JSON.stringify(body)) };
  };
}

function queryResult(sql) {
  if (sql.includes('GROUP BY role')) return { rows: [{ role: 'patient', count: '4' }, { role: 'provider', count: '3' }, { role: 'admin', count: '1' }] };
  if (sql.includes('provider_status')) return { rows: [{ cnt: '2' }] };
  if (sql.includes('GROUP BY tier')) return { rows: [{ tier: 'gold', count: '2' }] };
  if (sql.includes('GROUP BY DATE')) return { rows: [{ date: '2026-10-14', appointments: '1' }] };
  if (sql.includes('FILTER (WHERE status')) return { rows: [{ scheduled: '1', completed: '2', cancelled: '0', today: '1' }] };
  return { rows: [{ cnt: '0' }] };
}

test('admin aggregate failure remains unavailable while independent review counts stay accurate', async () => {
  const response = await controller(async sql => {
    if (sql.includes('GROUP BY role') || sql.includes('GROUP BY tier') || sql.includes('GROUP BY DATE')) throw new Error('Database query unavailable');
    return queryResult(sql);
  })();
  assert.equal(response.status, 200);
  const { body } = response;
  assert.equal(body.partial, true);
  assert.equal(body.dashboard.availability.users, false);
  assert.equal(body.dashboard.users.total, null);
  assert.equal(body.metrics.totalusers, null);
  assert.equal(body.dashboard.subscriptions.gold, null);
  assert.equal(body.dashboard.weeklyActivity, null);
  assert.equal(body.dashboard.providers.pendingApproval, 2);
  assert.equal(body.dashboard.appointments.today, 1);
});

test('successful queries preserve real zero counts and never estimate revenue from invented prices', async () => {
  const queries = [];
  const { body } = await controller(async sql => { queries.push(sql); return queryResult(sql); })();
  assert.equal(body.partial, false);
  assert.equal(body.dashboard.availability.subscriptions, true);
  assert.equal(body.dashboard.subscriptions.free, 0);
  assert.equal(body.dashboard.users.total, 8);
  assert.equal(body.dashboard.providers.pendingApproval, 2, 'pending accounts are a separate query, not the first user role count');
  assert.equal(body.metrics.estimatedmrr, null);
  assert.equal(body.dashboard.subscriptions.estimatedMRR, null);
  assert.ok(queries.some(sql => sql.includes('created_at >= CURRENT_DATE - 6')));
});

test('a complete aggregate outage reports unknown values without fabricated all-clear metrics', async () => {
  const { body } = await controller(async () => { throw new Error('Unavailable'); })();
  assert.equal(body.partial, true);
  assert.equal(body.unavailableSections.length, 13);
  assert.ok(Object.values(body.metrics).every(value => value === null));
  assert.equal(body.dashboard.providers.pendingApproval, null);
  assert.equal(body.dashboard.appointments.today, null);
  assert.equal(body.dashboard.weeklyActivity, null);
});

function presentationHelpers() {
  const source = fs.readFileSync(path.join(root, 'app/(dashboard)/admin/dashboard/page.js'), 'utf8');
  const start = source.indexOf('function nullableCount(');
  const end = source.indexOf('const displayCount', start);
  const context = {};
  vm.runInNewContext(source.slice(start, end) + '\nglobalThis.helpers = { nullableCount, dashboardCount, weeklyRows };', context);
  return context.helpers;
}

test('admin presentation distinguishes unavailable, malformed and legitimate zero counts', () => {
  const { dashboardCount, nullableCount } = presentationHelpers();
  assert.equal(dashboardCount({ availability: { users: false }, users: { total: 0 } }, 'users', 'total'), null);
  assert.equal(dashboardCount({ users: { total: 0 } }, 'users', 'total'), null);
  assert.equal(dashboardCount({ availability: { users: true }, users: { total: '0' } }, 'users', 'total'), 0);
  for (const value of [undefined, null, '', false, -1, 'invalid', {}, 1.5]) assert.equal(nullableCount(value), null);
});

test('weekly chart rejects malformed rows instead of substituting zero-height activity', () => {
  const { weeklyRows } = presentationHelpers();
  assert.equal(weeklyRows({ availability: { weeklyActivity: false }, weeklyActivity: [] }), null);
  assert.equal(weeklyRows({ availability: { weeklyActivity: true }, weeklyActivity: [{ date: '2026-02-30', appointments: '1' }] }), null);
  assert.equal(weeklyRows({ availability: { weeklyActivity: true }, weeklyActivity: [{ date: '2026-10-14', appointments: null }] }), null);
  const rows = weeklyRows({ availability: { weeklyActivity: true }, weeklyActivity: [{ date: '2026-10-14', appointments: '0' }] });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].count, 0);
});

test('all visible NG administration destinations resolve an existing application route', () => {
  const navigation = fs.readFileSync(path.join(root, 'components/ng/portalNavigation.js'), 'utf8');
  const adminSection = navigation.slice(navigation.indexOf('export const nigeriaAdminNavigation'));
  const hrefs = [...adminSection.matchAll(/href:\s*'([^']+)'/g)].map(match => match[1]);
  assert.ok(hrefs.length >= 10, 'administration features remain discoverable');
  for (const href of hrefs) assert.ok(fs.existsSync(path.join(root, 'app', href.replace(/^\//, ''), 'page.js')), href + ' has a route implementation');
});
