'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { randomUUID } = require('node:crypto');
const access = require('../services/clinicalPatientAccessService');
const patientId = randomUUID(), providerId = randomUUID(), consentId = randomUUID(), templateId = randomUUID();
const own = { id: patientId, role: 'patient', marketScope: 'US' };
const provider = { id: providerId, role: 'provider', marketScope: 'NG' };
const privateMarker = 'Sensitive synthetic consent revocation and witness';

function load(relative, dependencies) {
  const filename = path.resolve(__dirname, relative), loaded = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    module: loaded, exports: loaded.exports, Date, JSON,
    require(name) { assert.ok(name in dependencies, 'Unexpected dependency: ' + name); return dependencies[name]; },
  }, { filename });
  return loaded.exports;
}
function fixture(options = {}) {
  const calls = [], audits = [], commits = [];
  let transactions = 0;
  const consent = {
    id: consentId, patient_id: patientId, template_id: templateId, template_version: 'test-1',
    is_valid: true, revoked_at: null, patient_state: 'CA', consent_captured_at: new Date(),
    expires_at: new Date(Date.now() + 86400000), witness_name: privateMarker,
    revoked_reason: privateMarker, signature_data_encrypted: 'Must not be returned',
  };
  Object.assign(consent, options.consent);
  const client = { async query(sql, params) {
    calls.push({ sql, params });
    if (sql.includes('FROM users actor')) {
      assert.match(sql, /actor\.role=\$3 AND actor\.market_scope=\$4 AND actor\.is_active=TRUE/);
      assert.match(sql, /patient\.role='patient' AND patient\.is_active=TRUE AND patient\.market_scope=actor\.market_scope/);
      assert.match(sql, /actor\.provider_status='approved'/);
      assert.match(sql, /FOR SHARE OF actor,patient/);
      assert.equal(params[0], patientId);
      const allowed = options.accounts !== false && ((params[1] === own.id && params[2] === own.role && params[3] === own.marketScope)
        || (params[1] === provider.id && params[2] === provider.role && params[3] === provider.marketScope));
      return { rows: allowed ? [{ id: params[1], role: params[2], market_scope: params[3] }] : [] };
    }
    if (sql.includes('FROM ng_providers')) {
      assert.deepEqual(params, [providerId]); assert.match(sql, /status='verified' FOR SHARE/);
      return { rows: options.verified === false ? [] : [{ id: randomUUID() }] };
    }
    if (sql.includes('FROM provider_patient_relationships')) {
      assert.deepEqual(params, [providerId, patientId]); assert.match(sql, /is_active=TRUE FOR SHARE/);
      return { rows: options.relationship === false ? [] : [{ id: randomUUID() }] };
    }
    if (sql.includes('FROM appointments')) {
      assert.deepEqual(params, [providerId, patientId]); assert.match(sql, /status IN \('scheduled','confirmed','in_progress'\) FOR SHARE/);
      return { rows: options.appointment ? [{ id: randomUUID() }] : [] };
    }
    if (sql.includes('FROM telehealth_consents tc')) {
      assert.match(sql, /WHERE tc\.patient_id = \$1/); assert.equal(params[0], patientId);
      assert.match(sql, /FOR SHARE OF tc/);
      if (options.readFailure) throw new Error(privateMarker);
      if (params.length === 2) {
        assert.equal(params[1], 'CA');
        assert.match(sql, /tc\.is_valid = true AND tc\.revoked_at IS NULL/);
        assert.match(sql, /tc\.expires_at IS NULL OR tc\.expires_at > NOW\(\)/);
        assert.match(sql, /LIMIT 1 FOR SHARE OF tc/);
        if (!consent.is_valid || consent.revoked_at || consent.expires_at && consent.expires_at <= new Date()) return { rows: [] };
      }
      return { rows: options.empty ? [] : [consent] };
    }
    if (sql.includes('INSERT INTO audit_logs')) {
      assert.match(sql, /'read','telehealth_consent'/); assert.match(sql, /TRUE,TRUE/);
      assert.equal(params[1], patientId);
      const metadata = JSON.parse(params[2]);
      assert.deepEqual(Object.keys(metadata).sort(), ['operation', 'recordCount']);
      assert.doesNotMatch(JSON.stringify(params), /Sensitive|Must not/);
      if (options.auditWait) await options.auditWait();
      if (options.auditFailure) throw new Error(privateMarker);
      audits.push({ params, metadata }); return { rows: [] };
    }
    throw new Error('Unexpected storage access: ' + sql);
  } };
  const service = load('../services/telehealthConsentService.js', {
    '../db': {
      query() { throw new Error('Protected consent reads must not use the shared pool'); },
      async transaction(work) {
        transactions++; calls.push({ sql: 'BEGIN' });
        try { const result = await work(client); if (options.commitFailure) throw new Error(privateMarker);
          calls.push({ sql: 'COMMIT' }); commits.push(...audits); return result;
        } catch (error) { calls.push({ sql: 'ROLLBACK' }); throw error; }
      },
    }, '../middleware/logger': {}, '../../lib/encryption': {}, '../../lib/utils': {}, './clinicalPatientAccessService': access,
  });
  return { service, calls, audits, commits, transactions: () => transactions };
}
const readOperations = (service, actor) => [
  () => service.getValidConsent(patientId, 'CA', actor),
  () => service.hasValidConsent(patientId, 'CA', actor),
  () => service.validateConsentForEncounter(patientId, 'CA', actor),
  () => service.getPatientConsents(patientId, actor),
];

