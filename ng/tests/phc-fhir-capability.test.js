'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const express = require('express');
const capability = require('../services/interop/phcFhirCapabilityService');
const assertR4 = require('./helpers/fhir-r4-schema');

const ids = {
  actor: '00000000-0000-4000-8000-000000000001', programme: '00000000-0000-4000-8000-000000000002',
  facility: '00000000-0000-4000-8000-000000000003', patient: '00000000-0000-4000-8000-000000000004',
  encounter: '00000000-0000-4000-8000-000000000005', observation: '00000000-0000-4000-8000-000000000006',
};
let state; let actor;
const calls = [];
const pool = {
  async query(sql, params = []) {
    calls.push({ sql, params });
    if (sql.includes('FROM users') && !sql.includes('FROM users u')) return { rows: [{ id: ids.actor, role: 'provider', is_active: state.active !== false, is_test_account: false }] };
    if (sql.includes('FROM public_health_programmes p')) {
      assert.deepEqual(params, [ids.programme, ids.facility]);
      return { rows: state.context === false ? [] : [{ programme_id: ids.programme, facility_id: ids.facility,
        programme_status: 'active', programme_facility_status: 'active', demo_only: false }] };
    }
    if (sql.includes('FROM ng_programme_memberships')) return { rows: state.membership === false ? [] : [{ id: ids.actor, role: state.role || 'phc_nurse', permissions_json: {}, can_export: false, can_approve: false }] };
    if (sql.includes('FROM ng_programme_patient_enrollments')) {
      assert.deepEqual(params, [ids.programme, ids.facility, ids.patient]);
      return { rows: state.enrollment === false ? [] : [{ id: ids.patient, status: 'active', consent_status: state.consent || 'granted' }] };
    }
    if (sql.includes('FROM ng_clinical_encounters e')) {
      assert.deepEqual(params, [ids.encounter, ids.programme, ids.facility]);
      return { rows: state.encounter === false ? [] : [{ id: ids.encounter, patient_user_id: ids.patient, facility_id: ids.facility,
        created_at: new Date('2026-10-01T12:00:00Z'), updated_at: new Date('2026-10-01T12:00:00Z'), record_version: 2, chief_complaint: 'Private clinical fixture' }] };
    }
    if (sql.includes('FROM ng_clinical_observations')) {
      assert.deepEqual(params, [ids.encounter, ids.programme, ids.facility]);
      return { rows: [0, 1, 2].map(index => ({ id: index ? ids.observation.slice(0, -1) + (6 + index) : ids.observation,
        patient_user_id: ids.patient, encounter_id: ids.encounter, status: 'final', code_system: 'http://loinc.org', observation_code: '8310-5',
        display_name: 'Body temperature', value_type: 'numeric', value_numeric: '37.1', unit: '°C', observed_at: new Date('2026-10-01T12:00:00Z'), entered_by: ids.actor })) };
    }
    if(sql.includes('FROM ng_patient_allergies') || sql.includes('FROM ng_problem_list_items')) {assert.equal(params[0],ids.patient);return{rows:[]};}
    if (sql.includes('FROM ng_referrals')) {
      assert.deepEqual(params.slice(0, 4), [ids.programme, ids.facility, ids.encounter, ids.patient]);
      assert.ok(!sql.includes('SELECT *') && !/reason|clinical_notes|response_summary|target_name|due_at/.test(sql));
      return { rows: state.referralRawRows || (state.referrals || []).slice(params[5], params[5] + params[4]) };
    }
    if(sql.includes('FROM ng_lab_results')) {assert.deepEqual(params,[ids.encounter,ids.patient]);return{rows:state.labRows || []};}
    if (sql.includes('FROM users u')) return { rows: [{ id: ids.patient, first_name: 'Private', last_name: 'Patient fixture', email: 'private-patient@example.invalid', is_active: true, updated_at: new Date('2026-10-01T12:00:00Z') }] };
    if (sql.includes('INSERT INTO ng_programme_audit_events')) {
      if (state.auditFailure) throw new Error('Private audit outage detail');
      return { rows: [], rowCount: 1 };
    }
    throw new Error('Unexpected PHC FHIR database operation');
  },
};

const routeFile = require.resolve('../routes/clinicalFhir');
const middlewareFile = require.resolve('../middleware/programmeScope');
const load = Module._load;
let router;
try {
  Module._load = function isolatedFhirDependencies(request, parent) {
    if ([routeFile, middlewareFile].includes(parent?.filename) && request === '../../server/db') return { getPool: () => pool };
    return load.apply(this, arguments);
  };
  delete require.cache[routeFile]; delete require.cache[middlewareFile]; router = require(routeFile);
} finally { Module._load = load; }

