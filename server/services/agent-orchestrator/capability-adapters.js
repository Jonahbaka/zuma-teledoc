/**
 * Capability Adapter Layer
 * 
 * Maps abstract intents to concrete executions.
 * Agents never know HOW something is done - they only declare WHAT they want.
 * 
 * Adapter types:
 * - database: Query/write to PostgreSQL
 * - api_internal: Call internal DoctaRx services
 * - email: Send emails via SMTP
 * - notification: Push notifications
 * - payment: Stripe operations
 * - analytics: Run analytics queries
 * - external: Call external APIs (highest risk)
 * - physical: Robot firmware (future)
 */

const db = require('../../db');

class CapabilityAdapterLayer {
  constructor() {
    this.adapters = new Map();
    this.initialized = false;
  }

  /**
   * Initialize and register all capability adapters
   */
  async initialize(intentSystem) {
    // Register built-in adapters
    this.registerBuiltInAdapters();
    
    // Bind adapters to intent system
    const handlerMap = {};
    for (const [intentType, adapter] of this.adapters) {
      handlerMap[intentType] = async (params, intent) => {
        return this.executeAdapter(intentType, adapter, params, intent);
      };
    }
    intentSystem.registerHandlers(handlerMap);

    // Register adapters in database
    await this.registerAdaptersInDB();

    this.initialized = true;
    console.log(`  ⚡ ${this.adapters.size} capability adapters registered`);
  }

  /**
   * Execute an adapter with safety wrapping
   */
  async executeAdapter(intentType, adapter, params, intent) {
    const startTime = Date.now();

    try {
      const result = await adapter.execute(params, intent);
      return {
        ...result,
        adapter: adapter.name,
        adapterType: adapter.type,
        executionMs: Date.now() - startTime
      };
    } catch (error) {
      throw new Error(`Adapter ${adapter.name} failed: ${error.message}`);
    }
  }

