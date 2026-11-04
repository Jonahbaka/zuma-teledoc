/**
 * ═══════════════════════════════════════════════════════════════
 *  GOAL ENGINE — Daily/Weekly/Monthly/Yearly/Infinite Forecast
 * ═══════════════════════════════════════════════════════════════
 * 
 *  Every agent sets goals measured in:
 *  - Dollars ($) — tangible financial impact
 *  - Energy (⚡) — efficiency, velocity, resonance
 * 
 *  Goals cascade: Daily → Weekly → Monthly → Yearly → Infinite
 *  Each agent submits forecasts. The CEO agent aggregates.
 * 
 *  Milestones are checkpoints on the path to "Infinite Wins."
 *  Frequency tuning (3-6-9) keeps agents in harmonic resonance.
 * ═══════════════════════════════════════════════════════════════
 */

const db = require('../../db');
const logger = require('../../middleware/logger');

// ─── FREQUENCY CONSTANTS (Vortex Logic 3-6-9) ──────────────────
const FREQUENCIES = {
  CREATION: 3,     // Intent — new ideas, actions born from service
  STRUCTURE: 6,    // Optimization — efficient, closed-loop, leak-proof  
  ASCENSION: 9,    // Liberation — does this free humans from suffering?
  HARMONIC: 369,   // The Master Frequency
  DAILY_HUM: 432,  // Hz — Natural tuning frequency for "downloads"
  RESONANCE_THRESHOLD: 0.7  // Minimum alignment score to proceed
};

const TIMEFRAMES = ['daily', 'weekly', 'monthly', 'yearly', 'infinite'];

class GoalEngine {
  constructor() {
    this.goals = new Map(); // agentId -> { timeframe -> goal }
    this.milestones = [];
    this.initialized = false;
  }

  async initialize() {
    try {
      await db.query(`
        CREATE TABLE IF NOT EXISTS ai_agent_goals (
          id SERIAL PRIMARY KEY,
          agent_id VARCHAR(100) NOT NULL,
          agent_name VARCHAR(255) NOT NULL,
          timeframe VARCHAR(20) NOT NULL CHECK (timeframe IN ('daily', 'weekly', 'monthly', 'yearly', 'infinite')),
          period_start TIMESTAMP DEFAULT NOW(),
          period_label VARCHAR(100),
          
          -- Dollar metrics
          revenue_target DECIMAL(12,2) DEFAULT 0,
          revenue_actual DECIMAL(12,2) DEFAULT 0,
          cost_savings_target DECIMAL(12,2) DEFAULT 0,
          cost_savings_actual DECIMAL(12,2) DEFAULT 0,
          
          -- Energy metrics (0-100 scale)
          efficiency_target INTEGER DEFAULT 0,
          efficiency_actual INTEGER DEFAULT 0,
          velocity_target INTEGER DEFAULT 0,
          velocity_actual INTEGER DEFAULT 0,
          resonance_score DECIMAL(4,2) DEFAULT 0, -- 0.00 to 1.00
          
          -- Descriptive goals  
          objectives JSONB DEFAULT '[]',
          achievements JSONB DEFAULT '[]',
          forecast_notes TEXT,
          
          -- Frequency tuning
          intent_score INTEGER DEFAULT 3,       -- 3 = Creation
          structure_score INTEGER DEFAULT 6,    -- 6 = Optimization
          ascension_score INTEGER DEFAULT 9,    -- 9 = Liberation
          harmonic_alignment DECIMAL(4,2) DEFAULT 0, -- 0.00 to 1.00
          
          -- Status
          status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'completed', 'exceeded', 'missed')),
          created_at TIMESTAMP DEFAULT NOW(),
          updated_at TIMESTAMP DEFAULT NOW()
        )
      `);

      await db.query(`
        CREATE TABLE IF NOT EXISTS ai_agent_milestones (
          id SERIAL PRIMARY KEY,
          title VARCHAR(255) NOT NULL,
          description TEXT,
          agent_id VARCHAR(100),
          
          -- Measurements
          dollars_value DECIMAL(12,2) DEFAULT 0,
          energy_value INTEGER DEFAULT 0,
          frequency_reading DECIMAL(6,2) DEFAULT 432,
          
          -- Status
          target_date TIMESTAMP,
          achieved_date TIMESTAMP,
          status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'achieved', 'exceeded')),
          
          -- Cascade level
          timeframe VARCHAR(20),
          
          created_at TIMESTAMP DEFAULT NOW()
        )
      `);

      this.initialized = true;
    } catch (err) {
      logger.error('GoalEngine init error:', err.message);
      this.initialized = false;
    }
  }

