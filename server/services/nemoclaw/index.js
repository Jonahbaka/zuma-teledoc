/**
 * ═══════════════════════════════════════════════════════════════
 *  NemoClaw Integration Service
 *  DoctaRx — OpenShell Secure Sandbox for Medical Agents
 * ═══════════════════════════════════════════════════════════════
 *
 *  Orchestrates all NemoClaw components:
 *    - Gateway Bridge (WebSocket + REST to NemoClaw Gateway)
 *    - Privacy Router (PII scrubbing middleware)
 *    - Power Manager (GPU/Cloud inference toggle)
 *
 *  Lifecycle:
 *    1. Initialize Privacy Router
 *    2. Initialize Power Manager (start battery polling if configured)
 *    3. Connect Gateway Bridge to NemoClaw Gateway
 *    4. Register all OpenClaw agents in the sandbox
 *    5. Attach middleware to Express app
 * ═══════════════════════════════════════════════════════════════
 */

const NemoClawGatewayBridge = require('./gateway-bridge');
const PrivacyRouter = require('./privacy-router');
const PowerManager = require('./power-manager');
const express = require('express');

class NemoClawService {
  constructor() {
    this.initialized = false;
    this.privacyRouter = null;
    this.gatewayBridge = null;
    this.powerManager = null;
    this.orchestrator = null;
    this.router = express.Router();
  }

  /**
   * Initialize all NemoClaw subsystems.
   *
   * @param {object} options
   * @param {object} options.orchestrator - Agent orchestrator reference
   * @param {object} options.db - Database connection (for audit logging)
   * @param {object} options.app - Express app (to mount middleware)
   */
  async initialize(options = {}) {
    if (this.initialized) return;

    const { orchestrator, db, app } = options;
    this.orchestrator = orchestrator;

    console.log('[NemoClaw] Initializing secure sandbox integration...');

    // ── 1. Audit Logger ───────────────────────────────────────
    const auditLogger = async (entry) => {
      try {
        if (db) {
          await db.query(
            `INSERT INTO ai_audit_log (action, details, agent_id, created_at) VALUES ($1, $2, $3, NOW())`,
            [`nemoclaw:${entry.event}`, JSON.stringify(entry), entry.agentType || 'nemoclaw']
          );
        }
      } catch { /* non-critical */ }
      if (process.env.NODE_ENV !== 'production') {
        console.log(`[NemoClaw] ${entry.event}:`, JSON.stringify(entry));
      }
    };

    // ── 2. Privacy Router ─────────────────────────────────────
    this.privacyRouter = new PrivacyRouter({
      enabled: true,
      auditLogger
    });
    console.log('[NemoClaw] Privacy Router initialized (HIPAA Safe Harbor patterns loaded)');

    // ── 3. Power Manager ──────────────────────────────────────
    this.powerManager = new PowerManager({
      defaultMode: process.env.NEMOCLAW_POWER_MODE || 'local_gpu',
      initialBattery: parseInt(process.env.NEMOCLAW_INITIAL_BATTERY, 10) || 100,
      batterySource: process.env.BATTERY_API_URL ? 'api' : 'manual',
      batteryApiUrl: process.env.BATTERY_API_URL || null,
      ollamaUrl: process.env.OLLAMA_URL || 'http://127.0.0.1:11434'
    });

    // Log power mode changes
    this.powerManager.onChange((event) => {
      auditLogger({
        event: 'power_mode_change',
        ...event
      });
      console.log(`[NemoClaw] Power mode: ${event.from} → ${event.to} (battery: ${event.batteryLevel}%)`);
    });

    // Start battery polling if API source configured
    if (process.env.BATTERY_API_URL) {
      this.powerManager.startPolling();
    }
    console.log(`[NemoClaw] Power Manager initialized (mode: ${this.powerManager.mode})`);

    // ── 4. Gateway Bridge ─────────────────────────────────────
    this.gatewayBridge = new NemoClawGatewayBridge({
      privacyRouter: this.privacyRouter,
      orchestrator: this.orchestrator,
      auditLogger
    });

    // Attempt gateway connection (non-blocking — operates in REST fallback if unavailable)
    this.gatewayBridge.connect().then(() => {
      console.log('[NemoClaw] Gateway Bridge connected via WebSocket');
      this._registerAgents();
    }).catch((err) => {
      console.warn(`[NemoClaw] Gateway not available (${err.message}) — operating in standalone mode`);
    });

    // ── 5. Mount API Routes ───────────────────────────────────
    this._setupRoutes();
    if (app) {
      // Mount Privacy Router middleware on agent-facing routes
      app.use('/api/openclaw', this.privacyRouter.middleware());
      app.use('/api/hive', this.privacyRouter.middleware());
      app.use('/api/agent-chat', this.privacyRouter.middleware());
      // Mount NemoClaw management routes
      app.use('/api/nemoclaw', this.router);
    }

    this.initialized = true;
    console.log('[NemoClaw] Secure sandbox integration ready');
  }

