/**
 * ═══════════════════════════════════════════════════════════════
 *  CRM SERVICE — AI Agent Customer Relationship Management
 * ═══════════════════════════════════════════════════════════════
 * 
 *  The organism's outreach nervous system.
 *  Agents store contacts, manage pipelines, send cold emails
 *  via Zoho Mail (info@doctarx.com), and track interactions.
 * 
 *  Designed for minimal Operator supervision.
 *  All destructive actions (mass email) still require approval.
 * ═══════════════════════════════════════════════════════════════
 */

const db = require('../db');
const nodemailer = require('nodemailer');
const logger = require('../middleware/logger');

// ─── ZOHO MAIL TRANSPORT ────────────────────────────────────────
let transporter = null;
function getTransporter() {
  if (transporter) return transporter;
  if (process.env.SMTP_HOST && process.env.SMTP_USER) {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT) || 465,
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASSWORD
      },
      pool: true,
      maxConnections: 3,
      maxMessages: 50,
      rateDelta: 2000,  // 1 email per 2 seconds (Zoho-friendly)
      rateLimit: 1
    });
    return transporter;
  }
  return null;
}

// ─── RATE LIMITING ──────────────────────────────────────────────
const DAILY_EMAIL_LIMIT = 100;  // Zoho free tier limit
const HOURLY_EMAIL_LIMIT = 30;
let emailsSentToday = 0;
let emailsSentThisHour = 0;
let lastHourReset = Date.now();
let lastDayReset = Date.now();

function checkRateLimit() {
  const now = Date.now();
  if (now - lastHourReset > 3600000) { emailsSentThisHour = 0; lastHourReset = now; }
  if (now - lastDayReset > 86400000) { emailsSentToday = 0; lastDayReset = now; }
  if (emailsSentToday >= DAILY_EMAIL_LIMIT) return { allowed: false, reason: 'Daily email limit reached' };
  if (emailsSentThisHour >= HOURLY_EMAIL_LIMIT) return { allowed: false, reason: 'Hourly email limit reached' };
  return { allowed: true };
}

class CRMService {
  constructor() {
    this.initialized = false;
  }

  async initialize() {
    try {
      // Run migration
      const fs = require('fs');
      const path = require('path');
      const migrationPath = path.join(__dirname, '../db/migrations/300_crm_schema.sql');
      if (fs.existsSync(migrationPath)) {
        const sql = fs.readFileSync(migrationPath, 'utf8');
        await db.query(sql);
      }
      this.initialized = true;

      // Seed templates + scrape sources if empty
      await this._seedDefaults();

      // Auto-import any provider leads from agent web missions into CRM
      await this._importAgentLeads();

      return true;
    } catch (err) {
      logger.error('CRM init error:', err.message);
      this.initialized = false;
      return false;
    }
  }

