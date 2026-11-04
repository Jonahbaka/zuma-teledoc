/**
 * Predictive Intelligence Engine - Main Orchestrator
 * 
 * DoctaRx AI-First Predictive Data Platform
 * Enterprise healthcare intelligence for hospitals and insurance companies.
 * 
 * Capabilities:
 * - Real-time patient risk scoring (<100ms inference)
 * - 7 predictive models (readmission, claims denial, no-show, sepsis, progression, cost, quality)
 * - Full explainability (SHAP-inspired feature attribution + clinical narratives)
 * - Model versioning, A/B testing, and champion/challenger management
 * - Feature store with 200+ clinical, operational, and financial features
 * - Population-level risk stratification
 * - Enterprise multi-tenant API
 */

const featureStore = require('./feature-store');
const modelRegistry = require('./model-registry');
const inferenceEngine = require('./inference-engine');
const trainingPipeline = require('./training-pipeline');
const explainability = require('./explainability');
const db = require('../../db');

class PredictiveEngine {
  constructor() {
    this.initialized = false;
    this.startTime = null;
  }

  // =========================================================================
  // INITIALIZATION
  // =========================================================================

  /**
   * Initialize the complete predictive engine
   * Call this once during server startup
   */
  async initialize() {
    if (this.initialized) return;
    this.startTime = Date.now();

    try {
      console.log('\n🧠 ═══════════════════════════════════════');
      console.log('   PREDICTIVE INTELLIGENCE ENGINE');
      console.log('   DoctaRx Enterprise AI Platform');
      console.log('═══════════════════════════════════════════');

      // Step 1: Initialize Feature Store
      await featureStore.initialize();

      // Step 2: Initialize Model Registry
      await modelRegistry.initialize();

      // Step 3: Register default baseline models (if first run)
      await modelRegistry.registerDefaultModels();

      const duration = Date.now() - this.startTime;
      this.initialized = true;

      console.log(`✅ Predictive Engine ready in ${duration}ms`);
      console.log('═══════════════════════════════════════════\n');
    } catch (error) {
      console.error('❌ Predictive Engine initialization failed:', error.message);
      // Non-fatal - server continues without predictions
    }
  }

  // =========================================================================
  // PREDICTION API
  // =========================================================================

  /**
   * Get a single prediction for a patient
   * @param {string} patientId - Patient UUID
   * @param {string} predictionType - One of: readmission_risk, claims_denial, no_show, sepsis_warning, disease_progression, cost_forecast, quality_measures
   * @param {Object} context - Optional context (current vitals, encounter data, etc.)
   */
  async predict(patientId, predictionType, context = {}) {
    if (!this.initialized) await this.initialize();
    return inferenceEngine.predict(patientId, predictionType, context);
  }

  /**
   * Get all predictions for a patient (full risk profile)
   */
  async getPatientRiskProfile(patientId, context = {}) {
    if (!this.initialized) await this.initialize();
    
    const predictions = await inferenceEngine.predictAll(patientId, context);
    
    // Compute overall risk score
    const scores = Object.values(predictions).filter(p => p.riskScore !== null && p.riskScore !== undefined);
    const overallRisk = scores.length > 0 
      ? scores.reduce((sum, p) => sum + (p.riskScore || 0), 0) / scores.length 
      : 0;

    return {
      patientId,
      overallRiskScore: Math.round(overallRisk * 10000) / 10000,
      overallRiskLevel: this.computeRiskLevel(overallRisk),
      predictions,
      generatedAt: new Date().toISOString(),
      modelVersions: Object.fromEntries(
        Object.entries(predictions)
          .filter(([, p]) => p.modelVersion)
          .map(([type, p]) => [type, `${p.modelName} v${p.modelVersion}`])
      )
    };
  }

  /**
   * Get population risk stratification
   */
  async stratifyPopulation(predictionType, options = {}) {
    if (!this.initialized) await this.initialize();
    
    const results = await inferenceEngine.stratifyPopulation(predictionType, options);
    
    // Generate executive summary
    results.executiveSummary = explainability.generateExecutiveSummary(predictionType, results);
    
    return results;
  }

