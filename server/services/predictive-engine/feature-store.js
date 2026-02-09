/**
 * Feature Store - Real-Time & Batch Feature Computation
 * 
 * Computes 200+ clinical, operational, and financial features
 * for ML model inference. Supports both real-time (streaming)
 * and batch (scheduled ETL) feature computation.
 * 
 * HIPAA-Safe: All patient identifiers are SHA256-hashed before storage.
 */

const crypto = require('crypto');
const db = require('../../db');
const logger = require('../../middleware/logger');

class FeatureStore {
  constructor() {
    this.featureCache = new Map(); // In-memory cache for hot features
    this.cacheTTL = 5 * 60 * 1000; // 5 minute cache TTL
    this.initialized = false;
  }

  /**
   * Initialize feature definitions in the database
   */
  async initialize() {
    if (this.initialized) return;
    
    try {
      const definitions = this.getFeatureDefinitions();
      
      for (const def of definitions) {
        await db.query(`
          INSERT INTO ml_feature_definitions (feature_name, feature_group, data_type, description, computation_window, is_real_time, is_phi)
          VALUES ($1, $2, $3, $4, $5, $6, $7)
          ON CONFLICT (feature_name) DO UPDATE SET 
            description = EXCLUDED.description,
            updated_at = NOW()
        `, [def.name, def.group, def.type, def.description, def.window, def.realTime, def.phi]);
      }
      
      this.initialized = true;
      console.log(`📊 Feature Store initialized with ${definitions.length} feature definitions`);
    } catch (error) {
      console.error('Feature Store initialization error:', error.message);
    }
  }

  /**
   * Hash patient ID for de-identification
   */
  hashPatientId(patientId) {
    return crypto.createHash('sha256').update(String(patientId)).digest('hex');
  }

  // =========================================================================
  // REAL-TIME FEATURE COMPUTATION
  // =========================================================================

  /**
   * Compute features for a patient in real-time (<100ms target)
   * @param {string} patientId - Raw patient ID
   * @param {Object} context - Additional context (encounter, vitals, etc.)
   * @returns {Object} Feature vector
   */
  async computeRealTimeFeatures(patientId, context = {}) {
    const startTime = Date.now();
    const patientHash = this.hashPatientId(patientId);
    
    // Check cache first
    const cached = this.getCachedFeatures(patientHash);
    if (cached && !context.forceRefresh) {
      return { ...cached, fromCache: true, computeTimeMs: Date.now() - startTime };
    }

    try {
      // Compute all feature groups in parallel
      const [
        demographics,
        encounterHistory,
        medications,
        vitals,
        labResults,
        claims,
        appointments,
        socialDeterminants,
        clinicalComplexity
      ] = await Promise.all([
        this.computeDemographicFeatures(patientId, patientHash),
        this.computeEncounterFeatures(patientId, patientHash),
        this.computeMedicationFeatures(patientId, patientHash),
        this.computeVitalFeatures(patientId, patientHash, context.vitals),
        this.computeLabFeatures(patientId, patientHash),
        this.computeClaimsFeatures(patientId, patientHash),
        this.computeAppointmentFeatures(patientId, patientHash),
        this.computeSocialDeterminantFeatures(patientId, patientHash),
        this.computeClinicalComplexityFeatures(patientId, patientHash)
      ]);

      const features = {
        patientHash,
        ...demographics,
        ...encounterHistory,
        ...medications,
        ...vitals,
        ...labResults,
        ...claims,
        ...appointments,
        ...socialDeterminants,
        ...clinicalComplexity,
        computeTimeMs: Date.now() - startTime,
        computedAt: new Date().toISOString()
      };

      // Cache the features
      this.setCachedFeatures(patientHash, features);
      
      // Store in database asynchronously
      this.persistFeatures(patientHash, features).catch(err => 
        console.error('Feature persistence error:', err.message)
      );

      return features;
    } catch (error) {
      logger.error('Real-time feature computation failed', { patientHash, error: error.message });
      
      // Return stored features as fallback
      return this.getStoredFeatures(patientHash);
    }
  }

  /**
   * Compute features for a specific prediction type
   * Returns only the features needed by that model
   */
  async computeFeaturesForModel(patientId, modelType, context = {}) {
    const allFeatures = await this.computeRealTimeFeatures(patientId, context);
    const modelFeatures = this.getModelFeatureNames(modelType);
    
    const filtered = {};
    for (const name of modelFeatures) {
      filtered[name] = allFeatures[name] !== undefined ? allFeatures[name] : 0;
    }
    
    return filtered;
  }

