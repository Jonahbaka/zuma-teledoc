'use strict';

const PLATFORM_ROLES = new Set(['super_admin', 'platform_admin']);

function canonicalRole(raw) {
  return String(raw || '').trim().toLowerCase().replace(/\s+/g, '_');
}

function userIdOf(user) {
  return user?.id || user?.userId || user?.sub || null;
}

function scopeError(statusCode, message, code) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

async function loadUserAccount(pool, userId) {
  const result = await pool.query(
    `SELECT id, role, is_active, COALESCE(is_test_account, FALSE) AS is_test_account
       FROM users
      WHERE id = $1
      LIMIT 1`,
    [userId]
  );
  return result.rows[0] || null;
}

async function listUserProgrammeContexts(pool, user) {
  const userId = userIdOf(user);
  if (!userId) throw scopeError(401, 'Authentication required.', 'AUTHENTICATION_REQUIRED');

  const account = await loadUserAccount(pool, userId);
  if (!account?.is_active) {
    throw scopeError(403, 'Active account required.', 'ACCOUNT_INACTIVE');
  }

  const result = await pool.query(
    `SELECT m.id AS membership_id,
            m.role AS programme_role,
            m.permissions_json,
            m.can_export,
            m.can_approve,
            p.id AS programme_id,
            p.programme_key,
            p.slug AS programme_slug,
            p.name AS programme_name,
            p.demo_only,
            p.status AS programme_status,
            f.id AS facility_id,
            f.name AS facility_name,
            f.facility_code,
            pf.id AS programme_facility_id,
            pf.status AS programme_facility_status
       FROM ng_programme_memberships m
       JOIN public_health_programmes p ON p.id = m.programme_id
       LEFT JOIN ng_programme_facilities pf
         ON pf.programme_id = p.id
        AND (m.facility_id IS NULL OR pf.facility_id = m.facility_id)
        AND pf.status = 'active'
       LEFT JOIN ng_hospitals f ON f.id = pf.facility_id
      WHERE m.user_id = $1
        AND m.status = 'active'
        AND (m.effective_at IS NULL OR m.effective_at <= NOW())
        AND (m.expires_at IS NULL OR m.expires_at > NOW())
        AND p.status = 'active'
      ORDER BY p.name, f.name, m.role`,
    [userId]
  );

  return result.rows.filter((row) => Boolean(row.demo_only) === Boolean(account.is_test_account));
}