  async _seedDefaults() {
    try {
      // Seed email templates if none exist
      const { rows: tplCheck } = await db.query('SELECT COUNT(*) FROM crm_email_templates');
      if (parseInt(tplCheck[0].count) === 0) {
        const templates = [
          {
            name: 'Provider Cold Outreach',
            category: 'cold_outreach',
            subject: 'Earn more seeing patients from anywhere — DoctaRx',
            body: `Hi {{first_name}},\n\nI noticed you practice {{specialty}} in {{organization}}. DoctaRx is a new AI-powered telehealth platform that lets you see patients remotely with:\n\n• AI-assisted triage that routes the right patients to you\n• Built-in e-prescribing (EPCS-ready)\n• HIPAA-compliant video visits\n• No platform fees for the first 90 days\n\nWould you be open to a 10-minute demo this week?\n\nBest,\nDoctaRx Team`
          },
          {
            name: 'Investor Intro',
            category: 'investor_pitch',
            subject: 'DoctaRx — AI telehealth disrupting $250B market',
            body: `Hi {{first_name}},\n\nDoctaRx is building the AI-first telehealth operating system. We combine:\n\n• 12-agent AI orchestra (compliance, growth, operations)\n• Real-time e-prescribing + insurance verification\n• Automated provider recruitment via NPI scraping\n• Zero-commission model for providers\n\nWe're bootstrapping and generating early revenue. Would love 15 minutes to share our traction.\n\nBest,\nJonah — Founder, DoctaRx`
          },
          {
            name: 'Partnership Proposal',
            category: 'partnership',
            subject: 'Partnership opportunity — DoctaRx + {{organization}}',
            body: `Hi {{first_name}},\n\nI'm reaching out from DoctaRx, an AI-powered telehealth platform. We think there's a strong synergy between our platforms.\n\nWe'd love to explore:\n• Patient referral pathways\n• Co-branded telehealth services\n• Technology integration\n\nWould you have 15 minutes this week for a quick call?\n\nBest,\nDoctaRx Team`
          },
          {
            name: 'Follow-Up (No Reply)',
            category: 'follow_up',
            subject: 'Re: Quick question about telehealth at {{organization}}',
            body: `Hi {{first_name}},\n\nJust circling back on my earlier note. I know you're busy — would a 5-minute call work better?\n\nWe're helping {{specialty}} practices see 30% more patients through AI triage. Happy to share specifics.\n\nBest,\nDoctaRx Team`
          },
          {
            name: 'Nurse Practitioner Recruitment',
            category: 'cold_outreach',
            subject: 'Practice telehealth independently — DoctaRx platform',
            body: `Hi {{first_name}},\n\nDoctaRx is building a network of independent NPs and PAs who want to practice telehealth on their own terms.\n\n• Set your own schedule\n• AI handles triage + scheduling\n• Built-in e-prescribing\n• Keep 100% of your consultation fees\n\nInterested in learning more?\n\nBest,\nDoctaRx Team`
          }
        ];

        for (const t of templates) {
          await db.query(`
            INSERT INTO crm_email_templates (name, category, subject, body, created_by)
            VALUES ($1, $2, $3, $4, 'system')
            ON CONFLICT (name) DO NOTHING
          `, [t.name, t.category, t.subject, t.body]).catch(() => {});
        }
        console.log('  📧 CRM: Seeded', templates.length, 'email templates');
      }

      // Seed scrape sources if none exist
      const { rows: srcCheck } = await db.query('SELECT COUNT(*) FROM crm_scrape_sources');
      if (parseInt(srcCheck[0].count) === 0) {
        const sources = [
          { name: 'NPI Registry (CMS)', url: 'https://npiregistry.cms.hhs.gov/', type: 'provider_directory', freq: 'daily' },
          { name: 'Psychology Today', url: 'https://www.psychologytoday.com/us/therapists', type: 'provider_directory', freq: 'weekly' },
          { name: 'Zocdoc Providers', url: 'https://www.zocdoc.com/', type: 'provider_directory', freq: 'weekly' },
          { name: 'LinkedIn Healthcare', url: 'https://www.linkedin.com/search/results/people/?keywords=telehealth%20physician', type: 'social_scrape', freq: 'weekly' },
          { name: 'Crunchbase HealthTech', url: 'https://www.crunchbase.com/search/organizations/field/organizations/categories/health-care', type: 'investor_research', freq: 'monthly' },
          { name: 'AngelList Health', url: 'https://angel.co/health-care', type: 'investor_research', freq: 'monthly' },
          { name: 'Fierce Healthcare', url: 'https://www.fiercehealthcare.com/', type: 'news_source', freq: 'daily' },
          { name: 'Becker Hospital Review', url: 'https://www.beckershospitalreview.com/', type: 'news_source', freq: 'daily' },
        ];

        for (const s of sources) {
          await db.query(`
            INSERT INTO crm_scrape_sources (name, url, source_type, scrape_frequency, is_active)
            VALUES ($1, $2, $3, $4, true)
            ON CONFLICT (url) DO NOTHING
          `, [s.name, s.url, s.type, s.freq]).catch(() => {});
        }
        console.log('  🌐 CRM: Seeded', sources.length, 'scrape sources');
      }
    } catch (err) {
      logger.error('CRM seed error:', err.message);
    }
  }

