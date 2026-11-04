/**
 * AI Operations Portal API Routes
 * 
 * Endpoints for the AI Ops dashboard:
 * - Agent status & monitoring
 * - Proposal review & approval
 * - Intent management
 * - Skill registry
 * - Audit logs
 * - Emergency controls
 */

const express = require('express');
const router = express.Router();
const { authenticate, requireRole } = require('../middleware/auth');
const db = require('../db');
const operationalAgentRuntime = require('../services/agent-runtime/runtime');

let orchestrator;
try {
  orchestrator = require('../services/agent-orchestrator');
} catch (error) {
  console.error('Agent Orchestrator not available:', error.message);
}

// Non-blocking guard: if orchestrator not available, return graceful empty response
// instead of 503 (which breaks the entire ops portal UI).
const ensureOrchestrator = (req, res, next) => {
  if (!orchestrator) {
    const isWrite = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method);
    if (isWrite) return res.status(503).json({ success: false, error: 'Legacy orchestrator is offline. Use the Operational Agent Runtime for persisted tasks.' });
    return res.json({ success: true, data: null });
  }
  next();
};

// All routes require admin/super_admin
const adminOnly = [authenticate, requireRole('admin', 'super_admin')];

// =========================================================================
// DASHBOARD & STATUS — DB fallback when orchestrator unavailable
// =========================================================================

async function buildFallbackDashboard() {
  const safe = async (q, p) => { try { return (await db.query(q, p)).rows; } catch { return []; } };
  const safeCount = async (q, p) => parseInt((await safe(q, p))?.[0]?.cnt || 0);

  const [
    userRows, crmCount, prescCount, triageCount, apptRows,
    invCount, aiMsgCount, subCount, memRows, erxCount, credCount
  ] = await Promise.all([
    safe(`SELECT role, COUNT(*) cnt FROM users WHERE is_active=true GROUP BY role`),
    safeCount(`SELECT COUNT(*) cnt FROM crm_contacts`),
    safeCount(`SELECT COUNT(*) cnt FROM prescriptions`),
    safeCount(`SELECT COUNT(*) cnt FROM triage_queue`),
    safe(`SELECT COUNT(*) FILTER (WHERE status='scheduled') scheduled, COUNT(*) FILTER (WHERE status='completed') completed FROM appointments`),
    safeCount(`SELECT COUNT(*) cnt FROM invitations WHERE status='pending'`),
    safeCount(`SELECT COUNT(*) cnt FROM ai_chat_messages WHERE created_at > NOW() - INTERVAL '24 hours'`),
    safeCount(`SELECT COUNT(*) cnt FROM subscriptions WHERE status='active'`),
    safe(`SELECT agent_type, COUNT(*) cnt FROM ai_agent_memory GROUP BY agent_type ORDER BY cnt DESC LIMIT 10`),
    safeCount(`SELECT COUNT(*) cnt FROM erx_prescriptions WHERE status='pending'`),
    safeCount(`SELECT COUNT(*) cnt FROM provider_credentialing WHERE status='pending'`),
  ]);

  const byRole = {};
  userRows.forEach(r => { byRole[r.role] = parseInt(r.cnt); });
  const totalUsers = Object.values(byRole).reduce((s, v) => s + v, 0);

  return {
    system: {
      orchestratorAvailable: !!orchestrator,
      uptime: Math.round(process.uptime()),
      nodeVersion: process.version,
      mode: 'db_fallback'
    },
    metrics: {
      totalUsers,
      totalPatients:       byRole.patient || 0,
      totalProviders:      byRole.provider || 0,
      totalAdmins:         (byRole.admin || 0) + (byRole.super_admin || 0),
      crmContacts:         crmCount,
      totalPrescriptions:  prescCount,
      totalTriageSessions: triageCount,
      scheduledAppts:      parseInt(apptRows[0]?.scheduled || 0),
      completedAppts:      parseInt(apptRows[0]?.completed || 0),
      pendingInvitations:  invCount,
      agentMessages24h:    aiMsgCount,
      activeSubscriptions: subCount,
      pendingErx:          erxCount,
      pendingCredentialing: credCount,
    },
    memory: { agentBreakdown: memRows },
    governance: { pendingProposals: 0, approvedToday: 0 },
    compliance: { status: 'nominal', recentErrors: 0 },
    intentStats: { total: 0, pending: 0, approved: 0, vetoed: 0 },
    timestamp: new Date().toISOString()
  };
}