async function assertProgrammeScope(pool, user, {
  programmeId,
  facilityId,
  allowedRoles = null,
  patientUserId = null,
  requireEnrollment = false,
} = {}) {
  const userId = userIdOf(user);
  if (!userId) throw scopeError(401, 'Authentication required.', 'AUTHENTICATION_REQUIRED');
  if (!programmeId || !facilityId) {
    throw scopeError(400, 'programmeId and facilityId are required.', 'PROGRAMME_CONTEXT_REQUIRED');
  }

  const account = await loadUserAccount(pool, userId);
  if (!account?.is_active) throw scopeError(403, 'Active account required.', 'ACCOUNT_INACTIVE');

  const contextResult = await pool.query(
    `SELECT p.id AS programme_id,
            p.programme_key,
            p.name AS programme_name,
            p.demo_only,
            p.status AS programme_status,
            pf.id AS programme_facility_id,
            pf.status AS programme_facility_status,
            f.id AS facility_id,
            f.name AS facility_name
       FROM public_health_programmes p
       JOIN ng_programme_facilities pf ON pf.programme_id = p.id
       JOIN ng_hospitals f ON f.id = pf.facility_id
      WHERE p.id = $1 AND f.id = $2
      LIMIT 1`,
    [programmeId, facilityId]
  );
  const context = contextResult.rows[0];
  if (!context || context.programme_status !== 'active' || context.programme_facility_status !== 'active') {
    throw scopeError(403, 'Programme or facility is not active.', 'PROGRAMME_CONTEXT_INACTIVE');
  }

  if (Boolean(context.demo_only) !== Boolean(account.is_test_account)) {
    throw scopeError(403, 'Programme access denied.', 'DEMO_PROGRAMME_ISOLATION');
  }

  const baseRole = canonicalRole(account.role || user.role || user.ng_role);
  let membership = null;
  if (!PLATFORM_ROLES.has(baseRole)) {
    const membershipResult = await pool.query(
      `SELECT id, role, permissions_json, can_export, can_approve
         FROM ng_programme_memberships
        WHERE programme_id = $1
          AND user_id = $2
          AND (facility_id IS NULL OR facility_id = $3)
          AND status = 'active'
          AND (effective_at IS NULL OR effective_at <= NOW())
          AND (expires_at IS NULL OR expires_at > NOW())
        ORDER BY CASE WHEN facility_id = $3 THEN 0 ELSE 1 END
        LIMIT 1`,
      [programmeId, userId, facilityId]
    );
    membership = membershipResult.rows[0] || null;
    if (!membership) throw scopeError(403, 'Programme access denied.', 'PROGRAMME_MEMBERSHIP_REQUIRED');
  } else {
    membership = {
      id: null,
      role: baseRole,
      permissions_json: {},
      can_export: true,
      can_approve: true,
    };
  }

  const allowed = allowedRoles ? new Set(allowedRoles.map(canonicalRole)) : null;
  if (allowed && !allowed.has(canonicalRole(membership.role))) {
    throw scopeError(403, 'Programme role does not permit this action.', 'PROGRAMME_ROLE_DENIED');
  }

  let enrollment = null;
  if (patientUserId || requireEnrollment) {
    if (!patientUserId) throw scopeError(400, 'patientUserId is required.', 'PATIENT_ID_REQUIRED');
    const enrollmentResult = await pool.query(
      `SELECT id, status, consent_status, local_patient_number
         FROM ng_programme_patient_enrollments
        WHERE programme_id = $1
          AND facility_id = $2
          AND patient_user_id = $3
          AND status IN ('active','paused','transferred')
        LIMIT 1`,
      [programmeId, facilityId, patientUserId]
    );
    enrollment = enrollmentResult.rows[0] || null;
    if (requireEnrollment && !enrollment) {
      throw scopeError(403, 'Active programme enrollment required.', 'PROGRAMME_ENROLLMENT_REQUIRED');
    }
  }

  return {
    ...context,
    userId,
    accountRole: baseRole,
    membershipId: membership.id,
    programmeRole: canonicalRole(membership.role),
    permissions: membership.permissions_json || {},
    canExport: membership.can_export === true,
    canApprove: membership.can_approve === true,
    enrollment,
  };
}

async function recordProgrammeAudit(pool, req, context, {
  action,
  resourceType,
  resourceId = null,
  patientUserId = null,
  purpose = null,
  dataClass = 'operational',
  metadata = {},
}) {
  try {
    await pool.query(
      `INSERT INTO ng_programme_audit_events
         (programme_id, facility_id, actor_user_id, patient_user_id,
          action, resource_type, resource_id, purpose, data_class,
          metadata_json, ip_address, user_agent)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [
        context.programme_id,
        context.facility_id,
        context.userId,
        patientUserId,
        action,
        resourceType,
        resourceId,
        purpose,
        dataClass,
        JSON.stringify(metadata || {}),
        req?.ip || null,
        req?.get?.('user-agent') || req?.headers?.['user-agent'] || null,
      ]
    );
  } catch (error) {
    if (['42P01', '42703', '23514'].includes(error.code)) {
      throw scopeError(503, 'Programme audit logging is unavailable.', 'PROGRAMME_AUDIT_UNAVAILABLE');
    }
    throw error;
  }
}

module.exports = {
  assertProgrammeScope,
  canonicalRole,
  listUserProgrammeContexts,
  recordProgrammeAudit,
  scopeError,
  userIdOf,
};
