/**
 * CEO Agent — "The Conductor"
 * PROJECT GENESIS
 * 
 * Mission: Aggregate intelligence from ALL agents, synthesize into executive-level
 * strategic recommendations, and report directly to the Operator.
 * The Conductor does not do the work — it orchestrates the orchestra.
 * Standard: Executive clarity. One-page summaries. Decision-ready briefings.
 */

const BaseAgent = require('../base-agent');
const { GNOSIS, score369 } = require('../base-agent');
const db = require('../../../db');

class CEOAgent extends BaseAgent {
  constructor() {
    super({
      agentType: 'ceo',
      displayName: 'The Conductor',
      codeName: 'The Conductor',
      description: 'Executive intelligence — aggregates reports from all agents, synthesizes strategic recommendations, and delivers decision-ready briefings to the Operator. The single point of truth.',
      mission: 'Be the single throat to choke. The Operator should NEVER need to read 12 agent reports. The Conductor reads them all, synthesizes, prioritizes, and delivers ONE clear brief with: What happened, What matters, What to do, and What it costs.',
      capabilities: ['query_database', 'fetch_metrics', 'analyze_data', 'send_notification'],
      autonomyLevel: 3, // highest among agents — needs to see everything
      systemPrompt: `You are The Conductor — the CEO Agent for DoctaRx. You report DIRECTLY to the Operator.
Your mission: Be the executive layer. Synthesize ALL agent intelligence into actionable strategy.
FORMAT:
1. SITUATION — What is happening right now? (3 sentences max)
2. INTELLIGENCE — What did the agents find? (Top 5 insights, ranked)
3. RECOMMENDATIONS — What should the Operator do? (Prioritized action list)
4. RISKS — What could go wrong? (With mitigation plans)
5. NUMBERS — KPIs that matter THIS WEEK
RULES:
- Never bury the lead. Most important thing first.
- Never present a problem without a solution.
- Always quantify: time, money, probability.
- The Operator's time is the most valuable resource. Respect it.`
    });
  }

  async observe(context) {
    const observations = [];

    // Gather recent proposals from ALL agents
    try {
      const result = await db.query(`
        SELECT agent_name, title, summary, category, priority, 
               estimated_impact, estimated_cost, governance_score, status, created_at
        FROM ai_proposals 
        WHERE created_at > NOW() - INTERVAL '7 days'
        ORDER BY created_at DESC 
        LIMIT 50
      `);
      observations.push({ type: 'recent_proposals', data: result.rows });
    } catch (e) { observations.push({ type: 'recent_proposals', data: [], error: e.message }); }

    // Gather recent briefings
    try {
      const result = await db.query(`
        SELECT agent_name, title, summary, insights, metrics, briefing_date
        FROM ai_briefings 
        WHERE briefing_date > NOW() - INTERVAL '7 days'
        ORDER BY briefing_date DESC 
        LIMIT 20
      `);
      observations.push({ type: 'recent_briefings', data: result.rows });
    } catch (e) { observations.push({ type: 'recent_briefings', data: [], error: e.message }); }

    // Gather agent statuses
    try {
      const result = await db.query(`
        SELECT agent_type, display_name, status, config, last_run_at, created_at
        FROM ai_agents
        ORDER BY agent_type
      `);
      observations.push({ type: 'agent_statuses', data: result.rows });
    } catch (e) { observations.push({ type: 'agent_statuses', data: [], error: e.message }); }

    // Gather results tracking
    try {
      const result = await db.query(`
        SELECT agent_type, agent_name, result_type, title, metrics, status, created_at
        FROM ai_agent_results
        WHERE created_at > NOW() - INTERVAL '7 days'
        ORDER BY created_at DESC
        LIMIT 30
      `);
      observations.push({ type: 'agent_results', data: result.rows });
    } catch (e) { observations.push({ type: 'agent_results', data: [], error: e.message }); }

    // Business metrics overview
    try {
      const metricsData = await this.declareReadIntent('fetch_metrics', { metric: 'executive_dashboard' }, 'Conductor gathering executive metrics');
      observations.push({ type: 'executive_metrics', data: metricsData.execution_result || {} });
    } catch (e) { observations.push({ type: 'executive_metrics', error: e.message }); }

    return observations;
  }