  /**
   * Get detailed explanation for a prediction
   */
  async explainPrediction(patientId, predictionType, context = {}) {
    if (!this.initialized) await this.initialize();

    const model = (await modelRegistry.getModelForInference(predictionType)).model;
    if (!model) throw new Error(`No model available for ${predictionType}`);

    const features = await featureStore.computeFeaturesForModel(patientId, predictionType, context);
    
    // Score the model
    const score = inferenceEngine.scoreModel(model, features);
    
    // Full explainability
    const contributions = explainability.computeFeatureContributions(model, features, score);
    const clinicalNarrative = explainability.generateClinicalNarrative(predictionType, score, features, contributions);
    const patientNarrative = explainability.generatePatientNarrative(predictionType, score, contributions);

    return {
      predictionType,
      riskScore: Math.round(score * 10000) / 10000,
      riskLevel: this.computeRiskLevel(score),
      contributions,
      clinicalNarrative,
      patientNarrative,
      features
    };
  }

  // =========================================================================
  // ALERTS
  // =========================================================================

  /**
   * Check for and generate clinical alerts based on predictions
   */
  async generateAlerts(patientId, predictions) {
    const alerts = [];

    for (const [type, prediction] of Object.entries(predictions)) {
      if (!prediction || prediction.error) continue;

      if (prediction.riskLevel === 'critical' || prediction.riskLevel === 'high') {
        const alert = {
          alertType: type === 'sepsis_warning' ? 'clinical' : 
                     type === 'claims_denial' ? 'financial' :
                     type === 'quality_measures' ? 'quality' : 'clinical',
          severity: prediction.riskLevel,
          title: prediction.predictionLabel,
          message: prediction.explanation,
          targetRole: type === 'claims_denial' ? 'billing' :
                      type === 'no_show' ? 'admin' :
                      type === 'cost_forecast' ? 'care_coordinator' : 'provider',
          predictionId: null // Will be set after persistence
        };

        try {
          const result = await db.query(`
            INSERT INTO ml_alerts (alert_type, severity, title, message, target_role, expires_at)
            VALUES ($1, $2, $3, $4, $5, NOW() + INTERVAL '7 days')
            RETURNING id
          `, [alert.alertType, alert.severity, alert.title, alert.message, alert.targetRole]);

          alert.id = result.rows[0].id;
          alerts.push(alert);
        } catch (error) {
          console.error('Alert creation failed:', error.message);
        }
      }
    }

    return alerts;
  }

  /**
   * Get active alerts
   */
  async getActiveAlerts(options = {}) {
    const { role, severity, limit = 50 } = options;
    
    let query = `
      SELECT * FROM ml_alerts 
      WHERE status = 'active' AND (expires_at IS NULL OR expires_at > NOW())
    `;
    const params = [];
    let paramIdx = 1;

    if (role) {
      query += ` AND target_role = $${paramIdx++}`;
      params.push(role);
    }
    if (severity) {
      query += ` AND severity = $${paramIdx++}`;
      params.push(severity);
    }

    query += ` ORDER BY CASE severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END, created_at DESC LIMIT $${paramIdx}`;
    params.push(limit);

    const result = await db.query(query, params);
    return result.rows;
  }

  /**
   * Acknowledge an alert
   */
  async acknowledgeAlert(alertId, userId, action = null) {
    await db.query(`
      UPDATE ml_alerts SET 
        status = $1, acknowledged_by = $2, acknowledged_at = NOW(),
        action_taken = $3, action_taken_at = CASE WHEN $3 IS NOT NULL THEN NOW() ELSE NULL END,
        updated_at = NOW()
      WHERE id = $4
    `, [action ? 'acted_upon' : 'acknowledged', userId, action, alertId]);
  }

  // =========================================================================
  // MODEL MANAGEMENT
  // =========================================================================