test('all protected consent readers require explicit supported actor identity before opening storage', async () => {
  for (const actor of [undefined, { ...own, id: 'malformed' }, ...['admin', 'super_admin', 'pharmacy'].map(role => ({ ...own, role }))]) {
    const f = fixture();
    for (const read of readOperations(f.service, actor)) await assert.rejects(read(), { statusCode: !actor || actor.id === 'malformed' ? 400 : 403 });
    assert.equal(f.transactions(), 0);
  }
});

test('each consent reader rechecks current accounts, role, market, verification and active care before records or audit', async () => {
  for (const [actor, options] of [[{ ...own, id: randomUUID() }, {}], [{ ...own, marketScope: 'NG' }, {}],
    [own, { accounts: false }], [provider, { verified: false }], [provider, { relationship: false }]]) {
    for (let index = 0; index < 4; index++) {
      const f = fixture(options); await assert.rejects(readOperations(f.service, actor)[index](), { statusCode: 403 });
      assert.ok(!f.calls.some(call => /FROM telehealth_consents|INSERT INTO audit_logs/.test(call.sql)));
      assert.equal(f.calls.at(-1).sql, 'ROLLBACK');
    }
  }
});

test('own and verified relationship/appointment reads hold authority and consent locks through metadata-only audit', async () => {
  for (const [actor, options] of [[own, {}], [provider, {}], [provider, { relationship: false, appointment: true }]]) {
    for (let index = 0; index < 4; index++) {
      const f = fixture(options), result = await readOperations(f.service, actor)[index]();
      assert.ok(result); assert.equal(f.transactions(), 1); assert.equal(f.commits.length, 1);
      assert.equal(f.calls[0].sql, 'BEGIN'); assert.equal(f.calls.at(-1).sql, 'COMMIT');
      assert.equal(f.audits[0].params[0], actor.id);
      assert.equal(f.audits[0].metadata.operation, index === 3 ? 'history' : 'validity');
      assert.equal(f.audits[0].metadata.recordCount, 1);
      assert.doesNotMatch(JSON.stringify(result), /Must not be returned|signatureData/);
      const recordAt = f.calls.findIndex(call => call.sql.includes('FROM telehealth_consents'));
      const auditAt = f.calls.findIndex(call => call.sql.includes('INSERT INTO audit_logs'));
      assert.ok(recordAt > 1 && auditAt > recordAt);
    }
  }
});

test('validity excludes explicit revocation, invalid flags and expiration while history retains them', async () => {
  for (const consent of [{ revoked_at: new Date() }, { is_valid: false }, { expires_at: new Date(0) }]) {
    const f = fixture({ consent });
    assert.equal(await f.service.hasValidConsent(patientId, 'CA', own), false);
    await assert.rejects(f.service.validateConsentForEncounter(patientId, 'CA', own), { code: 'CONSENT_REQUIRED' });
    const history = await f.service.getPatientConsents(patientId, own);
    assert.equal(history.length, 1);
    assert.deepEqual(f.audits.map(entry => entry.metadata.recordCount), [0, 0, 1]);
  }
  const f = fixture({ empty: true });
  assert.equal(await f.service.getValidConsent(patientId, 'CA', own), null);
  assert.equal(f.audits[0].metadata.recordCount, 0);
});