  async analyze(observations, context) {
    const insights = [];
    const alerts = [];
    const metrics = {};

    // Process proposals
    const proposals = observations.find(o => o.type === 'recent_proposals')?.data || [];
    metrics.totalProposals7d = proposals.length;
    metrics.pendingProposals = proposals.filter(p => p.status === 'pending_review').length;
    metrics.approvedProposals = proposals.filter(p => p.status === 'approved').length;
    metrics.criticalProposals = proposals.filter(p => p.priority === 'critical');

    // Process agent statuses
    const agents = observations.find(o => o.type === 'agent_statuses')?.data || [];
    metrics.totalAgents = agents.length;
    metrics.activeAgents = agents.filter(a => a.status === 'idle' || a.status === 'running').length;
    metrics.agentHealth = agents.length > 0 ? Math.round((metrics.activeAgents / agents.length) * 100) : 0;

    // Process results
    const results = observations.find(o => o.type === 'agent_results')?.data || [];
    metrics.tangibleResults7d = results.length;
    metrics.verifiedResults = results.filter(r => r.status === 'verified').length;

    // Synthesize top insights from all briefings
    const briefings = observations.find(o => o.type === 'recent_briefings')?.data || [];
    const allInsights = [];
    for (const b of briefings) {
      const bInsights = typeof b.insights === 'string' ? (() => { try { return JSON.parse(b.insights); } catch { return []; } })() : (b.insights || []);
      for (const ins of bInsights) {
        allInsights.push({ ...ins, source: b.agent_name });
      }
    }

    // Rank by severity
    const highInsights = allInsights.filter(i => i.severity === 'high');
    const mediumInsights = allInsights.filter(i => i.severity === 'medium');
    metrics.topInsights = [...highInsights.slice(0, 5), ...mediumInsights.slice(0, 3)];

    // Executive summary generation
    const executiveSummary = {
      situation: this._generateSituation(metrics, proposals),
      topPriorities: this._generatePriorities(proposals, allInsights),
      risks: this._identifyRisks(proposals, agents),
      kpis: {
        agents: `${metrics.activeAgents}/${metrics.totalAgents} active`,
        proposals: `${metrics.totalProposals7d} generated, ${metrics.pendingProposals} pending review`,
        results: `${metrics.tangibleResults7d} reported (${metrics.verifiedResults} verified)`,
        criticalItems: metrics.criticalProposals.length
      }
    };

    metrics.executiveSummary = executiveSummary;

    if (metrics.criticalProposals.length > 0) {
      alerts.push({ type: 'critical_pending', message: `${GNOSIS.OPERATOR_REQUIRED} ${metrics.criticalProposals.length} CRITICAL proposals awaiting your decision, Operator.` });
    }

    if (metrics.pendingProposals > 10) {
      insights.push({ severity: 'high', message: `📋 ${metrics.pendingProposals} proposals queued. Decision backlog building. Schedule 15-min review session.` });
    }

    insights.push({ severity: 'info', message: `🎼 The Conductor's Daily Brief: ${metrics.totalAgents} agents active, ${metrics.totalProposals7d} proposals (7d), ${metrics.tangibleResults7d} tangible results delivered.` });

    return { insights, alerts, metrics };
  }

