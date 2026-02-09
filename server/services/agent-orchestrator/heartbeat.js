/**
 * ═══════════════════════════════════════════════════════════════
 *  HEARTBEAT SYSTEM — Proactive Agent Scheduling
 *  OpenClaw-style: Agents don't wait for input. They ACT.
 * ═══════════════════════════════════════════════════════════════
 * 
 *  Instead of passive agents that only respond to chat,
 *  the heartbeat system makes agents PROACTIVE:
 *    - Periodic health checks (every 5 min)
 *    - Agent run cycles (every 6 hours)
 *    - Error monitoring (every 60 seconds)
 *    - Operator notifications for anything important
 *    - Self-healing when safe
 * ═══════════════════════════════════════════════════════════════
 */

const db = require('../../db');

class HeartbeatSystem {
  constructor(orchestrator, geminiLLM) {
    this.orchestrator = orchestrator;
    this.llm = geminiLLM;
    this.timers = [];
    this.isRunning = false;
    this.lastHealthCheck = null;
    this.lastAgentCycle = null;
    this.errorCount = 0;
    this.startedAt = null;
  }

  /**
   * Start the heartbeat system
   */
  start() {
    if (this.isRunning) return;
    this.isRunning = true;
    this.startedAt = new Date();

    console.log('  💓 Heartbeat System: ACTIVE');
    console.log('    ├─ Health check: every 5 min');
    console.log('    ├─ Error monitor: every 60s');
    console.log('    └─ Agent cycle: every 6 hours');

    // Error monitor — every 60 seconds
    this.timers.push(setInterval(() => this.errorCheck(), 60 * 1000));

    // Health check — every 5 minutes
    this.timers.push(setInterval(() => this.healthCheck(), 5 * 60 * 1000));

    // Agent proactive cycle — every 6 hours
    this.timers.push(setInterval(() => this.agentCycle(), 6 * 60 * 60 * 1000));

    // Initial health check after 30 seconds
    setTimeout(() => this.healthCheck(), 30 * 1000);
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
      // Check for recent errors in audit log
      const result = await db.query(`
        SELECT COUNT(*) as count FROM ai_audit_log 
        WHERE action_type LIKE '%error%' OR action_type LIKE '%failed%'
        AND created_at > NOW() - INTERVAL '5 minutes'
      `);
      
      const recentErrors = parseInt(result.rows[0].count);
      if (recentErrors > this.errorCount + 5) {
        // Spike in errors — notify operator
        await this.notifyOperator(
          `⚠️ **Error Spike Detected** — ${recentErrors - this.errorCount} new errors in the last 5 minutes. The Debugger is investigating.`
        );
      }
      this.errorCount = recentErrors;
    } catch (e) {
      // Database might be down — that's an error itself
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

      // If LLM is available, do AI-powered analysis
      if (this.llm && this.llm.isAvailable() && (systemStatus.heapPercent > 80 || !dbHealthy)) {
        const analysis = await this.llm.heartbeatAnalysis(systemStatus, [], systemStatus);
        if (analysis && analysis.notifyOperator) {
          await this.notifyOperator(analysis.notifyMessage || 'System health issue detected.');
        }
      }

      // Critical: DB down
      if (!dbHealthy) {
        await this.notifyOperator('🚨 **DATABASE CONNECTION LOST** — DoctaRx cannot serve patients. Immediate action required.');
      }

    } catch (e) {
      console.error('Heartbeat health check error:', e.message);
    }
  }

  /**
   * Agent proactive cycle — run all agents
   */
  async agentCycle() {
    if (!this.orchestrator || !this.orchestrator.initialized) return;

    try {
      console.log('\n💓 Heartbeat: Starting proactive agent cycle...');
      this.lastAgentCycle = new Date();

      await this.notifyOperator(
        '💓 **Proactive Heartbeat** — Starting scheduled agent analysis cycle. Results will be posted when complete.'
      );

      const results = await this.orchestrator.runAllAgents({
        trigger: 'heartbeat',
        timestamp: new Date().toISOString()
      });

      // Count proposals generated
      const totalProposals = Object.values(results).reduce(
        (sum, r) => sum + (r.proposalCount || 0), 0
      );

      if (totalProposals > 0) {
        await this.notifyOperator(
          `💓 **Heartbeat Cycle Complete** — ${totalProposals} new proposals generated. Check the Proposals tab in AI Ops Portal.`
        );
      }
    } catch (e) {
      console.error('Heartbeat agent cycle error:', e.message);
    }
  }

  /**
   * Notify Operator via chat
   */
  async notifyOperator(message) {
    try {
      await db.query(`
        INSERT INTO ai_chat_messages (sender_type, sender_id, sender_name, recipient_type, content, message_type)
        VALUES ('system', 'heartbeat', '💓 Heartbeat', 'operator', $1, 'alert')
      `, [message]);
    } catch (e) {
      // Can't notify — log to console
      console.error(`💓 Heartbeat notification (console fallback): ${message}`);
    }
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
      uptime: this.startedAt ? Math.round((Date.now() - this.startedAt.getTime()) / 1000) : 0
    };
  }
}

module.exports = HeartbeatSystem;
