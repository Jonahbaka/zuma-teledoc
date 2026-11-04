/**
 * Provider Analytics Service
 * 
 * Provides performance metrics for providers,
 * useful for insurance companies and quality reporting.
 */

class ProviderAnalytics {
  constructor(db) {
    this.db = db;
  }

  /**
   * Get provider performance metrics
   */
  async getPerformanceMetrics(filters = {}) {
    const { specialty, performanceTier } = filters;

    let query = `
      SELECT 
        provider_hash,
        specialty,
        total_encounters,
        completed_encounters,
        ROUND((completed_encounters::numeric / NULLIF(total_encounters, 0) * 100), 2) as completion_rate,
        avg_encounter_duration,
        patient_satisfaction_avg,
        efficiency_score,
        cost_per_episode_avg,
        calculated_at,
        CASE 
          WHEN efficiency_score >= 90 AND patient_satisfaction_avg >= 4.5 THEN 'tier_1_excellent'
          WHEN efficiency_score >= 75 AND patient_satisfaction_avg >= 4.0 THEN 'tier_2_good'
          WHEN efficiency_score >= 60 AND patient_satisfaction_avg >= 3.5 THEN 'tier_3_acceptable'
          ELSE 'tier_4_needs_improvement'
        END as performance_tier
      FROM analytics_provider_performance
      WHERE total_encounters > 0
    `;

    const params = [];
    let paramIndex = 1;

    if (specialty) {
      query += ` AND specialty = $${paramIndex++}`;
      params.push(specialty);
    }

    query += ' ORDER BY efficiency_score DESC, patient_satisfaction_avg DESC';

    const { rows } = await this.db.query(query, params);

    // Filter by performance tier if specified
    if (performanceTier) {
      return rows.filter(r => r.performance_tier === performanceTier);
    }

    return rows;
  }

  /**
   * Get cost analysis by specialty
   */
  async getCostAnalysis(filters = {}) {
    const { specialty } = filters;

    let query = `
      SELECT 
        specialty,
        COUNT(*) as provider_count,
        AVG(cost_per_episode_avg) as avg_cost_per_episode,
        MIN(cost_per_episode_avg) as min_cost_per_episode,
        MAX(cost_per_episode_avg) as max_cost_per_episode,
        AVG(efficiency_score) as avg_efficiency_score,
        SUM(total_encounters) as total_encounters
      FROM analytics_provider_performance
      WHERE total_encounters > 0
    `;

    const params = [];

    if (specialty) {
      query += ` AND specialty = $1`;
      params.push(specialty);
    }

    query += ' GROUP BY specialty ORDER BY avg_cost_per_episode';

    const { rows } = await this.db.query(query, params);
    return rows;
  }

  /**
   * Get specialty benchmarks
   */
  async getSpecialtyBenchmarks() {
    const { rows } = await this.db.query(`
      SELECT 
        specialty,
        COUNT(*) as provider_count,
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY efficiency_score) as median_efficiency,
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY patient_satisfaction_avg) as median_satisfaction,
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY cost_per_episode_avg) as median_cost,
        AVG(total_encounters) as avg_encounters_per_provider
      FROM analytics_provider_performance
      WHERE total_encounters >= 10
      GROUP BY specialty
      ORDER BY specialty
    `);

    return rows;
  }
}

module.exports = ProviderAnalytics;