function reset(overrides = {}) { state = { ...overrides }; actor = { id: ids.actor, role: 'provider' }; calls.length = 0; }
async function withHTTP(run) {
  const app = express(); app.use((req, _res, next) => { req.user = actor; next(); }); app.use('/api/ng/interop/fhir', router);
  const server = await new Promise(resolve => { const listener = app.listen(0, '127.0.0.1', () => resolve(listener)); });
  try {
    await run(async (resource, { query = {}, headers = {}, scoped = true, method = 'GET' } = {}) => {
      const params = new URLSearchParams({ ...(scoped ? { programmeId: ids.programme, facilityId: ids.facility } : {}), ...query });
      const response = await fetch('http://127.0.0.1:' + server.address().port + '/api/ng/interop/fhir/' + resource + '?' + params, { method, headers });
      const contentType = response.headers.get('content-type') || '';
      return { status: response.status, headers: response.headers, body: contentType.includes('json') ? await response.json() : null };
    });
  } finally { await new Promise(resolve => server.close(resolve)); }
}

test('CapabilityStatement advertises exactly the active PHC Patient/Encounter reads and encounter-filtered Observation search', () => {
  const statement = capability.getCapabilityStatement();
  assert.equal(statement.resourceType, 'CapabilityStatement'); assert.equal(statement.fhirVersion, '4.0.1');
  assert.equal(statement.kind, 'instance'); assert.ok(statement.date && statement.implementation.description && statement.software.name.includes('DoctaRx'));
  assert.deepEqual(statement.format, ['application/fhir+json']);
  assert.deepEqual(statement.rest[0].resource.map(resource => [resource.type, resource.interaction.map(operation => operation.code)]),
    [['Patient', ['read']], ['Encounter', ['read']], ['Observation', ['search-type']], ['AllergyIntolerance',['search-type']], ['Condition',['search-type']], ['DiagnosticReport',['search-type']], ['ServiceRequest',['search-type']]]);
  assert.deepEqual(statement.rest[0].resource[2].searchParam.map(parameter => [parameter.name, parameter.type]), [['encounter', 'reference']]);
  assert.equal(statement.rest[0].resource.find(resource => resource.type === 'ServiceRequest').searchParam[0].definition, 'http://hl7.org/fhir/SearchParameter/clinical-encounter');
  assert.equal(statement.rest[0].resource[2].searchParam[0].definition, 'http://hl7.org/fhir/SearchParameter/clinical-encounter');
  assert.deepEqual(router.stack.filter(layer => layer.route).map(layer => layer.route.path), ['/metadata', ...Object.values(capability.RESOURCE_PATHS)]);
  assert.ok(statement.rest[0].resource.every(resource => !resource.profile && !resource.supportedProfile && !resource.operation));
  assert.ok(!statement.implementationGuide && !statement.instantiates && !statement.imports && !statement.rest[0].security.service && !statement.rest[0].security.extension);
});

test('metadata JSON negotiation supports R4 and explicit JSON override without advertising XML, SMART or another FHIR release', () => {
  for (const [format, accept] of [[undefined, undefined], [undefined, '*/*'], [undefined, 'application/fhir+json; fhirVersion=4.0'], [undefined, 'application/fhir+json; fhirVersion="4.0.1"'], ['json', 'application/fhir+xml'], ['application/json', 'text/html']]) assert.equal(capability.supportsMetadataJson(format, accept), true);
  for (const [format, accept] of [['xml', '*/*'], [[], '*/*'], [undefined, 'application/fhir+xml'], [undefined, 'application/fhir+json; fhirVersion=5.0'], [undefined, 'application/fhir+json;q=0']]) assert.equal(capability.supportsMetadataJson(format, accept), false);
});

