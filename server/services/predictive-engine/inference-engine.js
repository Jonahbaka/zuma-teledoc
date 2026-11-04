/**
 * Inference Engine - Real-Time Prediction Serving
 * 
 * Scores patients against predictive models in real-time (<100ms).
 * Supports ensemble predictions, model routing, and full explainability.
 */

const db = require('../../db');
const logger = require('../../middleware/logger');
const featureStore = require('./feature-store');
const modelRegistry = require('./model-registry');

class InferenceEngine {
  constructor() {
    this.predictionCount = 0;
    this.avgInferenceMs = 0;
  }

  // =========================================================================
  // SINGLE PREDICTION
  // =========================================================================

  /**
   * Generate a prediction for a patient
   * @param {string} patientId - Patient ID
   * @param {string} predictionType - Type of prediction (e.g., 'readmission_risk')
   * @param {Object} context - Additional context (vitals, encounter data, etc.)
   * @returns {Object} Prediction result with explanation
   */
  async predict(patientId, predictionType, context = {}) {
    const startTime = Date.now();
    
    try {
      // 1. Get the model to use (handles A/B routing)
      const { model, isChallenger } = await modelRegistry.getModelForInference(predictionType);
      
      if (!model) {
        throw new Error(`No production model available for ${predictionType}`);
      }

      // 2. Compute features for this patient
      const features = await featureStore.computeFeaturesForModel(patientId, predictionType, context);

      // 3. Run model inference
      const rawScore = this.scoreModel(model, features);

      // 4. Compute risk level
      const riskLevel = this.computeRiskLevel(rawScore);

      // 5. Generate explanation
      const explanation = this.explainPrediction(model, features, rawScore);

      // 6. Generate recommendations
      const recommendations = this.generateRecommendations(predictionType, riskLevel, rawScore, features);

      const inferenceTimeMs = Date.now() - startTime;
      
      // 7. Build prediction result
      const prediction = {
        predictionType,
        riskScore: Math.round(rawScore * 10000) / 10000,
        riskLevel,
        confidence: this.computeConfidence(model, features, rawScore),
        predictionLabel: this.generateLabel(predictionType, riskLevel, rawScore),
        
        // Explanation
        explanation: explanation.narrative,
        topRiskFactors: explanation.topFactors,
        featureContributions: explanation.contributions,
        
        // Recommendations
        recommendedActions: recommendations.actions,
        recommendedTests: recommendations.tests,
        carePathway: recommendations.carePathway,
        
        // Metadata
        modelName: model.model_name,
        modelVersion: model.model_version,
        algorithm: model.algorithm,
        isChallenger,
        inferenceTimeMs,
        computedAt: new Date().toISOString()
      };

      // 8. Persist prediction asynchronously
      this.persistPrediction(prediction, patientId, model, context).catch(err =>
        console.error('Prediction persistence error:', err.message)
      );

      // Track metrics
      this.predictionCount++;
      this.avgInferenceMs = ((this.avgInferenceMs * (this.predictionCount - 1)) + inferenceTimeMs) / this.predictionCount;

      return prediction;
    } catch (error) {
      logger.error('Prediction failed', { patientId: '***', predictionType, error: error.message });
      throw error;
    }
  }

  /**
   * Generate predictions for all model types for a patient
   */
  async predictAll(patientId, context = {}) {
    const modelTypes = ['readmission_risk', 'claims_denial', 'no_show', 'sepsis_warning', 'disease_progression', 'cost_forecast', 'quality_measures'];
    
    const results = {};
    const predictions = await Promise.allSettled(
      modelTypes.map(type => this.predict(patientId, type, context))
    );

    modelTypes.forEach((type, index) => {
      if (predictions[index].status === 'fulfilled') {
        results[type] = predictions[index].value;
      } else {
        results[type] = { error: predictions[index].reason?.message, riskScore: null };
      }
    });

    return results;
  }

  // =========================================================================
  // BATCH PREDICTION
  // =========================================================================