  async _importAgentLeads() {
    try {
      // Check if there are any provider leads from agent web missions that haven't been imported
      const { rows: leads } = await db.query(`
        SELECT evidence FROM ai_agent_results
        WHERE result_type IN ('provider_leads', 'web_scrape', 'mission_data')
          AND (evidence IS NOT NULL AND evidence::text != '{}' AND evidence::text != '[]' AND evidence::text != 'null')
        ORDER BY created_at DESC LIMIT 20
      `);

      if (leads.length === 0) return;

      let imported = 0;
      for (const lead of leads) {
        let providers = [];
        try { providers = typeof lead.evidence === 'string' ? JSON.parse(lead.evidence) : (lead.evidence || []); } catch (e) { continue; }

        for (const p of providers) {
          if (!p.name || p.name === 'Unknown') continue;
          const nameParts = p.name.split(' ');
          const firstName = nameParts[0] || '';
          const lastName = nameParts.slice(1).join(' ') || '';

          // Check if already exists by NPI
          if (p.npi) {
            const { rows: existing } = await db.query('SELECT id FROM crm_contacts WHERE npi_number = $1', [p.npi]);
            if (existing.length > 0) continue;
          }

          const result = await this.addContact({
            firstName,
            lastName,
            title: p.credential || '',
            specialty: p.specialty || '',
            contactType: 'provider',
            source: 'npi_registry',
            sourceAgent: 'corporate_skills',
            npiNumber: p.npi || null,
            city: p.city || '',
            state: p.state || '',
            phone: p.phone || '',
            notes: `Auto-imported from NPI Registry. Type: ${p.type || 'Individual'}`,
            assignedAgent: 'growth',
            priority: 'medium'
          });

          if (result) imported++;
        }
      }

      if (imported > 0) {
        console.log(`  📇 CRM: Auto-imported ${imported} provider leads from agent missions`);
      }
    } catch (err) {
      // Non-critical — table might not exist yet
    }
  }

  // ═══════════════════════════════════════════════════════════════
  //  CONTACTS
  // ═══════════════════════════════════════════════════════════════

  _normalizeContactData(data = {}) {
    return {
      firstName: data.firstName ?? data.first_name ?? '',
      lastName: data.lastName ?? data.last_name ?? '',
      email: data.email ?? null,
      phone: data.phone ?? null,
      title: data.title ?? null,
      organization: data.organization ?? null,
      contactType: data.contactType ?? data.contact_type ?? 'lead',
      specialty: data.specialty ?? null,
      subType: data.subType ?? data.sub_type ?? null,
      source: data.source ?? null,
      sourceUrl: data.sourceUrl ?? data.source_url ?? null,
      sourceAgent: data.sourceAgent ?? data.source_agent ?? null,
      linkedinUrl: data.linkedinUrl ?? data.linkedin_url ?? null,
      twitterHandle: data.twitterHandle ?? data.twitter_handle ?? null,
      website: data.website ?? null,
      npiNumber: data.npiNumber ?? data.npi_number ?? null,
      city: data.city ?? null,
      state: data.state ?? null,
      country: data.country ?? 'US',
      tags: data.tags ?? [],
      notes: data.notes ?? null,
      assignedAgent: data.assignedAgent ?? data.assigned_agent ?? null,
      priority: data.priority ?? 'medium'
    };
  }