test('authorized metadata contains no patient/context data and does not read clinical or enrollment records', async () => {
  reset();
  await withHTTP(async get => {
    const result = await get('metadata', { headers: { Accept: 'application/fhir+json; fhirVersion=4.0' }, query: { patient: ids.patient } });
    assert.equal(result.status, 200); assert.ok(result.headers.get('content-type').startsWith('application/fhir+json'));
    assert.equal(result.headers.get('cache-control'), 'private, no-store'); assert.ok(result.headers.get('etag'));
    const serialized = JSON.stringify(result.body);
    Object.values(ids).forEach(id => assert.ok(!serialized.includes(id)));
    assert.ok(!serialized.includes('Private clinical fixture') && !serialized.includes('private-patient@example.invalid'));
    assert.ok(calls.every(call => !/ng_clinical_|ng_programme_patient_enrollments|INSERT/.test(call.sql)));
    const wrongVersion = await get('metadata', { headers: { Accept: 'application/fhir+json; fhirVersion=5.0' } });
    assert.equal(wrongVersion.status, 406); assert.equal(wrongVersion.body.resourceType, 'OperationOutcome');
  });
});

test('metadata retains missing-auth/context, inactive account/facility and wrong programme role denials', async () => {
  reset();
  await withHTTP(async get => {
    actor = null; assert.equal((await get('metadata')).status, 401);
    actor = { id: ids.actor, role: 'super_admin' }; assert.equal((await get('metadata', { scoped: false })).status, 400);
    for (const overrides of [{ active: false }, { context: false }, { membership: false }, { role: 'government_analyst' }]) {
      state = overrides; const result = await get('metadata'); assert.equal(result.status, 403); assert.notEqual(result.body.resourceType, 'CapabilityStatement');
    }
  });
});

test('advertised HTTP resource operations still require actual enrollment, consent and scoped encounter access', async () => {
  reset();
  await withHTTP(async get => {
    assert.equal((await get('Patient/' + ids.patient)).body.resourceType, 'Patient');
    assert.equal((await get('Encounter/' + ids.encounter)).body.resourceType, 'Encounter');
    const observations = await get('Observation', { query: { encounter: ids.encounter, _count: '1', _offset: '1' } });
    assert.equal(observations.body.resourceType, 'Bundle'); assert.equal(observations.body.type, 'searchset');
    assert.equal(observations.body.total, 3); assert.equal(observations.body.entry.length, 1); assert.ok(observations.body.link[0].url.includes('_offset=2'));
    assert.equal(observations.body.entry[0].resource.valueQuantity.code, 'Cel');
    assert.equal((await get('Observation')).status, 400);
    for(const type of ['AllergyIntolerance','Condition','DiagnosticReport']) {
      assert.equal((await get(type)).status,400);
      const result=await get(type,{query:{encounter:ids.encounter}});assert.equal(result.status,200);assert.equal(result.body.type,'searchset');assert.equal(result.body.total,0);
    }
    state.enrollment = false; assert.equal((await get('Patient/' + ids.patient)).status, 403);
    state.enrollment = true; state.consent = 'revoked'; assert.equal((await get('Encounter/' + ids.encounter)).status, 409);
    for(const type of ['AllergyIntolerance','Condition','DiagnosticReport'])assert.equal((await get(type,{query:{encounter:ids.encounter}})).status,409);
    state.consent = 'granted'; state.encounter = false; assert.equal((await get('Observation', { query: { encounter: ids.encounter } })).status, 404);
    assert.equal((await get('Patient', { query: { name: 'Private' } })).status, 404);
    assert.equal((await get('Patient/' + ids.patient, { method: 'POST' })).status, 404);
  });
});

const referralFixture = (overrides = {}) => ({ id: ids.observation, patient_user_id: ids.patient,
  encounter_id: ids.encounter, provider_user_id: ids.actor, status: 'sent', priority: 'routine',
  created_at: '2026-10-01T12:00:00Z', ...overrides });

test('minimal referral mapping uses actual request state, never a receiver rejection or deadline as a completed/scheduled service', () => {
  const { toServiceRequest } = require('../services/interop/clinicalFhirService');
  for (const [local, expected] of Object.entries({ draft: 'draft', sent: 'active', accepted: 'active', completed: 'completed', cancelled: 'revoked' })) {
    const result = toServiceRequest(referralFixture({ status: local, reason: 'Private reason', clinical_notes: 'Private notes', due_at: '2026-11-03', target_name: 'Private recipient' }));
    assert.equal(result.status, expected); assert.equal(result.intent, 'order');
    assert.deepEqual(result.subject,{type:'Patient',identifier:{system:'urn:doctarx:patient-user',value:ids.patient}});
    assert.equal(result.encounter.identifier.value,ids.encounter); assert.equal(result.requester.identifier.value,ids.actor);
    assert.deepEqual(Object.keys(result).sort(), ['resourceType','id','status','intent','priority','subject','encounter','requester','authoredOn'].sort());
    assert.ok(!JSON.stringify(result).includes('Private'));
  }
  for (const [local, expected] of Object.entries({ routine: 'routine', urgent: 'urgent', emergency: 'stat' })) assert.equal(toServiceRequest(referralFixture({ priority: local })).priority, expected);
  for (const override of [{ status: 'declined' }, { status: 'unknown' }, { status: '__proto__' }, { priority: 'asap' }, { provider_user_id: null }, { id: '../Patient/private' }, { created_at: 'bad date' }]) {
    assert.throws(() => toServiceRequest(referralFixture(override)), error => error.statusCode === 503 && !error.message.includes('Private'));
  }
});