  /**
   * Run predictions for multiple patients
   */
  async batchPredict(patientIds, predictionType, context = {}) {
    const results = [];
    const batchSize = 50;

    for (let i = 0; i < patientIds.length; i += batchSize) {
      const batch = patientIds.slice(i, i + batchSize);
      const batchResults = await Promise.allSettled(
        batch.map(id => this.predict(id, predictionType, context))
      );

      batchResults.forEach((result, idx) => {
        results.push({
          patientId: batch[idx],
          prediction: result.status === 'fulfilled' ? result.value : null,
          error: result.status === 'rejected' ? result.reason?.message : null
        });
      });
    }

    return results;
  }

  /**
   * Run population-level risk stratification
   */
  async stratifyPopulation(predictionType, options = {}) {
    const { minRiskScore = 0, limit = 1000 } = options;
    
    try {
      // Get all active patients
      const patients = await db.query(`
        SELECT id FROM users WHERE role = 'patient' AND status = 'active'
        ORDER BY id LIMIT $1
      `, [limit]);

      const predictions = await this.batchPredict(
        patients.rows.map(p => p.id),
        predictionType
      );

      // Stratify by risk level
      const stratification = {
        critical: [],
        high: [],
        moderate: [],
        low: [],
        minimal: [],
        errors: 0,
        total: predictions.length
      };

      for (const result of predictions) {
        if (result.prediction) {
          const level = result.prediction.riskLevel;
          if (stratification[level] && result.prediction.riskScore >= minRiskScore) {
            stratification[level].push({
              patientId: result.patientId,
              riskScore: result.prediction.riskScore,
              topRiskFactors: result.prediction.topRiskFactors?.slice(0, 3)
            });
          }
        } else {
          stratification.errors++;
        }
      }

      // Sort each tier by risk score descending
      for (const level of ['critical', 'high', 'moderate', 'low', 'minimal']) {
        stratification[level].sort((a, b) => b.riskScore - a.riskScore);
      }

      stratification.summary = {
        critical: stratification.critical.length,
        high: stratification.high.length,
        moderate: stratification.moderate.length,
        low: stratification.low.length,
        minimal: stratification.minimal.length
      };

      return stratification;
    } catch (error) {
      logger.error('Population stratification failed', { error: error.message });
      throw error;
    }
  }

  // =========================================================================
  // MODEL SCORING (Core ML Logic)
  // =========================================================================

  /**
   * Score a patient against a model
   * Uses weighted feature scoring for baseline models,
   * extensible to ONNX Runtime for trained ML models
   */
  scoreModel(model, features) {
    const algorithm = model.algorithm;
    const hyperparams = model.hyperparameters || {};
    const featureNames = model.feature_names || [];
    const weights = model.model_weights || {};

    switch (algorithm) {
      case 'logistic_regression':
        return this.logisticRegressionScore(features, featureNames, weights, hyperparams);
      case 'rule_enhanced_scoring':
        return this.ruleEnhancedScore(features, featureNames, weights, hyperparams);
      case 'linear_regression':
        return this.linearRegressionScore(features, featureNames, weights, hyperparams);
      case 'ensemble':
        return this.ensembleScore(features, featureNames, weights, hyperparams);
      default:
        return this.weightedScoringFallback(features, featureNames, model.model_type);
    }
  }

  logisticRegressionScore(features, featureNames, weights, hyperparams) {
    let z = weights.intercept || 0;
    
    for (const name of featureNames) {
      const value = features[name] || 0;
      const weight = weights[name] || this.getDefaultWeight(name);
      z += value * weight;
    }

    // Sigmoid function
    return 1 / (1 + Math.exp(-z));
  }