  async addContact(data) {
    try {
      const contact = this._normalizeContactData(data);
      const { rows } = await db.query(`
        INSERT INTO crm_contacts (
          first_name, last_name, email, phone, title, organization,
          contact_type, specialty, sub_type, source, source_url, source_agent,
          linkedin_url, twitter_handle, website, npi_number,
          city, state, country, tags, notes, assigned_agent, priority
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)
        ON CONFLICT DO NOTHING
        RETURNING *
      `, [
        contact.firstName, contact.lastName, contact.email, contact.phone,
        contact.title, contact.organization, contact.contactType,
        contact.specialty, contact.subType, contact.source, contact.sourceUrl,
        contact.sourceAgent, contact.linkedinUrl, contact.twitterHandle,
        contact.website, contact.npiNumber, contact.city, contact.state,
        contact.country, contact.tags, contact.notes,
        contact.assignedAgent, contact.priority
      ]);
      return rows[0] || null;
    } catch (err) {
      // If duplicate email, try to update instead
      const contact = this._normalizeContactData(data);
      if (err.code === '23505' && contact.email) {
        return this.updateContactByEmail(contact.email, contact);
      }
      logger.error('CRM addContact error:', err.message);
      return null;
    }
  }

  async addContactsBulk(contacts) {
    const results = { added: 0, skipped: 0, errors: 0 };
    for (const c of contacts) {
      try {
        const result = await this.addContact(c);
        if (result) results.added++;
        else results.skipped++;
      } catch (e) {
        results.errors++;
      }
    }
    return results;
  }

  async updateContact(id, data) {
    try {
      const sets = [];
      const values = [id];
      let idx = 2;
      
      const fields = ['first_name', 'last_name', 'email', 'phone', 'title', 'organization',
        'contact_type', 'specialty', 'pipeline_stage', 'lead_score', 'priority',
        'notes', 'assigned_agent', 'next_followup_at', 'tags', 'opt_out'];
      const dataMap = {
        first_name: data.firstName, last_name: data.lastName, email: data.email,
        phone: data.phone, title: data.title, organization: data.organization,
        contact_type: data.contactType, specialty: data.specialty,
        pipeline_stage: data.pipelineStage, lead_score: data.leadScore,
        priority: data.priority, notes: data.notes, assigned_agent: data.assignedAgent,
        next_followup_at: data.nextFollowupAt, tags: data.tags, opt_out: data.optOut
      };

      for (const field of fields) {
        if (dataMap[field] !== undefined) {
          sets.push(`${field} = $${idx}`);
          values.push(dataMap[field]);
          idx++;
        }
      }
      if (sets.length === 0) return null;
      sets.push('updated_at = NOW()');

      const { rows } = await db.query(
        `UPDATE crm_contacts SET ${sets.join(', ')} WHERE id = $1 RETURNING *`, values
      );
      return rows[0] || null;
    } catch (err) {
      logger.error('CRM updateContact error:', err.message);
      return null;
    }
  }

  async updateContactByEmail(email, data) {
    try {
      const { rows } = await db.query(`
        UPDATE crm_contacts SET
          first_name = COALESCE($2, first_name),
          last_name = COALESCE($3, last_name),
          title = COALESCE($4, title),
          organization = COALESCE($5, organization),
          updated_at = NOW()
        WHERE email = $1 RETURNING *
      `, [email, data.firstName, data.lastName, data.title, data.organization]);
      return rows[0] || null;
    } catch (err) { return null; }
  }

  async getContacts(options = {}) {
    try {
      let query = 'SELECT * FROM crm_contacts WHERE is_active = true';
      const params = [];
      let idx = 1;

      if (options.contactType) { params.push(options.contactType); query += ` AND contact_type = $${idx++}`; }
      if (options.pipelineStage) { params.push(options.pipelineStage); query += ` AND pipeline_stage = $${idx++}`; }
      if (options.assignedAgent) { params.push(options.assignedAgent); query += ` AND assigned_agent = $${idx++}`; }
      if (options.search) {
        params.push(`%${options.search}%`);
        query += ` AND (first_name ILIKE $${idx} OR last_name ILIKE $${idx} OR email ILIKE $${idx} OR organization ILIKE $${idx})`;
        idx++;
      }
      if (options.priority) { params.push(options.priority); query += ` AND priority = $${idx++}`; }

      query += ` ORDER BY ${options.sort || 'lead_score DESC, created_at DESC'} LIMIT $${idx}`;
      params.push(options.limit || 100);

      const { rows } = await db.query(query, params);
      return rows;
    } catch (err) {
      logger.error('CRM getContacts error:', err.message);
      return [];
    }
  }

