'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { clampLimit } = require('../routes/clinical')._test;

test('a page size is always a positive integer within the route maximum', () => {
  assert.equal(clampLimit('25', { fallback: 20, max: 100 }), 25);
  assert.equal(clampLimit(25, { fallback: 20, max: 100 }), 25);
  assert.equal(clampLimit('5000', { fallback: 20, max: 100 }), 100, 'an oversized page is capped');
});

test('a missing, negative, or non-numeric limit falls back instead of reaching the database', () => {
  // LIMIT -5 is a database error, not a bad request, so it must never be passed through.
  assert.equal(clampLimit(undefined, { fallback: 20, max: 100 }), 20);
  assert.equal(clampLimit('', { fallback: 20, max: 100 }), 20);
  assert.equal(clampLimit('-5', { fallback: 20, max: 100 }), 20);
  assert.equal(clampLimit('0', { fallback: 20, max: 100 }), 20);
  assert.equal(clampLimit('abc', { fallback: 20, max: 100 }), 20);
  assert.equal(clampLimit(NaN, { fallback: 20, max: 100 }), 20);
  assert.equal(clampLimit({ toString: () => 'nope' }, { fallback: 20, max: 100 }), 20);
});

test('the clamped value is always usable in a LIMIT clause', () => {
  for (const input of ['-1', '0', 'null', '10; DROP TABLE users', '1e3', '3.9']) {
    const value = clampLimit(input, { fallback: 50, max: 200 });
    assert.ok(Number.isInteger(value) && value >= 1 && value <= 200, `clamped ${input} to ${value}`);
  }
});

function referralReadHandler(pool, assertAccess = async () => {}, route = '/referrals') {
  const fs = require('node:fs'), vm = require('node:vm'), { createRequire } = require('node:module');
  const file = require.resolve('../routes/clinical'), actual = createRequire(file), handlers = new Map();
  const router = {}; for (const method of ['get', 'post', 'put', 'patch', 'delete', 'use']) router[method] = (path, ...chain) => handlers.set(`${method} ${path}`, chain.at(-1));
  const sandboxModule = { exports: {} };
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), { module: sandboxModule, exports: sandboxModule.exports, console: { error() {} }, process, require(name) {
    if (name === 'express') return { Router: () => router, json: () => () => {} };
    if (name === '../../server/db') return { getPool: () => pool };
    if (name === '../services/clinical/clinicalAccessService') return { ...actual(name), assertClinicalAccess: assertAccess };
    return actual(name);
  } }, { filename: file });
  return handlers.get('get ' + route);
}

