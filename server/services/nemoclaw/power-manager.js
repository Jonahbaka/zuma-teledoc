/**
 * ═══════════════════════════════════════════════════════════════
 *  Power Manager — Local GPU ↔ Cloud Inference Toggle
 *  DoctaRx NemoClaw Integration
 * ═══════════════════════════════════════════════════════════════
 *
 *  Manages inference routing based on power availability.
 *  Designed for solar-powered environments where local GPU
 *  compute must be throttled when battery levels drop.
 *
 *  Modes:
 *    LOCAL_GPU    — Full local inference via Ollama (battery > 50%)
 *    HYBRID       — Local for small models, cloud for large (20-50%)
 *    CLOUD_ONLY   — All inference routed to cloud LLM (battery < 20%)
 *    EMERGENCY    — Minimal operation, critical agents only (< 10%)
 *
 *  Battery source: hardware sensor, API, or manual override
 * ═══════════════════════════════════════════════════════════════
 */

const INFERENCE_MODES = {
  LOCAL_GPU: 'local_gpu',
  HYBRID: 'hybrid',
  CLOUD_ONLY: 'cloud_only',
  EMERGENCY: 'emergency'
};

const BATTERY_THRESHOLDS = {
  LOCAL_GPU: 50,    // above 50%: full local inference
  HYBRID: 20,       // 20-50%: hybrid mode
  CLOUD_ONLY: 10,   // 10-20%: cloud only
  EMERGENCY: 0      // below 10%: emergency mode
};

// Agents allowed in emergency mode (clinical safety)
const EMERGENCY_AGENTS = new Set([
  'triage_nurse',
  'asclepius',
  'pharmacist',
  'compliance',
  'devops'
]);

class PowerManager {
  constructor(options = {}) {
    this.mode = options.defaultMode || INFERENCE_MODES.LOCAL_GPU;
    this.batteryLevel = options.initialBattery || 100;
    this.solarCharging = false;
    this.manualOverride = null;
    this.ollamaUrl = options.ollamaUrl || process.env.OLLAMA_URL || 'http://127.0.0.1:11434';
    this.pollIntervalMs = options.pollIntervalMs || 60000; // 1 minute
    this.batterySource = options.batterySource || 'manual'; // 'manual', 'api', 'sensor'
    this.batteryApiUrl = options.batteryApiUrl || process.env.BATTERY_API_URL || null;
    this.pollTimer = null;
    this.listeners = [];
    this.history = [];
    this.maxHistoryEntries = 1440; // 24 hours at 1-min intervals

    this._inferMode();
  }

  // ── Mode Determination ────────────────────────────────────

  _inferMode() {
    if (this.manualOverride) {
      this.mode = this.manualOverride;
      return;
    }

    let newMode;
    if (this.batteryLevel > BATTERY_THRESHOLDS.LOCAL_GPU) {
      newMode = INFERENCE_MODES.LOCAL_GPU;
    } else if (this.batteryLevel > BATTERY_THRESHOLDS.HYBRID) {
      newMode = INFERENCE_MODES.HYBRID;
    } else if (this.batteryLevel > BATTERY_THRESHOLDS.CLOUD_ONLY) {
      newMode = INFERENCE_MODES.CLOUD_ONLY;
    } else {
      newMode = INFERENCE_MODES.EMERGENCY;
    }

    if (newMode !== this.mode) {
      const previousMode = this.mode;
      this.mode = newMode;
      this._notify({
        event: 'mode_change',
        from: previousMode,
        to: newMode,
        batteryLevel: this.batteryLevel,
        solarCharging: this.solarCharging
      });
    }
  }

  // ── Battery Level Management ──────────────────────────────

  /**
   * Update battery level (0-100).
   * Automatically adjusts inference mode.
   */
  setBatteryLevel(level, charging = false) {
    this.batteryLevel = Math.max(0, Math.min(100, level));
    this.solarCharging = charging;
    this.history.push({
      timestamp: Date.now(),
      level: this.batteryLevel,
      charging,
      mode: this.mode
    });
    if (this.history.length > this.maxHistoryEntries) {
      this.history = this.history.slice(-this.maxHistoryEntries);
    }
    this._inferMode();
  }

  /**
   * Poll battery level from external API.
   */
  async pollBattery() {
    if (this.batterySource === 'manual' || !this.batteryApiUrl) return;

    try {
      const axios = require('axios');
      const res = await axios.get(this.batteryApiUrl, { timeout: 5000 });
      const data = res.data;
      const level = data.level ?? data.batteryLevel ?? data.percentage ?? data.battery;
      const charging = data.charging ?? data.solarCharging ?? data.isCharging ?? false;
      if (typeof level === 'number') {
        this.setBatteryLevel(level, charging);
      }
    } catch (err) {
      console.error('[PowerManager] Battery poll failed:', err.message);
    }
  }

  /**
   * Start automatic battery polling.
   */
  startPolling() {
    if (this.pollTimer) return;
    this.pollBattery();
    this.pollTimer = setInterval(() => this.pollBattery(), this.pollIntervalMs);
  }