  async getContact(id) {
    try {
      const { rows } = await db.query('SELECT * FROM crm_contacts WHERE id = $1', [id]);
      if (!rows[0]) return null;
      // Get interactions
      const { rows: interactions } = await db.query(
        'SELECT * FROM crm_interactions WHERE contact_id = $1 ORDER BY created_at DESC LIMIT 50', [id]
      );
      return { ...rows[0], interactions };
    } catch (err) { return null; }
  }

  async deleteContact(id) {
    try {
      await db.query('UPDATE crm_contacts SET is_active = false WHERE id = $1', [id]);
      return true;
    } catch (err) { return false; }
  }

  // ═══════════════════════════════════════════════════════════════
  //  PIPELINE & SCORING
  // ═══════════════════════════════════════════════════════════════

  async updatePipelineStage(contactId, stage, agentType) {
    try {
      const { rows } = await db.query(`
        UPDATE crm_contacts SET pipeline_stage = $2, updated_at = NOW() WHERE id = $1 RETURNING *
      `, [contactId, stage]);

      // Log the interaction
      await db.query(`
        INSERT INTO crm_interactions (contact_id, interaction_type, content, agent_type)
        VALUES ($1, 'stage_changed', $2, $3)
      `, [contactId, `Stage changed to: ${stage}`, agentType]);

      return rows[0];
    } catch (err) { return null; }
  }

  async updateLeadScore(contactId, score, reason) {
    try {
      await db.query(`
        UPDATE crm_contacts SET lead_score = $2, updated_at = NOW() WHERE id = $1
      `, [contactId, Math.min(100, Math.max(0, score))]);
      return true;
    } catch (err) { return false; }
  }

  // ═══════════════════════════════════════════════════════════════
  //  EMAIL OUTREACH (via Zoho Mail)
  // ═══════════════════════════════════════════════════════════════

  async sendEmail(contactId, subject, body, agentType, campaignId = null) {
    const rateCheck = checkRateLimit();
    if (!rateCheck.allowed) {
      logger.warn(`CRM email rate limited: ${rateCheck.reason}`);
      return { success: false, error: rateCheck.reason };
    }

    try {
      // Get contact
      const { rows } = await db.query('SELECT * FROM crm_contacts WHERE id = $1', [contactId]);
      const contact = rows[0];
      if (!contact) return { success: false, error: 'Contact not found' };
      if (contact.opt_out) return { success: false, error: 'Contact opted out' };
      if (!contact.email) return { success: false, error: 'No email address' };

      // Personalize the email
      const personalizedSubject = this._personalize(subject, contact);
      const personalizedBody = this._personalize(body, contact);

      const transport = getTransporter();
      if (!transport) {
        logger.info('CRM email (no transport):', { to: contact.email, subject: personalizedSubject });
        return { success: true, simulated: true };
      }

      // Send via Zoho
      const result = await transport.sendMail({
        from: `"DoctaRx" <${process.env.SMTP_FROM || 'info@doctarx.com'}>`,
        to: contact.email,
        subject: personalizedSubject,
        html: this._wrapEmailHTML(personalizedBody, contact),
        text: personalizedBody,
        headers: {
          'X-Campaign-ID': campaignId || 'direct',
          'X-Agent': agentType || 'system',
          'List-Unsubscribe': `<mailto:info@doctarx.com?subject=unsubscribe>`
        }
      });

      emailsSentToday++;
      emailsSentThisHour++;

      // Log interaction
      await db.query(`
        INSERT INTO crm_interactions (
          contact_id, campaign_id, interaction_type, subject, content,
          message_id, email_status, agent_type
        ) VALUES ($1, $2, 'email_sent', $3, $4, $5, 'sent', $6)
      `, [contactId, campaignId, personalizedSubject, personalizedBody, result.messageId, agentType]);

      // Update contact
      await db.query(`
        UPDATE crm_contacts SET last_contacted_at = NOW(), 
          pipeline_stage = CASE WHEN pipeline_stage = 'new' OR pipeline_stage = 'outreach_queued' THEN 'contacted' ELSE pipeline_stage END,
          updated_at = NOW()
        WHERE id = $1
      `, [contactId]);

      return { success: true, messageId: result.messageId };
    } catch (err) {
      logger.error('CRM sendEmail error:', err.message);

      // Log bounced
      if (contactId) {
        await db.query(`
          INSERT INTO crm_interactions (contact_id, campaign_id, interaction_type, content, email_status, agent_type)
          VALUES ($1, $2, 'email_bounced', $3, 'bounced', $4)
        `, [contactId, campaignId, err.message, agentType]).catch(() => {});
      }

      return { success: false, error: err.message };
    }
  }

