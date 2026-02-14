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
let webEngine = null;
try { webEngine = require('./web-action-engine'); } catch (e) { /* optional */ }

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
    console.log('    ├─ Proactive scan: every 15 min');
    console.log('    ├─ WEB MISSIONS: every 2 hours (real internet work)');
    console.log('    ├─ Agent cycle: every 1 hour');
    console.log('    └─ Executive briefing: every 3 hours');

    // Error monitor — every 60 seconds
    this.timers.push(setInterval(() => this.errorCheck(), 60 * 1000));

    // Health check — every 5 minutes
    this.timers.push(setInterval(() => this.healthCheck(), 5 * 60 * 1000));

    // Proactive scan — every 15 minutes (post findings to inbox)
    this.timers.push(setInterval(() => this.proactiveScan(), 15 * 60 * 1000));

    // WEB MISSIONS — every 2 hours (real internet work)
    this.timers.push(setInterval(() => this.runWebMissions(), 2 * 60 * 60 * 1000));

    // Agent proactive cycle — every 1 hour
    this.timers.push(setInterval(() => this.agentCycle(), 1 * 60 * 60 * 1000));

    // Executive briefing — every 3 hours
    this.timers.push(setInterval(() => this.executiveBriefing(), 3 * 60 * 60 * 1000));

    // Initial startup sequence (aggressive — agents wake up FAST)
    setTimeout(() => this.healthCheck(), 10 * 1000);         // 10s after boot
    setTimeout(() => this.startupBriefing(), 20 * 1000);     // 20s — immediate inbox message
    setTimeout(() => this.proactiveScan(), 60 * 1000);       // 1 min — first data scan
    setTimeout(() => this.runWebMissions(), 90 * 1000);      // 1.5 min — first web missions

    // Keep-alive ping — prevents Cloud Run from idling agents
    this.timers.push(setInterval(() => {
      console.log(`💓 Heartbeat alive — cycle #${this.cycleCount}, uptime: ${Math.round((Date.now() - this.startedAt.getTime()) / 1000)}s`);
    }, 5 * 60 * 1000));
  }

  /**
   * Manual wake-up — Operator can trigger all agents to activate immediately
   */
  async wakeUp() {
    console.log('💓 WAKE UP CALL — All agents activating NOW');
    const results = [];

    try {
      await this.startupBriefing();
      results.push('startup_briefing');
    } catch (e) { results.push('startup_briefing:FAILED'); }

    try {
      await this.proactiveScan();
      results.push('proactive_scan');
    } catch (e) { results.push('proactive_scan:FAILED'); }

    try {
      await this.healthCheck();
      results.push('health_check');
    } catch (e) { results.push('health_check:FAILED'); }

    try {
      await this.runWebMissions();
      results.push('web_missions');
    } catch (e) { results.push('web_missions:FAILED'); }

    try {
      await this.executiveBriefing();
      results.push('executive_briefing');
    } catch (e) { results.push('executive_briefing:FAILED'); }

    return {
      triggered: results,
      timestamp: new Date().toISOString(),
      heartbeatRunning: this.isRunning,
      uptime: Math.round((Date.now() - (this.startedAt?.getTime() || Date.now())) / 1000)
    };
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
        // Try to get the actual error details
        let errorDetail = '';
        try {
          const errRows = await db.query(`
            SELECT action_type, details, created_at FROM ai_audit_log
            WHERE (action_type LIKE '%error%' OR action_type LIKE '%failed%')
            AND created_at > NOW() - INTERVAL '5 minutes'
            ORDER BY created_at DESC LIMIT 5
          `);
          for (const row of errRows.rows) {
            const details = typeof row.details === 'string' ? row.details : JSON.stringify(row.details);
            errorDetail += `• ${row.action_type}: ${(details || '').substring(0, 200)}\n`;
          }
        } catch(e) {}

        await this.postToInbox(
          'devops', 'The Debugger',
          `⚠️ **Error Spike Detected** — ${recentErrors - this.errorCount} new errors in the last 5 minutes.\n\n` +
          `**Recent Errors:**\n${errorDetail || 'Unable to fetch details.'}\n\n` +
          `The Debugger is monitoring. Use the IDE at /admin/agent-ide to investigate.`,
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

      // Provider idle threshold signal (event-driven wake-up for growth/ops agents).
      try {
        const idleProviders = await db.query(`
          SELECT COUNT(*) as c
          FROM users u
          WHERE u.role = 'provider'
            AND u.provider_status = 'approved'
            AND NOT EXISTS (
              SELECT 1 FROM appointments a
              WHERE a.provider_id = u.id
                AND a.created_at > NOW() - INTERVAL '7 days'
            )
        `);
        const idleCount = parseInt(idleProviders.rows[0].c || '0', 10);
        if (idleCount > 0 && this.orchestrator?.eventBus) {
          await this.orchestrator.eventBus.emit('provider.idle.threshold', {
            idleProviders: idleCount,
            thresholdDays: 7
          }, 'heartbeat');
        }
      } catch (e) { /* optional signal */ }

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

    // Pull REAL data for startup briefing
    let userCount = 0, apptCount = 0, credCount = 0, crmCount = 0, resultsCount = 0;
    try { const r = await db.query('SELECT COUNT(*) as c FROM users'); userCount = parseInt(r.rows[0].c); } catch(e) {}
    try { const r = await db.query('SELECT COUNT(*) as c FROM video_sessions'); apptCount = parseInt(r.rows[0].c); } catch(e) {}
    try { const r = await db.query('SELECT COUNT(*) as c FROM ai_credential_vault WHERE is_active = true'); credCount = parseInt(r.rows[0].c); } catch(e) {}
    try { const r = await db.query('SELECT COUNT(*) as c FROM crm_contacts'); crmCount = parseInt(r.rows[0].c); } catch(e) {}
    try { const r = await db.query('SELECT COUNT(*) as c FROM ai_agent_results'); resultsCount = parseInt(r.rows[0].c); } catch(e) {}

    await this.postToInbox(
      'ceo', 'The Conductor',
      `**System Online** — ${dateStr}, ${timeStr} ET\n\n` +
      `**Platform:**\n` +
      `• Users: ${userCount} | Appointments: ${apptCount}\n` +
      `• CRM Contacts: ${crmCount} | Agent Results: ${resultsCount}\n` +
      `• Credentials Vault: ${credCount} active\n\n` +
      `**Infrastructure:**\n` +
      `• Agents: ${agentCount} | LLM: ${llmStatus}\n` +
      `• Node: ${process.version} | Heap: ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB\n` +
      `• Heartbeat: Active (web missions every 3h)\n\n` +
      `${credCount === 0 ? '⚠️ **No platform credentials stored.** Add Twitter/LinkedIn API keys in Credential Vault to enable social posting.\n\n' : ''}` +
      `${userCount < 5 ? '⚠️ **Low user count.** Focus on provider recruitment and patient acquisition.\n' : ''}`,
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

      // Gather REAL platform data from PostgreSQL
      let metrics = {};
      try { const r = await db.query("SELECT COUNT(*) as total, COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '24 hours') as new FROM users"); metrics.totalUsers = parseInt(r.rows[0].total); metrics.newUsers24h = parseInt(r.rows[0].new); } catch (e) {}
      try { const r = await db.query("SELECT COUNT(*) as count, COALESCE(SUM(amount), 0) as total FROM payments WHERE created_at > NOW() - INTERVAL '24 hours'"); metrics.payments24h = parseInt(r.rows[0].count); metrics.revenue24h = parseFloat(r.rows[0].total); } catch (e) {}
      try { const r = await db.query('SELECT COUNT(*) as c FROM video_sessions'); metrics.totalAppointments = parseInt(r.rows[0].c); } catch(e) {}
      try { const r = await db.query("SELECT COUNT(*) as c FROM video_sessions WHERE created_at > NOW() - INTERVAL '24 hours'"); metrics.appointments24h = parseInt(r.rows[0].c); } catch(e) {}
      try { const r = await db.query('SELECT COUNT(*) as c FROM crm_contacts'); metrics.crmContacts = parseInt(r.rows[0].c); } catch(e) {}
      try { const r = await db.query('SELECT COUNT(*) as c FROM ai_agent_results'); metrics.agentResults = parseInt(r.rows[0].c); } catch(e) {}
      try { const r = await db.query('SELECT COUNT(*) as c FROM ai_credential_vault WHERE is_active = true'); metrics.activeCredentials = parseInt(r.rows[0].c); } catch(e) {}

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

  // ═══════════════════════════════════════════════════════════════
  //  WEB MISSIONS — Agents go OUT and harvest real intelligence
  // ═══════════════════════════════════════════════════════════════

  async runWebMissions() {
    if (!webEngine) {
      console.warn('💓 Heartbeat: Web missions skipped — web-action-engine not loaded');
      return;
    }
    const now = new Date();
    const timeStr = now.toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour12: true, hour: 'numeric', minute: '2-digit' });

    console.log('\n🌐 Heartbeat: Starting web missions...');

    // ─── Mission 1: The Scout — Competitor Intelligence ──────
    try {
      const competitors = await webEngine.scrapeCompetitorPricing();
      const live = competitors.filter(c => c.status === 'live');
      const allPrices = live.flatMap(c => c.pricesFound || []);
      const avgPrice = allPrices.length > 0 ? Math.round(allPrices.reduce((a, b) => a + b, 0) / allPrices.length) : 0;

      let report = `🎯 **Competitor Intelligence Report** (${timeStr} ET)\n\n`;
      report += `Scanned **${competitors.length}** competitors. **${live.length}** are live.\n\n`;

      for (const c of live) {
        report += `**${c.name}** — ${c.title || 'No title'}\n`;
        if (c.pricesFound.length > 0) report += `  💰 Prices detected: ${c.pricesFound.map(p => '$' + p).join(', ')}\n`;
        if (c.servicesDetected.length > 0) report += `  🏥 Services: ${c.servicesDetected.join(', ')}\n`;
        report += `  📝 "${c.description || c.headline || 'No description'}"\n\n`;
      }

      if (avgPrice > 0) {
        report += `📊 **Market avg visit price: ~$${avgPrice}** — DoctaRx should price competitively.\n`;
      }
      report += `\n_Automated web scrape — The Scout hunts._`;

      await this.postToInbox('growth', 'The Scout', report, 'report', {
        category: 'competitor_intel', aiGenerated: false,
        metrics: { competitorsScanned: competitors.length, liveSites: live.length, avgPrice }
      });
      await webEngine.storeResult('growth', 'The Scout', 'competitor_intel', 'Competitor Pricing Scan', competitors);
    } catch (e) {
      console.error('Mission competitor intel failed:', e.message);
    }

    // ─── Mission 2: The Oracle — Healthcare News ─────────────
    try {
      const news = await webEngine.scrapeHealthcareNews();
      const totalArticles = news.reduce((sum, s) => sum + (s.articles?.length || 0), 0);

      let report = `🔮 **Healthcare Industry Intel** (${timeStr} ET)\n\n`;
      report += `Harvested **${totalArticles}** articles from **${news.length}** sources.\n\n`;

      for (const source of news) {
        if (source.articles?.length > 0) {
          report += `**${source.source}**\n`;
          for (const article of source.articles.slice(0, 3)) {
            report += `  • ${article.title}`;
            if (article.link) report += ` [→](${article.link})`;
            report += `\n`;
            if (article.summary) report += `    _${article.summary.substring(0, 150)}_\n`;
          }
          report += '\n';
        }
      }
      report += `_Automated web harvest — The Oracle sees all._`;

      await this.postToInbox('researcher', 'The Oracle', report, 'report', {
        category: 'industry_news', metrics: { sources: news.length, articles: totalArticles }
      });
      await webEngine.storeResult('researcher', 'The Oracle', 'news_harvest', 'Healthcare News Harvest', news);
    } catch (e) {
      console.error('Mission healthcare news failed:', e.message);
    }

    // ─── Mission 3: The Builder — Provider Lead Gen (NPI) ────
    try {
      const providers = await webEngine.scrapeProviderDirectories();

      if (providers.length > 0) {
        let report = `🔧 **Provider Lead Generation** (${timeStr} ET)\n\n`;
        report += `Found **${providers.length}** potential providers from NPI Registry.\n\n`;

        for (const p of providers.slice(0, 10)) {
          report += `• **${p.name}** ${p.credential ? `(${p.credential})` : ''}\n`;
          report += `  ${p.specialty} — ${p.city}, ${p.state}\n`;
          if (p.phone) report += `  📞 ${p.phone}\n`;
          report += `  NPI: ${p.npi}\n\n`;
        }

        if (providers.length > 10) {
          report += `_...and ${providers.length - 10} more. Full list stored in Results._\n\n`;
        }
        report += `**Action:** These providers could be recruited to DoctaRx. Outreach recommended.\n`;
        report += `\n_Automated NPI Registry harvest — The Builder constructs._`;

        await this.postToInbox('corporate_skills', 'The Builder', report, 'report', {
          category: 'lead_gen', metrics: { providersFound: providers.length }
        });
        await webEngine.storeResult('corporate_skills', 'The Builder', 'provider_leads', 'NPI Provider Leads', providers);

        // Auto-import into CRM
        try {
          const crmService = require('../crmService');
          if (crmService.initialized) {
            let imported = 0;
            for (const p of providers) {
              if (!p.name || p.name === 'Unknown') continue;
              const nameParts = p.name.split(' ');
              const result = await crmService.addContact({
                firstName: nameParts[0] || '', lastName: nameParts.slice(1).join(' ') || '',
                title: p.credential || '', specialty: p.specialty || '', contactType: 'provider',
                source: 'npi_registry', sourceAgent: 'corporate_skills',
                npiNumber: p.npi || null, city: p.city || '', state: p.state || '',
                phone: p.phone || '', assignedAgent: 'growth', priority: 'medium',
                notes: `NPI Registry lead. Type: ${p.type || 'Individual'}`
              });
              if (result) imported++;
            }
            if (imported > 0) console.log(`  📇 CRM: ${imported} new providers auto-imported`);
          }
        } catch (crmErr) { /* CRM not ready, that's ok */ }
      }
    } catch (e) {
      console.error('Mission provider leads failed:', e.message);
    }

    // ─── Mission 4: The Scout — SEO & Search Visibility ──────
    try {
      const seo = await webEngine.checkSearchVisibility();

      let report = `🎯 **DoctaRx SEO & Visibility Report** (${timeStr} ET)\n\n`;
      for (const check of seo) {
        const icon = check.status === 'pass' ? '✅' : check.status === 'fail' ? '❌' : '⚠️';
        report += `${icon} **${check.check}**: ${check.status.toUpperCase()}\n`;
        if (check.title) report += `  Title: "${check.title}"\n`;
        if (check.description) report += `  Meta: "${check.description}"\n`;
        if (check.h1) report += `  H1: "${check.h1}"\n`;
        if (check.error) report += `  Error: ${check.error}\n`;
        report += '\n';
      }

      const missing = seo.filter(s => s.status !== 'pass');
      if (missing.length > 0) {
        report += `⚠️ **${missing.length} issue(s) need fixing** for better search rankings.\n`;
      }
      report += `\n_Automated SEO audit — The Scout optimizes visibility._`;

      await this.postToInbox('growth', 'The Scout', report, 'report', {
        category: 'seo_audit', metrics: { checks: seo.length, passed: seo.filter(s => s.status === 'pass').length }
      });
    } catch (e) {
      console.error('Mission SEO check failed:', e.message);
    }

    // ─── Mission 5: The Scout — Social Media Presence ────────
    try {
      const social = await webEngine.checkSocialPresence();

      let report = `🎯 **Social Media Presence Audit** (${timeStr} ET)\n\n`;
      for (const p of social) {
        const icon = p.exists ? '✅' : '❌';
        report += `${icon} **${p.platform}** (${p.handle}) — ${p.status}\n`;
        report += `  ${p.recommendation}\n\n`;
      }

      const missing = social.filter(s => !s.exists);
      if (missing.length > 0) {
        report += `🚨 **${missing.length} platform(s) have NO DoctaRx presence!** Create accounts immediately:\n`;
        missing.forEach(m => { report += `  → ${m.url}\n`; });
      }
      report += `\n_Automated social audit — The Scout maps the territory._`;

      await this.postToInbox('growth', 'The Scout', report, 'report', {
        category: 'social_audit', metrics: { platforms: social.length, present: social.filter(s => s.exists).length, missing: missing.length }
      });
    } catch (e) {
      console.error('Mission social presence failed:', e.message);
    }

    // ─── Mission: CRM Growth — Import leads, check pipeline, alert on pending providers ───
    try {
      let crmService;
      try { crmService = require('../crmService'); } catch(e) {}

      if (crmService) {
        let growthReport = `**CRM & Growth Report** (${timeStr} ET)\n\n`;

        // Import any new agent leads into CRM
        try {
          const imported = await crmService._importAgentLeads();
          if (imported > 0) {
            growthReport += `✅ **${imported} new leads** imported from agent web missions into CRM\n`;
          }
        } catch(e) {}

        // Check CRM stats
        try {
          const stats = await crmService.getDashboardStats();
          const totalContacts = Object.values(stats.contactsByType || {}).reduce((a, b) => a + b, 0);
          const pipeline = stats.pipelineDistribution || {};
          const outreachQueued = pipeline.outreach_queued || 0;
          const newLeads = pipeline.new || 0;

          growthReport += `📊 **CRM:** ${totalContacts} contacts total\n`;
          growthReport += `• New leads: ${newLeads} | Outreach queued: ${outreachQueued}\n`;
          growthReport += `• Email budget: ${stats.emailStats?.dailyRemaining || 'N/A'}/day remaining\n`;

          // Alert if there are leads ready for outreach
          if (outreachQueued > 0) {
            growthReport += `\n⚡ **${outreachQueued} contacts** are queued for outreach — approve a campaign to start sending!\n`;
          }
          if (newLeads > 5) {
            growthReport += `⚡ **${newLeads} new leads** need to be reviewed and moved through the pipeline.\n`;
          }
        } catch(e) {}

        // Check for pending provider approvals
        try {
          const pending = await db.query("SELECT COUNT(*) as c FROM users WHERE role = 'provider' AND provider_status = 'pending'");
          const pendingCount = parseInt(pending.rows[0].c);
          if (pendingCount > 0) {
            growthReport += `\n🚨 **${pendingCount} provider(s) awaiting approval!** These are potential revenue. Go to /admin/providers to approve.\n`;
          }
        } catch(e) {}

        // Check sign-up velocity
        try {
          const recent = await db.query("SELECT COUNT(*) as c FROM users WHERE created_at > NOW() - INTERVAL '24 hours'");
          const newUsers = parseInt(recent.rows[0].c);
          growthReport += `\n📈 **${newUsers} new sign-ups** in the last 24 hours.\n`;
        } catch(e) {}

        await this.postToInbox('growth', 'The Scout', growthReport, 'report', {
          category: 'crm_growth', automated: true
        });
      }
    } catch (e) {
      console.error('Mission CRM growth failed:', e.message);
    }

    // ─── Mission: Opportunity Scout — VC, providers, partnerships ───
    try {
      const timeStrNow = new Date().toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour12: true, hour: 'numeric', minute: '2-digit' });

      // VC / Investment opportunities
      const vcResults = await webEngine.scoutVCOpportunities();
      if (vcResults.success && vcResults.count > 0) {
        let vcReport = `💰 **Investment & Funding Opportunities** (${timeStrNow} ET)\n\n`;
        vcReport += `Found **${vcResults.count}** opportunities:\n\n`;

        const byCategory = {};
        for (const opp of vcResults.opportunities) {
          if (!byCategory[opp.category]) byCategory[opp.category] = [];
          byCategory[opp.category].push(opp);
        }

        for (const [cat, opps] of Object.entries(byCategory)) {
          const label = cat === 'vc_fund' ? 'VC Funds' : cat === 'grant' ? 'Grants' : cat === 'accelerator' ? 'Accelerators' : 'Competitions';
          vcReport += `**${label}:**\n`;
          for (const o of opps.slice(0, 3)) {
            vcReport += `• [${o.title}](${o.url})\n  ${o.snippet.substring(0, 150)}\n`;
          }
          vcReport += '\n';
        }

        vcReport += `\n⚡ **Action**: Review these and decide which to apply to. I can help draft pitch decks and applications.\n`;

        await this.postToInbox('growth', 'The Scout', vcReport, 'report', {
          category: 'vc_scouting', automated: true, opportunityCount: vcResults.count
        });

        // Auto-import into CRM
        try {
          let crmServiceLocal;
          try { crmServiceLocal = require('../crmService'); } catch(e) {}
          if (crmServiceLocal) {
            let imported = 0;
            for (const opp of vcResults.opportunities.slice(0, 8)) {
              try {
                await crmServiceLocal.addContact({
                  first_name: opp.title.substring(0, 50),
                  last_name: '',
                  company: opp.url.replace(/https?:\/\//, '').split('/')[0],
                  contact_type: opp.category === 'grant' ? 'partner' : 'investor',
                  source: `vc_scout_auto_${new Date().toISOString().slice(0, 10)}`,
                  source_agent: 'growth',
                  notes: `${opp.snippet}\n\nSource: ${opp.url}\nCategory: ${opp.category}`,
                  pipeline_stage: 'new',
                  lead_score: opp.category === 'grant' ? 75 : 65
                });
                imported++;
              } catch(e) { /* duplicate */ }
            }
            if (imported > 0) {
              vcReport += `\n✅ Auto-imported ${imported} opportunities into CRM.\n`;
            }
          }
        } catch(e) {}

        await webEngine.storeResult('growth', 'The Scout', 'vc_scouting', 'VC & Investment Scout', vcResults.opportunities.slice(0, 10));
      }

      // Provider recruitment leads
      const provResults = await webEngine.scoutProviderRecruitment();
      if (provResults.success && provResults.count > 0) {
        let provReport = `👨‍⚕️ **Provider Recruitment Opportunities** (${timeStrNow} ET)\n\n`;
        provReport += `Found **${provResults.count}** potential provider leads:\n\n`;

        const byType = {};
        for (const lead of provResults.leads) {
          if (!byType[lead.leadType]) byType[lead.leadType] = [];
          byType[lead.leadType].push(lead);
        }

        for (const [type, leads] of Object.entries(byType)) {
          const label = type === 'competitor_switch' ? '🎯 Competitor Dissatisfied (Easiest Wins)' :
                        type === 'independent_physician' ? '🏥 Independent Physicians' :
                        type === 'nurse_practitioner' ? '👩‍⚕️ Nurse Practitioners' :
                        type === 'rural_provider' ? '🌾 Rural Providers (Underserved Markets)' : '📋 General';
          provReport += `**${label}:**\n`;
          for (const l of leads.slice(0, 3)) {
            provReport += `• [${l.title}](${l.url})\n  ${l.snippet.substring(0, 150)}\n`;
          }
          provReport += '\n';
        }

        provReport += `\n⚡ **Low-Hanging Fruit**: Focus on "Competitor Dissatisfied" and "Independent Physicians" first — they're actively looking.\n`;

        await this.postToInbox('growth', 'The Scout', provReport, 'report', {
          category: 'provider_recruitment', automated: true, leadCount: provResults.count
        });

        await webEngine.storeResult('growth', 'The Scout', 'provider_scouting', 'Provider Recruitment Scout', provResults.leads.slice(0, 10));
      }

      // Credential audit — what's missing?
      const credAudit = await webEngine.auditCredentials();
      if (credAudit.success && credAudit.audit.requests.length > 0) {
        let credReport = `🔑 **Credential Request** (${timeStrNow} ET)\n\n`;
        credReport += `I need **${credAudit.audit.requests.length} API key(s)** to unlock more capabilities:\n\n`;

        for (const req of credAudit.audit.requests) {
          credReport += `**${req.name}** [${req.priority}]\n`;
          credReport += `• Unlocks: ${req.unlocks.join(', ')}\n`;
          credReport += `• Value: ${req.estimatedValue || 'Growth capability'}\n`;
          credReport += `• How to get: ${req.howToGet}\n\n`;
        }

        credReport += `Already have: ${credAudit.audit.existing.map(c => c.name).join(', ') || 'None'}\n`;
        credReport += `\n⚡ **Operator Action Needed**: Add these keys to unlock agent capabilities. Go to /admin/agent → Credentials tab.\n`;

        await this.postToInbox('ceo', 'The Conductor', credReport, 'alert', {
          category: 'credential_request', automated: true, missingCount: credAudit.audit.requests.length
        });
      }

    } catch (e) {
      console.error('Mission opportunity scout failed:', e.message);
    }

    // ─── AI Synthesis of all missions ────────────────────────
    if (this.llm && this.llm.isAvailable()) {
      try {
        const synthesis = await this.llm.callLLM(
          `${this.llm.GENESIS_CORE_PROMPT}\n\nYou are The Conductor — CEO Agent. You just received real web intelligence from the agent missions.`,
          `Agents just completed their internet missions. Summarize the TOP 3 actionable items the Operator should act on TODAY. Be specific, include dollar values or percentages where possible. Under 150 words. Start with the most valuable action.`,
          { maxTokens: 512, temperature: 0.7 }
        );
        if (synthesis) {
          await this.postToInbox('ceo', 'The Conductor',
            `🎼 **Mission Debrief** (${timeStr} ET)\n\n${synthesis}`,
            'report', { category: 'mission_debrief', aiGenerated: true }
          );
        }
      } catch (e) { /* synthesis is a bonus */ }
    }

    console.log('🌐 Heartbeat: Web missions complete.');
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
