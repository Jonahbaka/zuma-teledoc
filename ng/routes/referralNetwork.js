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
const { getPool } = require('../../server/db');

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

const ADMIN_ROLES = new Set(['admin', 'super_admin']);
const PROVIDER_ROLES = new Set(['provider', 'doctor', 'consultant', 'physician', 'specialist']);
const PATIENT_ROLES = new Set(['patient']);
const AGENT_ROLES = new Set(['agent', 'referral_agent', 'referral_coordinator']);

function roleOf(req) {
  return String(req.user?.role || '').trim().toLowerCase().replace(/\s+/g, '_');
}

function forbidden(message = 'Referral access denied') {
  const err = new Error(message);
  err.code = 'FORBIDDEN';
  return err;
}

function sendReferralError(res, err, label = '[DRN] route') {
  if (err.code === 'FORBIDDEN') return res.status(403).json({ ok: false, error: err.message });
  if (err.code === 'NOT_FOUND') return res.status(404).json({ ok: false, error: err.message });
  if (err.code === 'INVALID_TRANSITION') return res.status(409).json({ ok: false, error: err.message });
  console.error(label, err);
  return res.status(500).json({ ok: false, error: err.message });
}

async function resolveProviderId(req, pool) {
  const result = await pool.query('SELECT id FROM ng_providers WHERE user_id = $1 LIMIT 1', [req.user.id]);
  return result.rows[0]?.id || null;
}

async function resolveAgentId(req, pool) {
  const result = await pool.query('SELECT id FROM drn_agents WHERE user_id = $1 LIMIT 1', [req.user.id]);
  return result.rows[0]?.id || null;
}

async function referralActorScope(req, pool) {
  const role = roleOf(req);
  const scope = { role, providerId: null, agentId: null, patientUserId: null };
  if (PROVIDER_ROLES.has(role)) scope.providerId = await resolveProviderId(req, pool);
  if (AGENT_ROLES.has(role)) scope.agentId = await resolveAgentId(req, pool);
  if (PATIENT_ROLES.has(role)) scope.patientUserId = req.user.id;
  return scope;
}

function canAccessReferral(scope, referral) {
  if (ADMIN_ROLES.has(scope.role)) return true;
  if (scope.patientUserId && referral.patient_user_id === scope.patientUserId) return true;
  if (scope.providerId && [referral.originating_provider, referral.destination_provider].includes(scope.providerId)) return true;
  if (scope.agentId && referral.originating_agent === scope.agentId) return true;
  return false;
}

async function getScopedReferral(req, id, pool) {
  const referral = await svc.getReferral(id, pool);
  if (!referral) return null;
  const scope = await referralActorScope(req, pool);
  if (canAccessReferral(scope, referral)) return referral;
  throw forbidden();
}

async function getScopedReferralByCode(req, refCode, pool) {
  const referral = await svc.getReferralByCode(refCode, pool);
  if (!referral) return null;
  const scope = await referralActorScope(req, pool);
  if (canAccessReferral(scope, referral)) return referral;
  throw forbidden();
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
  const pool = getPool();
  try {
    const { specialty, reason } = req.body || {};
    if (!specialty || !reason) {
      return res.status(400).json({ error: 'specialty and reason required' });
    }
    const role = roleOf(req);
    if (!ADMIN_ROLES.has(role) && !PROVIDER_ROLES.has(role) && !PATIENT_ROLES.has(role) && !AGENT_ROLES.has(role)) {
      throw forbidden('Referral creation denied');
    }
    const scope = await referralActorScope(req, pool);
    const input = { ...req.body };
    if (!ADMIN_ROLES.has(role)) {
      if (scope.patientUserId) input.patient_user_id = scope.patientUserId;
      if (scope.providerId) input.originating_provider = scope.providerId;
      if (scope.agentId) input.originating_agent = scope.agentId;
    }
    const referral = await svc.createReferral(input, asActor(req), pool);
    res.status(201).json({ ok: true, referral });
  } catch (err) {
    sendReferralError(res, err, '[DRN] create referral');
  }
});

router.get('/referrals', requireAuth, async (req, res) => {
  const pool = getPool();
  try {
    const role = roleOf(req);
    const scope = await referralActorScope(req, pool);
    const filters = {
      destination_org: req.query.destination_org,
      originating_org: req.query.originating_org,
      originating_agent: req.query.originating_agent,
      status: req.query.status,
      urgency: req.query.urgency,
      since: req.query.since,
      limit: req.query.limit ? Number(req.query.limit) : undefined,
    };
    if (!ADMIN_ROLES.has(role)) {
      filters.destination_org = undefined;
      filters.originating_org = undefined;
      if (scope.patientUserId) {
        filters.patient_user_id = scope.patientUserId;
        filters.originating_agent = undefined;
      } else if (scope.providerId) {
        filters.provider_id = scope.providerId;
        filters.originating_agent = undefined;
      } else if (scope.agentId) {
        filters.originating_agent = scope.agentId;
      } else {
        throw forbidden();
      }
    }
    const rows = await svc.listReferrals({
      ...filters,
    }, pool);
    res.json({ ok: true, referrals: rows });
  } catch (err) {
    sendReferralError(res, err, '[DRN] list referrals');
  }
});