test('referral tracking returns scoped subject names independently of patient picker results', async () => {
  const queries = [], access = []; let denied = false;
  const pool = { async query(sql, params) { queries.push({ sql, params }); return { rows: [{ id: 'referral', patient_display_name: 'Synthetic Patient' }] }; } };
  const handler = referralReadHandler(pool, async (req, context) => { access.push(context); if (denied) throw Object.assign(new Error('Forbidden'), { statusCode: 403 }); });
  const call = async (role, query = {}, status = 200) => {
    queries.length = 0;
    const res = { statusCode: 200, headers: {}, set(name, value) { this.headers[name] = value; return this; }, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
    await handler({ user: { id: 'actor', role }, query }, res);
    assert.equal(res.statusCode, status); return res;
  };
  const response = await call('provider', { status: 'sent', priority: 'urgent' });
  assert.equal(response.headers['Cache-Control'], 'private, no-store'); assert.equal(response.body.referrals[0].patient_display_name, 'Synthetic Patient');
  assert.deepEqual(Array.from(queries[0].params), ['actor', 'actor', 'sent', 'urgent']);
  assert.match(queries[0].sql, /WHERE r\.provider_user_id = \$1 AND EXISTS/);
  assert.match(queries[0].sql, /r\.status = \$3 AND r\.priority = \$4/);
  assert.match(queries[0].sql, /actor\.id = \$2 AND actor\.role = 'provider'/);
  assert.match(queries[0].sql, /actor\.is_active = TRUE AND actor\.market_scope = 'NG'/);
  assert.match(queries[0].sql, /actor\.provider_status = 'approved' AND profile\.status = 'verified'/);
  assert.match(queries[0].sql, /LEFT JOIN users patient ON patient\.id = r\.patient_user_id/);
  assert.match(queries[0].sql, /patient\.role = 'patient' AND patient\.is_active = TRUE AND patient\.market_scope = 'NG'/);
  assert.match(queries[0].sql, /patient\.first_name, patient\.last_name/); assert.doesNotMatch(queries[0].sql, /patient\.(email|phone|date_of_birth)/);
  await call('patient'); assert.doesNotMatch(queries[0].sql, /FROM users actor/); assert.match(queries[0].sql, /WHERE r\.patient_user_id = \$1/); assert.deepEqual(Array.from(queries[0].params), ['actor']);
  await call('provider', { patient_user_id: 'connected-patient' }); assert.equal(access.at(-1).patientUserId, 'connected-patient'); assert.equal(access.at(-1).mode, 'read');
  assert.match(queries[0].sql, /WHERE r\.patient_user_id = \$1/); assert.deepEqual(Array.from(queries[0].params), ['connected-patient', 'actor']); assert.match(queries[0].sql, /AND EXISTS/);
  await call('admin', { patient_user_id: 'break-glass-patient' }); assert.equal(access.at(-1).patientUserId, 'break-glass-patient'); assert.doesNotMatch(queries[0].sql, /FROM users actor/);
  denied = true; await call('provider', { patient_user_id: 'unrelated' }, 403); assert.equal(queries.length, 0);
  await call('admin', {}, 400); assert.equal(queries.length, 0);
});

async function isolatedClinicalConnection() {
  const { fixtureTargetSafety } = require('../scripts/fixtureTargetSafety');
  const safety = fixtureTargetSafety({ source: 'SIMULATION_DATABASE_URL' });
  assert.equal(safety.skipped, false, safety.reason);
  const { Pool } = require('pg');
  const pool = new Pool({ connectionString: process.env.SIMULATION_DATABASE_URL, max: 1, statement_timeout: 15000 });
  const actualTarget = fixtureTargetSafety({ source: 'SIMULATION_DATABASE_URL', pool });
  assert.equal(actualTarget.skipped, false, actualTarget.reason);
  return { pool, client: await pool.connect() };
}

test('PostgreSQL referral identity read excludes switched-market or revoked clinician profiles at query time', { skip: !process.env.SIMULATION_DATABASE_URL }, async () => {
  const { randomUUID } = require('node:crypto');
  const { pool, client } = await isolatedClinicalConnection();
  const actor = randomUUID(), patient = randomUUID(), referral = randomUUID();
  try {
    await client.query('BEGIN');
    // Temporary synthetic tables shadow, but never change, any real application tables.
    await client.query('CREATE TEMP TABLE users (id uuid PRIMARY KEY, role text, is_active boolean, market_scope text, provider_status text, first_name text, last_name text) ON COMMIT DROP');
    await client.query('CREATE TEMP TABLE ng_providers (user_id uuid, status text) ON COMMIT DROP');
    await client.query('CREATE TEMP TABLE ng_referrals (id uuid, patient_user_id uuid, provider_user_id uuid, status text, priority text, created_at timestamptz) ON COMMIT DROP');
    await client.query("INSERT INTO users VALUES ($1,'provider',TRUE,'NG','approved','Synthetic','Clinician'),($2,'patient',TRUE,'NG',NULL,'Synthetic','Patient')", [actor, patient]);
    await client.query("INSERT INTO ng_providers VALUES ($1,'verified')", [actor]);
    await client.query("INSERT INTO ng_referrals VALUES ($1,$2,$3,'draft','routine',NOW())", [referral, patient, actor]);
    const handler = referralReadHandler(client);
    const read = async (query = {}, role = 'provider', id = actor) => {
      const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, set() { return this; }, json(body) { this.body = body; return this; } };
      await handler({ user: { id, role, marketScope: 'NG' }, query }, res);
      assert.equal(res.statusCode, 200); return res.body.referrals;
    };
    assert.equal((await read())[0].patient_display_name, 'Synthetic Patient');
    assert.equal((await read({ patient_user_id: patient }))[0].id, referral);
    for (const statement of [
      "UPDATE users SET market_scope='US' WHERE id=$1",
      'UPDATE users SET is_active=FALSE WHERE id=$1',
      "UPDATE users SET provider_status='pending' WHERE id=$1",
      "UPDATE users SET role='patient' WHERE id=$1",
      "UPDATE ng_providers SET status='suspended' WHERE user_id=$1",
      "UPDATE ng_providers SET status='pending' WHERE user_id=$1",
      'DELETE FROM ng_providers WHERE user_id=$1',
    ]) {
      await client.query('SAVEPOINT revoke'); await client.query(statement, [actor]);
      assert.deepEqual(await read(), [], statement);
      assert.deepEqual(await read({ patient_user_id: patient }), [], 'Explicit patient lookup cannot bypass current clinician authority');
      await client.query('ROLLBACK TO SAVEPOINT revoke');
    }
    assert.equal((await read({}, 'patient', patient))[0].patient_display_name, 'Synthetic Patient');
    assert.equal((await read({ patient_user_id: patient }, 'admin'))[0].patient_display_name, 'Synthetic Patient', 'The independently authorized break-glass path is unchanged');
  } finally { await client.query('ROLLBACK'); client.release(); await pool.end(); }
});

