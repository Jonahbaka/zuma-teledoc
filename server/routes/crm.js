/**
 * ═══════════════════════════════════════════════════════════════
 *  CRM API Routes — AI Agent CRM for Admin Portal
 * ═══════════════════════════════════════════════════════════════
 */

const express = require('express');
const router = express.Router();
const { z } = require('zod');
const { authenticate, requireRole } = require('../middleware/auth');
const crmService = require('../services/crmService');
let orchestrator = null;
try { orchestrator = require('../services/agent-orchestrator'); } catch (e) { /* optional */ }

const adminOnly = [authenticate, requireRole('admin', 'super_admin')];
const campaignDraft = z.object({
  name: z.string().trim().min(1).max(255),
  description: z.string().trim().max(5000).optional(),
  campaignType: z.enum(['cold_email', 'follow_up', 'newsletter', 'social_engage', 'investor_pitch', 'partnership']).default('cold_email'),
  targetContactType: z.string().trim().max(50).nullable().optional(),
  targetSpecialty: z.string().trim().max(255).nullable().optional(),
  subjectLine: z.string().trim().min(1).max(500),
  emailTemplate: z.string().trim().min(1).max(20000),
  sendTime: z.enum(['immediate', 'optimal', 'scheduled']).default('optimal'),
  dailyLimit: z.preprocess(value => typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value,
    z.number().int().min(1).max(200).default(50)),
});
const templateDraft = z.object({
  name: z.string().trim().min(1).max(255),
  category: z.enum(['cold_outreach', 'follow_up', 'investor_pitch', 'partnership', 'provider_invite', 'nurse_invite', 'social_intro']),
  subject: z.string().trim().min(1).max(500),
  body: z.string().trim().min(1).max(20000),
});

function normalizeCampaignBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return body;
  const normalized = { ...body };
  for (const [camel, snake] of [['campaignType', 'campaign_type'], ['targetContactType', 'target_contact_type'],
    ['targetSpecialty', 'target_specialty'], ['subjectLine', 'subject_line'], ['emailTemplate', 'email_template'],
    ['sendTime', 'send_time'], ['dailyLimit', 'daily_limit']]) {
    if (body[camel] !== undefined && body[snake] !== undefined && body[camel] !== body[snake]) {
      throw Object.assign(new Error('Conflicting campaign field values.'), { statusCode: 400 });
    }
    if (normalized[camel] === undefined) normalized[camel] = body[snake];
  }
  return normalized;
}

function crmError(res, error) {
  const known = [400, 403, 404, 409, 429].includes(error.statusCode);
  return res.status(known ? error.statusCode : 503).json({ success: false,
    error: known ? error.message : 'Relationship management is temporarily unavailable. No completed action was confirmed.' });
}

function deliveryResult(res, result) {
  if (!result || result.success !== true) {
    return res.status(result?.statusCode || (result?.status === 'unavailable' ? 503 : 409)).json({ success: false,
      error: result?.error || 'The message was not confirmed as sent.', code: result?.code, data: result });
  }
  return res.json({ success: true, data: result });
}

// ─── DASHBOARD ──────────────────────────────────────────────────

