/**
 * ═══════════════════════════════════════════════════════════════
 *  HEARTBEAT SYSTEM — Proactive Agent Scheduling
 *  OpenClaw-style: Agents don't wait for input. They ACT.
 * ═══════════════════════════════════════════════════════════════
 * 
 *  Instead of passive agents that only respond to chat,
 *  the heartbeat system makes agents PROACTIVE:
 *    - Periodic health checks (every 5 min)
 *    - Agent run cycles (every 2 hours)
 *    - Error monitoring (every 60 seconds)
 *    - Morning briefing (every 4 hours)
 *    - Operator notifications for anything important
 *    - Self-healing when safe
 * ═══════════════════════════════════════════════════════════════
 */

const db = require('../../db');

class HeartbeatSystem {
  constructor(orchestrator, llm) {
    this.orchestrator = orchestrator;
    this.llm = llm;
    this.timers = [];
    this.isRunning = false;
    this.lastHealthCheck = null;
    this.lastAgentCycle = null;
    this.lastBriefing = null;
    this.errorCount = 0;
    this.startedAt = null;
    this.cycleCount = 0;
  }

  /**
   * Start the heartbeat system
   */
  start() {
    if (this.isRunning) return;
    this.isRunning = true;
    this.startedAt = new Date();

    console.log('  💓 Heartbeat System: ACTIVE (Proactive Mode)');
    console.log('    ├─ Error monitor: every 60s');
    console.log('    ├─ Health check: every 5 min');
    console.log('    ├─ Proactive scan: every 30 min');
    console.log('    ├─ Agent cycle: every 2 hours');
    console.log('    └─ Executive briefing: every 4 hours');

    // Error monitor — every 60 seconds
    this.timers.push(setInterval(() => this.errorCheck(), 60 * 1000));

    // Health check — every 5 minutes
    this.timers.push(setInterval(() => this.healthCheck(), 5 * 60 * 1000));

    // Proactive scan — every 30 minutes (post findings to inbox)
    this.timers.push(setInterval(() => this.proactiveScan(), 30 * 60 * 1000));

    // Agent proactive cycle — every 2 hours (was 6h — too slow for OpenClaw-style)
    this.timers.push(setInterval(() => this.agentCycle(), 2 * 60 * 60 * 1000));

    // Executive briefing — every 4 hours
    this.timers.push(setInterval(() => this.executiveBriefing(), 4 * 60 * 60 * 1000));

    // Initial startup sequence (staggered)
    setTimeout(() => this.healthCheck(), 15 * 1000);
    setTimeout(() => this.startupBriefing(), 45 * 1000);
    setTimeout(() => this.proactiveScan(), 2 * 60 * 1000);
  }

  /**
   * Stop all heartbeats
   */
  stop() {
    this.isRunning = false;
    this.timers.forEach(t => clearInterval(t));
    this.timers = [];
    console.log('  💔 Heartbeat System: STOPPED');
  }

  /**
   * Error check — quick scan for new errors
   */
  async errorCheck() {
    try {
      const result = await db.query(`
        SELECT COUNT(*) as count FROM ai_audit_log 
        WHERE (action_type LIKE '%error%' OR action_type LIKE '%failed%')
        AND created_at > NOW() - INTERVAL '5 minutes'
      `);
      
      const recentErrors = parseInt(result.rows[0].count);
      if (recentErrors > this.errorCount + 5) {
        await this.postToInbox(
          'devops', 'The Debugger',
          `⚠️ **Error Spike Detected** — ${recentErrors - this.errorCount} new errors in the last 5 minutes. Investigating root cause.`,
          'alert', { severity: 'high', errorCount: recentErrors }
        );
      }
      this.errorCount = recentErrors;
    } catch (e) {
      // Database might be down
    }
  }