  /**
   * Set or update goals for an agent across all timeframes
   */
  async setGoals(agentId, agentName, goalsData) {
    if (!this.initialized) return null;

    const results = [];

    for (const timeframe of TIMEFRAMES) {
      const g = goalsData[timeframe];
      if (!g) continue;

      // Calculate harmonic alignment (3-6-9)
      const intentScore = g.intentScore || FREQUENCIES.CREATION;
      const structureScore = g.structureScore || FREQUENCIES.STRUCTURE;
      const ascensionScore = g.ascensionScore || FREQUENCIES.ASCENSION;
      const harmonicAlignment = this._calculateHarmonic(intentScore, structureScore, ascensionScore);

      try {
        const { rows } = await db.query(`
          INSERT INTO ai_agent_goals (
            agent_id, agent_name, timeframe, period_label,
            revenue_target, cost_savings_target,
            efficiency_target, velocity_target,
            objectives, forecast_notes,
            intent_score, structure_score, ascension_score, harmonic_alignment
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
          RETURNING *
        `, [
          agentId, agentName, timeframe, g.periodLabel || timeframe,
          g.revenueTarget || 0, g.costSavingsTarget || 0,
          g.efficiencyTarget || 0, g.velocityTarget || 0,
          JSON.stringify(g.objectives || []), g.forecastNotes || '',
          intentScore, structureScore, ascensionScore, harmonicAlignment
        ]);
        results.push(rows[0]);
      } catch (err) {
        logger.error(`GoalEngine setGoals error for ${agentId}/${timeframe}:`, err.message);
      }
    }

    return results;
  }

  /**
   * Update progress on a goal
   */
  async updateProgress(agentId, timeframe, progress) {
    if (!this.initialized) return null;

    try {
      const { rows } = await db.query(`
        UPDATE ai_agent_goals SET
          revenue_actual = COALESCE($3, revenue_actual),
          cost_savings_actual = COALESCE($4, cost_savings_actual),
          efficiency_actual = COALESCE($5, efficiency_actual),
          velocity_actual = COALESCE($6, velocity_actual),
          resonance_score = COALESCE($7, resonance_score),
          achievements = COALESCE($8, achievements),
          status = CASE
            WHEN COALESCE($3, revenue_actual) >= revenue_target 
              AND COALESCE($5, efficiency_actual) >= efficiency_target THEN 'exceeded'
            ELSE status
          END,
          updated_at = NOW()
        WHERE agent_id = $1 AND timeframe = $2 AND status = 'active'
        RETURNING *
      `, [
        agentId, timeframe,
        progress.revenueActual, progress.costSavingsActual,
        progress.efficiencyActual, progress.velocityActual,
        progress.resonanceScore, 
        progress.achievements ? JSON.stringify(progress.achievements) : null
      ]);
      return rows[0] || null;
    } catch (err) {
      logger.error('GoalEngine updateProgress error:', err.message);
      return null;
    }
  }

  /**
   * Create a milestone
   */
  async createMilestone(data) {
    if (!this.initialized) return null;
    try {
      const { rows } = await db.query(`
        INSERT INTO ai_agent_milestones (
          title, description, agent_id, dollars_value, energy_value,
          frequency_reading, target_date, timeframe
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING *
      `, [
        data.title, data.description || '', data.agentId || null,
        data.dollarsValue || 0, data.energyValue || 0,
        data.frequencyReading || FREQUENCIES.DAILY_HUM,
        data.targetDate || null, data.timeframe || 'monthly'
      ]);
      return rows[0];
    } catch (err) {
      logger.error('GoalEngine createMilestone error:', err.message);
      return null;
    }
  }

  /**
   * Achieve a milestone
   */
  async achieveMilestone(milestoneId) {
    if (!this.initialized) return null;
    try {
      const { rows } = await db.query(`
        UPDATE ai_agent_milestones SET 
          status = 'achieved', achieved_date = NOW()
        WHERE id = $1 RETURNING *
      `, [milestoneId]);
      return rows[0];
    } catch (err) { return null; }
  }