  async sendCampaignEmails(campaignId, limit = 10) {
    try {
      // Get campaign
      const { rows: campaigns } = await db.query('SELECT * FROM crm_campaigns WHERE id = $1', [campaignId]);
      const campaign = campaigns[0];
      if (!campaign) return { error: 'Campaign not found' };
      if (campaign.status !== 'approved' && campaign.status !== 'running') return { error: 'Campaign not approved' };

      // Get contacts that haven't been emailed in this campaign
      let contactQuery = `
        SELECT c.* FROM crm_contacts c
        WHERE c.is_active = true AND c.opt_out = false AND c.email IS NOT NULL
        AND c.id NOT IN (SELECT contact_id FROM crm_interactions WHERE campaign_id = $1 AND interaction_type = 'email_sent')
      `;
      const params = [campaignId];
      let idx = 2;

      if (campaign.target_contact_type) {
        params.push(campaign.target_contact_type);
        contactQuery += ` AND c.contact_type = $${idx++}`;
      }
      params.push(Math.min(limit, campaign.daily_limit || 50));
      contactQuery += ` ORDER BY c.lead_score DESC LIMIT $${idx}`;

      const { rows: contacts } = await db.query(contactQuery, params);

      // Update campaign status
      await db.query("UPDATE crm_campaigns SET status = 'running', updated_at = NOW() WHERE id = $1", [campaignId]);

      const results = { sent: 0, failed: 0, skipped: 0 };
      for (const contact of contacts) {
        const rateCheck = checkRateLimit();
        if (!rateCheck.allowed) { results.skipped += contacts.length - results.sent - results.failed; break; }

        const result = await this.sendEmail(
          contact.id,
          campaign.subject_line,
          campaign.email_template,
          campaign.created_by || 'growth-agent',
          campaignId
        );

        if (result.success) results.sent++;
        else results.failed++;

        // Delay between emails (Zoho-friendly)
        await new Promise(r => setTimeout(r, 2000));
      }

      // Update campaign stats
      await db.query(`
        UPDATE crm_campaigns SET 
          emails_sent = emails_sent + $2,
          total_contacts = (SELECT COUNT(*) FROM crm_contacts WHERE contact_type = COALESCE(target_contact_type, contact_type)),
          updated_at = NOW()
        WHERE id = $1
      `, [campaignId, results.sent]);

      return results;
    } catch (err) {
      logger.error('CRM sendCampaignEmails error:', err.message);
      return { error: err.message };
    }
  }

  // ═══════════════════════════════════════════════════════════════
  //  CAMPAIGNS
  // ═══════════════════════════════════════════════════════════════

