'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const crypto = require('node:crypto');
const FHIRBridge = require('../services/fhir-bridge');

test('legacy external referral dispatch fails before bundle construction, credentials or network', async () => {
  const bridge = new FHIRBridge({ query() { throw new Error('No data access expected'); } });
  let calls = 0;
  bridge.createReferralBundle = async () => { calls++; };
  bridge.referralDispatcher.dispatch = async () => { calls++; };
  await assert.rejects(bridge.dispatchReferral('synthetic', {}, { url: 'https://example.invalid', credentials: { token: 'synthetic' } }), { status: 503, code: 'REFERRAL_TRANSPORT_UNAVAILABLE' });
  assert.equal(calls, 0);
});

function fixture() {
  const routes = new Map(), queries = []; const state = { bundles: 0, clinicalChecks: 0 };
  const router = {}; for (const method of ['get', 'post', 'delete']) router[method] = (path, ...handlers) => routes.set(`${method} ${path}`, handlers);
  const actualAccess = require('../services/clinicalPatientAccessService').assertClinicalPatientAccess;
  const db = { async query(sql) { queries.push(sql); if (sql.includes('connected_organizations')) return { rows: [{ id: crypto.randomUUID(), fhir_endpoint: 'https://example.invalid/fhir' }] }; return { rows: [] }; } };
  class Bridge extends FHIRBridge { async createReferralBundle() { state.bundles++; throw Error('Must not construct external bundle'); } }
  const dependencies = {
    express: { Router: () => router }, '../db': db,
    '../middleware/auth': { authenticate() {}, requireRole: (...roles) => Object.assign(function roleGate() {}, { roles }) },
    '../services/fhir-bridge': Bridge, '../services/analytics-engine': class {},
    '../services/clinicalPatientAccessService': { assertClinicalPatientAccess: async (...args) => { state.clinicalChecks++; return actualAccess(...args); } },
    '../middleware/audit': { auditMiddleware: () => () => {} },
  };
  const sourceModule = { exports: {} };
  vm.runInNewContext(fs.readFileSync(require.resolve('../routes/interoperability'), 'utf8'), {
    module: sourceModule, exports: sourceModule.exports, console,
    require(name) { assert.ok(name in dependencies, name); return dependencies[name]; }
  });
  return { routes, queries, state };
}
function response() { return { statusCode: 200, status(value) { this.statusCode = value; return this; }, json(value) { this.body = value; return this; } }; }

test('actual legacy referral route returns explicit unavailable before preparing an external disclosure', async () => {
  const f = fixture(), route = f.routes.get('post /referrals'), res = response();
  assert.deepEqual(Array.from(route[1].roles), ['provider']);
  await route.at(-1)({ body: { patientId: crypto.randomUUID(), destinationOrganizationId: crypto.randomUUID() }, user: { id: crypto.randomUUID() } }, res);
  assert.equal(res.statusCode, 503); assert.equal(f.state.bundles, 0);
  assert.equal(f.queries.length, 1); assert.doesNotMatch(f.queries[0], /SELECT \*|client_id|client_secret/); assert.doesNotMatch(JSON.stringify(res.body), /example\.invalid|client_secret|token_endpoint/);
});

test('actual patient-resource scope does not equate administrative financial access with clinical access', async () => {
  const f = fixture(), scope = f.routes.get('get /fhir/Patient/:id')[1], res = response(); let next = false;
  await scope({ params: { id: crypto.randomUUID() }, user: { id: crypto.randomUUID(), role: 'admin', marketScope: 'NG' } }, res, () => { next = true; });
  assert.equal(f.state.clinicalChecks, 1); assert.equal(res.statusCode, 404); assert.equal(next, false); assert.equal(f.queries.length, 0);
});
