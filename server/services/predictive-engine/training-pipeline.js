/**
 * Training Pipeline - Model Training & Evaluation Orchestration
 * 
 * Manages the end-to-end ML pipeline: data preparation, training,
 * evaluation, and model promotion. Uses statistical methods in Node.js
 * and can optionally delegate to Python-based training for advanced models.
 */

const db = require('../../db');
const crypto = require('crypto');
const logger = require('../../middleware/logger');
const featureStore = require('./feature-store');
const modelRegistry = require('./model-registry');

class TrainingPipeline {
  constructor() {
    this.isRunning = false;
  }

  // =========================================================================
  // PIPELINE ORCHESTRATION
  // =========================================================================

  /**
   * Run complete training pipeline for a model type
   */
  async runPipeline(modelType, options = {}) {
    if (this.isRunning) {
      throw new Error('Training pipeline is already running');
    }

    this.isRunning = true;
    const pipelineId = crypto.randomUUID();
    const startTime = Date.now();

    try {
      // Log pipeline start
      await db.query(`
        INSERT INTO ml_pipeline_runs (id, pipeline_type, model_type, status, parameters)
        VALUES ($1, 'training', $2, 'running', $3)
      `, [pipelineId, modelType, JSON.stringify(options)]);

      console.log(`🔄 Training pipeline started for ${modelType} (${pipelineId})`);

      // Step 1: Prepare training data
      console.log('  📦 Step 1: Preparing training data...');
      const dataset = await this.prepareTrainingData(modelType, options);

      // Step 2: Split data
      console.log('  ✂️ Step 2: Splitting data...');
      const { train, validation, test } = this.splitData(dataset, {
        trainRatio: 0.7,
        validationRatio: 0.15,
        testRatio: 0.15
      });

      // Step 3: Train model
      console.log(`  🧠 Step 3: Training model (${train.length} samples)...`);
      const modelResult = await this.trainModel(modelType, train, validation, options);

      // Step 4: Evaluate on test set
      console.log('  📊 Step 4: Evaluating on test set...');
      const testMetrics = this.evaluate(modelResult, test);

      // Step 5: Bias assessment
      console.log('  ⚖️ Step 5: Running fairness assessment...');
      const biasReport = this.assessBias(modelResult, test);

      // Step 6: Register model
      console.log('  📝 Step 6: Registering model...');
      const registeredModel = await modelRegistry.registerModel({
        modelName: `${modelType}_trained`,
        modelVersion: this.generateVersion(),
        modelType,
        algorithm: modelResult.algorithm,
        description: `Auto-trained ${modelType} model`,
        modelWeights: modelResult.weights,
        featureNames: featureStore.getModelFeatureNames(modelType),
        featureImportance: modelResult.featureImportance,
        hyperparameters: modelResult.hyperparameters,
        preprocessingConfig: modelResult.preprocessingConfig,
        trainingMetrics: modelResult.metrics,
        validationMetrics: modelResult.validationMetrics,
        testMetrics,
        trainedBy: 'auto_pipeline',
        trainingDataStart: dataset.dateRange?.start,
        trainingDataEnd: dataset.dateRange?.end,
        trainingSamples: train.length
      });

      // Step 7: Compare with champion
      console.log('  🏆 Step 7: Comparing with champion...');
      const champion = await modelRegistry.getChampionModel(modelType);
      const shouldPromote = this.shouldPromote(testMetrics, champion?.test_metrics);

      if (shouldPromote && options.autoPromote !== false) {
        await modelRegistry.promoteToChampion(registeredModel.id);
        console.log(`  🎉 New champion promoted: ${registeredModel.model_name} v${registeredModel.model_version}`);
      } else if (shouldPromote) {
        console.log('  📋 New model outperforms champion - ready for manual promotion');
      }

      const duration = Math.round((Date.now() - startTime) / 1000);

      // Update pipeline status
      await db.query(`
        UPDATE ml_pipeline_runs SET 
          status = 'completed', completed_at = NOW(), duration_seconds = $1,
          model_id = $2,
          metrics = $3
        WHERE id = $4
      `, [duration, registeredModel.id, JSON.stringify({ testMetrics, biasReport, shouldPromote }), pipelineId]);

      console.log(`✅ Training pipeline completed in ${duration}s`);

      return {
        pipelineId,
        model: registeredModel,
        testMetrics,
        biasReport,
        shouldPromote,
        duration
      };
    } catch (error) {
      await db.query(`
        UPDATE ml_pipeline_runs SET status = 'failed', error_message = $1, completed_at = NOW()
        WHERE id = $2
      `, [error.message, pipelineId]);

      logger.error('Training pipeline failed', { modelType, error: error.message });
      throw error;
    } finally {
      this.isRunning = false;
    }
  }

