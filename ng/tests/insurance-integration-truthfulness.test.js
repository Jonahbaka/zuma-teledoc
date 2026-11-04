'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const express = require('express');
const readiness = require('../../server/utils/integrationReadiness');
const manualInsuranceService = require('../../server/services/manualInsuranceService');
const { normalizeMarketScope } = require('../../server/utils/marketScope');

const patientId = '00000000-0000-4000-8000-000000000001';
const providerId = '00000000-0000-4000-8000-000000000002';
const otherId = '00000000-0000-4000-8000-000000000003';
const recordId = '00000000-0000-4000-8000-000000000004';
const quietLogger = { error() {}, info() {}, warn() {}, audit() {} };

function loadSource(relativePath, dependencies = {}, env = {}) {
  const filename = path.resolve(__dirname, '../..', relativePath);
  const sourceModule = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    module: sourceModule, exports: sourceModule.exports,
    require(name) {
      if (name === '../utils/integrationReadiness') return readiness;
      if (name === '../middleware/logger') return quietLogger;
      assert.ok(name in dependencies, `Unexpected dependency: ${name}`);
      return dependencies[name];
    },
    process: { env }, Buffer, console: quietLogger,
  }, { filename });
  return sourceModule.exports;
}

function databaseHarness() {
  const insurance = { id: recordId, user_id: patientId, insurance_provider: 'Test-only insurer record', member_id: 'test-only-member', is_verified: true, eligibility_status: 'active', audit_log: [] };
  const authorization = { id: recordId, patient_id: patientId, provider_id: providerId, status: 'in_review', approval_number: null };
  const calls = [];
  const client = {
    async query(sql, parameters = []) {
      calls.push({ sql, parameters });
      if (sql.includes('FROM users p')) return { rows: parameters[0] === patientId && parameters[1] === 'US' ? [{ id: patientId }] : [] };
      if (sql.includes('SELECT * FROM patient_insurance')) return { rows: parameters[0] === recordId ? [{ ...insurance }] : [] };
      if (sql.includes('SELECT audit_log FROM patient_insurance')) return { rows: [{ audit_log: [...insurance.audit_log] }] };
      if (sql.includes('FROM patient_insurance') && sql.includes('ORDER BY is_primary')) return { rows: [{ ...insurance }] };
      if (sql.includes('UPDATE patient_insurance') && sql.includes('eligibility_response')) {
        Object.assign(insurance, { is_verified: parameters[0], eligibility_status: parameters[1] });
        return { rows: [{ ...insurance }] };
      }
      if (sql.includes('UPDATE patient_insurance SET audit_log')) { insurance.audit_log = JSON.parse(parameters[0]); return { rows: [] }; }
      if (sql.includes('FROM prior_authorizations WHERE id')) return { rows: parameters[0] === recordId ? [{ ...authorization }] : [] };
      if (sql.includes('FROM prior_authorizations WHERE patient_id')) return { rows: parameters[0] === patientId ? [{ ...authorization }] : [] };
      if (sql.includes('FROM prior_authorizations WHERE provider_id')) return { rows: parameters[0] === providerId ? [{ ...authorization }] : [] };
      throw new Error('Unexpected database access in fail-closed integration test');
    },
    release() { calls.push({ sql: 'RELEASE' }); },
  };
  const db = { query: (...args) => client.query(...args), pool: { query: (...args) => client.query(...args), async connect() { calls.push({ sql: 'CONNECT' }); return client; } } };
  return { db, calls, insurance, authorization };
}

function walletService(database, eligibility) {
  return loadSource('server/services/insuranceWalletService.js', {
    '../db': database.db,
    './eligibilityService': eligibility,
    './manualInsuranceService': manualInsuranceService,
    '../../lib/encryption': { encrypt() { throw new Error('Unexpected encryption'); }, decrypt() { throw new Error('Unexpected decryption'); } },
  });
}

