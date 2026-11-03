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
    const doctor = (await client.query(`SELECT u.id FROM users u JOIN ng_programme_memberships m ON m.user_id=u.id
      WHERE u.email='doctor@demo.doctarx.com' AND u.is_active=TRUE AND m.role='remote_clinician'
        AND m.status='active' AND m.programme_id=$1 AND (m.facility_id=$2 OR m.facility_id IS NULL) LIMIT 1`, [nurse.programme_id, nurse.facility_id])).rows[0];
    assert.ok(doctor, 'Existing provisioned clinician membership is required');
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

    const referralIds = [crypto.randomUUID(), crypto.randomUUID()];
    const insertReferral = async (id, overrides = {}) => client.query(`INSERT INTO ng_referrals
      (id,patient_user_id,provider_user_id,encounter_id,programme_id,facility_id,status,priority,created_at,target_name,reason_encrypted,due_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,'routine',$8,'Private synthetic recipient','not-decrypted-by-metadata',NOW()+INTERVAL '1 day')`,
      [id, overrides.patient || enrollment.patient_user_id, doctor.id,
        overrides.otherEncounter ? null : encounterId,
        overrides.otherProgramme ? null : nurse.programme_id,
        overrides.otherFacility ? null : nurse.facility_id,
        overrides.status || 'sent', new Date(Date.now() + (overrides.order || 0) * 1000)]);
    await insertReferral(referralIds[0]); await insertReferral(referralIds[1], { status:'completed', order:1 });
    for (const mismatch of [{ otherEncounter:true }, { otherProgramme:true }, { otherFacility:true }, { patient:government.id }]) await insertReferral(crypto.randomUUID(), mismatch);
    const referralSnapshot = (await client.query('SELECT * FROM ng_referrals WHERE id=ANY($1::uuid[]) ORDER BY id', [referralIds])).rows;

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

    // Synthetic stored results exercise the real nullable legacy status column.
    // No lab partner, ordering, result-ingestion or acknowledgment workflow is
    // implied: these transient records and read audits roll back below.
    const labIds = [crypto.randomUUID(), crypto.randomUUID()];
    const insertLab = (id, patientId, encounter) => client.query(`INSERT INTO ng_lab_results
      (id,patient_user_id,encounter_id,test_name,result_value,unit,abnormal_flag,status)
      VALUES ($1,$2,$3,'Private synthetic laboratory result','0','synthetic units','Critical - recorded by source','final')`,
    [id, patientId, encounter]);
    for (const id of labIds) await insertLab(id, enrollment.patient_user_id, encounterId);
    await insertLab(crypto.randomUUID(), government.id, encounterId);
    await insertLab(crypto.randomUUID(), enrollment.patient_user_id, null);
    const labQuery = { encounter: encounterId };
    const labRead = () => request('DiagnosticReport', { query: labQuery });
    const laboratory = await labRead();
    assert.equal(laboratory.status, 200); assert.equal(laboratory.body.total, 2);
    assert.deepEqual(laboratory.body.entry.map(entry => entry.resource.id).sort(), [...labIds].sort());
    assert.equal(laboratory.body.entry[0].resource.contained[0].valueString, '0');
    assert.equal(laboratory.body.entry[0].resource.contained[0].interpretation[0].text, 'Critical - recorded by source');
    for (const state of ['registered', 'partial', 'final', 'amended', 'cancelled']) {
      await client.query('UPDATE ng_lab_results SET status=$2 WHERE id=$1', [labIds[0], state]);
      const response = await labRead(); assert.equal(response.status, 200);
      const report = response.body.entry.find(entry => entry.resource.id === labIds[0]).resource;
      assert.equal(report.status, state); assert.equal(report.contained[0].status, state === 'partial' ? 'preliminary' : state);
    }
    await client.query('SAVEPOINT malformed_laboratory');
    await client.query('UPDATE ng_lab_results SET status=NULL WHERE id=$1', [labIds[0]]);
    const missingStatus = await request('DiagnosticReport', { query: { ...labQuery, _count: '1' } });
    assert.equal(missingStatus.status, 503); assert.equal(missingStatus.body.resourceType, 'OperationOutcome');
    assert.ok(!JSON.stringify(missingStatus.body).includes(enrollment.patient_user_id));
    assert.ok(!JSON.stringify(missingStatus.body).includes('Private synthetic laboratory result'));
    await client.query("UPDATE ng_lab_results SET status='final',test_name='  ',loinc_code=NULL WHERE id=$1", [labIds[0]]);
    assert.equal((await labRead()).status, 503);
    await client.query('ROLLBACK TO SAVEPOINT malformed_laboratory'); await client.query('RELEASE SAVEPOINT malformed_laboratory');
    await client.query("UPDATE ng_lab_results SET result_value='  ' WHERE id=$1", [labIds[0]]);
    const blankResult = await labRead(); assert.equal(blankResult.status, 200);
    const blankObservation = blankResult.body.entry.find(entry => entry.resource.id === labIds[0]).resource.contained[0];
    assert.equal(blankObservation.valueString, undefined); assert.equal(blankObservation.dataAbsentReason.coding[0].code, 'unknown');

    const referralQuery = { encounter:encounterId, _count:'1' };
    const referralRequest = options => request('ServiceRequest', { userId:doctor.id, query:referralQuery, ...options });
    const firstReferral = await referralRequest();
    assert.equal(firstReferral.status,200); assert.equal(firstReferral.headers.get('cache-control'),'private, no-store');
    assert.equal(firstReferral.body.entry[0].fullUrl,'urn:uuid:'+referralIds[0]);
    assert.equal(firstReferral.body.entry[0].resource.subject.identifier.value,enrollment.patient_user_id);
    assert.equal(firstReferral.body.entry.length,1); assert.equal(firstReferral.body.entry[0].resource.id,referralIds[0]);
    assert.equal(firstReferral.body.entry[0].resource.status,'active'); assert.equal(firstReferral.body.total,undefined);
    assert.ok(firstReferral.body.link[0].url.includes('_offset=1'));
    assert.ok(!JSON.stringify(firstReferral.body).includes('Private synthetic') && !JSON.stringify(firstReferral.body).includes('not-decrypted'));
    assert.deepEqual(Object.keys(firstReferral.body.entry[0].resource).sort(), ['resourceType','id','status','intent','priority','subject','encounter','requester','authoredOn'].sort());
    const secondReferral=await referralRequest({query:{...referralQuery,_offset:'1'}});
    assert.equal(secondReferral.body.entry[0].resource.id,referralIds[1]); assert.equal(secondReferral.body.link,undefined);
    for (const userId of [nurse.id,government.id,enrollment.patient_user_id]) assert.equal((await referralRequest({userId})).status,403);
    assert.equal((await referralRequest({query:{...referralQuery,facilityId:crypto.randomUUID()}})).status,403);
    assert.equal((await referralRequest({query:{encounter:crypto.randomUUID()}})).status,404);
    assert.equal((await referralRequest({query:{...referralQuery,_count:'201'}})).status,400);
    assert.equal((await referralRequest({method:'POST'})).status,404);
    await client.query('SAVEPOINT declined_referral');
    await client.query("UPDATE ng_referrals SET status='declined' WHERE id=$1",[referralIds[0]]);
    const declined=await referralRequest(); assert.equal(declined.status,503); assert.equal(declined.body.resourceType,'OperationOutcome');
    assert.ok(!JSON.stringify(declined.body).includes(enrollment.patient_user_id));
    await client.query('ROLLBACK TO SAVEPOINT declined_referral'); await client.query('RELEASE SAVEPOINT declined_referral');
    assert.deepEqual((await client.query('SELECT * FROM ng_referrals WHERE id=ANY($1::uuid[]) ORDER BY id',[referralIds])).rows,referralSnapshot);

    await client.query('SAVEPOINT consent_denial');
    await client.query("UPDATE ng_programme_patient_enrollments SET consent_status='revoked' WHERE id=$1", [enrollment.id]);
    // Metadata contains no patient material and does not depend on any selected
    // patient's consent; all advertised clinical reads still enforce it.
    assert.equal((await request('metadata')).status, 200);
    for (const [resource, query] of [['Patient/' + enrollment.patient_user_id, {}], ['Encounter/' + encounterId, {}], ['Observation', { encounter: encounterId }]]) assert.equal((await request(resource, { query })).status, 409);
    assert.equal((await referralRequest()).status,409);
    assert.equal((await labRead()).status,409);
    await client.query('ROLLBACK TO SAVEPOINT consent_denial'); await client.query('RELEASE SAVEPOINT consent_denial');
    await client.query('SAVEPOINT membership_denial');
    await client.query("UPDATE ng_programme_memberships SET expires_at=NOW()-INTERVAL '1 second' WHERE id=$1", [nurse.membership_id]);
    assert.equal((await request('metadata')).status, 403); assert.equal((await request('Patient/' + enrollment.patient_user_id)).status, 403);
    await client.query('ROLLBACK TO SAVEPOINT membership_denial'); await client.query('RELEASE SAVEPOINT membership_denial');
    auditFailure = true;
    const unavailable = await request('Patient/' + enrollment.patient_user_id);
    assert.equal(unavailable.status, 500); assert.equal(unavailable.body.resourceType, 'OperationOutcome');
    assert.equal(JSON.stringify(unavailable.body).includes(enrollment.patient_user_id), false);
    const referralAuditDenied=await referralRequest(); assert.equal(referralAuditDenied.status,500); assert.ok(!JSON.stringify(referralAuditDenied.body).includes(enrollment.patient_user_id));
    const labAuditDenied = await labRead(); assert.equal(labAuditDenied.status, 500); assert.ok(!JSON.stringify(labAuditDenied.body).includes(enrollment.patient_user_id));
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