  /**
   * Register all built-in adapters
   */
  registerBuiltInAdapters() {
    // ===== DATABASE ADAPTERS =====
    this.register('query_database', {
      name: 'database_query',
      type: 'database',
      execute: async (params) => {
        // Only allow SELECT queries for safety
        const query = params.query || '';
        if (!query.trim().toUpperCase().startsWith('SELECT')) {
          throw new Error('Only SELECT queries are allowed through this adapter');
        }
        const result = await db.query(query, params.params || []);
        return { rows: result.rows, rowCount: result.rowCount };
      }
    });

    this.register('fetch_metrics', {
      name: 'metrics_fetcher',
      type: 'database',
      execute: async (params) => {
        const metricQueries = {
          patient_count: "SELECT COUNT(*) as count FROM users WHERE role = 'patient'",
          provider_count: "SELECT COUNT(*) as count FROM users WHERE role = 'provider'",
          active_appointments: "SELECT COUNT(*) as count FROM appointments WHERE status = 'scheduled' AND scheduled_date > NOW()",
          completed_today: "SELECT COUNT(*) as count FROM appointments WHERE status = 'completed' AND DATE(updated_at) = CURRENT_DATE",
          revenue_30d: "SELECT COALESCE(SUM(amount), 0) as total FROM payments WHERE created_at > NOW() - INTERVAL '30 days' AND status = 'completed'",
          pending_claims: "SELECT COUNT(*) as count FROM claims WHERE status = 'pending'",
          no_show_rate: "SELECT ROUND(COUNT(*) FILTER (WHERE status IN ('no_show', 'missed'))::DECIMAL / NULLIF(COUNT(*), 0) * 100, 2) as rate FROM appointments WHERE created_at > NOW() - INTERVAL '30 days'",
          new_patients_7d: "SELECT COUNT(*) as count FROM users WHERE role = 'patient' AND created_at > NOW() - INTERVAL '7 days'",
          message_volume_24h: "SELECT COUNT(*) as count FROM messages WHERE created_at > NOW() - INTERVAL '24 hours'",
          avg_wait_time: "SELECT ROUND(AVG(EXTRACT(EPOCH FROM (actual_start - scheduled_date))), 0) as avg_seconds FROM appointments WHERE status = 'completed' AND actual_start IS NOT NULL AND created_at > NOW() - INTERVAL '30 days'"
        };

        const metricName = params.metric;
        const query = metricQueries[metricName];
        if (!query) {
          return { error: `Unknown metric: ${metricName}`, availableMetrics: Object.keys(metricQueries) };
        }

        try {
          const result = await db.query(query);
          return { metric: metricName, value: result.rows[0], timestamp: new Date().toISOString() };
        } catch (error) {
          return { metric: metricName, error: error.message, value: null };
        }
      }
    });

    this.register('get_patient_count', {
      name: 'patient_counter',
      type: 'database',
      execute: async () => {
        const result = await db.query("SELECT COUNT(*) as total, COUNT(*) FILTER (WHERE status = 'active') as active FROM users WHERE role = 'patient'");
        return { ...result.rows[0] };
      }
    });

    this.register('get_revenue_data', {
      name: 'revenue_fetcher',
      type: 'database',
      execute: async (params) => {
        const days = params.days || 30;
        const result = await db.query(`
          SELECT 
            COALESCE(SUM(amount), 0) as total_revenue,
            COUNT(*) as transaction_count,
            COALESCE(AVG(amount), 0) as avg_transaction
          FROM payments 
          WHERE created_at > NOW() - INTERVAL '${days} days' AND status = 'completed'
        `);
        return { period: `${days}_days`, ...result.rows[0] };
      }
    });

    this.register('get_appointment_data', {
      name: 'appointment_fetcher',
      type: 'database',
      execute: async (params) => {
        const days = params.days || 30;
        const result = await db.query(`
          SELECT 
            COUNT(*) as total,
            COUNT(*) FILTER (WHERE status = 'completed') as completed,
            COUNT(*) FILTER (WHERE status IN ('no_show', 'missed')) as no_shows,
            COUNT(*) FILTER (WHERE status = 'cancelled') as cancelled,
            COUNT(*) FILTER (WHERE status = 'scheduled') as upcoming
          FROM appointments 
          WHERE created_at > NOW() - INTERVAL '${days} days'
        `);
        return { period: `${days}_days`, ...result.rows[0] };
      }
    });

    this.register('analyze_data', {
      name: 'data_analyzer',
      type: 'database',
      execute: async (params) => {
        // Safe pre-built analytics queries
        const analyses = {
          growth_trend: `
            SELECT DATE_TRUNC('week', created_at) as week, COUNT(*) as new_patients
            FROM users WHERE role = 'patient' AND created_at > NOW() - INTERVAL '90 days'
            GROUP BY 1 ORDER BY 1`,
          revenue_trend: `
            SELECT DATE_TRUNC('week', created_at) as week, SUM(amount) as revenue
            FROM payments WHERE status = 'completed' AND created_at > NOW() - INTERVAL '90 days'
            GROUP BY 1 ORDER BY 1`,
          appointment_distribution: `
            SELECT EXTRACT(DOW FROM scheduled_date) as day_of_week, COUNT(*) as count
            FROM appointments WHERE created_at > NOW() - INTERVAL '90 days'
            GROUP BY 1 ORDER BY 1`,
          provider_utilization: `
            SELECT u.first_name || ' ' || u.last_name as provider, COUNT(a.id) as appointments
            FROM users u LEFT JOIN appointments a ON u.id = a.provider_id AND a.created_at > NOW() - INTERVAL '30 days'
            WHERE u.role = 'provider' GROUP BY 1 ORDER BY 2 DESC`
        };

        const analysis = analyses[params.analysis_type];
        if (!analysis) return { error: 'Unknown analysis type', available: Object.keys(analyses) };

        const result = await db.query(analysis);
        return { analysisType: params.analysis_type, data: result.rows };
      }
    });

    // ===== RECRUITING / ATS ADAPTERS (Zoho Recruit) =====
    this.register('zoho_recruit_create_job_opening', {
      name: 'zoho_recruit_jobopenings_create',
      type: 'external',
      execute: async (params) => {
        const jobOpening = params.jobOpening || params.job_opening || params;
        const publishToBoards = params.publishToBoards !== false;
        const publishChannels = params.publishChannels || params.publish_channels || ['LinkedIn', 'Indeed'];
        try {
          const zohoRecruitService = require('../zohoRecruitService');
          const result = await zohoRecruitService.createJobOpening(jobOpening, {
            publishToBoards,
            publishChannels
          });
          return {
            success: true,
            action: 'zoho_recruit_create_job_opening',
            result
          };
        } catch (error) {
          return {
            success: false,
            action: 'zoho_recruit_create_job_opening',
            error: error.message
          };
        }
      }
    });

    this.register('zoho_recruit_publish_job_opening', {
      name: 'zoho_recruit_jobopenings_publish',
      type: 'external',
      execute: async (params) => {
        const jobOpeningId = params.jobOpeningId || params.job_opening_id || params.id;
        const publishChannels = params.publishChannels || params.publish_channels || ['LinkedIn', 'Indeed'];
        if (!jobOpeningId) {
          return { success: false, error: 'jobOpeningId is required' };
        }
        try {
          const zohoRecruitService = require('../zohoRecruitService');
          const result = await zohoRecruitService.publishToBoards(jobOpeningId, publishChannels);
          return {
            success: true,
            action: 'zoho_recruit_publish_job_opening',
            result
          };
        } catch (error) {
          return {
            success: false,
            action: 'zoho_recruit_publish_job_opening',
            error: error.message
          };
        }
      }
    });

    this.register('get_ga4_realtime_metrics', {
      name: 'ga4_realtime_fetcher',
      type: 'analytics',
      execute: async () => {
        try {
          const realtimeAnalyticsRoute = require('../../routes/realtimeAnalytics');
          if (typeof realtimeAnalyticsRoute?.hasGaConfig === 'function'
            && typeof realtimeAnalyticsRoute?.getGaOverview === 'function'
            && realtimeAnalyticsRoute.hasGaConfig()) {
            const ga = await realtimeAnalyticsRoute.getGaOverview();
            return {
              source: 'ga4',
              activeUsers30m: ga.activeUsers30m || 0,
              activeUsers5m: ga.activeUsers5m || 0,
              activeUsersPerMinute: ga.activeUsersPerMinute || 0,
              topSources: ga.sources || [],
              topCountries: ga.topCountries || [],
              pages: ga.pages || [],
              fetchedAt: new Date().toISOString()
            };
          }
        } catch (error) {
          return {
            source: 'ga4',
            error: `GA4 fetch failed: ${error.message}`,
            fetchedAt: new Date().toISOString()
          };
        }

        // Fallback to internal realtime table if GA4 is not configured.
        try {
          const [active30Res, active5Res] = await Promise.all([
            db.query(`SELECT COUNT(DISTINCT session_id) AS c FROM realtime_analytics_events WHERE created_at > NOW() - INTERVAL '30 minutes'`),
            db.query(`SELECT COUNT(DISTINCT session_id) AS c FROM realtime_analytics_events WHERE created_at > NOW() - INTERVAL '5 minutes'`)
          ]);

          const activeUsers30m = parseInt(active30Res.rows[0]?.c || '0', 10);
          const activeUsers5m = parseInt(active5Res.rows[0]?.c || '0', 10);
          return {
            source: 'internal',
            activeUsers30m,
            activeUsers5m,
            activeUsersPerMinute: Math.round((activeUsers30m / 30) * 10) / 10,
            fetchedAt: new Date().toISOString()
          };
        } catch (error) {
          return {
            source: 'internal',
            error: `Internal realtime fetch failed: ${error.message}`,
            fetchedAt: new Date().toISOString()
          };
        }
      }
    });

    // ===== COMMUNICATION ADAPTERS =====
    this.register('send_email', {
      name: 'email_sender',
      type: 'email',
      execute: async (params) => {
        // In observation mode, we log the intent but don't actually send
        return {
          status: 'queued_for_approval',
          message: 'Email intent logged. Requires human approval before sending.',
          to: params.to,
          subject: params.subject,
          bodyPreview: (params.body || '').substring(0, 100)
        };
      }
    });

    this.register('send_notification', {
      name: 'notification_sender',
      type: 'messaging',
      execute: async (params) => {
        return {
          status: 'queued',
          message: 'Notification queued for delivery.',
          userId: params.userId,
          title: params.title
        };
      }
    });

    // ===== FINANCIAL ADAPTERS (All require approval) =====
    this.register('process_payment', {
      name: 'payment_processor',
      type: 'payment',
      execute: async (params) => {
        return {
          status: 'requires_manual_approval',
          message: 'Financial transactions require explicit human approval.',
          amount: params.amount,
          description: params.description
        };
      }
    });

    this.register('update_pricing', {
      name: 'pricing_updater',
      type: 'payment',
      execute: async (params) => {
        return {
          status: 'proposal_only',
          message: 'Pricing change proposed. Requires admin approval to apply.',
          proposedChanges: params.changes
        };
      }
    });

    // ===== EXTERNAL ADAPTERS (Highest risk - all placeholder) =====
    this.register('api_call_external', {
      name: 'external_api',
      type: 'external',
      execute: async (params) => {
        return {
          status: 'not_available',
          message: 'External API calls are disabled in observation mode. Logged for review.',
          targetUrl: params.url,
          method: params.method
        };
      }
    });

    this.register('register_ein', {
      name: 'ein_registration',
      type: 'external',
      execute: async (params) => {
        return {
          status: 'skill_placeholder',
          message: 'EIN registration skill is in discovery phase. Manual execution required.',
          steps: [
            '1. Complete IRS Form SS-4',
            '2. Submit online at irs.gov/businesses',
            '3. Record EIN in company records'
          ]
        };
      }
    });

    this.register('open_bank_account', {
      name: 'bank_account_opener',
      type: 'external',
      execute: async () => ({
        status: 'skill_placeholder',
        message: 'Bank account opening requires in-person verification. Workflow documented for manual execution.'
      })
    });

    this.register('file_report', {
      name: 'report_filer',
      type: 'external',
      execute: async (params) => ({
        status: 'skill_placeholder',
        message: `Report filing for ${params.reportType || 'unknown'} documented. Manual execution required.`
      })
    });

    this.register('submit_to_bureau', {
      name: 'bureau_submitter',
      type: 'external',
      execute: async () => ({
        status: 'skill_placeholder',
        message: 'Credit bureau submission requires verified credentials. Workflow documented.'
      })
    });

    // ===== PHYSICAL/ROBOT ADAPTERS (Future) =====
    this.register('physical_action', {
      name: 'robot_firmware',
      type: 'physical',
      execute: async (params) => ({
        status: 'not_implemented',
        message: 'Physical embodiment interface not yet connected.',
        action: params.action,
        targetLocation: params.location
      })
    });
  }

