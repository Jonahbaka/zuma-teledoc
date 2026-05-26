'use strict';

/**
 * ng/services/referral-network/referralNetworkService.js
 *
 * DoctaRx Referral Network (DRN) service.
 *
 * Owns:
 *  - Referral state machine (draft → sent → received → accepted → scheduled →
 *    in_progress → completed | cancelled | no_show | declined | expired)
 *  - AI specialist matching (geo + specialty + wait + price + acceptance_rate)
 *  - QR slip mint/verify (SHA-256 hashed tokens, mirroring portal_access_tokens)
 *  - Commission accrual on completion (agent + originator + platform split)
 *  - Heatmap aggregate refresh
 *  - Event/audit logging for every transition
 */

const crypto = require('crypto');
const { getPool } = require('../../../server/db');

// ─── State machine ────────────────────────────────────────────────────────────

const REFERRAL_TRANSITIONS = {
  draft:       ['sent', 'cancelled'],
  sent:        ['received', 'cancelled', 'expired'],
  received:    ['accepted', 'declined', 'expired', 'cancelled'],
  accepted:    ['scheduled', 'cancelled'],
  scheduled:   ['in_progress', 'no_show', 'cancelled'],
  in_progress: ['completed', 'cancelled'],
  // terminal
  completed:   [],
  cancelled:   [],
  no_show:     [],
  declined:    [],
  expired:     [],
};

function isValidTransition(from, to) {
  if (!from || !to) return false;
  return (REFERRAL_TRANSITIONS[from] || []).includes(to);
}