  // =========================================================================
  // DATA PREPARATION
  // =========================================================================

  /**
   * Prepare training dataset from historical data
   */
  async prepareTrainingData(modelType, options = {}) {
    const { lookbackDays = 365, minSamples = 50 } = options;

    const dataPreparers = {
      readmission_risk: () => this.prepareReadmissionData(lookbackDays),
      claims_denial: () => this.prepareClaimsDenialData(lookbackDays),
      no_show: () => this.prepareNoShowData(lookbackDays),
      sepsis_warning: () => this.prepareSepsisData(lookbackDays),
      disease_progression: () => this.prepareProgressionData(lookbackDays),
      cost_forecast: () => this.prepareCostData(lookbackDays),
      quality_measures: () => this.prepareQualityData(lookbackDays)
    };

    const preparer = dataPreparers[modelType];
    if (!preparer) throw new Error(`No data preparer for model type: ${modelType}`);

    const dataset = await preparer();

    if (dataset.samples.length < minSamples) {
      console.warn(`⚠️ Only ${dataset.samples.length} samples for ${modelType} (minimum: ${minSamples})`);
    }

    // Log dataset
    await db.query(`
      INSERT INTO ml_training_datasets (dataset_name, model_type, record_count, feature_count, label_distribution, date_range_start, date_range_end, status)
      VALUES ($1, $2, $3, $4, $5, $6, $7, 'ready')
    `, [
      `${modelType}_${new Date().toISOString().split('T')[0]}`,
      modelType,
      dataset.samples.length,
      dataset.featureCount,
      JSON.stringify(dataset.labelDistribution),
      dataset.dateRange?.start,
      dataset.dateRange?.end
    ]);

    return dataset;
  }

  async prepareReadmissionData(lookbackDays) {
    try {
      const result = await db.query(`
        SELECT 
          e.patient_id,
          e.created_at as encounter_date,
          CASE WHEN EXISTS (
            SELECT 1 FROM clinical_encounters e2 
            WHERE e2.patient_id = e.patient_id 
              AND e2.created_at > e.created_at 
              AND e2.created_at <= e.created_at + INTERVAL '30 days'
              AND e2.id != e.id
          ) THEN 1 ELSE 0 END as readmitted_30d
        FROM clinical_encounters e
        WHERE e.created_at > NOW() - INTERVAL '${lookbackDays} days'
          AND e.status = 'completed'
        ORDER BY e.created_at
      `, []);

      const samples = [];
      for (const row of result.rows) {
        const features = await featureStore.computeFeaturesForModel(row.patient_id, 'readmission_risk');
        samples.push({ features, label: row.readmitted_30d });
      }

      const positives = samples.filter(s => s.label === 1).length;
      return {
        samples,
        featureCount: Object.keys(samples[0]?.features || {}).length,
        labelDistribution: { positive: positives, negative: samples.length - positives },
        dateRange: { start: new Date(Date.now() - lookbackDays * 86400000), end: new Date() }
      };
    } catch (error) {
      return this.emptyDataset('readmission_risk');
    }
  }

  async prepareClaimsDenialData(lookbackDays) {
    try {
      const result = await db.query(`
        SELECT patient_id, status, created_at
        FROM claims
        WHERE created_at > NOW() - INTERVAL '${lookbackDays} days'
          AND status IN ('approved', 'denied', 'paid')
      `, []);

      const samples = [];
      for (const row of result.rows) {
        const features = await featureStore.computeFeaturesForModel(row.patient_id, 'claims_denial');
        samples.push({ features, label: row.status === 'denied' ? 1 : 0 });
      }

      const positives = samples.filter(s => s.label === 1).length;
      return {
        samples,
        featureCount: Object.keys(samples[0]?.features || {}).length,
        labelDistribution: { denied: positives, approved: samples.length - positives },
        dateRange: { start: new Date(Date.now() - lookbackDays * 86400000), end: new Date() }
      };
    } catch (error) {
      return this.emptyDataset('claims_denial');
    }
  }

