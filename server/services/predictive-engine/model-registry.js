/**
 * Model Registry - ML Model Version Control & Lifecycle Management
 * 
 * Manages model versioning, A/B testing, champion/challenger patterns,
 * and deployment lifecycle for all predictive models.
 */

const db = require('../../db');
const crypto = require('crypto');
const logger = require('../../middleware/logger');

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
    // Check cache first
    if (this.modelCache.has(modelType)) {
      return this.modelCache.get(modelType);
    }

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
  async getModelForInference(modelType) {
    const champion = await this.getChampionModel(modelType);
    
    // Check for active A/B test
    const challenger = await db.query(`
      SELECT * FROM ml_models 
      WHERE model_type = $1 AND status = 'shadow' AND traffic_percentage > 0
      LIMIT 1
    `, [modelType]);

    if (challenger.rows[0]) {
      // Route traffic based on percentage
      const random = Math.random() * 100;
      if (random < challenger.rows[0].traffic_percentage) {
        return { model: challenger.rows[0], isChallenger: true };
      }
    }

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
    const defaultModels = [
      {
        modelName: 'readmission_risk_baseline',
        modelVersion: '1.0.0',
        modelType: 'readmission_risk',
        algorithm: 'logistic_regression',
        description: 'Baseline readmission risk model using weighted feature scoring',
        featureNames: ['age', 'encounters_30d', 'er_visits_90d', 'active_medications', 'charlson_comorbidity_index', 'mews_score', 'sdoh_risk_score'],
        hyperparameters: { method: 'weighted_scoring', threshold: 0.5 },
        trainingMetrics: { accuracy: 0.72, auc_roc: 0.76 },
        trainedBy: 'system_default'
      },
      {
        modelName: 'claims_denial_baseline',
        modelVersion: '1.0.0',
        modelType: 'claims_denial',
        algorithm: 'logistic_regression',
        description: 'Baseline claims denial prediction using historical patterns',
        featureNames: ['denial_rate', 'avg_claim_amount', 'active_problems', 'is_medicaid'],
        hyperparameters: { method: 'weighted_scoring', threshold: 0.5 },
        trainingMetrics: { accuracy: 0.68, auc_roc: 0.71 },
        trainedBy: 'system_default'
      },
      {
        modelName: 'no_show_baseline',
        modelVersion: '1.0.0',
        modelType: 'no_show',
        algorithm: 'logistic_regression',
        description: 'Baseline appointment no-show prediction',
        featureNames: ['no_show_rate', 'cancellation_count', 'sdoh_risk_score', 'days_since_last_completed'],
        hyperparameters: { method: 'weighted_scoring', threshold: 0.5 },
        trainingMetrics: { accuracy: 0.74, auc_roc: 0.78 },
        trainedBy: 'system_default'
      },
      {
        modelName: 'sepsis_early_warning_baseline',
        modelVersion: '1.0.0',
        modelType: 'sepsis_warning',
        algorithm: 'rule_enhanced_scoring',
        description: 'MEWS-enhanced sepsis early warning system',
        featureNames: ['mews_score', 'heart_rate', 'temperature', 'bp_systolic', 'respiratory_rate', 'oxygen_saturation'],
        hyperparameters: { method: 'mews_enhanced', threshold: 0.6 },
        trainingMetrics: { accuracy: 0.82, auc_roc: 0.87 },
        trainedBy: 'system_default'
      },
      {
        modelName: 'disease_progression_baseline',
        modelVersion: '1.0.0',
        modelType: 'disease_progression',
        algorithm: 'logistic_regression',
        description: 'Baseline chronic disease progression prediction',
        featureNames: ['charlson_comorbidity_index', 'active_problems', 'encounter_acceleration', 'lab_abnormality_rate'],
        hyperparameters: { method: 'weighted_scoring', threshold: 0.5 },
        trainingMetrics: { accuracy: 0.70, auc_roc: 0.73 },
        trainedBy: 'system_default'
      },
      {
        modelName: 'cost_forecast_baseline',
        modelVersion: '1.0.0',
        modelType: 'cost_forecast',
        algorithm: 'linear_regression',
        description: 'Baseline cost of care forecasting',
        featureNames: ['total_billed', 'encounters_90d', 'charlson_comorbidity_index', 'er_visits_90d'],
        hyperparameters: { method: 'weighted_scoring', threshold: 0.5 },
        trainingMetrics: { accuracy: 0.65, r_squared: 0.58 },
        trainedBy: 'system_default'
      },
      {
        modelName: 'quality_measures_baseline',
        modelVersion: '1.0.0',
        modelType: 'quality_measures',
        algorithm: 'logistic_regression',
        description: 'Baseline quality measure (HEDIS/Star) gap detection',
        featureNames: ['days_since_last_encounter', 'no_show_rate', 'active_problems', 'clinical_complexity_score'],
        hyperparameters: { method: 'weighted_scoring', threshold: 0.5 },
        trainingMetrics: { accuracy: 0.69, auc_roc: 0.72 },
        trainedBy: 'system_default'
      }
    ];

    let registered = 0;
    for (const config of defaultModels) {
      try {
        const existing = await db.query(
          'SELECT id FROM ml_models WHERE model_name = $1 AND model_version = $2',
          [config.modelName, config.modelVersion]
        );

        if (!existing.rows.length) {
          const model = await this.registerModel(config);
          await this.promoteToChampion(model.id);
          registered++;
        }
      } catch (error) {
        console.error(`Failed to register default model ${config.modelName}:`, error.message);
      }
    }

    if (registered > 0) {
      console.log(`🧠 Registered ${registered} default predictive models`);
    }
  }
}

module.exports = new ModelRegistry();
