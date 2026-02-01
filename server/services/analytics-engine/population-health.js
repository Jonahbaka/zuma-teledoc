/**
 * Population Health Service
 * 
 * Provides population-level health analytics for healthcare systems
 * monitoring patient populations.
 */

class PopulationHealth {
  constructor(db) {
    this.db = db;
  }

  /**
   * Get population health overview
   */
  async getOverview(filters = {}) {
    const { ageBracket, gender, conditionCategory } = filters;

    let query = `
      SELECT 
        age_bracket,
        gender,
        condition_category,
        patient_count,
        avg_encounters_per_patient,
        avg_medications_per_patient,
        chronic_condition_rate,
        calculated_at,
        CASE 
          WHEN age_bracket = 'pediatric' THEN 'pediatric_population'
          WHEN age_bracket = '65+' THEN 'senior_population'
          WHEN chronic_condition_rate > 30 THEN 'high_risk_chronic'
          ELSE 'general_population'
        END as population_segment
      FROM analytics_population_health
      WHERE patient_count > 0
    `;

    const params = [];
    let paramIndex = 1;

    if (ageBracket) {
      query += ` AND age_bracket = $${paramIndex++}`;
      params.push(ageBracket);
    }

    if (gender) {
      query += ` AND gender = $${paramIndex++}`;
      params.push(gender);
    }

    if (conditionCategory) {
      query += ` AND condition_category = $${paramIndex++}`;
      params.push(conditionCategory);
    }

    query += ' ORDER BY patient_count DESC';

    const { rows } = await this.db.query(query, params);
    return rows;
  }

  /**
   * Get risk stratification summary
   */
  async getRiskStratification() {
    const { rows } = await this.db.query(`
      SELECT 
        CASE 
          WHEN chronic_condition_rate > 40 THEN 'high_risk'
          WHEN chronic_condition_rate > 20 THEN 'moderate_risk'
          ELSE 'low_risk'
        END as risk_tier,
        SUM(patient_count) as patient_count,
        AVG(avg_encounters_per_patient) as avg_encounters,
        AVG(avg_medications_per_patient) as avg_medications
      FROM analytics_population_health
      GROUP BY 
        CASE 
          WHEN chronic_condition_rate > 40 THEN 'high_risk'
          WHEN chronic_condition_rate > 20 THEN 'moderate_risk'
          ELSE 'low_risk'
        END
      ORDER BY patient_count DESC
    `);

    return rows;
  }

  /**
   * Get condition prevalence by demographic
   */
  async getConditionPrevalence(conditionCategory) {
    const { rows } = await this.db.query(`
      SELECT 
        age_bracket,
        gender,
        patient_count,
        chronic_condition_rate,
        ROUND(patient_count::numeric / SUM(patient_count) OVER() * 100, 2) as percentage_of_total
      FROM analytics_population_health
      WHERE condition_category = $1
      ORDER BY patient_count DESC
    `, [conditionCategory]);

    return rows;
  }

  /**
   * Get utilization trends
   */
  async getUtilizationTrends() {
    const { rows } = await this.db.query(`
      SELECT 
        age_bracket,
        SUM(patient_count) as total_patients,
        AVG(avg_encounters_per_patient) as avg_visits,
        AVG(avg_medications_per_patient) as avg_meds,
        AVG(chronic_condition_rate) as chronic_rate
      FROM analytics_population_health
      GROUP BY age_bracket
      ORDER BY 
        CASE age_bracket
          WHEN 'pediatric' THEN 1
          WHEN '18-35' THEN 2
          WHEN '36-50' THEN 3
          WHEN '51-65' THEN 4
          WHEN '65+' THEN 5
        END
    `);

    return rows;
  }
}

module.exports = PopulationHealth;
