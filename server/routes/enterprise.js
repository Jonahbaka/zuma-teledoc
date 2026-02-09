/**
 * Enterprise API Routes
 * 
 * B2B API endpoints for hospitals and insurance companies.
 * Authenticated via API keys (not JWT), rate-limited per tenant.
 */

const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const db = require('../db');

let predictiveEngine;
try {
  predictiveEngine = require('../services/predictive-engine');
} catch (error) {
  console.error('Predictive engine not available for enterprise API:', error.message);
}

// =========================================================================
// ENTERPRISE API KEY AUTHENTICATION MIDDLEWARE
// =========================================================================

const authenticateApiKey = async (req, res, next) => {
  try {
    const apiKey = req.headers['x-api-key'] || req.query.api_key;
    
    if (!apiKey) {
      return res.status(401).json({
        success: false,
        error: 'API key required. Include X-API-Key header or api_key query parameter.'
      });
    }

    if (!predictiveEngine) {
      return res.status(503).json({ success: false, error: 'Predictive engine not available' });
    }

    const tenant = await predictiveEngine.validateApiKey(apiKey);
    
    if (!tenant) {
      return res.status(401).json({ success: false, error: 'Invalid or inactive API key' });
    }

    // Check rate limit
    const recentCalls = await db.query(`
      SELECT COUNT(*) as call_count 
      FROM ml_api_usage_log 
      WHERE tenant_id = $1 AND created_at > NOW() - INTERVAL '1 minute'
    `, [tenant.id]);

    if (parseInt(recentCalls.rows[0].call_count) >= tenant.rate_limit_per_minute) {
      return res.status(429).json({
        success: false,
        error: 'Rate limit exceeded',
        retryAfter: 60
      });
    }

    req.tenant = tenant;
    req.tenantId = tenant.id;
    next();
  } catch (error) {
    console.error('Enterprise auth error:', error.message);
    res.status(500).json({ success: false, error: 'Authentication failed' });
  }
};

// Log API usage
const logUsage = async (req, res, next) => {
  const start = Date.now();
  
  res.on('finish', async () => {
    try {
      if (req.tenantId) {
        await db.query(`
          INSERT INTO ml_api_usage_log (tenant_id, endpoint, method, model_type, response_time_ms, status_code, ip_address, user_agent)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        `, [
          req.tenantId, req.originalUrl, req.method,
          req.body?.predictionType || req.params?.predictionType || null,
          Date.now() - start, res.statusCode,
          req.ip, req.headers['user-agent']
        ]);
      }
    } catch (error) {
      console.error('Usage logging error:', error.message);
    }
  });

  next();
};

// Check model access
const checkModelAccess = (req, res, next) => {
  const predictionType = req.body?.predictionType || req.params?.predictionType;
  
  if (predictionType && req.tenant) {
    const allowedModels = req.tenant.allowed_models || [];
    if (!allowedModels.includes(predictionType)) {
      return res.status(403).json({
        success: false,
        error: `Your plan does not include access to ${predictionType}. Allowed models: ${allowedModels.join(', ')}`
      });
    }
  }
  
  next();
};

// Apply middleware
router.use(authenticateApiKey, logUsage);

// =========================================================================
// PREDICTION ENDPOINTS
// =========================================================================

/**
 * POST /api/enterprise/v1/predict
 * Single patient prediction
 * 
 * Body: { patientData: { features }, predictionType: string }
 */