  /**
   * Register all orchestrator agents in the NemoClaw sandbox.
   */
  async _registerAgents() {
    if (!this.orchestrator?.agents || !this.gatewayBridge?.connected) return;

    for (const [agentType, agent] of this.orchestrator.agents) {
      try {
        await this.gatewayBridge.registerAgent(agentType, {
          displayName: agent.displayName || agentType,
          securityTier: this._getSecurityTier(agentType),
          capabilities: agent.capabilities || []
        });
      } catch (err) {
        console.warn(`[NemoClaw] Failed to register agent '${agentType}': ${err.message}`);
      }
    }
  }

  _getSecurityTier(agentType) {
    const critical = ['asclepius', 'pharmacist', 'compliance'];
    const high = ['triage_nurse', 'governance', 'ceo', 'accounting'];
    if (critical.includes(agentType)) return 'critical';
    if (high.includes(agentType)) return 'high';
    return 'medium';
  }

  /**
   * Set up NemoClaw management API routes.
   */
  _setupRoutes() {
    // GET /api/nemoclaw/health — Overall NemoClaw status
    this.router.get('/health', (req, res) => {
      res.json({
        ok: true,
        data: {
          initialized: this.initialized,
          gateway: this.gatewayBridge?.getStatus() || null,
          power: this.powerManager?.getStatus() || null,
          privacy: this.privacyRouter?.getStats() || null
        }
      });
    });

    // GET /api/nemoclaw/power — Power status
    this.router.get('/power', this.powerManager.statusRoute());

    // POST /api/nemoclaw/power/battery — Update battery level
    this.router.post('/power/battery', this.powerManager.setBatteryRoute());

    // POST /api/nemoclaw/power/override — Manual mode override
    this.router.post('/power/override', this.powerManager.overrideRoute());

    // GET /api/nemoclaw/inference/:agentType — Get inference target for agent
    this.router.get('/inference/:agentType', (req, res) => {
      const target = this.powerManager.getInferenceTarget(
        req.params.agentType,
        req.query.modelSize || 'medium'
      );
      res.json({ ok: true, data: target });
    });

    // POST /api/nemoclaw/scrub — Test PII scrubbing
    this.router.post('/scrub', (req, res) => {
      const { text } = req.body;
      if (!text) return res.status(400).json({ ok: false, error: 'text required' });
      const result = this.privacyRouter.scrubText(text);
      res.json({ ok: true, data: result });
    });

    // GET /api/nemoclaw/gateway — Gateway bridge status
    this.router.get('/gateway', (req, res) => {
      res.json({
        ok: true,
        data: this.gatewayBridge?.getStatus() || { connected: false }
      });
    });
  }

  /**
   * Get inference target for a specific agent (used by orchestrator).
   */
  getInferenceTarget(agentType, modelSize) {
    if (!this.powerManager) return { target: 'local', provider: 'ollama', reason: 'PowerManager not initialized' };
    return this.powerManager.getInferenceTarget(agentType, modelSize);
  }

  /**
   * Scrub PII from content (used by orchestrator before external calls).
   */
  scrubPII(content) {
    if (!this.privacyRouter) return { scrubbed: content, wasScrubbed: false, detections: [] };
    if (typeof content === 'string') return this.privacyRouter.scrubText(content);
    return this.privacyRouter.scrubObject(content);
  }

  /**
   * Check if an agent can run in the current power mode.
   */
  isAgentAllowed(agentType) {
    if (!this.powerManager) return true;
    return this.powerManager.isAgentAllowed(agentType);
  }

  /**
   * Graceful shutdown.
   */
  async shutdown() {
    console.log('[NemoClaw] Shutting down...');
    this.powerManager?.stopPolling();
    this.gatewayBridge?.disconnect();
    this.initialized = false;
  }
}

// Singleton export
const nemoClawService = new NemoClawService();
module.exports = nemoClawService;
module.exports.NemoClawService = NemoClawService;
