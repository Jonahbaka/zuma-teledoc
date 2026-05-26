/**
 * ng/routes/referralNetwork.js
 *
 * DoctaRx Referral Network (DRN) API.
 * Mounted at /api/ng/referral-network.
 *
 * Public:
 *   GET  /verify-qr/:token           — patient-facing QR verification
 *
 * Authenticated:
 *   GET  /organizations              — browse receiving orgs
 *   GET  /listings                   — browse marketplace listings
 *   POST /match                      — AI specialist matcher
 *   POST /referrals                  — create draft
 *   GET  /referrals                  — list (inbox/outbox via query)
 *   GET  /referrals/:id              — single
 *   GET  /referrals/code/:refCode    — lookup by ref code
 *   POST /referrals/:id/transition   — advance state machine
 *   POST /referrals/:id/qr           — mint QR slip token (returns raw token ONCE)
 *   GET  /referrals/:id/events       — audit trail
 *   GET  /kpis                       — dashboard KPIs (scope query)
 *   GET  /commissions                — commission ledger
 *   GET  /heatmap                    — referral heatmap cells
 *   POST /heatmap/refresh            — admin only
 *   POST /agents                     — register agent (admin)
 *   GET  /agents                     — list agents
 */

const express = require('express');
const router = express.Router();
const svc = require('../services/referral-network/referralNetworkService');

// Auth import is provided by ng/routes/index.js wrapping. The route is mounted with
// authenticate already applied for protected endpoints, and the public verify-qr
// endpoint is mounted on a sub-router below.

const publicRouter = express.Router();

publicRouter.get('/verify-qr/:token', async (req, res) => {
  try {
    const row = await svc.verifyQrToken(req.params.token, {
      ip: req.ip || req.headers['x-forwarded-for'] || null,
    });
    if (!row) return res.status(404).json({ ok: false, error: 'Invalid or expired token' });
    // Strip the hash from response; expose patient-safe slip data only.
    res.json({
      ok: true,
      slip: {
        ref_code: row.ref_code,
        status: row.referral_status,
        specialty: row.specialty,
        patient_name: row.patient_name,
        patient_phone: row.patient_phone,
        destination_org: row.destination_org,
        scan_count: row.scan_count,
        scope: row.scope,
      },
    });
  } catch (err) {
    console.error('[DRN] verify-qr error', err);
    res.status(500).json({ ok: false, error: 'Server error' });
  }
});

router.use('/public', publicRouter);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function asActor(req) {
  return {
    user_id: req.user?.id || null,
    kind: req.user?.role === 'patient' ? 'patient'
        : req.user?.role === 'agent' ? 'agent'
        : req.user?.role === 'provider' ? 'provider'
        : 'facility',
  };
}

function requireAuth(req, res, next) {
  if (!req.user?.id) return res.status(401).json({ error: 'Authentication required' });
  next();
}