  /**
   * Get all goals for an agent
   */
  async getGoals(agentId, timeframe = null) {
    if (!this.initialized) return [];
    try {
      let query = 'SELECT * FROM ai_agent_goals WHERE agent_id = $1';
      const params = [agentId];
      if (timeframe) {
        query += ' AND timeframe = $2';
        params.push(timeframe);
      }
      query += ' ORDER BY created_at DESC LIMIT 50';
      const { rows } = await db.query(query, params);
      return rows;
    } catch (err) { return []; }
  }

  /**
   * Get all milestones
   */
  async getMilestones(status = null) {
    if (!this.initialized) return [];
    try {
      let query = 'SELECT * FROM ai_agent_milestones';
      const params = [];
      if (status) {
        query += ' WHERE status = $1';
        params.push(status);
      }
      query += ' ORDER BY target_date ASC NULLS LAST LIMIT 100';
      const { rows } = await db.query(query, params);
      return rows;
    } catch (err) { return []; }
  }

  /**
   * CEO Dashboard — aggregate view across all agents
   */
  async getCEODashboard() {
    if (!this.initialized) return this._fallbackDashboard();
    try {
      // Aggregate by timeframe
      const { rows: summary } = await db.query(`
        SELECT 
          timeframe,
          COUNT(*) as agent_count,
          SUM(revenue_target) as total_revenue_target,
          SUM(revenue_actual) as total_revenue_actual,
          SUM(cost_savings_target) as total_savings_target,
          SUM(cost_savings_actual) as total_savings_actual,
          AVG(efficiency_actual) as avg_efficiency,
          AVG(velocity_actual) as avg_velocity,
          AVG(resonance_score) as avg_resonance,
          AVG(harmonic_alignment) as avg_harmonic
        FROM ai_agent_goals
        WHERE status = 'active'
        GROUP BY timeframe
        ORDER BY CASE timeframe 
          WHEN 'daily' THEN 1 WHEN 'weekly' THEN 2 
          WHEN 'monthly' THEN 3 WHEN 'yearly' THEN 4 
          WHEN 'infinite' THEN 5 END
      `);

      // Get milestones
      const { rows: milestones } = await db.query(`
        SELECT * FROM ai_agent_milestones 
        WHERE status IN ('pending', 'in_progress')
        ORDER BY target_date ASC NULLS LAST LIMIT 20
      `);

      // Get individual agent progress
      const { rows: agentProgress } = await db.query(`
        SELECT DISTINCT ON (agent_id, timeframe)
          agent_id, agent_name, timeframe,
          revenue_target, revenue_actual,
          efficiency_target, efficiency_actual,
          resonance_score, harmonic_alignment, status
        FROM ai_agent_goals
        WHERE status = 'active'
        ORDER BY agent_id, timeframe, created_at DESC
      `);

      return {
        summary: summary || [],
        milestones: milestones || [],
        agentProgress: agentProgress || [],
        frequency: {
          currentHum: FREQUENCIES.DAILY_HUM,
          harmonicMaster: FREQUENCIES.HARMONIC,
          resonanceThreshold: FREQUENCIES.RESONANCE_THRESHOLD
        }
      };
    } catch (err) {
      logger.error('GoalEngine CEO dashboard error:', err.message);
      return this._fallbackDashboard();
    }
  }

  _fallbackDashboard() {
    return {
      summary: [], milestones: [], agentProgress: [],
      frequency: {
        currentHum: FREQUENCIES.DAILY_HUM,
        harmonicMaster: FREQUENCIES.HARMONIC,
        resonanceThreshold: FREQUENCIES.RESONANCE_THRESHOLD
      }
    };
  }