  ruleEnhancedScore(features, featureNames, weights, hyperparams) {
    // Combines rule-based scoring (like MEWS) with statistical scoring
    let score = 0;
    let maxScore = 0;

    // MEWS-based component (40% weight for sepsis)
    const mewsScore = features.mews_score || 0;
    const mewsComponent = Math.min(mewsScore / 12, 1); // Normalize to 0-1
    score += mewsComponent * 0.4;
    maxScore += 0.4;

    // Vital abnormality component (30% weight)
    const vitalFlags = (features.tachycardia_flag || 0) + (features.fever_flag || 0) + 
      (features.hypoxia_flag || 0) + (features.tachypnea_flag || 0) + (features.hypotension_flag || 0);
    score += Math.min(vitalFlags / 5, 1) * 0.3;
    maxScore += 0.3;

    // Trend component (20% weight)
    const trendScore = (
      Math.abs(features.bp_systolic_trend || 0) / 30 +
      Math.abs(features.heart_rate_trend || 0) / 20 +
      Math.abs(features.temp_trend || 0) / 2 +
      Math.abs(features.o2_sat_trend || 0) / 5
    ) / 4;
    score += Math.min(trendScore, 1) * 0.2;
    maxScore += 0.2;

    // Comorbidity component (10% weight)
    const comorbidityScore = Math.min((features.charlson_comorbidity_index || 0) / 8, 1);
    score += comorbidityScore * 0.1;
    maxScore += 0.1;

    return Math.min(score / maxScore, 1);
  }

  linearRegressionScore(features, featureNames, weights, hyperparams) {
    let prediction = weights.intercept || 0;
    
    for (const name of featureNames) {
      const value = features[name] || 0;
      const weight = weights[name] || this.getDefaultWeight(name);
      prediction += value * weight;
    }

    // Normalize to 0-1 range
    return Math.max(0, Math.min(1, prediction));
  }

  ensembleScore(features, featureNames, weights, hyperparams) {
    const subModels = weights.subModels || [];
    const subWeights = weights.subWeights || [];
    
    if (!subModels.length) {
      return this.weightedScoringFallback(features, featureNames);
    }

    let totalScore = 0;
    let totalWeight = 0;

    for (let i = 0; i < subModels.length; i++) {
      const subScore = this.scoreModel(subModels[i], features);
      const weight = subWeights[i] || 1;
      totalScore += subScore * weight;
      totalWeight += weight;
    }

    return totalWeight > 0 ? totalScore / totalWeight : 0.5;
  }

  /**
   * Fallback scoring using clinically-informed feature weights
   */
  weightedScoringFallback(features, featureNames, modelType) {
    const weights = this.getClinicalWeights(modelType);
    let score = 0;
    let totalWeight = 0;

    for (const name of featureNames) {
      if (weights[name] && features[name] !== undefined) {
        const normalizedValue = this.normalizeFeature(name, features[name]);
        score += normalizedValue * weights[name];
        totalWeight += Math.abs(weights[name]);
      }
    }

    return totalWeight > 0 ? Math.max(0, Math.min(1, score / totalWeight)) : 0.5;
  }

  getClinicalWeights(modelType) {
    const weightMaps = {
      readmission_risk: {
        age: 0.08, is_elderly: 0.12, encounters_30d: 0.15, er_visits_90d: 0.18,
        encounter_acceleration: 0.10, active_medications: 0.08, polypharmacy_flag: 0.10,
        charlson_comorbidity_index: 0.15, mews_score: 0.10, clinical_complexity_score: 0.12,
        sdoh_risk_score: 0.10, no_show_rate: 0.06, denial_rate: 0.04,
        days_since_last_encounter: -0.05 // More recent = higher risk
      },
      claims_denial: {
        denial_rate: 0.25, avg_claim_amount: 0.15, claims_90d: 0.10,
        active_problems: 0.08, unique_diagnoses: 0.10, is_medicaid: 0.08,
        is_uninsured: 0.05, encounters_90d: 0.05, er_visits_90d: 0.06,
        total_billed: 0.04, payment_ratio: -0.10
      },
      no_show: {
        no_show_rate: 0.30, cancellation_count: 0.10, no_show_count: 0.15,
        days_since_last_completed: 0.10, sdoh_risk_score: 0.10,
        appointments_90d: -0.05, has_phone: -0.08, account_age_days: -0.03,
        is_medicaid: 0.05
      },
      disease_progression: {
        charlson_comorbidity_index: 0.20, active_problems: 0.12, severe_problems: 0.15,
        encounter_acceleration: 0.12, lab_abnormality_rate: 0.10,
        polypharmacy_flag: 0.08, mews_score: 0.08, sdoh_risk_score: 0.06,
        no_show_rate: 0.05, age: 0.04
      },
      cost_forecast: {
        total_billed: 0.20, encounters_90d: 0.15, er_visits_90d: 0.18,
        charlson_comorbidity_index: 0.12, polypharmacy_flag: 0.08,
        clinical_complexity_score: 0.10, is_elderly: 0.06,
        encounter_acceleration: 0.08, sdoh_risk_score: 0.03
      },
      quality_measures: {
        days_since_last_encounter: 0.20, no_show_rate: 0.18,
        active_problems: 0.10, clinical_complexity_score: 0.12,
        encounters_90d: -0.08, completed_appointments: -0.10,
        denial_rate: 0.08, sdoh_risk_score: 0.10, is_elderly: 0.06
      }
    };

    return weightMaps[modelType] || weightMaps.readmission_risk;
  }

