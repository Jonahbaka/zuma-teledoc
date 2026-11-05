'use strict';

const express = require('express');
const router = express.Router();
const db = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');
const engine = require('../services/predictive-engine');
const access = require('../services/predictive-engine/access-policy');

function respondError(res, error) {
  const status = [400, 403, 404, 503].includes(error.statusCode) ? error.statusCode : 503;
  return res.status(status).json({ success: false, code: error.code || 'PREDICTIVE_UNAVAILABLE',
    error: status === 503 ? 'Predictive information is unavailable. No clinical risk assessment was produced.' : 'Request unavailable in the current patient and care context.' });
}
function patientOperation(resolveId, auditOperation, operation, resolveResource = resolveId) {
  return async (req, res) => {
    try {
      const data = await access.withPatient(db, resolveId(req), req.user, (client, scope) => operation(req, client, scope),
        { operation: auditOperation, resourceId: resolveResource(req) });
      res.json({ success: true, data });
    } catch (error) { respondError(res, error); }
  };
}
const patientId = req => req.params.patientId;
const selectedPatient = req => req.method === 'GET' ? req.query.patientId : req.body?.patientId;
router.use(authenticate, (_req, res, next) => { res.set('Cache-Control', 'private, no-store'); next(); });

// Administrative role alone is not clinical patient authority. Patient-level
// reads/mutations use the same current relationship and market policy as EHR.
router.get('/patient/:patientId/risk-profile', requireRole('provider'), patientOperation(patientId, 'risk_profile', (req, _client, scope) =>
  engine.getPatientRiskProfile(scope.patientId, { actor: req.user, market: scope.market, requestedBy: req.user.id })));
router.post('/patient/:patientId/predict', requireRole('provider'), patientOperation(patientId, 'predict', (req, _client, scope) =>
  engine.predict(scope.patientId, req.body?.predictionType, { actor: req.user, market: scope.market, requestedBy: req.user.id })));
router.get('/patient/:patientId/explain/:predictionType', requireRole('provider'), patientOperation(patientId, 'explain', (req, _client, scope) =>
  engine.explainPrediction(scope.patientId, req.params.predictionType, { actor: req.user, market: scope.market })));
router.get('/patient/:patientId/history', requireRole('provider'), patientOperation(patientId, 'history', (req, client, scope) => access.history(client, scope, req.query)));
router.get('/patient/:patientId/features', requireRole('provider'), patientOperation(patientId, 'features', () => {
  throw Object.assign(new Error('Legacy feature sources require verification.'), { statusCode: 503, code: 'PREDICTIVE_INPUTS_UNVERIFIED' });
}));
router.get('/alerts', requireRole('provider'), patientOperation(selectedPatient, 'alerts', (req, client, scope) => access.alerts(client, scope, req.query)));
router.post('/alerts/:alertId/acknowledge', requireRole('provider'),
  patientOperation(selectedPatient, 'acknowledge', (req, client, scope) => access.acknowledge(client, scope, req.params.alertId, req.body?.action), req => req.params.alertId));
router.post('/predictions/:predictionId/outcome', requireRole('provider'),
  patientOperation(selectedPatient, 'outcome', (req, client, scope) => access.outcome(client, scope, req.params.predictionId, req.body?.outcome), req => req.params.predictionId));

// These legacy jobs have no market/tenant-scoped dataset contract. Keep the
// routes explicit and unavailable rather than broadening clinical authority.
const scopedDatasetRequired = (_req, res) => res.status(503).json({ success: false, code: 'PREDICTIVE_DATASET_SCOPE_REQUIRED',
  error: 'A reviewed, market-scoped dataset is required for this operation.' });
router.get('/population/stratify/:predictionType', requireRole('admin', 'super_admin'), scopedDatasetRequired);
router.get('/stats', requireRole('admin', 'super_admin'), scopedDatasetRequired);
router.post('/models/train/:modelType', requireRole('super_admin'), scopedDatasetRequired);
router.post('/models/train-all', requireRole('super_admin'), scopedDatasetRequired);
router.post('/features/batch-compute', requireRole('super_admin'), scopedDatasetRequired);
router.get('/models/status', requireRole('admin', 'super_admin'), async (req, res) => {
  try { res.json({ success: true, data: await engine.getModelStatus(req.user.marketScope) }); } catch (error) { respondError(res, error); }
});
router.post('/models/:modelId/promote', requireRole('super_admin'), async (req, res) => {
  try { const model = await engine.promoteModel(req.params.modelId); res.json({ success: true, data: { id: model.id, status: model.status } }); }
  catch (error) { respondError(res, error); }
});
router.get('/health', (_req, res) => res.json({ success: true, data: { ...engine.getHealthStatus(), clinicalReadiness: 'requires_reviewed_model_and_verified_inputs' } }));

module.exports = router;