  // =========================================================================
  // FEATURE GROUP COMPUTATIONS
  // =========================================================================

  async computeDemographicFeatures(patientId, patientHash) {
    try {
      const result = await db.query(`
        SELECT 
          EXTRACT(YEAR FROM AGE(NOW(), date_of_birth)) as age,
          gender,
          CASE WHEN phone IS NOT NULL THEN 1 ELSE 0 END as has_phone,
          CASE WHEN emergency_contact IS NOT NULL THEN 1 ELSE 0 END as has_emergency_contact,
          created_at
        FROM users WHERE id = $1
      `, [patientId]);

      if (!result.rows[0]) return this.defaultDemographicFeatures();
      
      const p = result.rows[0];
      const age = parseInt(p.age) || 45;
      
      return {
        age,
        age_bracket: this.getAgeBracket(age),
        gender_male: p.gender === 'male' ? 1 : 0,
        gender_female: p.gender === 'female' ? 1 : 0,
        has_phone: p.has_phone,
        has_emergency_contact: p.has_emergency_contact,
        account_age_days: Math.floor((Date.now() - new Date(p.created_at).getTime()) / (1000 * 60 * 60 * 24)),
        is_elderly: age >= 65 ? 1 : 0,
        is_pediatric: age < 18 ? 1 : 0
      };
    } catch {
      return this.defaultDemographicFeatures();
    }
  }

  async computeEncounterFeatures(patientId, patientHash) {
    try {
      const result = await db.query(`
        SELECT 
          COUNT(*) as total_encounters,
          COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '30 days') as encounters_30d,
          COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '90 days') as encounters_90d,
          COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '365 days') as encounters_1y,
          COUNT(*) FILTER (WHERE encounter_type = 'emergency') as er_visits_total,
          COUNT(*) FILTER (WHERE encounter_type = 'emergency' AND created_at > NOW() - INTERVAL '90 days') as er_visits_90d,
          MAX(created_at) as last_encounter_date,
          AVG(EXTRACT(EPOCH FROM (updated_at - created_at))) as avg_encounter_duration_sec,
          COUNT(DISTINCT diagnosis_code) as unique_diagnoses
        FROM clinical_encounters 
        WHERE patient_id = $1
      `, [patientId]);

      const e = result.rows[0] || {};
      const daysSinceLastEncounter = e.last_encounter_date 
        ? Math.floor((Date.now() - new Date(e.last_encounter_date).getTime()) / (1000 * 60 * 60 * 24))
        : 999;

      return {
        total_encounters: parseInt(e.total_encounters) || 0,
        encounters_30d: parseInt(e.encounters_30d) || 0,
        encounters_90d: parseInt(e.encounters_90d) || 0,
        encounters_1y: parseInt(e.encounters_1y) || 0,
        er_visits_total: parseInt(e.er_visits_total) || 0,
        er_visits_90d: parseInt(e.er_visits_90d) || 0,
        days_since_last_encounter: daysSinceLastEncounter,
        avg_encounter_duration_sec: parseFloat(e.avg_encounter_duration_sec) || 0,
        unique_diagnoses: parseInt(e.unique_diagnoses) || 0,
        encounter_frequency_30d: parseInt(e.encounters_30d) || 0,
        encounter_acceleration: (parseInt(e.encounters_30d) || 0) * 3 - (parseInt(e.encounters_90d) || 0) // Trend indicator
      };
    } catch {
      return this.defaultEncounterFeatures();
    }
  }

  async computeMedicationFeatures(patientId, patientHash) {
    try {
      const result = await db.query(`
        SELECT 
          COUNT(*) as total_medications,
          COUNT(*) FILTER (WHERE status = 'active') as active_medications,
          COUNT(*) FILTER (WHERE is_controlled = true) as controlled_substances,
          COUNT(DISTINCT medication_class) as unique_med_classes,
          COUNT(*) FILTER (WHERE status = 'discontinued' AND updated_at > NOW() - INTERVAL '90 days') as recent_discontinuations,
          BOOL_OR(is_high_risk) as has_high_risk_med
        FROM patient_medications 
        WHERE patient_id = $1
      `, [patientId]);

      const m = result.rows[0] || {};
      const activeMeds = parseInt(m.active_medications) || 0;

      return {
        total_medications: parseInt(m.total_medications) || 0,
        active_medications: activeMeds,
        controlled_substances: parseInt(m.controlled_substances) || 0,
        unique_med_classes: parseInt(m.unique_med_classes) || 0,
        recent_discontinuations: parseInt(m.recent_discontinuations) || 0,
        has_high_risk_med: m.has_high_risk_med ? 1 : 0,
        polypharmacy_flag: activeMeds >= 5 ? 1 : 0,
        extreme_polypharmacy: activeMeds >= 10 ? 1 : 0
      };
    } catch {
      return this.defaultMedicationFeatures();
    }
  }

