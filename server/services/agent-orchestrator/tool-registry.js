/**
 * ═══════════════════════════════════════════════════════════════
 *  AGENT TOOL REGISTRY — DoctaRx Liberation Engine
 *  Reverse-engineered from OpenClaw's Pi Agent Runtime
 * ═══════════════════════════════════════════════════════════════
 *
 *  Every function here is REAL. It hits the REAL database, the REAL API.
 *  When an agent calls a tool, something actually happens.
 *
 *  Tools are exposed to Claude as native function definitions so the LLM
 *  can decide on its own when to call them — the classic ReAct pattern.
 * ═══════════════════════════════════════════════════════════════
 */

const db = require('../../db');

let webEngine;
try { webEngine = require('./web-action-engine'); } catch (e) { /* optional */ }

let medicalUnit;
try { medicalUnit = require('./medical-unit'); } catch (e) { /* optional */ }

let githubService;
try { githubService = require('./github-service'); } catch (e) { /* optional */ }

let credentialVault;
try { credentialVault = require('./credential-vault'); } catch (e) { /* optional */ }

// ─────────────────────────────────────────────────────────────────────────
// TOOL DEFINITIONS (what the LLM sees)
// ─────────────────────────────────────────────────────────────────────────

const TOOL_DEFINITIONS = {

  get_platform_stats: {
    description: 'Get live platform statistics: total users, providers, patients, appointments, CRM contacts, revenue, recent errors, pending proposals. Always call this first when the operator asks about the state of the platform.',
    input_schema: {
      type: 'object',
      properties: {
        include_revenue: { type: 'boolean', description: 'Include Stripe/payment totals' }
      },
      required: []
    }
  },

  query_patients: {
    description: 'Query patient records from the database. Search by name, email, status. Returns a list of patients with their basic info.',
    input_schema: {
      type: 'object',
      properties: {
        search: { type: 'string', description: 'Search term: name, email, or phone' },
        limit: { type: 'number', description: 'Max results to return (default 20, max 50)' },
        status: { type: 'string', enum: ['active', 'inactive', 'all'], description: 'Filter by account status' }
      },
      required: []
    }
  },

  query_providers: {
    description: 'Query provider records. Find doctors, NPs, PAs on the platform. Filter by name, specialty, approval status.',
    input_schema: {
      type: 'object',
      properties: {
        search: { type: 'string', description: 'Name or email search' },
        status: { type: 'string', enum: ['approved', 'pending', 'all'], description: 'Filter by approval status' },
        limit: { type: 'number', description: 'Max results (default 20)' }
      },
      required: []
    }
  },

  query_appointments: {
    description: 'Query appointment/visit records (video sessions). Get recent appointments, filter by status or date range.',
    input_schema: {
      type: 'object',
      properties: {
        status: { type: 'string', description: 'Filter: scheduled, completed, cancelled, all' },
        days_back: { type: 'number', description: 'How many days back to query (default 7)' },
        limit: { type: 'number', description: 'Max results (default 20)' }
      },
      required: []
    }
  },

  query_prescriptions: {
    description: 'Query prescription records. See what medications have been prescribed, their statuses, and which providers wrote them.',
    input_schema: {
      type: 'object',
      properties: {
        status: { type: 'string', description: 'Filter: active, pending, completed, all' },
        days_back: { type: 'number', description: 'Days back to look (default 30)' },
        limit: { type: 'number', description: 'Max results (default 20)' }
      },
      required: []
    }
  },

  query_crm: {
    description: 'Query CRM contacts and leads. Find contacts by name, email, company, tags, or status. Essential for growth and outreach.',
    input_schema: {
      type: 'object',
      properties: {
        search: { type: 'string', description: 'Name, email, or company search' },
        status: { type: 'string', description: 'Filter: lead, prospect, customer, churned, all' },
        tags: { type: 'string', description: 'Filter by tag (e.g. provider, patient, investor)' },
        limit: { type: 'number', description: 'Max results (default 20)' }
      },
      required: []
    }
  },

  create_crm_contact: {
    description: 'Create a new CRM contact. Use this when you find a prospect (provider lead, investor, partner) that should be tracked.',
    input_schema: {
      type: 'object',
      properties: {
        first_name: { type: 'string', description: 'First name' },
        last_name: { type: 'string', description: 'Last name' },
        email: { type: 'string', description: 'Email address' },
        company: { type: 'string', description: 'Company or organization' },
        phone: { type: 'string', description: 'Phone number' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Tags like: provider, investor, partner, lead' },
        notes: { type: 'string', description: 'Any relevant notes about this contact' },
        source: { type: 'string', description: 'Where this lead came from (e.g. web_search, npi_registry, linkedin)' }
      },
      required: ['first_name', 'last_name']
    }
  },

  query_triage: {
    description: 'Query AI triage sessions. See what symptoms patients have been triaging, urgency levels, and outcomes.',
    input_schema: {
      type: 'object',
      properties: {
        days_back: { type: 'number', description: 'Days back to look (default 7)' },
        urgency: { type: 'string', description: 'Filter: high, medium, low, all' },
        limit: { type: 'number', description: 'Max results (default 20)' }
      },
      required: []
    }
  },

  query_revenue: {
    description: 'Query revenue and payment data. Get total revenue, recent transactions, subscription counts, and MRR.',
    input_schema: {
      type: 'object',
      properties: {
        days_back: { type: 'number', description: 'Days back to look (default 30)' }
      },
      required: []
    }
  },

  query_agent_results: {
    description: 'Query the agent results log — what actions have agents taken, what did they find or accomplish? Use to report on agent activity.',
    input_schema: {
      type: 'object',
      properties: {
        agent_type: { type: 'string', description: 'Filter by agent (e.g. growth, operations, ceo)' },
        result_type: { type: 'string', description: 'Filter by type: opportunity, growth, error, compliance, financial' },
        limit: { type: 'number', description: 'Max results (default 20)' }
      },
      required: []
    }
  },

  log_agent_result: {
    description: 'Log a measurable result or finding from the agent. Use this to record discoveries, opportunities found, actions taken.',
    input_schema: {
      type: 'object',
      properties: {
        result_type: { type: 'string', description: 'Type: opportunity, growth, compliance, financial, error, outreach' },
        title: { type: 'string', description: 'Short title of the result' },
        description: { type: 'string', description: 'Detailed description of what was found or done' },
        metrics: { type: 'object', description: 'Any numeric metrics (e.g. { revenue_impact: 5000, leads_found: 12 })' }
      },
      required: ['result_type', 'title', 'description']
    }
  },

  search_web: {
    description: 'Search the web using DuckDuckGo. Use for finding competitors, providers, investors, grant opportunities, medical info, news.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'The search query' },
        num_results: { type: 'number', description: 'Number of results to return (default 8, max 15)' }
      },
      required: ['query']
    }
  },

  scrape_url: {
    description: 'Scrape and read the content of a URL. Extract text, headlines, links, and metadata from a webpage.',
    input_schema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'The HTTPS URL to scrape' }
      },
      required: ['url']
    }
  },

  read_uploaded_file: {
    description: 'Read the extracted text content from a file the Operator has uploaded (PDF, TXT, etc).',
    input_schema: {
      type: 'object',
      properties: {
        file_id: { type: 'string', description: 'The UUID of the uploaded file' },
        max_chars: { type: 'number', description: 'Max characters to return (default 6000)' }
      },
      required: ['file_id']
    }
  },

  list_uploaded_files: {
    description: 'List files the Operator has uploaded for analysis.',
    input_schema: {
      type: 'object',
      properties: {},
      required: []
    }
  },

  list_credentials: {
    description: 'List what platform credentials/API keys exist in the Credential Vault (metadata only — no secrets). Use to audit what integrations are active and what is missing.',
    input_schema: {
      type: 'object',
      properties: {},
      required: []
    }
  },

  medical_consult: {
    description: 'Medical AI consultation using the OpenClaw Medical Module. Use for clinical questions, symptom analysis, medication queries. Enforces hard triage (911 advisory for MI/CVA/Sepsis/Anaphylaxis).',
    input_schema: {
      type: 'object',
      properties: {
        message: { type: 'string', description: 'The clinical question or symptom description' },
        audience: { type: 'string', enum: ['patient', 'provider'], description: 'Who is asking — patient or provider' },
        specialist: { type: 'string', enum: ['asclepius', 'triage_nurse', 'pharmacist'], description: 'Which specialist to consult' }
      },
      required: ['message']
    }
  },

  github_operation: {
    description: 'Interact with GitHub. List repos, browse files, view issues, create issues, or get repo info.',
    input_schema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['status', 'list_repos', 'list_issues', 'get_file', 'create_issue', 'comment_issue'], description: 'What to do' },
        owner: { type: 'string', description: 'GitHub org or username' },
        repo: { type: 'string', description: 'Repository name' },
        path: { type: 'string', description: 'File path within repo (for get_file)' },
        title: { type: 'string', description: 'Issue title (for create_issue)' },
        body: { type: 'string', description: 'Issue body or comment text' },
        issue_number: { type: 'number', description: 'Issue number (for comment_issue)' }
      },
      required: ['action']
    }
  },

  send_platform_notification: {
    description: 'Send an in-platform notification to a user (provider or patient). Use to alert about actions taken, findings, or requests.',
    input_schema: {
      type: 'object',
      properties: {
        recipient_id: { type: 'string', description: 'User ID to notify' },
        title: { type: 'string', description: 'Notification title' },
        message: { type: 'string', description: 'Notification message body' },
        type: { type: 'string', enum: ['info', 'warning', 'action_required', 'success'], description: 'Notification type' }
      },
      required: ['title', 'message']
    }
  }
};

