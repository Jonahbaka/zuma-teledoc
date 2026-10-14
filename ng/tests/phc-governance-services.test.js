'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

process.env.ENCRYPTION_KEY ||= '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

const ai = require('../services/phc/clinicalAiService');
const offline = require('../services/phc/offlineSyncService');
const reporting = require('../services/phc/programmeReportingService');
const devices = require('../services/phc/deviceGatewayService');

const validAiOutput = {
  summary: 'Patient reports headache.',
  handoverDraft: 'Chief complaint: headache. Other history is not recorded.',
  missingInformation: [{ field: 'allergies', reason: 'Not recorded in the supplied encounter.' }],
  assertions: [{ text: 'The recorded chief complaint is headache.', sourceRefs: ['encounter:chief_complaint'] }],
  uncertainties: ['Duration is not recorded.'],
};

test('offline payload hashing is canonical and detects content changes', () => {
  const left = offline.payloadHash({ payload: { b: 2, a: 1 }, entityType: 'observation' });
  const reordered = offline.payloadHash({ entityType: 'observation', payload: { a: 1, b: 2 } });
  const changed = offline.payloadHash({ entityType: 'observation', payload: { a: 1, b: 3 } });
  assert.equal(left, reordered);
  assert.notEqual(left, changed);
  assert.match(left, /^[0-9a-f]{64}$/);
});

test('reporting period validation produces exact UTC boundaries', () => {
  const parsed = reporting.parsePeriod('2026-08');
  assert.equal(parsed.period, '2026-08');
  assert.equal(parsed.start, '2026-08-01T00:00:00.000Z');
  assert.equal(parsed.end, '2026-09-01T00:00:00.000Z');
  assert.equal(parsed.dhis2Period, '202608');
  assert.throws(() => reporting.parsePeriod('August 2026'), /YYYY-MM/);
});

test('clinical AI structured output rejects unknown fields and invalid JSON', () => {
  assert.deepEqual(ai.parseModelJson(JSON.stringify(validAiOutput)), validAiOutput);
  assert.throws(
    () => ai.parseModelJson(JSON.stringify({ ...validAiOutput, diagnosis: 'Migraine' })),
    /schema validation/
  );
  assert.throws(() => ai.parseModelJson('not-json'), /invalid structured output/);
});

test('clinical AI grounding rejects citations outside the supplied record', () => {
  const sources = new Map([['encounter:chief_complaint', { type: 'encounter_field' }]]);
  assert.deepEqual(ai.validateGrounding(validAiOutput, sources), validAiOutput);
  const hallucinated = {
    ...validAiOutput,
    assertions: [{ text: 'Patient has fever.', sourceRefs: ['observation:not-present'] }],
  };
  assert.throws(() => ai.validateGrounding(hallucinated, sources), /unavailable source/);
});

test('remote clinician AI access requires assignment while nurse intake remains available', async () => {
  await assert.doesNotReject(() => ai.assertEncounterAiAccess({}, {
    programmeRole: 'phc_nurse',
    userId: 'nurse-1',
  }, {}));
  await assert.doesNotReject(() => ai.assertEncounterAiAccess({}, {
    programmeRole: 'remote_clinician',
    userId: 'doctor-1',
  }, { assigned_provider_user_id: 'doctor-1' }));
  await assert.rejects(
    () => ai.assertEncounterAiAccess({}, {
      programmeRole: 'remote_clinician',
      userId: 'doctor-1',
    }, { assigned_provider_user_id: 'doctor-2' }),
    (error) => error.code === 'ASSIGNED_CLINICIAN_REQUIRED'
  );
});

test('legacy unscoped Nigeria AI route is permanently retired', () => {
  const route = fs.readFileSync(path.join(__dirname, '../../app/ng/ai-notes/route.js'), 'utf8');
  assert.match(route, /LEGACY_CLINICAL_AI_RETIRED/);
  assert.doesNotMatch(route, /GEMINI_API_KEY|generateContent/);
});

test('PHC migration prohibits patient identifiers in aggregate reports', () => {
  const migration = fs.readFileSync(path.join(__dirname, '../migrations/022_ng_phc_sync_ai_reporting.sql'), 'utf8');
  assert.match(migration, /public_health_reports_no_patient_identifiers/);
  assert.match(migration, /contains_patient_identifiers = FALSE/);
  assert.match(migration, /ng_indicator_source_definitions/);
});

test('device gateway exposes manual capture and labels unimplemented vendor transports as blocked', () => {
  assert.equal(devices.ADAPTER_CAPABILITIES.manual_entry.status, 'available');
  assert.equal(devices.ADAPTER_CAPABILITIES.mock_device_v1.clinicalUse, false);
  assert.equal(devices.ADAPTER_CAPABILITIES.bluetooth_low_energy.status, 'blocked_vendor_documentation');
  const one = devices.serialProtection(' synthetic-serial-1 ');
  const two = devices.serialProtection('SYNTHETIC-SERIAL-1');
  assert.equal(one.hash, two.hash);
  assert.notEqual(one.encrypted, 'SYNTHETIC-SERIAL-1');
});

test('fixture device writes are denied in production and outside isolated test databases', async () => {
  const previous = { NODE_ENV: process.env.NODE_ENV, DATABASE_URL: process.env.DATABASE_URL };
  let queries = 0;
  const pool = { query() { queries++; throw new Error('Denied fixture must not query the database'); } };
  const context = { demo_only: true };
  try {
    for (const [environment, target] of [['production', 'postgresql://test@127.0.0.1:5432/device_test'], ['test', 'postgresql://test@remote.example/device_test'], ['development', 'postgresql://test@127.0.0.1:5432/live_database']]) {
      process.env.NODE_ENV = environment;
      process.env.DATABASE_URL = target;
      await assert.rejects(devices.registerDevice(pool, {}, context, { adapterKey: 'mock_device_v1', deviceType: 'blood_pressure' }), { code: 'MOCK_DEVICE_TEST_ONLY' });
      await assert.rejects(devices.captureMockFixture(pool, {}, context, { fixtureName: 'blood_pressure' }), { code: 'MOCK_DEVICE_TEST_ONLY' });
    }
    assert.equal(queries, 0);
  } finally {
    for (const [name, value] of Object.entries(previous)) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
  }
});

test('canonical chart note writes require assigned provider and queue completion requires sign-off', () => {
  const clinicalService = fs.readFileSync(
    path.join(__dirname, '../../server/services/clinicalEncounterService.js'),
    'utf8'
  );
  const workflowService = fs.readFileSync(
    path.join(__dirname, '../services/phc/phcWorkflowService.js'),
    'utf8'
  );
  assert.match(clinicalService, /encounter\.provider_id !== providerId/);
  assert.match(clinicalService, /Only the authoring provider can amend this note/);
  assert.match(workflowService, /CLINICAL_SIGNOFF_REQUIRED/);
  assert.match(workflowService, /n\.is_signed=TRUE/);
  assert.match(workflowService, /provider_patient_relationships/);
});