const environments = [
  { NODE_ENV: 'production', GOOGLE_CLOUD_VISION_API_KEY: 'test-only-key', AWS_ACCESS_KEY_ID: 'test-only-key', AWS_SECRET_ACCESS_KEY: 'test-only-key', SURESCRIPTS_RTBC_API_KEY: 'test-only-key', FDB_API_KEY: 'test-only-key', COVERMYMEDS_API_KEY: 'test-only-key', SURESCRIPTS_API_KEY: 'test-only-key', CHANGE_HEALTHCARE_RTE_API_KEY: 'test-only-key' },
  { NODE_ENV: 'development', ALLOW_SYNTHETIC_INTEGRATIONS: 'true' },
];
function unavailable(error) { return error.statusCode === 503 && error.code === 'INTEGRATION_NOT_ACTIVATED'; }

test('OCR never manufactures card identity or confidence with configured keys or development flags', async () => {
  for (const env of environments) {
    const database = databaseHarness();
    const service = loadSource('server/services/ocrService.js', { '../db': database.db }, env);
    for (const method of ['processWithGoogleVision', 'processWithAWSTextract', 'extractInsuranceCardData', 'saveInsuranceCardWithOCR']) {
      await assert.rejects(service[method](patientId, 'test-only-image-bytes', null, 'google_vision'), unavailable);
    }
    assert.equal(service.simulateOCR, undefined);
    assert.equal(database.calls.length, 0);
  }
});

test('RTBC rejects before reading historical caches or generating coverage, formulary, prices or discounts', async () => {
  for (const env of environments) {
    const database = databaseHarness();
    const service = loadSource('server/services/rtbcService.js', { '../db': database.db }, env);
    for (const method of ['getRTBCViaSurescripts', 'getFDBFormularyData', 'getRTBC', 'comparePrices']) {
      await assert.rejects(service[method](patientId, 'Test medication', null, true), unavailable);
    }
    assert.equal(service.simulateRTBC, undefined); assert.equal(service.simulateFDBData, undefined);
    assert.equal(database.calls.length, 0);
  }
});

test('prior authorization mutation cannot create a submitted record, receipt or approval through any legacy path', async () => {
  for (const env of environments) {
    const database = databaseHarness();
    const service = loadSource('server/services/priorAuthService.js', { '../db': database.db }, env);
    for (const submittedVia of ['api', 'covermymeds', 'surescripts']) await assert.rejects(service.createPriorAuth({ patientId, providerId, submittedVia }), unavailable);
    for (const method of ['submitViaCoverMyMeds', 'submitViaSurescripts', 'updatePriorAuthStatus']) await assert.rejects(service[method]({ status: 'approved' }), unavailable);
    await assert.rejects(service.autoSubmitIfRequired(patientId, providerId, 'Test medication', null, null, { requiresPriorAuth: true }), unavailable);
    assert.equal(await service.autoSubmitIfRequired(patientId, providerId, 'Test medication', null, null, { requiresPriorAuth: false }), null);
    assert.equal(service.simulateCoverMyMedsSubmission, undefined); assert.equal(service.simulateSurescriptsSubmission, undefined);
    assert.equal(database.calls.length, 0);
    assert.equal((await service.getPriorAuthById(recordId)).status, 'in_review');
    assert.equal((await service.getPriorAuthsByPatient(patientId)).length, 1);
  }
});

test('unconnected eligibility fails closed even when keys or synthetic-integration flags are present', async () => {
  for (const env of environments) {
    const service = loadSource('server/services/eligibilityService.js', {}, env);
    await assert.rejects(service.verifyRealTime('test-only-member', 'Test-only insurer'), unavailable);
    assert.equal(service.simulateEligibilityVerification, undefined);
  }
});

test('wallet rejects unavailable, synthetic, unverified and malformed results before altering existing coverage or audits', async () => {
  for (const result of [null, { status: 'UNKNOWN', verified: false, verificationSource: 'unavailable' }, { status: 'ACTIVE', verified: true, synthetic: true }, { status: 'ACTIVE', verified: false }, { status: 'ACTIVE' }, { status: 'UNKNOWN', verified: true }]) {
    const database = databaseHarness(); const before = JSON.stringify(database.insurance);
    const service = walletService(database, { async verifyRealTime() { return result; } });
    await assert.rejects(service.verifyEligibility(recordId), unavailable);
    assert.equal(JSON.stringify(database.insurance), before);
    assert.equal(database.calls.some((call) => call.sql.includes('UPDATE')), false);
    assert.equal(database.calls.filter((call) => call.sql === 'RELEASE').length, 1);
  }
});

