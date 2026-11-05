'use strict';

const crypto = require('crypto');
const { assertClinicalPatientAccess, references, denied } = require('../clinicalPatientAccessService');
const { assertReviewedModel } = require('./model-validation');

const hash = id => crypto.createHash('sha256').update(id).digest('hex');
const bounded = (value, fallback, max) => Math.max(1, Math.min(Number.parseInt(value, 10) || fallback, max));

const AUDIT_OPERATIONS = Object.freeze({
  access: ['read', 'predictive_clinical'],
  risk_profile: ['read', 'predictive_clinical'],
  predict: ['read', 'predictive_clinical'],
  explain: ['read', 'predictive_clinical'],
  history: ['read', 'predictive_clinical'],
  features: ['read', 'predictive_clinical'],
  alerts: ['read', 'predictive_alert'],
  acknowledge: ['update', 'predictive_alert'],
  outcome: ['update', 'predictive_outcome'],
});

async function withPatient(database, patientId, actor, work, auditContext = { operation: 'access' }) {
  references(patientId, actor?.id);
  if (!Object.hasOwn(AUDIT_OPERATIONS, auditContext.operation)) throw denied(503, 'PREDICTIVE_AUDIT_REQUIRED', 'Predictive audit context is required.');
  const resourceId = auditContext.resourceId || patientId;
  references(resourceId);
  if (actor.role !== 'provider' || !['US', 'NG'].includes(actor.marketScope)) throw denied(403, 'CLINICAL_ACCESS_DENIED', 'Current clinical authority is required.');
  const client = await database.getClient();
  try {
    await client.query('BEGIN');
    await assertClinicalPatientAccess(client, patientId, actor, { providerOnly: true, lock: true });
    const result = await work(client, { patientId, patientHash: hash(patientId), market: actor.marketScope, actor });
    const [action, resourceType] = AUDIT_OPERATIONS[auditContext.operation];
    // Required audit commits atomically with mutations. Reads are not released
    // to the caller unless this metadata-only durable trail succeeds.
    await client.query(`INSERT INTO audit_logs
      (user_id,action,resource_type,resource_id,description,phi_accessed,patient_id,success)
      VALUES ($1,$2,$3,$4,$5,TRUE,$6,TRUE)`,
    [actor.id, action, resourceType, resourceId, `Predictive ${auditContext.operation}`, patientId]);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}

// Historic predictions without an approved artifact are not current clinical evidence.
function reviewed(row, market) {
  try {
    const approval = assertReviewedModel(row.model, market);
    const provenance = row.prediction_context || row.request_context;
    return provenance?.artifactSha256 === approval.artifactSha256 && provenance?.market === market &&
      provenance?.inputContract === approval.inputContract;
  } catch { return false; }
}

async function history(client, scope, query = {}) {
  const result = await client.query(`SELECT p.*, row_to_json(m) AS model FROM ml_predictions p
    JOIN ml_models m ON m.id=p.model_id WHERE p.patient_hash=$1
    AND p.created_at > NOW() - ($2::integer * INTERVAL '1 day')
    AND ($3::text IS NULL OR p.prediction_type=$3)
    ORDER BY p.created_at DESC LIMIT $4`, [scope.patientHash, bounded(query.days, 30, 365), query.predictionType || null, bounded(query.limit, 100, 200)]);
  return result.rows.filter(row => reviewed(row, scope.market)).map(row => ({
    id: row.id, prediction_type: row.prediction_type, risk_score: row.risk_score, risk_level: row.risk_level,
    prediction_label: row.prediction_label, created_at: row.created_at, model_version: row.model_version,
    status: 'reviewed_model_output', requiresClinicalReview: true,
  }));
}

async function alerts(client, scope, query = {}) {
  const result = await client.query(`SELECT a.*, p.request_context AS prediction_context, row_to_json(m) AS model FROM ml_alerts a
    JOIN ml_predictions p ON p.id=a.prediction_id JOIN ml_models m ON m.id=p.model_id
    WHERE p.patient_hash=$1 AND a.target_user_id=$2 AND a.status='active'
      AND (a.expires_at IS NULL OR a.expires_at>NOW())
      AND ($3::text IS NULL OR a.severity=$3)
    ORDER BY a.created_at DESC LIMIT $4`, [scope.patientHash, scope.actor.id, query.severity || null, bounded(query.limit, 50, 100)]);
  return result.rows.filter(row => reviewed(row, scope.market)).map(({ model, prediction_context, ...row }) => row);
}

async function acknowledge(client, scope, alertId, action) {
  references(alertId);
  if (action != null && (typeof action !== 'string' || action.trim().length > 1000)) throw denied(400, 'INVALID_ACTION', 'A valid action is required.');
  const result = await client.query(`SELECT a.id, p.request_context AS prediction_context, row_to_json(m) AS model FROM ml_alerts a
    JOIN ml_predictions p ON p.id=a.prediction_id JOIN ml_models m ON m.id=p.model_id
    WHERE a.id=$1 AND p.patient_hash=$2 AND a.target_user_id=$3 AND a.status='active'
    FOR UPDATE OF a`, [alertId, scope.patientHash, scope.actor.id]);
  if (!result.rows[0] || !reviewed(result.rows[0], scope.market)) throw denied(404, 'ALERT_NOT_FOUND', 'Alert not found in the current care context.');
  await client.query(`UPDATE ml_alerts SET status=$1, acknowledged_by=$2, acknowledged_at=NOW(),
    action_taken=$3::text, action_taken_at=CASE WHEN $3::text IS NOT NULL THEN NOW() ELSE NULL END, updated_at=NOW() WHERE id=$4`,
  [action ? 'acted_upon' : 'acknowledged', scope.actor.id, action || null, alertId]);
  return { acknowledged: true };
}

async function outcome(client, scope, predictionId, value) {
  references(predictionId);
  if (!['positive', 'negative'].includes(value)) throw denied(400, 'INVALID_OUTCOME', 'Outcome must be positive or negative.');
  const result = await client.query(`SELECT p.id,p.risk_score,p.request_context,row_to_json(m) AS model FROM ml_predictions p
    JOIN ml_models m ON m.id=p.model_id WHERE p.id=$1 AND p.patient_hash=$2 FOR UPDATE OF p`, [predictionId, scope.patientHash]);
  if (!result.rows[0] || !reviewed(result.rows[0], scope.market)) throw denied(404, 'PREDICTION_NOT_FOUND', 'Prediction not found in the current care context.');
  await client.query(`UPDATE ml_predictions SET actual_outcome=$1,outcome_date=NOW(),prediction_correct=NULL WHERE id=$2`, [value, predictionId]);
  return { recorded: true };
}

module.exports = { withPatient, history, alerts, acknowledge, outcome, bounded, hash };