test('no protected consent result escapes before audit commit, and storage/audit/commit failures reject it', async () => {
  let entered; const atAudit = new Promise(resolve => { entered = resolve; });
  let release; const hold = new Promise(resolve => { release = resolve; });
  const f = fixture({ auditWait: () => { entered(); return hold; } });
  let settled = false;
  const pending = f.service.getPatientConsents(patientId, own).finally(() => { settled = true; });
  await atAudit; assert.equal(settled, false); assert.equal(f.commits.length, 0); release();
  assert.equal((await pending).length, 1); assert.equal(f.commits.length, 1);
  for (const option of ['readFailure', 'auditFailure', 'commitFailure']) {
    const failed = fixture({ [option]: true });
    await assert.rejects(failed.service.getPatientConsents(patientId, own), /Sensitive synthetic/);
    assert.equal(failed.commits.length, 0); assert.equal(failed.calls.at(-1).sql, 'ROLLBACK');
  }
});

function routes(consentService, encounterService = {}) {
  const handlers = new Map(), middleware = (_req, _res, next) => next();
  const router = Object.fromEntries(['get', 'post', 'put', 'delete', 'patch'].map(method => [method, (url, ...stack) => handlers.set(method + ' ' + url, stack)]));
  load('../routes/clinicalEncounters.js', {
    express: { Router: () => router }, zod: require('zod'),
    '../middleware/auth': { authenticate: middleware, canAccessPatient: middleware, requireRole: () => middleware },
    '../middleware/audit': { auditMiddleware: () => middleware, auditPhiAccess: () => middleware },
    '../../lib/validation': { validate: (schema, input) => schema.parse(input) }, '../../lib/utils': {}, '../middleware/logger': { error() {} },
    '../services/clinicalEncounterService': encounterService, '../services/patientClinicalProfileService': {},
    '../services/eRxIntegrationService': {}, '../services/telehealthConsentService': consentService,
    '../../ng/services/rx-engine/privatePrescriptionUploadService': {}, '../db': {},
  });
  return async (key, req) => {
    const stack = handlers.get(key); assert.ok(stack, key);
    let status = 200, body;
    const res = { status(value) { status = value; return this; }, json(value) { body = value; return this; } };
    await stack.at(-1)(req, res);
    return { status, body };
  };
}

test('actual status/history route handlers forward current session and suppress raw storage errors', async () => {
  const calls = [];
  const run = routes({
    async hasValidConsent(...args) { calls.push(args); return false; },
    async getPatientConsents(...args) { calls.push(args); return []; },
  });
  assert.equal((await run('get /consent/check', { query: { patientId, state: 'CA' }, user: own })).body.hasValidConsent, false);
  assert.equal((await run('get /patient/:patientId/consents', { params: { patientId }, user: own })).body.consents.length, 0);
  assert.deepEqual(calls, [[patientId, 'CA', own], [patientId, own]]);
  for (const statusCode of [400, 403, 503, undefined]) {
    const fail = async () => { throw Object.assign(new Error(privateMarker), { statusCode, code: 'CLINICAL_ACCESS_DENIED' }); };
    const denied = routes({ hasValidConsent: fail, getPatientConsents: fail });
    for (const [key, req] of [['get /consent/check', { query: { patientId, state: 'CA' }, user: own }],
      ['get /patient/:patientId/consents', { params: { patientId }, user: own }]]) {
      const response = await denied(key, req); assert.equal(response.status, statusCode || 503);
      assert.equal(response.body.success, false); assert.doesNotMatch(JSON.stringify(response), /Sensitive synthetic/);
    }
  }
});

test('encounter preflight forwards clinician authority and prevents creation after consent denial', async () => {
  let call, created = 0, reject = false;
  const run = routes({ async validateConsentForEncounter(...args) {
    call = args; if (reject) throw Object.assign(new Error(privateMarker), { statusCode: 403, code: 'CLINICAL_ACCESS_DENIED' });
    return { id: consentId };
  } }, { async createEncounter(data, actorId) {
    assert.equal(data.telehealthConsentId, consentId); assert.equal(actorId, provider.id); created++; return { id: randomUUID() };
  } });
  const req = { body: { patientId, patientState: 'CA', encounterType: 'telehealth_video' }, user: provider };
  assert.equal((await run('post /', req)).status, 201);
  assert.deepEqual(call, [patientId, 'CA', provider]); assert.equal(created, 1);
  reject = true; const response = await run('post /', req);
  assert.equal(response.status, 403); assert.equal(created, 1); assert.doesNotMatch(JSON.stringify(response), /Sensitive synthetic/);
});
