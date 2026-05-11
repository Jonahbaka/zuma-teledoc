'use strict';

/**
 * ng/services/public-health/governanceService.js
 * Federated governance service for DoctaRx Nigeria.
 *
 * Orchestrates:
 *  - Jurisdiction hierarchy reads
 *  - User jurisdiction role management
 *  - Governance workflow (submit → area_council_review → fcta_review → approved → dhis2_ready)
 *  - Extended audit lineage writes
 *  - Portal access token management
 *  - Programme space management
 */

const crypto = require('crypto');
const { getPool } = require('../../../server/db');

// ─── Utilities ────────────────────────────────────────────────────────────────

function toNumber(v) {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function isMissingDbObject(err) {
  return ['42P01', '42703', '42883', '22P02'].includes(err?.code);
}

async function safeQuery(pool, sql, params = []) {
  try {
    const r = await pool.query(sql, params);
    return r.rows;
  } catch (err) {
    if (isMissingDbObject(err)) return [];
    throw err;
  }
}

async function safeScalar(pool, sql, params = [], field = 'count') {
  try {
    const r = await pool.query(sql, params);
    return toNumber(r.rows[0]?.[field]);
  } catch (err) {
    if (isMissingDbObject(err)) return 0;
    throw err;
  }
}

const WORKFLOW_TRANSITIONS = {
  submitted:           ['area_council_review', 'rejected'],
  area_council_review: ['fcta_review', 'rejected'],
  fcta_review:         ['approved', 'rejected'],
  approved:            ['dhis2_ready', 'rejected'],
  dhis2_ready:         ['exported'],
  rejected:            ['submitted'],  // allow resubmission
  exported:            [],
};

function isValidTransition(from, to) {
  return (WORKFLOW_TRANSITIONS[from] ?? []).includes(to);
}

// ─── Jurisdiction hierarchy ───────────────────────────────────────────────────

async function getJurisdictionHierarchy() {
  const pool = getPool();
  const rows = await safeQuery(
    pool,
    `SELECT j.id, j.code, j.name, j.tier, j.parent_id, j.active,
            p.code AS parent_code, p.name AS parent_name
       FROM ng_jurisdictions j
       LEFT JOIN ng_jurisdictions p ON p.id = j.parent_id
      WHERE j.active = TRUE
      ORDER BY j.tier, j.name`
  );

  // Build tree
  const byId = new Map(rows.map((r) => [r.id, { ...r, children: [] }]));
  const roots = [];
  for (const node of byId.values()) {
    if (node.parent_id && byId.has(node.parent_id)) {
      byId.get(node.parent_id).children.push(node);
    } else {
      roots.push(node);
    }
  }
  return { jurisdictions: rows, tree: roots };
}

async function getJurisdictionById(id) {
  const pool = getPool();
  const rows = await safeQuery(pool, `SELECT * FROM ng_jurisdictions WHERE id = $1`, [id]);
  return rows[0] || null;
}

async function getJurisdictionByCode(code) {
  const pool = getPool();
  const rows = await safeQuery(pool, `SELECT * FROM ng_jurisdictions WHERE code = $1`, [code]);
  return rows[0] || null;
}

// ─── User jurisdiction roles ──────────────────────────────────────────────────

async function grantJurisdictionRole(params) {
  const {
    userId, jurisdictionId, role, facilityId, programmeArea,
    canExport, canApprove, canViewAggregate, dataClassLevel,
    grantedBy, expiresAt,
  } = params;

  const pool = getPool();
  const result = await pool.query(
    `INSERT INTO ng_user_jurisdiction_roles
       (user_id, jurisdiction_id, role, facility_id, programme_area,
        can_export, can_approve, can_view_aggregate, data_class_level,
        granted_by, expires_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     ON CONFLICT (user_id, jurisdiction_id, role)
     DO UPDATE SET
       facility_id        = EXCLUDED.facility_id,
       programme_area     = EXCLUDED.programme_area,
       can_export         = EXCLUDED.can_export,
       can_approve        = EXCLUDED.can_approve,
       can_view_aggregate = EXCLUDED.can_view_aggregate,
       data_class_level   = EXCLUDED.data_class_level,
       granted_by         = EXCLUDED.granted_by,
       expires_at         = EXCLUDED.expires_at,
       active             = TRUE,
       updated_at         = NOW()
     RETURNING *`,
    [
      userId, jurisdictionId, role,
      facilityId || null,
      programmeArea || null,
      canExport ?? false,
      canApprove ?? false,
      canViewAggregate ?? true,
      dataClassLevel || 'aggregate',
      grantedBy || null,
      expiresAt || null,
    ]
  );
  return result.rows[0];
}

async function revokeJurisdictionRole(userId, jurisdictionId, role) {
  const pool = getPool();
  await pool.query(
    `UPDATE ng_user_jurisdiction_roles
        SET active = FALSE, updated_at = NOW()
      WHERE user_id = $1 AND jurisdiction_id = $2 AND role = $3`,
    [userId, jurisdictionId, role]
  );
}

async function listUserJurisdictionRoles(userId) {
  const pool = getPool();
  return safeQuery(
    pool,
    `SELECT ujr.*, j.code AS jurisdiction_code, j.name AS jurisdiction_name, j.tier
       FROM ng_user_jurisdiction_roles ujr
       JOIN ng_jurisdictions j ON j.id = ujr.jurisdiction_id
      WHERE ujr.user_id = $1 AND ujr.active = TRUE
      ORDER BY j.tier, ujr.role`,
    [userId]
  );
}

// ─── Governance workflow ──────────────────────────────────────────────────────

async function submitReport({ reportId, facilityId, submitterUserId, jurisdictionId, period, metadata }) {
  const pool = getPool();

  // Verify report exists
  const reportRows = await safeQuery(pool, `SELECT id, status FROM public_health_reports WHERE id = $1`, [reportId]);
  if (!reportRows.length) {
    const err = new Error('Report not found.'); err.status = 404; throw err;
  }

  const result = await pool.query(
    `INSERT INTO ng_governance_submissions
       (report_id, facility_id, submitter_user_id, jurisdiction_id, submission_period, metadata_json)
     VALUES ($1,$2,$3,$4,$5,$6::jsonb)
     RETURNING *`,
    [reportId, facilityId || null, submitterUserId || null, jurisdictionId || null, period, JSON.stringify(metadata || {})]
  );
  const submission = result.rows[0];

  // Log the initial transition
  await _logWorkflowTransition(pool, {
    submissionId: submission.id,
    actorUserId: submitterUserId,
    fromStatus: null,
    toStatus: 'submitted',
    action: 'submit',
    notes: `Report ${reportId} submitted for period ${period}.`,
  });

  return submission;
}

async function advanceWorkflow({ submissionId, actorUserId, targetStatus, notes, ip, userAgent }) {
  const pool = getPool();

  const rows = await safeQuery(pool, `SELECT * FROM ng_governance_submissions WHERE id = $1 FOR UPDATE`, [submissionId]);
  if (!rows.length) {
    const err = new Error('Submission not found.'); err.status = 404; throw err;
  }
  const sub = rows[0];

  if (!isValidTransition(sub.status, targetStatus)) {
    const err = new Error(`Cannot transition from '${sub.status}' to '${targetStatus}'.`);
    err.status = 409; throw err;
  }

  const updates = { status: targetStatus, updated_at: new Date() };
  const now = new Date();

  if (targetStatus === 'area_council_review' || targetStatus === 'fcta_review') {
    updates.reviewer_user_id = actorUserId;
    updates.reviewed_at      = now;
    updates.reviewer_notes   = notes || null;
  }
  if (targetStatus === 'approved') {
    updates.approver_user_id = actorUserId;
    updates.approved_at      = now;
    updates.approver_notes   = notes || null;
  }
  if (targetStatus === 'exported') {
    updates.exported_by  = actorUserId;
    updates.exported_at  = now;
  }

  await pool.query(
    `UPDATE ng_governance_submissions SET
       status            = $1,
       reviewer_user_id  = COALESCE($2, reviewer_user_id),
       reviewed_at       = COALESCE($3, reviewed_at),
       reviewer_notes    = COALESCE($4, reviewer_notes),
       approver_user_id  = COALESCE($5, approver_user_id),
       approved_at       = COALESCE($6, approved_at),
       approver_notes    = COALESCE($7, approver_notes),
       exported_by       = COALESCE($8, exported_by),
       exported_at       = COALESCE($9, exported_at),
       updated_at        = NOW()
     WHERE id = $10`,
    [
      targetStatus,
      updates.reviewer_user_id || null,
      updates.reviewed_at      || null,
      updates.reviewer_notes   || null,
      updates.approver_user_id || null,
      updates.approved_at      || null,
      updates.approver_notes   || null,
      updates.exported_by      || null,
      updates.exported_at      || null,
      submissionId,
    ]
  );

  await _logWorkflowTransition(pool, {
    submissionId,
    actorUserId,
    fromStatus: sub.status,
    toStatus: targetStatus,
    action: _actionForTransition(sub.status, targetStatus),
    notes,
    ip,
    userAgent,
  });

  return getSubmission(submissionId);
}

function _actionForTransition(from, to) {
  if (to === 'rejected') return 'reject';
  if (to === 'area_council_review') return 'send_to_area_council';
  if (to === 'fcta_review') return 'send_to_fcta';
  if (to === 'approved') return 'approve';
  if (to === 'dhis2_ready') return 'mark_dhis2_ready';
  if (to === 'exported') return 'export';
  if (to === 'submitted') return 'resubmit';
  return 'transition';
}

async function _logWorkflowTransition(pool, { submissionId, actorUserId, fromStatus, toStatus, action, notes, ip, userAgent }) {
  try {
    await pool.query(
      `INSERT INTO ng_governance_workflow_logs
         (submission_id, actor_user_id, from_status, to_status, action, notes, ip_address, user_agent)
       VALUES ($1,$2,$3,$4,$5,$6,$7::inet,$8)`,
      [submissionId, actorUserId || null, fromStatus || null, toStatus, action, notes || null, ip || null, userAgent || null]
    );
  } catch {
    // Non-blocking
  }
}

async function getSubmission(submissionId) {
  const pool = getPool();
  const rows = await safeQuery(
    pool,
    `SELECT s.*,
            f.name AS facility_name,
            j.code AS jurisdiction_code, j.name AS jurisdiction_name,
            sub_u.first_name || ' ' || sub_u.last_name AS submitter_name,
            rev_u.first_name || ' ' || rev_u.last_name AS reviewer_name,
            app_u.first_name || ' ' || app_u.last_name AS approver_name
       FROM ng_governance_submissions s
       LEFT JOIN public_health_facilities f    ON f.id = s.facility_id
       LEFT JOIN ng_jurisdictions j            ON j.id = s.jurisdiction_id
       LEFT JOIN users sub_u                   ON sub_u.id = s.submitter_user_id
       LEFT JOIN users rev_u                   ON rev_u.id = s.reviewer_user_id
       LEFT JOIN users app_u                   ON app_u.id = s.approver_user_id
      WHERE s.id = $1`,
    [submissionId]
  );
  return rows[0] || null;
}

async function listSubmissions({ status, jurisdictionId, period, limit = 50, page = 1 } = {}) {
  const pool = getPool();
  const conditions = [];
  const params = [];
  let idx = 1;

  if (status) { conditions.push(`s.status = $${idx++}`); params.push(status); }
  if (jurisdictionId) { conditions.push(`s.jurisdiction_id = $${idx++}`); params.push(jurisdictionId); }
  if (period) { conditions.push(`s.submission_period = $${idx++}`); params.push(period); }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const safeLimit = Math.min(Math.max(toNumber(limit), 1), 100);
  const offset = (Math.max(toNumber(page), 1) - 1) * safeLimit;
  params.push(safeLimit, offset);

  const rows = await safeQuery(
    pool,
    `SELECT s.id, s.report_id, s.submission_period, s.status,
            s.created_at, s.reviewed_at, s.approved_at, s.exported_at,
            f.name AS facility_name,
            j.name AS jurisdiction_name, j.code AS jurisdiction_code
       FROM ng_governance_submissions s
       LEFT JOIN public_health_facilities f ON f.id = s.facility_id
       LEFT JOIN ng_jurisdictions j         ON j.id = s.jurisdiction_id
      ${where}
      ORDER BY s.created_at DESC
      LIMIT $${idx++} OFFSET $${idx++}`,
    params
  );

  const countParams = params.slice(0, params.length - 2);
  const total = await safeScalar(
    pool,
    `SELECT COUNT(*) AS count FROM ng_governance_submissions s ${where}`,
    countParams
  );

  return { submissions: rows, total, page: Math.max(toNumber(page), 1), limit: safeLimit };
}

async function getWorkflowLogs(submissionId) {
  const pool = getPool();
  return safeQuery(
    pool,
    `SELECT wl.*, u.first_name || ' ' || u.last_name AS actor_name
       FROM ng_governance_workflow_logs wl
       LEFT JOIN users u ON u.id = wl.actor_user_id
      WHERE wl.submission_id = $1
      ORDER BY wl.created_at ASC`,
    [submissionId]
  );
}

// ─── Audit lineage ────────────────────────────────────────────────────────────

async function writeAuditLineage({
  actorUserId, action, resourceType, resourceId,
  jurisdictionId, jurisdictionScope, dataClass,
  exportFormat, ip, userAgent, sessionId, metadata,
}) {
  const pool = getPool();
  try {
    await pool.query(
      `INSERT INTO ng_audit_lineage
         (actor_user_id, action, resource_type, resource_id,
          jurisdiction_id, jurisdiction_scope, data_class, export_format,
          ip_address, user_agent, session_id, metadata_json)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::inet,$10,$11,$12::jsonb)`,
      [
        actorUserId || null, action, resourceType || null, resourceId || null,
        jurisdictionId || null, jurisdictionScope || null,
        dataClass || 'aggregate', exportFormat || null,
        ip || null, userAgent || null, sessionId || null,
        JSON.stringify(metadata || {}),
      ]
    );
  } catch (err) {
    if (!isMissingDbObject(err)) {
      console.warn('[NG Governance] Audit lineage write skipped:', err.message);
    }
  }
}

async function getAuditLineage({ actorUserId, action, resourceType, startDate, endDate, limit = 100, page = 1 } = {}) {
  const pool = getPool();
  const conditions = [];
  const params = [];
  let idx = 1;

  if (actorUserId)  { conditions.push(`al.actor_user_id = $${idx++}`);  params.push(actorUserId); }
  if (action)       { conditions.push(`al.action = $${idx++}`);         params.push(action); }
  if (resourceType) { conditions.push(`al.resource_type = $${idx++}`);  params.push(resourceType); }
  if (startDate)    { conditions.push(`al.created_at >= $${idx++}`);    params.push(new Date(startDate)); }
  if (endDate)      { conditions.push(`al.created_at < $${idx++}`);     params.push(new Date(endDate)); }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const safeLimit = Math.min(Math.max(toNumber(limit), 1), 200);
  const offset = (Math.max(toNumber(page), 1) - 1) * safeLimit;
  params.push(safeLimit, offset);

  const rows = await safeQuery(
    pool,
    `SELECT al.*, u.first_name || ' ' || u.last_name AS actor_name
       FROM ng_audit_lineage al
       LEFT JOIN users u ON u.id = al.actor_user_id
      ${where}
      ORDER BY al.created_at DESC
      LIMIT $${idx++} OFFSET $${idx++}`,
    params
  );

  return { logs: rows, page: Math.max(toNumber(page), 1), limit: safeLimit };
}

// ─── Portal access tokens ─────────────────────────────────────────────────────

function _hashToken(raw) {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

async function createPortalAccessToken({ label, portal, jurisdictionId, createdBy, expiresAt }) {
  const raw = crypto.randomBytes(32).toString('hex');
  const hash = _hashToken(raw);
  const pool = getPool();

  await pool.query(
    `INSERT INTO ng_portal_access_tokens
       (token_hash, label, portal, jurisdiction_id, created_by, expires_at)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [hash, label, portal, jurisdictionId || null, createdBy || null, expiresAt || null]
  );

  return { token: raw, label, portal };  // Raw token returned ONCE — not stored
}

async function validatePortalAccessToken(raw) {
  if (!raw) return null;
  const hash = _hashToken(raw);
  const pool = getPool();
  const rows = await safeQuery(
    pool,
    `SELECT t.*, j.code AS jurisdiction_code, j.tier
       FROM ng_portal_access_tokens t
       LEFT JOIN ng_jurisdictions j ON j.id = t.jurisdiction_id
      WHERE t.token_hash = $1
        AND t.active = TRUE
        AND (t.expires_at IS NULL OR t.expires_at > NOW())`,
    [hash]
  );
  if (!rows.length) return null;

  // Update last_used_at (fire and forget)
  pool.query(`UPDATE ng_portal_access_tokens SET last_used_at = NOW() WHERE token_hash = $1`, [hash]).catch(() => {});
  return rows[0];
}

// ─── Programme spaces ─────────────────────────────────────────────────────────

async function listProgrammeSpaces() {
  const pool = getPool();
  return safeQuery(
    pool,
    `SELECT * FROM ng_programme_spaces WHERE active = TRUE ORDER BY display_name`
  );
}

async function getProgrammeSpace(programmeKey) {
  const pool = getPool();
  const rows = await safeQuery(
    pool,
    `SELECT * FROM ng_programme_spaces WHERE programme_key = $1 AND active = TRUE`,
    [programmeKey]
  );
  return rows[0] || null;
}

// ─── Executive summary (cross-jurisdiction aggregate) ────────────────────────

async function getExecutiveSummary({ period } = {}) {
  const pool = getPool();

  const [
    jurisdictions,
    submissionStats,
    programmeSpaces,
    recentAudit,
  ] = await Promise.all([
    safeQuery(pool, `SELECT tier, COUNT(*) AS count FROM ng_jurisdictions WHERE active = TRUE GROUP BY tier`),
    safeQuery(pool, `SELECT status, COUNT(*)::int AS count FROM ng_governance_submissions GROUP BY status ORDER BY count DESC`),
    listProgrammeSpaces(),
    safeQuery(
      pool,
      `SELECT al.action, al.resource_type, al.created_at,
              u.first_name || ' ' || u.last_name AS actor_name
         FROM ng_audit_lineage al
         LEFT JOIN users u ON u.id = al.actor_user_id
        ORDER BY al.created_at DESC LIMIT 20`
    ),
  ]);

  const submissionByStatus = {};
  for (const row of submissionStats) submissionByStatus[row.status] = toNumber(row.count);
  const totalSubmissions = Object.values(submissionByStatus).reduce((a, b) => a + b, 0);

  const jurisdictionByTier = {};
  for (const row of jurisdictions) jurisdictionByTier[row.tier] = toNumber(row.count);

  return {
    period: period || null,
    governance: {
      jurisdictionByTier,
      submissionByStatus,
      totalSubmissions,
      pendingReview: toNumber(submissionByStatus.submitted) + toNumber(submissionByStatus.area_council_review),
      pendingApproval: toNumber(submissionByStatus.fcta_review),
      approved: toNumber(submissionByStatus.approved) + toNumber(submissionByStatus.dhis2_ready),
      exported: toNumber(submissionByStatus.exported),
    },
    programmeSpaces: programmeSpaces.length,
    recentAuditActivity: recentAudit,
    generatedAt: new Date().toISOString(),
  };
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  // Jurisdiction
  getJurisdictionHierarchy,
  getJurisdictionById,
  getJurisdictionByCode,
  // User roles
  grantJurisdictionRole,
  revokeJurisdictionRole,
  listUserJurisdictionRoles,
  // Governance workflow
  submitReport,
  advanceWorkflow,
  getSubmission,
  listSubmissions,
  getWorkflowLogs,
  // Audit lineage
  writeAuditLineage,
  getAuditLineage,
  // Portal tokens
  createPortalAccessToken,
  validatePortalAccessToken,
  // Programme spaces
  listProgrammeSpaces,
  getProgrammeSpace,
  // Executive summary
  getExecutiveSummary,
};