  async prepareNoShowData(lookbackDays) {
    try {
      const result = await db.query(`
        SELECT patient_id, status, created_at
        FROM appointments
        WHERE created_at > NOW() - INTERVAL '${lookbackDays} days'
          AND status IN ('completed', 'no_show', 'missed')
      `, []);

      const samples = [];
      for (const row of result.rows) {
        const features = await featureStore.computeFeaturesForModel(row.patient_id, 'no_show');
        samples.push({ features, label: (row.status === 'no_show' || row.status === 'missed') ? 1 : 0 });
      }

      const positives = samples.filter(s => s.label === 1).length;
      return {
        samples,
        featureCount: Object.keys(samples[0]?.features || {}).length,
        labelDistribution: { no_show: positives, attended: samples.length - positives },
        dateRange: { start: new Date(Date.now() - lookbackDays * 86400000), end: new Date() }
      };
    } catch (error) {
      return this.emptyDataset('no_show');
    }
  }

  async prepareSepsisData(lookbackDays) {
    // Sepsis data is typically labeled from clinical outcomes
    return this.emptyDataset('sepsis_warning');
  }

  async prepareProgressionData(lookbackDays) {
    return this.emptyDataset('disease_progression');
  }

  async prepareCostData(lookbackDays) {
    try {
      const result = await db.query(`
        SELECT 
          patient_id,
          SUM(billed_amount) as total_cost,
          created_at
        FROM claims
        WHERE created_at > NOW() - INTERVAL '${lookbackDays} days'
        GROUP BY patient_id, created_at
      `, []);

      const samples = [];
      const medianCost = this.computeMedian(result.rows.map(r => parseFloat(r.total_cost)));

      for (const row of result.rows) {
        const features = await featureStore.computeFeaturesForModel(row.patient_id, 'cost_forecast');
        samples.push({ features, label: parseFloat(row.total_cost) > medianCost ? 1 : 0 });
      }

      const positives = samples.filter(s => s.label === 1).length;
      return {
        samples,
        featureCount: Object.keys(samples[0]?.features || {}).length,
        labelDistribution: { high_cost: positives, low_cost: samples.length - positives },
        dateRange: { start: new Date(Date.now() - lookbackDays * 86400000), end: new Date() }
      };
    } catch (error) {
      return this.emptyDataset('cost_forecast');
    }
  }

  async prepareQualityData(lookbackDays) {
    return this.emptyDataset('quality_measures');
  }

  emptyDataset(modelType) {
    return {
      samples: [],
      featureCount: featureStore.getModelFeatureNames(modelType).length,
      labelDistribution: { positive: 0, negative: 0 },
      dateRange: null
    };
  }

  // =========================================================================
  // MODEL TRAINING (Statistical / In-Process)
  // =========================================================================

