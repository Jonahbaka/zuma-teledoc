'use strict';

/**
 * ng/middleware/rbac.js
 * Hardened RBAC + ABAC middleware for DoctaRx Nigeria federated governance.
 *
 * Role hierarchy (ascending privilege):
 *   provider < facility_admin < analyst < reviewer < approver
 *   < programme_admin < executive_read_only < platform_admin < super_admin
 *
 * Attributes validated per request:
 *   jurisdiction, organization, facility, programme,
 *   geographic scope, export authority, approval authority,
 *   aggregate visibility, data-classification visibility
 */

const { getPool } = require('../../server/db');

// ─── Role definitions ────────────────────────────────────────────────────────

const ROLE_HIERARCHY = {
  super_admin:          100,
  platform_admin:        90,
  executive_read_only:   80,
  programme_admin:       70,
  approver:              60,
  reviewer:              50,
  analyst:               40,
  facility_admin:        30,
  provider:              20,
};

/** Roles that can approve governance submissions */
const APPROVER_ROLES = new Set(['super_admin', 'platform_admin', 'approver']);

/** Roles that can review (but not approve) submissions */
const REVIEWER_ROLES = new Set([...APPROVER_ROLES, 'reviewer']);

/** Roles that can export data */
const EXPORT_ROLES = new Set(['super_admin', 'platform_admin', 'programme_admin', 'analyst', 'approver', 'reviewer']);

/** Roles that can view aggregate dashboards */
const AGGREGATE_VIEW_ROLES = new Set([...Object.keys(ROLE_HIERARCHY)]);

// ─── Helper utilities ─────────────────────────────────────────────────────────

function canonicalRole(raw) {
  return String(raw || '').toLowerCase().trim().replace(/\s+/g, '_');
}

function roleLevel(role) {
  return ROLE_HIERARCHY[canonicalRole(role)] ?? 0;
}

function hasMinRole(user, minRole) {
  const userRole = canonicalRole(user?.role || user?.ng_role || '');
  return roleLevel(userRole) >= roleLevel(minRole);
}

function isSuperAdmin(user) {
  return canonicalRole(user?.role || '') === 'super_admin';
}

function isPlatformAdministrator(user) {
  return ['super_admin', 'platform_admin'].includes(canonicalRole(user?.role || user?.ng_role || ''));
}

// ─── Jurisdiction scope cache (TTL 60s) ──────────────────────────────────────

const _scopeCache = new Map();
const SCOPE_CACHE_TTL_MS = 60_000;

async function getUserJurisdictionScopes(userId) {
  const cached = _scopeCache.get(userId);
  if (cached && Date.now() - cached.ts < SCOPE_CACHE_TTL_MS) return cached.scopes;

  const pool = getPool();
  try {
    const result = await pool.query(
      `SELECT ujr.role, ujr.jurisdiction_id, ujr.facility_id, ujr.programme_area,
              ujr.can_export, ujr.can_approve, ujr.can_view_aggregate, ujr.data_class_level,
              j.code AS jurisdiction_code, j.tier AS jurisdiction_tier
         FROM ng_user_jurisdiction_roles ujr
         JOIN ng_jurisdictions j ON j.id = ujr.jurisdiction_id
        WHERE ujr.user_id = $1
          AND ujr.active = TRUE
          AND (ujr.expires_at IS NULL OR ujr.expires_at > NOW())`,
      [userId]
    );
    const scopes = result.rows;
    _scopeCache.set(userId, { ts: Date.now(), scopes });
    return scopes;
  } catch (error) {
    console.error('[Government RBAC] Jurisdiction scope lookup failed:', error.message);
    return null;
  }
}

function invalidateScopeCache(userId) {
  _scopeCache.delete(userId);
}

function scopeMatchesResource(scope, ancestorJurisdictionIds, { facilityId, programmeArea } = {}) {
  const jurisdictionMatches = ancestorJurisdictionIds.size
    ? ancestorJurisdictionIds.has(String(scope.jurisdiction_id))
    : Boolean(facilityId && scope.facility_id && String(scope.facility_id) === String(facilityId));
  if (!jurisdictionMatches) return false;
  if (scope.facility_id && (!facilityId || String(scope.facility_id) !== String(facilityId))) return false;
  if (scope.programme_area && (!programmeArea || scope.programme_area !== programmeArea)) return false;
  return true;
}

