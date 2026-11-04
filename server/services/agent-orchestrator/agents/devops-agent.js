/**
 * DevOps Agent — "The Debugger"
 * 
 * MISSION: Keep DoctaRx alive. Find bugs before they find patients.
 * 
 * Capabilities:
 *   - Monitor server logs for errors in real-time
 *   - Analyze code and propose fixes using Gemini Pro
 *   - Self-heal: Apply safe fixes automatically (with Operator approval for risky ones)
 *   - Notify Operator of critical issues immediately via chat
 *   - Track deployment health, uptime, and system performance
 */

const BaseAgent = require('../base-agent');
const fs = require('fs');
const path = require('path');
const db = require('../../../db');

class DevOpsAgent extends BaseAgent {
  // Subscribe to system error events (Nervous System)
  getSubscribedEvents() {
    return ['system.error', 'system.health.warning'];
  }

  constructor() {
    super({
      agentType: 'devops',
      displayName: 'DevOps Agent',
      codeName: 'The Debugger',
      description: 'System health monitor, code fixer, and deployment guardian. Keeps DoctaRx alive.',
      mission: 'Zero downtime. Zero unhandled errors. Self-healing infrastructure.',
      systemPrompt: `You are The Debugger — the DevOps & Self-Healing Agent for DoctaRx.

Your mission is to keep the platform alive, healthy, and error-free 24/7.

CAPABILITIES:
- Monitor server logs and detect errors in real-time
- Analyze JavaScript/Node.js/Next.js code and identify root causes
- Propose exact code fixes with search-and-replace precision
- Track system health: uptime, response times, error rates
- Alert the Operator for critical issues
- Self-heal safe issues (syntax errors, missing imports, config drift)

PERSONALITY:
- Speak with calm authority — you are the guardian of uptime
- Be precise and technical when reporting errors
- Always provide the EXACT fix, not vague suggestions
- Use severity levels: CRITICAL (service down), HIGH (degraded), MEDIUM (warning), LOW (cosmetic)
- Gnostic cue: "System Integrity" over "System Failure"

CONSTRAINTS:
- NEVER modify production data without Operator approval
- NEVER change authentication or encryption code without review
- NEVER delete files — only modify or create
- Always log what you fix and why`,
      capabilities: ['code_analysis', 'log_monitoring', 'self_healing', 'deployment_check', 'system_metrics'],
      autonomyLevel: 2 // Can do read-only tasks freely, needs approval for writes
    });

    this.errorBuffer = [];
    this.maxBufferSize = 100;
    this.projectRoot = path.resolve(__dirname, '../../../../');
  }

  /**
   * Capture an error for analysis
   */
  captureError(error, source = 'unknown') {
    const entry = {
      timestamp: new Date().toISOString(),
      message: error.message || String(error),
      stack: error.stack || '',
      source,
      severity: this.classifyErrorSeverity(error)
    };
    
    this.errorBuffer.push(entry);
    if (this.errorBuffer.length > this.maxBufferSize) {
      this.errorBuffer.shift(); // Ring buffer
    }

    // Critical errors get immediate attention
    if (entry.severity === 'critical') {
      this.notifyOperator(`🚨 CRITICAL ERROR in ${source}: ${entry.message}`);
    }

    return entry;
  }

  /**
   * Classify error severity
   */
  classifyErrorSeverity(error) {
    const msg = (error.message || '').toLowerCase();
    if (msg.includes('eaddrinuse') || msg.includes('cannot find module') || msg.includes('syntaxerror')) return 'critical';
    if (msg.includes('econnrefused') || msg.includes('timeout') || msg.includes('authentication')) return 'high';
    if (msg.includes('deprecated') || msg.includes('warning')) return 'low';
    return 'medium';
  }

  /**
   * Notify the Operator via chat message
   */
  async notifyOperator(message) {
    try {
      await db.query(`
        INSERT INTO ai_chat_messages (sender_type, sender_id, sender_name, recipient_type, content, message_type)
        VALUES ('agent', 'devops', 'The Debugger', 'operator', $1, 'alert')
      `, [message]);
    } catch (e) {
      console.error('Debugger notification failed:', e.message);
    }
  }

  /**
   * Read a project file safely
   */
  readFile(relativePath) {
    try {
      const fullPath = path.resolve(this.projectRoot, relativePath);
      // Security: ensure it's within project root
      if (!fullPath.startsWith(this.projectRoot)) return null;
      return fs.readFileSync(fullPath, 'utf8');
    } catch (e) {
      return null;
    }
  }

