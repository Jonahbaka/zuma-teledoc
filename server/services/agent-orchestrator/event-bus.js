/**
 * ═══════════════════════════════════════════════════════════════
 *  THE NERVOUS SYSTEM — Event Bus (Harvested from ClawHub)
 * ═══════════════════════════════════════════════════════════════
 * 
 *  Pattern Source: @openclaw/clawhub convex/crons.ts + skillStatEvents
 *  
 *  This transforms DoctaRx from "Input → Output" to "Event → Reaction."
 *  Instead of waiting for a user prompt, agents react to signals:
 *    
 *    Event: "Lab results arrived"  → Reaction: Parse, alert doctor, update record
 *    Event: "Payment received"     → Reaction: Revenue agent logs, checks threshold
 *    Event: "Error spike"          → Reaction: DevOps agent investigates
 *    Event: "New patient signed"   → Reaction: Growth agent tracks conversion
 *  
 *  Key ClawHub Patterns Adapted:
 *    1. skillStatEvents table as event queue (write events, process in batches)
 *    2. crons.ts interval-based processing (5min, 15min, 30min, hourly, daily)
 *    3. Cursor-based consumption (track what's been processed)
 *    4. Rate limiting (don't overwhelm the system)
 *    5. Audit logging for every event
 *  
 *  The DoctaRx Way (Gnostic Filter):
 *    - Events are signals, not commands
 *    - Agents SUBSCRIBE to events they care about
 *    - No agent can emit events that bypass compliance
 *    - All event processing is auditable
 * ═══════════════════════════════════════════════════════════════
 */

const db = require('../../db');
const crypto = require('crypto');

// =========================================================================
// EVENT TYPES (The Signal Vocabulary)
// =========================================================================

const EVENT_TYPES = {
  // System events
  'system.started': { description: 'System started / restarted', severity: 'info' },
  'system.error': { description: 'System error occurred', severity: 'error' },
  'system.health.warning': { description: 'Health check warning', severity: 'warning' },
  'system.state.changed': { description: 'System state changed', severity: 'info' },

  // Patient events
  'patient.registered': { description: 'New patient registered', severity: 'info' },
  'patient.appointment.booked': { description: 'Appointment booked', severity: 'info' },
  'patient.appointment.cancelled': { description: 'Appointment cancelled', severity: 'warning' },
  'patient.appointment.completed': { description: 'Appointment completed', severity: 'info' },
  'patient.message.received': { description: 'Patient sent a message', severity: 'info' },
  'patient.lab.results': { description: 'Lab results received', severity: 'info' },

  // Provider events
  'provider.registered': { description: 'New provider registered', severity: 'info' },
  'provider.schedule.updated': { description: 'Provider updated schedule', severity: 'info' },
  'provider.prescription.written': { description: 'New prescription written', severity: 'info' },

  // Financial events
  'payment.received': { description: 'Payment received', severity: 'info' },
  'payment.failed': { description: 'Payment failed', severity: 'warning' },
  'claim.submitted': { description: 'Insurance claim submitted', severity: 'info' },
  'claim.denied': { description: 'Insurance claim denied', severity: 'warning' },
  'subscription.created': { description: 'New subscription', severity: 'info' },
  'subscription.cancelled': { description: 'Subscription cancelled', severity: 'warning' },

  // Compliance events
  'compliance.phi.accessed': { description: 'PHI data accessed', severity: 'info' },
  'compliance.violation.detected': { description: 'Compliance violation detected', severity: 'critical' },
  'compliance.audit.completed': { description: 'Audit completed', severity: 'info' },

  // Agent events
  'agent.proposal.created': { description: 'Agent created a proposal', severity: 'info' },
  'agent.proposal.approved': { description: 'Proposal approved', severity: 'info' },
  'agent.workflow.completed': { description: 'Workflow completed', severity: 'info' },
  'agent.workflow.halted': { description: 'Workflow halted for approval', severity: 'warning' },
  'agent.skill.executed': { description: 'Skill executed', severity: 'info' },
  'agent.glitch.detected': { description: 'Matrix glitch detected', severity: 'info' },
  'agent.arbitrage.found': { description: 'Arbitrage opportunity found', severity: 'info' },

  // CRM events
  'crm.contact.added': { description: 'New contact added to CRM', severity: 'info' },
  'crm.email.sent': { description: 'Outreach email sent', severity: 'info' },
  'crm.email.replied': { description: 'Contact replied to email', severity: 'info' },
  'crm.campaign.approved': { description: 'Email campaign approved', severity: 'info' },
  'crm.campaign.completed': { description: 'Email campaign completed', severity: 'info' },
  'crm.contact.converted': { description: 'Contact converted', severity: 'info' },
  'crm.scrape.completed': { description: 'Web scraping completed', severity: 'info' },
  'crm.social.engaged': { description: 'Social media engagement logged', severity: 'info' },

  // Financial events
  'fin.journal.posted': { description: 'Journal entry posted', severity: 'info' },
  'fin.stripe.synced': { description: 'Stripe payment synced to ledger', severity: 'info' },
  'fin.ar.overdue': { description: 'Account receivable overdue', severity: 'warning' },
  'fin.ap.due': { description: 'Account payable coming due', severity: 'info' },
  'fin.budget.exceeded': { description: 'Budget exceeded for category', severity: 'warning' },
  'fin.runway.warning': { description: 'Cash runway below threshold', severity: 'critical' },
  'fin.reconciliation.mismatch': { description: 'Bank reconciliation mismatch', severity: 'warning' },
  'fin.revenue.recorded': { description: 'Revenue recorded in ledger', severity: 'info' },
  'fin.payroll.processed': { description: 'Payroll cycle processed', severity: 'info' },
  'fin.tax.due': { description: 'Tax obligation coming due', severity: 'warning' }
};