router.post('/v1/predict', checkModelAccess, async (req, res) => {
  try {
    const { patientData, predictionType, patientId } = req.body;

    if (!predictionType) {
      return res.status(400).json({
        success: false,
        error: 'predictionType is required',
        validTypes: ['readmission_risk', 'claims_denial', 'no_show', 'sepsis_warning', 'disease_progression', 'cost_forecast', 'quality_measures']
      });
    }

    if (!patientId && !patientData) {
      return res.status(400).json({
        success: false,
        error: 'Either patientId or patientData (with features) is required'
      });
    }

    let prediction;
    if (patientId) {
      prediction = await predictiveEngine.predict(patientId, predictionType, {
        triggeredBy: 'enterprise_api',
        tenantId: req.tenantId
      });
    } else {
      // Direct feature scoring (no patient lookup needed)
      const featureStore = require('../services/predictive-engine/feature-store');
      const modelRegistry = require('../services/predictive-engine/model-registry');
      const inferenceEngine = require('../services/predictive-engine/inference-engine');
      
      const { model } = await modelRegistry.getModelForInference(predictionType);
      if (!model) throw new Error(`No model available for ${predictionType}`);
      
      const score = inferenceEngine.scoreModel(model, patientData.features || patientData);
      const riskLevel = inferenceEngine.computeRiskLevel(score);
      
      prediction = {
        predictionType,
        riskScore: Math.round(score * 10000) / 10000,
        riskLevel,
        confidence: inferenceEngine.computeConfidence(model, patientData.features || patientData, score),
        predictionLabel: inferenceEngine.generateLabel(predictionType, riskLevel, score),
        modelName: model.model_name,
        modelVersion: model.model_version
      };
    }

    // Update prediction count for billing
    await db.query(`
      UPDATE ml_enterprise_tenants SET total_predictions = total_predictions + 1 WHERE id = $1
    `, [req.tenantId]);

    res.json({
      success: true,
      data: {
        prediction: {
          type: prediction.predictionType,
          riskScore: prediction.riskScore,
          riskLevel: prediction.riskLevel,
          confidence: prediction.confidence,
          label: prediction.predictionLabel,
          explanation: prediction.explanation,
          topRiskFactors: prediction.topRiskFactors,
          recommendedActions: prediction.recommendedActions
        },
        model: {
          name: prediction.modelName,
          version: prediction.modelVersion
        },
        meta: {
          inferenceTimeMs: prediction.inferenceTimeMs,
          computedAt: prediction.computedAt || new Date().toISOString()
        }
      }
    });
  } catch (error) {
    console.error('Enterprise prediction error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/enterprise/v1/batch-predict
 * Batch prediction for multiple patients
 * 
 * Body: { patients: [{ patientId, features }], predictionType: string }
 */
router.post('/v1/batch-predict', checkModelAccess, async (req, res) => {
  try {
    const { patients, predictionType } = req.body;

    if (!predictionType || !patients || !Array.isArray(patients)) {
      return res.status(400).json({
        success: false,
        error: 'predictionType and patients array are required'
      });
    }

    if (patients.length > 1000) {
      return res.status(400).json({
        success: false,
        error: 'Maximum 1000 patients per batch request'
      });
    }

    const startTime = Date.now();
    const results = [];

    for (const patient of patients) {
      try {
        const prediction = await predictiveEngine.predict(patient.patientId, predictionType, {
          triggeredBy: 'enterprise_batch',
          tenantId: req.tenantId
        });
        results.push({
          patientId: patient.patientId,
          riskScore: prediction.riskScore,
          riskLevel: prediction.riskLevel,
          label: prediction.predictionLabel
        });
      } catch (error) {
        results.push({
          patientId: patient.patientId,
          error: error.message
        });
      }
    }

    // Update prediction count
    const successCount = results.filter(r => !r.error).length;
    await db.query(`
      UPDATE ml_enterprise_tenants SET total_predictions = total_predictions + $1 WHERE id = $2
    `, [successCount, req.tenantId]);

    res.json({
      success: true,
      data: {
        predictions: results,
        summary: {
          total: patients.length,
          successful: successCount,
          failed: patients.length - successCount,
          processingTimeMs: Date.now() - startTime
        }
      }
    });
  } catch (error) {
    console.error('Enterprise batch prediction error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/enterprise/v1/risk-stratify
 * Population risk stratification
 */
router.post('/v1/risk-stratify', checkModelAccess, async (req, res) => {
  try {
    const { predictionType, limit } = req.body;

    if (!predictionType) {
      return res.status(400).json({ success: false, error: 'predictionType is required' });
    }

    const stratification = await predictiveEngine.stratifyPopulation(predictionType, {
      limit: Math.min(parseInt(limit) || 500, 5000)
    });

    res.json({
      success: true,
      data: {
        summary: stratification.summary,
        executiveSummary: stratification.executiveSummary,
        highRiskPatients: [...stratification.critical, ...stratification.high].slice(0, 100)
      }
    });
  } catch (error) {
    console.error('Enterprise stratification error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// =========================================================================
// MODEL INFO
// =========================================================================

/**
 * GET /api/enterprise/v1/models
 * List available models for this tenant
 */
router.get('/v1/models', async (req, res) => {
  try {
    const status = await predictiveEngine.getModelStatus();
    const allowedModels = req.tenant.allowed_models || [];
    
    const models = status.champions
      .filter(m => allowedModels.includes(m.type))
      .map(m => ({
        type: m.type,
        name: m.name,
        version: m.version,
        algorithm: m.algorithm,
        status: m.status
      }));

    res.json({
      success: true,
      data: {
        models,
        tenant: {
          name: req.tenant.name,
          tier: req.tenant.tier,
          allowedModels: req.tenant.allowed_models
        }
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// =========================================================================
// USAGE & BILLING
// =========================================================================

/**
 * GET /api/enterprise/v1/usage
 * Get API usage statistics for the tenant
 */
router.get('/v1/usage', async (req, res) => {
  try {
    const { days } = req.query;
    const lookback = parseInt(days) || 30;

    const [usage, dailyBreakdown] = await Promise.all([
      db.query(`
        SELECT 
          COUNT(*) as total_calls,
          SUM(prediction_count) as total_predictions,
          AVG(response_time_ms) as avg_response_ms,
          MIN(created_at) as first_call,
          MAX(created_at) as last_call
        FROM ml_api_usage_log 
        WHERE tenant_id = $1 AND created_at > NOW() - INTERVAL '${lookback} days'
      `, [req.tenantId]),
      db.query(`
        SELECT 
          DATE(created_at) as date,
          COUNT(*) as calls,
          SUM(prediction_count) as predictions,
          AVG(response_time_ms) as avg_ms
        FROM ml_api_usage_log 
        WHERE tenant_id = $1 AND created_at > NOW() - INTERVAL '${lookback} days'
        GROUP BY DATE(created_at)
        ORDER BY date DESC
      `, [req.tenantId])
    ]);

    const u = usage.rows[0];
    const totalPredictions = parseInt(u.total_predictions) || 0;
    const pricePerPrediction = parseFloat(req.tenant.price_per_prediction) || 0;

    res.json({
      success: true,
      data: {
        summary: {
          totalApiCalls: parseInt(u.total_calls) || 0,
          totalPredictions,
          avgResponseMs: Math.round(parseFloat(u.avg_response_ms) || 0),
          periodDays: lookback,
          estimatedCost: `$${(totalPredictions * pricePerPrediction).toFixed(2)}`
        },
        daily: dailyBreakdown.rows.map(d => ({
          date: d.date,
          calls: parseInt(d.calls),
          predictions: parseInt(d.predictions),
          avgMs: Math.round(parseFloat(d.avg_ms))
        })),
        billing: {
          model: req.tenant.billing_model,
          pricePerPrediction: pricePerPrediction,
          monthlyCap: req.tenant.monthly_prediction_cap
        }
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// =========================================================================
// HEALTH CHECK (no auth required)
// =========================================================================

/**
 * GET /api/enterprise/v1/health
 * Health check for the enterprise API
 */
router.get('/v1/health', (req, res) => {
  // This endpoint bypasses auth middleware since it's before router.use
  res.json({
    success: true,
    service: 'DoctaRx Predictive Intelligence API',
    version: '1.0.0',
    status: predictiveEngine ? 'operational' : 'degraded',
    documentation: 'https://doctarx.com/api/docs'
  });
});

module.exports = router;