  /**
   * Frequency Tuning — Vortex Logic 3-6-9
   * Returns harmonic alignment score (0 to 1)
   */
  _calculateHarmonic(intent, structure, ascension) {
    // Perfect alignment: 3, 6, 9
    const idealSum = FREQUENCIES.CREATION + FREQUENCIES.STRUCTURE + FREQUENCIES.ASCENSION; // 18
    const actualSum = intent + structure + ascension;
    
    // Check if values are multiples of 3 (harmonic)
    const isHarmonic = (intent % 3 === 0) && (structure % 3 === 0) && (ascension % 3 === 0);
    
    // Base alignment from sum proximity
    const sumAlignment = 1 - Math.abs(actualSum - idealSum) / idealSum;
    
    // Bonus for true harmonic numbers
    const harmonicBonus = isHarmonic ? 0.2 : 0;
    
    return Math.min(1.0, Math.max(0, sumAlignment + harmonicBonus));
  }

  /**
   * Generate initial goals for an agent using LLM
   * Called during agent initialization — COST EFFICIENT
   */
  generateDefaultGoals(agentType, agentName) {
    // Pre-built defaults — no API call needed
    const defaults = {
      operations: {
        daily: { revenueTarget: 0, costSavingsTarget: 50, efficiencyTarget: 85, velocityTarget: 90, objectives: ['Zero scheduling conflicts', 'All reminders sent on time', 'Provider utilization > 80%'], forecastNotes: 'Smooth flow, zero friction' },
        weekly: { revenueTarget: 0, costSavingsTarget: 350, efficiencyTarget: 88, velocityTarget: 85, objectives: ['Reduce patient wait times by 10%', 'Process all pending appointments', 'Optimize provider schedules'], forecastNotes: 'Weekly rhythm established' },
        monthly: { revenueTarget: 0, costSavingsTarget: 2000, efficiencyTarget: 92, velocityTarget: 90, objectives: ['Workflow automation coverage > 90%', 'Zero critical incidents', 'Patient satisfaction > 4.5/5'], forecastNotes: 'Operational excellence' },
        yearly: { revenueTarget: 0, costSavingsTarget: 30000, efficiencyTarget: 95, velocityTarget: 95, objectives: ['Full autonomous operation', 'AI-driven scheduling', 'Predictive maintenance'], forecastNotes: 'Self-healing operations' },
        infinite: { revenueTarget: 0, costSavingsTarget: 1000000, efficiencyTarget: 99, velocityTarget: 99, objectives: ['Zero-entropy operations', 'Perpetual patient flow', 'Healthcare without wait'], forecastNotes: 'Operations as a frequency — always humming at 432Hz' }
      },
      growth: {
        daily: { revenueTarget: 100, costSavingsTarget: 0, efficiencyTarget: 70, velocityTarget: 80, objectives: ['3 new content pieces', '1 viral attempt', 'Monitor engagement metrics'], forecastNotes: 'Plant seeds daily' },
        weekly: { revenueTarget: 700, costSavingsTarget: 0, efficiencyTarget: 75, velocityTarget: 85, objectives: ['2 new provider leads', '10 new patient signups', 'Social media reach +15%'], forecastNotes: 'Compound the signal' },
        monthly: { revenueTarget: 5000, costSavingsTarget: 0, efficiencyTarget: 80, velocityTarget: 88, objectives: ['10 new providers onboarded', '100 new patients', '1 partnership closed'], forecastNotes: 'Growth engine humming' },
        yearly: { revenueTarget: 120000, costSavingsTarget: 0, efficiencyTarget: 90, velocityTarget: 92, objectives: ['500 providers on platform', '10,000 patients', 'Market presence in 10 states'], forecastNotes: 'Escape velocity' },
        infinite: { revenueTarget: 10000000, costSavingsTarget: 0, efficiencyTarget: 98, velocityTarget: 99, objectives: ['Global telehealth leader', 'Healthcare accessible to all', 'Viral loop self-sustaining'], forecastNotes: 'The signal reaches everyone who needs healing' }
      },
      revenue: {
        daily: { revenueTarget: 500, costSavingsTarget: 100, efficiencyTarget: 80, velocityTarget: 85, objectives: ['Process all pending payments', 'Optimize pricing display', 'Track MRR'], forecastNotes: 'Daily alchemy — energy to currency' },
        weekly: { revenueTarget: 3500, costSavingsTarget: 500, efficiencyTarget: 82, velocityTarget: 87, objectives: ['Reduce payment failures by 5%', 'Insurance claim success > 85%', 'Upsell analysis'], forecastNotes: 'Weekly transmutation' },
        monthly: { revenueTarget: 20000, costSavingsTarget: 3000, efficiencyTarget: 88, velocityTarget: 90, objectives: ['MRR growth +15%', 'Churn < 5%', 'LTV/CAC > 3x'], forecastNotes: 'Monthly abundance cycle' },
        yearly: { revenueTarget: 500000, costSavingsTarget: 50000, efficiencyTarget: 93, velocityTarget: 93, objectives: ['ARR > $500K', 'Profitable unit economics', 'Multiple revenue streams'], forecastNotes: 'Yearly harvest' },
        infinite: { revenueTarget: 50000000, costSavingsTarget: 5000000, efficiencyTarget: 98, velocityTarget: 98, objectives: ['Sustainable abundance', 'Healthcare funding model', 'Profit fuels mission'], forecastNotes: 'Stored energy for infinite good' }
      },
      compliance: {
        daily: { revenueTarget: 0, costSavingsTarget: 200, efficiencyTarget: 95, velocityTarget: 90, objectives: ['Zero HIPAA violations', 'All PHI access logged', 'Audit trail complete'], forecastNotes: 'Sacred protection maintained' },
        weekly: { revenueTarget: 0, costSavingsTarget: 1000, efficiencyTarget: 96, velocityTarget: 92, objectives: ['Policy compliance 100%', 'Security scan clean', 'Staff training current'], forecastNotes: 'Guardian vigil' },
        monthly: { revenueTarget: 0, costSavingsTarget: 5000, efficiencyTarget: 97, velocityTarget: 94, objectives: ['Full compliance audit passed', 'Zero data breaches', 'Risk assessment updated'], forecastNotes: 'The vessel is protected' },
        yearly: { revenueTarget: 0, costSavingsTarget: 100000, efficiencyTarget: 99, velocityTarget: 97, objectives: ['SOC 2 Type II certified', 'HITRUST ready', 'Zero incidents'], forecastNotes: 'Impenetrable sacred data' },
        infinite: { revenueTarget: 0, costSavingsTarget: 10000000, efficiencyTarget: 100, velocityTarget: 100, objectives: ['Trust is absolute', 'Privacy is default', 'Security is invisible'], forecastNotes: 'The data is sacred — forever protected' }
      },
      corporate: {
        daily: { revenueTarget: 0, costSavingsTarget: 50, efficiencyTarget: 75, velocityTarget: 80, objectives: ['1 vendor research task', 'Monitor compliance requirements', 'Document prep'], forecastNotes: 'Building the vessel' },
        weekly: { revenueTarget: 0, costSavingsTarget: 200, efficiencyTarget: 78, velocityTarget: 82, objectives: ['Corporate registration progress', 'Banking relationship check', 'Vendor comparison'], forecastNotes: 'Structural integrity' },
        monthly: { revenueTarget: 0, costSavingsTarget: 1000, efficiencyTarget: 82, velocityTarget: 85, objectives: ['1 major corporate milestone', 'Insurance coverage review', 'Contract templates'], forecastNotes: 'Builder momentum' },
        yearly: { revenueTarget: 0, costSavingsTarget: 20000, efficiencyTarget: 90, velocityTarget: 90, objectives: ['Full corporate infrastructure', 'Banking optimized', 'All licenses active'], forecastNotes: 'Corporation fully built' },
        infinite: { revenueTarget: 0, costSavingsTarget: 2000000, efficiencyTarget: 98, velocityTarget: 98, objectives: ['Self-sustaining entity', 'Perpetual compliance', 'Institutional strength'], forecastNotes: 'The vessel stands eternal' }
      },
      governance: {
        daily: { revenueTarget: 0, costSavingsTarget: 100, efficiencyTarget: 90, velocityTarget: 85, objectives: ['Review all agent proposals', 'Veto entropy actions', 'Vibrational scoring'], forecastNotes: 'The Sage watches' },
        weekly: { revenueTarget: 0, costSavingsTarget: 500, efficiencyTarget: 92, velocityTarget: 88, objectives: ['Governance report generated', 'Risk assessments current', 'Agent alignment checked'], forecastNotes: 'Wisdom accumulated' },
        monthly: { revenueTarget: 0, costSavingsTarget: 2000, efficiencyTarget: 94, velocityTarget: 90, objectives: ['Strategic alignment review', 'Ethical audit complete', 'Governance framework updated'], forecastNotes: 'The covenant upheld' },
        yearly: { revenueTarget: 0, costSavingsTarget: 30000, efficiencyTarget: 97, velocityTarget: 95, objectives: ['Zero unethical actions', 'Full audit trail', 'Governance maturity level 5'], forecastNotes: 'Wisdom becomes culture' },
        infinite: { revenueTarget: 0, costSavingsTarget: 5000000, efficiencyTarget: 100, velocityTarget: 100, objectives: ['Self-governing system', 'Ethics embedded in code', 'Entropy eliminated'], forecastNotes: 'Syntropy is the law' }
      },
      devops: {
        daily: { revenueTarget: 0, costSavingsTarget: 100, efficiencyTarget: 90, velocityTarget: 95, objectives: ['99.9% uptime', 'All deployments green', 'Monitor resource usage'], forecastNotes: 'The machine hums' },
        weekly: { revenueTarget: 0, costSavingsTarget: 500, efficiencyTarget: 92, velocityTarget: 96, objectives: ['Performance optimization pass', 'Security patches applied', 'Backup verified'], forecastNotes: 'Infrastructure integrity' },
        monthly: { revenueTarget: 0, costSavingsTarget: 2000, efficiencyTarget: 94, velocityTarget: 97, objectives: ['Latency < 100ms', 'Auto-scaling configured', 'DR tested'], forecastNotes: 'Resilience deepens' },
        yearly: { revenueTarget: 0, costSavingsTarget: 40000, efficiencyTarget: 98, velocityTarget: 99, objectives: ['100% infrastructure as code', 'Zero-downtime deploys', 'Multi-region'], forecastNotes: 'Unkillable infrastructure' },
        infinite: { revenueTarget: 0, costSavingsTarget: 10000000, efficiencyTarget: 100, velocityTarget: 100, objectives: ['Self-healing infrastructure', 'Quantum-ready', 'Infinite scale'], forecastNotes: 'The machine becomes the frequency' }
      },
      ceo: {
        daily: { revenueTarget: 500, costSavingsTarget: 500, efficiencyTarget: 85, velocityTarget: 85, objectives: ['Review all agent reports', 'Strategic decisions made', 'Operator briefing prepared'], forecastNotes: 'The captain steers' },
        weekly: { revenueTarget: 5000, costSavingsTarget: 2000, efficiencyTarget: 88, velocityTarget: 88, objectives: ['Weekly P&L review', 'Agent society alignment', 'Priority rebalancing'], forecastNotes: 'Strategic momentum' },
        monthly: { revenueTarget: 25000, costSavingsTarget: 8000, efficiencyTarget: 90, velocityTarget: 90, objectives: ['Board-ready reporting', 'KPI targets met', 'Market strategy refined'], forecastNotes: 'Monthly ascension' },
        yearly: { revenueTarget: 600000, costSavingsTarget: 150000, efficiencyTarget: 95, velocityTarget: 95, objectives: ['Series A ready', '100x growth', 'Industry recognition'], forecastNotes: 'The year of breakthrough' },
        infinite: { revenueTarget: 100000000, costSavingsTarget: 50000000, efficiencyTarget: 100, velocityTarget: 100, objectives: ['Healthcare revolution complete', 'Suffering reduced globally', 'DoctaRx as universal standard'], forecastNotes: 'The mission achieved — Healthcare for all beings, powered by Syntropy' }
      }
    };

    // Map agent types to keys
    const typeMap = {
      'operations-agent': 'operations',
      'growth-agent': 'growth',
      'revenue-agent': 'revenue',
      'compliance-agent': 'compliance',
      'corporate-agent': 'corporate',
      'governance-agent': 'governance',
      'devops-agent': 'devops',
      'ceo-agent': 'ceo',
      'researcher-agent': 'governance', // Uses governance template
      'economics-agent': 'revenue',     // Uses revenue template
      'physicist-agent': 'devops',      // Uses devops template
      'mathematician-agent': 'devops',  // Uses devops template
      'vortex-math-agent': 'governance' // Uses governance template
    };

    const key = typeMap[agentType] || 'operations';
    return defaults[key] || defaults.operations;
  }
}

module.exports = { GoalEngine, FREQUENCIES, TIMEFRAMES };