router.get('/dashboard', ...adminOnly, async (req, res) => {
  try {
    const stats = await crmService.getDashboardStats();
    res.json({ success: true, data: stats });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── CONTACTS ───────────────────────────────────────────────────

router.get('/contacts', ...adminOnly, async (req, res) => {
  try {
    const { type, stage, agent, search, priority, limit, sort } = req.query;
    const contacts = await crmService.getContacts({
      contactType: type, pipelineStage: stage, assignedAgent: agent,
      search, priority, limit: parseInt(limit) || 100, sort
    });
    res.json({ success: true, data: contacts });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/contacts/:id', ...adminOnly, async (req, res) => {
  try {
    const contact = await crmService.getContact(req.params.id);
    if (!contact) return res.status(404).json({ success: false, error: 'Contact not found' });
    res.json({ success: true, data: contact });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/contacts', ...adminOnly, async (req, res) => {
  try {
    const contact = await crmService.addContact(req.body);
    res.status(201).json({ success: true, data: contact });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/contacts/bulk', ...adminOnly, async (req, res) => {
  try {
    const results = await crmService.addContactsBulk(req.body.contacts || []);
    res.json({ success: true, data: results });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.put('/contacts/:id', ...adminOnly, async (req, res) => {
  try {
    const contact = await crmService.updateContact(req.params.id, req.body);
    res.json({ success: true, data: contact });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.put('/contacts/:id/stage', ...adminOnly, async (req, res) => {
  try {
    const { stage } = req.body;
    const contact = await crmService.updatePipelineStage(req.params.id, stage, 'operator');
    res.json({ success: true, data: contact });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.delete('/contacts/:id', ...adminOnly, async (req, res) => {
  try {
    await crmService.deleteContact(req.params.id);
    res.json({ success: true, message: 'Contact removed' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── INBOX THREADS (real agent outreach conversations) ──────────

router.get('/threads', ...adminOnly, async (req, res) => {
  try {
    const db = require('../db');
    // Return email interactions grouped by contact as inbox threads
    const { rows } = await db.query(`
      SELECT
        i.id,
        i.contact_id,
        c.first_name || ' ' || c.last_name AS contact_name,
        c.email AS contact_email,
        c.contact_type,
        i.subject,
        i.content AS preview,
        i.interaction_type,
        i.email_status,
        i.agent_type,
        i.created_at,
        i.read_at,
        (SELECT COUNT(*) FROM crm_interactions i2 WHERE i2.contact_id = i.contact_id AND i2.interaction_type IN ('email_sent','email_reply','reply')) AS message_count
      FROM crm_interactions i
      JOIN crm_contacts c ON c.id = i.contact_id
      WHERE i.interaction_type IN ('email_sent','email_reply','reply','inbound')
      ORDER BY i.created_at DESC
      LIMIT 100
    `);
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/threads/:contactId/messages', ...adminOnly, async (req, res) => {
  try {
    const db = require('../db');
    const { rows } = await db.query(`
      SELECT
        i.id,
        i.subject,
        i.content,
        i.interaction_type,
        i.agent_type,
        i.email_status,
        i.created_at,
        CASE WHEN i.interaction_type IN ('email_reply','reply','inbound') THEN 'in' ELSE 'out' END AS direction,
        CASE WHEN i.interaction_type IN ('email_reply','reply','inbound') THEN c.first_name || ' ' || c.last_name
             ELSE 'DoctaRx Agent' END AS sender
      FROM crm_interactions i
      JOIN crm_contacts c ON c.id = i.contact_id
      WHERE i.contact_id = $1
        AND i.interaction_type IN ('email_sent','email_reply','reply','inbound')
      ORDER BY i.created_at ASC
    `, [req.params.contactId]);
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── EMAIL OUTREACH ─────────────────────────────────────────────

router.post('/contacts/:id/email', ...adminOnly, async (req, res) => {
  try {
    const { subject, body } = req.body;
    if (!z.string().uuid().safeParse(req.params.id).success || !templateDraft.pick({ subject: true, body: true }).safeParse({ subject, body }).success) {
      return res.status(400).json({ success: false, error: 'A valid contact, subject and message are required.' });
    }
    const result = await crmService.sendEmail(req.params.id, subject, body, 'operator');
    deliveryResult(res, result);
  } catch (err) {
    crmError(res, err);
  }
});

// ─── CAMPAIGNS ──────────────────────────────────────────────────

router.get('/campaigns', ...adminOnly, async (req, res) => {
  try {
    const campaigns = await crmService.getCampaigns({ status: req.query.status });
    res.json({ success: true, data: campaigns });
  } catch (err) {
    crmError(res, err);
  }
});

router.post('/campaigns', ...adminOnly, async (req, res) => {
  try {
    const input = campaignDraft.safeParse(normalizeCampaignBody(req.body));
    if (!input.success) return res.status(400).json({ success: false, error: 'Enter a valid campaign name, type, subject, and message.' });
    const campaign = await crmService.createCampaign({ ...input.data, createdBy: req.user.id, auditActorId: req.user.id });
    if (!campaign?.id || campaign.status !== 'draft') return res.status(503).json({ success: false, error: 'The campaign draft could not be saved. No messages were sent.' });
    res.json({ success: true, data: campaign });
  } catch (err) {
    crmError(res, err);
  }
});

router.post('/campaigns/:id/approve', ...adminOnly, async (req, res) => {
  try {
    if (!z.string().uuid().safeParse(req.params.id).success) return res.status(400).json({ success: false, error: 'Use a valid campaign ID.' });
    const campaign = await crmService.approveCampaign(req.params.id, req.user.id);
    if (orchestrator && campaign?.id) {
      await orchestrator.emitEvent('crm.campaign.approved', {
        campaignId: campaign.id,
        status: campaign.status
      });
    }
    if (!campaign?.id || campaign.status !== 'approved') return res.status(404).json({ success: false, error: 'The campaign was not found or approval was not recorded.' });
    res.json({ success: true, data: campaign });
  } catch (err) {
    crmError(res, err);
  }
});

router.post('/campaigns/:id/send', ...adminOnly, async (req, res) => {
  try {
    const input = z.object({ limit: z.number().int().min(1).max(200).default(10) }).safeParse(req.body || {});
    if (!input.success || !z.string().uuid().safeParse(req.params.id).success) return res.status(400).json({ success: false, error: 'Use a valid campaign and bounded batch size.' });
    const results = await crmService.sendCampaignEmails(req.params.id, input.data.limit);
    deliveryResult(res, results);
  } catch (err) {
    crmError(res, err);
  }
});

// ─── TEMPLATES ──────────────────────────────────────────────────

router.get('/templates', ...adminOnly, async (req, res) => {
  try {
    const templates = await crmService.getTemplates(req.query.category);
    res.json({ success: true, data: templates });
  } catch (err) {
    crmError(res, err);
  }
});

router.post('/templates', ...adminOnly, async (req, res) => {
  try {
    const input = templateDraft.safeParse(req.body);
    if (!input.success) return res.status(400).json({ success: false, error: 'Enter a valid template name, category, subject, and message.' });
    const template = await crmService.createTemplate({ ...input.data, createdBy: req.user.id, auditActorId: req.user.id });
    if (!template?.id) return res.status(503).json({ success: false, error: 'The email template could not be saved.' });
    res.json({ success: true, data: template });
  } catch (err) {
    crmError(res, err);
  }
});

// ─── SCRAPING SOURCES ───────────────────────────────────────────

router.get('/sources', ...adminOnly, async (req, res) => {
  try {
    const sources = await crmService.getScrapeSources(req.query.type);
    res.json({ success: true, data: sources });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