  normalizeFeature(name, value) {
    const ranges = {
      age: { min: 0, max: 100 },
      encounters_30d: { min: 0, max: 10 },
      encounters_90d: { min: 0, max: 20 },
      er_visits_90d: { min: 0, max: 5 },
      active_medications: { min: 0, max: 20 },
      charlson_comorbidity_index: { min: 0, max: 10 },
      mews_score: { min: 0, max: 12 },
      no_show_rate: { min: 0, max: 1 },
      denial_rate: { min: 0, max: 1 },
      sdoh_risk_score: { min: 0, max: 1 },
      clinical_complexity_score: { min: 0, max: 1 },
      days_since_last_encounter: { min: 0, max: 365 },
      total_billed: { min: 0, max: 100000 },
      avg_claim_amount: { min: 0, max: 5000 },
      encounter_acceleration: { min: -5, max: 10 },
      days_since_last_completed: { min: 0, max: 365 },
      account_age_days: { min: 0, max: 1095 },
      cancellation_count: { min: 0, max: 10 },
      no_show_count: { min: 0, max: 10 },
      lab_abnormality_rate: { min: 0, max: 1 }
    };

    const range = ranges[name];
    if (!range) return Math.min(Math.max(value, 0), 1); // Already normalized flags

    return Math.min(Math.max((value - range.min) / (range.max - range.min), 0), 1);
  }

  // =========================================================================
  // RISK LEVEL & LABELS
  // =========================================================================

  computeRiskLevel(score) {
    if (score >= 0.85) return 'critical';
    if (score >= 0.65) return 'high';
    if (score >= 0.40) return 'moderate';
    if (score >= 0.20) return 'low';
    return 'minimal';
  }

  computeConfidence(model, features, score) {
    // Confidence decreases when features are mostly defaults/zeros
    const featureNames = model.feature_names || [];
    let nonZeroCount = 0;
    
    for (const name of featureNames) {
      if (features[name] && features[name] !== 0) nonZeroCount++;
    }

    const dataCompleteness = featureNames.length > 0 ? nonZeroCount / featureNames.length : 0;
    
    // Confidence is higher when more data is available and score is more extreme
    const extremity = Math.abs(score - 0.5) * 2; // 0 at 0.5, 1 at 0 or 1
    
    return Math.round(Math.min(dataCompleteness * 0.6 + extremity * 0.4, 0.99) * 10000) / 10000;
  }

