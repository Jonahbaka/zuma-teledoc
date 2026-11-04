'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { createRequire } = require('node:module');

const filename = require.resolve('../routes/appointments');
const actual = createRequire(filename);

// Run the real route handler without importing application startup, external
// services, or the application's database. Database coverage below executes its
// unchanged SQL against transaction-local, entirely synthetic tables.
function fixture(query = async () => ({ rows: [] })) {
  const handlers = new Map();
  const router = {};
  const queries = [];
  const audits = [];
  for (const method of ['get', 'post', 'put', 'patch', 'delete', 'use']) {
    router[method] = (path, ...chain) => handlers.set(`${method} ${path}`, chain.at(-1));
  }
  const dependencies = {
    express: { Router: () => router },
    uuid: { v4: () => 'synthetic-id' },
    '../db': { query: async (sql, values) => { queries.push({ sql, values }); return query(sql, values); } },
    '../middleware/logger': { error() {}, warn() {} },
    '../middleware/auth': { authenticate() {}, requireRole: () => () => {} },
    '../middleware/accessControl': { requirePaidAccess() {} },
    '../middleware/audit': { auditMiddleware: (action, resource, options) => { audits.push({ action, resource, options }); return () => {}; } },
    '../../lib/validation': {},
    '../../lib/utils': actual('../../lib/utils'),
    '../services/notifications': {},
    '../services/testingAccessService': {},
    '../services/telehealthSessionService': {},
    '../utils/marketScope': actual('../utils/marketScope'),
    zod: actual('zod'),
    '../services/appointmentReservationService': {},
    '../middleware/financialRecordScope': {},
    '../services/appointmentIntentService': {},
  };
  const mod = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    require(name) {
      assert.ok(Object.hasOwn(dependencies, name), `Unexpected route dependency: ${name}`);
      return dependencies[name];
    },
    module: mod, exports: mod.exports, console, process,
  }, { filename });
  return {
    queries, audits,
    async call(user, params = {}) {
      const response = {
        statusCode: 200, headers: {}, locals: {},
        status(code) { this.statusCode = code; return this; },
        set(name, value) { this.headers[name] = value; return this; },
        json(body) { this.body = body; return this; },
      };
      await handlers.get('get /upcoming')({
        user,
        query: { marketScope: 'US', market: 'US', global: 'true', ...params },
        headers: { 'x-doctarx-market': 'US' },
        body: { marketScope: 'US' },
      }, response);
      return response;
    },
  };
}