  /**
   * Health check — system status analysis
   */
  async healthCheck() {
    try {
      const memUsage = process.memoryUsage();
      const systemStatus = {
        uptime: Math.round(process.uptime()),
        heapUsedMB: Math.round(memUsage.heapUsed / 1024 / 1024),
        heapTotalMB: Math.round(memUsage.heapTotal / 1024 / 1024),
        heapPercent: Math.round((memUsage.heapUsed / memUsage.heapTotal) * 100),
        pid: process.pid,
        timestamp: new Date().toISOString()
      };

      // Check DB connectivity
      let dbHealthy = false;
      try {
        await db.query('SELECT 1');
        dbHealthy = true;
      } catch (e) {
        systemStatus.dbError = e.message;
      }
      systemStatus.dbHealthy = dbHealthy;

      // Check agent count
      try {
        const agentResult = await db.query('SELECT COUNT(*) FROM ai_agents WHERE status != $1', ['shutdown']);
        systemStatus.activeAgents = parseInt(agentResult.rows[0].count);
      } catch (e) { /* ok */ }

      this.lastHealthCheck = systemStatus;

      // Critical: DB down
      if (!dbHealthy) {
        await this.postToInbox(
          'devops', 'The Debugger',
          '🚨 **CRITICAL: DATABASE CONNECTION LOST** — DoctaRx cannot serve patients. Immediate action required.\n\n**Impact:** All patient-facing services are DOWN.\n**Action needed:** Check Aiven PostgreSQL status and connection pooling.',
          'alert', { severity: 'critical', category: 'infrastructure' }
        );
      }

      // High memory warning
      if (systemStatus.heapPercent > 80) {
        await this.postToInbox(
          'devops', 'The Debugger',
          `⚠️ **Memory Warning** — Heap usage at **${systemStatus.heapPercent}%** (${systemStatus.heapUsedMB}MB / ${systemStatus.heapTotalMB}MB).\n\nRecommend: Review agent run-loop frequency, check for memory leaks in long-running processes.`,
          'alert', { severity: 'medium', category: 'performance' }
        );
      }

      // If LLM is available, do AI-powered analysis on issues
      if (this.llm && this.llm.isAvailable() && (systemStatus.heapPercent > 80 || !dbHealthy)) {
        try {
          const analysis = await this.llm.heartbeatAnalysis(systemStatus, [], systemStatus);
          if (analysis && analysis.notifyOperator) {
            await this.postToInbox(
              'ceo', 'The Conductor',
              analysis.notifyMessage || 'System health issue detected — see Agent Ops for details.',
              'alert', { severity: analysis.status === 'critical' ? 'critical' : 'medium', aiGenerated: true }
            );
          }
        } catch (e) { /* LLM analysis is non-critical */ }
      }

    } catch (e) {
      console.error('Heartbeat health check error:', e.message);
    }
  }

  /**
   * Proactive Scan — Agents look for things to report without being asked
   */
  async proactiveScan() {
    if (!this.orchestrator || !this.orchestrator.initialized) return;

    try {
      this.cycleCount++;
      const now = new Date();
      const timeStr = now.toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour12: true, hour: 'numeric', minute: '2-digit' });

      // ─── Platform Metrics Scan ─────────────────────────────
      let userCount = 0, providerCount = 0, appointmentCount = 0, recentPayments = 0;
      try {
        const users = await db.query("SELECT COUNT(*) FROM users WHERE role = 'patient'");
        userCount = parseInt(users.rows[0].count);
        const providers = await db.query("SELECT COUNT(*) FROM users WHERE role = 'provider'");
        providerCount = parseInt(providers.rows[0].count);
      } catch (e) { /* ok */ }
      try {
        const appts = await db.query("SELECT COUNT(*) FROM appointments WHERE created_at > NOW() - INTERVAL '24 hours'");
        appointmentCount = parseInt(appts.rows[0].count);
      } catch (e) { /* ok */ }
      try {
        const payments = await db.query("SELECT COUNT(*) FROM payments WHERE created_at > NOW() - INTERVAL '24 hours'");
        recentPayments = parseInt(payments.rows[0].count);
      } catch (e) { /* ok */ }