  generateLabel(predictionType, riskLevel, score) {
    const labels = {
      readmission_risk: {
        critical: `Critical readmission risk (${Math.round(score * 100)}%) - Immediate intervention required`,
        high: `High readmission risk (${Math.round(score * 100)}%) - Care coordination recommended`,
        moderate: `Moderate readmission risk (${Math.round(score * 100)}%) - Monitor closely`,
        low: `Low readmission risk (${Math.round(score * 100)}%) - Standard follow-up`,
        minimal: `Minimal readmission risk (${Math.round(score * 100)}%)`
      },
      claims_denial: {
        critical: `Very high denial probability (${Math.round(score * 100)}%) - Review documentation immediately`,
        high: `High denial probability (${Math.round(score * 100)}%) - Additional documentation needed`,
        moderate: `Moderate denial risk (${Math.round(score * 100)}%) - Review before submission`,
        low: `Low denial risk (${Math.round(score * 100)}%)`,
        minimal: `Minimal denial risk (${Math.round(score * 100)}%) - Clear for submission`
      },
      no_show: {
        critical: `Very likely no-show (${Math.round(score * 100)}%) - Proactive outreach required`,
        high: `High no-show risk (${Math.round(score * 100)}%) - Send multiple reminders`,
        moderate: `Moderate no-show risk (${Math.round(score * 100)}%) - Standard reminders`,
        low: `Low no-show risk (${Math.round(score * 100)}%)`,
        minimal: `Reliable patient (${Math.round(score * 100)}% no-show risk)`
      },
      sepsis_warning: {
        critical: `SEPSIS ALERT (${Math.round(score * 100)}%) - Immediate clinical review required`,
        high: `Elevated sepsis risk (${Math.round(score * 100)}%) - Order blood cultures and lactate`,
        moderate: `Moderate sepsis concern (${Math.round(score * 100)}%) - Monitor vitals closely`,
        low: `Low sepsis risk (${Math.round(score * 100)}%)`,
        minimal: `No sepsis concern (${Math.round(score * 100)}%)`
      },
      disease_progression: {
        critical: `Rapid disease progression likely (${Math.round(score * 100)}%) - Specialist referral needed`,
        high: `High progression risk (${Math.round(score * 100)}%) - Intensify treatment plan`,
        moderate: `Moderate progression risk (${Math.round(score * 100)}%) - Adjust care plan`,
        low: `Stable condition (${Math.round(score * 100)}% progression risk)`,
        minimal: `Well-controlled (${Math.round(score * 100)}% progression risk)`
      },
      cost_forecast: {
        critical: `Very high cost trajectory (${Math.round(score * 100)}%) - Case management needed`,
        high: `Above-average cost risk (${Math.round(score * 100)}%) - Review utilization`,
        moderate: `Moderate cost risk (${Math.round(score * 100)}%)`,
        low: `Below-average cost risk (${Math.round(score * 100)}%)`,
        minimal: `Low cost trajectory (${Math.round(score * 100)}%)`
      },
      quality_measures: {
        critical: `Multiple care gaps detected (${Math.round(score * 100)}%) - Immediate outreach`,
        high: `Significant care gaps (${Math.round(score * 100)}%) - Schedule preventive visits`,
        moderate: `Some care gaps (${Math.round(score * 100)}%) - Review at next visit`,
        low: `Minor care gaps (${Math.round(score * 100)}%)`,
        minimal: `Quality metrics on track (${Math.round(score * 100)}% gap risk)`
      }
    };

    return labels[predictionType]?.[riskLevel] || `${riskLevel} risk: ${Math.round(score * 100)}%`;
  }

  // =========================================================================
  // EXPLAINABILITY
  // =========================================================================