// ─────────────────────────────────────────────────────────────────────────
// TOOL EXECUTORS (what actually happens)
// ─────────────────────────────────────────────────────────────────────────

const TOOL_EXECUTORS = {

  async get_platform_stats({ include_revenue = false } = {}) {
    try {
      const r = await db.query(`
        SELECT
          (SELECT COUNT(*)::int FROM users) AS total_users,
          (SELECT COUNT(*)::int FROM users WHERE role = 'patient') AS total_patients,
          (SELECT COUNT(*)::int FROM users WHERE role IN ('provider','admin')) AS total_providers,
          (SELECT COUNT(*)::int FROM users WHERE role = 'provider' AND is_approved = false) AS pending_providers,
          (SELECT COUNT(*)::int FROM video_sessions) AS total_appointments,
          (SELECT COUNT(*)::int FROM video_sessions WHERE created_at > NOW() - INTERVAL '7 days') AS appointments_this_week,
          (SELECT COUNT(*)::int FROM video_sessions WHERE created_at > NOW() - INTERVAL '24 hours') AS appointments_today,
          (SELECT COUNT(*)::int FROM ai_credential_vault WHERE is_active = true) AS active_credentials,
          (SELECT COUNT(*)::int FROM crm_contacts) AS crm_contacts,
          (SELECT COUNT(*)::int FROM crm_contacts WHERE created_at > NOW() - INTERVAL '7 days') AS new_crm_contacts_week,
          (SELECT COUNT(*)::int FROM ai_proposals WHERE status = 'pending') AS pending_proposals,
          (SELECT COUNT(*)::int FROM ai_agent_results) AS total_agent_actions,
          (SELECT COUNT(*)::int FROM ai_agent_results WHERE created_at > NOW() - INTERVAL '24 hours') AS agent_actions_today,
          (SELECT COUNT(*)::int FROM ai_agent_results WHERE result_type = 'error' AND created_at > NOW() - INTERVAL '1 hour') AS recent_errors
      `);
      const stats = r.rows[0] || {};

      if (include_revenue) {
        try {
          const rev = await db.query(`
            SELECT
              COALESCE(SUM(amount_cents), 0)::int AS total_revenue_cents,
              COUNT(*)::int AS total_payments,
              COUNT(CASE WHEN created_at > NOW() - INTERVAL '30 days' THEN 1 END)::int AS payments_last_30d
            FROM payments WHERE status = 'paid'
          `);
          stats.total_revenue_dollars = Math.round((rev.rows[0]?.total_revenue_cents || 0) / 100);
          stats.total_payments = rev.rows[0]?.total_payments || 0;
          stats.payments_last_30d = rev.rows[0]?.payments_last_30d || 0;
        } catch (e) { /* payments table might not exist */ }
      }

      return { success: true, data: stats };
    } catch (err) {
      return { success: false, error: err.message };
    }
  },

  async query_patients({ search, limit = 20, status = 'all' } = {}) {
    try {
      limit = Math.min(Number(limit) || 20, 50);
      const params = [];
      let where = `WHERE role = 'patient'`;
      if (status === 'active') { where += ` AND is_active = true`; }
      if (status === 'inactive') { where += ` AND is_active = false`; }
      if (search) {
        params.push(`%${search.toLowerCase()}%`);
        where += ` AND (LOWER(first_name) LIKE $${params.length} OR LOWER(last_name) LIKE $${params.length} OR LOWER(email) LIKE $${params.length})`;
      }
      params.push(limit);
      const r = await db.query(
        `SELECT id, first_name, last_name, email, phone, created_at, is_active, date_of_birth
         FROM users ${where} ORDER BY created_at DESC LIMIT $${params.length}`, params
      );
      return { success: true, data: r.rows, count: r.rows.length };
    } catch (err) {
      return { success: false, error: err.message };
    }
  },

  async query_providers({ search, status = 'all', limit = 20 } = {}) {
    try {
      limit = Math.min(Number(limit) || 20, 50);
      const params = [];
      let where = `WHERE role = 'provider'`;
      if (status === 'approved') { where += ` AND is_approved = true`; }
      if (status === 'pending') { where += ` AND (is_approved = false OR is_approved IS NULL)`; }
      if (search) {
        params.push(`%${search.toLowerCase()}%`);
        where += ` AND (LOWER(first_name) LIKE $${params.length} OR LOWER(last_name) LIKE $${params.length} OR LOWER(email) LIKE $${params.length})`;
      }
      params.push(limit);
      const r = await db.query(
        `SELECT id, first_name, last_name, email, phone, specialty, is_approved, created_at
         FROM users ${where} ORDER BY created_at DESC LIMIT $${params.length}`, params
      );
      return { success: true, data: r.rows, count: r.rows.length };
    } catch (err) {
      return { success: false, error: err.message };
    }
  },

  async query_appointments({ status = 'all', days_back = 7, limit = 20 } = {}) {
    try {
      limit = Math.min(Number(limit) || 20, 50);
      const cutoff = new Date(Date.now() - (Number(days_back) || 7) * 86400000).toISOString();
      const params = [cutoff, limit];
      let where = `WHERE created_at >= $1`;
      if (status && status !== 'all') {
        params.splice(1, 0, status);
        where += ` AND status = $2`;
        params[2] = limit;
      }
      const r = await db.query(
        `SELECT vs.id, vs.status, vs.created_at, vs.scheduled_at, vs.provider_id, vs.patient_id,
                p.first_name AS patient_first, p.last_name AS patient_last,
                pr.first_name AS provider_first, pr.last_name AS provider_last
         FROM video_sessions vs
         LEFT JOIN users p ON vs.patient_id = p.id
         LEFT JOIN users pr ON vs.provider_id = pr.id
         ${where} ORDER BY vs.created_at DESC LIMIT $${params.length}`, params
      );
      return { success: true, data: r.rows, count: r.rows.length };
    } catch (err) {
      return { success: false, error: err.message };
    }
  },

  async query_prescriptions({ status = 'all', days_back = 30, limit = 20 } = {}) {
    try {
      limit = Math.min(Number(limit) || 20, 50);
      const cutoff = new Date(Date.now() - (Number(days_back) || 30) * 86400000).toISOString();
      const params = [cutoff, limit];
      let where = `WHERE p.created_at >= $1`;
      if (status && status !== 'all') {
        params.splice(1, 0, status);
        where += ` AND p.status = $2`;
        params[2] = limit;
      }
      const r = await db.query(
        `SELECT p.id, p.medication_name, p.dosage, p.status, p.created_at,
                u.first_name AS patient_first, u.last_name AS patient_last,
                pr.first_name AS provider_first, pr.last_name AS provider_last
         FROM prescriptions p
         LEFT JOIN users u ON p.patient_id = u.id
         LEFT JOIN users pr ON p.provider_id = pr.id
         ${where} ORDER BY p.created_at DESC LIMIT $${params.length}`, params
      );
      return { success: true, data: r.rows, count: r.rows.length };
    } catch (err) {
      return { success: false, error: err.message };
    }
  },

  async query_crm({ search, status, tags, limit = 20 } = {}) {
    try {
      limit = Math.min(Number(limit) || 20, 50);
      const params = [];
      const conditions = [];
      if (search) {
        params.push(`%${search.toLowerCase()}%`);
        conditions.push(`(LOWER(first_name) LIKE $${params.length} OR LOWER(last_name) LIKE $${params.length} OR LOWER(email) LIKE $${params.length} OR LOWER(company) LIKE $${params.length})`);
      }
      if (status && status !== 'all') {
        params.push(status);
        conditions.push(`status = $${params.length}`);
      }
      if (tags) {
        params.push(`%${tags}%`);
        conditions.push(`tags::text LIKE $${params.length}`);
      }
      const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
      params.push(limit);
      const r = await db.query(
        `SELECT id, first_name, last_name, email, phone, company, status, tags, source, created_at, notes
         FROM crm_contacts ${where} ORDER BY created_at DESC LIMIT $${params.length}`, params
      );
      return { success: true, data: r.rows, count: r.rows.length };
    } catch (err) {
      return { success: false, error: err.message };
    }
  },

  async create_crm_contact({ first_name, last_name, email, company, phone, tags = [], notes, source } = {}) {
    try {
      const r = await db.query(
        `INSERT INTO crm_contacts (first_name, last_name, email, company, phone, tags, notes, source, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'lead')
         ON CONFLICT (email) DO UPDATE SET
           first_name = EXCLUDED.first_name, last_name = EXCLUDED.last_name,
           company = EXCLUDED.company, tags = EXCLUDED.tags, notes = EXCLUDED.notes
         RETURNING id, first_name, last_name, email, company, status, created_at`,
        [first_name, last_name, email || null, company || null, phone || null,
         JSON.stringify(tags), notes || null, source || 'agent']
      );
      return { success: true, data: r.rows[0], message: `Contact ${first_name} ${last_name} created/updated in CRM.` };
    } catch (err) {
      return { success: false, error: err.message };
    }
  },

  async query_triage({ days_back = 7, urgency, limit = 20 } = {}) {
    try {
      limit = Math.min(Number(limit) || 20, 50);
      const cutoff = new Date(Date.now() - (Number(days_back) || 7) * 86400000).toISOString();
      const params = [cutoff, limit];
      let where = `WHERE created_at >= $1`;
      if (urgency && urgency !== 'all') {
        params.splice(1, 0, urgency);
        where += ` AND urgency_level = $2`;
        params[2] = limit;
      }
      const r = await db.query(
        `SELECT id, chief_complaint, urgency_level, recommendation, created_at, patient_id
         FROM triage_sessions ${where} ORDER BY created_at DESC LIMIT $${params.length}`, params
      );
      return { success: true, data: r.rows, count: r.rows.length };
    } catch (err) {
      return { success: false, error: err.message };
    }
  },

  async query_revenue({ days_back = 30 } = {}) {
    try {
      const cutoff = new Date(Date.now() - (Number(days_back) || 30) * 86400000).toISOString();
      const r = await db.query(
        `SELECT
           COALESCE(SUM(amount_cents), 0)::int AS total_cents,
           COUNT(*)::int AS total_transactions,
           COUNT(DISTINCT patient_id)::int AS unique_paying_patients,
           AVG(amount_cents)::int AS avg_transaction_cents
         FROM payments WHERE status = 'paid' AND created_at >= $1`, [cutoff]
      );
      const sub = await db.query(
        `SELECT COUNT(*)::int AS active_subs FROM user_memberships WHERE status = 'active'`
      ).catch(() => ({ rows: [{ active_subs: 0 }] }));

      const row = r.rows[0] || {};
      return {
        success: true,
        data: {
          total_revenue_dollars: Math.round((row.total_cents || 0) / 100),
          total_transactions: row.total_transactions || 0,
          unique_paying_patients: row.unique_paying_patients || 0,
          avg_transaction_dollars: Math.round((row.avg_transaction_cents || 0) / 100),
          active_subscriptions: sub.rows[0]?.active_subs || 0,
          period_days: days_back
        }
      };
    } catch (err) {
      return { success: false, error: err.message };
    }
  },

  async query_agent_results({ agent_type, result_type, limit = 20 } = {}) {
    try {
      limit = Math.min(Number(limit) || 20, 50);
      const params = [];
      const conditions = [];
      if (agent_type) { params.push(agent_type); conditions.push(`agent_type = $${params.length}`); }
      if (result_type) { params.push(result_type); conditions.push(`result_type = $${params.length}`); }
      const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
      params.push(limit);
      const r = await db.query(
        `SELECT id, agent_type, agent_name, result_type, title, description, metrics, created_at
         FROM ai_agent_results ${where} ORDER BY created_at DESC LIMIT $${params.length}`, params
      );
      return { success: true, data: r.rows, count: r.rows.length };
    } catch (err) {
      return { success: false, error: err.message };
    }
  },

  async log_agent_result({ result_type, title, description, metrics = {} } = {}) {
    try {
      const r = await db.query(
        `INSERT INTO ai_agent_results (agent_type, agent_name, result_type, title, description, metrics)
         VALUES ('tool_loop', 'Agent Loop', $1, $2, $3, $4) RETURNING id`,
        [result_type, title, description, JSON.stringify(metrics)]
      );
      return { success: true, id: r.rows[0]?.id, message: 'Result logged.' };
    } catch (err) {
      return { success: false, error: err.message };
    }
  },

  async search_web({ query, num_results = 8 } = {}) {
    if (!webEngine) return { success: false, error: 'Web engine not available.' };
    try {
      const results = await webEngine.webSearch(query, Math.min(Number(num_results) || 8, 15));
      return results;
    } catch (err) {
      return { success: false, error: err.message };
    }
  },

  async scrape_url({ url } = {}) {
    if (!webEngine) return { success: false, error: 'Web engine not available.' };
    if (!url || !url.startsWith('https://')) return { success: false, error: 'Only https:// URLs allowed.' };
    try {
      return await webEngine.deepScrape(url);
    } catch (err) {
      return { success: false, error: err.message };
    }
  },

  async read_uploaded_file({ file_id, max_chars = 6000 } = {}) {
    try {
      const r = await db.query(
        `SELECT id, original_name, mime_type, extraction_status, extracted_text, size_bytes, created_at
         FROM ai_uploaded_files WHERE id = $1`, [file_id]
      );
      if (!r.rows.length) return { success: false, error: 'File not found.' };
      const f = r.rows[0];
      return {
        success: true,
        data: {
          id: f.id,
          name: f.original_name,
          type: f.mime_type,
          extraction_status: f.extraction_status,
          text: String(f.extracted_text || '').slice(0, max_chars) || '(no text extracted)',
          size_bytes: f.size_bytes,
          uploaded_at: f.created_at
        }
      };
    } catch (err) {
      return { success: false, error: err.message };
    }
  },

  async list_uploaded_files() {
    try {
      const r = await db.query(
        `SELECT id, original_name, mime_type, size_bytes, extraction_status, created_at
         FROM ai_uploaded_files ORDER BY created_at DESC LIMIT 30`
      );
      return { success: true, data: r.rows, count: r.rows.length };
    } catch (err) {
      return { success: false, error: err.message };
    }
  },

  async list_credentials() {
    if (!credentialVault) return { success: false, error: 'Credential vault not available.' };
    try {
      const creds = await credentialVault.listCredentials({});
      const safe = (creds || []).map(c => ({
        id: c.id,
        platform: c.platform,
        platform_display_name: c.platform_display_name,
        account_label: c.account_label,
        assigned_agents: c.assigned_agents,
        is_active: c.is_active,
        last_used: c.last_used_at,
        added_at: c.created_at
      }));
      return { success: true, data: safe, count: safe.length };
    } catch (err) {
      return { success: false, error: err.message };
    }
  },

  async medical_consult({ message, audience = 'patient', specialist = 'asclepius' } = {}) {
    if (!medicalUnit) return { success: false, error: 'Medical unit not available.' };
    try {
      const result = await medicalUnit.consult({ message, audience, specialist, context: 'Agent tool call.' });
      return { success: true, data: { text: result.text, disclaimer: result.disclaimer, protocol: medicalUnit.PROTOCOL_VERSION } };
    } catch (err) {
      return { success: false, error: err.message };
    }
  },

  async github_operation({ action, owner, repo, path: filePath, title, body, issue_number } = {}) {
    if (!githubService) return { success: false, error: 'GitHub service not available.' };
    try {
      switch (action) {
        case 'status': {
          const who = await githubService.whoAmI('operator');
          return { success: true, data: who };
        }
        case 'list_repos': {
          const repos = await githubService.listRepos(owner, 'operator');
          return { success: true, data: repos.slice(0, 20) };
        }
        case 'list_issues': {
          const issues = await githubService.listIssues(owner, repo, 'operator');
          return { success: true, data: issues.slice(0, 20) };
        }
        case 'get_file': {
          const f = await githubService.getFile(owner, repo, filePath, 'operator');
          return { success: true, data: f };
        }
        case 'create_issue': {
          const issue = await githubService.createIssue(owner, repo, title, body, 'operator');
          return { success: true, data: issue };
        }
        case 'comment_issue': {
          const comment = await githubService.commentIssue(owner, repo, issue_number, body, 'operator');
          return { success: true, data: comment };
        }
        default:
          return { success: false, error: `Unknown GitHub action: ${action}` };
      }
    } catch (err) {
      return { success: false, error: err.message };
    }
  },

  async send_platform_notification({ recipient_id, title, message, type = 'info' } = {}) {
    try {
      if (recipient_id) {
        await db.query(
          `INSERT INTO notifications (user_id, title, message, type, is_read, created_at)
           VALUES ($1, $2, $3, $4, false, NOW())`,
          [recipient_id, title, message, type]
        );
      }
      return { success: true, message: `Notification "${title}" queued.` };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }
};

// ─────────────────────────────────────────────────────────────────────────
// AGENT-TO-TOOLS PERMISSIONS
// ─────────────────────────────────────────────────────────────────────────

// Which tools each agent type has access to by default
const AGENT_TOOL_PERMISSIONS = {
  ceo:              Object.keys(TOOL_DEFINITIONS),
  operations:       ['get_platform_stats','query_patients','query_providers','query_appointments','query_crm','create_crm_contact','search_web','scrape_url','list_credentials','log_agent_result','send_platform_notification','list_uploaded_files','read_uploaded_file'],
  growth:           ['get_platform_stats','query_crm','create_crm_contact','search_web','scrape_url','list_credentials','log_agent_result','query_providers','query_agent_results','list_uploaded_files','read_uploaded_file'],
  revenue:          ['get_platform_stats','query_revenue','query_crm','search_web','log_agent_result','list_credentials','query_agent_results'],
  compliance:       ['get_platform_stats','query_patients','query_providers','query_prescriptions','query_appointments','list_credentials','query_agent_results','log_agent_result'],
  governance:       ['get_platform_stats','query_agent_results','list_credentials','log_agent_result'],
  corporate_skills: ['get_platform_stats','search_web','scrape_url','list_credentials','log_agent_result'],
  researcher:       ['search_web','scrape_url','get_platform_stats','query_crm','log_agent_result','list_uploaded_files','read_uploaded_file'],
  economics:        ['get_platform_stats','query_revenue','search_web','log_agent_result'],
  physicist:        ['get_platform_stats','query_appointments','query_agent_results','log_agent_result'],
  mathematician:    ['get_platform_stats','query_revenue','query_appointments','query_patients','query_agent_results','log_agent_result'],
  vortex_math:      ['get_platform_stats','query_agent_results','log_agent_result'],
  devops:           ['get_platform_stats','query_agent_results','list_credentials','github_operation','search_web','log_agent_result'],
  asclepius:        ['medical_consult','query_patients','query_prescriptions','query_triage','log_agent_result'],
  triage_nurse:     ['medical_consult','query_triage','query_patients','log_agent_result','send_platform_notification'],
  pharmacist:       ['medical_consult','query_prescriptions','query_patients','log_agent_result']
};

// ─────────────────────────────────────────────────────────────────────────
// PUBLIC API
// ─────────────────────────────────────────────────────────────────────────

/**
 * Get tool definitions for Claude's API for a specific agent type.
 * Returns array of { name, description, input_schema } objects.
 */
function getToolDefinitions(agentType) {
  const allowed = AGENT_TOOL_PERMISSIONS[agentType] || Object.keys(TOOL_DEFINITIONS);
  return allowed
    .filter(name => TOOL_DEFINITIONS[name])
    .map(name => ({
      name,
      description: TOOL_DEFINITIONS[name].description,
      input_schema: TOOL_DEFINITIONS[name].input_schema
    }));
}

/**
 * Execute a tool by name with the given inputs.
 * Returns the tool result as a plain JS object.
 */
async function executeTool(name, input = {}) {
  const executor = TOOL_EXECUTORS[name];
  if (!executor) {
    return { success: false, error: `Unknown tool: ${name}` };
  }
  try {
    const result = await executor(input);
    return result;
  } catch (err) {
    console.error(`[ToolRegistry] Tool "${name}" threw:`, err.message);
    return { success: false, error: err.message };
  }
}

module.exports = { getToolDefinitions, executeTool, TOOL_DEFINITIONS, AGENT_TOOL_PERMISSIONS };