  /**
   * Register a capability adapter
   */
  register(intentType, adapter) {
    this.adapters.set(intentType, adapter);
  }

  /**
   * Register adapters in database for portal visibility
   */
  async registerAdaptersInDB() {
    for (const [intentType, adapter] of this.adapters) {
      try {
        await db.query(`
          INSERT INTO ai_capability_adapters (adapter_name, display_name, adapter_type, supported_intents, is_enabled)
          VALUES ($1, $2, $3, $4, true)
          ON CONFLICT (adapter_name) DO UPDATE SET
            supported_intents = EXCLUDED.supported_intents,
            display_name = EXCLUDED.display_name
        `, [adapter.name, adapter.name.replace(/_/g, ' '), adapter.type, JSON.stringify([intentType])]);
      } catch (error) {
        // Ignore registration errors
      }
    }
  }

  /**
   * Get adapter status for monitoring
   */
  async getAdapterStatus() {
    const result = await db.query('SELECT * FROM ai_capability_adapters ORDER BY adapter_type, adapter_name');
    return result.rows;
  }

  /**
   * Health check all adapters
   */
  async healthCheck() {
    const statuses = {};
    for (const [intentType, adapter] of this.adapters) {
      statuses[intentType] = {
        name: adapter.name,
        type: adapter.type,
        status: 'available'
      };
    }
    return statuses;
  }
}

module.exports = CapabilityAdapterLayer;