const clinicalAccess = require('../services/clinical/clinicalAccessService').assertClinicalAccess;
const clinicianRoles = ['provider', 'doctor', 'consultant', 'physician', 'specialist'];
function clinicalResponse() {
  return { statusCode: 200, headers: {}, status(code) { this.statusCode = code; return this; }, set(name, value) { this.headers[name] = value; return this; }, json(body) { this.body = body; return this; } };
}
function clinicalFixturePool({ related = true, auditFails = false, resultHook } = {}) {
  const queries = [];
  return { queries, async query(sql, params) {
    queries.push({ sql, params: Array.from(params || []) });
    if (sql.includes('INSERT INTO ng_audit_lineage')) { if (auditFails) throw Object.assign(new Error('Synthetic audit unavailable'), { code: '42P01' }); return { rows: [] }; }
    if (/SELECT id FROM ng_providers/.test(sql)) return { rows: [{ id: 'profile' }] };
    if (/SELECT patient_user_id FROM ng_clinical_encounters/.test(sql)) return { rows: [{ patient_user_id: 'patient' }] };
    if (sql.includes('UNION') || /SELECT id\s+FROM ng_clinical_encounters/.test(sql)) return { rows: related ? [{ id: 'relationship' }] : [] };
    if (resultHook) resultHook(sql, params);
    return { rows: [{ id: 'synthetic-record' }] };
  } };
}
function assertActorGate(query, actor = 'clinician') {
  assert.match(query.sql, /EXISTS\s*\(\s*SELECT 1 FROM users actor JOIN ng_providers profile ON profile\.user_id = actor\.id/);
  const bind = query.sql.match(/actor\.id = \$(\d+) AND actor\.role = 'provider'/);
  assert.ok(bind, 'Current clinician authority must be bound in the returning SQL query');
  assert.equal(query.params[Number(bind[1]) - 1], actor);
  assert.match(query.sql, /actor\.is_active = TRUE AND actor\.market_scope = 'NG'/);
  assert.match(query.sql, /actor\.provider_status = 'approved' AND profile\.status = 'verified'/);
}

for (const route of ['/prescriptions', '/encounters', '/diagnoses']) test(`clinical ${route} list binds current clinician authority in each returning query`, async () => {
  for (const role of clinicianRoles) for (const idKey of ['id', 'userId', 'sub']) {
    const pool = clinicalFixturePool(), response = clinicalResponse();
    await referralReadHandler(pool, clinicalAccess, route)({ user: { [idKey]: 'clinician', role }, query: {} }, response);
    assert.equal(response.statusCode, 200, `${route} ${role} ${idKey}`);
    assertActorGate(pool.queries.at(-1));
    assert.match(pool.queries.at(-1).sql, new RegExp((route === '/prescriptions' ? 'prescriber' : 'provider') + '_user_id = \\$1'));
    assert.equal(response.headers['Cache-Control'], 'private, no-store');
  }
});

test('targeted diagnoses retain relationship checks and apply current authority to patient, encounter and combined filters', async () => {
  for (const query of [{ patient_user_id: 'patient' }, { encounter_id: 'encounter' }, { patient_user_id: 'patient', encounter_id: 'encounter', clinical_status: 'active' }]) for (const role of clinicianRoles) for (const idKey of ['id', 'userId', 'sub']) {
    const pool = clinicalFixturePool(), response = clinicalResponse();
    await referralReadHandler(pool, clinicalAccess, '/diagnoses')({ user: { [idKey]: 'clinician', role }, query }, response);
    assert.equal(response.statusCode, 200);
    const data = pool.queries.at(-1); assertActorGate(data);
    assert.match(data.sql, /patient_user_id = \$\d+/); assert.ok(data.params.includes('patient'));
    assert.ok(pool.queries.some(entry => /SELECT id FROM ng_providers/.test(entry.sql)), 'Existing real profile check remains');
    assert.ok(pool.queries.some(entry => entry.sql.includes('UNION') || /SELECT id\s+FROM ng_clinical_encounters/.test(entry.sql)), 'Existing real relationship check remains');
    if (query.encounter_id) { assert.match(data.sql, /AND encounter_id = \$\d+/); assert.ok(data.params.includes('encounter')); }
    if (query.clinical_status) { assert.match(data.sql, /AND clinical_status = \$\d+/); assert.ok(data.params.includes('active')); }
    if (!query.patient_user_id) assertActorGate(pool.queries[0]);
  }
});

test('patient self clinical lists remain self-scoped without requiring clinician credentials', async () => {
  for (const route of ['/prescriptions', '/encounters', '/diagnoses']) {
    const pool = clinicalFixturePool(), response = clinicalResponse();
    await referralReadHandler(pool, clinicalAccess, route)({ user: { id: 'patient', role: 'patient' }, query: {} }, response);
    assert.equal(response.statusCode, 200); assert.match(pool.queries.at(-1).sql, /patient_user_id = \$1/);
    assert.equal(pool.queries.at(-1).params[0], 'patient'); assert.doesNotMatch(pool.queries.at(-1).sql, /FROM users actor/);
    assert.equal(response.headers['Cache-Control'], 'private, no-store');
  }
  const pool = clinicalFixturePool(), response = clinicalResponse();
  await referralReadHandler(pool, clinicalAccess, '/diagnoses')({ user: { id: 'patient', role: 'patient' }, query: { patient_user_id: 'someone-else' } }, response);
  assert.equal(response.statusCode, 403); assert.equal(pool.queries.length, 0);
});

test('diagnosis relationship denials and admin break-glass audits retain real enforcement', async () => {
  const unrelated = clinicalFixturePool({ related: false }), denied = clinicalResponse();
  await referralReadHandler(unrelated, clinicalAccess, '/diagnoses')({ user: { id: 'clinician', role: 'provider' }, query: { patient_user_id: 'patient' } }, denied);
  assert.equal(denied.statusCode, 403); assert.ok(unrelated.queries.every(entry => !entry.sql.includes('FROM ng_diagnoses')));
  for (const [reason, auditFails, expected] of [[null, false, 403], ['Synthetic safety investigation', true, 503], ['Synthetic safety investigation', false, 200]]) {
    const pool = clinicalFixturePool({ auditFails }), response = clinicalResponse();
    await referralReadHandler(pool, clinicalAccess, '/diagnoses')({ user: { id: 'admin', role: 'admin' }, query: { patient_user_id: 'patient' }, headers: { 'x-break-glass-reason': reason } }, response);
    assert.equal(response.statusCode, expected);
    if (expected === 200) { assert.ok(pool.queries[0].sql.includes('INSERT INTO ng_audit_lineage')); assert.doesNotMatch(pool.queries.at(-1).sql, /FROM users actor/); }
    else assert.ok(pool.queries.every(entry => !entry.sql.includes('FROM ng_diagnoses')));
  }
  for (const route of ['/prescriptions', '/encounters', '/diagnoses']) for (const role of ['admin', 'pharmacy', 'nurse', '']) {
    const pool = clinicalFixturePool(), response = clinicalResponse();
    await referralReadHandler(pool, clinicalAccess, route)({ user: { id: 'unscoped', role }, query: {} }, response);
    assert.ok([400, 403].includes(response.statusCode)); assert.equal(pool.queries.length, 0);
  }
});

test('PostgreSQL clinical lists and targeted diagnoses enforce current authority while retaining self and audited access', { skip: !process.env.SIMULATION_DATABASE_URL }, async () => {
  const { randomUUID } = require('node:crypto');
  const { pool, client } = await isolatedClinicalConnection();
  const actor = randomUUID(), other = randomUUID(), patient = randomUUID(), unrelated = randomUUID(), profile = randomUUID(), encounter = randomUUID(), otherEncounter = randomUUID();
  const routes = ['/prescriptions', '/encounters', '/diagnoses'];
  try {
    await client.query('BEGIN');
    // Real route SQL, temporary synthetic tables, and the real clinical access service.
    await client.query('CREATE TEMP TABLE users (id uuid PRIMARY KEY, role text, is_active boolean, market_scope text, provider_status text) ON COMMIT DROP');
    await client.query('CREATE TEMP TABLE ng_providers (id uuid, user_id uuid, status text) ON COMMIT DROP');
    await client.query('CREATE TEMP TABLE ng_clinical_encounters (id uuid, patient_user_id uuid, provider_user_id uuid, status text, created_at timestamptz, started_at timestamptz, encounter_type text, chief_complaint text) ON COMMIT DROP');
    await client.query('CREATE TEMP TABLE ng_prescriptions (id uuid, patient_user_id uuid, prescriber_user_id uuid, created_at timestamptz) ON COMMIT DROP');
    await client.query('CREATE TEMP TABLE ng_diagnoses (id uuid, patient_user_id uuid, provider_user_id uuid, encounter_id uuid, clinical_status text, created_at timestamptz) ON COMMIT DROP');
    await client.query('CREATE TEMP TABLE ng_appointments (id uuid, patient_user_id uuid, provider_id uuid) ON COMMIT DROP');
    await client.query('CREATE TEMP TABLE provider_patient_relationships (id uuid, patient_id uuid, provider_id uuid, is_active boolean) ON COMMIT DROP');
    await client.query('CREATE TEMP TABLE ng_audit_lineage (actor_user_id uuid, action text, resource_type text, resource_id uuid, data_class text, ip_address text, user_agent text, metadata_json jsonb) ON COMMIT DROP');
    await client.query("INSERT INTO users VALUES ($1,'provider',TRUE,'NG','approved'),($2,'provider',TRUE,'NG','approved'),($3,'patient',TRUE,'NG',NULL),($4,'patient',TRUE,'NG',NULL)", [actor, other, patient, unrelated]);
    await client.query("INSERT INTO ng_providers VALUES ($1,$2,'verified')", [profile, actor]);
    for (const [clinician, subject, encounterId] of [[actor, patient, encounter], [other, unrelated, otherEncounter]]) {
      await client.query("INSERT INTO ng_clinical_encounters VALUES ($1,$2,$3,'draft',NOW(),NOW(),'telehealth','Synthetic complaint')", [encounterId, subject, clinician]);
      await client.query('INSERT INTO ng_prescriptions VALUES ($1,$2,$3,NOW())', [randomUUID(), subject, clinician]);
      await client.query("INSERT INTO ng_diagnoses VALUES ($1,$2,$3,$4,'active',NOW())", [randomUUID(), subject, clinician, encounterId]);
    }
    const read = async (route, query = {}, role = 'provider', id = actor, headers = {}) => {
      const response = clinicalResponse();
      await referralReadHandler(client, clinicalAccess, route)({ user: { id, role, marketScope: 'NG' }, query, headers }, response);
      return response;
    };
    for (const route of routes) {
      const response = await read(route); assert.equal(response.statusCode, 200); assert.equal(response.body[route.slice(1)].length, 1); assert.equal(response.body[route.slice(1)][0].patient_user_id, patient);
      const self = await read(route, {}, 'patient', patient); assert.equal(self.statusCode, 200); assert.equal(self.body[route.slice(1)].length, 1);
    }
    for (const query of [{ patient_user_id: patient }, { encounter_id: encounter }, { patient_user_id: patient, encounter_id: encounter, clinical_status: 'active' }]) assert.equal((await read('/diagnoses', query)).body.diagnoses.length, 1);
    assert.equal((await read('/diagnoses', { patient_user_id: patient, encounter_id: otherEncounter })).body.diagnoses.length, 0, 'Patient and encounter predicates remain conjunctive');
    for (const statement of [
      "UPDATE users SET market_scope='US' WHERE id=$1", 'UPDATE users SET is_active=FALSE WHERE id=$1',
      "UPDATE users SET provider_status='pending' WHERE id=$1", "UPDATE users SET role='patient' WHERE id=$1",
      "UPDATE ng_providers SET status='suspended' WHERE user_id=$1", "UPDATE ng_providers SET status='pending' WHERE user_id=$1", 'DELETE FROM ng_providers WHERE user_id=$1',
    ]) {
      await client.query('SAVEPOINT revoke'); await client.query(statement, [actor]);
      for (const route of routes) { const response = await read(route); assert.equal(response.statusCode, 200); assert.deepEqual(response.body[route.slice(1)], [], statement); }
      for (const query of [{ patient_user_id: patient }, { encounter_id: encounter }]) {
        const response = await read('/diagnoses', query); assert.ok([200, 403, 404].includes(response.statusCode)); assert.equal(response.body.diagnoses?.length || 0, 0, 'Targeting cannot bypass current clinician authority');
      }
      await client.query('ROLLBACK TO SAVEPOINT revoke');
    }
    await client.query('SAVEPOINT concurrent_revoke');
    const revokingPool = { async query(sql, params) {
      if (sql.includes('SELECT * FROM ng_diagnoses')) await client.query("UPDATE ng_providers SET status='suspended' WHERE user_id=$1", [actor]);
      return client.query(sql, params);
    } };
    const raced = clinicalResponse();
    await referralReadHandler(revokingPool, clinicalAccess, '/diagnoses')({ user: { id: actor, role: 'provider' }, query: { patient_user_id: patient } }, raced);
    assert.equal(raced.statusCode, 200); assert.deepEqual(raced.body.diagnoses, [], 'Revocation after relationship precheck is still enforced in the returning query');
    await client.query('ROLLBACK TO SAVEPOINT concurrent_revoke');
    assert.equal((await read('/diagnoses', { patient_user_id: unrelated })).statusCode, 403);
    assert.equal((await read('/diagnoses', { patient_user_id: unrelated }, 'patient', patient)).statusCode, 403);
    assert.equal((await read('/diagnoses', { patient_user_id: patient }, 'admin', other)).statusCode, 403);
    const admin = await read('/diagnoses', { patient_user_id: patient }, 'admin', other, { 'x-break-glass-reason': 'Synthetic patient safety audit' });
    assert.equal(admin.statusCode, 200); assert.equal(admin.body.diagnoses.length, 1);
    assert.equal((await client.query('SELECT COUNT(*)::int AS count FROM ng_audit_lineage')).rows[0].count, 1);
  } finally { await client.query('ROLLBACK'); client.release(); await pool.end(); }
});