test('ServiceRequest HTTP enforces referral role, bounded scope and current consent with minimal paged metadata', async () => {
  reset({ role: 'remote_clinician', referrals: [referralFixture(), referralFixture({ id: ids.observation.slice(0,-1)+'7', status:'completed' })] });
  await withHTTP(async get => {
    const query = { encounter: ids.encounter, _count: '1' };
    const first = await get('ServiceRequest', { query });
    assert.equal(first.status, 200); assert.equal(first.headers.get('cache-control'), 'private, no-store');
    assert.equal(first.body.entry[0].fullUrl, 'urn:uuid:'+ids.observation);
    assert.equal(first.body.entry.length, 1); assert.equal(first.body.entry[0].resource.status, 'active');
    assert.equal(first.body.total, undefined); assert.ok(first.body.link[0].url.includes('_offset=1'));
    assert.ok(first.body.link[0].url.includes('programmeId='+ids.programme));
    assert.equal((await get('ServiceRequest', { query: { ...query, _offset: '1' } })).body.entry[0].resource.status, 'completed');
    for (const bad of [{ _count:'0' }, { _count:'201' }, { _count:'1tail' }, { _count:'1.5' }, { _offset:'-1' }, { _offset:'1000001' }]) assert.equal((await get('ServiceRequest', { query: { ...query, ...bad } })).status, 400);
    state.referralRawRows = [referralFixture(), referralFixture()];
    assert.equal((await get('ServiceRequest', { query: { ...query, _offset: '1000000' } })).status, 400);
    delete state.referralRawRows;
    assert.equal((await get('ServiceRequest')).status, 400);
    assert.equal((await get('ServiceRequest/'+ids.observation, { query })).status, 404);
    assert.equal((await get('ServiceRequest', { query, method:'POST' })).status, 404);
    for (const role of ['phc_nurse', 'clinical_supervisor', 'on_call_clinician', 'referral_coordinator', 'government_analyst']) {
      state.role=role; const before=calls.filter(call=>call.sql.includes('FROM ng_referrals')).length;
      assert.equal((await get('ServiceRequest', { query })).status,403);
      assert.equal(calls.filter(call=>call.sql.includes('FROM ng_referrals')).length,before);
    }
    state.role='remote_clinician'; state.consent='revoked'; assert.equal((await get('ServiceRequest',{query})).status,409);
    state.consent='granted'; state.enrollment=false; assert.equal((await get('ServiceRequest',{query})).status,403);
    state.enrollment=true; state.encounter=false; assert.equal((await get('ServiceRequest',{query})).status,404);
    state.encounter=true; state.referrals=[]; const empty=await get('ServiceRequest',{query}); assert.equal(empty.status,200); assert.deepEqual(empty.body.entry,[]);
    state.referrals=[referralFixture({status:'declined'})]; const unsupported=await get('ServiceRequest',{query}); assert.equal(unsupported.status,503); assert.equal(unsupported.body.resourceType,'OperationOutcome'); assert.ok(!JSON.stringify(unsupported.body).includes(ids.patient));
    state.referrals=[referralFixture()]; state.auditFailure=true; const denied=await get('ServiceRequest',{query}); assert.equal(denied.status,500); assert.ok(!JSON.stringify(denied.body).includes(ids.patient));
  });
});


const labFixture = (overrides = {}) => ({
  id: ids.observation, patient_user_id: ids.patient, encounter_id: ids.encounter,
  test_name: 'Synthetic laboratory test', loinc_code: null, status: 'final',
  result_value: '0', unit: 'synthetic units', reference_range: 'Recorded range',
  abnormal_flag: 'Critical - recorded by source laboratory',
  ...overrides,
});

