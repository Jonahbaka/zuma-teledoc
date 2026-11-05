'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const validation = require('../services/predictive-engine/model-validation');
const now = Date.parse('2026-11-05T12:00:00Z');
const model = { id: 'model-fictional', model_name: 'fictional_evaluated_model', model_type: 'no_show', model_version: '1',
  trained_by: 'fictional_research', algorithm: 'logistic_regression', feature_names: ['visits'], model_weights: { intercept: -1, visits: 0 } };
function approval(overrides = {}) { return { modelId: model.id, artifactSha256: validation.artifactDigest(model), markets: ['US'],
  inputContract: validation.CONTRACT, reviewedBy: 'fictional reviewer', evidenceReference: 'fictional-evaluation-only',
  reviewedAt: '2026-11-01T00:00:00Z', expiresAt: '2026-12-01T00:00:00Z', maxInputAgeSeconds: 300,
  featureRanges: { visits: [0, 100] }, ...overrides }; }
const options = value => ({ now, env: { PREDICTIVE_MODEL_APPROVALS_JSON: JSON.stringify([value]) } });
test('unvalidated and historical default models cannot become clinical scores even with advertised metrics', () => {
  assert.throws(() => validation.assertReviewedModel(model, 'US', { now, env: {} }), { code: 'PREDICTIVE_MODEL_UNVALIDATED' });
  for (const change of [{ trained_by: 'system_default' }, { model_name: 'sepsis_baseline' }, { model_weights: {} }, { algorithm: 'invented' }]) {
    const altered = { ...model, ...change, training_metrics: { accuracy: 0.99 } };
    assert.throws(() => validation.assertReviewedModel(altered, 'US', options(approval({ artifactSha256: validation.artifactDigest(altered) }))), { code: 'PREDICTIVE_MODEL_UNVALIDATED' });
  }
});
test('approval is bound to exact model artifact, allowed market, evidence and expiration', () => {
  assert.equal(validation.assertReviewedModel(model, 'US', options(approval())).modelId, model.id);
  assert.throws(() => validation.assertReviewedModel(model, 'NG', options(approval())), { code: 'PREDICTIVE_MODEL_UNVALIDATED' });
  for (const change of [{ artifactSha256: '0'.repeat(64) }, { expiresAt: '2026-01-01' }, { reviewedAt: '2027-01-01' }, { evidenceReference: '' }, { featureRanges: {} }]) {
    assert.throws(() => validation.assertReviewedModel(model, 'US', options(approval(change))), { code: 'PREDICTIVE_MODEL_UNVALIDATED' });
  }
  const altered = { ...model, model_weights: { intercept: -2, visits: 0 } };
  assert.throws(() => validation.assertReviewedModel(altered, 'US', options(approval())), { code: 'PREDICTIVE_MODEL_UNVALIDATED' });
});
test('missing, stale, implausible and string inputs abstain; measured zero remains valid', () => {
  const input = { contract: validation.CONTRACT, observedAt: new Date(now).toISOString(), features: { visits: 0 } };
  assert.deepEqual(validation.validateInputs(model, input, approval(), { now }), { visits: 0 });
  for (const altered of [null, { ...input, features: {} }, { ...input, features: { visits: '0' } },
    { ...input, features: { visits: Infinity } }, { ...input, features: { visits: 101 } },
    { ...input, observedAt: '2026-11-04T00:00:00Z' }, { ...input, observedAt: '2026-11-06T00:00:00Z' }]) {
    assert.throws(() => validation.validateInputs(model, altered, approval(), { now }), { code: 'PREDICTIVE_INPUTS_UNVERIFIED' });
  }
});

