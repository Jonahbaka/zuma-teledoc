/**
 * ═══════════════════════════════════════════════════════════════
 *  CRM API Routes — AI Agent CRM for Admin Portal
 * ═══════════════════════════════════════════════════════════════
 */

const express = require('express');
const router = express.Router();
const { authenticate, requireRole } = require('../middleware/auth');
const crmService = require('../services/crmService');
let orchestrator = null;
try { orchestrator = require('../services/agent-orchestrator'); } catch (e) { /* optional */ }

const adminOnly = [authenticate, requireRole('admin', 'super_admin')];

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

// ─── EMAIL OUTREACH ─────────────────────────────────────────────

router.post('/contacts/:id/email', ...adminOnly, async (req, res) => {
  try {
    const { subject, body } = req.body;
    const result = await crmService.sendEmail(req.params.id, subject, body, 'operator');
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── CAMPAIGNS ──────────────────────────────────────────────────

router.get('/campaigns', ...adminOnly, async (req, res) => {
  try {
    const campaigns = await crmService.getCampaigns({ status: req.query.status });
    res.json({ success: true, data: campaigns });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/campaigns', ...adminOnly, async (req, res) => {
  try {
    const campaign = await crmService.createCampaign(req.body);
    res.json({ success: true, data: campaign });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/campaigns/:id/approve', ...adminOnly, async (req, res) => {
  try {
    const campaign = await crmService.approveCampaign(req.params.id, req.user.id);
    if (orchestrator && campaign?.id) {
      await orchestrator.emitEvent('crm.campaign.approved', {
        campaignId: campaign.id,
        status: campaign.status
      });
    }
    res.json({ success: true, data: campaign });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/campaigns/:id/send', ...adminOnly, async (req, res) => {
  try {
    const { limit } = req.body;
    const results = await crmService.sendCampaignEmails(req.params.id, limit || 10);
    res.json({ success: true, data: results });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── TEMPLATES ──────────────────────────────────────────────────

router.get('/templates', ...adminOnly, async (req, res) => {
  try {
    const templates = await crmService.getTemplates(req.query.category);
    res.json({ success: true, data: templates });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/templates', ...adminOnly, async (req, res) => {
  try {
    const template = await crmService.createTemplate(req.body);
    res.json({ success: true, data: template });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
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