  async createCampaign(data) {
    try {
      const campaignType = data.campaignType || data.campaign_type || 'cold_email';
      const targetContactType = data.targetContactType || data.target_contact_type || null;
      const targetSpecialty = data.targetSpecialty || data.target_specialty || null;
      const subjectLine = data.subjectLine || data.subject_line || '';
      const emailTemplate = data.emailTemplate || data.email_template || '';
      const sendTime = data.sendTime || data.send_time || 'optimal';
      const dailyLimit = data.dailyLimit || data.daily_limit || 50;
      const createdBy = data.createdBy || data.created_by || 'growth-agent';
      const { rows } = await db.query(`
        INSERT INTO crm_campaigns (
          name, description, campaign_type, target_contact_type,
          target_specialty, subject_line, email_template,
          send_time, daily_limit, created_by
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *
      `, [
        data.name, data.description, campaignType,
        targetContactType, targetSpecialty,
        subjectLine, emailTemplate,
        sendTime, dailyLimit,
        createdBy
      ]);
      return rows[0];
    } catch (err) {
      logger.error('CRM createCampaign error:', err.message);
      return null;
    }
  }

  async getCampaigns(options = {}) {
    try {
      let query = 'SELECT * FROM crm_campaigns WHERE 1=1';
      const params = [];
      if (options.status) { params.push(options.status); query += ` AND status = $${params.length}`; }
      query += ' ORDER BY created_at DESC LIMIT 50';
      const { rows } = await db.query(query, params);
      return rows;
    } catch (err) { return []; }
  }

  async approveCampaign(campaignId, approvedBy) {
    try {
      const { rows } = await db.query(`
        UPDATE crm_campaigns SET status = 'approved', approved_by = $2, updated_at = NOW()
        WHERE id = $1 RETURNING *
      `, [campaignId, approvedBy]);
      return rows[0];
    } catch (err) { return null; }
  }

  // ═══════════════════════════════════════════════════════════════
  //  EMAIL TEMPLATES
  // ═══════════════════════════════════════════════════════════════

  async getTemplates(category = null) {
    try {
      let query = 'SELECT * FROM crm_email_templates WHERE is_active = true';
      const params = [];
      if (category) { params.push(category); query += ` AND category = $1`; }
      query += ' ORDER BY reply_rate DESC, times_used DESC';
      const { rows } = await db.query(query, params);
      return rows;
    } catch (err) { return []; }
  }

  async createTemplate(data) {
    try {
      const { rows } = await db.query(`
        INSERT INTO crm_email_templates (name, category, subject, body, created_by)
        VALUES ($1, $2, $3, $4, $5) RETURNING *
      `, [data.name, data.category, data.subject, data.body, data.createdBy || 'system']);
      return rows[0];
    } catch (err) { return null; }
  }

  // ═══════════════════════════════════════════════════════════════
  //  SOCIAL ENGAGEMENT
  // ═══════════════════════════════════════════════════════════════

  async logSocialEngagement(data) {
    try {
      const { rows } = await db.query(`
        INSERT INTO crm_social_engagements (
          contact_id, platform, post_url, engagement_type, content, agent_type
        ) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *
      `, [data.contactId, data.platform, data.postUrl, data.engagementType, data.content, data.agentType]);
      return rows[0];
    } catch (err) { return null; }
  }

  // ═══════════════════════════════════════════════════════════════
  //  SCRAPING SOURCES
  // ═══════════════════════════════════════════════════════════════

  async getScrapeSources(type = null) {
    try {
      let query = 'SELECT * FROM crm_scrape_sources WHERE is_active = true';
      const params = [];
      if (type) { params.push(type); query += ` AND source_type = $1`; }
      query += ' ORDER BY contacts_found DESC';
      const { rows } = await db.query(query, params);
      return rows;
    } catch (err) { return []; }
  }

  async updateScrapeSource(id, contactsFound) {
    try {
      await db.query(`
        UPDATE crm_scrape_sources SET 
          last_scraped_at = NOW(), contacts_found = contacts_found + $2
        WHERE id = $1
      `, [id, contactsFound]);
    } catch (err) {}
  }