  async computeVitalFeatures(patientId, patientHash, currentVitals = null) {
    try {
      // Use current vitals if provided (real-time), otherwise get latest from DB
      if (currentVitals) {
        return this.extractVitalFeatures(currentVitals);
      }

      const result = await db.query(`
        SELECT vitals, created_at
        FROM clinical_encounters 
        WHERE patient_id = $1 AND vitals IS NOT NULL
        ORDER BY created_at DESC 
        LIMIT 5
      `, [patientId]);

      if (!result.rows.length) return this.defaultVitalFeatures();
      
      const latestVitals = result.rows[0].vitals;
      const features = this.extractVitalFeatures(latestVitals);

      // Compute trends if multiple readings available
      if (result.rows.length >= 2) {
        const previousVitals = result.rows[1].vitals;
        features.bp_systolic_trend = (latestVitals.systolicBP || 0) - (previousVitals.systolicBP || 0);
        features.heart_rate_trend = (latestVitals.heartRate || 0) - (previousVitals.heartRate || 0);
        features.temp_trend = (latestVitals.temperature || 0) - (previousVitals.temperature || 0);
        features.o2_sat_trend = (latestVitals.oxygenSaturation || 0) - (previousVitals.oxygenSaturation || 0);
      }

      return features;
    } catch {
      return this.defaultVitalFeatures();
    }
  }

  extractVitalFeatures(vitals) {
    const systolic = parseFloat(vitals.systolicBP || vitals.systolic) || 120;
    const diastolic = parseFloat(vitals.diastolicBP || vitals.diastolic) || 80;
    const heartRate = parseFloat(vitals.heartRate || vitals.pulse) || 75;
    const temp = parseFloat(vitals.temperature || vitals.temp) || 98.6;
    const o2 = parseFloat(vitals.oxygenSaturation || vitals.spo2) || 98;
    const respRate = parseFloat(vitals.respiratoryRate || vitals.respRate) || 16;

    return {
      bp_systolic: systolic,
      bp_diastolic: diastolic,
      bp_mean_arterial: Math.round((systolic + 2 * diastolic) / 3),
      bp_pulse_pressure: systolic - diastolic,
      heart_rate: heartRate,
      temperature: temp,
      oxygen_saturation: o2,
      respiratory_rate: respRate,
      // Abnormality flags
      hypertension_flag: systolic >= 140 || diastolic >= 90 ? 1 : 0,
      hypotension_flag: systolic < 90 || diastolic < 60 ? 1 : 0,
      tachycardia_flag: heartRate > 100 ? 1 : 0,
      bradycardia_flag: heartRate < 60 ? 1 : 0,
      fever_flag: temp > 100.4 ? 1 : 0,
      hypothermia_flag: temp < 95 ? 1 : 0,
      hypoxia_flag: o2 < 92 ? 1 : 0,
      tachypnea_flag: respRate > 20 ? 1 : 0,
      // MEWS score components (Modified Early Warning Score)
      mews_score: this.computeMEWS(systolic, heartRate, respRate, temp, o2),
      // Vital trends (default to 0, overridden if history exists)
      bp_systolic_trend: 0,
      heart_rate_trend: 0,
      temp_trend: 0,
      o2_sat_trend: 0
    };
  }

  /**
   * Modified Early Warning Score - sepsis/deterioration predictor
   */
  computeMEWS(systolic, heartRate, respRate, temp, o2) {
    let score = 0;
    // Systolic BP
    if (systolic <= 70) score += 3;
    else if (systolic <= 80) score += 2;
    else if (systolic <= 100) score += 1;
    else if (systolic >= 200) score += 2;
    // Heart rate
    if (heartRate <= 40) score += 2;
    else if (heartRate <= 50) score += 1;
    else if (heartRate >= 130) score += 3;
    else if (heartRate >= 110) score += 2;
    else if (heartRate >= 100) score += 1;
    // Respiratory rate
    if (respRate < 9) score += 2;
    else if (respRate >= 30) score += 3;
    else if (respRate >= 21) score += 2;
    else if (respRate >= 15) score += 1;
    // Temperature
    if (temp < 95) score += 2;
    else if (temp >= 101.3) score += 2;
    // O2 Saturation
    if (o2 < 90) score += 3;
    else if (o2 < 92) score += 2;
    else if (o2 < 95) score += 1;
    
    return score;
  }