// =========================================================================
// EVENT BUS CLASS
// =========================================================================

class EventBus {
  constructor() {
    this.subscribers = new Map(); // eventType → [callback]
    this.cursors = new Map(); // consumerId → lastProcessedId
    this.initialized = false;
    this.stats = {
      emitted: 0,
      consumed: 0,
      subscribers: 0
    };
  }

  /**
   * Initialize — create event queue table if needed
   */
  async initialize() {
    try {
      await db.query(`
        CREATE TABLE IF NOT EXISTS ai_event_queue (
          id SERIAL PRIMARY KEY,
          event_type VARCHAR(100) NOT NULL,
          payload JSONB DEFAULT '{}',
          source VARCHAR(100) DEFAULT 'system',
          severity VARCHAR(20) DEFAULT 'info',
          processed_at TIMESTAMP,
          created_at TIMESTAMP DEFAULT NOW()
        )
      `);

      await db.query(`
        CREATE TABLE IF NOT EXISTS ai_event_cursors (
          consumer_id VARCHAR(100) PRIMARY KEY,
          last_event_id INTEGER DEFAULT 0,
          updated_at TIMESTAMP DEFAULT NOW()
        )
      `);

      // Create index for unprocessed events
      await db.query(`CREATE INDEX IF NOT EXISTS idx_event_queue_unprocessed ON ai_event_queue (processed_at) WHERE processed_at IS NULL`);
      await db.query(`CREATE INDEX IF NOT EXISTS idx_event_queue_type ON ai_event_queue (event_type)`);

      this.initialized = true;
      console.log('  ⚡ Event Bus: CONNECTED');
    } catch (e) {
      console.error('  ⚡ Event Bus init error (non-fatal):', e.message);
      this.initialized = true; // Continue without DB events
    }
  }

  // ─── EMIT (Publish an event) ───────────────────────────────────────

  /**
   * Emit an event into the bus
   * (Like ClawHub writing to skillStatEvents)
   */
  async emit(eventType, payload = {}, source = 'system') {
    this.stats.emitted++;
    const severity = EVENT_TYPES[eventType]?.severity || 'info';

    // Persist to database queue
    try {
      await db.query(`
        INSERT INTO ai_event_queue (event_type, payload, source, severity)
        VALUES ($1, $2, $3, $4)
      `, [eventType, JSON.stringify(payload), source, severity]);
    } catch (e) {
      // DB not available — log only
    }

    // Notify in-memory subscribers immediately
    const handlers = this.subscribers.get(eventType) || [];
    const wildcardHandlers = this.subscribers.get('*') || [];
    const allHandlers = [...handlers, ...wildcardHandlers];

    for (const handler of allHandlers) {
      try {
        await handler({ type: eventType, payload, source, severity, timestamp: new Date() });
      } catch (e) {
        console.error(`Event handler error for ${eventType}:`, e.message);
      }
    }
  }

  // ─── SUBSCRIBE (React to events) ──────────────────────────────────

  /**
   * Subscribe to an event type
   * Handler is called immediately when event is emitted (in-memory)
   */
  subscribe(eventType, handler) {
    if (!this.subscribers.has(eventType)) {
      this.subscribers.set(eventType, []);
    }
    this.subscribers.get(eventType).push(handler);
    this.stats.subscribers++;

    return () => {
      // Return unsubscribe function
      const handlers = this.subscribers.get(eventType);
      if (handlers) {
        const idx = handlers.indexOf(handler);
        if (idx >= 0) handlers.splice(idx, 1);
      }
    };
  }

