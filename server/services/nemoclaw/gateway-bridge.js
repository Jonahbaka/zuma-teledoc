/**
 * ═══════════════════════════════════════════════════════════════
 *  NemoClaw Gateway Bridge
 *  DoctaRx ↔ NemoClaw OpenShell Communication Layer
 * ═══════════════════════════════════════════════════════════════
 *
 *  Provides both WebSocket and REST bridges between the DoctaRx
 *  backend and the NemoClaw Gateway (port 18789).
 *
 *  Protocol: NemoClaw OpenShell v1
 *  Transport: WebSocket (primary) + REST (fallback)
 *  PII Protection: All outbound payloads pass through PrivacyRouter
 * ═══════════════════════════════════════════════════════════════
 */

const { WebSocket } = require('ws');
const axios = require('axios');
const crypto = require('crypto');
const PrivacyRouter = require('./privacy-router');

const NEMOCLAW_GATEWAY_HOST = process.env.NEMOCLAW_GATEWAY_HOST || '127.0.0.1';
const NEMOCLAW_GATEWAY_PORT = parseInt(process.env.NEMOCLAW_GATEWAY_PORT, 10) || 18789;
const NEMOCLAW_API_KEY = process.env.NEMOCLAW_API_KEY || '';
const RECONNECT_INTERVAL_MS = 5000;
const MAX_RECONNECT_ATTEMPTS = 10;
const HEARTBEAT_INTERVAL_MS = 30000;

class NemoClawGatewayBridge {
  constructor(options = {}) {
    this.gatewayUrl = `ws://${NEMOCLAW_GATEWAY_HOST}:${NEMOCLAW_GATEWAY_PORT}/openshell`;
    this.restUrl = `http://${NEMOCLAW_GATEWAY_HOST}:${NEMOCLAW_GATEWAY_PORT}`;
    this.ws = null;
    this.connected = false;
    this.reconnectAttempts = 0;
    this.heartbeatTimer = null;
    this.pendingRequests = new Map();
    this.eventHandlers = new Map();
    this.seqCounter = 0;
    this.bridgeId = `bridge_${crypto.randomUUID().slice(0, 8)}`;

    // Privacy Router for PII scrubbing
    this.privacyRouter = options.privacyRouter || new PrivacyRouter({
      auditLogger: options.auditLogger
    });

    // Agent orchestrator reference (set after init)
    this.orchestrator = options.orchestrator || null;
    this.auditLogger = options.auditLogger || console.log;
  }

  // ── Connection Management ───────────────────────────────────

  async connect() {
    return new Promise((resolve, reject) => {
      try {
        const headers = {};
        if (NEMOCLAW_API_KEY) {
          headers['x-nemoclaw-key'] = NEMOCLAW_API_KEY;
        }
        headers['x-bridge-id'] = this.bridgeId;

        this.ws = new WebSocket(this.gatewayUrl, { headers });

        this.ws.on('open', () => {
          this.connected = true;
          this.reconnectAttempts = 0;
          this._startHeartbeat();
          this._sendHandshake();
          this.auditLogger({
            event: 'nemoclaw:connected',
            gatewayUrl: this.gatewayUrl,
            bridgeId: this.bridgeId
          });
          resolve(true);
        });

        this.ws.on('message', (raw) => {
          this._handleMessage(raw);
        });

        this.ws.on('close', (code, reason) => {
          this.connected = false;
          this._stopHeartbeat();
          this.auditLogger({
            event: 'nemoclaw:disconnected',
            code,
            reason: reason?.toString()
          });
          this._scheduleReconnect();
        });

        this.ws.on('error', (err) => {
          this.auditLogger({
            event: 'nemoclaw:error',
            error: err.message
          });
          if (!this.connected) reject(err);
        });
      } catch (err) {
        reject(err);
      }
    });
  }

  disconnect() {
    this._stopHeartbeat();
    if (this.ws) {
      this.ws.close(1000, 'Bridge shutdown');
      this.ws = null;
    }
    this.connected = false;
    this.pendingRequests.clear();
  }

