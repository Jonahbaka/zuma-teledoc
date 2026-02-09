/**
 * Predictive Intelligence API Routes
 * 
 * Internal API endpoints for the DoctaRx predictive engine.
 * Used by the provider dashboard, admin panel, and clinical workflows.
 */

const express = require('express');
const router = express.Router();
const { authenticate, requireRole } = require('../middleware/auth');
const authorize = (roles) => requireRole(...roles);

let predictiveEngine;
try {
  predictiveEngine = require('../services/predictive-engine');
} catch (error) {
  console.error('Predictive engine not available:', error.message);
}

// Middleware: Ensure engine is available
const ensureEngine = (req, res, next) => {
  if (!predictiveEngine) {
    return res.status(503).json({ success: false, error: 'Predictive engine not available' });
  }
  next();
};

// =========================================================================
// PATIENT PREDICTIONS
// =========================================================================

/**
 * GET /api/predictive/patient/:patientId/risk-profile
 * Get complete risk profile for a patient (all 7 models)
 */
router.get('/patient/:patientId/risk-profile', authenticate, authorize(['provider', 'admin', 'super_admin']), ensureEngine, async (req, res) => {
  try {
    const { patientId } = req.params;
    const profile = await predictiveEngine.getPatientRiskProfile(patientId, {
      triggeredBy: 'api',
      requestedBy: req.user.id
    });

    // Generate alerts for critical/high risks
    const alerts = await predictiveEngine.generateAlerts(patientId, profile.predictions);

    res.json({
      success: true,
      data: {
        ...profile,
        alerts
      }
    });
  } catch (error) {
    console.error('Risk profile error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/predictive/patient/:patientId/predict
 * Get a specific prediction for a patient
 */
router.post('/patient/:patientId/predict', authenticate, authorize(['provider', 'admin', 'super_admin']), ensureEngine, async (req, res) => {
  try {
    const { patientId } = req.params;
    const { predictionType, context } = req.body;

    const validTypes = ['readmission_risk', 'claims_denial', 'no_show', 'sepsis_warning', 'disease_progression', 'cost_forecast', 'quality_measures'];
    if (!validTypes.includes(predictionType)) {
      return res.status(400).json({ success: false, error: `Invalid prediction type. Valid types: ${validTypes.join(', ')}` });
    }

    const prediction = await predictiveEngine.predict(patientId, predictionType, {
      ...context,
      triggeredBy: 'api',
      requestedBy: req.user.id
    });

    res.json({ success: true, data: prediction });
  } catch (error) {
    console.error('Prediction error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/predictive/patient/:patientId/explain/:predictionType
 * Get detailed explainability for a prediction
 */
router.get('/patient/:patientId/explain/:predictionType', authenticate, authorize(['provider', 'admin', 'super_admin']), ensureEngine, async (req, res) => {
  try {
    const { patientId, predictionType } = req.params;
    const explanation = await predictiveEngine.explainPrediction(patientId, predictionType);

    res.json({ success: true, data: explanation });
  } catch (error) {
    console.error('Explanation error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/predictive/patient/:patientId/history
 * Get prediction history for a patient
 */
router.get('/patient/:patientId/history', authenticate, authorize(['provider', 'admin', 'super_admin']), ensureEngine, async (req, res) => {
  try {
    const { patientId } = req.params;
    const { predictionType, days, limit } = req.query;

    const history = await predictiveEngine.getPredictionHistory(patientId, {
      predictionType,
      days: parseInt(days) || 30,
      limit: parseInt(limit) || 100
    });

    res.json({ success: true, data: history });
  } catch (error) {
    console.error('History error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/predictive/patient/:patientId/features
 * Get computed features for a patient (for debugging/transparency)
 */
router.get('/patient/:patientId/features', authenticate, authorize(['provider', 'admin', 'super_admin']), ensureEngine, async (req, res) => {
  try {
    const { patientId } = req.params;
    const features = await predictiveEngine.getPatientFeatures(patientId);

    res.json({ success: true, data: features });
  } catch (error) {
    console.error('Features error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// =========================================================================
// POPULATION ANALYTICS
// =========================================================================

/**
 * GET /api/predictive/population/stratify/:predictionType
 * Get population-level risk stratification
 */
router.get('/population/stratify/:predictionType', authenticate, authorize(['admin', 'super_admin']), ensureEngine, async (req, res) => {
  try {
    const { predictionType } = req.params;
    const { limit } = req.query;

    const stratification = await predictiveEngine.stratifyPopulation(predictionType, {
      limit: parseInt(limit) || 500
    });

    res.json({ success: true, data: stratification });
  } catch (error) {
    console.error('Stratification error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/predictive/stats
 * Get aggregate prediction statistics
 */
router.get('/stats', authenticate, authorize(['admin', 'super_admin']), ensureEngine, async (req, res) => {
  try {
    const { days } = req.query;
    const stats = await predictiveEngine.getPredictionStats({ days: parseInt(days) || 7 });

    res.json({ success: true, data: stats });
  } catch (error) {
    console.error('Stats error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// =========================================================================
// ALERTS
// =========================================================================

/**
 * GET /api/predictive/alerts
 * Get active predictive alerts
 */
router.get('/alerts', authenticate, authorize(['provider', 'admin', 'super_admin']), ensureEngine, async (req, res) => {
  try {
    const { role, severity, limit } = req.query;
    const alerts = await predictiveEngine.getActiveAlerts({
      role: role || (req.user.role === 'admin' ? undefined : req.user.role),
      severity,
      limit: parseInt(limit) || 50
    });

    res.json({ success: true, data: alerts });
  } catch (error) {
    console.error('Alerts error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/predictive/alerts/:alertId/acknowledge
 * Acknowledge or act on an alert
 */
router.post('/alerts/:alertId/acknowledge', authenticate, authorize(['provider', 'admin', 'super_admin']), ensureEngine, async (req, res) => {
  try {
    const { alertId } = req.params;
    const { action } = req.body;

    await predictiveEngine.acknowledgeAlert(alertId, req.user.id, action);

    res.json({ success: true, message: 'Alert acknowledged' });
  } catch (error) {
    console.error('Alert acknowledge error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// =========================================================================
// MODEL MANAGEMENT
// =========================================================================

/**
 * GET /api/predictive/models/status
 * Get status of all predictive models
 */
router.get('/models/status', authenticate, authorize(['admin', 'super_admin']), ensureEngine, async (req, res) => {
  try {
    const status = await predictiveEngine.getModelStatus();
    res.json({ success: true, data: status });
  } catch (error) {
    console.error('Model status error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/predictive/models/train/:modelType
 * Trigger model training
 */
router.post('/models/train/:modelType', authenticate, authorize(['super_admin']), ensureEngine, async (req, res) => {
  try {
    const { modelType } = req.params;
    const { options } = req.body;

    // Training runs asynchronously - return immediately
    res.json({ success: true, message: `Training pipeline started for ${modelType}` });
    
    // Run in background
    predictiveEngine.trainModel(modelType, options).catch(err => 
      console.error(`Training failed for ${modelType}:`, err.message)
    );
  } catch (error) {
    console.error('Training trigger error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/predictive/models/train-all
 * Trigger training for all models
 */
router.post('/models/train-all', authenticate, authorize(['super_admin']), ensureEngine, async (req, res) => {
  try {
    res.json({ success: true, message: 'Training pipelines started for all models' });
    
    predictiveEngine.trainAllModels().catch(err => 
      console.error('Bulk training failed:', err.message)
    );
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/predictive/models/:modelId/promote
 * Promote a model to champion
 */
router.post('/models/:modelId/promote', authenticate, authorize(['super_admin']), ensureEngine, async (req, res) => {
  try {
    const { modelId } = req.params;
    const model = await predictiveEngine.promoteModel(modelId);
    res.json({ success: true, data: model });
  } catch (error) {
    console.error('Promotion error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/predictive/predictions/:predictionId/outcome
 * Record actual outcome for a prediction (for model validation)
 */
router.post('/predictions/:predictionId/outcome', authenticate, authorize(['provider', 'admin', 'super_admin']), ensureEngine, async (req, res) => {
  try {
    const { predictionId } = req.params;
    const { outcome } = req.body;

    await predictiveEngine.recordOutcome(predictionId, outcome);
    res.json({ success: true, message: 'Outcome recorded' });
  } catch (error) {
    console.error('Outcome recording error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// =========================================================================
// FEATURE STORE MANAGEMENT
// =========================================================================

/**
 * POST /api/predictive/features/batch-compute
 * Trigger batch feature computation for all patients
 */
router.post('/features/batch-compute', authenticate, authorize(['super_admin']), ensureEngine, async (req, res) => {
  try {
    res.json({ success: true, message: 'Batch feature computation started' });
    
    predictiveEngine.batchComputeFeatures().catch(err => 
      console.error('Batch feature computation failed:', err.message)
    );
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// =========================================================================
// HEALTH CHECK
// =========================================================================

/**
 * GET /api/predictive/health
 * Health check for the predictive engine
 */
router.get('/health', (req, res) => {
  const status = predictiveEngine ? predictiveEngine.getHealthStatus() : { initialized: false };
  res.json({ success: true, data: status });
});

module.exports = router;