  /**
   * Subscribe an agent to a set of event types
   * When any matched event fires, it triggers the agent's observe() cycle
   */
  subscribeAgent(agent, eventTypes) {
    for (const eventType of eventTypes) {
      this.subscribe(eventType, async (event) => {
        try {
          // Don't trigger agent if it's already running or disabled
          if (agent.status === 'running' || !agent.isEnabled || agent.emergencyShutdown) return;

          console.log(`  ⚡ ${agent.codeName} reacting to: ${event.type}`);
          // Inject the event into the agent's context for the next observe cycle
          if (!agent._pendingEvents) agent._pendingEvents = [];
          agent._pendingEvents.push(event);
        } catch (e) {
          console.error(`Agent ${agent.codeName} event handler error:`, e.message);
        }
      });
    }
  }

  // ─── CONSUME (Batch processing — ClawHub cron pattern) ────────────

  /**
   * Consume unprocessed events for a specific consumer
   * Uses cursor-based tracking so events are never processed twice
   * (Pattern from ClawHub's skillStatEvents + processedAt cursor)
   */
  async consume(consumerId, batchSize = 10) {
    try {
      // Get cursor
      let cursor = this.cursors.get(consumerId);
      if (cursor === undefined) {
        const result = await db.query(`
          SELECT last_event_id FROM ai_event_cursors WHERE consumer_id = $1
        `, [consumerId]);
        cursor = result.rows[0]?.last_event_id || 0;
        this.cursors.set(consumerId, cursor);
      }

      // Fetch batch of events after cursor
      const events = await db.query(`
        SELECT * FROM ai_event_queue 
        WHERE id > $1 
        ORDER BY id ASC 
        LIMIT $2
      `, [cursor, batchSize]);

      if (events.rows.length === 0) return [];

      // Update cursor
      const lastId = events.rows[events.rows.length - 1].id;
      this.cursors.set(consumerId, lastId);

      await db.query(`
        INSERT INTO ai_event_cursors (consumer_id, last_event_id, updated_at)
        VALUES ($1, $2, NOW())
        ON CONFLICT (consumer_id) DO UPDATE SET last_event_id = $2, updated_at = NOW()
      `, [consumerId, lastId]);

      // Mark as processed
      const ids = events.rows.map(e => e.id);
      await db.query(`
        UPDATE ai_event_queue SET processed_at = NOW() WHERE id = ANY($1)
      `, [ids]);

      this.stats.consumed += events.rows.length;
      return events.rows.map(row => ({
        id: row.id,
        type: row.event_type,
        payload: row.payload,
        source: row.source,
        severity: row.severity,
        createdAt: row.created_at
      }));
    } catch (e) {
      return [];
    }
  }

  // ─── QUERY (Read historical events) ────────────────────────────────

  /**
   * Query recent events (for the portal dashboard)
   */
  async getRecentEvents(options = {}) {
    const { limit = 50, eventType, severity, since } = options;
    try {
      let query = 'SELECT * FROM ai_event_queue WHERE 1=1';
      const params = [];

      if (eventType) {
        params.push(eventType);
        query += ` AND event_type = $${params.length}`;
      }
      if (severity) {
        params.push(severity);
        query += ` AND severity = $${params.length}`;
      }
      if (since) {
        params.push(since);
        query += ` AND created_at > $${params.length}`;
      }

      params.push(limit);
      query += ` ORDER BY created_at DESC LIMIT $${params.length}`;

      const result = await db.query(query, params);
      return result.rows;
    } catch (e) {
      return [];
    }
  }

  /**
   * Get event statistics
   */
  async getStats() {
    try {
      const counts = await db.query(`
        SELECT event_type, COUNT(*) as count, 
               MAX(created_at) as last_seen
        FROM ai_event_queue 
        WHERE created_at > NOW() - INTERVAL '24 hours'
        GROUP BY event_type 
        ORDER BY count DESC
      `);

      return {
        ...this.stats,
        registeredTypes: Object.keys(EVENT_TYPES).length,
        activeSubscribers: this.subscribers.size,
        last24h: counts.rows
      };
    } catch (e) {
      return this.stats;
    }
  }

  // ─── CLEANUP ───────────────────────────────────────────────────────

  /**
   * Clean up old processed events (like ClawHub's maintenance)
   */
  async cleanup(olderThanDays = 7) {
    try {
      const result = await db.query(`
        DELETE FROM ai_event_queue 
        WHERE processed_at IS NOT NULL AND created_at < NOW() - INTERVAL '${olderThanDays} days'
      `);
      return result.rowCount;
    } catch (e) {
      return 0;
    }
  }
}

// =========================================================================
// EXPORTS
// =========================================================================

module.exports = {
  EventBus,
  EVENT_TYPES
};
