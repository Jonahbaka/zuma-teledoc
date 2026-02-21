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

let crmService;
try { crmService = require('../crmService'); } catch (e) { /* optional */ }

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
    description: 'Query CRM contacts and leads. Find contacts by name, email, organization, tags, or pipeline stage. Essential for growth and outreach.',
    input_schema: {
      type: 'object',
      properties: {
        search: { type: 'string', description: 'Name, email, or organization search' },
        contact_type: { type: 'string', description: 'Filter: provider, investor, partner, lead, nurse, admin, influencer, media, all' },
        pipeline_stage: { type: 'string', description: 'Filter: new, researching, outreach_queued, contacted, responded, interested, negotiating, converted, lost, nurturing, all' },
        tags: { type: 'string', description: 'Filter by tag (e.g. provider, patient, investor)' },
        limit: { type: 'number', description: 'Max results (default 20)' }
      },
      required: []
    }
  },

  create_crm_contact: {
    description: 'Create a new CRM contact. Use when you find a provider lead, investor, partner, or any contact worth tracking. Duplicates by email are prevented automatically.',
    input_schema: {
      type: 'object',
      properties: {
        first_name: { type: 'string', description: 'First name' },
        last_name: { type: 'string', description: 'Last name' },
        email: { type: 'string', description: 'Email address (optional but recommended for dedup)' },
        organization: { type: 'string', description: 'Company or organization name' },
        phone: { type: 'string', description: 'Phone number' },
        contact_type: { type: 'string', description: 'provider, investor, partner, lead, or nurse' },
        specialty: { type: 'string', description: 'Medical specialty if applicable' },
        city: { type: 'string', description: 'City' },
        state: { type: 'string', description: 'State code' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Tags like: telehealth, NPI, accelerator' },
        notes: { type: 'string', description: 'Any relevant context about this contact' },
        source: { type: 'string', description: 'Where this came from: web_search, npi_registry, linkedin, manual' },
        source_url: { type: 'string', description: 'URL where this contact was found' },
        pipeline_stage: { type: 'string', description: 'new, contacted, outreach_queued, qualified, proposal_sent, negotiation, won, lost' },
        lead_score: { type: 'number', description: '0-100 quality score' }
      },
      required: ['first_name', 'last_name']
    }
  },

  update_crm_contact: {
    description: 'Update a CRM contact\'s pipeline stage, lead score, or notes. Use after outreach, a call, or any interaction that changes the contact\'s status.',
    input_schema: {
      type: 'object',
      properties: {
        contact_id: { type: 'string', description: 'The CRM contact ID to update' },
        pipeline_stage: { type: 'string', description: 'New stage: new, researching, outreach_queued, contacted, responded, interested, negotiating, converted, lost, nurturing' },
        lead_score: { type: 'number', description: 'New lead score 0-100' },
        notes: { type: 'string', description: 'Add context notes about this contact' }
      },
      required: ['contact_id']
    }
  },

  send_crm_email: {
    description: 'Send a personalized outreach email to a CRM contact via Zoho Mail. Logs the interaction automatically. Use for provider recruitment, investor outreach, or partnership inquiries.',
    input_schema: {
      type: 'object',
      properties: {
        contact_id: { type: 'string', description: 'The CRM contact ID to email' },
        subject: { type: 'string', description: 'Email subject line' },
        body: { type: 'string', description: 'Email body text (plain text or simple HTML). Use {{first_name}} for personalization.' },
        agent_type: { type: 'string', description: 'The agent sending this (e.g. growth, corporate_skills)' }
      },
      required: ['contact_id', 'subject', 'body']
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
    // Run each query individually so one missing table never kills the whole stat block
    const stats = {};
    const safeCount = async (sql, label) => {
      try {
        const r = await db.query(sql);
        stats[label] = parseInt(r.rows[0]?.c ?? r.rows[0]?.count ?? 0, 10);
      } catch { /* table may not exist yet */ }
    };

    await safeCount(`SELECT COUNT(*)::int AS c FROM users`, 'total_users');
    await safeCount(`SELECT COUNT(*)::int AS c FROM users WHERE role = 'patient'`, 'total_patients');
    await safeCount(`SELECT COUNT(*)::int AS c FROM users WHERE role IN ('provider','admin')`, 'total_providers');
    await safeCount(`SELECT COUNT(*)::int AS c FROM users WHERE role = 'provider' AND (provider_status = 'pending' OR provider_status IS NULL)`, 'pending_providers');
    await safeCount(`SELECT COUNT(*)::int AS c FROM video_sessions`, 'total_appointments');
    await safeCount(`SELECT COUNT(*)::int AS c FROM video_sessions WHERE created_at > NOW() - INTERVAL '7 days'`, 'appointments_this_week');
    await safeCount(`SELECT COUNT(*)::int AS c FROM video_sessions WHERE created_at > NOW() - INTERVAL '24 hours'`, 'appointments_today');
    await safeCount(`SELECT COUNT(*)::int AS c FROM ai_credential_vault WHERE is_active = true`, 'active_credentials');
    await safeCount(`SELECT COUNT(*)::int AS c FROM crm_contacts`, 'crm_contacts');
    await safeCount(`SELECT COUNT(*)::int AS c FROM ai_proposals WHERE status = 'pending'`, 'pending_proposals');
    await safeCount(`SELECT COUNT(*)::int AS c FROM ai_agent_results`, 'total_agent_actions');
    await safeCount(`SELECT COUNT(*)::int AS c FROM ai_agent_results WHERE result_type = 'error' AND created_at > NOW() - INTERVAL '1 hour'`, 'recent_errors');
    await safeCount(`SELECT COUNT(*)::int AS c FROM prescriptions`, 'total_prescriptions');
    await safeCount(`SELECT COUNT(*)::int AS c FROM triage_sessions`, 'total_triage_sessions');
    await safeCount(`SELECT COUNT(*)::int AS c FROM invitations WHERE status = 'pending'`, 'pending_invitations');

    if (include_revenue) {
      try {
        const rev = await db.query(`SELECT COALESCE(SUM(amount_cents),0)::int AS t, COUNT(*)::int AS cnt FROM payments WHERE status = 'paid'`);
        stats.total_revenue_dollars = Math.round((rev.rows[0]?.t || 0) / 100);
        stats.total_payments = rev.rows[0]?.cnt || 0;
      } catch { /* payments table may not exist */ }
    }

    const populated = Object.keys(stats).length;
    if (populated === 0) return { success: false, error: 'No database tables accessible. Check DB connection.' };
    return { success: true, data: stats, tables_read: populated };
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
      if (status === 'approved') { where += ` AND provider_status = 'approved'`; }
      if (status === 'pending') { where += ` AND (provider_status = 'pending' OR provider_status IS NULL)`; }
      if (search) {
        params.push(`%${search.toLowerCase()}%`);
        where += ` AND (LOWER(first_name) LIKE $${params.length} OR LOWER(last_name) LIKE $${params.length} OR LOWER(email) LIKE $${params.length})`;
      }
      params.push(limit);
      const r = await db.query(
        `SELECT id, first_name, last_name, email, phone, specialty, provider_status, created_at
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
      let where = `WHERE vs.created_at >= $1`;
      if (status && status !== 'all') {
        params.splice(1, 0, status);
        where += ` AND vs.status = $2`;
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
        `SELECT p.id, p.medication_name, p.dosage_strength, p.dosage_form, p.status, p.created_at,
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

  async query_crm({ search, contact_type, pipeline_stage, tags, limit = 20 } = {}) {
    try {
      limit = Math.min(Number(limit) || 20, 50);
      const params = [];
      const conditions = [];
      if (search) {
        params.push(`%${search.toLowerCase()}%`);
        conditions.push(`(LOWER(first_name) LIKE $${params.length} OR LOWER(last_name) LIKE $${params.length} OR LOWER(email) LIKE $${params.length} OR LOWER(COALESCE(organization,'')) LIKE $${params.length})`);
      }
      if (contact_type && contact_type !== 'all') {
        params.push(contact_type);
        conditions.push(`contact_type = $${params.length}`);
      }
      if (pipeline_stage && pipeline_stage !== 'all') {
        params.push(pipeline_stage);
        conditions.push(`pipeline_stage = $${params.length}`);
      }
      if (tags) {
        params.push(`%${tags}%`);
        conditions.push(`tags::text LIKE $${params.length}`);
      }
      const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
      params.push(limit);
      const r = await db.query(
        `SELECT id, first_name, last_name, email, phone, organization, contact_type, pipeline_stage, lead_score, tags, source, created_at, notes
         FROM crm_contacts ${where} ORDER BY created_at DESC LIMIT $${params.length}`, params
      );
      return { success: true, data: r.rows, count: r.rows.length };
    } catch (err) {
      return { success: false, error: err.message };
    }
  },

  async create_crm_contact({ first_name, last_name, email, organization, phone, contact_type = 'lead', tags = [], notes, source, source_url, specialty, city, state, pipeline_stage = 'new', lead_score = 0 } = {}) {
    try {
      if (email) {
        const dup = await db.query(`SELECT id FROM crm_contacts WHERE email = $1 LIMIT 1`, [email]);
        if (dup.rows.length > 0) {
          return { success: true, data: dup.rows[0], message: `Contact with email ${email} already exists (id: ${dup.rows[0].id}).`, duplicate: true };
        }
      }
      const r = await db.query(
        `INSERT INTO crm_contacts (first_name, last_name, email, organization, phone, contact_type, tags, notes, source, source_url, source_agent, specialty, city, state, pipeline_stage, lead_score)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
         RETURNING id, first_name, last_name, email, organization, contact_type, pipeline_stage, created_at`,
        [first_name || '', last_name || '', email || null, organization || null, phone || null,
         contact_type || 'lead', Array.isArray(tags) ? `{${tags.join(',')}}` : '{}',
         notes || null, source || 'agent', source_url || null, 'agent',
         specialty || null, city || null, state || null, pipeline_stage || 'new', lead_score || 0]
      );
      return { success: true, data: r.rows[0], message: `Contact ${first_name} ${last_name} added to CRM.` };
    } catch (err) {
      return { success: false, error: err.message };
    }
  },

  async update_crm_contact({ contact_id, pipeline_stage, lead_score, notes } = {}) {
    try {
      if (!contact_id) return { success: false, error: 'contact_id is required' };
      const updates = {};
      if (pipeline_stage) updates.pipeline_stage = pipeline_stage;
      if (lead_score != null) updates.lead_score = lead_score;
      if (notes) updates.notes = notes;
      if (Object.keys(updates).length === 0) return { success: false, error: 'No fields to update' };
      if (crmService) {
        if (pipeline_stage) await crmService.updatePipelineStage(contact_id, pipeline_stage, 'agent');
        if (lead_score != null) await crmService.updateLeadScore(contact_id, lead_score, 'agent update');
        if (notes && !pipeline_stage && lead_score == null) await crmService.updateContact(contact_id, { notes });
      } else {
        const setClauses = [];
        const params = [];
        if (pipeline_stage) { params.push(pipeline_stage); setClauses.push(`pipeline_stage = $${params.length}`); }
        if (lead_score != null) { params.push(lead_score); setClauses.push(`lead_score = $${params.length}`); }
        if (notes) { params.push(notes); setClauses.push(`notes = $${params.length}`); }
        params.push(contact_id);
        await db.query(`UPDATE crm_contacts SET ${setClauses.join(', ')}, updated_at = NOW() WHERE id = $${params.length}`, params);
      }
      return { success: true, message: `Contact ${contact_id} updated.`, updates };
    } catch (err) {
      return { success: false, error: err.message };
    }
  },

  async send_crm_email({ contact_id, subject, body, agent_type = 'agent' } = {}) {
    try {
      if (!contact_id || !subject || !body) return { success: false, error: 'contact_id, subject, and body are required' };
      if (crmService) {
        const result = await crmService.sendEmail(contact_id, subject, body, agent_type);
        return result;
      }
      // Fallback: log the email intent without sending
      await db.query(
        `INSERT INTO crm_interactions (contact_id, type, subject, content, direction, agent_type, created_at)
         VALUES ($1, 'email_queued', $2, $3, 'out', $4, NOW())
         ON CONFLICT DO NOTHING`,
        [contact_id, subject, body, agent_type]
      );
      return { success: true, message: 'Email queued (CRM service unavailable, logged for manual send).' };
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
  operations:       ['get_platform_stats','query_patients','query_providers','query_appointments','query_crm','create_crm_contact','update_crm_contact','send_crm_email','search_web','scrape_url','list_credentials','log_agent_result','send_platform_notification','list_uploaded_files','read_uploaded_file'],
  growth:           ['get_platform_stats','query_crm','create_crm_contact','update_crm_contact','send_crm_email','search_web','scrape_url','list_credentials','log_agent_result','query_providers','query_agent_results','list_uploaded_files','read_uploaded_file'],
  revenue:          ['get_platform_stats','query_revenue','query_crm','update_crm_contact','search_web','log_agent_result','list_credentials','query_agent_results'],
  compliance:       ['get_platform_stats','query_patients','query_providers','query_prescriptions','query_appointments','list_credentials','query_agent_results','log_agent_result'],
  governance:       ['get_platform_stats','query_agent_results','list_credentials','log_agent_result'],
  corporate_skills: ['get_platform_stats','search_web','scrape_url','list_credentials','log_agent_result','query_crm','create_crm_contact','update_crm_contact','send_crm_email','query_providers'],
  researcher:       ['search_web','scrape_url','get_platform_stats','query_crm','create_crm_contact','log_agent_result','list_uploaded_files','read_uploaded_file'],
  economics:        ['get_platform_stats','query_revenue','search_web','log_agent_result','query_crm'],
  physicist:        ['get_platform_stats','query_appointments','query_agent_results','log_agent_result'],
  mathematician:    ['get_platform_stats','query_revenue','query_appointments','query_patients','query_agent_results','log_agent_result'],
  vortex_math:      ['get_platform_stats','query_agent_results','log_agent_result'],
  devops:           ['get_platform_stats','query_agent_results','list_credentials','github_operation','search_web','log_agent_result'],
  engineering:      ['get_platform_stats','query_agent_results','list_credentials','github_operation','search_web','scrape_url','log_agent_result','query_patients','query_providers','list_uploaded_files','read_uploaded_file'],
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