  /**
   * Get status of all models
   */
  async getModelStatus() {
    const champions = await modelRegistry.getChampionOverview();
    const drift = await modelRegistry.checkDrift();
    const metrics = inferenceEngine.getMetrics();

    return {
      champions: champions.map(m => ({
        type: m.model_type,
        name: m.model_name,
        version: m.model_version,
        algorithm: m.algorithm,
        status: m.status,
        championSince: m.champion_since,
        predictions24h: parseInt(m.predictions_24h) || 0,
        avgInferenceMs: Math.round(parseFloat(m.avg_inference_ms_24h) || 0)
      })),
      driftAlerts: drift,
      engineMetrics: metrics,
      initialized: this.initialized
    };
  }

  /**
   * Trigger model training
   */
  async trainModel(modelType, options = {}) {
    return trainingPipeline.runPipeline(modelType, options);
  }

  /**
   * Trigger all model training
   */
  async trainAllModels(options = {}) {
    return trainingPipeline.runAllPipelines(options);
  }

  /**
   * Promote a model to champion
   */
  async promoteModel(modelId) {
    return modelRegistry.promoteToChampion(modelId);
  }

  // =========================================================================
  // FEATURE STORE API
  // =========================================================================

  /**
   * Get computed features for a patient
   */
  async getPatientFeatures(patientId) {
    return featureStore.computeRealTimeFeatures(patientId);
  }

  /**
   * Run batch feature computation for all patients
   */
  async batchComputeFeatures(options = {}) {
    return featureStore.batchComputeAllFeatures(options);
  }

  /**
   * Record a feature event (for real-time streaming)
   */
  async recordEvent(patientId, eventType, eventData) {
    return featureStore.recordFeatureEvent(patientId, eventType, eventData);
  }

  // =========================================================================
  // ANALYTICS & REPORTING
  // =========================================================================

  /**
   * Get prediction history for a patient
   */
  async getPredictionHistory(patientId, options = {}) {
    const { predictionType, days = 30, limit = 100 } = options;
    const patientHash = featureStore.hashPatientId(patientId);

    let query = `
      SELECT id, prediction_type, risk_score, risk_level, prediction_label, confidence,
        explanation_text, top_risk_factors, recommended_actions, inference_time_ms, created_at
      FROM ml_predictions 
      WHERE patient_hash = $1 AND created_at > NOW() - INTERVAL '${days} days'
    `;
    const params = [patientHash];

    if (predictionType) {
      query += ` AND prediction_type = $2`;
      params.push(predictionType);
    }

    query += ` ORDER BY created_at DESC LIMIT ${limit}`;

    const result = await db.query(query, params);
    return result.rows;
  }

  /**
   * Get aggregate prediction statistics
   */
  async getPredictionStats(options = {}) {
    const { days = 7 } = options;

    const result = await db.query(`
      SELECT 
        prediction_type,
        COUNT(*) as total_predictions,
        AVG(risk_score) as avg_risk_score,
        COUNT(*) FILTER (WHERE risk_level = 'critical') as critical_count,
        COUNT(*) FILTER (WHERE risk_level = 'high') as high_count,
        COUNT(*) FILTER (WHERE risk_level = 'moderate') as moderate_count,
        COUNT(*) FILTER (WHERE risk_level = 'low') as low_count,
        COUNT(*) FILTER (WHERE risk_level = 'minimal') as minimal_count,
        AVG(inference_time_ms) as avg_inference_ms,
        AVG(CASE WHEN prediction_correct = true THEN 1.0 WHEN prediction_correct = false THEN 0.0 END) as live_accuracy
      FROM ml_predictions
      WHERE created_at > NOW() - INTERVAL '${days} days'
      GROUP BY prediction_type
      ORDER BY prediction_type
    `);

    return result.rows.map(row => ({
      predictionType: row.prediction_type,
      totalPredictions: parseInt(row.total_predictions),
      avgRiskScore: Math.round(parseFloat(row.avg_risk_score) * 100) / 100,
      distribution: {
        critical: parseInt(row.critical_count),
        high: parseInt(row.high_count),
        moderate: parseInt(row.moderate_count),
        low: parseInt(row.low_count),
        minimal: parseInt(row.minimal_count)
      },
      avgInferenceMs: Math.round(parseFloat(row.avg_inference_ms)),
      liveAccuracy: row.live_accuracy ? Math.round(parseFloat(row.live_accuracy) * 100) / 100 : null
    }));
  }

