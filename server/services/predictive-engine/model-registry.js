/**
 * Model Registry - ML Model Version Control & Lifecycle Management
 * 
 * Manages model versioning, A/B testing, champion/challenger patterns,
 * and deployment lifecycle for all predictive models.
 */

const db = require('../../db');
const crypto = require('crypto');
const logger = require('../../middleware/logger');
const { assertReviewedModel, reviewedMarkets, fail } = require('./model-validation');

class ModelRegistry {
  constructor() {
    this.modelCache = new Map(); // model_type -> champion model
    this.initialized = false;
  }

  /**
   * Initialize the registry and load champion models into cache
   */
  async initialize() {
    if (this.initialized) return;
    
    try {
      const champions = await db.query(`
        SELECT * FROM ml_models WHERE is_champion = true AND status = 'production'
      `);
      
      for (const model of champions.rows) {
        this.modelCache.set(model.model_type, model);
      }
      
      this.initialized = true;
      console.log(`🧠 Model Registry initialized: ${champions.rows.length} champion models loaded`);
    } catch (error) {
      console.error('Model Registry initialization error:', error.message);
    }
  }

  // =========================================================================
  // MODEL REGISTRATION
  // =========================================================================

  /**
   * Register a new model version
   */
  async registerModel(modelConfig) {
    const {
      modelName,
      modelVersion,
      modelType,
      algorithm,
      description,
      modelWeights,
      featureNames,
      featureImportance,
      hyperparameters,
      preprocessingConfig,
      trainingMetrics,
      validationMetrics,
      testMetrics,
      trainedBy,
      trainingDataStart,
      trainingDataEnd,
      trainingSamples
    } = modelConfig;

    try {
      const result = await db.query(`
        INSERT INTO ml_models (
          model_name, model_version, model_type, algorithm, description,
          model_weights, feature_names, feature_importance, hyperparameters, preprocessing_config,
          training_metrics, validation_metrics, test_metrics,
          status, trained_by, training_data_start, training_data_end, training_samples
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
        RETURNING *
      `, [
        modelName, modelVersion, modelType, algorithm, description,
        JSON.stringify(modelWeights), JSON.stringify(featureNames),
        JSON.stringify(featureImportance), JSON.stringify(hyperparameters),
        JSON.stringify(preprocessingConfig),
        JSON.stringify(trainingMetrics), JSON.stringify(validationMetrics),
        JSON.stringify(testMetrics),
        'staging', trainedBy || 'system',
        trainingDataStart, trainingDataEnd, trainingSamples
      ]);

      console.log(`📝 Model registered: ${modelName} v${modelVersion} (${modelType})`);
      return result.rows[0];
    } catch (error) {
      if (error.code === '23505') {
        throw new Error(`Model ${modelName} v${modelVersion} already exists`);
      }
      throw error;
    }
  }

