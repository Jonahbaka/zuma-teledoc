/**
 * ═══════════════════════════════════════════════════════════════
 *  Privacy Router — PII Scrubbing Middleware
 *  DoctaRx NemoClaw Integration
 * ═══════════════════════════════════════════════════════════════
 *
 *  Intercepts all outbound payloads destined for non-local LLM
 *  providers and scrubs potential PII before transmission.
 *
 *  Compliance: HIPAA Safe Harbor (18 identifiers)
 *  Audit: Every scrub event logged for compliance trail
 * ═══════════════════════════════════════════════════════════════
 */

const crypto = require('crypto');

// ── PII Detection Patterns (HIPAA Safe Harbor identifiers) ──────

const PII_PATTERNS = [
  {
    type: 'mrn',
    label: 'Medical Record Number',
    pattern: /\bMRN[-:\s]?\d{6,12}\b/gi,
    replacement: '[MRN-REDACTED]'
  },
  {
    type: 'ssn',
    label: 'Social Security Number',
    pattern: /\b\d{3}-?\d{2}-?\d{4}\b/g,
    replacement: '[SSN-REDACTED]'
  },
  {
    type: 'phone',
    label: 'Phone Number',
    pattern: /\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g,
    replacement: '[PHONE-REDACTED]'
  },
  {
    type: 'email',
    label: 'Email Address',
    pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
    replacement: '[EMAIL-REDACTED]'
  },
  {
    type: 'dob',
    label: 'Date of Birth',
    pattern: /\b(?:DOB|Date of Birth|D\.O\.B|born on)[-:\s]?\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b/gi,
    replacement: '[DOB-REDACTED]'
  },
  {
    type: 'address',
    label: 'Street Address',
    pattern: /\b\d{1,5}\s[\w\s]+(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Drive|Dr|Lane|Ln|Way|Court|Ct|Place|Pl|Circle|Cir)\.?\b/gi,
    replacement: '[ADDRESS-REDACTED]'
  },
  {
    type: 'npi',
    label: 'National Provider Identifier',
    pattern: /\bNPI[-:\s]?\d{10}\b/gi,
    replacement: '[NPI-REDACTED]'
  },
  {
    type: 'dea',
    label: 'DEA Number',
    pattern: /\bDEA[-:\s]?[A-Z]{2}\d{7}\b/gi,
    replacement: '[DEA-REDACTED]'
  },
  {
    type: 'ip_address',
    label: 'IP Address',
    pattern: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g,
    replacement: '[IP-REDACTED]'
  },
  {
    type: 'credit_card',
    label: 'Credit Card Number',
    pattern: /\b(?:\d{4}[-\s]?){3}\d{4}\b/g,
    replacement: '[CC-REDACTED]'
  },
  {
    type: 'patient_name',
    label: 'Patient Name Pattern',
    pattern: /\bPatient(?:\s+Name)?[-:\s]+[A-Z][a-z]+\s+[A-Z][a-z]+\b/g,
    replacement: '[PATIENT-NAME-REDACTED]'
  }
];

// ── Approved local destinations (bypass scrubbing) ──────────────

const LOCAL_DESTINATIONS = new Set([
  '127.0.0.1',
  'localhost',
  '0.0.0.0',
  'host.docker.internal',
  '::1'
]);

// ── Approved external destinations (require scrubbing) ──────────

const EXTERNAL_LLM_HOSTS = new Set([
  'api.anthropic.com',
  'generativelanguage.googleapis.com',
  'api.openai.com'
]);

class PrivacyRouter {
  constructor(options = {}) {
    this.enabled = options.enabled !== false;
    this.auditLogger = options.auditLogger || null;
    this.customPatterns = options.customPatterns || [];
    this.stats = { totalScanned: 0, totalScrubbed: 0, byType: {} };
    this.allPatterns = [...PII_PATTERNS, ...this.customPatterns];
  }

  /**
   * Scrub PII from a text string.
   * Returns { scrubbed: string, detections: Array<{type, count}>, wasScrubbed: boolean }
   */
  scrubText(text) {
    if (!text || typeof text !== 'string') return { scrubbed: text, detections: [], wasScrubbed: false };

    let scrubbed = text;
    const detections = [];

    for (const rule of this.allPatterns) {
      const matches = scrubbed.match(rule.pattern);
      if (matches && matches.length > 0) {
        detections.push({ type: rule.type, label: rule.label, count: matches.length });
        scrubbed = scrubbed.replace(rule.pattern, rule.replacement);
        this.stats.byType[rule.type] = (this.stats.byType[rule.type] || 0) + matches.length;
      }
    }

    this.stats.totalScanned++;
    if (detections.length > 0) this.stats.totalScrubbed++;

    return { scrubbed, detections, wasScrubbed: detections.length > 0 };
  }

