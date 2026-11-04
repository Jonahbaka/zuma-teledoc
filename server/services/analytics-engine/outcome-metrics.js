/**
 * Outcome Metrics Service
 * 
 * Provides treatment efficacy and outcome analysis for population health.
 */

class OutcomeMetrics {
  constructor(db) {
    this.db = db;
  }

  /**
   * Get treatment efficacy metrics
   */
  async getTreatmentEfficacy(filters = {}) {
    const { conditionCode, medicationClass, minSampleSize = 5 } = filters;
    
    let query = `
      SELECT 
        condition_code,
        medication_class,
        treatment_plan_id,
        sample_size,
        avg_recovery_days,
        success_rate,
        readmission_rate,
        adherence_score_avg,
        outcome_delta_avg,
        calculated_at,
        CASE 
          WHEN readmission_rate > 15 THEN 'high_risk'
          WHEN readmission_rate > 10 THEN 'moderate_risk'
          ELSE 'low_risk'
        END as risk_category,
        (success_rate * 0.4 + (100 - readmission_rate) * 0.3 + adherence_score_avg * 0.3) as recommendation_score
      FROM analytics_outcome_metrics
      WHERE sample_size >= $1
    `;
    
    const params = [minSampleSize];
    let paramIndex = 2;

    if (conditionCode) {
      query += ` AND condition_code = $${paramIndex++}`;
      params.push(conditionCode);
    }

    if (medicationClass) {
      query += ` AND medication_class = $${paramIndex++}`;
      params.push(medicationClass);
    }

    query += ' ORDER BY recommendation_score DESC';

    const { rows } = await this.db.query(query, params);
    return rows;
  }

  /**
   * Get readmission risk analysis
   */
  async getReadmissionAnalysis(filters = {}) {
    const { conditionCode, threshold = 10 } = filters;

    let query = `
      SELECT 
        condition_code,
        medication_class,
        sample_size,
        readmission_rate,
        success_rate,
        avg_recovery_days,
        CASE 
          WHEN readmission_rate > $1 * 1.5 THEN 'critical'
          WHEN readmission_rate > $1 THEN 'elevated'
          ELSE 'normal'
        END as risk_level
      FROM analytics_outcome_metrics
      WHERE sample_size >= 5
    `;

    const params = [threshold];
    let paramIndex = 2;

    if (conditionCode) {
      query += ` AND condition_code = $${paramIndex++}`;
      params.push(conditionCode);
    }

    query += ' ORDER BY readmission_rate DESC';

    const { rows } = await this.db.query(query, params);
    return rows;
  }

  /**
   * Get condition-specific outcomes summary
   */
  async getConditionSummary(conditionCode) {
    const { rows } = await this.db.query(`
      SELECT 
        condition_code,
        COUNT(*) as treatment_options,
        AVG(success_rate) as avg_success_rate,
        AVG(readmission_rate) as avg_readmission_rate,
        SUM(sample_size) as total_patients,
        MIN(avg_recovery_days) as min_recovery_days,
        MAX(avg_recovery_days) as max_recovery_days
      FROM analytics_outcome_metrics
      WHERE condition_code = $1
      GROUP BY condition_code
    `, [conditionCode]);

    return rows[0] || null;
  }
}

module.exports = OutcomeMetrics;