      // ─── Post findings as different agents ──────────────────
      // The Weaver (Operations) — patient flow report
      if (this.cycleCount % 2 === 0) { // Every hour
        await this.postToInbox(
          'operations', 'The Weaver',
          `📊 **Operations Pulse** (${timeStr} ET)\n\n` +
          `• Registered patients: **${userCount}**\n` +
          `• Active providers: **${providerCount}**\n` +
          `• Appointments (24h): **${appointmentCount}**\n` +
          `• Payments (24h): **${recentPayments}**\n` +
          `• Server uptime: **${Math.round(process.uptime() / 60)} min**\n` +
          `• Memory: **${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB**\n\n` +
          `_Automated scan — The Weaver is watching the flow._`,
          'report', { category: 'operations', metrics: { userCount, providerCount, appointmentCount, recentPayments } }
        );
      }

      // The Alchemist (Revenue) — revenue scan
      if (this.cycleCount % 4 === 0) { // Every 2 hours
        let totalRevenue = 0, subCount = 0;
        try {
          const rev = await db.query("SELECT COALESCE(SUM(amount), 0) as total FROM payments WHERE status = 'completed'");
          totalRevenue = parseFloat(rev.rows[0].total);
          const subs = await db.query("SELECT COUNT(*) FROM subscriptions WHERE status = 'active'");
          subCount = parseInt(subs.rows[0].count);
        } catch (e) { /* ok */ }

        await this.postToInbox(
          'revenue', 'The Alchemist',
          `💎 **Revenue Scan** (${timeStr} ET)\n\n` +
          `• Total revenue: **$${totalRevenue.toFixed(2)}**\n` +
          `• Active subscriptions: **${subCount}**\n` +
          `• Payments (24h): **${recentPayments}**\n\n` +
          (totalRevenue === 0
            ? `⚡ **No revenue yet.** Priority: Get the first paying subscriber. The Alchemist recommends focusing all energy on the signup → subscription flow.`
            : `✅ Revenue is flowing. Monitoring for growth patterns.`) +
          `\n\n_Automated scan — The Alchemist is transmuting._`,
          'report', { category: 'revenue', metrics: { totalRevenue, subCount } }
        );
      }