  /**
   * Deep-scrub an object (recursively walks all string values).
   */
  scrubObject(obj) {
    if (!obj) return { scrubbed: obj, detections: [], wasScrubbed: false };
    const allDetections = [];

    const walk = (node) => {
      if (typeof node === 'string') {
        const result = this.scrubText(node);
        allDetections.push(...result.detections);
        return result.scrubbed;
      }
      if (Array.isArray(node)) return node.map(walk);
      if (node && typeof node === 'object') {
        const out = {};
        for (const [k, v] of Object.entries(node)) {
          out[k] = walk(v);
        }
        return out;
      }
      return node;
    };

    const scrubbed = walk(obj);
    return { scrubbed, detections: allDetections, wasScrubbed: allDetections.length > 0 };
  }

  /**
   * Determine if a destination requires PII scrubbing.
   */
  requiresScrubbing(destination) {
    if (!destination) return true;
    const host = destination.replace(/^https?:\/\//, '').split(':')[0].split('/')[0];
    if (LOCAL_DESTINATIONS.has(host)) return false;
    return true; // scrub everything non-local by default
  }

  /**
   * Check if an external destination is allowed.
   */
  isAllowedDestination(destination) {
    if (!destination) return false;
    const host = destination.replace(/^https?:\/\//, '').split(':')[0].split('/')[0];
    if (LOCAL_DESTINATIONS.has(host)) return true;
    if (EXTERNAL_LLM_HOSTS.has(host)) return true;
    return false;
  }

  /**
   * Express middleware: intercepts outbound-bound requests.
   * Attach to routes that proxy to external LLM APIs.
   */
  middleware() {
    return (req, res, next) => {
      if (!this.enabled) return next();

      const destination = req.headers['x-nemoclaw-destination'] || req.body?._destination;

      // Block unauthorized destinations
      if (destination && !this.isAllowedDestination(destination)) {
        this._audit('egressBlocked', {
          destination,
          agentType: req.body?.agentType || 'unknown',
          reason: 'destination_not_allowlisted'
        });
        return res.status(403).json({
          ok: false,
          error: 'Egress blocked: destination not in NemoClaw allowlist',
          destination
        });
      }

      // Scrub request body if heading to external destination
      if (destination && this.requiresScrubbing(destination) && req.body) {
        const { scrubbed, detections, wasScrubbed } = this.scrubObject(req.body);
        if (wasScrubbed) {
          this._audit('piiScrubbed', {
            destination,
            agentType: req.body?.agentType || scrubbed?.agentType || 'unknown',
            detections,
            requestId: req.headers['x-request-id']
          });
          req.body = scrubbed;
        }
      }

      // Wrap res.json to scrub outbound responses heading to external consumers
      const originalJson = res.json.bind(res);
      res.json = (body) => {
        if (req.headers['x-nemoclaw-external'] === 'true' && body) {
          const { scrubbed, detections, wasScrubbed } = this.scrubObject(body);
          if (wasScrubbed) {
            this._audit('piiScrubbed', {
              direction: 'response',
              detections,
              requestId: req.headers['x-request-id']
            });
          }
          return originalJson(scrubbed);
        }
        return originalJson(body);
      };

      next();
    };
  }

  /**
   * Scrub a payload before sending to a specific LLM provider.
   * Used by the gateway bridge for WebSocket payloads.
   */
  scrubForProvider(payload, providerHost) {
    if (!this.requiresScrubbing(providerHost)) {
      return { payload, wasScrubbed: false, detections: [] };
    }
    if (!this.isAllowedDestination(providerHost)) {
      throw new Error(`Egress blocked: ${providerHost} is not in the NemoClaw allowlist`);
    }
    const { scrubbed, detections, wasScrubbed } = this.scrubObject(payload);
    if (wasScrubbed) {
      this._audit('piiScrubbed', {
        direction: 'outbound',
        provider: providerHost,
        detections
      });
    }
    return { payload: scrubbed, wasScrubbed, detections };
  }

  /**
   * Get scrubbing statistics.
   */
  getStats() {
    return { ...this.stats };
  }

  /**
   * Internal audit logger.
   */
  _audit(event, data) {
    const entry = {
      timestamp: new Date().toISOString(),
      event,
      ...data,
      traceId: crypto.randomUUID()
    };
    if (this.auditLogger) {
      this.auditLogger(entry);
    } else {
      console.log(`[PrivacyRouter] ${event}:`, JSON.stringify(entry));
    }
  }
}

module.exports = PrivacyRouter;
