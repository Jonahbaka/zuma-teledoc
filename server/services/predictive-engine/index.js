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
const { assertReviewedModel, validateInputs, fail } = require('./model-validation');

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
    
    // Financial, attendance and clinical scores cannot be averaged into a medical probability.

    return {
      patientId,
      overallRiskScore: null,
      assessmentStatus: 'unassessed',
      requiresClinicalReview: true,
      overallRiskLevel: null,
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

    const model = (await modelRegistry.getModelForInference(predictionType, context.market)).model;
    if (!model) throw new Error(`No model available for ${predictionType}`);

    const approval = assertReviewedModel(model, context.market);
    const features = validateInputs(model, await featureStore.computeVerifiedInputs(patientId, model, context), approval);
    
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
  async generateAlerts() {
    // Legacy alerts had no patient/prediction link or named owner.
    return [];
  }

  /**
   * Get active alerts
   */
  async getActiveAlerts() {
    throw fail('PREDICTIVE_PATIENT_SCOPE_REQUIRED', 'Use the authorized patient-scoped alert reader.');
  }

  /**
   * Acknowledge an alert
   */
  async acknowledgeAlert() {
    throw fail('PREDICTIVE_PATIENT_SCOPE_REQUIRED', 'Use the authorized patient-scoped alert mutation.');
  }

  // =========================================================================
  // MODEL MANAGEMENT
  // =========================================================================

  /**
   * Get status of all models
   */
  async getModelStatus(market) {
    const champions = await modelRegistry.getChampionOverview();
    const drift = await modelRegistry.checkDrift();
    const metrics = inferenceEngine.getMetrics();

    return {
      champions: champions.map(m => ({
        type: m.model_type,
        name: m.model_name,
        version: m.model_version,
        algorithm: m.algorithm,
        status: (() => { try { assertReviewedModel(m, market); return 'reviewed'; } catch { return 'validation_required'; } })(),
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
  async getPredictionStats() {
    throw fail('PREDICTIVE_DATASET_SCOPE_REQUIRED', 'A reviewed market-scoped dataset is required.');
  }

  /**
   * Record actual outcome for prediction validation
   */
  async recordOutcome() {
    throw fail('PREDICTIVE_PATIENT_SCOPE_REQUIRED', 'Use the authorized patient-scoped outcome mutation.');
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