router.get('/referrals/code/:refCode', requireAuth, async (req, res) => {
  const pool = getPool();
  try {
    const r = await getScopedReferralByCode(req, req.params.refCode, pool);
    if (!r) return res.status(404).json({ ok: false, error: 'Not found' });
    res.json({ ok: true, referral: r });
  } catch (err) {
    sendReferralError(res, err, '[DRN] get referral by code');
  }
});

router.get('/referrals/:id', requireAuth, async (req, res) => {
  const pool = getPool();
  try {
    const r = await getScopedReferral(req, req.params.id, pool);
    if (!r) return res.status(404).json({ ok: false, error: 'Not found' });
    res.json({ ok: true, referral: r });
  } catch (err) {
    sendReferralError(res, err, '[DRN] get referral');
  }
});

router.post('/referrals/:id/transition', requireAuth, async (req, res) => {
  const pool = getPool();
  try {
    const { to_status, scheduled_at, cancellation_reason, notes, payload } = req.body || {};
    if (!to_status) return res.status(400).json({ error: 'to_status required' });
    const referral = await getScopedReferral(req, req.params.id, pool);
    if (!referral) return res.status(404).json({ ok: false, error: 'Not found' });
    const updated = await svc.transitionReferral(
      req.params.id,
      to_status,
      asActor(req),
      { scheduled_at, cancellation_reason, notes, payload }
    );
    res.json({ ok: true, referral: updated });
  } catch (err) {
    sendReferralError(res, err, '[DRN] transition');
  }
});

router.post('/referrals/:id/qr', requireAuth, async (req, res) => {
  const pool = getPool();
  try {
    const { scope, ttlDays } = req.body || {};
    const referral = await getScopedReferral(req, req.params.id, pool);
    if (!referral) return res.status(404).json({ ok: false, error: 'Not found' });
    const out = await svc.mintQrToken(req.params.id, asActor(req), { scope, ttlDays }, pool);
    res.status(201).json({ ok: true, ...out });
  } catch (err) {
    sendReferralError(res, err, '[DRN] mint qr');
  }
});

router.get('/referrals/:id/events', requireAuth, async (req, res) => {
  const pool = getPool();
  try {
    const referral = await getScopedReferral(req, req.params.id, pool);
    if (!referral) return res.status(404).json({ ok: false, error: 'Not found' });
    const r = await pool.query(
      `SELECT * FROM drn_referral_events WHERE referral_id = $1 ORDER BY created_at ASC LIMIT 500`,
      [req.params.id]
    );
    res.json({ ok: true, events: r.rows });
  } catch (err) {
    sendReferralError(res, err, '[DRN] referral events');
  }
});

// ─── KPIs / commissions / heatmap ─────────────────────────────────────────────

router.get('/kpis', requireAuth, async (req, res) => {
  const pool = getPool();
  try {
    const role = roleOf(req);
    if (!ADMIN_ROLES.has(role)) {
      const agentId = await resolveAgentId(req, pool);
      if (!agentId) throw forbidden('Referral KPI access denied');
      const kpis = await svc.referralKpis({
        scope: 'agent',
        agent_id: agentId,
        since: req.query.since || null,
      }, pool);
      return res.json({ ok: true, kpis });
    }
    const kpis = await svc.referralKpis({
      scope: req.query.scope || 'platform',
      org_id: req.query.org_id || null,
      agent_id: req.query.agent_id || null,
      since: req.query.since || null,
    }, pool);
    res.json({ ok: true, kpis });
  } catch (err) {
    sendReferralError(res, err, '[DRN] kpis');
  }
});

router.get('/commissions', requireAuth, async (req, res) => {
  const pool = getPool();
  try {
    const role = roleOf(req);
    const agentId = ADMIN_ROLES.has(role) ? req.query.agent_id : await resolveAgentId(req, pool);
    if (!ADMIN_ROLES.has(role) && !agentId) throw forbidden('Commission access denied');
    const rows = await svc.listCommissions({
      agent_id: agentId,
      status: req.query.status,
      limit: req.query.limit ? Number(req.query.limit) : undefined,
    }, pool);
    res.json({ ok: true, commissions: rows });
  } catch (err) {
    sendReferralError(res, err, '[DRN] commissions');
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

router.get('/agents', requireAuth, requireAdmin, async (req, res) => {
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