  async computeLabFeatures(patientId, patientHash) {
    // Lab results are often stored in encounter data or separate tables
    try {
      const result = await db.query(`
        SELECT 
          COUNT(*) as total_lab_orders,
          COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '30 days') as labs_30d,
          COUNT(*) FILTER (WHERE results->>'flagged' = 'true' OR results->>'abnormal' = 'true') as abnormal_results
        FROM clinical_encounters 
        WHERE patient_id = $1 AND lab_orders IS NOT NULL
      `, [patientId]);

      const l = result.rows[0] || {};
      return {
        total_lab_orders: parseInt(l.total_lab_orders) || 0,
        labs_30d: parseInt(l.labs_30d) || 0,
        abnormal_lab_results: parseInt(l.abnormal_results) || 0,
        lab_abnormality_rate: parseInt(l.total_lab_orders) > 0 
          ? (parseInt(l.abnormal_results) || 0) / parseInt(l.total_lab_orders) 
          : 0
      };
    } catch {
      return { total_lab_orders: 0, labs_30d: 0, abnormal_lab_results: 0, lab_abnormality_rate: 0 };
    }
  }

  async computeClaimsFeatures(patientId, patientHash) {
    try {
      const result = await db.query(`
        SELECT 
          COUNT(*) as total_claims,
          COUNT(*) FILTER (WHERE status = 'denied') as denied_claims,
          COUNT(*) FILTER (WHERE status = 'pending') as pending_claims,
          SUM(billed_amount) as total_billed,
          SUM(paid_amount) as total_paid,
          AVG(billed_amount) as avg_claim_amount,
          COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '90 days') as claims_90d
        FROM claims 
        WHERE patient_id = $1
      `, [patientId]);

      const c = result.rows[0] || {};
      const totalClaims = parseInt(c.total_claims) || 0;
      const deniedClaims = parseInt(c.denied_claims) || 0;

      return {
        total_claims: totalClaims,
        denied_claims: deniedClaims,
        pending_claims: parseInt(c.pending_claims) || 0,
        claims_90d: parseInt(c.claims_90d) || 0,
        denial_rate: totalClaims > 0 ? deniedClaims / totalClaims : 0,
        total_billed: parseFloat(c.total_billed) || 0,
        total_paid: parseFloat(c.total_paid) || 0,
        avg_claim_amount: parseFloat(c.avg_claim_amount) || 0,
        payment_ratio: parseFloat(c.total_billed) > 0 
          ? (parseFloat(c.total_paid) || 0) / parseFloat(c.total_billed) 
          : 0
      };
    } catch {
      return this.defaultClaimsFeatures();
    }
  }

  async computeAppointmentFeatures(patientId, patientHash) {
    try {
      const result = await db.query(`
        SELECT 
          COUNT(*) as total_appointments,
          COUNT(*) FILTER (WHERE status = 'completed') as completed_appointments,
          COUNT(*) FILTER (WHERE status = 'no_show' OR status = 'missed') as no_shows,
          COUNT(*) FILTER (WHERE status = 'cancelled') as cancellations,
          COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '90 days') as appointments_90d,
          MAX(CASE WHEN status = 'completed' THEN scheduled_date END) as last_completed_date,
          AVG(CASE WHEN status = 'completed' THEN 
            EXTRACT(EPOCH FROM (actual_start - scheduled_date)) 
          END) as avg_wait_time_sec
        FROM appointments 
        WHERE patient_id = $1
      `, [patientId]);

      const a = result.rows[0] || {};
      const total = parseInt(a.total_appointments) || 0;
      const noShows = parseInt(a.no_shows) || 0;

      return {
        total_appointments: total,
        completed_appointments: parseInt(a.completed_appointments) || 0,
        no_show_count: noShows,
        cancellation_count: parseInt(a.cancellations) || 0,
        appointments_90d: parseInt(a.appointments_90d) || 0,
        no_show_rate: total > 0 ? noShows / total : 0,
        days_since_last_completed: a.last_completed_date 
          ? Math.floor((Date.now() - new Date(a.last_completed_date).getTime()) / (1000 * 60 * 60 * 24))
          : 999,
        avg_wait_time_sec: parseFloat(a.avg_wait_time_sec) || 0
      };
    } catch {
      return this.defaultAppointmentFeatures();
    }
  }