test('recorded laboratory reports preserve every supported source status and critical interpretation without inventing acknowledgment', () => {
  const { toDiagnosticReport } = require('../services/interop/clinicalFhirService');
  for (const status of ['registered', 'partial', 'final', 'amended', 'cancelled']) {
    const report = toDiagnosticReport(labFixture({ status }));
    assertR4(report);
    assertR4(report.contained[0]);
    assert.equal(report.status, status);
    const observation = report.contained[0];
    assert.equal(observation.status, status === 'partial' ? 'preliminary' : status);
    assert.equal(observation.valueString, '0');
    assert.equal(observation.dataAbsentReason, undefined);
    assert.deepEqual(observation.interpretation, [{ text: 'Critical - recorded by source laboratory' }]);
    assert.deepEqual(report.result, [{ reference: '#laboratory-result' }]);
    assert.ok(!JSON.stringify(report).includes('acknowledged'));
  }
});

test('laboratory mapping rejects missing source status or test identity rather than returning an unqualified report', () => {
  const { toDiagnosticReport } = require('../services/interop/clinicalFhirService');
  for (const overrides of [{ status: null }, { status: undefined }, { status: '' }, { status: 'unsupported' },
    { test_name: '  ', loinc_code: null }, { test_name: '', loinc_code: '  ' }]) {
    assert.throws(() => toDiagnosticReport(labFixture(overrides)), error => error.statusCode === 503 && !error.message.includes(ids.patient));
  }
  assert.deepEqual(toDiagnosticReport(labFixture({ test_name: '  ', loinc_code: '1234-5' })).code,
    { coding: [{ system: 'http://loinc.org', code: '1234-5' }] });
});

test('blank laboratory values explicitly remain missing while zero, negative and qualitative results remain unchanged', () => {
  const { toDiagnosticReport } = require('../services/interop/clinicalFhirService');
  for (const result_value of [null, undefined, '', '  ', '\r\n\t']) {
    const report = toDiagnosticReport(labFixture({ result_value }));
    assertR4(report);
    const observation = report.contained[0];
    assertR4(observation);
    assert.equal(observation.valueString, undefined);
    assert.equal(observation.dataAbsentReason.coding[0].code, 'unknown');
    assert.equal(observation.note, undefined);
  }
  for (const result_value of ['0', '-1', '<0.01', 'Not detected', '  Positive  ']) {
    assert.equal(toDiagnosticReport(labFixture({ result_value })).contained[0].valueString, result_value);
  }
});

test('DiagnosticReport HTTP fails closed on malformed source rows, including rows outside the requested page', async () => {
  reset({ labRows: [labFixture(), labFixture({ id: ids.observation.slice(0, -1) + '7', status: null })] });
  await withHTTP(async get => {
    const result = await get('DiagnosticReport', { query: { encounter: ids.encounter, _count: '1' } });
    assert.equal(result.status, 503); assert.equal(result.body.resourceType, 'OperationOutcome');
    assert.equal(result.headers.get('cache-control'), 'private, no-store');
    for (const text of [ids.patient, 'Synthetic laboratory test', 'Critical', 'Recorded range']) assert.ok(!JSON.stringify(result.body).includes(text));
    assert.ok(!calls.some(call => call.sql.includes('INSERT INTO ng_programme_audit_events')));
    state.labRows = [labFixture()];
    const valid = await get('DiagnosticReport', { query: { encounter: ids.encounter } });
    assert.equal(valid.status, 200); assert.equal(valid.body.entry[0].resource.contained[0].valueString, '0');
    assert.ok(calls.some(call => call.sql.includes('INSERT INTO ng_programme_audit_events')));
    state.auditFailure = true;
    const denied = await get('DiagnosticReport', { query: { encounter: ids.encounter } });
    assert.equal(denied.status, 500); assert.ok(!JSON.stringify(denied.body).includes(ids.patient));
  });
});