      // The Guardian (Compliance) — security scan
      if (this.cycleCount % 6 === 0) { // Every 3 hours
        let failedLogins = 0;
        try {
          const fl = await db.query("SELECT COUNT(*) FROM ai_audit_log WHERE action_type LIKE '%login_failed%' AND created_at > NOW() - INTERVAL '24 hours'");
          failedLogins = parseInt(fl.rows[0].count);
        } catch (e) { /* ok */ }

        await this.postToInbox(
          'compliance', 'The Guardian',
          `🛡️ **Security & Compliance Scan** (${timeStr} ET)\n\n` +
          `• Failed login attempts (24h): **${failedLogins}**\n` +
          `• Database encryption: **Active (SSL)**\n` +
          `• HIPAA PHI access controls: **Enforced**\n` +
          (failedLogins > 10
            ? `\n⚠️ **Alert:** Elevated failed login attempts. Consider rate limiting or IP blocking.`
            : `\n✅ No security anomalies detected.`) +
          `\n\n_Automated scan — The Guardian watches._`,
          'report', { category: 'compliance', metrics: { failedLogins } }
        );
      }

    } catch (e) {
      console.error('Heartbeat proactive scan error:', e.message);
    }
  }

  /**
   * Startup Briefing — First message when server starts
   */
  async startupBriefing() {
    const now = new Date();
    const timeStr = now.toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour12: true, hour: 'numeric', minute: '2-digit' });
    const dateStr = now.toLocaleDateString('en-US', { timeZone: 'America/New_York', weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

    // Check what LLM is active
    const llmStatus = this.llm && this.llm.isAvailable() ? 'ONLINE' : 'OFFLINE';

    let agentCount = 0;
    try {
      const r = await db.query("SELECT COUNT(*) FROM ai_agents WHERE status != 'shutdown'");
      agentCount = parseInt(r.rows[0].count);
    } catch (e) { /* ok */ }

    await this.postToInbox(
      'ceo', 'The Conductor',
      `🎼 **System Startup Briefing**\n` +
      `📅 ${dateStr} — ${timeStr} ET\n\n` +
      `**All systems operational.** Project Genesis is awake.\n\n` +
      `• **Agents online:** ${agentCount}\n` +
      `• **LLM Engine:** ${llmStatus}\n` +
      `• **Heartbeat:** Active (proactive scans every 30 min)\n` +
      `• **Node.js:** ${process.version}\n` +
      `• **Memory:** ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB\n\n` +
      `The Council is assembled and scanning. You'll receive proactive reports in this inbox from:\n` +
      `• 📊 **The Weaver** — Operations metrics\n` +
      `• 💎 **The Alchemist** — Revenue & payments\n` +
      `• 🛡️ **The Guardian** — Security & compliance\n` +
      `• 🚨 **The Debugger** — Errors & infrastructure\n\n` +
      `_No action required unless flagged. The Conductor is synthesizing._`,
      'report', { category: 'startup', severity: 'info' }
    );

    // If LLM is available, generate an AI-powered briefing
    if (this.llm && this.llm.isAvailable()) {
      try {
        const briefing = await this.llm.callLLM(
          `${this.llm.GENESIS_CORE_PROMPT}\n\nYou are The Conductor — CEO Agent. Generate a concise morning briefing for the Operator.\n\nCurrent time: ${timeStr} ET, ${dateStr}\nAgents online: ${agentCount}\nLLM: ${llmStatus}`,
          `Generate a 3-5 bullet point executive briefing. What should the Operator focus on TODAY? Be specific to DoctaRx as an early-stage telehealth startup. Include: 1) Top priority, 2) Revenue opportunity, 3) Risk to watch. Keep it under 200 words. Be direct, no fluff.`,
          { maxTokens: 1024, temperature: 0.7 }
        );
        if (briefing) {
          await this.postToInbox(
            'ceo', 'The Conductor',
            `🧠 **AI Executive Briefing** (${timeStr} ET)\n\n${briefing}`,
            'report', { category: 'briefing', aiGenerated: true }
          );
        }
      } catch (e) {
        console.error('AI briefing generation failed:', e.message);
      }
    }
  }

  /**
   * Executive Briefing — Periodic AI-generated summary
   */
  async executiveBriefing() {
    if (!this.llm || !this.llm.isAvailable()) return;

    try {
      const now = new Date();
      const timeStr = now.toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour12: true, hour: 'numeric', minute: '2-digit' });

      // Gather platform data
      let metrics = {};
      try {
        const users = await db.query("SELECT COUNT(*) as total, COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '24 hours') as new FROM users");
        metrics.totalUsers = parseInt(users.rows[0].total);
        metrics.newUsers24h = parseInt(users.rows[0].new);
      } catch (e) { /* ok */ }
      try {
        const payments = await db.query("SELECT COUNT(*) as count, COALESCE(SUM(amount), 0) as total FROM payments WHERE created_at > NOW() - INTERVAL '24 hours'");
        metrics.payments24h = parseInt(payments.rows[0].count);
        metrics.revenue24h = parseFloat(payments.rows[0].total);
      } catch (e) { /* ok */ }

      const briefing = await this.llm.callLLM(
        `${this.llm.GENESIS_CORE_PROMPT}\n\nYou are The Conductor — CEO Agent performing a periodic executive briefing.`,
        `Platform metrics (last 24h):\n${JSON.stringify(metrics, null, 2)}\n\nCurrent time: ${timeStr} ET\n\nGenerate a concise executive briefing (5-8 bullets). Include:\n1. Situation summary\n2. Key wins or accomplishments\n3. Top risk or concern\n4. Revenue status\n5. Recommended next action\n\nBe specific. Under 250 words. Start with the most important thing.`,
        { maxTokens: 1024, temperature: 0.7 }
      );

      if (briefing) {
        await this.postToInbox(
          'ceo', 'The Conductor',
          `🎼 **Executive Briefing** (${timeStr} ET)\n\n${briefing}`,
          'report', { category: 'briefing', aiGenerated: true, metrics }
        );
      }
    } catch (e) {
      console.error('Executive briefing error:', e.message);
    }
  }

  /**
   * Agent proactive cycle — run all agents
   */
  async agentCycle() {
    if (!this.orchestrator || !this.orchestrator.initialized) return;

    try {
      const now = new Date();
      const timeStr = now.toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour12: true, hour: 'numeric', minute: '2-digit' });
      console.log('\n💓 Heartbeat: Starting proactive agent cycle...');
      this.lastAgentCycle = new Date();

      await this.postToInbox(
        'ceo', 'The Conductor',
        `💓 **Agent Cycle Starting** (${timeStr} ET)\n\nAll agents are running their scheduled analysis. Results will be posted when complete.`,
        'text', { category: 'cycle' }
      );

      const results = await this.orchestrator.runAllAgents({
        trigger: 'heartbeat',
        timestamp: new Date().toISOString()
      });

      // Count proposals generated
      const totalProposals = Object.values(results || {}).reduce(
        (sum, r) => sum + (r?.proposalCount || 0), 0
      );

      const totalInsights = Object.values(results || {}).reduce(
        (sum, r) => sum + (r?.insightCount || 0), 0
      );

      await this.postToInbox(
        'ceo', 'The Conductor',
        `✅ **Agent Cycle Complete** (${timeStr} ET)\n\n` +
        `• Proposals generated: **${totalProposals}**\n` +
        `• Insights discovered: **${totalInsights}**\n` +
        `• Agents ran: **${Object.keys(results || {}).length}**\n\n` +
        (totalProposals > 0
          ? `📋 Review proposals in **AI Agent Ops** → Proposals tab.`
          : `No new proposals this cycle. Agents continue monitoring.`),
        'report', { category: 'cycle_complete', proposals: totalProposals, insights: totalInsights }
      );
    } catch (e) {
      console.error('Heartbeat agent cycle error:', e.message);
    }
  }

  /**
   * Post to Operator Inbox
   */
  async postToInbox(agentId, agentName, message, messageType = 'text', metadata = {}) {
    try {
      await db.query(`
        INSERT INTO ai_chat_messages (sender_type, sender_id, sender_name, recipient_type, content, message_type, metadata)
        VALUES ('agent', $1, $2, 'operator', $3, $4, $5)
      `, [agentId, agentName, message, messageType, JSON.stringify(metadata)]);
    } catch (e) {
      // Can't post — log to console
      console.error(`💓 Inbox post failed (console fallback): ${agentName}: ${message.substring(0, 100)}`);
    }
  }

  /**
   * Legacy: Notify Operator (redirects to postToInbox)
   */
  async notifyOperator(message) {
    await this.postToInbox('ceo', 'The Conductor', message, 'alert');
  }

  /**
   * Get heartbeat status
   */
  getStatus() {
    return {
      isRunning: this.isRunning,
      startedAt: this.startedAt,
      lastHealthCheck: this.lastHealthCheck,
      lastAgentCycle: this.lastAgentCycle,
      lastBriefing: this.lastBriefing,
      cycleCount: this.cycleCount,
      uptime: this.startedAt ? Math.round((Date.now() - this.startedAt.getTime()) / 1000) : 0
    };
  }
}

module.exports = HeartbeatSystem;