function isTerminal(status) {
  return (REFERRAL_TRANSITIONS[status] || []).length === 0;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toNumber(v) {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function generateRefCode() {
  const year = new Date().getUTCFullYear();
  const rand = crypto.randomBytes(4).toString('base64url').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
  return `DRN-${year}-${rand}`;
}

function generateAgentCode(juris) {
  const prefix = (juris || 'DRN').toUpperCase().slice(0, 5);
  const rand = crypto.randomBytes(2).toString('hex').toUpperCase();
  return `${prefix}-A${rand}`;
}

function hashToken(raw) {
  return crypto.createHash('sha256').update(raw, 'utf8').digest('hex');
}

function mintToken() {
  return crypto.randomBytes(24).toString('base64url');
}

// ─── Org / listing reads ──────────────────────────────────────────────────────

async function listOrganizations({ type, state, lga, search, limit = 50 } = {}, pool = getPool()) {
  const where = ['active = TRUE'];
  const params = [];
  if (type)   { params.push(type);   where.push(`org_type = $${params.length}`); }
  if (state)  { params.push(state);  where.push(`state = $${params.length}`); }
  if (lga)    { params.push(lga);    where.push(`lga = $${params.length}`); }
  if (search) { params.push(`%${search}%`); where.push(`name ILIKE $${params.length}`); }
  params.push(Math.min(limit, 200));
  const sql = `
    SELECT id, hospital_id, org_type, name, slug, city, state, lga,
           latitude, longitude, contact_phone, accepts_referrals,
           emergency_capable, rating_avg, rating_count
      FROM drn_organizations
     WHERE ${where.join(' AND ')}
     ORDER BY rating_avg DESC NULLS LAST, name
     LIMIT $${params.length}
  `;
  const r = await pool.query(sql, params);
  return r.rows;
}

async function listListings({ specialty, service_kind, state, lga, accepts_emergency, limit = 50 } = {}, pool = getPool()) {
  const where = ['l.active = TRUE', 'o.active = TRUE'];
  const params = [];
  if (specialty)     { params.push(specialty);     where.push(`l.specialty = $${params.length}`); }
  if (service_kind)  { params.push(service_kind);  where.push(`l.service_kind = $${params.length}`); }
  if (state)         { params.push(state);         where.push(`o.state = $${params.length}`); }
  if (lga)           { params.push(lga);           where.push(`o.lga = $${params.length}`); }
  if (accepts_emergency) {
    where.push(`l.accepts_emergency = TRUE`);
  }
  params.push(Math.min(limit, 200));
  const sql = `
    SELECT l.id, l.organization_id, l.provider_id, l.specialty, l.service_kind,
           l.title, l.description, l.price_min_naira, l.price_max_naira,
           l.avg_wait_minutes, l.accepts_emergency, l.accepts_insurance,
           l.acceptance_rate, l.total_referrals, l.completed_referrals,
           l.featured,
           o.name AS org_name, o.state AS org_state, o.lga AS org_lga,
           o.latitude, o.longitude
      FROM drn_marketplace_listings l
      JOIN drn_organizations o ON o.id = l.organization_id
     WHERE ${where.join(' AND ')}
     ORDER BY l.featured DESC, l.acceptance_rate DESC, l.avg_wait_minutes ASC NULLS LAST
     LIMIT $${params.length}
  `;
  const r = await pool.query(sql, params);
  return r.rows;
}

// ─── AI matching ──────────────────────────────────────────────────────────────

/**
 * Score a candidate listing against a referral request. Heuristic — explainable.
 *
 * Inputs:
 *   request: { specialty, urgency, prefer_state, prefer_lga, max_price, accepts_insurance }
 *   candidate: row from listListings
 *
 * Output: { score (0..100), reasons: string[] }
 */
function scoreCandidate(request, candidate) {
  const reasons = [];
  let score = 0;

  // Specialty match (hard requirement)
  if (candidate.specialty === request.specialty) {
    score += 35;
    reasons.push('specialty match');
  } else {
    return { score: 0, reasons: ['specialty mismatch'] };
  }

  // Geography (same LGA > same state > anywhere)
  if (request.prefer_lga && candidate.org_lga === request.prefer_lga) {
    score += 20;
    reasons.push('same LGA');
  } else if (request.prefer_state && candidate.org_state === request.prefer_state) {
    score += 12;
    reasons.push('same state');
  }

  // Emergency capability
  if (request.urgency === 'emergency' && candidate.accepts_emergency) {
    score += 15;
    reasons.push('emergency-capable');
  } else if (request.urgency === 'emergency' && !candidate.accepts_emergency) {
    score -= 25;
    reasons.push('not emergency-capable');
  }

  // Affordability
  if (request.max_price && candidate.price_max_naira) {
    if (toNumber(candidate.price_max_naira) <= toNumber(request.max_price)) {
      score += 10;
      reasons.push('within budget');
    } else {
      score -= 8;
      reasons.push('over budget');
    }
  }

  // Insurance
  if (request.accepts_insurance && candidate.accepts_insurance) {
    score += 8;
    reasons.push('accepts insurance');
  }

  // Acceptance rate (operational reliability)
  const accept = toNumber(candidate.acceptance_rate);
  if (accept >= 90)      { score += 8;  reasons.push('high acceptance rate'); }
  else if (accept >= 70) { score += 4; }
  else if (accept < 50)  { score -= 6; reasons.push('low acceptance rate'); }

  // Wait time
  const wait = toNumber(candidate.avg_wait_minutes);
  if (wait > 0 && wait <= 30)      { score += 6; reasons.push('short wait'); }
  else if (wait > 0 && wait <= 90) { score += 2; }
  else if (wait > 180)             { score -= 4; reasons.push('long wait'); }

  // Throughput proof
  if (candidate.completed_referrals > 50) {
    score += 4;
    reasons.push('proven throughput');
  }

  return { score: Math.max(0, Math.min(100, score)), reasons };
}

async function matchSpecialists(request, { limit = 10 } = {}, pool = getPool()) {
  const candidates = await listListings({
    specialty: request.specialty,
    state: request.prefer_state,
    accepts_emergency: request.urgency === 'emergency' || undefined,
    limit: 100,
  }, pool);

  const scored = candidates
    .map(c => ({ ...c, ...scoreCandidate(request, c) }))
    .filter(c => c.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  return scored;
}

// ─── Create + dispatch a referral ────────────────────────────────────────────

async function createReferral(input, actor, pool = getPool()) {
  const refCode = generateRefCode();
  const expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000); // 14d

  const sql = `
    INSERT INTO drn_referrals (
      ref_code, status, urgency,
      patient_user_id, patient_name, patient_phone, patient_age, patient_sex,
      originating_provider, originating_org, originating_agent,
      destination_org, destination_listing, destination_provider,
      specialty, service_kind, reason, clinical_summary,
      attached_soap_id, attached_files_json,
      service_fee_naira, match_score, match_reasoning_json,
      expires_at
    ) VALUES (
      $1, 'draft', COALESCE($2,'routine'),
      $3, $4, $5, $6, $7,
      $8, $9, $10,
      $11, $12, $13,
      $14, $15, $16, $17,
      $18, COALESCE($19::jsonb,'[]'::jsonb),
      $20, $21, COALESCE($22::jsonb,'{}'::jsonb),
      $23
    )
    RETURNING *
  `;
  const r = await pool.query(sql, [
    refCode,
    input.urgency || 'routine',
    input.patient_user_id || null,
    input.patient_name || null,
    input.patient_phone || null,
    input.patient_age || null,
    input.patient_sex || null,
    input.originating_provider || null,
    input.originating_org || null,
    input.originating_agent || null,
    input.destination_org || null,
    input.destination_listing || null,
    input.destination_provider || null,
    input.specialty,
    input.service_kind || null,
    input.reason,
    input.clinical_summary || null,
    input.attached_soap_id || null,
    input.attached_files_json ? JSON.stringify(input.attached_files_json) : null,
    input.service_fee_naira || null,
    input.match_score || null,
    input.match_reasoning_json ? JSON.stringify(input.match_reasoning_json) : null,
    expiresAt,
  ]);

  const referral = r.rows[0];
  await logEvent(referral.id, actor, 'created', null, 'draft', 'referral created', null, pool);
  return referral;
}

async function getReferral(id, pool = getPool()) {
  const r = await pool.query(`SELECT * FROM drn_referrals WHERE id = $1`, [id]);
  return r.rows[0] || null;
}

async function getReferralByCode(refCode, pool = getPool()) {
  const r = await pool.query(`SELECT * FROM drn_referrals WHERE ref_code = $1`, [refCode]);
  return r.rows[0] || null;
}

async function transitionReferral(id, toStatus, actor, opts = {}, pool = getPool()) {
  const ref = await getReferral(id, pool);
  if (!ref) {
    const err = new Error('Referral not found');
    err.code = 'NOT_FOUND';
    throw err;
  }
  if (!isValidTransition(ref.status, toStatus)) {
    const err = new Error(`Invalid transition ${ref.status} → ${toStatus}`);
    err.code = 'INVALID_TRANSITION';
    throw err;
  }

  const cols = ['status = $2', 'updated_at = NOW()'];
  const params = [id, toStatus];

  if (toStatus === 'scheduled' && opts.scheduled_at) {
    params.push(opts.scheduled_at);
    cols.push(`scheduled_at = $${params.length}`);
  }
  if (toStatus === 'completed') {
    cols.push('completed_at = NOW()');
  }
  if (toStatus === 'cancelled') {
    cols.push('cancelled_at = NOW()');
    if (opts.cancellation_reason) {
      params.push(opts.cancellation_reason);
      cols.push(`cancellation_reason = $${params.length}`);
    }
  }

  const sql = `UPDATE drn_referrals SET ${cols.join(', ')} WHERE id = $1 RETURNING *`;
  const r = await pool.query(sql, params);
  const updated = r.rows[0];

  await logEvent(id, actor, toStatus, ref.status, toStatus, opts.notes || null, opts.payload || null, pool);

  if (toStatus === 'completed') {
    await accrueCommissions(updated, pool).catch(err => {
      console.error('[DRN] commission accrual failed', err.message);
    });
  }

  return updated;
}

async function logEvent(referralId, actor, eventKind, fromStatus, toStatus, notes, payload, pool = getPool()) {
  await pool.query(
    `INSERT INTO drn_referral_events
       (referral_id, actor_user_id, actor_kind, event_kind, from_status, to_status, notes, payload_json)
     VALUES ($1, $2, $3, $4, $5, $6, $7, COALESCE($8::jsonb,'{}'::jsonb))`,
    [
      referralId,
      actor?.user_id || null,
      actor?.kind || 'system',
      eventKind,
      fromStatus,
      toStatus,
      notes || null,
      payload ? JSON.stringify(payload) : null,
    ]
  );
}

// ─── Commissions ──────────────────────────────────────────────────────────────

/**
 * Default split when referral completes:
 *   agent:                5% of service_fee (if originating_agent present)
 *   originating_provider: 3% (if present and no agent)
 *   originating_org:      2% (always, if present)
 *   platform:             remainder (≥0)
 *
 * Real splits should be config-driven per agreement; this is a sane default.
 */
function computeSplit(referral) {
  const fee = toNumber(referral.service_fee_naira);
  if (fee <= 0) return [];
  const splits = [];

  if (referral.originating_agent) {
    splits.push({ kind: 'agent', rate: 5, amount: round2(fee * 0.05), agent_id: referral.originating_agent });
  } else if (referral.originating_provider) {
    splits.push({ kind: 'originating_provider', rate: 3, amount: round2(fee * 0.03), provider_id: referral.originating_provider });
  }
  if (referral.originating_org) {
    splits.push({ kind: 'originating_org', rate: 2, amount: round2(fee * 0.02), organization_id: referral.originating_org });
  }
  const taken = splits.reduce((s, x) => s + x.amount, 0);
  const platformAmount = Math.max(0, round2(fee - taken));
  splits.push({ kind: 'platform', rate: null, amount: platformAmount });
  return splits;
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

async function accrueCommissions(referral, pool = getPool()) {
  const splits = computeSplit(referral);
  if (splits.length === 0) return [];
  const out = [];
  for (const s of splits) {
    const r = await pool.query(
      `INSERT INTO drn_commissions
         (referral_id, beneficiary_kind, agent_id, provider_id, organization_id,
          amount_naira, rate_pct, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'accrued')
       RETURNING *`,
      [
        referral.id,
        s.kind,
        s.agent_id || null,
        s.provider_id || null,
        s.organization_id || null,
        s.amount,
        s.rate ?? null,
      ]
    );
    out.push(r.rows[0]);

    if (s.kind === 'agent' && s.agent_id) {
      await pool.query(
        `UPDATE drn_agents
            SET total_referrals = total_referrals + 1,
                total_completed = total_completed + 1,
                total_earned_naira = total_earned_naira + $1,
                pending_payout = pending_payout + $1,
                updated_at = NOW()
          WHERE id = $2`,
        [s.amount, s.agent_id]
      );
    }
  }
  return out;
}

async function listCommissions({ agent_id, status, limit = 100 } = {}, pool = getPool()) {
  const where = [];
  const params = [];
  if (agent_id) { params.push(agent_id); where.push(`agent_id = $${params.length}`); }
  if (status)   { params.push(status);   where.push(`status = $${params.length}`); }
  params.push(Math.min(limit, 500));
  const sql = `
    SELECT * FROM drn_commissions
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY created_at DESC
    LIMIT $${params.length}
  `;
  const r = await pool.query(sql, params);
  return r.rows;
}

// ─── QR slip tokens ───────────────────────────────────────────────────────────

async function mintQrToken(referralId, actor, { scope = 'patient_slip', ttlDays = 30 } = {}, pool = getPool()) {
  const raw = mintToken();
  const tokenHash = hashToken(raw);
  const tokenPrefix = raw.slice(0, 8);
  const expiresAt = new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000);

  await pool.query(
    `INSERT INTO drn_qr_tokens (referral_id, token_hash, token_prefix, scope, created_by, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [referralId, tokenHash, tokenPrefix, scope, actor?.user_id || null, expiresAt]
  );
  // Return raw token only on creation. Never stored or recoverable afterwards.
  return { token: raw, prefix: tokenPrefix, expires_at: expiresAt };
}

async function verifyQrToken(rawToken, { ip } = {}, pool = getPool()) {
  if (!rawToken) return null;
  const hash = hashToken(rawToken);
  const r = await pool.query(
    `SELECT t.*, r.ref_code, r.status AS referral_status, r.specialty,
            r.patient_name, r.patient_phone, r.destination_org
       FROM drn_qr_tokens t
       JOIN drn_referrals r ON r.id = t.referral_id
      WHERE t.token_hash = $1
        AND t.revoked_at IS NULL
        AND (t.expires_at IS NULL OR t.expires_at > NOW())`,
    [hash]
  );
  const row = r.rows[0];
  if (!row) return null;

  await pool.query(
    `UPDATE drn_qr_tokens
        SET scan_count = scan_count + 1,
            last_scanned_ip = $2,
            used_at = COALESCE(used_at, NOW())
      WHERE id = $1`,
    [row.id, ip || null]
  );
  await logEvent(row.referral_id, { kind: 'system' }, 'qr_scanned', null, null, `scanned from ${ip || 'unknown'}`, null, pool);
  return row;
}

// ─── Agents ───────────────────────────────────────────────────────────────────

async function registerAgent(input, pool = getPool()) {
  const code = input.agent_code || generateAgentCode(input.home_jurisdiction_code);
  const r = await pool.query(
    `INSERT INTO drn_agents
       (user_id, agent_code, full_name, phone, whatsapp_phone, email,
        home_jurisdiction, posted_at_org, status, commission_rate,
        bank_name, bank_account_number, bank_account_name, recruited_by, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,COALESCE($9,'pending'),COALESCE($10,5.00),
             $11,$12,$13,$14,$15)
     RETURNING *`,
    [
      input.user_id || null, code, input.full_name, input.phone,
      input.whatsapp_phone || null, input.email || null,
      input.home_jurisdiction || null, input.posted_at_org || null,
      input.status || null, input.commission_rate || null,
      input.bank_name || null, input.bank_account_number || null,
      input.bank_account_name || null, input.recruited_by || null,
      input.notes || null,
    ]
  );
  return r.rows[0];
}

async function listAgents({ status, jurisdiction_id, limit = 100 } = {}, pool = getPool()) {
  const where = [];
  const params = [];
  if (status)          { params.push(status);          where.push(`status = $${params.length}`); }
  if (jurisdiction_id) { params.push(jurisdiction_id); where.push(`home_jurisdiction = $${params.length}`); }
  params.push(Math.min(limit, 500));
  const sql = `
    SELECT * FROM drn_agents
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY created_at DESC
    LIMIT $${params.length}
  `;
  const r = await pool.query(sql, params);
  return r.rows;
}

// ─── Heatmap aggregate refresh ────────────────────────────────────────────────

async function refreshHeatmap({ since } = {}, pool = getPool()) {
  const sinceTs = since ? new Date(since) : new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  const sql = `
    INSERT INTO drn_heatmap_cells
      (cell_key, state, lga, specialty, period_start, period_end,
       referral_count, completed_count, cancelled_count, median_match_score, refreshed_at)
    SELECT
      'state:' || COALESCE(o.state,'?') || '|lga:' || COALESCE(o.lga,'?')
        || '|specialty:' || r.specialty
        || '|week:' || to_char(date_trunc('week', r.created_at)::date, 'IYYY-IW')      AS cell_key,
      o.state, o.lga, r.specialty,
      date_trunc('week', r.created_at)::date,
      (date_trunc('week', r.created_at) + interval '6 days')::date,
      COUNT(*),
      COUNT(*) FILTER (WHERE r.status = 'completed'),
      COUNT(*) FILTER (WHERE r.status IN ('cancelled','no_show','declined','expired')),
      PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY r.match_score),
      NOW()
    FROM drn_referrals r
    LEFT JOIN drn_organizations o ON o.id = r.destination_org
    WHERE r.created_at >= $1
    GROUP BY 1, o.state, o.lga, r.specialty, date_trunc('week', r.created_at)
    ON CONFLICT (cell_key) DO UPDATE SET
      referral_count = EXCLUDED.referral_count,
      completed_count = EXCLUDED.completed_count,
      cancelled_count = EXCLUDED.cancelled_count,
      median_match_score = EXCLUDED.median_match_score,
      refreshed_at = NOW()
  `;
  await pool.query(sql, [sinceTs]);

  // Underserved = high referral_count + low completed_count ratio
  await pool.query(`
    UPDATE drn_heatmap_cells
       SET underserved_score = LEAST(100,
         CASE WHEN referral_count > 0
              THEN (1 - completed_count::float / NULLIF(referral_count,0)) * 60
                   + LEAST(referral_count, 40)
              ELSE 0
         END)
  `);
  return { ok: true };
}

async function readHeatmap({ specialty, state, limit = 500 } = {}, pool = getPool()) {
  const where = [];
  const params = [];
  if (specialty) { params.push(specialty); where.push(`specialty = $${params.length}`); }
  if (state)     { params.push(state);     where.push(`state = $${params.length}`); }
  params.push(Math.min(limit, 2000));
  const sql = `
    SELECT * FROM drn_heatmap_cells
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY underserved_score DESC NULLS LAST, referral_count DESC
    LIMIT $${params.length}
  `;
  const r = await pool.query(sql, params);
  return r.rows;
}

// ─── Listing referrals (inbox / outbox / analytics) ───────────────────────────

async function listReferrals({ destination_org, originating_org, originating_agent, status, urgency, since, limit = 50 } = {}, pool = getPool()) {
  const where = [];
  const params = [];
  if (destination_org)    { params.push(destination_org);    where.push(`destination_org = $${params.length}`); }
  if (originating_org)    { params.push(originating_org);    where.push(`originating_org = $${params.length}`); }
  if (originating_agent)  { params.push(originating_agent);  where.push(`originating_agent = $${params.length}`); }
  if (status)             { params.push(status);             where.push(`status = $${params.length}`); }
  if (urgency)            { params.push(urgency);            where.push(`urgency = $${params.length}`); }
  if (since)              { params.push(since);              where.push(`created_at >= $${params.length}`); }
  params.push(Math.min(limit, 500));
  const sql = `
    SELECT r.*, o_dest.name AS destination_org_name, o_orig.name AS originating_org_name
      FROM drn_referrals r
      LEFT JOIN drn_organizations o_dest ON o_dest.id = r.destination_org
      LEFT JOIN drn_organizations o_orig ON o_orig.id = r.originating_org
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY r.created_at DESC
     LIMIT $${params.length}
  `;
  const r = await pool.query(sql, params);
  return r.rows;
}

async function referralKpis({ scope = 'platform', org_id = null, agent_id = null, since } = {}, pool = getPool()) {
  const sinceTs = since ? new Date(since) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const where = ['created_at >= $1'];
  const params = [sinceTs];
  if (scope === 'destination' && org_id) {
    params.push(org_id);
    where.push(`destination_org = $${params.length}`);
  } else if (scope === 'origin' && org_id) {
    params.push(org_id);
    where.push(`originating_org = $${params.length}`);
  } else if (scope === 'agent' && agent_id) {
    params.push(agent_id);
    where.push(`originating_agent = $${params.length}`);
  }
  const sql = `
    SELECT
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE status = 'completed')::int AS completed,
      COUNT(*) FILTER (WHERE status IN ('cancelled','no_show','declined','expired'))::int AS failed,
      COUNT(*) FILTER (WHERE status IN ('sent','received','accepted','scheduled','in_progress'))::int AS in_flight,
      COUNT(*) FILTER (WHERE urgency = 'emergency')::int AS emergencies,
      ROUND(AVG(match_score)::numeric, 1) AS avg_match_score,
      ROUND(SUM(service_fee_naira) FILTER (WHERE status = 'completed')::numeric, 2) AS completed_fees_naira
    FROM drn_referrals
    WHERE ${where.join(' AND ')}
  `;
  const r = await pool.query(sql, params);
  return r.rows[0];
}

module.exports = {
  // state machine
  REFERRAL_TRANSITIONS,
  isValidTransition,
  isTerminal,
  // matching
  scoreCandidate,
  matchSpecialists,
  // orgs / listings
  listOrganizations,
  listListings,
  // referrals
  createReferral,
  getReferral,
  getReferralByCode,
  transitionReferral,
  listReferrals,
  referralKpis,
  // commissions
  computeSplit,
  accrueCommissions,
  listCommissions,
  // qr
  mintQrToken,
  verifyQrToken,
  // agents
  registerAgent,
  listAgents,
  // heatmap
  refreshHeatmap,
  readHeatmap,
  // helpers (exposed for tests)
  hashToken,
  generateRefCode,
};