test('wallet retains the explicitly verified adapter result contract without accepting OCR confidence as coverage', async () => {
  for (const status of ['ACTIVE', 'INACTIVE']) {
    const database = databaseHarness();
    const service = walletService(database, { async verifyRealTime() { return { status, verified: true, verificationSource: 'activated-test-adapter' }; } });
    const result = await service.verifyEligibility(recordId);
    assert.equal(result.insurance.is_verified, status === 'ACTIVE');
    assert.equal(result.insurance.eligibility_status, status.toLowerCase());
    assert.equal(database.insurance.audit_log[0].action, 'eligibility_verified');
  }
});

async function withRoutes(user, run) {
  const database = databaseHarness();
  const env = environments[0];
  const services = {
    ocr: loadSource('server/services/ocrService.js', {}, env),
    rtbc: loadSource('server/services/rtbcService.js', {}, env),
    priorAuth: loadSource('server/services/priorAuthService.js', { '../db': database.db }, env),
    eligibility: loadSource('server/services/eligibilityService.js', {}, env),
  };
  const wallet = walletService(database, services.eligibility);
  const auth = {
    authenticate(req, res, next) { if (!user) return res.status(401).json({ success: false, error: 'Authentication required' }); req.user = user; return next(); },
    requireRole: (...roles) => (req, res, next) => roles.includes(req.user.role) ? next() : res.status(403).json({ success: false }),
    canAccessPatient: (_req, _res, next) => next(),
  };
  const financialScope = loadSource('server/middleware/financialRecordScope.js', { '../db': database.db, '../utils/marketScope': { normalizeMarketScope } });
  let parsedUploads = 0;
  const upload = () => ({ fields: () => (_req, _res, next) => { parsedUploads++; next(); } });
  upload.memoryStorage = () => ({});
  const common = { express, '../middleware/auth': auth, '../middleware/audit': { auditMiddleware: () => (_req, _res, next) => next() } };
  const insurance = loadSource('server/routes/insurance.js', { ...common, multer: upload, '../db': database.db, '../services/manualInsuranceService': manualInsuranceService, '../services/insuranceWalletService': wallet, '../services/ocrService': services.ocr, '../middleware/financialRecordScope': financialScope });
  const rtbc = loadSource('server/routes/rtbc.js', { ...common, '../services/rtbcService': services.rtbc });
  const priorAuth = loadSource('server/routes/priorAuth.js', { ...common, '../services/priorAuthService': services.priorAuth });
  const app = express(); app.use(express.json());
  app.use('/api/insurance', insurance); app.use('/api/rtbc', rtbc); app.use('/api/prior-auth', priorAuth);
  app.use((error, _req, res, _next) => res.status(500).json({ success: false, error: error.message }));
  const server = await new Promise((resolve) => { const listener = app.listen(0, '127.0.0.1', () => resolve(listener)); });
  try {
    await run({ database, parsedUploads: () => parsedUploads, request: (url, method = 'GET', body) => fetch(`http://127.0.0.1:${server.address().port}${url}`, { method, ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) }) });
  } finally { await new Promise((resolve) => server.close(resolve)); }
}

async function assertUnavailable(response) {
  assert.equal(response.status, 503);
  const body = await response.json();
  assert.equal(body.success, false); assert.equal(body.status, 'unavailable'); assert.equal(body.code, 'INTEGRATION_NOT_ACTIVATED');
  for (const field of ['insurance', 'rtbc', 'scenarios', 'bestPrice', 'priorAuth', 'approvalNumber', 'externalId']) assert.equal(body[field], undefined);
}