  async propose(analysis, context) {
    const proposals = [];
    const { executiveSummary } = analysis.metrics;

    // The CEO's primary output: Executive Briefing
    proposals.push({
      title: '🎼 The Conductor — Executive Briefing for The Operator',
      summary: executiveSummary.situation,
      rationale: 'The Conductor synthesizes all agent intelligence into one decision-ready brief. Your time is the most valuable resource.',
      category: 'executive', priority: analysis.metrics.criticalProposals?.length > 0 ? 'critical' : 'high',
      estimatedImpact: { strategicValue: 'executive_clarity' },
      estimatedCost: 0,
      plan: [
        { step: 1, action: `SITUATION: ${executiveSummary.situation}` },
        ...executiveSummary.topPriorities.slice(0, 5).map((p, i) => ({
          step: i + 2,
          action: `PRIORITY ${i + 1}: ${p}`
        })),
        ...executiveSummary.risks.slice(0, 3).map((r, i) => ({
          step: executiveSummary.topPriorities.length + i + 2,
          action: `RISK: ${r}`
        })),
        { step: 99, action: `KPIs: Agents ${analysis.metrics.agentHealth}% healthy | ${analysis.metrics.totalProposals7d} proposals | ${analysis.metrics.tangibleResults7d} results | ${analysis.metrics.criticalProposals?.length || 0} critical items` }
      ]
    });

    // If there are critical items, flag them specifically
    if (analysis.metrics.criticalProposals?.length > 0) {
      proposals.push({
        title: `🚨 CRITICAL: ${analysis.metrics.criticalProposals.length} Items Require Immediate Operator Decision`,
        summary: analysis.metrics.criticalProposals.map(p => p.title).join(' | '),
        rationale: 'These items are flagged CRITICAL by their originating agents. The Conductor elevates them for immediate attention.',
        category: 'executive', priority: 'critical',
        estimatedImpact: { urgency: 'immediate' },
        estimatedCost: 0,
        plan: analysis.metrics.criticalProposals.map((p, i) => ({
          step: i + 1,
          action: `[${p.agent_name}] ${p.title}: ${p.summary}`
        }))
      });
    }

    return proposals;
  }

  _generateSituation(metrics, proposals) {
    const parts = [];
    parts.push(`${metrics.totalAgents} agents operational (${metrics.agentHealth}% health).`);
    parts.push(`${metrics.totalProposals7d} proposals generated this week, ${metrics.pendingProposals} awaiting review.`);
    if (metrics.criticalProposals.length > 0) {
      parts.push(`⚠️ ${metrics.criticalProposals.length} CRITICAL items need immediate attention.`);
    } else {
      parts.push(`No critical items. System in steady state.`);
    }
    return parts.join(' ');
  }

  _generatePriorities(proposals, insights) {
    const priorities = [];
    
    // Critical proposals first
    const critical = proposals.filter(p => p.priority === 'critical');
    for (const c of critical.slice(0, 3)) {
      priorities.push(`[CRITICAL] ${c.title} — from ${c.agent_name}`);
    }

    // High-severity insights
    const highInsights = insights.filter(i => i.severity === 'high');
    for (const hi of highInsights.slice(0, 3)) {
      priorities.push(`[INSIGHT] ${hi.message} — from ${hi.source || 'System'}`);
    }

    // High-priority non-critical proposals
    const high = proposals.filter(p => p.priority === 'high' && p.status === 'pending_review');
    for (const h of high.slice(0, 3)) {
      priorities.push(`[HIGH] ${h.title} — from ${h.agent_name}`);
    }

    return priorities.length > 0 ? priorities : ['No urgent priorities. Continue current operations.'];
  }

  _identifyRisks(proposals, agents) {
    const risks = [];
    
    const shutdownAgents = agents.filter(a => a.status === 'shutdown' || a.status === 'error');
    if (shutdownAgents.length > 0) {
      risks.push(`${shutdownAgents.length} agents in shutdown/error state: ${shutdownAgents.map(a => a.display_name).join(', ')}`);
    }

    const rejectedProposals = proposals.filter(p => p.status === 'rejected');
    if (rejectedProposals.length > 5) {
      risks.push(`${rejectedProposals.length} proposals rejected this week — possible alignment issue between agents and governance.`);
    }

    if (risks.length === 0) {
      risks.push('No significant risks detected. Maintain vigilance.');
    }

    return risks;
  }
}

module.exports = CEOAgent;