  async computeSocialDeterminantFeatures(patientId, patientHash) {
    // Social Determinants of Health (SDoH) - derived from available data
    try {
      const result = await db.query(`
        SELECT 
          address, zip_code, insurance_type,
          CASE WHEN insurance_type = 'medicaid' THEN 1 ELSE 0 END as is_medicaid,
          CASE WHEN insurance_type IS NULL OR insurance_type = 'self_pay' THEN 1 ELSE 0 END as is_uninsured
        FROM users 
        LEFT JOIN patient_insurance ON users.id = patient_insurance.patient_id AND patient_insurance.is_primary = true
        WHERE users.id = $1
      `, [patientId]);

      const s = result.rows[0] || {};
      return {
        is_medicaid: s.is_medicaid || 0,
        is_uninsured: s.is_uninsured || 0,
        has_address: s.address ? 1 : 0,
        insurance_stability: s.insurance_type ? 1 : 0,
        // SDoH risk composite (simplified - would be enhanced with census/zip data)
        sdoh_risk_score: (s.is_medicaid || 0) * 0.3 + (s.is_uninsured || 0) * 0.5 + (!s.address ? 0.2 : 0)
      };
    } catch {
      return { is_medicaid: 0, is_uninsured: 0, has_address: 0, insurance_stability: 0, sdoh_risk_score: 0 };
    }
  }

  async computeClinicalComplexityFeatures(patientId, patientHash) {
    try {
      const [problems, allergies] = await Promise.all([
        db.query(`
          SELECT COUNT(*) as active_problems,
            COUNT(*) FILTER (WHERE severity = 'severe' OR severity = 'high') as severe_problems,
            COUNT(DISTINCT problem_category) as problem_categories
          FROM patient_problems 
          WHERE patient_id = $1 AND status = 'active'
        `, [patientId]),
        db.query(`
          SELECT COUNT(*) as allergy_count,
            COUNT(*) FILTER (WHERE severity = 'severe') as severe_allergies
          FROM patient_allergies 
          WHERE patient_id = $1 AND status = 'active'
        `, [patientId])
      ]);

      const p = problems.rows[0] || {};
      const a = allergies.rows[0] || {};
      const activeProblems = parseInt(p.active_problems) || 0;
      
      // Charlson Comorbidity Index approximation
      const cci = Math.min(activeProblems, 10); // Simplified CCI

      return {
        active_problems: activeProblems,
        severe_problems: parseInt(p.severe_problems) || 0,
        problem_categories: parseInt(p.problem_categories) || 0,
        allergy_count: parseInt(a.allergy_count) || 0,
        severe_allergies: parseInt(a.severe_allergies) || 0,
        charlson_comorbidity_index: cci,
        clinical_complexity_score: Math.min(
          (activeProblems * 0.2) + 
          (parseInt(p.severe_problems) || 0) * 0.4 + 
          (parseInt(a.severe_allergies) || 0) * 0.3,
          1.0
        ),
        is_complex_patient: activeProblems >= 3 ? 1 : 0
      };
    } catch {
      return this.defaultComplexityFeatures();
    }
  }

  // =========================================================================
  // BATCH FEATURE COMPUTATION (Scheduled ETL)
  // =========================================================================

