'use strict';

const CLINICAL_WRITE_ROLES = new Set([
  'provider',
  'doctor',
  'consultant',
  'physician',
  'specialist',
]);

const CLINICAL_ADMIN_ROLES = new Set([
  'admin',
  'super_admin',
  'administrator',
  'platform_admin',
]);

function canonicalRole(raw) {
  return String(raw || '').trim().toLowerCase().replace(/\s+/g, '_');
}

function userIdOf(user) {
  return user?.id || user?.userId || user?.sub || null;
}

function httpError(statusCode, message, code) {
  const error = new Error(message);
  error.statusCode = statusCode;
  if (code) error.code = code;
  return error;
}

async function recordBreakGlass(pool, {
  userId,
  patientUserId,
  encounterId,
  action,
  reason,
  request,
}) {
  if (typeof reason !== 'string' || reason.trim().length < 10) {
    throw httpError(
      403,
      'Administrative clinical access requires a break-glass reason of at least 10 characters.',
      'BREAK_GLASS_REASON_REQUIRED'
    );
  }

  try {
    await pool.query(
      `INSERT INTO ng_audit_lineage
         (actor_user_id, action, resource_type, resource_id, data_class,
          ip_address, user_agent, metadata_json)
       VALUES ($1, $2, 'clinical_patient_access', $3, 'sensitive', $4, $5, $6)`,
      [
        userId,
        action === 'read' ? 'view' : 'modify',
        encounterId || patientUserId,
        request?.ip || null,
        request?.get?.('user-agent') || request?.headers?.['user-agent'] || null,
        JSON.stringify({
          breakGlass: true,
          reason: reason.trim(),
          patientUserId,
          encounterId: encounterId || null,
        }),
      ]
    );
  } catch (error) {
    if (['42P01', '42703', '23514'].includes(error.code)) {
      throw httpError(
        503,
        'Break-glass audit logging is unavailable.',
        'BREAK_GLASS_AUDIT_UNAVAILABLE'
      );
    }
    throw error;
  }
}

async function findProviderProfile(pool, userId) {
  const result = await pool.query(
    'SELECT id FROM ng_providers WHERE user_id = $1 LIMIT 1',
    [userId]
  );
  return result.rows[0]?.id || null;
}

async function hasClinicalRelationship(pool, {
  providerUserId,
  providerId,
  patientUserId,
  appointmentId,
  encounterId,
}) {
  if (appointmentId) {
    const appointment = await pool.query(
      `SELECT id
         FROM ng_appointments
        WHERE id = $1
          AND patient_user_id = $2
          AND provider_id = $3
        LIMIT 1`,
      [appointmentId, patientUserId, providerId]
    );
    if (appointment.rows.length) return true;
  }

  if (encounterId) {
    const encounter = await pool.query(
      `SELECT id
         FROM ng_clinical_encounters
        WHERE id = $1
          AND patient_user_id = $2
          AND provider_user_id = $3
        LIMIT 1`,
      [encounterId, patientUserId, providerUserId]
    );
    if (encounter.rows.length) return true;
  }

  const relationship = await pool.query(
    `SELECT id
       FROM ng_appointments
      WHERE patient_user_id = $1 AND provider_id = $2
     UNION
     SELECT id
       FROM ng_clinical_encounters
      WHERE patient_user_id = $1 AND provider_user_id = $3
     UNION
     SELECT id
       FROM provider_patient_relationships
      WHERE patient_id = $1 AND provider_id = $3 AND is_active = TRUE
     LIMIT 1`,
    [patientUserId, providerId, providerUserId]
  );
  return relationship.rows.length > 0;
}

async function assertClinicalAccess(req, {
  pool,
  patientUserId,
  encounterId = null,
  appointmentId = null,
  mode = 'read',
} = {}) {
  if (!pool) throw new Error('pool is required');

  const userId = userIdOf(req?.user);
  const role = canonicalRole(req?.user?.role || req?.user?.ng_role);
  if (!userId) throw httpError(401, 'Authentication required.', 'AUTHENTICATION_REQUIRED');
  if (!patientUserId) throw httpError(400, 'patientUserId is required.', 'PATIENT_ID_REQUIRED');

  if (role === 'patient') {
    if (String(userId) !== String(patientUserId) || mode !== 'read') {
      throw httpError(403, 'Clinical record access denied.', 'CLINICAL_ACCESS_DENIED');
    }
    return { userId, role, patientUserId, selfAccess: true, providerId: null };
  }

  if (CLINICAL_ADMIN_ROLES.has(role)) {
    const reason = req?.headers?.['x-break-glass-reason'] || req?.body?.breakGlassReason;
    await recordBreakGlass(pool, {
      userId,
      patientUserId,
      encounterId,
      action: mode,
      reason,
      request: req,
    });
    return {
      userId,
      role,
      patientUserId,
      providerId: req?.body?.providerId || req?.body?.provider_id || null,
      providerUserId: userId,
      adminOverride: true,
    };
  }

  if (!CLINICAL_WRITE_ROLES.has(role)) {
    throw httpError(403, 'Clinical record access denied.', 'CLINICAL_ACCESS_DENIED');
  }

  const providerId = await findProviderProfile(pool, userId);
  if (!providerId) {
    throw httpError(403, 'An active Nigeria provider profile is required.', 'PROVIDER_PROFILE_REQUIRED');
  }

  const related = await hasClinicalRelationship(pool, {
    providerUserId: userId,
    providerId,
    patientUserId,
    appointmentId,
    encounterId,
  });
  if (!related) {
    throw httpError(403, 'Clinical record access denied.', 'CLINICAL_ACCESS_DENIED');
  }

  return {
    userId,
    role,
    patientUserId,
    providerId,
    providerUserId: userId,
    adminOverride: false,
  };
}

module.exports = {
  assertClinicalAccess,
  canonicalRole,
  userIdOf,
  _test: {
    CLINICAL_ADMIN_ROLES,
    CLINICAL_WRITE_ROLES,
    hasClinicalRelationship,
    recordBreakGlass,
  },
};
