'use strict';
const { getPool } = require('../../server/db');
const rbac = require('./rbac');

async function canAccessReport(user, reportId, permission = 'read') {
  if (!/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(String(reportId || ''))) return false;
  const { rows } = await getPool().query(
    `SELECT r.facility_id, s.jurisdiction_id,
       ARRAY(SELECT DISTINCT i.programme_area FROM public_health_report_values v
         JOIN public_health_indicators i ON i.id = v.indicator_id WHERE v.report_id = r.id) AS programme_areas
     FROM public_health_reports r
     LEFT JOIN LATERAL (SELECT jurisdiction_id FROM ng_governance_submissions
       WHERE report_id = r.id ORDER BY created_at DESC LIMIT 1) s ON true WHERE r.id = $1`, [reportId]
  );
  if (!rows[0]) return false;
  const report = rows[0];
  for (const area of report.programme_areas.length ? report.programme_areas : [null]) {
    const allowed = await rbac.userCanAccessResource(user, { jurisdictionId: report.jurisdiction_id, facilityId: report.facility_id, programmeArea: area, permission });
    if (allowed === null) throw Object.assign(new Error('Government access scopes are unavailable.'), { status: 503 });
    if (!allowed) return false;
  }
  return true;
}

function scopeMiddleware(permission) {
  return async (req, res, next) => {
    try {
      if (!await canAccessReport(req.user, req.params.reportId || req.params.id, permission)) return res.status(404).json({ error: 'Report not found.' });
      next();
    } catch (error) { next(error); }
  };
}
const requireReportScope = scopeMiddleware('read');
const requireReportApproval = scopeMiddleware('approve');
const requireReportExport = scopeMiddleware('export');
async function accessibleReportIds(user) {
  const platformAccess = await rbac.userCanAccessResource(user, {});
  if (platformAccess === true) return null;
  if (platformAccess === null) throw Object.assign(new Error('Government access scopes are unavailable.'), { status: 503 });
  const { rows } = await getPool().query(
    `WITH RECURSIVE scopes AS (
       SELECT jurisdiction_id, facility_id, programme_area FROM ng_user_jurisdiction_roles
        WHERE user_id = $1 AND active = true AND can_view_aggregate = true AND (expires_at IS NULL OR expires_at > NOW())
       UNION ALL
       SELECT j.id, s.facility_id, s.programme_area FROM ng_jurisdictions j JOIN scopes s ON j.parent_id = s.jurisdiction_id
     )
     SELECT r.id FROM public_health_reports r
     LEFT JOIN LATERAL (SELECT jurisdiction_id FROM ng_governance_submissions WHERE report_id = r.id ORDER BY created_at DESC LIMIT 1) g ON true
     WHERE EXISTS (SELECT 1 FROM scopes s WHERE
       (s.jurisdiction_id = g.jurisdiction_id OR (g.jurisdiction_id IS NULL AND s.facility_id IS NOT NULL AND s.facility_id = r.facility_id))
       AND (s.facility_id IS NULL OR s.facility_id = r.facility_id))
     AND NOT EXISTS (
       SELECT 1 FROM public_health_report_values v JOIN public_health_indicators i ON i.id = v.indicator_id
       WHERE v.report_id = r.id AND NOT EXISTS (SELECT 1 FROM scopes s WHERE
         (s.jurisdiction_id = g.jurisdiction_id OR (g.jurisdiction_id IS NULL AND s.facility_id IS NOT NULL AND s.facility_id = r.facility_id))
         AND (s.facility_id IS NULL OR s.facility_id = r.facility_id)
         AND (s.programme_area IS NULL OR s.programme_area = i.programme_area))
     )`, [user.id || user.userId]
  );
  return rows.map((row) => row.id);
}
module.exports = { canAccessReport, requireReportScope, requireReportApproval, requireReportExport, accessibleReportIds };