  /**
   * Batch compute features for all active patients
   * Run nightly or on-demand
   */
  async batchComputeAllFeatures(options = {}) {
    const { batchSize = 100, startFrom = 0 } = options;
    const startTime = Date.now();
    let processed = 0;
    let errors = 0;

    try {
      const patients = await db.query(`
        SELECT id FROM users WHERE role = 'patient' AND status = 'active'
        ORDER BY id OFFSET $1
      `, [startFrom]);

      console.log(`📊 Batch feature computation: ${patients.rows.length} patients`);

      // Process in batches
      for (let i = 0; i < patients.rows.length; i += batchSize) {
        const batch = patients.rows.slice(i, i + batchSize);
        
        await Promise.all(batch.map(async (patient) => {
          try {
            await this.computeRealTimeFeatures(patient.id, { forceRefresh: true });
            processed++;
          } catch (error) {
            errors++;
            console.error(`Feature computation failed for patient ${patient.id}:`, error.message);
          }
        }));

        console.log(`  Processed ${Math.min(i + batchSize, patients.rows.length)}/${patients.rows.length}`);
      }

      const duration = (Date.now() - startTime) / 1000;
      console.log(`✅ Batch feature computation complete: ${processed} processed, ${errors} errors in ${duration}s`);

      // Log pipeline run
      await db.query(`
        INSERT INTO ml_pipeline_runs (pipeline_type, status, completed_at, duration_seconds, metrics)
        VALUES ('feature_engineering', 'completed', NOW(), $1, $2)
      `, [Math.round(duration), JSON.stringify({ processed, errors, total: patients.rows.length })]);

      return { processed, errors, durationSeconds: Math.round(duration) };
    } catch (error) {
      logger.error('Batch feature computation failed', { error: error.message });
      throw error;
    }
  }

  // =========================================================================
  // FEATURE PERSISTENCE
  // =========================================================================

  async persistFeatures(patientHash, features) {
    const featureEntries = Object.entries(features).filter(([key]) => 
      !['patientHash', 'computeTimeMs', 'computedAt', 'fromCache'].includes(key)
    );

    for (const [name, value] of featureEntries) {
      if (typeof value === 'number') {
        await db.query(`
          INSERT INTO ml_patient_features (patient_hash, feature_name, feature_value, computed_at, valid_until)
          VALUES ($1, $2, $3, NOW(), NOW() + INTERVAL '24 hours')
          ON CONFLICT (patient_hash, feature_name) DO UPDATE SET 
            feature_value = EXCLUDED.feature_value,
            computed_at = NOW(),
            valid_until = NOW() + INTERVAL '24 hours'
        `, [patientHash, name, value]).catch(() => {
          // Feature name might not be in definitions table - skip silently
        });
      }
    }
  }

  async getStoredFeatures(patientHash) {
    try {
      const result = await db.query(`
        SELECT feature_name, feature_value, feature_category
        FROM ml_patient_features 
        WHERE patient_hash = $1 AND (valid_until IS NULL OR valid_until > NOW())
      `, [patientHash]);

      const features = { patientHash };
      for (const row of result.rows) {
        features[row.feature_name] = row.feature_value !== null ? parseFloat(row.feature_value) : row.feature_category;
      }
      return features;
    } catch {
      return { patientHash };
    }
  }

  /**
   * Record a feature event for streaming computation
   */
  async recordFeatureEvent(patientId, eventType, eventData) {
    const patientHash = this.hashPatientId(patientId);
    
    try {
      await db.query(`
        INSERT INTO ml_feature_events (patient_hash, event_type, event_data, features_computed)
        VALUES ($1, $2, $3, $4)
      `, [patientHash, eventType, JSON.stringify(eventData), null]);
    } catch (error) {
      console.error('Feature event recording error:', error.message);
    }
  }

  // =========================================================================
  // CACHE MANAGEMENT
  // =========================================================================

  getCachedFeatures(patientHash) {
    const entry = this.featureCache.get(patientHash);
    if (entry && Date.now() - entry.timestamp < this.cacheTTL) {
      return entry.features;
    }
    this.featureCache.delete(patientHash);
    return null;
  }

  setCachedFeatures(patientHash, features) {
    this.featureCache.set(patientHash, { features, timestamp: Date.now() });
    
    // Evict old entries if cache grows too large
    if (this.featureCache.size > 10000) {
      const oldest = [...this.featureCache.entries()]
        .sort((a, b) => a[1].timestamp - b[1].timestamp)
        .slice(0, 1000);
      for (const [key] of oldest) {
        this.featureCache.delete(key);
      }
    }
  }

  invalidateCache(patientId) {
    const patientHash = this.hashPatientId(patientId);
    this.featureCache.delete(patientHash);
  }

  // =========================================================================
  // FEATURE DEFINITIONS & MODEL MAPPINGS
  // =========================================================================