for (const role of ['admin', 'super_admin']) {
  for (const marketScope of ['NG', 'US']) {
    test(`${role} upcoming scopes both participant markets and roles before ordering and limit (${marketScope})`, async () => {
      const f = fixture();
      const response = await f.call({ id: 'synthetic-admin', role, marketScope }, { limit: '1' });
      assert.equal(response.statusCode, 200);
      assert.equal(f.queries.length, 1);
      const { sql, values } = f.queries[0];
      assert.match(sql, /a.scheduled_at > \$1/);
      assert.match(sql, /a.status IN \('scheduled', 'confirmed'\)/);
      assert.match(sql, /CASE\s+WHEN UPPER\(COALESCE\(p.market_scope,[\s\S]+?END = \$2/);
      assert.match(sql, /CASE\s+WHEN UPPER\(COALESCE\(pr.market_scope,[\s\S]+?END = \$3/);
      assert.match(sql, /p.role = 'patient' AND pr.role = 'provider'/);
      assert.ok(sql.indexOf("pr.role = 'provider'") < sql.indexOf('ORDER BY'));
      assert.match(sql, /ORDER BY a.scheduled_at ASC\s+LIMIT \$4/);
      assert.deepEqual(Array.from(values.slice(1)), [marketScope, marketScope, 1]);
      assert.equal(response.headers['Cache-Control'], 'private, no-store');
    });
  }
}

test('administrative upcoming keeps its bounded limit and scheduling-only disclosure', async () => {
  for (const role of ['admin', 'super_admin']) {
    for (const [limit, expected] of [[undefined, 5], ['999', 50], ['0', 1], ['invalid', 5]]) {
      const f = fixture(async () => ({ rows: [{
        id: 'synthetic-appointment', patient_id: 'synthetic-patient', provider_id: 'synthetic-provider',
        scheduled_at: '2097-06-15T12:00:00Z', status: 'scheduled', type: 'video',
        reason_for_visit: 'Synthetic private narrative', patient_notes: 'Synthetic private note',
        provider_notes: 'Synthetic clinician note', metadata: { triage: 'Synthetic triage' },
        room_id: 'Synthetic private room', patient_first_name: 'Synthetic private name',
      }] }));
      const response = await f.call({ id: 'synthetic-admin', role, marketScope: 'NG' }, { limit });
      assert.equal(response.statusCode, 200);
      assert.equal(f.queries[0].values.at(-1), expected);
      assert.deepEqual(Object.keys(response.body.appointments[0]).sort(), ['id', 'patientId', 'providerId', 'scheduledAt', 'status', 'type']);
      assert.equal(response.body.appointments[0].id, 'synthetic-appointment');
      const reads = f.audits.filter(audit => audit.action === 'read');
      assert.ok(reads.length > 0);
      for (const audit of reads) {
        assert.equal(audit.options.phiAccessed, true);
        assert.equal(audit.options.metadataOnly, true);
        assert.equal(audit.options.requireSuccess, true);
      }
    }
  }
});

test('unsupported upcoming roles cannot query appointment records', async () => {
  for (const role of ['pharmacy', 'billing', 'agent', '']) {
    const f = fixture();
    const response = await f.call({ id: 'synthetic-actor', role, marketScope: 'NG' });
    assert.equal(response.statusCode, 403);
    assert.equal(f.queries.length, 0);
    assert.equal(response.body.appointments, undefined);
  }
});

const target = process.env.SIMULATION_DATABASE_URL;
test('upcoming administrative SQL excludes cross-market and malformed relationships before LIMIT in PostgreSQL', { skip: !target }, async () => {
  const url = new URL(target);
  assert.ok(['localhost', '127.0.0.1'].includes(url.hostname) && url.pathname.endsWith('_test'), 'Use a disposable loopback database ending in _test');
  const { Client } = require('pg');
  const client = new Client({ connectionString: target });
  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL search_path = pg_temp');
    await client.query(`CREATE TEMP TABLE users (
      id TEXT PRIMARY KEY, role TEXT, market_scope TEXT, region TEXT, country TEXT,
      first_name TEXT, last_name TEXT, specialty TEXT
    ) ON COMMIT DROP`);
    await client.query(`CREATE TEMP TABLE appointments (
      id TEXT PRIMARY KEY, patient_id TEXT, provider_id TEXT, scheduled_at TIMESTAMPTZ,
      status TEXT, type TEXT, patient_notes TEXT, reason_for_visit TEXT, metadata JSONB
    ) ON COMMIT DROP`);
    await client.query(`INSERT INTO users (id, role, market_scope, region, country) VALUES
      ('ng-patient', 'patient', 'NG', 'US', 'USA'),
      ('ng-provider', 'provider', 'NG', 'US', 'USA'),
      ('us-patient', 'patient', 'US', 'NG', 'Nigeria'),
      ('us-provider', 'provider', 'US', 'NG', 'Nigeria'),
      ('wrong-patient-role', 'provider', 'NG', NULL, NULL),
      ('wrong-provider-role', 'patient', 'NG', NULL, NULL),
      ('legacy-us-patient', 'patient', NULL, NULL, NULL),
      ('legacy-us-provider', 'provider', NULL, NULL, NULL),
      ('legacy-ng-patient', 'patient', NULL, 'NG', NULL),
      ('legacy-ng-provider', 'provider', NULL, NULL, 'Nigeria')`);
    const rows = [
      ['missing-us-patient', 'absent-patient', 'us-provider', 'scheduled'],
      ['missing-us-provider', 'us-patient', 'absent-provider', 'scheduled'],
      ['us-appointment', 'us-patient', 'us-provider', 'scheduled'],
      ['cross-patient', 'us-patient', 'ng-provider', 'scheduled'],
      ['cross-provider', 'ng-patient', 'us-provider', 'scheduled'],
      ['missing-patient', 'absent-patient', 'ng-provider', 'scheduled'],
      ['missing-provider', 'ng-patient', 'absent-provider', 'scheduled'],
      ['invalid-patient-role', 'wrong-patient-role', 'ng-provider', 'scheduled'],
      ['invalid-provider-role', 'ng-patient', 'wrong-provider-role', 'scheduled'],
      ['ng-appointment', 'ng-patient', 'ng-provider', 'scheduled'],
      ['ng-appointment-confirmed', 'ng-patient', 'ng-provider', 'confirmed'],
      ['ng-completed', 'ng-patient', 'ng-provider', 'completed'],
      ['ng-cancelled', 'ng-patient', 'ng-provider', 'cancelled'],
      ['legacy-us-appointment', 'legacy-us-patient', 'legacy-us-provider', 'scheduled'],
      ['legacy-ng-appointment', 'legacy-ng-patient', 'legacy-ng-provider', 'scheduled'],
    ];
    for (const [index, row] of rows.entries()) {
      await client.query(`INSERT INTO appointments (id,patient_id,provider_id,status,scheduled_at,type,patient_notes,reason_for_visit,metadata)
        VALUES ($1,$2,$3,$4,'2097-06-15T00:00:00Z'::timestamptz + ($5::int * INTERVAL '1 minute'),'video','Synthetic private note','Synthetic private narrative','{"triage":"Synthetic private triage"}')`, [...row, index]);
    }
    const f = fixture((sql, values) => client.query(sql, values));
    for (const role of ['admin', 'super_admin']) {
      const ng = await f.call({ id: 'synthetic-admin', role, marketScope: 'NG' }, { limit: '50' });
      assert.equal(ng.statusCode, 200);
      assert.deepEqual(Array.from(ng.body.appointments, row => row.id), ['ng-appointment', 'ng-appointment-confirmed', 'legacy-ng-appointment']);
      const limited = await f.call({ id: 'synthetic-admin', role, marketScope: 'NG' }, { limit: '1' });
      assert.deepEqual(Array.from(limited.body.appointments, row => row.id), ['ng-appointment']);
      const us = await f.call({ id: 'synthetic-admin', role, marketScope: 'US' }, { limit: '50' });
      assert.equal(us.statusCode, 200);
      assert.deepEqual(Array.from(us.body.appointments, row => row.id), ['us-appointment', 'legacy-us-appointment']);
      assert.ok(!JSON.stringify([...ng.body.appointments, ...us.body.appointments]).includes('Synthetic private'));
    }
    // A later participant market change must affect the next read, without a
    // cached grant or any request-provided market override.
    await client.query("UPDATE users SET market_scope = 'US' WHERE id = 'ng-provider'");
    const changed = await f.call({ id: 'synthetic-admin', role: 'super_admin', marketScope: 'NG' });
    assert.deepEqual(Array.from(changed.body.appointments, row => row.id), ['legacy-ng-appointment']);
  } finally {
    try { await client.query('ROLLBACK'); } finally { await client.end(); }
  }
});