test('OCR endpoint authenticates and authorizes before readiness, and unavailable scanning never parses card uploads', async () => {
  for (const [user, status] of [[null, 401], [{ id: providerId, role: 'provider' }, 403], [{ id: patientId, role: 'patient' }, 503]]) {
    await withRoutes(user, async ({ request, database, parsedUploads }) => {
      const response = await request('/api/insurance/ocr', 'POST', { frontImage: 'test-only-image' });
      assert.equal(response.status, status); if (status === 503) await assertUnavailable(response);
      assert.equal(parsedUploads(), 0); assert.equal(database.calls.length, 0);
    });
  }
});

test('direct benefit check and comparison endpoints return unavailable with no cache read or generated membership price', async () => {
  await withRoutes({ id: patientId, role: 'patient' }, async ({ request, database }) => {
    await assertUnavailable(await request('/api/rtbc/check?medicationName=Test%20medication'));
    await assertUnavailable(await request('/api/rtbc/compare', 'POST', { medicationName: 'Test medication', hasGoldCard: true }));
    assert.equal((await request('/api/rtbc/compare', 'POST', { medicationName: ['bad'] })).status, 400);
    assert.equal((await request('/api/rtbc/check?medicationName=Test&insuranceId=not-a-uuid')).status, 400);
    assert.equal(database.calls.length, 0);
  });
  await withRoutes(null, async ({ request }) => { assert.equal((await request('/api/rtbc/check?medicationName=Test')).status, 401); });
});

test('owned eligibility endpoint returns unavailable without changing coverage; foreign records still fail authorization', async () => {
  await withRoutes({ id: patientId, role: 'patient', marketScope: 'US' }, async ({ request, database }) => {
    const before = JSON.stringify(database.insurance);
    await assertUnavailable(await request(`/api/insurance/${recordId}/verify`, 'POST'));
    assert.equal(JSON.stringify(database.insurance), before);
    assert.equal(database.calls.some((call) => call.sql.includes('UPDATE')), false);
  });
  await withRoutes({ id: otherId, role: 'patient', marketScope: 'US' }, async ({ request, database }) => {
    assert.equal((await request(`/api/insurance/${recordId}/verify`, 'POST')).status, 404);
    assert.equal(database.calls.some((call) => call.sql === 'CONNECT'), false);
  });
});

test('direct prior-authorization creation and approval mutation cannot persist successful submission state', async () => {
  await withRoutes({ id: providerId, role: 'provider' }, async ({ request, database }) => {
    const before = JSON.stringify(database.authorization);
    for (const submittedVia of ['api', 'covermymeds', 'surescripts']) await assertUnavailable(await request('/api/prior-auth', 'POST', { patientId, submittedVia }));
    await assertUnavailable(await request(`/api/prior-auth/${recordId}/status`, 'PATCH', { status: 'approved', approvalNumber: 'test-only-approval' }));
    assert.equal(JSON.stringify(database.authorization), before); assert.equal(database.calls.length, 0);
  });
  await withRoutes({ id: patientId, role: 'patient' }, async ({ request }) => {
    assert.equal((await request('/api/prior-auth', 'POST', { patientId })).status, 403);
    assert.equal((await request(`/api/prior-auth/${recordId}/status`, 'PATCH', { status: 'approved' })).status, 403);
  });
});

test('historical authorizations remain readable only by their recorded patient or provider', async () => {
  for (const user of [{ id: patientId, role: 'patient' }, { id: providerId, role: 'provider' }]) {
    await withRoutes(user, async ({ request }) => {
      const response = await request(`/api/prior-auth/${recordId}`);
      assert.equal(response.status, 200); assert.equal((await response.json()).priorAuth.status, 'in_review');
      assert.equal((await request('/api/prior-auth/not-a-uuid')).status, 400);
    });
  }
  for (const user of [{ id: otherId, role: 'patient' }, { id: otherId, role: 'provider' }, { id: otherId, role: 'admin' }]) {
    await withRoutes(user, async ({ request }) => { assert.equal((await request(`/api/prior-auth/${recordId}`)).status, user.role === 'admin' ? 403 : 404); });
  }
});