function requireAdmin(req, res, next) {
  const role = req.user?.role;
  if (!['admin', 'super_admin'].includes(role)) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

// ─── Orgs & listings ──────────────────────────────────────────────────────────

router.get('/organizations', requireAuth, async (req, res) => {
  try {
    const rows = await svc.listOrganizations({
      type: req.query.type,
      state: req.query.state,
      lga: req.query.lga,
      search: req.query.search,
      limit: req.query.limit ? Number(req.query.limit) : undefined,
    });
    res.json({ ok: true, organizations: rows });
  } catch (err) {
    console.error('[DRN] list orgs', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.get('/listings', requireAuth, async (req, res) => {
  try {
    const rows = await svc.listListings({
      specialty: req.query.specialty,
      service_kind: req.query.service_kind,
      state: req.query.state,
      lga: req.query.lga,
      accepts_emergency: req.query.accepts_emergency === 'true' || undefined,
      limit: req.query.limit ? Number(req.query.limit) : undefined,
    });
    res.json({ ok: true, listings: rows });
  } catch (err) {
    console.error('[DRN] list listings', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.post('/match', requireAuth, async (req, res) => {
  try {
    const { specialty } = req.body || {};
    if (!specialty) return res.status(400).json({ error: 'specialty required' });
    const matches = await svc.matchSpecialists(req.body, { limit: req.body.limit || 10 });
    res.json({ ok: true, matches });
  } catch (err) {
    console.error('[DRN] match', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ─── Referrals ────────────────────────────────────────────────────────────────

router.post('/referrals', requireAuth, async (req, res) => {
  try {
    const { specialty, reason } = req.body || {};
    if (!specialty || !reason) {
      return res.status(400).json({ error: 'specialty and reason required' });
    }
    const referral = await svc.createReferral(req.body, asActor(req));
    res.status(201).json({ ok: true, referral });
  } catch (err) {
    console.error('[DRN] create referral', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.get('/referrals', requireAuth, async (req, res) => {
  try {
    const rows = await svc.listReferrals({
      destination_org: req.query.destination_org,
      originating_org: req.query.originating_org,
      originating_agent: req.query.originating_agent,
      status: req.query.status,
      urgency: req.query.urgency,
      since: req.query.since,
      limit: req.query.limit ? Number(req.query.limit) : undefined,
    });
    res.json({ ok: true, referrals: rows });
  } catch (err) {
    console.error('[DRN] list referrals', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.get('/referrals/code/:refCode', requireAuth, async (req, res) => {
  try {
    const r = await svc.getReferralByCode(req.params.refCode);
    if (!r) return res.status(404).json({ ok: false, error: 'Not found' });
    res.json({ ok: true, referral: r });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.get('/referrals/:id', requireAuth, async (req, res) => {
  try {
    const r = await svc.getReferral(req.params.id);
    if (!r) return res.status(404).json({ ok: false, error: 'Not found' });
    res.json({ ok: true, referral: r });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.post('/referrals/:id/transition', requireAuth, async (req, res) => {
  try {
    const { to_status, scheduled_at, cancellation_reason, notes, payload } = req.body || {};
    if (!to_status) return res.status(400).json({ error: 'to_status required' });
    const updated = await svc.transitionReferral(
      req.params.id,
      to_status,
      asActor(req),
      { scheduled_at, cancellation_reason, notes, payload }
    );
    res.json({ ok: true, referral: updated });
  } catch (err) {
    if (err.code === 'NOT_FOUND') return res.status(404).json({ ok: false, error: err.message });
    if (err.code === 'INVALID_TRANSITION') return res.status(409).json({ ok: false, error: err.message });
    console.error('[DRN] transition', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.post('/referrals/:id/qr', requireAuth, async (req, res) => {
  try {
    const { scope, ttlDays } = req.body || {};
    const out = await svc.mintQrToken(req.params.id, asActor(req), { scope, ttlDays });
    res.status(201).json({ ok: true, ...out });
  } catch (err) {
    console.error('[DRN] mint qr', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.get('/referrals/:id/events', requireAuth, async (req, res) => {
  try {
    const { getPool } = require('../../server/db');
    const pool = getPool();
    const r = await pool.query(
      `SELECT * FROM drn_referral_events WHERE referral_id = $1 ORDER BY created_at ASC LIMIT 500`,
      [req.params.id]
    );
    res.json({ ok: true, events: r.rows });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ─── KPIs / commissions / heatmap ─────────────────────────────────────────────

router.get('/kpis', requireAuth, async (req, res) => {
  try {
    const kpis = await svc.referralKpis({
      scope: req.query.scope || 'platform',
      org_id: req.query.org_id || null,
      agent_id: req.query.agent_id || null,
      since: req.query.since || null,
    });
    res.json({ ok: true, kpis });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.get('/commissions', requireAuth, async (req, res) => {
  try {
    const rows = await svc.listCommissions({
      agent_id: req.query.agent_id,
      status: req.query.status,
      limit: req.query.limit ? Number(req.query.limit) : undefined,
    });
    res.json({ ok: true, commissions: rows });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.get('/heatmap', requireAuth, async (req, res) => {
  try {
    const rows = await svc.readHeatmap({
      specialty: req.query.specialty,
      state: req.query.state,
      limit: req.query.limit ? Number(req.query.limit) : undefined,
    });
    res.json({ ok: true, cells: rows });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.post('/heatmap/refresh', requireAuth, requireAdmin, async (req, res) => {
  try {
    await svc.refreshHeatmap({ since: req.body?.since });
    res.json({ ok: true });
  } catch (err) {
    console.error('[DRN] heatmap refresh', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ─── Agents ───────────────────────────────────────────────────────────────────

router.post('/agents', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { full_name, phone } = req.body || {};
    if (!full_name || !phone) return res.status(400).json({ error: 'full_name and phone required' });
    const agent = await svc.registerAgent(req.body);
    res.status(201).json({ ok: true, agent });
  } catch (err) {
    console.error('[DRN] register agent', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.get('/agents', requireAuth, async (req, res) => {
  try {
    const rows = await svc.listAgents({
      status: req.query.status,
      jurisdiction_id: req.query.jurisdiction_id,
      limit: req.query.limit ? Number(req.query.limit) : undefined,
    });
    res.json({ ok: true, agents: rows });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;