async function userCanAccessResource(user, { jurisdictionId, facilityId, programmeArea } = {}) {
  if (!user) return false;
  if (isPlatformAdministrator(user)) return true;

  const userId = user.id || user.userId;
  if (!userId) return false;
  const scopes = await getUserJurisdictionScopes(userId);
  if (scopes === null) return null;

  const ancestorJurisdictionIds = new Set();
  if (jurisdictionId) {
    try {
      const result = await getPool().query(
        `WITH RECURSIVE ancestors AS (
           SELECT id, parent_id FROM ng_jurisdictions WHERE id = $1
           UNION ALL
           SELECT parent.id, parent.parent_id
             FROM ng_jurisdictions parent
             JOIN ancestors child ON child.parent_id = parent.id
         )
         SELECT id FROM ancestors`,
        [jurisdictionId]
      );
      result.rows.forEach((row) => ancestorJurisdictionIds.add(String(row.id)));
    } catch (error) {
      console.error('[Government RBAC] Jurisdiction hierarchy lookup failed:', error.message);
      return null;
    }
  }

  return scopes.some((scope) => scopeMatchesResource(
    scope,
    ancestorJurisdictionIds,
    { facilityId, programmeArea }
  ));
}

async function getAccessibleJurisdictionIds(user) {
  if (!user) return [];
  if (isPlatformAdministrator(user)) return null;
  const userId = user.id || user.userId;
  if (!userId) return [];
  const scopes = await getUserJurisdictionScopes(userId);
  if (scopes === null) return undefined;
  if (!scopes.length) return [];
  try {
    const result = await getPool().query(
      `WITH RECURSIVE descendants AS (
         SELECT id FROM ng_jurisdictions WHERE id = ANY($1::uuid[])
         UNION
         SELECT child.id
           FROM ng_jurisdictions child
           JOIN descendants parent ON child.parent_id = parent.id
       )
       SELECT DISTINCT id FROM descendants`,
      [scopes.map((scope) => scope.jurisdiction_id)]
    );
    return result.rows.map((row) => row.id);
  } catch (error) {
    console.error('[Government RBAC] Accessible jurisdiction lookup failed:', error.message);
    return undefined;
  }
}

// ─── Audit lineage helper ─────────────────────────────────────────────────────

async function recordAuditLineage(req, action, resourceType, resourceId, extra = {}) {
  const pool = getPool();
  const userId = req.user?.id || req.user?.userId || null;
  try {
    await pool.query(
      `INSERT INTO ng_audit_lineage
         (actor_user_id, action, resource_type, resource_id,
          jurisdiction_scope, data_class, export_format,
          ip_address, user_agent, session_id, metadata_json)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::inet,$9,$10,$11::jsonb)`,
      [
        userId,
        action,
        resourceType || null,
        resourceId || null,
        extra.jurisdictionScope || null,
        extra.dataClass || 'aggregate',
        extra.exportFormat || null,
        req.ip || null,
        req.get('user-agent') || null,
        req.sessionID || null,
        JSON.stringify(extra.metadata || {}),
      ]
    );
    return true;
  } catch (error) {
    console.error('[Government audit] Lineage write failed:', error.message);
    return false;
  }
}

// ─── Middleware factories ─────────────────────────────────────────────────────

/**
 * requireNgRole(...roles)
 * Allows access if the authenticated user has ANY of the given roles.
 * Super-admin always passes. Falls back to base req.user.role when
 * jurisdiction-scoped roles are not yet configured.
 */
