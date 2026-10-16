'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const Module = require('node:module');
const express = require('express');
const jwt = require('jsonwebtoken');

const target = process.env.SIMULATION_DATABASE_URL;

test('PostgreSQL PHC metadata and advertised HTTP reads retain current authentication, scope and consent boundaries', { skip: !target }, async () => {
  const url = new URL(target);
  assert.ok(['localhost', '127.0.0.1'].includes(url.hostname) && url.pathname.endsWith('_test'), 'Use only an isolated loopback test database ending in _test');
  const { Pool } = require('pg');
  const pool = new Pool({ connectionString: target }); const client = await pool.connect();
  const previousSecret = process.env.JWT_ACCESS_SECRET;
  process.env.JWT_ACCESS_SECRET = 'doctarx-isolated-fhir-capability-test-secret-32-characters';
  const routeFile = require.resolve('../routes/clinicalFhir');
  const middlewareFile = require.resolve('../middleware/programmeScope');
  const authFile = require.resolve('../../server/middleware/auth');
  const membershipFile = require.resolve('../../server/services/consumerMembershipService');
  const oldCache = new Map([routeFile, middlewareFile, authFile, membershipFile].map(file => [file, require.cache[file]]));
  let server; let auditFailure = false;
  const requests = [];
  const routePool = { async query(sql, parameters) {
    requests.push(sql);
    if (auditFailure && sql.includes('INSERT INTO ng_programme_audit_events')) throw new Error('Isolated unavailable audit, no patient information');
    return client.query(sql, parameters);
  } };
  try {
    await client.query('BEGIN');
    // Authentication uses already provisioned demo accounts. Only transient
    // clinical fixtures and savepoint-scoped access changes are written;
    // the outer transaction rolls all of them back, including read audits.
    const nurse = (await client.query(`SELECT u.id, m.id AS membership_id, m.programme_id, m.facility_id, pf.id AS programme_facility_id
      FROM users u JOIN ng_programme_memberships m ON m.user_id=u.id
      JOIN ng_programme_facilities pf ON pf.programme_id=m.programme_id AND pf.facility_id=m.facility_id
      WHERE u.email='nurse@demo.doctarx.com' AND u.is_active=TRUE AND u.market_scope='NG'
        AND m.role='phc_nurse' AND m.status='active' AND pf.status='active' LIMIT 1`)).rows[0];
    assert.ok(nurse, 'Existing provisioned nurse membership is required; no accounts are seeded or reset');
    const enrollment = (await client.query(`SELECT e.id, e.patient_user_id FROM ng_programme_patient_enrollments e
      JOIN users u ON u.id=e.patient_user_id WHERE u.email='patient@demo.doctarx.com' AND u.role='patient' AND u.is_active=TRUE
        AND e.programme_id=$1 AND e.facility_id=$2 AND e.status='active' AND e.consent_status='granted' LIMIT 1`, [nurse.programme_id, nurse.facility_id])).rows[0];
    const government = (await client.query("SELECT id FROM users WHERE email='government@demo.doctarx.com' AND is_active=TRUE LIMIT 1")).rows[0];
    assert.ok(enrollment && government, 'Existing provisioned patient enrollment and government account are required');
    const encounterId = crypto.randomUUID();
    await client.query(`INSERT INTO ng_clinical_encounters
      (id,patient_user_id,hospital_id,facility_id,programme_id,programme_facility_id,enrollment_id,opened_by_user_id,status)
      VALUES ($1,$2,$3,$3,$4,$5,$6,$7,'draft')`,
    [encounterId, enrollment.patient_user_id, nurse.facility_id, nurse.programme_id, nurse.programme_facility_id, enrollment.id, nurse.id]);
    const observationIds = [crypto.randomUUID(), crypto.randomUUID()];
    for (const [index, id] of observationIds.entries()) await client.query(`INSERT INTO ng_clinical_observations
      (id,programme_id,facility_id,patient_user_id,encounter_id,observation_code,display_name,value_type,value_numeric,unit,method,status,observed_at,entered_by,idempotency_key)
      VALUES ($1,$2,$3,$4,$5,'8310-5','Body temperature','numeric',37.1,'Cel','manual','final',$6,$7,$8)`,
    [id, nurse.programme_id, nurse.facility_id, enrollment.patient_user_id, encounterId, new Date(Date.now() + index * 1000), nurse.id, crypto.randomUUID()]);

    const originalLoad = Module._load;
    let router; let authenticate;
    try {
      for (const file of oldCache.keys()) delete require.cache[file];
      Module._load = function isolatedFhirDatabase(request, parent) {
        if ([routeFile, middlewareFile].includes(parent?.filename) && request === '../../server/db') return { getPool: () => routePool };
        if ([authFile, membershipFile].includes(parent?.filename) && request === '../db') return { query: (...args) => routePool.query(...args), getPool: () => routePool };
        return originalLoad.apply(this, arguments);
      };
      router = require(routeFile); authenticate = require(authFile).authenticate;
    } finally { Module._load = originalLoad; }
    const app = express(); app.use(require('cookie-parser')()); app.use('/api/ng/interop/fhir', authenticate, router);
    server = await new Promise(resolve => { const listener = app.listen(0, '127.0.0.1', () => resolve(listener)); });
    const token = userId => jwt.sign({ userId }, process.env.JWT_ACCESS_SECRET, { expiresIn: '5m' });
    async function request(resource, { userId = nurse.id, query = {}, scope = true, headers = {}, cookie = false, method = 'GET' } = {}) {
      const params = new URLSearchParams({ ...(scope ? { programmeId: nurse.programme_id, facilityId: nurse.facility_id } : {}), ...query });
      const authHeaders = userId ? (cookie ? { Cookie: 'accessToken=' + token(userId) } : { Authorization: 'Bearer ' + token(userId) }) : {};
      const response = await fetch('http://127.0.0.1:' + server.address().port + '/api/ng/interop/fhir/' + resource + '?' + params, { method, headers: { ...authHeaders, ...headers } });
      return { status: response.status, headers: response.headers, body: response.headers.get('content-type')?.includes('json') ? await response.json() : null };
    }

    requests.length = 0;
    const metadata = await request('metadata');
    assert.equal(metadata.status, 200); assert.equal(metadata.body.fhirVersion, '4.0.1');
    assert.equal(metadata.headers.get('cache-control'), 'private, no-store'); assert.ok(metadata.headers.get('content-type').startsWith('application/fhir+json'));
    const serialized = JSON.stringify(metadata.body);
    for (const privateId of [nurse.id, nurse.programme_id, nurse.facility_id, enrollment.patient_user_id, encounterId, ...observationIds]) assert.equal(serialized.includes(privateId), false);
    assert.ok(requests.every(sql => !/ng_clinical_|ng_programme_patient_enrollments|INSERT/.test(sql)));
    const cookieMetadata = await request('metadata', { cookie: true }); assert.equal(cookieMetadata.status, 200); assert.equal(cookieMetadata.headers.get('etag'), metadata.headers.get('etag'));
    assert.equal((await request('metadata', { userId: null })).status, 401);
    assert.equal((await request('metadata', { userId: null, headers: { Authorization: 'Bearer invalid' } })).status, 401);
    assert.equal((await request('metadata', { scope: false })).status, 400);
    assert.equal((await request('metadata', { query: { facilityId: crypto.randomUUID() } })).status, 403);
    assert.equal((await request('metadata', { userId: government.id })).status, 403);
    assert.equal((await request('metadata', { userId: enrollment.patient_user_id })).status, 403);
    assert.equal((await request('metadata', { query: { _format: 'xml' } })).status, 406);

    const patient = await request('Patient/' + enrollment.patient_user_id);
    assert.equal(patient.status, 200); assert.equal(patient.body.resourceType, 'Patient'); assert.equal(patient.body.id, enrollment.patient_user_id);
    const encounter = await request('Encounter/' + encounterId);
    assert.equal(encounter.status, 200); assert.equal(encounter.body.subject.reference, 'Patient/' + enrollment.patient_user_id);
    const observations = await request('Observation', { query: { encounter: encounterId, _count: '1' } });
    assert.equal(observations.status, 200); assert.equal(observations.body.total, 2); assert.equal(observations.body.entry.length, 1);
    assert.equal(observations.body.entry[0].resource.id, observationIds[0]); assert.equal(observations.body.entry[0].resource.valueQuantity.code, 'Cel');
    assert.ok(observations.body.link[0].url.includes('_offset=1'));
    assert.equal((await request('Observation', { query: { encounter: encounterId, _count: '1', _offset: '1' } })).body.entry[0].resource.id, observationIds[1]);
    assert.equal((await request('Patient/' + government.id)).status, 403);
    assert.equal((await request('Encounter/' + crypto.randomUUID())).status, 404);
    assert.equal((await request('Observation')).status, 400);
    assert.equal((await request('Observation/' + observationIds[0])).status, 404);
    assert.equal((await request('Patient/' + enrollment.patient_user_id, { method: 'POST' })).status, 404);

    await client.query('SAVEPOINT consent_denial');
    await client.query("UPDATE ng_programme_patient_enrollments SET consent_status='revoked' WHERE id=$1", [enrollment.id]);
    // Metadata contains no patient material and does not depend on any selected
    // patient's consent; all advertised clinical reads still enforce it.
    assert.equal((await request('metadata')).status, 200);
    for (const [resource, query] of [['Patient/' + enrollment.patient_user_id, {}], ['Encounter/' + encounterId, {}], ['Observation', { encounter: encounterId }]]) assert.equal((await request(resource, { query })).status, 409);
    await client.query('ROLLBACK TO SAVEPOINT consent_denial'); await client.query('RELEASE SAVEPOINT consent_denial');
    await client.query('SAVEPOINT membership_denial');
    await client.query("UPDATE ng_programme_memberships SET expires_at=NOW()-INTERVAL '1 second' WHERE id=$1", [nurse.membership_id]);
    assert.equal((await request('metadata')).status, 403); assert.equal((await request('Patient/' + enrollment.patient_user_id)).status, 403);
    await client.query('ROLLBACK TO SAVEPOINT membership_denial'); await client.query('RELEASE SAVEPOINT membership_denial');
    auditFailure = true;
    const unavailable = await request('Patient/' + enrollment.patient_user_id);
    assert.equal(unavailable.status, 500); assert.equal(unavailable.body.resourceType, 'OperationOutcome');
    assert.equal(JSON.stringify(unavailable.body).includes(enrollment.patient_user_id), false);
    auditFailure = false;
    const audited = (await client.query("SELECT count(*)::int AS count FROM ng_programme_audit_events WHERE action='fhir_read' AND actor_user_id=$1 AND resource_id=ANY($2::uuid[])", [nurse.id, [encounterId, enrollment.patient_user_id]])).rows[0];
    assert.ok(audited.count >= 4);
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    await client.query('ROLLBACK'); client.release(); await pool.end();
    for (const [file, cached] of oldCache) { if (cached) require.cache[file] = cached; else delete require.cache[file]; }
    if (previousSecret === undefined) delete process.env.JWT_ACCESS_SECRET; else process.env.JWT_ACCESS_SECRET = previousSecret;
  }
});