test('encrypted laboratory values retain supported statuses, critical flags and missing-value semantics', () => {
  const { encrypt } = require('../../lib/encryption');
  const { toDiagnosticReport } = require('../services/interop/clinicalFhirService');
  const previousKey = process.env.ENCRYPTION_KEY;
  process.env.ENCRYPTION_KEY = '11'.repeat(32); // Dedicated synthetic fixture key.
  try {
    for (const status of ['registered', 'partial', 'final', 'amended', 'cancelled']) {
      for (const value of ['0', 'Not detected', '  Positive  ', ' \r\n\t ']) {
        const encrypted = encrypt(value);
        const report = toDiagnosticReport(labFixture({ status,
          result_value: 'Stale plaintext must not be used', result_value_encrypted: encrypted.encrypted,
          result_value_iv: encrypted.iv, result_value_tag: encrypted.tag,
        }));
        assertR4(report); assertR4(report.contained[0]);
        assert.equal(report.status, status);
        const observation = report.contained[0];
        assert.equal(observation.status, status === 'partial' ? 'preliminary' : status);
        assert.deepEqual(observation.interpretation, [{ text: 'Critical - recorded by source laboratory' }]);
        if (value.trim()) {
          assert.equal(observation.valueString, value); assert.equal(observation.dataAbsentReason, undefined);
        } else {
          assert.equal(observation.valueString, undefined); assert.equal(observation.dataAbsentReason.coding[0].code, 'unknown');
          assert.equal(observation.note, undefined);
        }
        assert.ok(!JSON.stringify(report).includes('Stale plaintext'));
        for (const field of ['result_value_encrypted', 'result_value_iv', 'result_value_tag']) assert.ok(!JSON.stringify(report).includes(field));
      }
    }
  } finally {
    if (previousKey === undefined) delete process.env.ENCRYPTION_KEY; else process.env.ENCRYPTION_KEY = previousKey;
  }
});

test('legacy laboratory plaintext is read only when every protection field is absent', () => {
  const { toDiagnosticReport } = require('../services/interop/clinicalFhirService');
  for (const envelope of [{}, { result_value_encrypted: null, result_value_iv: null, result_value_tag: null },
    { result_value_encrypted: undefined, result_value_iv: null, result_value_tag: undefined }]) {
    const report = toDiagnosticReport(labFixture({ ...envelope, result_value: 'Legacy synthetic value' }));
    assert.equal(report.contained[0].valueString, 'Legacy synthetic value');
    assertR4(report);
  }
});

test('unreadable encrypted laboratory results fail HTTP reads without exposing or falling back to plaintext', async (t) => {
  const { encrypt } = require('../../lib/encryption');
  const previousKey = process.env.ENCRYPTION_KEY;
  process.env.ENCRYPTION_KEY = '22'.repeat(32); // Dedicated synthetic fixture key.
  t.mock.method(console, 'error', () => {});
  try {
    const encrypted = encrypt('Private synthetic encrypted result');
    const row = labFixture({ result_value: 'Stale plaintext must not be used',
      result_value_encrypted: encrypted.encrypted, result_value_iv: encrypted.iv, result_value_tag: encrypted.tag });
    reset();
    await withHTTP(async get => {
      for (const invalid of [
        { result_value_tag: (encrypted.tag.startsWith('0') ? '1' : '0') + encrypted.tag.slice(1) },
        { result_value_iv: null }, { result_value_tag: null },
        // A surviving protection field must never revive legacy plaintext,
        // even when ciphertext is missing or falsy.
        { result_value_encrypted: null }, { result_value_encrypted: undefined },
        { result_value_encrypted: '' }, { result_value_encrypted: false },
        { result_value_encrypted: 0 },
        { result_value_encrypted: null, result_value_tag: null },
        { result_value_encrypted: null, result_value_iv: null },
        { result_value_encrypted: '', result_value_iv: null, result_value_tag: null },
        { result_value_iv: '' }, { result_value_tag: '' },
        { result_value_iv: {} }, { result_value_tag: [] },
        { result_value_encrypted: { toString: () => 'not a stored value' } },
      ]) {
        state.labRows = [labFixture(), { ...row, ...invalid }];
        const response = await get('DiagnosticReport', { query: { encounter: ids.encounter, _count: '1' } });
        assert.equal(response.status, 503); assert.equal(response.body.resourceType, 'OperationOutcome');
        assertR4(response.body);
        for (const value of [ids.patient, 'Private synthetic', 'Stale plaintext', encrypted.encrypted, encrypted.iv, encrypted.tag]) {
          assert.ok(!JSON.stringify(response.body).includes(value));
        }
      }
      assert.ok(!calls.some(call => call.sql.includes('INSERT INTO ng_programme_audit_events')));
      state.labRows = [row];
      const recovered = await get('DiagnosticReport', { query: { encounter: ids.encounter } });
      assert.equal(recovered.status, 200); assertR4(recovered.body.entry[0].resource);
      assert.equal(recovered.body.entry[0].resource.contained[0].valueString, 'Private synthetic encrypted result');
    });
  } finally {
    if (previousKey === undefined) delete process.env.ENCRYPTION_KEY; else process.env.ENCRYPTION_KEY = previousKey;
  }
});
