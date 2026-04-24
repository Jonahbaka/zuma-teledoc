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

  async initialize(options = {}) {
    if (this.initialized) return;

    const { orchestrator, db, app } = options;
    this.orchestrator = orchestrator;

    console.log('[NemoClaw] Initializing secure sandbox integration...');

    const auditLogger = async (entry) => {
      try {
        if (db) {
          await db.query(
            `INSERT INTO ai_audit_log (action, details, agent_id, created_at) VALUES ($1, $2, $3, NOW())`,
            [`nemoclaw:${entry.event}`, JSON.stringify(entry), entry.agentType || 'nemoclaw']
          );
        }
      } catch {
        // Non-critical audit failures should not block startup.
      }

      if (process.env.NODE_ENV !== 'production') {
        console.log(`[NemoClaw] ${entry.event}:`, JSON.stringify(entry));
      }
    };

    this.privacyRouter = new PrivacyRouter({
      enabled: true,
      auditLogger
    });
    console.log('[NemoClaw] Privacy Router initialized (HIPAA Safe Harbor patterns loaded)');

    this.powerManager = new PowerManager({
      defaultMode: process.env.NEMOCLAW_POWER_MODE || 'local_gpu',
      initialBattery: parseInt(process.env.NEMOCLAW_INITIAL_BATTERY, 10) || 100,
      batterySource: process.env.BATTERY_API_URL ? 'api' : 'manual',
      batteryApiUrl: process.env.BATTERY_API_URL || null,
      ollamaUrl: process.env.OLLAMA_URL || 'http://127.0.0.1:11434'
    });

    this.powerManager.onChange((event) => {
      auditLogger({
        event: 'power_mode_change',
        ...event
      });
      console.log(`[NemoClaw] Power mode: ${event.from} -> ${event.to} (battery: ${event.batteryLevel}%)`);
    });

    if (process.env.BATTERY_API_URL) {
      this.powerManager.startPolling();
    }
    console.log(`[NemoClaw] Power Manager initialized (mode: ${this.powerManager.mode})`);

    this.gatewayBridge = new NemoClawGatewayBridge({
      privacyRouter: this.privacyRouter,
      orchestrator: this.orchestrator,
      auditLogger
    });

    this.gatewayBridge.connect().then(() => {
      const gatewayStatus = this.gatewayBridge.getStatus();
      if (gatewayStatus.sandboxActive) {
        console.log('[NemoClaw] Gateway Bridge connected via dedicated sandbox runtime');
      } else {
        console.warn('[NemoClaw] Dedicated sandbox unavailable - compatibility mode active');
      }
      this._registerAgents();
    }).catch((err) => {
      console.warn(`[NemoClaw] Gateway not available (${err.message}) - operating in standalone mode`);
    });

    this._setupRoutes();
    if (app) {
      app.use('/api/openclaw', this.privacyRouter.middleware());
      app.use('/api/hive', this.privacyRouter.middleware());
      app.use('/api/agent-chat', this.privacyRouter.middleware());
      app.use('/api/nemoclaw', this.router);
    }

    this.initialized = true;
    console.log('[NemoClaw] Secure sandbox integration ready');
  }

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

  _setupRoutes() {
    this.router.get('/health', (req, res) => {
      res.json({
        ok: true,
        data: {
          status: this.getOperationalStatus(),
          initialized: this.initialized,
          gateway: this.gatewayBridge?.getStatus() || null,
          power: this.powerManager?.getStatus() || null,
          privacy: this.privacyRouter?.getStats() || null
        }
      });
    });

    this.router.get('/power', this.powerManager.statusRoute());
    this.router.post('/power/battery', this.powerManager.setBatteryRoute());
    this.router.post('/power/override', this.powerManager.overrideRoute());

    this.router.get('/inference/:agentType', (req, res) => {
      const target = this.powerManager.getInferenceTarget(
        req.params.agentType,
        req.query.modelSize || 'medium'
      );
      res.json({ ok: true, data: target });
    });

    this.router.post('/scrub', (req, res) => {
      const { text } = req.body;
      if (!text) return res.status(400).json({ ok: false, error: 'text required' });
      const result = this.privacyRouter.scrubText(text);
      res.json({ ok: true, data: result });
    });

    this.router.get('/gateway', (req, res) => {
      res.json({
        ok: true,
        data: this.gatewayBridge?.getStatus() || { connected: false }
      });
    });
  }

  getOperationalStatus() {
    const gateway = this.gatewayBridge?.getStatus() || null;
    const sandboxActive = Boolean(gateway?.connected && gateway?.sandboxActive);

    if (!this.initialized) {
      return {
        state: 'initializing',
        sandboxActive: false,
        connectionMode: gateway?.connectionMode || 'disconnected'
      };
    }

    if (sandboxActive) {
      return {
        state: 'online',
        sandboxActive: true,
        connectionMode: gateway.connectionMode,
        activeEndpoint: gateway.activeEndpoint
      };
    }

    return {
      state: 'degraded',
      sandboxActive: false,
      connectionMode: gateway?.connectionMode || 'disconnected',
      activeEndpoint: gateway?.activeEndpoint || null,
      reason: gateway?.lastError || 'Dedicated sandbox runtime unavailable'
    };
  }

  getInferenceTarget(agentType, modelSize) {
    if (!this.powerManager) {
      return { target: 'local', provider: 'ollama', reason: 'PowerManager not initialized' };
    }
    return this.powerManager.getInferenceTarget(agentType, modelSize);
  }

  scrubPII(content) {
    if (!this.privacyRouter) {
      return { scrubbed: content, wasScrubbed: false, detections: [] };
    }
    if (typeof content === 'string') return this.privacyRouter.scrubText(content);
    return this.privacyRouter.scrubObject(content);
  }

  isAgentAllowed(agentType) {
    if (!this.powerManager) return true;
    return this.powerManager.isAgentAllowed(agentType);
  }

  async shutdown() {
    console.log('[NemoClaw] Shutting down...');
    this.powerManager?.stopPolling();
    this.gatewayBridge?.disconnect();
    this.initialized = false;
  }
}

const nemoClawService = new NemoClawService();
module.exports = nemoClawService;
module.exports.NemoClawService = NemoClawService;