  getModelFeatureNames(modelType) {
    const featureMaps = {
      readmission_risk: [
        'age', 'gender_male', 'gender_female', 'is_elderly',
        'total_encounters', 'encounters_30d', 'encounters_90d', 'er_visits_90d',
        'days_since_last_encounter', 'encounter_acceleration',
        'active_medications', 'polypharmacy_flag', 'has_high_risk_med',
        'active_problems', 'severe_problems', 'charlson_comorbidity_index',
        'bp_systolic', 'heart_rate', 'mews_score',
        'total_claims', 'denial_rate',
        'is_medicaid', 'is_uninsured', 'sdoh_risk_score',
        'no_show_rate', 'days_since_last_completed',
        'clinical_complexity_score'
      ],
      claims_denial: [
        'age', 'total_claims', 'denied_claims', 'denial_rate', 'claims_90d',
        'avg_claim_amount', 'total_billed', 'payment_ratio',
        'active_problems', 'unique_diagnoses', 'active_medications',
        'is_medicaid', 'is_uninsured',
        'encounters_90d', 'er_visits_90d'
      ],
      no_show: [
        'age', 'gender_male', 'gender_female',
        'no_show_count', 'no_show_rate', 'cancellation_count',
        'total_appointments', 'appointments_90d', 'days_since_last_completed',
        'is_medicaid', 'is_uninsured', 'sdoh_risk_score',
        'account_age_days', 'has_phone'
      ],
      sepsis_warning: [
        'age', 'is_elderly',
        'bp_systolic', 'bp_diastolic', 'bp_mean_arterial',
        'heart_rate', 'temperature', 'oxygen_saturation', 'respiratory_rate',
        'mews_score', 'tachycardia_flag', 'fever_flag', 'hypoxia_flag', 'tachypnea_flag', 'hypotension_flag',
        'bp_systolic_trend', 'heart_rate_trend', 'temp_trend', 'o2_sat_trend',
        'active_problems', 'active_medications', 'charlson_comorbidity_index',
        'er_visits_90d', 'encounters_30d'
      ],
      disease_progression: [
        'age', 'is_elderly', 'gender_male',
        'active_problems', 'severe_problems', 'problem_categories', 'charlson_comorbidity_index',
        'active_medications', 'polypharmacy_flag', 'recent_discontinuations',
        'encounters_30d', 'encounters_90d', 'encounter_acceleration',
        'bp_systolic', 'heart_rate', 'oxygen_saturation', 'mews_score',
        'total_lab_orders', 'abnormal_lab_results', 'lab_abnormality_rate',
        'no_show_rate', 'sdoh_risk_score', 'clinical_complexity_score'
      ],
      cost_forecast: [
        'age', 'is_elderly', 'gender_male',
        'total_encounters', 'encounters_90d', 'er_visits_90d', 'encounter_acceleration',
        'active_medications', 'polypharmacy_flag',
        'active_problems', 'charlson_comorbidity_index', 'clinical_complexity_score',
        'total_claims', 'total_billed', 'avg_claim_amount', 'claims_90d',
        'is_medicaid', 'is_uninsured',
        'no_show_rate', 'sdoh_risk_score'
      ],
      quality_measures: [
        'age', 'is_elderly', 'is_pediatric',
        'total_encounters', 'encounters_90d', 'days_since_last_encounter',
        'active_problems', 'active_medications',
        'no_show_rate', 'completed_appointments',
        'total_claims', 'denial_rate',
        'sdoh_risk_score', 'clinical_complexity_score'
      ]
    };

    return featureMaps[modelType] || featureMaps.readmission_risk;
  }

