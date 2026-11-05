'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const validation = require('../services/predictive-engine/model-validation');
const stub = (path, exports) => { const id = require.resolve(path); require.cache[id] = { id, filename: id, loaded: true, exports }; };
const model = { id: 'fictional-model', model_name: 'fictional-reviewed', model_version: '1', model_type: 'no_show', algorithm: 'logistic_regression', feature_names: ['visits'], model_weights: { intercept: -1, visits: 0 }, trained_by: 'fictional' };
let lookups = 0;
let billed = 0;
const previous = { approvals: process.env.PREDICTIVE_MODEL_APPROVALS_JSON, tenants: process.env.PREDICTIVE_TENANT_MARKETS_JSON };
const now = Date.now();
process.env.PREDICTIVE_MODEL_APPROVALS_JSON = JSON.stringify([{ modelId: model.id, artifactSha256: validation.artifactDigest(model), markets: ['US'], inputContract: validation.CONTRACT,
  reviewedBy: 'fictional reviewer', evidenceReference: 'fictional-test-only', reviewedAt: new Date(now - 1000).toISOString(), expiresAt: new Date(now + 3600000).toISOString(), maxInputAgeSeconds: 300, featureRanges: { visits: [0, 100] } }]);
process.env.PREDICTIVE_TENANT_MARKETS_JSON = JSON.stringify({ tenantUS: 'US', tenantNG: 'NG' });
stub('../db', { query: async (sql, args) => {
  if (sql.startsWith('SELECT COUNT(*) AS call_count')) return { rows: [{ call_count: 0 }] };
  if (sql.startsWith('INSERT INTO ml_api_usage_log')) { assert.ok(!String(args[1]).includes('?')); return { rows: [] }; }
  if (sql.startsWith('UPDATE ml_enterprise_tenants')) { billed++; return { rows: [] }; }
  throw new Error('No stored patient queries are allowed in this fixture.');
} });
stub('../services/predictive-engine', {
  validateApiKey: async key => ['tenantUS', 'tenantNG', 'unmapped'].includes(key) ? { id: key, rate_limit_per_minute: 100, allowed_models: ['no_show'], allowed_endpoints: ['predict', 'batch_predict'] } : null,
  predict: async () => { lookups++; throw new Error('Stored patient lookup prohibited'); },
  stratifyPopulation: async () => { lookups++; throw new Error('Population lookup prohibited'); },
});
stub('../services/predictive-engine/model-registry', { getModelForInference: async (_type, market) => { validation.assertReviewedModel(model, market); return { model }; } });
stub('../services/predictive-engine/inference-engine', { scoreModel: () => 0.2689 });
const app = express(); app.use(express.json()); app.use(require('../routes/enterprise'));
let server, base;
test.before(async () => { server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve)); base = `http://127.0.0.1:${server.address().port}`; });
test.after(async () => {
  for (const [key, value] of [['PREDICTIVE_MODEL_APPROVALS_JSON', previous.approvals], ['PREDICTIVE_TENANT_MARKETS_JSON', previous.tenants]]) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  await new Promise(resolve => server.close(resolve));
});
const input = () => ({ contract: validation.CONTRACT, observedAt: new Date().toISOString(), features: { visits: 0 } });
const request = (path, tenant, body) => fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', ...(tenant ? { 'x-api-key': tenant } : {}) }, body: JSON.stringify(body) });
test('enterprise keys cannot query stored patient IDs or global population', async () => {
  for (const tenant of ['tenantUS', 'tenantNG']) {
    assert.equal((await request('/v1/predict', tenant, { patientId: 'foreign-patient', predictionType: 'no_show' })).status, 403);
    assert.equal((await request('/v1/batch-predict', tenant, { patients: [{ patientId: 'foreign-patient' }], predictionType: 'no_show' })).status, 403);
    assert.equal((await request('/v1/risk-stratify', tenant, { predictionType: 'no_show' })).status, 503);
  }
  assert.equal(lookups, 0);
  assert.equal(billed, 0);
});
test('feature-only serving requires deployment tenant market and matching reviewed artifact', async () => {
  for (const tenant of ['tenantNG', 'unmapped']) {
    const response = await request('/v1/predict', tenant, { predictionType: 'no_show', market: 'US', patientData: input() });
    assert.equal(response.status, 503);
    assert.equal((await response.json()).data, undefined);
  }
  const response = await request('/v1/predict', 'tenantUS', { predictionType: 'no_show', patientData: input() });
  assert.equal(response.status, 200);
  const { data } = await response.json();
  assert.equal(data.prediction.requiresClinicalReview, true);
  assert.equal(data.prediction.confidence, null);
  assert.equal(data.prediction.recommendedActions, undefined);
});
test('missing model inputs and partial bad batch do not produce results or billing', async () => {
  const before = billed;
  assert.equal((await request('/v1/predict', 'tenantUS', { predictionType: 'no_show', patientData: { ...input(), features: {} } })).status, 503);
  const response = await request('/v1/batch-predict', 'tenantUS', { predictionType: 'no_show', patients: [input(), { ...input(), features: { visits: '0' } }] });
  assert.equal(response.status, 503);
  assert.equal((await response.json()).data, undefined);
  assert.equal(billed, before);
});
test('query-string API keys are rejected before authentication or logging', async () => {
  assert.equal((await request('/v1/predict?api_key=fictional', null, {})).status, 401);
});
