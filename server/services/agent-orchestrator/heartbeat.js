/**
 * HEARTBEAT SYSTEM — Proactive Agent Scheduling
 *
 * Agents act on their own: health checks, web missions, briefings.
 * Messages are plain text, no markdown, no templates, no spam.
 *
 * Frequencies (reduced to avoid inbox clutter):
 *   - Error monitor: every 2 min
 *   - Health check: every 10 min (only posts on problems)
 *   - Proactive scan: every 2 hours (was 15 min — way too noisy)
 *   - Web missions: every 6 hours (was 2 hours)
 *   - Agent cycle: every 4 hours (was 1 hour)
 *   - Executive briefing: every 8 hours (was 3 hours)
 */

const db = require('../../db');
let webEngine = null;
try { webEngine = require('./web-action-engine'); } catch (e) { /* optional */ }

function sanitizeText(input) {
  let text = String(input || '');
  text = text.replace(/```[a-zA-Z0-9_-]*\n([\s\S]*?)```/g, (_m, inner) => String(inner || ''));
  text = text.replace(/\*\*/g, '');
  text = text.replace(/\*/g, '');
  text = text.replace(/^#{1,6}\s+/gm, '');
  text = text.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '$1 ($2)');
  text = text.replace(/^\s*[-•]\s+/gm, '');
  text = text.replace(/^\s*\d+\.\s+/gm, '');
  text = text.replace(/_([^_]+)_/g, '$1');
  text = text.replace(/\r\n/g, '\n');
  text = text.replace(/\n{3,}/g, '\n\n');
  return text.trim();
}

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
    this.cooldowns = new Map(); // key -> timestamp ms
  }

  start() {
    if (this.isRunning) return;
    this.isRunning = true;
    this.startedAt = new Date();

    console.log('  Heartbeat System: ACTIVE');

    // Best-effort cleanup so the Operator inbox doesn't fill with automated noise.
    this.cleanupInbox().catch(() => {});

    this.timers.push(setInterval(() => this.errorCheck(), 2 * 60 * 1000));
    this.timers.push(setInterval(() => this.healthCheck(), 10 * 60 * 1000));
    this.timers.push(setInterval(() => this.proactiveScan(), 2 * 60 * 60 * 1000));
    this.timers.push(setInterval(() => this.runWebMissions(), 6 * 60 * 60 * 1000));
    this.timers.push(setInterval(() => this.agentCycle(), 4 * 60 * 60 * 1000));
    this.timers.push(setInterval(() => this.executiveBriefing(), 8 * 60 * 60 * 1000));

    // Startup: one briefing after boot, first web mission after 5 min
    setTimeout(() => this.healthCheck(), 15 * 1000);
    setTimeout(() => this.startupBriefing(), 30 * 1000);
    setTimeout(() => this.runWebMissions(), 5 * 60 * 1000);

    this.timers.push(setInterval(() => {
      console.log(`Heartbeat alive — cycle #${this.cycleCount}, uptime: ${Math.round((Date.now() - this.startedAt.getTime()) / 1000)}s`);
    }, 10 * 60 * 1000));
  }

  shouldPost(key, cooldownMs) {
    const now = Date.now();
    const last = this.cooldowns.get(key) || 0;
    if (now - last < cooldownMs) return false;
    this.cooldowns.set(key, now);
    return true;
  }

  async cleanupInbox() {
    // Remove automated heartbeat chatter older than 48 hours.
    try {
      await db.query(
        `DELETE FROM ai_chat_messages
         WHERE sender_type = 'agent'
           AND recipient_type = 'operator'
           AND (metadata->>'source' = 'heartbeat' OR metadata->>'automated' = 'true')
           AND created_at < NOW() - INTERVAL '48 hours'`
      );
    } catch {
      // ignore
    }
  }

  async wakeUp() {
    console.log('Heartbeat: WAKE UP — all agents activating');
    const results = [];
    try { await this.startupBriefing(); results.push('startup_briefing'); } catch (e) { results.push('startup_briefing:FAILED'); }
    try { await this.proactiveScan(); results.push('proactive_scan'); } catch (e) { results.push('proactive_scan:FAILED'); }
    try { await this.healthCheck(); results.push('health_check'); } catch (e) { results.push('health_check:FAILED'); }
    try { await this.runWebMissions(); results.push('web_missions'); } catch (e) { results.push('web_missions:FAILED'); }
    try { await this.executiveBriefing(); results.push('executive_briefing'); } catch (e) { results.push('executive_briefing:FAILED'); }
    return {
      triggered: results,
      timestamp: new Date().toISOString(),
      heartbeatRunning: this.isRunning,
      uptime: Math.round((Date.now() - (this.startedAt?.getTime() || Date.now())) / 1000)
    };
  }

  stop() {
    this.isRunning = false;
    this.timers.forEach(t => clearInterval(t));
    this.timers = [];
    console.log('  Heartbeat System: STOPPED');
  }

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

  // ── Helpers ──────────────────────────────────────────────────────

  _ts() {
    return new Date().toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour12: true, hour: 'numeric', minute: '2-digit' });
  }

  _date() {
    return new Date().toLocaleDateString('en-US', { timeZone: 'America/New_York', weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  }

  async _safeCount(sql) {
    try { const r = await db.query(sql); return parseInt(r.rows[0]?.count || r.rows[0]?.c || 0, 10); } catch { return 0; }
  }

  async _safeSum(sql) {
    try { const r = await db.query(sql); return parseFloat(r.rows[0]?.total || 0); } catch { return 0; }
  }

  // ── Error Monitor ───────────────────────────────────────────────

  async errorCheck() {
    try {
      const recentErrors = await this._safeCount(`
        SELECT COUNT(*) as count FROM ai_audit_log
        WHERE (action_type LIKE '%error%' OR action_type LIKE '%failed%')
        AND created_at > NOW() - INTERVAL '5 minutes'
      `);

      if (recentErrors > this.errorCount + 5) {
        let detail = '';
        try {
          const rows = await db.query(`
            SELECT action_type, details FROM ai_audit_log
            WHERE (action_type LIKE '%error%' OR action_type LIKE '%failed%')
            AND created_at > NOW() - INTERVAL '5 minutes'
            ORDER BY created_at DESC LIMIT 5
          `);
          for (const row of rows.rows) {
            const d = typeof row.details === 'string' ? row.details : JSON.stringify(row.details);
            detail += `  ${row.action_type}: ${(d || '').substring(0, 200)}\n`;
          }
        } catch {}

        await this.postToInbox(
          'devops', 'The Debugger',
          `Error spike detected — ${recentErrors - this.errorCount} new errors in the last 5 minutes.\n\n` +
          (detail ? `Recent errors:\n${detail}\n` : '') +
          `Use the IDE at /admin/agent-ide to investigate.`,
          'alert', { severity: 'high', errorCount: recentErrors }
        );
      }
      this.errorCount = recentErrors;
    } catch {}
  }

  // ── Health Check (only posts on problems) ───────────────────────

  async healthCheck() {
    try {
      const mem = process.memoryUsage();
      const status = {
        uptime: Math.round(process.uptime()),
        heapUsedMB: Math.round(mem.heapUsed / 1024 / 1024),
        heapTotalMB: Math.round(mem.heapTotal / 1024 / 1024),
        heapPercent: Math.round((mem.heapUsed / mem.heapTotal) * 100),
        pid: process.pid,
        timestamp: new Date().toISOString()
      };

      let dbHealthy = false;
      try { await db.query('SELECT 1'); dbHealthy = true; } catch (e) { status.dbError = e.message; }
      status.dbHealthy = dbHealthy;

      try {
        const r = await db.query("SELECT COUNT(*) FROM ai_agents WHERE status != 'shutdown'");
        status.activeAgents = parseInt(r.rows[0].count);
      } catch {}

      this.lastHealthCheck = status;

      // Only post if something is actually wrong
      if (!dbHealthy) {
        await this.postToInbox(
          'devops', 'The Debugger',
          `Database connection lost. DoctaRx cannot serve patients right now.\n\nCheck Aiven PostgreSQL status and connection pooling. This is the top priority until resolved.`,
          'alert', { severity: 'critical', category: 'infrastructure' }
        );
      }

      if (status.heapPercent > 80) {
        await this.postToInbox(
          'devops', 'The Debugger',
          `Memory is running high — heap at ${status.heapPercent}% (${status.heapUsedMB}MB / ${status.heapTotalMB}MB). Worth keeping an eye on. If it keeps climbing, check for memory leaks in long-running processes.`,
          'alert', { severity: 'medium', category: 'performance' }
        );
      }
    } catch (e) {
      console.error('Heartbeat health check error:', e.message);
    }
  }

  // ── Proactive Scan (every 2 hours, plain text) ──────────────────

  async proactiveScan() {
    if (!this.orchestrator || !this.orchestrator.initialized) return;

    try {
      this.cycleCount++;
      const ts = this._ts();

      const patients = await this._safeCount("SELECT COUNT(*) FROM users WHERE role = 'patient'");
      const providers = await this._safeCount("SELECT COUNT(*) FROM users WHERE role = 'provider'");
      const appts24h = await this._safeCount("SELECT COUNT(*) FROM video_sessions WHERE created_at > NOW() - INTERVAL '24 hours'");
      const payments24h = await this._safeCount("SELECT COUNT(*) FROM payments WHERE created_at > NOW() - INTERVAL '24 hours'");

      // Provider idle signal (event-driven, no inbox post)
      try {
        const idle = await this._safeCount(`
          SELECT COUNT(*) as c FROM users u
          WHERE u.role = 'provider' AND u.provider_status = 'approved'
          AND NOT EXISTS (SELECT 1 FROM video_sessions a WHERE a.provider_id = u.id AND a.created_at > NOW() - INTERVAL '7 days')
        `);
        if (idle > 0 && this.orchestrator?.eventBus) {
          await this.orchestrator.eventBus.emit('provider.idle.threshold', { idleProviders: idle, thresholdDays: 7 }, 'heartbeat');
        }
      } catch {}

      // One consolidated ops update instead of three separate template messages
      let lines = [`Platform check-in (${ts} ET)\n`];
      lines.push(`${patients} patients, ${providers} providers registered.`);
      lines.push(`${appts24h} appointments and ${payments24h} payments in the last 24 hours.`);
      lines.push(`Server uptime: ${Math.round(process.uptime() / 60)} min, memory: ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB.`);

      // Revenue — only if we have data
      let totalRevenue = 0, subCount = 0;
      try {
        totalRevenue = await this._safeSum("SELECT COALESCE(SUM(amount), 0) as total FROM payments WHERE status = 'completed'");
        subCount = await this._safeCount("SELECT COUNT(*) FROM subscriptions WHERE status = 'active'");
      } catch {}
      if (totalRevenue > 0) {
        lines.push(`Total revenue: $${totalRevenue.toFixed(2)}, ${subCount} active subscriptions.`);
      } else {
        lines.push(`No revenue yet. Priority: first paying subscriber.`);
      }

      // Security — only mention if there is an issue
      const failedLogins = await this._safeCount("SELECT COUNT(*) FROM ai_audit_log WHERE action_type LIKE '%login_failed%' AND created_at > NOW() - INTERVAL '24 hours'");
      if (failedLogins > 10) {
        lines.push(`Heads up: ${failedLogins} failed login attempts in the last 24 hours. Consider rate limiting.`);
      }

      // Pending providers — actionable
      const pendingProviders = await this._safeCount("SELECT COUNT(*) FROM users WHERE role = 'provider' AND provider_status = 'pending'");
      if (pendingProviders > 0) {
        lines.push(`${pendingProviders} provider(s) waiting for approval — go to /admin/providers to review.`);
      }

      await this.postToInbox(
        'operations', 'The Weaver',
        lines.join('\n'),
        'report', { category: 'operations', metrics: { patients, providers, appts24h, payments24h, totalRevenue } }
      );

    } catch (e) {
      console.error('Heartbeat proactive scan error:', e.message);
    }
  }

  // ── Startup Briefing ────────────────────────────────────────────

  async startupBriefing() {
    const ts = this._ts();
    const ds = this._date();

    const llmStatus = this.llm && this.llm.isAvailable() ? 'online' : 'offline';

    const agents = await this._safeCount("SELECT COUNT(*) FROM ai_agents WHERE status != 'shutdown'");
    const users = await this._safeCount('SELECT COUNT(*) as c FROM users');
    const appts = await this._safeCount('SELECT COUNT(*) as c FROM video_sessions');
    const creds = await this._safeCount('SELECT COUNT(*) as c FROM ai_credential_vault WHERE is_active = true');
    const crm = await this._safeCount('SELECT COUNT(*) as c FROM crm_contacts');

    let msg = `System online — ${ds}, ${ts} ET.\n\n`;
    msg += `${users} users, ${appts} appointments, ${crm} CRM contacts, ${creds} active credentials.\n`;
    msg += `${agents} agents loaded, LLM ${llmStatus}.\n`;
    if (creds === 0) msg += `\nNo platform credentials stored yet. Add API keys in the Credential Vault to unlock social posting and other integrations.\n`;
    if (users < 5) msg += `Low user count. Focus on provider recruitment and patient acquisition.\n`;

    await this.postToInbox('ceo', 'The Conductor', msg, 'report', { category: 'startup', severity: 'info' });

    // AI briefing if LLM is up
    if (this.llm && this.llm.isAvailable()) {
      try {
        const briefing = await this.llm.callLLM(
          `${this.llm.GENESIS_CORE_PROMPT}\n\nYou are The Conductor. Generate a concise startup briefing for the Operator.\n\nTime: ${ts} ET, ${ds}\nAgents: ${agents}, LLM: ${llmStatus}\n\nRULES: No asterisks, no markdown, no bold, no bullets. Write plain sentences like a person talking. Keep it under 150 words. Most important thing first.`,
          `What should the Operator focus on right now? Be specific to DoctaRx as an early-stage telehealth startup. Top priority, biggest revenue opportunity, and one risk to watch. Plain text only, no formatting.`,
          { maxTokens: 512, temperature: 0.7 }
        );
        if (briefing) {
          await this.postToInbox('ceo', 'The Conductor', `Morning briefing (${ts} ET)\n\n${briefing}`, 'report', { category: 'briefing', aiGenerated: true });
        }
      } catch (e) {
        console.error('AI briefing generation failed:', e.message);
      }
    }
  }

  // ── Executive Briefing ──────────────────────────────────────────

  async executiveBriefing() {
    if (!this.llm || !this.llm.isAvailable()) return;

    try {
      const ts = this._ts();

      let metrics = {};
      try { const r = await db.query("SELECT COUNT(*) as total, COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '24 hours') as new FROM users"); metrics.totalUsers = parseInt(r.rows[0].total); metrics.newUsers24h = parseInt(r.rows[0].new); } catch {}
      try { const r = await db.query("SELECT COUNT(*) as count, COALESCE(SUM(amount), 0) as total FROM payments WHERE created_at > NOW() - INTERVAL '24 hours'"); metrics.payments24h = parseInt(r.rows[0].count); metrics.revenue24h = parseFloat(r.rows[0].total); } catch {}
      try { metrics.totalAppointments = await this._safeCount('SELECT COUNT(*) as c FROM video_sessions'); } catch {}
      try { metrics.crmContacts = await this._safeCount('SELECT COUNT(*) as c FROM crm_contacts'); } catch {}

      const briefing = await this.llm.callLLM(
        `${this.llm.GENESIS_CORE_PROMPT}\n\nYou are The Conductor performing a periodic executive briefing.\n\nRULES: No asterisks, no markdown bold, no bullet symbols. Write in plain conversational sentences like you are talking to the founder over coffee. No headers. No lists. Just clear, direct paragraphs. Under 200 words.`,
        `Platform metrics (last 24h):\n${JSON.stringify(metrics, null, 2)}\n\nTime: ${ts} ET\n\nGive a concise update: situation, wins, risks, revenue, next action. Plain text, no formatting. Start with the most important thing.`,
        { maxTokens: 512, temperature: 0.7 }
      );

      if (briefing) {
        await this.postToInbox('ceo', 'The Conductor', `Executive update (${ts} ET)\n\n${briefing}`, 'report', { category: 'briefing', aiGenerated: true, metrics });
      }
    } catch (e) {
      console.error('Executive briefing error:', e.message);
    }
  }

  // ── Web Missions ────────────────────────────────────────────────

  async runWebMissions() {
    if (!webEngine) {
      console.warn('Heartbeat: Web missions skipped — web-action-engine not loaded');
      return;
    }
    const ts = this._ts();
    console.log('\nHeartbeat: Starting web missions...');

    // Mission 1: Competitor intel (store quietly; no inbox spam)
    try {
      const competitors = await webEngine.scrapeCompetitorPricing();
      const live = competitors.filter(c => c.status === 'live');
      const allPrices = live.flatMap(c => c.pricesFound || []);
      const avgPrice = allPrices.length > 0 ? Math.round(allPrices.reduce((a, b) => a + b, 0) / allPrices.length) : 0;
      void avgPrice;
      await webEngine.storeResult('growth', 'The Scout', 'competitor_intel', 'Competitor Pricing Scan', competitors);
    } catch (e) {
      console.error('Mission competitor intel failed:', e.message);
    }

    // Mission 2: Healthcare news (store quietly; no inbox spam)
    try {
      const news = await webEngine.scrapeHealthcareNews();
      const totalArticles = news.reduce((sum, s) => sum + (s.articles?.length || 0), 0);
      void totalArticles;
      await webEngine.storeResult('researcher', 'The Oracle', 'news_harvest', 'Healthcare News Harvest', news);
    } catch (e) {
      console.error('Mission healthcare news failed:', e.message);
    }

    // Mission 3: Provider leads (NPI)
    try {
      const providers = await webEngine.scrapeProviderDirectories();
      if (providers.length > 0) {
        await webEngine.storeResult('corporate_skills', 'The Builder', 'provider_leads', 'NPI Provider Leads', providers);

        // Auto-import to CRM
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
            if (imported > 0) {
              console.log(`  CRM: ${imported} new providers auto-imported`);
              await this.postToInbox(
                'growth',
                'The Scout',
                `I pulled provider leads from NPI and imported ${imported} of them into the CRM.\n\nIf you want, I can draft a short, respectful outreach email and create the campaign as a draft for your approval.`,
                'alert',
                { category: 'lead_gen', severity: 'info' }
              );
            }
          }
        } catch {}
      }
    } catch (e) {
      console.error('Mission provider leads failed:', e.message);
    }

    // Mission 4: SEO check
    try {
      const seo = await webEngine.checkSearchVisibility();
      const issues = seo.filter(s => s.status !== 'pass');
      if (issues.length > 0) {
        let msg = `SEO check (${ts} ET)\n\n${issues.length} issue(s) found:\n\n`;
        for (const check of issues) {
          msg += `${check.check}: ${check.status.toUpperCase()}`;
          if (check.error) msg += ` — ${check.error}`;
          msg += '\n';
        }
        msg += `\nFix these for better search rankings.`;
        await this.postToInbox('growth', 'The Scout', msg, 'alert', { category: 'seo_audit', severity: 'info' });
      }
    } catch (e) {
      console.error('Mission SEO check failed:', e.message);
    }

    // Mission 5: Social presence (only report missing platforms)
    try {
      const social = await webEngine.checkSocialPresence();
      const missing = social.filter(s => !s.exists);
      if (missing.length > 0) {
        let msg = `Social media check (${ts} ET)\n\n${missing.length} platform(s) have no DoctaRx presence:\n\n`;
        for (const m of missing) {
          msg += `${m.platform} (${m.handle}) — ${m.recommendation}\n  Create at: ${m.url}\n\n`;
        }
        await this.postToInbox('growth', 'The Scout', msg, 'alert', { category: 'social_audit', severity: 'info' });
      }
    } catch (e) {
      console.error('Mission social presence failed:', e.message);
    }

    // Mission 6: CRM growth (consolidated, plain text)
    try {
      let crmService;
      try { crmService = require('../crmService'); } catch {}

      if (crmService) {
        let parts = [`CRM update (${ts} ET)\n`];

        try {
          const imported = await crmService._importAgentLeads();
          if (imported > 0) parts.push(`${imported} new leads imported from agent web missions.`);
        } catch {}

        try {
          const stats = await crmService.getDashboardStats();
          const total = Object.values(stats.contactsByType || {}).reduce((a, b) => a + b, 0);
          const pipeline = stats.pipelineDistribution || {};
          const queued = pipeline.outreach_queued || 0;
          const newLeads = pipeline.new || 0;

          parts.push(`${total} contacts total. ${newLeads} new leads, ${queued} queued for outreach.`);
          if (queued > 0) parts.push(`${queued} contacts are ready to go — approve a campaign to start sending.`);
          if (newLeads > 5) parts.push(`${newLeads} new leads need review and pipeline movement.`);
        } catch {}

        const newUsers = await this._safeCount("SELECT COUNT(*) FROM users WHERE created_at > NOW() - INTERVAL '24 hours'");
        if (newUsers > 0) parts.push(`${newUsers} new sign-ups in the last 24 hours.`);

        if (parts.length > 1) {
          const joined = parts.join('\n');
          // Only post when something needs the Operator (outreach queued).
          if (joined.toLowerCase().includes('approve a campaign')) {
            await this.postToInbox('growth', 'The Scout', joined, 'alert', { category: 'crm_growth', severity: 'info' });
          }
        }
      }
    } catch (e) {
      console.error('Mission CRM growth failed:', e.message);
    }

    // Mission 7: Opportunity scouting (VC, providers, partnerships)
    try {
      const tsNow = this._ts();

      const vcResults = await webEngine.scoutVCOpportunities();
      if (vcResults.success && vcResults.count > 0) {
        await this.postToInbox(
          'growth',
          'The Scout',
          `I found ${vcResults.count} funding opportunities. I saved them.\n\nTell me what you want first: grants, accelerators, or investor funds. I will import the best ones into CRM and draft the outreach for your approval.`,
          'alert',
          { category: 'vc_scouting', severity: 'info', opportunityCount: vcResults.count }
        );

        // Auto-import to CRM
        try {
          let crmLocal;
          try { crmLocal = require('../crmService'); } catch {}
          if (crmLocal) {
            for (const opp of vcResults.opportunities.slice(0, 8)) {
              try {
                await crmLocal.addContact({
                  first_name: opp.title.substring(0, 50), last_name: '',
                  organization: opp.url.replace(/https?:\/\//, '').split('/')[0],
                  contact_type: opp.category === 'grant' ? 'partner' : 'investor',
                  source: `vc_scout_auto_${new Date().toISOString().slice(0, 10)}`,
                  source_agent: 'growth',
                  notes: `${opp.snippet}\n\nSource: ${opp.url}\nCategory: ${opp.category}`,
                  pipeline_stage: 'new', lead_score: opp.category === 'grant' ? 75 : 65
                });
              } catch {}
            }
          }
        } catch {}
        await webEngine.storeResult('growth', 'The Scout', 'vc_scouting', 'VC & Investment Scout', vcResults.opportunities.slice(0, 10));
      }

      const provResults = await webEngine.scoutProviderRecruitment();
      if (provResults.success && provResults.count > 0) {
        await this.postToInbox(
          'growth',
          'The Scout',
          `I found ${provResults.count} provider recruitment leads.\n\nIf you want, I will import the top 10 into CRM and create a draft outreach campaign for you to approve.`,
          'alert',
          { category: 'provider_recruitment', severity: 'info', leadCount: provResults.count }
        );
        await webEngine.storeResult('growth', 'The Scout', 'provider_scouting', 'Provider Recruitment Scout', provResults.leads.slice(0, 10));
      }

      // Credential audit
      const credAudit = await webEngine.auditCredentials();
      if (credAudit.success && credAudit.audit.requests.length > 0) {
        let msg = `Credential request (${tsNow} ET)\n\nI need ${credAudit.audit.requests.length} API key(s) to unlock more capabilities:\n\n`;
        for (const req of credAudit.audit.requests) {
          msg += `${req.name} [${req.priority}]\n`;
          msg += `  Unlocks: ${req.unlocks.join(', ')}\n`;
          msg += `  How to get: ${req.howToGet}\n\n`;
        }
        if (credAudit.audit.existing.length > 0) {
          msg += `Already have: ${credAudit.audit.existing.map(c => c.name).join(', ')}\n`;
        }
        msg += `\nAdd these in the Credentials tab at /admin/agent-chat.`;

        await this.postToInbox('ceo', 'The Conductor', msg, 'alert', {
          category: 'credential_request', missingCount: credAudit.audit.requests.length
        });
      }
    } catch (e) {
      console.error('Mission opportunity scout failed:', e.message);
    }

    // AI synthesis of missions
    if (this.llm && this.llm.isAvailable()) {
      try {
        const synthesis = await this.llm.callLLM(
          `${this.llm.GENESIS_CORE_PROMPT}\n\nYou are The Conductor. Agents just finished their internet missions.\n\nRULES: No asterisks, no markdown, no bold, no bullets. Plain conversational text. Under 100 words.`,
          `Summarize the top 3 actionable items the Operator should act on today. Be specific. Plain text only.`,
          { maxTokens: 256, temperature: 0.7 }
        );
        void synthesis;
      } catch {}
    }

    console.log('Heartbeat: Web missions complete.');
  }

  // ── Agent Cycle ─────────────────────────────────────────────────

  async agentCycle() {
    if (!this.orchestrator || !this.orchestrator.initialized) return;

    try {
      const ts = this._ts();
      console.log('\nHeartbeat: Starting proactive agent cycle...');
      this.lastAgentCycle = new Date();

      const results = await this.orchestrator.runAllAgents({ trigger: 'heartbeat', timestamp: new Date().toISOString() });

      const totalProposals = Object.values(results || {}).reduce((sum, r) => sum + (r?.proposalCount || 0), 0);
      const totalInsights = Object.values(results || {}).reduce((sum, r) => sum + (r?.insightCount || 0), 0);
      const agentsRan = Object.keys(results || {}).length;

      // Don't spam the Operator when nothing happened.
      if (totalProposals > 0 || totalInsights > 0) {
        let msg = `Agent cycle update (${ts} ET)\n\n${agentsRan} agents ran.`;
        if (totalProposals > 0) msg += ` ${totalProposals} proposals generated — review them in Agent Ops.`;
        if (totalInsights > 0) msg += ` ${totalInsights} insights discovered.`;
        await this.postToInbox('ceo', 'The Conductor', msg, 'alert', {
          category: 'cycle_complete', severity: 'info', proposals: totalProposals, insights: totalInsights
        });
      }
    } catch (e) {
      console.error('Heartbeat agent cycle error:', e.message);
    }
  }

  // ── Post to Inbox ───────────────────────────────────────────────

  async postToInbox(agentId, agentName, message, messageType = 'text', metadata = {}) {
    try {
      const meta = { ...(metadata || {}) };
      meta.source = meta.source || 'heartbeat';
      meta.automated = meta.automated !== false; // default true

      // Rate-limit non-critical automated chatter by category.
      const category = String(meta.category || 'general');
      const severity = String(meta.severity || '').toLowerCase();
      const isAlert = messageType === 'alert' || severity === 'high' || severity === 'critical';
      if (meta.automated && !isAlert) {
        const cooldownMs =
          category === 'cycle_complete' ? (12 * 60 * 60 * 1000) :
          category === 'crm_growth' ? (12 * 60 * 60 * 1000) :
          category === 'industry_news' ? (24 * 60 * 60 * 1000) :
          category === 'competitor_intel' ? (24 * 60 * 60 * 1000) :
          category === 'seo_audit' ? (24 * 60 * 60 * 1000) :
          category === 'social_audit' ? (24 * 60 * 60 * 1000) :
          category === 'vc_scouting' ? (24 * 60 * 60 * 1000) :
          category === 'provider_recruitment' ? (24 * 60 * 60 * 1000) :
          category === 'lead_gen' ? (24 * 60 * 60 * 1000) :
          category === 'briefing' ? (12 * 60 * 60 * 1000) :
          (6 * 60 * 60 * 1000);

        if (!this.shouldPost(`heartbeat:${category}`, cooldownMs)) return;
      }

      const clean = sanitizeText(message);
      await db.query(`
        INSERT INTO ai_chat_messages (sender_type, sender_id, sender_name, recipient_type, content, message_type, metadata)
        VALUES ('agent', $1, $2, 'operator', $3, $4, $5)
      `, [agentId, agentName, clean, messageType, JSON.stringify(meta)]);
    } catch (e) {
      console.error(`Inbox post failed: ${agentName}: ${message.substring(0, 100)}`);
    }
  }

  async notifyOperator(message) {
    await this.postToInbox('ceo', 'The Conductor', message, 'alert');
  }
}

module.exports = HeartbeatSystem;