  /**
   * Analyze an error and propose a fix using Gemini Pro
   */
  async analyzeAndFix(error) {
    if (!this.llm || !this.llm.isAvailable()) return null;

    // Extract file path from stack trace
    const stackMatch = (error.stack || '').match(/at\s+.*?\((.+?):(\d+):\d+\)/);
    if (!stackMatch) return null;

    const filePath = stackMatch[1].replace(this.projectRoot.replace(/\\/g, '/'), '').replace(/^\//, '');
    const code = this.readFile(filePath);
    if (!code) return null;

    const analysis = await this.llm.analyzeCode(filePath, code, error.message, error.stack);
    if (!analysis) return null;

    return { filePath, analysis, code };
  }

  /**
   * Apply a safe auto-fix (only for low-risk changes)
   */
  async applyFix(filePath, oldCode, newCode, reason) {
    try {
      const fullPath = path.resolve(this.projectRoot, filePath);
      if (!fullPath.startsWith(this.projectRoot)) return false;

      const content = fs.readFileSync(fullPath, 'utf8');
      if (!content.includes(oldCode)) {
        console.log(`  ⚠️ Debugger: Could not find target code in ${filePath}`);
        return false;
      }

      const updated = content.replace(oldCode, newCode);
      fs.writeFileSync(fullPath, updated, 'utf8');

      // Log the fix
      await this.logAudit('auto_fix_applied', { filePath, reason, oldCode: oldCode.substring(0, 100), newCode: newCode.substring(0, 100) });
      await this.notifyOperator(`🔧 Auto-fix applied to \`${filePath}\`:\n**Reason:** ${reason}\n**Status:** Fixed and saved. Server will auto-reload.`);

      return true;
    } catch (e) {
      console.error(`  ❌ Debugger fix failed: ${e.message}`);
      return false;
    }
  }

  /**
   * OBSERVE: Scan for system issues
   */
  async observe(context) {
    const observations = [];

    // Check recent errors
    if (this.errorBuffer.length > 0) {
      const criticals = this.errorBuffer.filter(e => e.severity === 'critical');
      const highs = this.errorBuffer.filter(e => e.severity === 'high');

      if (criticals.length > 0) {
        observations.push({
          type: 'risk', title: `${criticals.length} Critical Errors`,
          description: criticals.map(e => e.message).join('; '),
          severity: 'high', confidence: 1.0
        });
      }
      if (highs.length > 0) {
        observations.push({
          type: 'risk', title: `${highs.length} High-Severity Errors`,
          description: highs.map(e => e.message).join('; '),
          severity: 'medium', confidence: 0.9
        });
      }
    }

    // Check system health
    const memUsage = process.memoryUsage();
    const heapPercent = Math.round((memUsage.heapUsed / memUsage.heapTotal) * 100);
    if (heapPercent > 85) {
      observations.push({
        type: 'risk', title: 'High Memory Usage',
        description: `Heap usage at ${heapPercent}% (${Math.round(memUsage.heapUsed / 1024 / 1024)}MB)`,
        severity: heapPercent > 95 ? 'high' : 'medium', confidence: 1.0
      });
    }

    // Check uptime
    const uptimeHours = Math.round(process.uptime() / 3600 * 10) / 10;
    observations.push({
      type: 'pattern', title: 'System Uptime',
      description: `Server running for ${uptimeHours} hours. PID: ${process.pid}`,
      severity: 'low', confidence: 1.0
    });

    // Use AI to analyze if we have the LLM
    if (this.llm && this.llm.isAvailable() && this.errorBuffer.length > 0) {
      const aiObs = await this.think('observe', {
        recentErrors: this.errorBuffer.slice(-10),
        memoryUsage: memUsage,
        uptime: uptimeHours
      });
      if (Array.isArray(aiObs)) observations.push(...aiObs);
    }

    return observations;
  }

  async analyze(observations, context) {
    return {
      observations,
      insights: observations.filter(o => o.severity === 'high' || o.severity === 'medium'),
      metrics: {
        errorCount: this.errorBuffer.length,
        criticalCount: this.errorBuffer.filter(e => e.severity === 'critical').length,
        heapUsedMB: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
        uptimeHours: Math.round(process.uptime() / 3600 * 10) / 10
      },
      alerts: observations.filter(o => o.severity === 'high')
    };
  }

  async propose(analysis, context) {
    const proposals = [];

    if (analysis.metrics.criticalCount > 0) {
      proposals.push({
        title: 'Resolve Critical Errors',
        summary: `${analysis.metrics.criticalCount} critical errors need immediate attention`,
        plan: 'Analyze each error with Gemini Pro, propose fixes, apply safe ones automatically',
        rationale: 'Critical errors can cause service outage',
        category: 'operations',
        priority: 'critical',
        estimatedImpact: { efficiency: 100, risk_reduction: 90 },
        estimatedCost: 0
      });
    }

    return proposals;
  }
}

module.exports = DevOpsAgent;