  explainPrediction(model, features, score) {
    const featureNames = model.feature_names || [];
    const weights = this.getClinicalWeights(model.model_type);
    
    // Compute feature contributions (simplified SHAP-like)
    const contributions = [];
    
    for (const name of featureNames) {
      const value = features[name] || 0;
      const weight = weights[name] || 0;
      const normalizedValue = this.normalizeFeature(name, value);
      const contribution = normalizedValue * weight;
      
      contributions.push({
        feature: name,
        value: Math.round(value * 100) / 100,
        weight: Math.round(weight * 1000) / 1000,
        contribution: Math.round(contribution * 10000) / 10000,
        direction: contribution > 0 ? 'increases_risk' : contribution < 0 ? 'decreases_risk' : 'neutral',
        humanReadable: this.featureToHumanReadable(name, value)
      });
    }

    // Sort by absolute contribution
    contributions.sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution));

    // Top factors
    const topFactors = contributions.slice(0, 5).map(c => ({
      factor: c.humanReadable,
      impact: Math.round(Math.abs(c.contribution) * 100),
      direction: c.direction
    }));

    // Generate narrative
    const narrative = this.generateNarrative(model.model_type, score, topFactors);

    return { contributions, topFactors, narrative };
  }

  featureToHumanReadable(name, value) {
    const descriptions = {
      age: `Patient age: ${Math.round(value)} years`,
      is_elderly: value ? 'Patient is 65 or older' : 'Patient is under 65',
      encounters_30d: `${Math.round(value)} encounters in last 30 days`,
      encounters_90d: `${Math.round(value)} encounters in last 90 days`,
      er_visits_90d: `${Math.round(value)} ER visits in last 90 days`,
      encounter_acceleration: value > 0 ? 'Visit frequency increasing' : 'Visit frequency stable/decreasing',
      active_medications: `${Math.round(value)} active medications`,
      polypharmacy_flag: value ? 'On 5+ medications (polypharmacy)' : 'Under 5 medications',
      has_high_risk_med: value ? 'Taking high-risk medication' : 'No high-risk medications',
      charlson_comorbidity_index: `Comorbidity index: ${Math.round(value)}`,
      mews_score: `Modified Early Warning Score: ${Math.round(value)}`,
      clinical_complexity_score: `Clinical complexity: ${Math.round(value * 100)}%`,
      sdoh_risk_score: `Social determinant risk: ${Math.round(value * 100)}%`,
      no_show_rate: `No-show rate: ${Math.round(value * 100)}%`,
      denial_rate: `Claims denial rate: ${Math.round(value * 100)}%`,
      days_since_last_encounter: `${Math.round(value)} days since last visit`,
      total_billed: `Total billed: $${Math.round(value).toLocaleString()}`,
      avg_claim_amount: `Average claim: $${Math.round(value).toLocaleString()}`,
      bp_systolic: `Systolic BP: ${Math.round(value)}`,
      heart_rate: `Heart rate: ${Math.round(value)} bpm`,
      temperature: `Temperature: ${value.toFixed(1)}°F`,
      oxygen_saturation: `O2 saturation: ${Math.round(value)}%`,
      respiratory_rate: `Respiratory rate: ${Math.round(value)}/min`,
      active_problems: `${Math.round(value)} active health problems`,
      severe_problems: `${Math.round(value)} severe conditions`,
      is_medicaid: value ? 'Medicaid insurance' : 'Non-Medicaid insurance',
      is_uninsured: value ? 'Uninsured' : 'Has insurance coverage',
      lab_abnormality_rate: `Lab abnormality rate: ${Math.round(value * 100)}%`
    };

    return descriptions[name] || `${name}: ${Math.round(value * 100) / 100}`;
  }

  generateNarrative(modelType, score, topFactors) {
    const percentage = Math.round(score * 100);
    const riskLevel = this.computeRiskLevel(score);
    
    const typeNames = {
      readmission_risk: 'hospital readmission',
      claims_denial: 'claims denial',
      no_show: 'appointment no-show',
      sepsis_warning: 'sepsis',
      disease_progression: 'disease progression',
      cost_forecast: 'high healthcare costs',
      quality_measures: 'care quality gaps'
    };

    const typeName = typeNames[modelType] || modelType;
    
    let narrative = `This patient has a ${percentage}% predicted risk of ${typeName} (${riskLevel} risk). `;
    
    if (topFactors.length > 0) {
      narrative += 'The primary contributing factors are: ';
      const factorDescriptions = topFactors
        .filter(f => f.direction === 'increases_risk')
        .slice(0, 3)
        .map(f => f.factor.toLowerCase());
      
      if (factorDescriptions.length > 0) {
        narrative += factorDescriptions.join(', ') + '. ';
      }

      const protectiveFactors = topFactors.filter(f => f.direction === 'decreases_risk').slice(0, 2);
      if (protectiveFactors.length > 0) {
        narrative += 'Protective factors include: ' + protectiveFactors.map(f => f.factor.toLowerCase()).join(', ') + '.';
      }
    }

    return narrative;
  }

  // =========================================================================
  // RECOMMENDATIONS ENGINE
  // =========================================================================

  generateRecommendations(predictionType, riskLevel, score, features) {
    const recommenders = {
      readmission_risk: () => this.readmissionRecommendations(riskLevel, features),
      claims_denial: () => this.claimsDenialRecommendations(riskLevel, features),
      no_show: () => this.noShowRecommendations(riskLevel, features),
      sepsis_warning: () => this.sepsisRecommendations(riskLevel, features),
      disease_progression: () => this.diseaseProgressionRecommendations(riskLevel, features),
      cost_forecast: () => this.costRecommendations(riskLevel, features),
      quality_measures: () => this.qualityRecommendations(riskLevel, features)
    };

    return (recommenders[predictionType] || (() => ({ actions: [], tests: [], carePathway: null })))();
  }

  readmissionRecommendations(riskLevel, features) {
    const actions = [];
    const tests = [];

    if (riskLevel === 'critical' || riskLevel === 'high') {
      actions.push({ action: 'Schedule follow-up within 48 hours of discharge', priority: 'high', category: 'care_coordination' });
      actions.push({ action: 'Assign care coordinator for transition management', priority: 'high', category: 'care_coordination' });
      actions.push({ action: 'Medication reconciliation review', priority: 'high', category: 'medication' });
      
      if (features.polypharmacy_flag) {
        actions.push({ action: 'Pharmacist medication therapy management consultation', priority: 'high', category: 'medication' });
      }
      if (features.sdoh_risk_score > 0.3) {
        actions.push({ action: 'Social work referral for resource assessment', priority: 'medium', category: 'social' });
      }
    }

    if (riskLevel === 'moderate') {
      actions.push({ action: 'Schedule follow-up within 7 days', priority: 'medium', category: 'care_coordination' });
      actions.push({ action: 'Provide discharge education materials', priority: 'medium', category: 'patient_education' });
    }

    return {
      actions,
      tests: [
        ...(features.mews_score > 3 ? [{ test: 'Complete metabolic panel', priority: 'high' }] : []),
        ...(features.encounters_30d > 2 ? [{ test: 'Review recent diagnostic results', priority: 'medium' }] : [])
      ],
      carePathway: riskLevel === 'critical' ? 'high_risk_readmission_prevention' : null
    };
  }

  claimsDenialRecommendations(riskLevel, features) {
    const actions = [];

    if (riskLevel === 'critical' || riskLevel === 'high') {
      actions.push({ action: 'Review and enhance clinical documentation before submission', priority: 'high', category: 'documentation' });
      actions.push({ action: 'Verify prior authorization status', priority: 'high', category: 'authorization' });
      actions.push({ action: 'Confirm diagnosis codes match medical necessity', priority: 'high', category: 'coding' });
    }

    if (features.denial_rate > 0.3) {
      actions.push({ action: 'Audit recent denials for common patterns', priority: 'medium', category: 'analytics' });
    }

    return { actions, tests: [], carePathway: null };
  }

  noShowRecommendations(riskLevel, features) {
    const actions = [];

    if (riskLevel === 'critical' || riskLevel === 'high') {
      actions.push({ action: 'Send SMS reminder 48h, 24h, and 2h before appointment', priority: 'high', category: 'outreach' });
      actions.push({ action: 'Offer telehealth alternative', priority: 'high', category: 'access' });
      actions.push({ action: 'Personal phone call reminder from staff', priority: 'medium', category: 'outreach' });
    }

    if (features.sdoh_risk_score > 0.3) {
      actions.push({ action: 'Offer transportation assistance', priority: 'medium', category: 'access' });
    }

    return { actions, tests: [], carePathway: null };
  }

  sepsisRecommendations(riskLevel, features) {
    const actions = [];
    const tests = [];

    if (riskLevel === 'critical') {
      actions.push({ action: 'IMMEDIATE: Initiate Sepsis Bundle (SEP-1)', priority: 'critical', category: 'clinical' });
      actions.push({ action: 'Notify attending physician STAT', priority: 'critical', category: 'clinical' });
      tests.push({ test: 'Blood cultures x2', priority: 'critical' });
      tests.push({ test: 'Serum lactate', priority: 'critical' });
      tests.push({ test: 'CBC with differential', priority: 'critical' });
      tests.push({ test: 'Procalcitonin', priority: 'high' });
    } else if (riskLevel === 'high') {
      actions.push({ action: 'Increase vital sign monitoring to every 1 hour', priority: 'high', category: 'monitoring' });
      tests.push({ test: 'Blood cultures if not done in 24h', priority: 'high' });
      tests.push({ test: 'Serum lactate', priority: 'high' });
    }

    return { actions, tests, carePathway: riskLevel === 'critical' ? 'sepsis_bundle_sep1' : null };
  }

  diseaseProgressionRecommendations(riskLevel, features) {
    const actions = [];

    if (riskLevel === 'critical' || riskLevel === 'high') {
      actions.push({ action: 'Specialist referral for disease management', priority: 'high', category: 'referral' });
      actions.push({ action: 'Review and optimize treatment regimen', priority: 'high', category: 'treatment' });
      
      if (features.no_show_rate > 0.2) {
        actions.push({ action: 'Engage patient in adherence counseling', priority: 'medium', category: 'patient_education' });
      }
    }

    return { actions, tests: [], carePathway: riskLevel === 'critical' ? 'chronic_disease_escalation' : null };
  }

  costRecommendations(riskLevel, features) {
    const actions = [];

    if (riskLevel === 'critical' || riskLevel === 'high') {
      actions.push({ action: 'Assign case manager for utilization review', priority: 'high', category: 'care_coordination' });
      actions.push({ action: 'Evaluate for care management program enrollment', priority: 'high', category: 'program' });
      
      if (features.er_visits_90d > 2) {
        actions.push({ action: 'Develop ER diversion plan with patient', priority: 'high', category: 'utilization' });
      }
    }

    return { actions, tests: [], carePathway: null };
  }

  qualityRecommendations(riskLevel, features) {
    const actions = [];

    if (riskLevel === 'critical' || riskLevel === 'high') {
      actions.push({ action: 'Schedule preventive care visit', priority: 'high', category: 'preventive' });
      actions.push({ action: 'Review care gap checklist with patient', priority: 'high', category: 'quality' });
    }

    if (features.days_since_last_encounter > 180) {
      actions.push({ action: 'Outreach for annual wellness visit', priority: 'medium', category: 'preventive' });
    }

    return { actions, tests: [], carePathway: null };
  }

  // =========================================================================
  // PERSISTENCE
  // =========================================================================

  async persistPrediction(prediction, patientId, model, context) {
    const patientHash = featureStore.hashPatientId(patientId);
    
    await db.query(`
      INSERT INTO ml_predictions (
        model_id, model_name, model_version,
        patient_hash, entity_type, prediction_type,
        risk_score, risk_level, prediction_label, confidence,
        feature_contributions, explanation_text, top_risk_factors,
        recommended_actions, recommended_tests, care_pathway,
        triggered_by, request_context, inference_time_ms
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
    `, [
      model.id, model.model_name, model.model_version,
      patientHash, 'patient', prediction.predictionType,
      prediction.riskScore, prediction.riskLevel, prediction.predictionLabel, prediction.confidence,
      JSON.stringify(prediction.featureContributions), prediction.explanation, JSON.stringify(prediction.topRiskFactors),
      JSON.stringify(prediction.recommendedActions), JSON.stringify(prediction.recommendedTests),
      JSON.stringify(prediction.carePathway),
      context.triggeredBy || 'manual', JSON.stringify(context),
      prediction.inferenceTimeMs
    ]);
  }

  // =========================================================================
  // DEFAULT WEIGHTS FOR BASELINE MODELS
  // =========================================================================

  getDefaultWeight(featureName) {
    const defaults = {
      age: 0.01, is_elderly: 0.15, encounters_30d: 0.12, er_visits_90d: 0.18,
      active_medications: 0.05, polypharmacy_flag: 0.10, charlson_comorbidity_index: 0.12,
      mews_score: 0.15, no_show_rate: 0.08, denial_rate: 0.10, sdoh_risk_score: 0.08,
      clinical_complexity_score: 0.10
    };
    return defaults[featureName] || 0.05;
  }

  // =========================================================================
  // METRICS
  // =========================================================================

  getMetrics() {
    return {
      totalPredictions: this.predictionCount,
      averageInferenceMs: Math.round(this.avgInferenceMs * 100) / 100
    };
  }
}

module.exports = new InferenceEngine();
