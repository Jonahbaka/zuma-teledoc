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

let orchestrator;
try {
  orchestrator = require('../services/agent-orchestrator');
} catch (error) {
  console.error('Agent Orchestrator not available:', error.message);
}

const ensureOrchestrator = (req, res, next) => {
  if (!orchestrator) return res.status(503).json({ success: false, error: 'Agent Orchestrator not available' });
  next();
};

// All routes require admin/super_admin
const adminOnly = [authenticate, requireRole('admin', 'super_admin')];

// =========================================================================
// DASHBOARD & STATUS
// =========================================================================

/** GET /api/agent-ops/dashboard */
router.get('/dashboard', ...adminOnly, ensureOrchestrator, async (req, res) => {
  try {
    const dashboard = await orchestrator.getDashboard();
    res.json({ success: true, data: dashboard });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/** GET /api/agent-ops/status */
router.get('/status', ...adminOnly, ensureOrchestrator, async (req, res) => {
  try {
    const status = await orchestrator.getSystemStatus();
    res.json({ success: true, data: status });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// =========================================================================
// AGENT EXECUTION
// =========================================================================

/** POST /api/agent-ops/run/:agentType - Run a single agent */
router.post('/run/:agentType', ...adminOnly, ensureOrchestrator, async (req, res) => {
  try {
    const { agentType } = req.params;
    const result = await orchestrator.runAgent(agentType, { triggeredBy: req.user.id });
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/** POST /api/agent-ops/run-all - Run all agents */
router.post('/run-all', ...adminOnly, ensureOrchestrator, async (req, res) => {
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
router.get('/proposals', ...adminOnly, ensureOrchestrator, async (req, res) => {
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