  /**
   * Record actual outcome for prediction validation
   */
  async recordOutcome(predictionId, actualOutcome) {
    const prediction = await db.query('SELECT * FROM ml_predictions WHERE id = $1', [predictionId]);
    
    if (!prediction.rows[0]) throw new Error('Prediction not found');

    const riskScore = parseFloat(prediction.rows[0].risk_score);
    const predicted = riskScore >= 0.5 ? 1 : 0;
    const actual = actualOutcome === 'positive' || actualOutcome === true || actualOutcome === 1 ? 1 : 0;

    await db.query(`
      UPDATE ml_predictions SET 
        actual_outcome = $1, outcome_date = NOW(), prediction_correct = $2
      WHERE id = $3
    `, [String(actualOutcome), predicted === actual, predictionId]);
  }

  // =========================================================================
  // ENTERPRISE API
  // =========================================================================

  /**
   * Create an enterprise tenant
   */
  async createEnterpriseTenant(tenantData) {
    const { name, type, organizationId, tier, allowedModels, billingModel, pricePerPrediction } = tenantData;
    
    const crypto = require('crypto');
    const apiKey = `dxp_${crypto.randomBytes(32).toString('hex')}`;
    const apiKeyHash = crypto.createHash('sha256').update(apiKey).digest('hex');
    const apiKeyPrefix = apiKey.substring(0, 12);

    const result = await db.query(`
      INSERT INTO ml_enterprise_tenants (
        organization_id, name, type, tier, api_key_hash, api_key_prefix,
        allowed_models, billing_model, price_per_prediction, status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'active')
      RETURNING id, name, type, tier, api_key_prefix, status
    `, [
      organizationId, name, type, tier || 'standard',
      apiKeyHash, apiKeyPrefix,
      JSON.stringify(allowedModels || ['readmission_risk', 'claims_denial', 'no_show']),
      billingModel || 'per_prediction',
      pricePerPrediction || 0.10
    ]);

    return {
      ...result.rows[0],
      apiKey // Return API key only on creation (never stored in plain text)
    };
  }

  /**
   * Validate enterprise API key
   */
  async validateApiKey(apiKey) {
    const crypto = require('crypto');
    const apiKeyHash = crypto.createHash('sha256').update(apiKey).digest('hex');
    
    const result = await db.query(`
      SELECT * FROM ml_enterprise_tenants 
      WHERE api_key_hash = $1 AND status = 'active'
    `, [apiKeyHash]);

    if (!result.rows[0]) return null;

    // Update usage
    await db.query(`
      UPDATE ml_enterprise_tenants SET 
        total_api_calls = total_api_calls + 1, last_api_call_at = NOW()
      WHERE id = $1
    `, [result.rows[0].id]);

    return result.rows[0];
  }

  // =========================================================================
  // HEALTH CHECK
  // =========================================================================

  getHealthStatus() {
    return {
      initialized: this.initialized,
      uptime: this.startTime ? Math.round((Date.now() - this.startTime) / 1000) : 0,
      engineMetrics: inferenceEngine.getMetrics(),
      featureStoreInitialized: featureStore.initialized,
      modelRegistryInitialized: modelRegistry.initialized
    };
  }

  // =========================================================================
  // HELPERS
  // =========================================================================

  computeRiskLevel(score) {
    if (score >= 0.85) return 'critical';
    if (score >= 0.65) return 'high';
    if (score >= 0.40) return 'moderate';
    if (score >= 0.20) return 'low';
    return 'minimal';
  }
}

// Singleton
module.exports = new PredictiveEngine();