  /**
   * Promote a model to production (champion)
   */
  async promoteToChampion(modelId) {
    const client = await db.getClient();
    
    try {
      await client.query('BEGIN');

      // Get the model to promote
      const model = await client.query('SELECT * FROM ml_models WHERE id = $1', [modelId]);
      if (!model.rows[0]) throw new Error('Model not found');
      
      if (!reviewedMarkets(model.rows[0]).length) throw fail('PREDICTIVE_MODEL_UNVALIDATED', 'Independent model review is required before promotion.');
      const modelType = model.rows[0].model_type;

      // Demote current champion
      await client.query(`
        UPDATE ml_models SET is_champion = false, status = 'deprecated', updated_at = NOW()
        WHERE model_type = $1 AND is_champion = true AND id != $2
      `, [modelType, modelId]);

      // Promote new champion
      await client.query(`
        UPDATE ml_models SET is_champion = true, status = 'production', champion_since = NOW(), updated_at = NOW()
        WHERE id = $1
      `, [modelId]);

      await client.query('COMMIT');

      // Update cache
      const updated = await db.query('SELECT * FROM ml_models WHERE id = $1', [modelId]);
      this.modelCache.set(modelType, updated.rows[0]);

      console.log(`🏆 Model promoted to champion: ${model.rows[0].model_name} v${model.rows[0].model_version}`);
      return updated.rows[0];
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Set up A/B test between champion and challenger
   */
  async setupABTest(challengerModelId, trafficPercentage = 10) {
    const testId = `ab_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    
    await db.query(`
      UPDATE ml_models SET status = 'shadow', traffic_percentage = $1, ab_test_id = $2, updated_at = NOW()
      WHERE id = $3
    `, [trafficPercentage, testId, challengerModelId]);

    console.log(`🧪 A/B test started: ${testId} (${trafficPercentage}% traffic to challenger)`);
    return { testId, trafficPercentage };
  }

  // =========================================================================
  // MODEL RETRIEVAL
  // =========================================================================

  /**
   * Get the champion model for a prediction type
   */
  async getChampionModel(modelType) {
    // Re-read current status: revoking/deprecating a model must take effect
    // immediately, including in other serving processes.

    const result = await db.query(`
      SELECT * FROM ml_models 
      WHERE model_type = $1 AND is_champion = true AND status = 'production'
      LIMIT 1
    `, [modelType]);

    if (result.rows[0]) {
      this.modelCache.set(modelType, result.rows[0]);
      return result.rows[0];
    }

    return null;
  }

  /**
   * Get model for inference (handles A/B routing)
   */
  async getModelForInference(modelType, market) {
    // Shadow models must never produce a clinical response through random routing.
    const champion = await this.getChampionModel(modelType);
    assertReviewedModel(champion, market);
    return { model: champion, isChallenger: false };
  }

  /**
   * Get all models for a type
   */
  async getModelsByType(modelType) {
    const result = await db.query(`
      SELECT id, model_name, model_version, model_type, algorithm, status, is_champion,
        training_metrics, validation_metrics, test_metrics, champion_since, created_at
      FROM ml_models 
      WHERE model_type = $1
      ORDER BY created_at DESC
    `, [modelType]);

    return result.rows;
  }

  /**
   * Get all champion models overview
   */
  async getChampionOverview() {
    const result = await db.query(`
      SELECT m.*, 
        (SELECT COUNT(*) FROM ml_predictions p WHERE p.model_id = m.id AND p.created_at > NOW() - INTERVAL '24 hours') as predictions_24h,
        (SELECT AVG(p.inference_time_ms) FROM ml_predictions p WHERE p.model_id = m.id AND p.created_at > NOW() - INTERVAL '24 hours') as avg_inference_ms_24h
      FROM ml_models m
      WHERE m.is_champion = true
      ORDER BY m.model_type
    `);

    return result.rows;
  }

  // =========================================================================
  // MODEL PERFORMANCE TRACKING
  // =========================================================================

  /**
   * Record model performance metrics
   */
  async recordPerformance(modelId, metrics) {
    const {
      sampleCount, accuracy, precision, recall, f1, aucRoc, aucPr,
      brierScore, calibrationSlope, demographicParity, equalizedOdds,
      featureDriftScore, predictionDriftScore
    } = metrics;

    const driftAlert = (featureDriftScore > 0.2) || (predictionDriftScore > 0.15);

    const result = await db.query(`
      INSERT INTO ml_model_performance (
        model_id, model_type, evaluation_date, sample_count,
        accuracy, precision_score, recall_score, f1_score, auc_roc, auc_pr,
        brier_score, calibration_slope,
        demographic_parity, equalized_odds,
        feature_drift_score, prediction_drift_score, drift_alert
      )
      SELECT $1, model_type, CURRENT_DATE, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15
      FROM ml_models WHERE id = $1
      ON CONFLICT (model_id, evaluation_date) DO UPDATE SET
        sample_count = EXCLUDED.sample_count,
        accuracy = EXCLUDED.accuracy,
        precision_score = EXCLUDED.precision_score,
        recall_score = EXCLUDED.recall_score,
        f1_score = EXCLUDED.f1_score,
        auc_roc = EXCLUDED.auc_roc,
        drift_alert = EXCLUDED.drift_alert
      RETURNING *
    `, [
      modelId, sampleCount, accuracy, precision, recall, f1, aucRoc, aucPr,
      brierScore, calibrationSlope,
      JSON.stringify(demographicParity || {}),
      JSON.stringify(equalizedOdds || {}),
      featureDriftScore || 0, predictionDriftScore || 0, driftAlert
    ]);

    if (driftAlert) {
      console.warn(`⚠️ DRIFT ALERT for model ${modelId}: feature=${featureDriftScore}, prediction=${predictionDriftScore}`);
    }

    return result.rows[0];
  }

  /**
   * Get performance history for a model
   */
  async getPerformanceHistory(modelId, days = 30) {
    const result = await db.query(`
      SELECT * FROM ml_model_performance 
      WHERE model_id = $1 AND evaluation_date > CURRENT_DATE - $2
      ORDER BY evaluation_date DESC
    `, [modelId, days]);

    return result.rows;
  }

  /**
   * Check for model drift across all production models
   */
  async checkDrift() {
    const result = await db.query(`
      SELECT m.model_name, m.model_type, mp.feature_drift_score, mp.prediction_drift_score, mp.drift_alert
      FROM ml_model_performance mp
      JOIN ml_models m ON mp.model_id = m.id
      WHERE m.is_champion = true 
        AND mp.evaluation_date = CURRENT_DATE
        AND mp.drift_alert = true
    `);

    return result.rows;
  }

  // =========================================================================
  // DEFAULT MODEL REGISTRATION
  // =========================================================================

  /**
   * Register built-in statistical models as initial champions
   * These serve as baselines until ML models are trained
   */
  async registerDefaultModels() {
    // Historical defaults remain in storage for audit, but are rejected by the
    // reviewed artifact gate. Startup must not invent evaluation metrics or
    // promote heuristic models to production.
    return 0;
  }
}

module.exports = new ModelRegistry();