/** GET /api/agent-ops/dashboard */
router.get('/dashboard', ...adminOnly, async (req, res) => {
  try {
    if (orchestrator) {
      try {
        const dashboard = await orchestrator.getDashboard();
        // Merge live DB metrics into orchestrator dashboard
        const fallback = await buildFallbackDashboard();
        return res.json({ success: true, data: { ...dashboard, metrics: fallback.metrics } });
      } catch (orchErr) {
        // Orchestrator failed mid-flight — fall through to DB fallback
      }
    }
    const data = await buildFallbackDashboard();
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/** GET /api/agent-ops/status */
router.get('/status', ...adminOnly, async (req, res) => {
  try {
    const status = orchestrator ? await orchestrator.getSystemStatus() : {
      online: true, orchestratorAvailable: false, uptime: Math.round(process.uptime())
    };
    res.json({ success: true, data: status });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// =========================================================================
// OPERATIONAL AGENT RUNTIME
// =========================================================================

/** GET /api/agent-ops/runtime/health */
router.get('/runtime/health', ...adminOnly, async (_req, res) => {
  try {
    const data = await operationalAgentRuntime.getHealth();
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/** GET /api/agent-ops/runtime/registry */
router.get('/runtime/registry', ...adminOnly, async (_req, res) => {
  try {
    res.json({
      success: true,
      data: {
        agents: operationalAgentRuntime.registry,
        tools: operationalAgentRuntime.tools(),
        model: operationalAgentRuntime.modelConfiguration(),
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/** GET /api/agent-ops/runtime/tasks */
router.get('/runtime/tasks', ...adminOnly, async (req, res) => {
  try {
    const data = await operationalAgentRuntime.listTasks(req.query || {});
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/** POST /api/agent-ops/runtime/tasks */
router.post('/runtime/tasks', ...adminOnly, async (req, res) => {
  try {
    const task = await operationalAgentRuntime.createTask(req.body || {}, req.user || {});
    res.status(201).json({ success: true, data: task });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

/** POST /api/agent-ops/runtime/run-next */
router.post('/runtime/run-next', ...adminOnly, async (_req, res) => {
  try {
    const task = await operationalAgentRuntime.runNextTask();
    res.json({ success: true, data: task || { status: 'idle', reason: 'No queued tasks' } });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/** POST /api/agent-ops/runtime/tasks/:id/run */
router.post('/runtime/tasks/:id/run', ...adminOnly, async (req, res) => {
  try {
    const task = await operationalAgentRuntime.runNextTask(req.params.id);
    res.json({ success: true, data: task || { status: 'idle', reason: 'Task is not queued or was already claimed' } });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/** POST /api/agent-ops/runtime/tasks/:id/cancel */
router.post('/runtime/tasks/:id/cancel', ...adminOnly, async (req, res) => {
  try {
    const task = await operationalAgentRuntime.cancelTask(req.params.id);
    if (!task) return res.status(404).json({ success: false, error: 'Task not found or no longer cancellable' });
    res.json({ success: true, data: task });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/** GET /api/agent-ops/runtime/tasks/:id/tool-calls */
router.get('/runtime/tasks/:id/tool-calls', ...adminOnly, async (req, res) => {
  try {
    const data = await operationalAgentRuntime.getTaskToolCalls(req.params.id);
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/** GET /api/agent-ops/runtime/approvals */
router.get('/runtime/approvals', ...adminOnly, async (req, res) => {
  try {
    const data = await operationalAgentRuntime.listApprovals(req.query || {});
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/** POST /api/agent-ops/runtime/approvals/:id/approve */
router.post('/runtime/approvals/:id/approve', ...adminOnly, async (req, res) => {
  try {
    const data = await operationalAgentRuntime.decideApproval(req.params.id, 'approved', req.user?.id, req.body?.notes);
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/** POST /api/agent-ops/runtime/approvals/:id/reject */
router.post('/runtime/approvals/:id/reject', ...adminOnly, async (req, res) => {
  try {
    const data = await operationalAgentRuntime.decideApproval(req.params.id, 'rejected', req.user?.id, req.body?.notes);
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/** GET /api/agent-ops/runtime/budget */
router.get('/runtime/budget', ...adminOnly, async (_req, res) => {
  try {
    const data = await operationalAgentRuntime.getBudgetSettings();
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/** PUT /api/agent-ops/runtime/budget */
router.put('/runtime/budget', ...adminOnly, async (req, res) => {
  try {
    const data = await operationalAgentRuntime.updateBudgetSettings(req.body || {}, req.user?.id);
    res.json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// =========================================================================
// AGENT EXECUTION
// =========================================================================

/** POST /api/agent-ops/run/:agentType - Run a single agent */
router.post('/run/:agentType', ...adminOnly, async (req, res) => {
  if (!orchestrator) return res.status(503).json({ success: false, error: 'Legacy orchestrator is offline. Queue a task in the Operational Agent Runtime instead.' });
  try {
    const { agentType } = req.params;
    const result = await orchestrator.runAgent(agentType, { triggeredBy: req.user.id });
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/** POST /api/agent-ops/run-all - Run all agents */
router.post('/run-all', ...adminOnly, async (req, res) => {
  if (!orchestrator) return res.status(503).json({ success: false, error: 'Legacy orchestrator is offline. Queue a task in the Operational Agent Runtime instead.' });
  try {
    const results = await orchestrator.runAllAgents({ triggeredBy: req.user.id });
    res.json({ success: true, data: results });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// =========================================================================
// PROPOSALS
// =========================================================================

/** GET /api/agent-ops/proposals */
router.get('/proposals', ...adminOnly, async (req, res) => {
  if (!orchestrator) return res.json({ success: true, data: [] });
  try {
    const { status, category, limit } = req.query;
    const proposals = await orchestrator.getProposals({ status, category, limit: parseInt(limit) || 50 });
    res.json({ success: true, data: proposals });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/** POST /api/agent-ops/proposals/:id/approve */
router.post('/proposals/:id/approve', ...adminOnly, ensureOrchestrator, async (req, res) => {
  try {
    const result = await orchestrator.approveProposal(req.params.id, req.user.id, req.body.notes);
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/** POST /api/agent-ops/proposals/:id/reject */
router.post('/proposals/:id/reject', ...adminOnly, ensureOrchestrator, async (req, res) => {
  try {
    await orchestrator.rejectProposal(req.params.id, req.user.id, req.body.notes);
    res.json({ success: true, message: 'Proposal rejected' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// =========================================================================
// INTENTS
// =========================================================================

/** GET /api/agent-ops/intents/pending */
router.get('/intents/pending', ...adminOnly, ensureOrchestrator, async (req, res) => {
  try {
    const intents = await orchestrator.getPendingIntents();
    res.json({ success: true, data: intents });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/** POST /api/agent-ops/intents/:id/approve */
router.post('/intents/:id/approve', ...adminOnly, ensureOrchestrator, async (req, res) => {
  try {
    const result = await orchestrator.approveIntent(req.params.id, req.user.id);
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/** POST /api/agent-ops/intents/:id/veto */
router.post('/intents/:id/veto', ...adminOnly, ensureOrchestrator, async (req, res) => {
  try {
    await orchestrator.vetoIntent(req.params.id, req.body.reason, req.user.id);
    res.json({ success: true, message: 'Intent vetoed' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// =========================================================================
// SKILLS
// =========================================================================

/** GET /api/agent-ops/skills */
router.get('/skills', ...adminOnly, ensureOrchestrator, async (req, res) => {
  try {
    const { category, status } = req.query;
    const skills = await orchestrator.getSkills({ category, complianceStatus: status });
    res.json({ success: true, data: skills });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/** POST /api/agent-ops/skills/:id/approve */
router.post('/skills/:id/approve', ...adminOnly, ensureOrchestrator, async (req, res) => {
  try {
    const result = await orchestrator.approveSkill(req.params.id, req.user.id, req.body.notes);
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/** POST /api/agent-ops/skills/:id/sandbox */
router.post('/skills/:id/sandbox', ...adminOnly, ensureOrchestrator, async (req, res) => {
  try {
    const result = await orchestrator.sandboxSkill(req.params.id, req.body.agentType, req.body.inputData || {});
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// =========================================================================
// AUDIT & BRIEFINGS
// =========================================================================

/** GET /api/agent-ops/audit-log */
router.get('/audit-log', ...adminOnly, ensureOrchestrator, async (req, res) => {
  try {
    const { agentType, actionType, limit } = req.query;
    const log = await orchestrator.getAuditLog({ agentType, actionType, limit: parseInt(limit) || 100 });
    res.json({ success: true, data: log });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/** GET /api/agent-ops/briefings */
router.get('/briefings', ...adminOnly, ensureOrchestrator, async (req, res) => {
  try {
    const { date, agentType, limit } = req.query;
    const briefings = await orchestrator.getBriefings({ date, agentType, limit: parseInt(limit) || 20 });
    res.json({ success: true, data: briefings });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// =========================================================================
// INBOX MAINTENANCE (reduce automated noise)
// =========================================================================

/** POST /api/agent-ops/inbox/cleanup
 * Removes ALL automated heartbeat messages from ai_chat_messages.
 */
router.post('/inbox/cleanup', ...adminOnly, async (_req, res) => {
  try {
    const result = await db.query(
      `DELETE FROM ai_chat_messages
       WHERE sender_type = 'agent'
         AND recipient_type = 'operator'
         AND (
           metadata->>'source' = 'heartbeat'
           OR metadata->>'automated' = 'true'
           OR message_type = 'report'
           OR message_type = 'alert'
           OR (content LIKE 'Platform check-in%')
           OR (content LIKE 'System online%')
           OR (content LIKE 'CRM update%')
           OR (content LIKE 'Executive update%')
           OR (content LIKE 'Morning briefing%')
           OR (content LIKE 'Web mission debrief%')
           OR (content LIKE 'Credential request%')
           OR (content LIKE 'SEO check%')
           OR (content LIKE 'Social media check%')
           OR (content LIKE 'Agent cycle update%')
         )`
    );
    res.json({ success: true, data: { deleted: result?.rowCount || 0 } });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// =========================================================================
// CAPABILITY ADAPTERS
// =========================================================================

/** GET /api/agent-ops/adapters */
router.get('/adapters', ...adminOnly, ensureOrchestrator, async (req, res) => {
  try {
    const adapters = await orchestrator.getAdapters();
    res.json({ success: true, data: adapters });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// =========================================================================
// OPENCLAW-STYLE TELEMETRY (Three Organs + Memory)
// =========================================================================

/** GET /api/agent-ops/telemetry/overview */
router.get('/telemetry/overview', ...adminOnly, ensureOrchestrator, async (_req, res) => {
  try {
    const [system, runLoop, heartbeat, eventBus, memoryStats] = await Promise.all([
      orchestrator.getSystemStatus(),
      orchestrator.getRunLoopStatus(),
      orchestrator.getHeartbeatStatus(),
      orchestrator.getEventBusStats(),
      orchestrator.getMemoryStats()
    ]);
    const dynamicSkills = orchestrator.getDynamicSkills();

    res.json({
      success: true,
      data: {
        system,
        runLoop,
        heartbeat,
        eventBus,
        memoryStats,
        dynamicSkillsSummary: {
          count: Array.isArray(dynamicSkills) ? dynamicSkills.length : 0
        },
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/** GET /api/agent-ops/telemetry/run-loop */
router.get('/telemetry/run-loop', ...adminOnly, ensureOrchestrator, async (_req, res) => {
  try {
    res.json({ success: true, data: orchestrator.getRunLoopStatus() });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/** GET /api/agent-ops/telemetry/heartbeat */
router.get('/telemetry/heartbeat', ...adminOnly, ensureOrchestrator, async (_req, res) => {
  try {
    res.json({ success: true, data: orchestrator.getHeartbeatStatus() });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/** GET /api/agent-ops/telemetry/event-bus */
router.get('/telemetry/event-bus', ...adminOnly, ensureOrchestrator, async (_req, res) => {
  try {
    const stats = await orchestrator.getEventBusStats();
    res.json({ success: true, data: stats });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/** GET /api/agent-ops/telemetry/events */
router.get('/telemetry/events', ...adminOnly, ensureOrchestrator, async (req, res) => {
  try {
    const { limit, eventType, severity, since } = req.query;
    const data = await orchestrator.getRecentEvents({
      limit: Number(limit || 50),
      eventType: eventType || undefined,
      severity: severity || undefined,
      since: since || undefined
    });
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/** POST /api/agent-ops/telemetry/emit */
router.post('/telemetry/emit', ...adminOnly, ensureOrchestrator, async (req, res) => {
  try {
    const { eventType, payload } = req.body || {};
    if (!eventType) return res.status(400).json({ success: false, error: 'eventType required' });
    await orchestrator.emitEvent(String(eventType), payload || {});
    res.json({ success: true, data: { emitted: true } });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/** GET /api/agent-ops/telemetry/memory-stats */
router.get('/telemetry/memory-stats', ...adminOnly, ensureOrchestrator, async (_req, res) => {
  try {
    const data = await orchestrator.getMemoryStats();
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/** GET /api/agent-ops/telemetry/dynamic-skills */
router.get('/telemetry/dynamic-skills', ...adminOnly, ensureOrchestrator, async (_req, res) => {
  try {
    res.json({ success: true, data: orchestrator.getDynamicSkills() });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// =========================================================================
// AGENT CONTROLS
// =========================================================================

/** POST /api/agent-ops/agents/:agentType/autonomy */
router.post('/agents/:agentType/autonomy', ...adminOnly, ensureOrchestrator, async (req, res) => {
  try {
    const result = await orchestrator.setAgentAutonomy(req.params.agentType, parseInt(req.body.level));
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/** POST /api/agent-ops/mode */
router.post('/mode', ...adminOnly, ensureOrchestrator, async (req, res) => {
  try {
    const result = await orchestrator.setOperatingMode(req.body.mode);
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// =========================================================================
// EMERGENCY CONTROLS
// =========================================================================

/** POST /api/agent-ops/emergency-shutdown */
router.post('/emergency-shutdown', ...adminOnly, ensureOrchestrator, async (req, res) => {
  try {
    const result = await orchestrator.emergencyShutdown(req.body.reason || 'Manual shutdown', req.user.id);
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/** POST /api/agent-ops/resume */
router.post('/resume', ...adminOnly, ensureOrchestrator, async (req, res) => {
  try {
    const result = await orchestrator.resumeFromShutdown(req.user.id);
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// =========================================================================
// THREE ORGANS — Run Loop, Event Bus, Dynamic Skills
// =========================================================================

/** GET /api/agent-ops/run-loop — Brain Stem status */
router.get('/run-loop', ...adminOnly, ensureOrchestrator, async (req, res) => {
  try {
    const status = orchestrator.getRunLoopStatus();
    res.json({ success: true, data: status });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/** POST /api/agent-ops/workflows/:name/trigger — Trigger a workflow */
router.post('/workflows/:name/trigger', ...adminOnly, ensureOrchestrator, async (req, res) => {
  try {
    const result = await orchestrator.triggerWorkflow(req.params.name, req.body || {});
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/** POST /api/agent-ops/workflows/:id/resume — Resume a halted workflow */
router.post('/workflows/:id/resume', ...adminOnly, ensureOrchestrator, async (req, res) => {
  try {
    const { approved } = req.body;
    const result = await orchestrator.resumeWorkflow(req.params.id, approved !== false, req.user.id);
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/** GET /api/agent-ops/events — Nervous System recent events */
router.get('/events', ...adminOnly, ensureOrchestrator, async (req, res) => {
  try {
    const events = await orchestrator.getRecentEvents({
      limit: parseInt(req.query.limit) || 50,
      eventType: req.query.type,
      severity: req.query.severity
    });
    res.json({ success: true, data: events });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/** GET /api/agent-ops/events/stats — Event Bus statistics */
router.get('/events/stats', ...adminOnly, ensureOrchestrator, async (req, res) => {
  try {
    const stats = await orchestrator.getEventBusStats();
    res.json({ success: true, data: stats });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/** POST /api/agent-ops/events/emit — Emit an event manually */
router.post('/events/emit', ...adminOnly, ensureOrchestrator, async (req, res) => {
  try {
    const { eventType, payload } = req.body;
    if (!eventType) return res.status(400).json({ success: false, error: 'eventType required' });
    await orchestrator.emitEvent(eventType, payload || {});
    res.json({ success: true, data: { emitted: eventType } });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/** GET /api/agent-ops/dynamic-skills — Reflexes: list all discovered skills */
router.get('/dynamic-skills', ...adminOnly, ensureOrchestrator, async (req, res) => {
  try {
    const skills = orchestrator.getDynamicSkills();
    res.json({ success: true, data: skills });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// =========================================================================
// MEMORY — Persistent Memory Telemetry + Browsing
// =========================================================================

/** GET /api/agent-ops/memory/stats — Second Brain stats */
router.get('/memory/stats', ...adminOnly, ensureOrchestrator, async (req, res) => {
  try {
    const stats = await orchestrator.getMemoryStats();
    res.json({ success: true, data: stats });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/** GET /api/agent-ops/memory/:agentType — Browse memory for an agent */
router.get('/memory/:agentType', ...adminOnly, ensureOrchestrator, async (req, res) => {
  try {
    const { agentType } = req.params;
    const limit = parseInt(req.query.limit) || 30;
    const memory = await orchestrator.listMemory(agentType, { limit, type: req.query.type });
    res.json({ success: true, data: memory });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/** POST /api/agent-ops/memory/:agentType — Store a memory (operator-authored) */
router.post('/memory/:agentType', ...adminOnly, ensureOrchestrator, async (req, res) => {
  try {
    const { agentType } = req.params;
    const { key, value, type, importance, source } = req.body || {};
    if (!key) return res.status(400).json({ success: false, error: 'key required' });
    if (value === undefined) return res.status(400).json({ success: false, error: 'value required' });
    await orchestrator.storeMemory(agentType, String(key), value, {
      type: type || 'context',
      importance: typeof importance === 'number' ? importance : 0.6,
      source: source || 'operator'
    });
    res.json({ success: true, data: { stored: true } });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// =========================================================================
// GOAL ENGINE — Forecasts, Milestones, CEO Dashboard
// =========================================================================

/** GET /api/agent-ops/goals/:agentId — Get agent goals */
router.get('/goals/:agentId', ...adminOnly, ensureOrchestrator, async (req, res) => {
  try {
    const { timeframe } = req.query;
    const goals = await orchestrator.getAgentGoals(req.params.agentId, timeframe);
    res.json({ success: true, data: goals });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/** PUT /api/agent-ops/goals/:agentId/:timeframe — Update goal progress */
router.put('/goals/:agentId/:timeframe', ...adminOnly, ensureOrchestrator, async (req, res) => {
  try {
    const result = await orchestrator.updateGoalProgress(req.params.agentId, req.params.timeframe, req.body);
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/** POST /api/agent-ops/milestones — Create a milestone */
router.post('/milestones', ...adminOnly, ensureOrchestrator, async (req, res) => {
  try {
    const milestone = await orchestrator.createMilestone(req.body);
    res.json({ success: true, data: milestone });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/** GET /api/agent-ops/milestones — Get milestones */
router.get('/milestones', ...adminOnly, ensureOrchestrator, async (req, res) => {
  try {
    const { status } = req.query;
    const milestones = await orchestrator.getMilestones(status);
    res.json({ success: true, data: milestones });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/** PUT /api/agent-ops/milestones/:id/achieve — Mark milestone achieved */
router.put('/milestones/:id/achieve', ...adminOnly, ensureOrchestrator, async (req, res) => {
  try {
    const result = await orchestrator.achieveMilestone(req.params.id);
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/** GET /api/agent-ops/ceo-dashboard — CEO aggregated view */
router.get('/ceo-dashboard', ...adminOnly, ensureOrchestrator, async (req, res) => {
  try {
    const dashboard = await orchestrator.getCEODashboard();
    res.json({ success: true, data: dashboard });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// =========================================================================
// HEALTH (no auth for monitoring)
// =========================================================================

/** GET /api/agent-ops/health */
router.get('/health', (req, res) => {
  res.json({
    success: true,
    service: 'DoctaRx AI Agent Orchestrator',
    version: '3.0.0-organism',
    status: orchestrator?.initialized ? 'operational' : 'initializing',
    operatingMode: orchestrator?.operatingMode || 'unknown',
    organs: {
      brainStem: orchestrator?.runLoop?.isRunning ? 'ALIVE' : 'SLEEPING',
      nervousSystem: orchestrator?.eventBus?.initialized ? 'CONNECTED' : 'OFFLINE',
      reflexes: orchestrator?.skillSelector?.skills?.size || 0,
      goalEngine: orchestrator?.goalEngine?.initialized ? 'TRACKING' : 'OFFLINE',
      nerveBridge: 'CONNECTED'
    }
  });
});

module.exports = router;