test('artifact approval cannot enable preprocessing unsupported by the serving scorer', () => {
  for (const preprocessing_config of [{ standardize: { visits: { mean: 10, scale: 2 } } },
    { impute: { visits: 0 } }, { type: 'identity' }, [], 'identity', false, 0]) {
    const transformed = { ...model, preprocessing_config };
    const evidence = approval({ artifactSha256: validation.artifactDigest(transformed) });
    assert.throws(() => validation.assertReviewedModel(transformed, 'US', options(evidence)), { code: 'PREDICTIVE_MODEL_UNVALIDATED' });
  }
  const raw = { ...model, preprocessing_config: {} };
  assert.equal(validation.assertReviewedModel(raw, 'US', options(approval({ artifactSha256: validation.artifactDigest(raw) }))).modelId, model.id);
});

// Load serving code against a database that cannot touch a real environment.
const dbId = require.resolve('../db');
let writes = 0;
require.cache[dbId] = { id: dbId, filename: dbId, loaded: true, exports: { query: async () => { writes++; throw new Error('No fixture query configured'); } } };
const registry = require('../services/predictive-engine/model-registry');
const featureStore = require('../services/predictive-engine/feature-store');
const inference = require('../services/predictive-engine/inference-engine');
const engine = require('../services/predictive-engine');
test('startup does not register or auto-promote synthetic baseline models', async () => {
  const before = writes;
  assert.equal(await registry.registerDefaultModels(), 0);
  assert.equal(writes, before);
});
test('legacy missing-data adapters cannot furnish verified clinical inputs', async () => {
  await assert.rejects(featureStore.computeVerifiedInputs('fictional', model), { code: 'PREDICTIVE_INPUTS_UNVERIFIED' });
});
test('reviewed scoring respects zero coefficients and rejects unknown algorithms', () => {
  assert.equal(inference.scoreModel(model, { visits: 50 }), 1 / (1 + Math.exp(1)));
  assert.throws(() => inference.scoreModel({ ...model, algorithm: 'unknown' }, { visits: 1 }), { code: 'PREDICTIVE_ALGORITHM_UNSUPPORTED' });
});
test('all failed models remain unassessed instead of implying zero or minimal risk', async () => {
  const original = inference.predictAll;
  const initialized = engine.initialized;
  engine.initialized = true;
  inference.predictAll = async () => ({ no_show: { error: 'Unavailable', riskScore: null } });
  try {
    const profile = await engine.getPatientRiskProfile('fictional');
    assert.equal(profile.overallRiskScore, null);
    assert.equal(profile.overallRiskLevel, null);
    assert.equal(profile.assessmentStatus, 'unassessed');
  } finally { inference.predictAll = original; engine.initialized = initialized; }
});

test('historical predictions need matching artifact and input provenance, not only an approved current model', async () => {
  const previous = process.env.PREDICTIVE_MODEL_APPROVALS_JSON;
  const currentApproval = approval({ reviewedAt: new Date(Date.now() - 1000).toISOString(), expiresAt: new Date(Date.now() + 3600000).toISOString() });
  process.env.PREDICTIVE_MODEL_APPROVALS_JSON = JSON.stringify([currentApproval]);
  const access = require('../services/predictive-engine/access-policy');
  const safeContext = { artifactSha256: currentApproval.artifactSha256, market: 'US', inputContract: validation.CONTRACT };
  const rows = [
    { id: 'legacy', model, risk_score: 0.9 },
    { id: 'foreign-market', model, risk_score: 0.9, request_context: { ...safeContext, market: 'NG' } },
    { id: 'old-artifact', model, risk_score: 0.9, request_context: { ...safeContext, artifactSha256: 'old' } },
    { id: 'verified', model, risk_score: 0.1, request_context: safeContext },
  ];
  try {
    const result = await access.history({ query: async () => ({ rows }) }, { patientHash: 'fictional', market: 'US' });
    assert.deepEqual(result.map(row => row.id), ['verified']);
    assert.equal(result[0].request_context, undefined);
    assert.equal(result[0].model, undefined);
  } finally { if (previous === undefined) delete process.env.PREDICTIVE_MODEL_APPROVALS_JSON; else process.env.PREDICTIVE_MODEL_APPROVALS_JSON = previous; }
});