  /**
   * Train a logistic regression model in pure Node.js
   * For production, this would be extended to call Python/ONNX models
   */
  async trainModel(modelType, trainData, validationData, options = {}) {
    const { learningRate = 0.01, epochs = 100, regularization = 0.001 } = options;

    if (trainData.length === 0) {
      console.warn('  ⚠️ No training data - using default weights');
      return this.defaultModelResult(modelType);
    }

    const featureNames = featureStore.getModelFeatureNames(modelType);
    const numFeatures = featureNames.length;

    // Initialize weights
    const weights = {};
    weights.intercept = 0;
    for (const name of featureNames) {
      weights[name] = (Math.random() - 0.5) * 0.1; // Small random init
    }

    // Stochastic Gradient Descent
    for (let epoch = 0; epoch < epochs; epoch++) {
      // Shuffle training data
      const shuffled = [...trainData].sort(() => Math.random() - 0.5);
      let totalLoss = 0;

      for (const sample of shuffled) {
        // Forward pass
        let z = weights.intercept;
        for (const name of featureNames) {
          z += (sample.features[name] || 0) * (weights[name] || 0);
        }
        const predicted = 1 / (1 + Math.exp(-z)); // Sigmoid
        
        // Loss
        const error = predicted - sample.label;
        totalLoss += Math.abs(error);

        // Backward pass (gradient descent)
        weights.intercept -= learningRate * error;
        for (const name of featureNames) {
          const gradient = error * (sample.features[name] || 0) + regularization * (weights[name] || 0);
          weights[name] -= learningRate * gradient;
        }
      }

      // Early stopping check
      if (epoch % 10 === 0 && epoch > 0) {
        const valMetrics = this.evaluate({ weights, algorithm: 'logistic_regression', featureNames }, validationData);
        if (valMetrics.auc_roc > 0.95) break; // Overfitting guard
      }
    }

    // Compute feature importance (absolute weight values)
    const featureImportance = {};
    let totalAbsWeight = 0;
    for (const name of featureNames) {
      totalAbsWeight += Math.abs(weights[name] || 0);
    }
    for (const name of featureNames) {
      featureImportance[name] = totalAbsWeight > 0 ? Math.abs(weights[name] || 0) / totalAbsWeight : 0;
    }

    // Training metrics
    const trainMetrics = this.evaluate({ weights, algorithm: 'logistic_regression', featureNames }, trainData);
    const validationMetrics = this.evaluate({ weights, algorithm: 'logistic_regression', featureNames }, validationData);

    return {
      algorithm: 'logistic_regression',
      weights,
      featureImportance,
      hyperparameters: { learningRate, epochs, regularization },
      preprocessingConfig: { normalization: 'min_max' },
      metrics: trainMetrics,
      validationMetrics,
      featureNames
    };
  }

  defaultModelResult(modelType) {
    const featureNames = featureStore.getModelFeatureNames(modelType);
    const weights = { intercept: 0 };
    const featureImportance = {};
    
    for (const name of featureNames) {
      weights[name] = 0.1;
      featureImportance[name] = 1 / featureNames.length;
    }

    return {
      algorithm: 'logistic_regression',
      weights,
      featureImportance,
      hyperparameters: { method: 'default' },
      preprocessingConfig: {},
      metrics: { accuracy: 0.5, auc_roc: 0.5 },
      validationMetrics: { accuracy: 0.5, auc_roc: 0.5 },
      featureNames
    };
  }

  // =========================================================================
  // EVALUATION
  // =========================================================================

  evaluate(model, testData) {
    if (!testData.length) {
      return { accuracy: 0, precision: 0, recall: 0, f1: 0, auc_roc: 0.5 };
    }

    let tp = 0, fp = 0, tn = 0, fn = 0;
    const scores = [];

    for (const sample of testData) {
      // Score
      let z = model.weights.intercept || 0;
      for (const name of (model.featureNames || [])) {
        z += (sample.features[name] || 0) * (model.weights[name] || 0);
      }
      const predicted = 1 / (1 + Math.exp(-z));
      const predictedLabel = predicted >= 0.5 ? 1 : 0;

      scores.push({ predicted, actual: sample.label });

      if (predictedLabel === 1 && sample.label === 1) tp++;
      else if (predictedLabel === 1 && sample.label === 0) fp++;
      else if (predictedLabel === 0 && sample.label === 0) tn++;
      else fn++;
    }

    const accuracy = testData.length > 0 ? (tp + tn) / testData.length : 0;
    const precision = (tp + fp) > 0 ? tp / (tp + fp) : 0;
    const recall = (tp + fn) > 0 ? tp / (tp + fn) : 0;
    const f1 = (precision + recall) > 0 ? 2 * (precision * recall) / (precision + recall) : 0;
    const aucRoc = this.computeAUCROC(scores);

    return {
      accuracy: Math.round(accuracy * 10000) / 10000,
      precision: Math.round(precision * 10000) / 10000,
      recall: Math.round(recall * 10000) / 10000,
      f1: Math.round(f1 * 10000) / 10000,
      auc_roc: Math.round(aucRoc * 10000) / 10000,
      confusion_matrix: { tp, fp, tn, fn },
      sample_count: testData.length
    };
  }

