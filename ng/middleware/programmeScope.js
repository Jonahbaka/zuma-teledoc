'use strict';

const { getPool } = require('../../server/db');
const {
  assertProgrammeScope,
  recordProgrammeAudit,
} = require('../services/phc/programmeScopeService');

function resolveProgrammeId(req) {
  return req.params?.programmeId
    || req.body?.programmeId
    || req.body?.programme_id
    || req.query?.programmeId
    || req.query?.programme_id
    || req.headers?.['x-programme-id'];
}

function resolveFacilityId(req) {
  return req.params?.facilityId
    || req.body?.facilityId
    || req.body?.facility_id
    || req.query?.facilityId
    || req.query?.facility_id
    || req.headers?.['x-facility-id'];
}

function requireProgrammeScope({
  allowedRoles = null,
  patientResolver = null,
  requireEnrollment = false,
  audit = null,
} = {}) {
  return async (req, res, next) => {
    try {
      const pool = getPool();
      const patientUserId = patientResolver ? await patientResolver(req, pool) : null;
      const context = await assertProgrammeScope(pool, req.user, {
        programmeId: resolveProgrammeId(req),
        facilityId: resolveFacilityId(req),
        allowedRoles,
        patientUserId,
        requireEnrollment,
      });
      req.programmeContext = context;
      if (audit) {
        await recordProgrammeAudit(pool, req, context, {
          action: audit.action,
          resourceType: audit.resourceType,
          resourceId: req.params?.id || null,
          patientUserId,
          purpose: audit.purpose,
          dataClass: audit.dataClass || 'operational',
        });
      }
      next();
    } catch (error) {
      res.status(error.statusCode || 500).json({
        error: error.statusCode ? error.message : 'Programme authorization failed.',
        code: error.code || 'PROGRAMME_SCOPE_ERROR',
      });
    }
  };
}

module.exports = {
  requireProgrammeScope,
  resolveFacilityId,
  resolveProgrammeId,
};