function requireNgRole(...requiredRoles) {
  const allowed = new Set(requiredRoles.map(canonicalRole));
  return async (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required.' });
    }
    if (isSuperAdmin(req.user)) return next();

    const baseRole = canonicalRole(req.user.role || req.user.ng_role || '');

    // Only platform-wide administrators may rely on a global role. Operational
    // government roles require an active jurisdiction assignment below.
    if (allowed.has(baseRole) && ['super_admin', 'platform_admin'].includes(baseRole)) return next();

    // Check jurisdiction-scoped roles
    const userId = req.user.id || req.user.userId;
    if (userId) {
      const scopes = await getUserJurisdictionScopes(userId);
      if (scopes === null) return res.status(503).json({ error: 'Government authorization scopes are unavailable.' });
      const hasScope = scopes.some((s) => allowed.has(canonicalRole(s.role)));
      if (hasScope) return next();
    }

    return res.status(403).json({
      error: 'Access denied.',
      required: requiredRoles,
      your_role: baseRole || 'unknown',
    });
  };
}

/**
 * requireMinRole(minRole)
 * Allows access if the user's effective role level >= minRole level.
 */
function requireMinRole(minRole) {
  return async (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Authentication required.' });
    if (isSuperAdmin(req.user)) return next();

    const baseRole = canonicalRole(req.user.role || req.user.ng_role || '');
    if (['super_admin', 'platform_admin'].includes(baseRole) && roleLevel(baseRole) >= roleLevel(minRole)) return next();

    // Check jurisdiction-scoped roles
    const userId = req.user.id || req.user.userId;
    if (userId) {
      const scopes = await getUserJurisdictionScopes(userId);
      if (scopes === null) return res.status(503).json({ error: 'Government authorization scopes are unavailable.' });
      const hasScope = scopes.some((s) => roleLevel(canonicalRole(s.role)) >= roleLevel(minRole));
      if (hasScope) return next();
    }

    return res.status(403).json({ error: `Role '${minRole}' or higher required.` });
  };
}

/**
 * requireExportAuthority()
 * Validates a platform-wide administrator or a jurisdiction-scoped
 * can_export assignment.
 */
function requireExportAuthority() {
  return async (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Authentication required.' });
    if (isSuperAdmin(req.user)) return next();

    const baseRole = canonicalRole(req.user.role || '');
    if (['super_admin', 'platform_admin'].includes(baseRole) && EXPORT_ROLES.has(baseRole)) return next();

    const userId = req.user.id || req.user.userId;
    if (userId) {
      const scopes = await getUserJurisdictionScopes(userId);
      if (scopes === null) return res.status(503).json({ error: 'Government authorization scopes are unavailable.' });
      const hasExport = scopes.some((s) => s.can_export === true || EXPORT_ROLES.has(canonicalRole(s.role)));
      if (hasExport) return next();
    }

    return res.status(403).json({ error: 'Export authority required.' });
  };
}

/**
 * requireApprovalAuthority()
 * Validates the user can approve governance submissions.
 */
function requireApprovalAuthority() {
  return async (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Authentication required.' });
    if (isSuperAdmin(req.user)) return next();

    const baseRole = canonicalRole(req.user.role || '');
    if (['super_admin', 'platform_admin'].includes(baseRole) && APPROVER_ROLES.has(baseRole)) return next();

    const userId = req.user.id || req.user.userId;
    if (userId) {
      const scopes = await getUserJurisdictionScopes(userId);
      if (scopes === null) return res.status(503).json({ error: 'Government authorization scopes are unavailable.' });
      const hasApproval = scopes.some((s) => s.can_approve === true || APPROVER_ROLES.has(canonicalRole(s.role)));
      if (hasApproval) return next();
    }

    return res.status(403).json({ error: 'Approval authority required.' });
  };
}

/**
 * requireJurisdictionAccess(tier)
 * Ensures the authenticated user has at least one jurisdiction role
 * at or above the given tier. Used to gate portal-level access.
 *
 * tier: 'national' | 'state' | 'area_council' | 'facility' | 'provider'
 */
const TIER_LEVEL = { national: 5, state: 4, area_council: 3, facility: 2, provider: 1 };