  computeAUCROC(scores) {
    if (scores.length === 0) return 0.5;

    // Sort by predicted score descending
    const sorted = [...scores].sort((a, b) => b.predicted - a.predicted);
    
    const totalPositives = sorted.filter(s => s.actual === 1).length;
    const totalNegatives = sorted.filter(s => s.actual === 0).length;

    if (totalPositives === 0 || totalNegatives === 0) return 0.5;

    let tpRate = 0, fpRate = 0;
    let prevTPR = 0, prevFPR = 0;
    let auc = 0;
    let tpCount = 0, fpCount = 0;

    for (const score of sorted) {
      if (score.actual === 1) tpCount++;
      else fpCount++;

      tpRate = tpCount / totalPositives;
      fpRate = fpCount / totalNegatives;

      // Trapezoidal rule
      auc += (fpRate - prevFPR) * (tpRate + prevTPR) / 2;

      prevTPR = tpRate;
      prevFPR = fpRate;
    }

    return Math.max(0, Math.min(1, auc));
  }

  // =========================================================================
  // BIAS ASSESSMENT
  // =========================================================================

  assessBias(modelResult, testData) {
    // Simplified fairness assessment
    const groups = { male: [], female: [], elderly: [], non_elderly: [] };

    for (const sample of testData) {
      if (sample.features.gender_male) groups.male.push(sample);
      if (sample.features.gender_female) groups.female.push(sample);
      if (sample.features.is_elderly) groups.elderly.push(sample);
      else groups.non_elderly.push(sample);
    }

    const report = {};
    for (const [groupName, groupData] of Object.entries(groups)) {
      if (groupData.length > 0) {
        const metrics = this.evaluate(modelResult, groupData);
        report[groupName] = {
          sampleSize: groupData.length,
          accuracy: metrics.accuracy,
          precision: metrics.precision,
          recall: metrics.recall
        };
      }
    }

    return report;
  }

  // =========================================================================
  // MODEL COMPARISON
  // =========================================================================

  shouldPromote(newMetrics, championMetrics) {
    if (!championMetrics) return true; // No champion exists

    const champMetrics = typeof championMetrics === 'string' ? JSON.parse(championMetrics) : championMetrics;

    // New model must have higher AUC-ROC (primary metric)
    const aucImprovement = (newMetrics.auc_roc || 0) - (champMetrics.auc_roc || 0);
    
    // And not significantly worse on other metrics
    const f1Regression = (champMetrics.f1 || 0) - (newMetrics.f1 || 0);

    return aucImprovement > 0.01 && f1Regression < 0.05;
  }

  // =========================================================================
  // UTILITIES
  // =========================================================================

  splitData(dataset, ratios) {
    const shuffled = [...dataset.samples].sort(() => Math.random() - 0.5);
    const trainEnd = Math.floor(shuffled.length * ratios.trainRatio);
    const valEnd = trainEnd + Math.floor(shuffled.length * ratios.validationRatio);

    return {
      train: shuffled.slice(0, trainEnd),
      validation: shuffled.slice(trainEnd, valEnd),
      test: shuffled.slice(valEnd)
    };
  }

  generateVersion() {
    const date = new Date().toISOString().split('T')[0].replace(/-/g, '');
    const hash = crypto.randomBytes(3).toString('hex');
    return `${date}_${hash}`;
  }

  computeMedian(values) {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  }

  // =========================================================================
  // SCHEDULED TASKS
  // =========================================================================

  /**
   * Run all model training pipelines (scheduled nightly)
   */
  async runAllPipelines(options = {}) {
    const modelTypes = ['readmission_risk', 'claims_denial', 'no_show', 'cost_forecast'];
    const results = {};

    for (const modelType of modelTypes) {
      try {
        results[modelType] = await this.runPipeline(modelType, { ...options, autoPromote: false });
      } catch (error) {
        results[modelType] = { error: error.message };
      }
    }

    return results;
  }
}

module.exports = new TrainingPipeline();