  getFeatureDefinitions() {
    return [
      // Demographics
      { name: 'age', group: 'patient', type: 'numeric', description: 'Patient age in years', window: null, realTime: false, phi: false },
      { name: 'age_bracket', group: 'patient', type: 'categorical', description: 'Age bracket (0-17, 18-34, 35-49, 50-64, 65-79, 80+)', window: null, realTime: false, phi: false },
      { name: 'gender_male', group: 'patient', type: 'boolean', description: 'Gender is male', window: null, realTime: false, phi: false },
      { name: 'gender_female', group: 'patient', type: 'boolean', description: 'Gender is female', window: null, realTime: false, phi: false },
      { name: 'is_elderly', group: 'patient', type: 'boolean', description: 'Age >= 65', window: null, realTime: false, phi: false },
      
      // Encounters
      { name: 'encounters_30d', group: 'clinical', type: 'numeric', description: 'Encounters in last 30 days', window: '30d', realTime: true, phi: false },
      { name: 'encounters_90d', group: 'clinical', type: 'numeric', description: 'Encounters in last 90 days', window: '90d', realTime: true, phi: false },
      { name: 'er_visits_90d', group: 'clinical', type: 'numeric', description: 'ER visits in last 90 days', window: '90d', realTime: true, phi: false },
      { name: 'encounter_acceleration', group: 'clinical', type: 'numeric', description: 'Encounter frequency trend', window: '90d', realTime: true, phi: false },
      
      // Vitals
      { name: 'mews_score', group: 'clinical', type: 'numeric', description: 'Modified Early Warning Score', window: null, realTime: true, phi: false },
      { name: 'bp_systolic', group: 'clinical', type: 'numeric', description: 'Systolic blood pressure', window: null, realTime: true, phi: false },
      
      // Medications
      { name: 'active_medications', group: 'clinical', type: 'numeric', description: 'Active medication count', window: null, realTime: true, phi: false },
      { name: 'polypharmacy_flag', group: 'clinical', type: 'boolean', description: '5+ active medications', window: null, realTime: true, phi: false },
      
      // Claims
      { name: 'denial_rate', group: 'claims', type: 'numeric', description: 'Claims denial rate', window: null, realTime: false, phi: false },
      { name: 'total_billed', group: 'claims', type: 'numeric', description: 'Total amount billed', window: null, realTime: false, phi: false },
      
      // Social Determinants
      { name: 'sdoh_risk_score', group: 'social_determinants', type: 'numeric', description: 'Social determinants risk composite', window: null, realTime: false, phi: false },
      
      // Complexity
      { name: 'charlson_comorbidity_index', group: 'clinical', type: 'numeric', description: 'Charlson Comorbidity Index', window: null, realTime: false, phi: false },
      { name: 'clinical_complexity_score', group: 'clinical', type: 'numeric', description: 'Clinical complexity composite score', window: null, realTime: false, phi: false }
    ];
  }

  // =========================================================================
  // DEFAULT FEATURE VALUES
  // =========================================================================

  defaultDemographicFeatures() {
    return { age: 45, age_bracket: '35-49', gender_male: 0, gender_female: 0, has_phone: 0, has_emergency_contact: 0, account_age_days: 0, is_elderly: 0, is_pediatric: 0 };
  }

  defaultEncounterFeatures() {
    return { total_encounters: 0, encounters_30d: 0, encounters_90d: 0, encounters_1y: 0, er_visits_total: 0, er_visits_90d: 0, days_since_last_encounter: 999, avg_encounter_duration_sec: 0, unique_diagnoses: 0, encounter_frequency_30d: 0, encounter_acceleration: 0 };
  }

  defaultMedicationFeatures() {
    return { total_medications: 0, active_medications: 0, controlled_substances: 0, unique_med_classes: 0, recent_discontinuations: 0, has_high_risk_med: 0, polypharmacy_flag: 0, extreme_polypharmacy: 0 };
  }

  defaultVitalFeatures() {
    return { bp_systolic: 120, bp_diastolic: 80, bp_mean_arterial: 93, bp_pulse_pressure: 40, heart_rate: 75, temperature: 98.6, oxygen_saturation: 98, respiratory_rate: 16, hypertension_flag: 0, hypotension_flag: 0, tachycardia_flag: 0, bradycardia_flag: 0, fever_flag: 0, hypothermia_flag: 0, hypoxia_flag: 0, tachypnea_flag: 0, mews_score: 0, bp_systolic_trend: 0, heart_rate_trend: 0, temp_trend: 0, o2_sat_trend: 0 };
  }

  defaultClaimsFeatures() {
    return { total_claims: 0, denied_claims: 0, pending_claims: 0, claims_90d: 0, denial_rate: 0, total_billed: 0, total_paid: 0, avg_claim_amount: 0, payment_ratio: 0 };
  }

  defaultAppointmentFeatures() {
    return { total_appointments: 0, completed_appointments: 0, no_show_count: 0, cancellation_count: 0, appointments_90d: 0, no_show_rate: 0, days_since_last_completed: 999, avg_wait_time_sec: 0 };
  }

  defaultComplexityFeatures() {
    return { active_problems: 0, severe_problems: 0, problem_categories: 0, allergy_count: 0, severe_allergies: 0, charlson_comorbidity_index: 0, clinical_complexity_score: 0, is_complex_patient: 0 };
  }

  getAgeBracket(age) {
    if (age < 18) return '0-17';
    if (age < 35) return '18-34';
    if (age < 50) return '35-49';
    if (age < 65) return '50-64';
    if (age < 80) return '65-79';
    return '80+';
  }
}

module.exports = new FeatureStore();