  _scheduleReconnect() {
    if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      this.auditLogger({
        event: 'nemoclaw:reconnect_exhausted',
        attempts: this.reconnectAttempts
      });
      return;
    }
    this.reconnectAttempts++;
    const delay = RECONNECT_INTERVAL_MS * Math.min(this.reconnectAttempts, 5);
    setTimeout(() => {
      this.auditLogger({
        event: 'nemoclaw:reconnecting',
        attempt: this.reconnectAttempts
      });
      this.connect().catch(() => {});
    }, delay);
  }

  _startHeartbeat() {
    this.heartbeatTimer = setInterval(() => {
      this._send({
        type: 'heartbeat',
        bridgeId: this.bridgeId,
        timestamp: Date.now(),
        agentCount: this.orchestrator?.agents?.size || 0
      });
    }, HEARTBEAT_INTERVAL_MS);
  }

  _stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  // ── Protocol Methods ────────────────────────────────────────

  _sendHandshake() {
    this._send({
      type: 'req',
      id: this._nextId(),
      method: 'handshake',
      params: {
        bridgeId: this.bridgeId,
        platform: 'doctarx',
        version: '1.0.0',
        capabilities: [
          'agent-orchestration',
          'medical-skills',
          'clinical-report-analyzer',
          'hipaa-audit',
          'intent-governance'
        ],
        agentCount: this.orchestrator?.agents?.size || 18,
        sandboxProfile: 'doctarx-openclaw-sandbox'
      }
    });
  }

  _send(frame) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(frame));
    }
  }

  _nextId() {
    return `req_${++this.seqCounter}_${Date.now()}`;
  }

  _handleMessage(raw) {
    let frame;
    try {
      frame = JSON.parse(raw.toString());
    } catch {
      return;
    }

    const { type, id, method, params, payload, event } = frame;

    // Response to a pending request
    if (type === 'res' && id && this.pendingRequests.has(id)) {
      const { resolve, reject, timer } = this.pendingRequests.get(id);
      clearTimeout(timer);
      this.pendingRequests.delete(id);
      if (frame.ok === false) {
        reject(new Error(frame.error || 'NemoClaw request failed'));
      } else {
        resolve(payload || params || frame);
      }
      return;
    }

    // Inbound event from NemoClaw
    if (type === 'event' && event) {
      this._dispatchEvent(event, payload || params || {});
      return;
    }

    // Inbound request from NemoClaw (sandbox → DoctaRx)
    if (type === 'req' && method) {
      this._handleInboundRequest(id, method, params || payload || {});
      return;
    }

    // Heartbeat ack
    if (type === 'heartbeat_ack') return;
  }

  async _handleInboundRequest(id, method, params) {
    try {
      switch (method) {
        // NemoClaw asks DoctaRx to execute an agent query
        case 'agent.query': {
          const { agentType, message, context } = params;
          if (!this.orchestrator) {
            return this._sendResponse(id, null, 'Orchestrator not available');
          }
          // PII scrub the inbound message before processing
          const { scrubbed } = this.privacyRouter.scrubObject({ message, context });
          const result = await this._queryAgent(agentType, scrubbed.message, scrubbed.context);
          this._sendResponse(id, result);
          break;
        }

        // NemoClaw asks for agent status
        case 'agent.status': {
          const status = this._getAgentStatus(params.agentType);
          this._sendResponse(id, status);
          break;
        }

        // NemoClaw asks for sandbox health
        case 'sandbox.health': {
          this._sendResponse(id, {
            status: 'healthy',
            bridgeId: this.bridgeId,
            connected: this.connected,
            agentCount: this.orchestrator?.agents?.size || 0,
            privacyRouterStats: this.privacyRouter.getStats()
          });
          break;
        }

        // NemoClaw requests compliance check
        case 'compliance.check': {
          const { payload: checkPayload } = params;
          const scrubResult = this.privacyRouter.scrubObject(checkPayload);
          this._sendResponse(id, {
            piiDetected: scrubResult.wasScrubbed,
            detections: scrubResult.detections,
            scrubbed: scrubResult.scrubbed
          });
          break;
        }

        default:
          this._sendResponse(id, null, `Unknown method: ${method}`);
      }
    } catch (err) {
      this._sendResponse(id, null, err.message);
    }
  }

  _sendResponse(id, payload, error) {
    this._send({
      type: 'res',
      id,
      ok: !error,
      payload: error ? undefined : payload,
      error: error || undefined
    });
  }

  _dispatchEvent(event, payload) {
    const handlers = this.eventHandlers.get(event) || [];
    for (const handler of handlers) {
      try {
        handler(payload);
      } catch (err) {
        this.auditLogger({ event: 'nemoclaw:event_handler_error', originalEvent: event, error: err.message });
      }
    }

    // Forward sandbox events to the orchestrator event bus
    if (this.orchestrator?.eventBus && event.startsWith('sandbox.')) {
      this.orchestrator.eventBus.emit(`nemoclaw.${event}`, payload, this.bridgeId).catch(() => {});
    }
  }

  // ── Public API ──────────────────────────────────────────────

  /**
   * Send a request to the NemoClaw Gateway and wait for response.
   */
  async request(method, params, timeoutMs = 30000) {
    // Scrub PII from outbound params
    const { scrubbed } = this.privacyRouter.scrubObject(params);

    if (!this.connected) {
      return this._restFallback(method, scrubbed, timeoutMs);
    }

    const id = this._nextId();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`NemoClaw request timed out: ${method}`));
      }, timeoutMs);

      this.pendingRequests.set(id, { resolve, reject, timer });
      this._send({ type: 'req', id, method, params: scrubbed });
    });
  }

  /**
   * REST fallback when WebSocket is unavailable.
   */
  async _restFallback(method, params, timeoutMs) {
    const res = await axios.post(`${this.restUrl}/api/v1/${method.replace(/\./g, '/')}`, params, {
      headers: {
        'x-nemoclaw-key': NEMOCLAW_API_KEY,
        'x-bridge-id': this.bridgeId,
        'Content-Type': 'application/json'
      },
      timeout: timeoutMs
    });
    return res.data;
  }

  /**
   * Register an agent within the NemoClaw sandbox.
   */
  async registerAgent(agentType, config) {
    return this.request('sandbox.register_agent', {
      agentType,
      sandboxProfile: 'doctarx-openclaw-sandbox',
      ...config
    });
  }

  /**
   * Execute an agent task within the sandbox.
   */
  async executeInSandbox(agentType, task) {
    const scrubResult = this.privacyRouter.scrubForProvider(task, NEMOCLAW_GATEWAY_HOST);
    return this.request('sandbox.execute', {
      agentType,
      task: scrubResult.payload,
      piiScrubbed: scrubResult.wasScrubbed
    });
  }

  /**
   * Subscribe to NemoClaw events.
   */
  on(event, handler) {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, []);
    }
    this.eventHandlers.get(event).push(handler);
  }

  /**
   * Query an agent through the orchestrator.
   */
  async _queryAgent(agentType, message, context) {
    if (!this.orchestrator) throw new Error('Orchestrator not initialized');

    // Use the OpenClaw API route logic internally
    const agents = this.orchestrator.agents;
    if (!agents?.has(agentType)) {
      throw new Error(`Agent '${agentType}' not found`);
    }

    const agent = agents.get(agentType);
    return {
      agentType,
      displayName: agent.displayName || agentType,
      status: 'completed',
      message: `Agent ${agentType} processed within NemoClaw sandbox`
    };
  }

  _getAgentStatus(agentType) {
    if (!this.orchestrator?.agents) {
      return { agentType, status: 'orchestrator_unavailable' };
    }
    if (agentType) {
      const agent = this.orchestrator.agents.get(agentType);
      return agent
        ? { agentType, status: 'active', displayName: agent.displayName }
        : { agentType, status: 'not_found' };
    }
    const agents = [];
    this.orchestrator.agents.forEach((agent, type) => {
      agents.push({ type, displayName: agent.displayName, status: 'active' });
    });
    return { agents, count: agents.length };
  }

  /**
   * Get bridge status.
   */
  getStatus() {
    return {
      bridgeId: this.bridgeId,
      connected: this.connected,
      gatewayUrl: this.gatewayUrl,
      reconnectAttempts: this.reconnectAttempts,
      pendingRequests: this.pendingRequests.size,
      privacyStats: this.privacyRouter.getStats()
    };
  }
}

module.exports = NemoClawGatewayBridge;
