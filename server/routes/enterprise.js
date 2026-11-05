'use strict';

const express = require('express');
const router = express.Router();
const db = require('../db');
const engine = require('../services/predictive-engine');
const registry = require('../services/predictive-engine/model-registry');
const inference = require('../services/predictive-engine/inference-engine');
const { assertReviewedModel, validateInputs, fail } = require('../services/predictive-engine/model-validation');
const { bounded } = require('../services/predictive-engine/access-policy');

function tenantMarket(id) {
  try {
    const market = JSON.parse(process.env.PREDICTIVE_TENANT_MARKETS_JSON || '{}')[id];
    return ['US', 'NG'].includes(market) ? market : null;
  } catch { return null; }
}
function errorResponse(res, error) {
  const status = [400, 401, 403, 404, 429, 503].includes(error.statusCode) ? error.statusCode : 503;
  return res.status(status).json({ success: false, code: error.code || 'PREDICTIVE_UNAVAILABLE', error: 'The requested prediction is unavailable in this tenant context. No clinical assessment was produced.' });
}

router.get('/v1/health', (_req, res) => res.json({ success: true, service: 'DoctaRx Predictive Intelligence API', status: 'requires_reviewed_model_and_verified_inputs' }));
router.use(async (req, res, next) => {
  res.set('Cache-Control', 'private, no-store');
  try {
    // Query-string keys leak into access logs/referrers; accept only a header.
    if (req.query.api_key || typeof req.headers['x-api-key'] !== 'string') return res.status(401).json({ success: false, error: 'An X-API-Key header is required.' });
    const tenant = await engine.validateApiKey(req.headers['x-api-key']);
    if (!tenant) return res.status(401).json({ success: false, error: 'Invalid or inactive API key.' });
    const recent = await db.query(`SELECT COUNT(*) AS call_count FROM ml_api_usage_log WHERE tenant_id=$1 AND created_at>NOW()-INTERVAL '1 minute'`, [tenant.id]);
    if (Number(recent.rows[0]?.call_count) >= Math.max(1, Number(tenant.rate_limit_per_minute) || 100)) return res.status(429).json({ success: false, error: 'Rate limit exceeded.' });
    req.tenant = tenant;
    req.market = tenantMarket(tenant.id);
    req.predictionCount = 0;
    const start = Date.now();
    res.on('finish', () => {
      // Fixed path only: never persist API keys, query strings or submitted features.
      db.query(`INSERT INTO ml_api_usage_log (tenant_id,endpoint,method,model_type,prediction_count,response_time_ms,status_code)
        VALUES ($1,$2,$3,$4,$5,$6,$7)`, [tenant.id, req.route?.path || '/unmatched', req.method,
      typeof req.body?.predictionType === 'string' ? req.body.predictionType.slice(0, 100) : null,
      req.predictionCount, Date.now() - start, res.statusCode]).catch(() => {});
    });
    next();
  } catch (error) { errorResponse(res, error); }
});

function modelAccess(req, endpoint) {
  const type = req.body?.predictionType;
  if (!req.market) throw fail('PREDICTIVE_TENANT_MARKET_REQUIRED', 'A deployment-owned tenant market is required.');
  if (typeof type !== 'string' || !Array.isArray(req.tenant.allowed_models) || !req.tenant.allowed_models.includes(type) ||
      !Array.isArray(req.tenant.allowed_endpoints) || !req.tenant.allowed_endpoints.includes(endpoint)) {
    throw Object.assign(new Error('Tenant model access denied.'), { statusCode: 403, code: 'PREDICTIVE_MODEL_ACCESS_DENIED' });
  }
  return type;
}
function rejectPatientLookup(body) {
  // There is no authoritative tenant-to-patient mapping in this schema. An API
  // key must never grant access to another organization's stored patient data.
  if (body?.patientId != null || body?.patientData?.patientId != null) {
    throw Object.assign(new Error('Stored patient access is not authorized.'), { statusCode: 403, code: 'PREDICTIVE_TENANT_PATIENT_SCOPE_REQUIRED' });
  }
}
async function score(req, body) {
  rejectPatientLookup(body);
  const { model } = await registry.getModelForInference(req.body.predictionType, req.market);
  const approval = assertReviewedModel(model, req.market);
  const features = validateInputs(model, body?.patientData, approval);
  const riskScore = inference.scoreModel(model, features);
  if (!Number.isFinite(riskScore)) throw fail('PREDICTIVE_INVALID_OUTPUT', 'Invalid model result.');
  return { type: model.model_type, riskScore, modelVersion: model.model_version,
    confidence: null, requiresClinicalReview: true, status: 'reviewed_model_output',
    computedAt: new Date().toISOString() };
}
router.post('/v1/predict', async (req, res) => {
  try {
    rejectPatientLookup(req.body);
    modelAccess(req, 'predict');
    const prediction = await score(req, req.body);
    await db.query('UPDATE ml_enterprise_tenants SET total_predictions=total_predictions+1 WHERE id=$1', [req.tenant.id]);
    req.predictionCount = 1;
    res.json({ success: true, data: { prediction } });
  } catch (error) { errorResponse(res, error); }
});
router.post('/v1/batch-predict', async (req, res) => {
  try {
    const patients = req.body?.patients;
    if (!Array.isArray(patients) || patients.length < 1 || patients.length > 100) return res.status(400).json({ success: false, error: 'Provide between 1 and 100 feature inputs.' });
    for (const patient of patients) rejectPatientLookup(patient);
    modelAccess(req, 'batch_predict');
    // Validate the whole batch before producing/billing any result.
    const predictions = [];
    for (const patient of patients) predictions.push(await score(req, { patientData: patient.patientData || patient }));
    await db.query('UPDATE ml_enterprise_tenants SET total_predictions=total_predictions+$1 WHERE id=$2', [predictions.length, req.tenant.id]);
    req.predictionCount = predictions.length;
    res.json({ success: true, data: { predictions } });
  } catch (error) { errorResponse(res, error); }
});
router.post('/v1/risk-stratify', (_req, res) => res.status(503).json({ success: false, code: 'PREDICTIVE_TENANT_PATIENT_SCOPE_REQUIRED', error: 'A reviewed tenant-scoped patient dataset is required.' }));
router.get('/v1/models', async (req, res) => {
  try {
    const status = await engine.getModelStatus(req.market);
    const models = status.champions.filter(model => model.status === 'reviewed' && req.tenant.allowed_models?.includes(model.type));
    res.json({ success: true, data: { models } });
  } catch (error) { errorResponse(res, error); }
});
router.get('/v1/usage', async (req, res) => {
  try {
    const days = bounded(req.query.days, 30, 365);
    const result = await db.query(`SELECT COUNT(*) AS total_calls,COALESCE(SUM(prediction_count),0) AS total_predictions,
      AVG(response_time_ms) AS avg_response_ms FROM ml_api_usage_log WHERE tenant_id=$1 AND created_at>NOW()-($2::integer*INTERVAL '1 day')`, [req.tenant.id, days]);
    res.json({ success: true, data: { summary: { ...result.rows[0], periodDays: days } } });
  } catch (error) { errorResponse(res, error); }
});
module.exports = router;
