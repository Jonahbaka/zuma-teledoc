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

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const crmFailure = (statusCode, message) => Object.assign(new Error(message), { statusCode });

async function auditCRMWrite(client, actorId, resourceType, resource, values, action = 'create') {
  if (actorId) {
    if (!UUID.test(actorId)) throw crmFailure(403, 'Current administrator access is required.');
    const current = await client.query('SELECT role,is_active FROM users WHERE id=$1 FOR SHARE', [actorId]);
    if (!current.rows[0]?.is_active || !['admin', 'super_admin'].includes(current.rows[0].role)) throw crmFailure(403, 'Current administrator access is required.');
  }
  await client.query(`INSERT INTO audit_logs (user_id,action,resource_type,resource_id,phi_accessed,success,description,new_values)
    VALUES ($1,$2,$3,$4,FALSE,TRUE,$5,$6::jsonb)`, [actorId || null, action, resourceType, resource.id,
    `DoctaRx ${resourceType} ${action}`, JSON.stringify(values)]);
}

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
      // Schema changes belong to the explicit deployment migration job.
      // Replaying migration 300 here also replayed template inserts and
      // deduplication deletes against existing records on every server start.
      await db.query('SELECT id FROM crm_campaigns LIMIT 0');
      await db.query('SELECT id FROM crm_email_templates LIMIT 0');
      await db.query('SELECT id FROM crm_contacts LIMIT 0');
      this.initialized = true;
      await this._importAgentLeads();
      return true;
    } catch (error) {
      logger.error('CRM schema is unavailable', { code: error.code || 'CRM_SCHEMA_UNAVAILABLE' });
      this.initialized = false;
      return false;
    }
  }

  async _seedDefaults() {
    // Retain the legacy helper interface without importing marketing claims,
    // template records or scrape-source defaults. Templates are authored by
    // an authenticated operator through the audited template endpoint.
    return { templatesInserted: 0, sourcesInserted: 0 };
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
      return { success: false, statusCode: 429, error: rateCheck.reason };
    }

    try {
      // Get contact
      const { rows } = await db.query('SELECT * FROM crm_contacts WHERE id = $1', [contactId]);
      const contact = rows[0];
      if (!contact) return { success: false, statusCode: 404, error: 'Contact not found' };
      if (contact.opt_out) return { success: false, statusCode: 409, error: 'Contact opted out' };
      if (!contact.email) return { success: false, statusCode: 409, error: 'No email address' };

      // Personalize the email
      const personalizedSubject = this._personalize(subject, contact);
      const personalizedBody = this._personalize(body, contact);

      const transport = getTransporter();
      if (!transport) {
        return { success: false, statusCode: 503, status: 'unavailable', code: 'EMAIL_TRANSPORT_NOT_CONNECTED', error: 'Email delivery is not connected. No message was sent.' };
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

      if (!result?.messageId || !Array.isArray(result.accepted) ||
          !result.accepted.some(address => String(address).toLowerCase() === String(contact.email).toLowerCase())) {
        return { success: false, statusCode: 502, code: 'EMAIL_ACCEPTANCE_UNCONFIRMED', error: 'The mail server did not confirm acceptance for this recipient. No sent state was recorded.' };
      }

      emailsSentToday++;
      emailsSentThisHour++;

      // SMTP acceptance is irreversible. Its interaction and contact update
      // are committed together; persistence failure requires reconciliation.
      try {
        await db.transaction(async client => {
          await client.query(`
        INSERT INTO crm_interactions (
          contact_id, campaign_id, interaction_type, subject, content,
          message_id, email_status, agent_type
        ) VALUES ($1, $2, 'email_sent', $3, $4, $5, 'sent', $6)
      `, [contactId, campaignId, personalizedSubject, personalizedBody, result.messageId, agentType]);

      // Update contact
          await client.query(`
        UPDATE crm_contacts SET last_contacted_at = NOW(), 
          pipeline_stage = CASE WHEN pipeline_stage = 'new' OR pipeline_stage = 'outreach_queued' THEN 'contacted' ELSE pipeline_stage END,
          updated_at = NOW()
        WHERE id = $1
      `, [contactId]);
        });
      } catch (_) {
        return { success: false, statusCode: 503, status: 'reconciliation_required', code: 'EMAIL_RECORDING_FAILED',
          messageId: result.messageId, error: 'The mail server accepted the message, but its record could not be saved. Reconcile before retrying delivery.' };
      }

      return { success: true, status: 'accepted', messageId: result.messageId };
    } catch (err) {
      logger.error('CRM email operation failed', { code: err.code || 'EMAIL_DELIVERY_FAILED' });
      return { success: false, statusCode: 503, code: 'EMAIL_DELIVERY_FAILED', error: 'Email delivery could not be confirmed. Review recorded outcomes before retrying.' };
    }
  }

  async sendCampaignEmails(campaignId, limit = 10) {
    try {
      if (!getTransporter()) return { success: false, statusCode: 503, status: 'unavailable', code: 'EMAIL_TRANSPORT_NOT_CONNECTED',
        error: 'Email delivery is not connected. No campaign messages were sent.', sent: 0, failed: 0, skipped: 0 };
      // Get campaign
      const { rows: campaigns } = await db.query('SELECT * FROM crm_campaigns WHERE id = $1', [campaignId]);
      const campaign = campaigns[0];
      if (!campaign) return { success: false, statusCode: 404, error: 'Campaign not found' };
      if (campaign.status !== 'approved' && campaign.status !== 'running') return { success: false, statusCode: 409, error: 'Campaign not approved' };

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

      if (!contacts.length) return { success: true, status: 'empty', sent: 0, failed: 0, skipped: 0 };

      // Update campaign status
      await db.query("UPDATE crm_campaigns SET status = 'running', updated_at = NOW() WHERE id = $1", [campaignId]);

      const results = { success: true, sent: 0, failed: 0, skipped: 0 };
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
      return { success: false, statusCode: 503, error: 'Campaign delivery could not be completed. Review recorded outcomes before retrying.' };
    }
  }

  // ═══════════════════════════════════════════════════════════════
  //  CAMPAIGNS
  // ═══════════════════════════════════════════════════════════════

  async createCampaign(data) {
      const campaignType = data.campaignType || data.campaign_type || 'cold_email';
      const targetContactType = data.targetContactType || data.target_contact_type || null;
      const targetSpecialty = data.targetSpecialty || data.target_specialty || null;
      const subjectLine = data.subjectLine || data.subject_line || '';
      const emailTemplate = data.emailTemplate || data.email_template || '';
      const sendTime = data.sendTime || data.send_time || 'optimal';
      const dailyLimit = data.dailyLimit || data.daily_limit || 50;
      const createdBy = data.createdBy || data.created_by || 'growth-agent';
      return db.transaction(async client => {
      const { rows } = await client.query(`
        INSERT INTO crm_campaigns (
          name, description, campaign_type, target_contact_type,
          target_specialty, subject_line, email_template,
          send_time, daily_limit, created_by, status
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'draft') RETURNING *
      `, [
        data.name, data.description, campaignType,
        targetContactType, targetSpecialty,
        subjectLine, emailTemplate,
        sendTime, dailyLimit,
        createdBy
      ]);
      if (!rows[0]?.id || rows[0].status !== 'draft') throw crmFailure(503, 'The campaign draft was not recorded.');
      await auditCRMWrite(client, data.auditActorId, 'crm_campaign', rows[0], { name: rows[0].name, status: 'draft', createdBy });
      return rows[0];
      });
  }

  async getCampaigns(options = {}) {
    try {
      let query = 'SELECT * FROM crm_campaigns WHERE 1=1';
      const params = [];
      if (options.status) { params.push(options.status); query += ` AND status = $${params.length}`; }
      query += ' ORDER BY created_at DESC LIMIT 50';
      const { rows } = await db.query(query, params);
      return rows;
    } catch (err) { throw err; }
  }

  async approveCampaign(campaignId, approvedBy) {
    return db.transaction(async client => {
      const existing = await client.query('SELECT id,status FROM crm_campaigns WHERE id=$1 FOR UPDATE', [campaignId]);
      if (!existing.rows[0]) throw crmFailure(404, 'Campaign not found.');
      if (existing.rows[0].status !== 'draft') throw crmFailure(409, 'Only a current campaign draft can be approved.');
      const { rows } = await client.query(`
        UPDATE crm_campaigns SET status = 'approved', approved_by = $2, updated_at = NOW()
        WHERE id = $1 AND status = 'draft' RETURNING *
      `, [campaignId, approvedBy]);
      if (!rows[0]?.id) throw crmFailure(404, 'Campaign not found.');
      await auditCRMWrite(client, approvedBy, 'crm_campaign', rows[0], { previousStatus: 'draft', status: 'approved', approvedBy }, 'update');
      return rows[0];
    });
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
    } catch (err) { throw err; }
  }

  async createTemplate(data) {
    try {
      return await db.transaction(async client => {
      const { rows } = await client.query(`
        INSERT INTO crm_email_templates (name, category, subject, body, created_by)
        VALUES ($1, $2, $3, $4, $5) RETURNING *
      `, [data.name, data.category, data.subject, data.body, data.createdBy || data.created_by || 'system']);
      if (!rows[0]?.id) throw crmFailure(503, 'The email template was not recorded.');
      await auditCRMWrite(client, data.auditActorId, 'crm_template', rows[0], { name: rows[0].name, category: rows[0].category, createdBy: data.createdBy || data.created_by || 'system' });
      return rows[0];
      });
    } catch (err) {
      if (err.code === '23505') throw crmFailure(409, 'An email template with this name already exists.');
      throw err;
    }
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
    <h2 style="color: #7c3aed; margin: 0; font-size: 20px;">DoctaRx</h2>
    <p style="color: #64748b; font-size: 12px; margin: 4px 0 0;">AI-Powered Telehealth Platform</p>
  </div>
  <div style="white-space: pre-wrap; font-size: 14px;">${body.replace(/\n/g, '<br>')}</div>
  <div style="border-top: 1px solid #e2e8f0; margin-top: 32px; padding-top: 16px; font-size: 11px; color: #94a3b8;">
    <p>DoctaRx Telehealth Services | info@doctarx.com | doctarx.com</p>
    <p>If you no longer wish to receive emails, reply with "unsubscribe".</p>
  </div>
</body>
</html>`;
  }
}

module.exports = new CRMService();