  // ═══════════════════════════════════════════════════════════════
  //  DASHBOARD / STATS
  // ═══════════════════════════════════════════════════════════════

  async getDashboardStats() {
    try {
      const [contacts, pipeline, campaigns, recent, sources] = await Promise.all([
        db.query(`
          SELECT contact_type, COUNT(*) as count FROM crm_contacts WHERE is_active = true GROUP BY contact_type
        `),
        db.query(`
          SELECT pipeline_stage, COUNT(*) as count FROM crm_contacts WHERE is_active = true GROUP BY pipeline_stage ORDER BY count DESC
        `),
        db.query(`
          SELECT status, COUNT(*) as count, SUM(emails_sent) as total_sent, SUM(emails_replied) as total_replied
          FROM crm_campaigns GROUP BY status
        `),
        db.query(`
          SELECT i.*, c.first_name, c.last_name, c.email, c.organization
          FROM crm_interactions i
          LEFT JOIN crm_contacts c ON i.contact_id = c.id
          ORDER BY i.created_at DESC LIMIT 20
        `),
        db.query('SELECT * FROM crm_scrape_sources WHERE is_active = true ORDER BY contacts_found DESC')
      ]);

      const totalContacts = contacts.rows.reduce((sum, r) => sum + parseInt(r.count), 0);
      const totalEmails = campaigns.rows.reduce((sum, r) => sum + parseInt(r.total_sent || 0), 0);

      return {
        totalContacts,
        contactsByType: contacts.rows,
        pipeline: pipeline.rows,
        pipelineDistribution: pipeline.rows,
        campaigns: campaigns.rows,
        campaignStats: campaigns.rows,
        recentInteractions: recent.rows,
        scrapeSources: sources.rows,
        emailStats: {
          totalSent: totalEmails,
          dailyRemaining: DAILY_EMAIL_LIMIT - emailsSentToday,
          hourlyRemaining: HOURLY_EMAIL_LIMIT - emailsSentThisHour
        }
      };
    } catch (err) {
      logger.error('CRM dashboard error:', err.message);
      return { totalContacts: 0, contactsByType: [], pipeline: [], campaigns: [], recentInteractions: [], scrapeSources: [], emailStats: {} };
    }
  }

  // ═══════════════════════════════════════════════════════════════
  //  HELPERS
  // ═══════════════════════════════════════════════════════════════

  _personalize(text, contact) {
    if (!text) return '';
    return text
      .replace(/\{\{first_name\}\}/g, contact.first_name || 'there')
      .replace(/\{\{last_name\}\}/g, contact.last_name || '')
      .replace(/\{\{organization\}\}/g, contact.organization || 'your organization')
      .replace(/\{\{specialty\}\}/g, contact.specialty || 'your specialty')
      .replace(/\{\{title\}\}/g, contact.title || '')
      .replace(/\{\{email\}\}/g, contact.email || '');
  }

  _wrapEmailHTML(body, contact) {
    return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #1a1a2e; max-width: 600px; margin: 0 auto; padding: 20px; line-height: 1.6;">
  <div style="border-bottom: 3px solid #7c3aed; padding-bottom: 16px; margin-bottom: 24px;">
    <h2 style="color: #7c3aed; margin: 0; font-size: 20px;">Docta<span style="color: #10b981;">.</span></h2>
    <p style="color: #64748b; font-size: 12px; margin: 4px 0 0;">AI-Powered Telehealth Platform</p>
  </div>
  <div style="white-space: pre-wrap; font-size: 14px;">${body.replace(/\n/g, '<br>')}</div>
  <div style="border-top: 1px solid #e2e8f0; margin-top: 32px; padding-top: 16px; font-size: 11px; color: #94a3b8;">
    <p>Docta. Telehealth Services | info@doctarx.com | doctarx.com</p>
    <p>If you no longer wish to receive emails, reply with "unsubscribe".</p>
  </div>
</body>
</html>`;
  }
}

module.exports = new CRMService();