function requireJurisdictionAccess(tier) {
  return async (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Authentication required.' });
    if (isSuperAdmin(req.user)) return next();

    const minTierLevel = TIER_LEVEL[tier] ?? 1;
    const userId = req.user.id || req.user.userId;
    if (userId) {
      const scopes = await getUserJurisdictionScopes(userId);
      if (scopes === null) return res.status(503).json({ error: 'Government authorization scopes are unavailable.' });
      const hasAccess = scopes.some((s) => (TIER_LEVEL[s.jurisdiction_tier] ?? 0) >= minTierLevel);
      if (hasAccess) return next();
    }

    // Only platform-wide administrators may bypass a jurisdiction assignment.
    const baseRole = canonicalRole(req.user.role || '');
    if (['platform_admin', 'super_admin'].includes(baseRole)) return next();

    return res.status(403).json({ error: `Access to ${tier}-tier portal denied.` });
  };
}

/**
 * requireProgrammeAccess(programmeKey)
 * Restricts access to users scoped to a specific programme area.
 * Platform admins and above always pass.
 */
function requireProgrammeAccess(programmeKey) {
  return async (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Authentication required.' });
    if (hasMinRole(req.user, 'platform_admin')) return next();

    const userId = req.user.id || req.user.userId;
    if (userId) {
      const scopes = await getUserJurisdictionScopes(userId);
      if (scopes === null) return res.status(503).json({ error: 'Government authorization scopes are unavailable.' });
      // Pass if user has NO programme restriction (null = all) or matches this programme
      const hasAccess = scopes.some(
        (s) => s.programme_area == null || s.programme_area === programmeKey
      );
      if (hasAccess) return next();
    }

    return res.status(403).json({ error: `Access to programme '${programmeKey}' denied.` });
  };
}

/**
 * auditRequest(action, resourceType)
 * Fail-closed middleware that records every request to ng_audit_lineage.
 * Attach after auth middleware, before route handlers.
 */
function auditRequest(action, resourceType) {
  return async (req, res, next) => {
    const recorded = await recordAuditLineage(req, action, resourceType, req.params?.id || null, {
      jurisdictionScope: req.headers['x-jurisdiction-scope'] || null,
      dataClass: 'aggregate',
    });
    if (!recorded) {
      return res.status(503).json({ error: 'Government audit logging is unavailable.' });
    }
    next();
  };
}

function requireGovernmentMfa(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Authentication required.' });
  if (req.user.mfaEnabled !== true) {
    return res.status(403).json({
      error: 'MFA enrollment is required for government access.',
      code: 'GOVERNMENT_MFA_ENROLLMENT_REQUIRED',
    });
  }
  if (req.cookies?.mfaVerified !== 'true') {
    return res.status(403).json({
      error: 'MFA verification is required for government access.',
      code: 'MFA_REQUIRED',
    });
  }
  next();
}

// ─── Convenience role groups ──────────────────────────────────────────────────

const requireAdmin        = requireNgRole('admin', 'super_admin', 'platform_admin');
const requirePlatformAdmin = requireNgRole('super_admin', 'platform_admin');
const requireAnalystPlus  = requireNgRole('analyst', 'reviewer', 'approver', 'programme_admin', 'platform_admin', 'super_admin');
const requireExecutiveView = requireNgRole('executive_read_only', 'programme_admin', 'platform_admin', 'super_admin');
const requireReviewer     = requireNgRole('reviewer', 'approver', 'programme_admin', 'platform_admin', 'super_admin');

module.exports = {
  requireNgRole,
  requireMinRole,
  requireExportAuthority,
  requireApprovalAuthority,
  requireJurisdictionAccess,
  requireProgrammeAccess,
  auditRequest,
  requireGovernmentMfa,
  recordAuditLineage,
  invalidateScopeCache,
  getUserJurisdictionScopes,
  getAccessibleJurisdictionIds,
  userCanAccessResource,
  // Convenience groups
  requireAdmin,
  requirePlatformAdmin,
  requireAnalystPlus,
  requireExecutiveView,
  requireReviewer,
  // Utilities exposed for tests
  canonicalRole,
  roleLevel,
  hasMinRole,
  isSuperAdmin,
  isPlatformAdministrator,
  scopeMatchesResource,
};