  /**
   * Stop automatic battery polling.
   */
  stopPolling() {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  // ── Inference Routing ─────────────────────────────────────

  /**
   * Determine the inference target for a given agent and model size.
   *
   * Returns: { target: 'local'|'cloud', provider: string, reason: string }
   */
  getInferenceTarget(agentType, modelSizeCategory = 'medium') {
    // Emergency mode: only critical agents, cloud only
    if (this.mode === INFERENCE_MODES.EMERGENCY) {
      if (!EMERGENCY_AGENTS.has(agentType)) {
        return {
          target: 'blocked',
          provider: null,
          reason: `Agent '${agentType}' suspended in emergency power mode (battery: ${this.batteryLevel}%)`
        };
      }
      return {
        target: 'cloud',
        provider: 'anthropic',
        reason: `Emergency mode — minimal power, cloud inference only (battery: ${this.batteryLevel}%)`
      };
    }

    // Cloud-only mode
    if (this.mode === INFERENCE_MODES.CLOUD_ONLY) {
      return {
        target: 'cloud',
        provider: 'anthropic',
        reason: `Low power mode — cloud inference (battery: ${this.batteryLevel}%)`
      };
    }

    // Hybrid mode: small models local, large models cloud
    if (this.mode === INFERENCE_MODES.HYBRID) {
      if (modelSizeCategory === 'small') {
        return {
          target: 'local',
          provider: 'ollama',
          reason: `Hybrid mode — small model runs locally (battery: ${this.batteryLevel}%)`
        };
      }
      return {
        target: 'cloud',
        provider: 'anthropic',
        reason: `Hybrid mode — ${modelSizeCategory} model routed to cloud (battery: ${this.batteryLevel}%)`
      };
    }

    // Local GPU mode: everything runs locally
    return {
      target: 'local',
      provider: 'ollama',
      reason: `Full power — local GPU inference (battery: ${this.batteryLevel}%)`
    };
  }

  /**
   * Check if an agent is allowed to run in the current power mode.
   */
  isAgentAllowed(agentType) {
    if (this.mode === INFERENCE_MODES.EMERGENCY) {
      return EMERGENCY_AGENTS.has(agentType);
    }
    return true;
  }

  // ── Manual Override ───────────────────────────────────────

  /**
   * Force a specific inference mode (overrides battery-based logic).
   * Pass null to clear override.
   */
  setManualOverride(mode) {
    if (mode && !Object.values(INFERENCE_MODES).includes(mode)) {
      throw new Error(`Invalid mode: ${mode}. Valid: ${Object.values(INFERENCE_MODES).join(', ')}`);
    }
    this.manualOverride = mode;
    this._inferMode();
  }

  // ── Event System ──────────────────────────────────────────

  onChange(callback) {
    this.listeners.push(callback);
  }

  _notify(event) {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (err) {
        console.error('[PowerManager] Listener error:', err.message);
      }
    }
  }

  // ── Status & Diagnostics ──────────────────────────────────

  getStatus() {
    return {
      mode: this.mode,
      batteryLevel: this.batteryLevel,
      solarCharging: this.solarCharging,
      manualOverride: this.manualOverride,
      batterySource: this.batterySource,
      thresholds: BATTERY_THRESHOLDS,
      emergencyAgents: [...EMERGENCY_AGENTS],
      historyLength: this.history.length,
      lastUpdate: this.history.length > 0
        ? new Date(this.history[this.history.length - 1].timestamp).toISOString()
        : null
    };
  }

  /**
   * Get the Ollama configuration for local inference.
   */
  getOllamaConfig() {
    return {
      url: this.ollamaUrl,
      enabled: this.mode === INFERENCE_MODES.LOCAL_GPU || this.mode === INFERENCE_MODES.HYBRID,
      throttle: this.mode === INFERENCE_MODES.HYBRID ? 0.5 : 1.0
    };
  }

  /**
   * Express route handler for power status endpoint.
   */
  statusRoute() {
    return (req, res) => {
      res.json({
        ok: true,
        data: this.getStatus()
      });
    };
  }

  /**
   * Express route handler for setting battery level.
   */
  setBatteryRoute() {
    return (req, res) => {
      const { level, charging } = req.body;
      if (typeof level !== 'number' || level < 0 || level > 100) {
        return res.status(400).json({ ok: false, error: 'level must be a number 0-100' });
      }
      this.setBatteryLevel(level, charging || false);
      res.json({ ok: true, data: this.getStatus() });
    };
  }

  /**
   * Express route handler for setting manual override.
   */
  overrideRoute() {
    return (req, res) => {
      const { mode } = req.body;
      try {
        this.setManualOverride(mode || null);
        res.json({ ok: true, data: this.getStatus() });
      } catch (err) {
        res.status(400).json({ ok: false, error: err.message });
      }
    };
  }
}

module.exports = PowerManager;
module.exports.INFERENCE_MODES = INFERENCE_MODES;
module.exports.BATTERY_THRESHOLDS = BATTERY_THRESHOLDS;
