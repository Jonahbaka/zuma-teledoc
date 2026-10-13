const express = require('express');
const service = require('../services/public-health/publicHealthProgrammeService');
const governanceService = require('../services/public-health/governanceService');
const rbac = require('../middleware/rbac');
const { requireReportScope, requireReportApproval, requireReportExport, canAccessReport } = require('../middleware/reportScope');

const router = express.Router();

function asyncHandler(handler) {
  return async (req, res) => {
    try {
      await handler(req, res);
    } catch (error) {
      const status = error.status || error.statusCode || 500;
      res.status(status).json({
        error: status === 500 ? 'DHIS2 readiness request failed.' : error.message,
        details: status === 500 ? undefined : error.blockers,
        preview: error.preview,
      });
    }
  };
}

function actor(req) {
  return service.getActorId(req.user);
}

router.get('/settings', rbac.requireNgRole('programme_admin', 'platform_admin', 'super_admin'), rbac.auditRequest('view', 'dhis2_settings'), asyncHandler(async (_req, res) => {
  res.json({ settings: await service.getSettings() });
}));

router.post('/settings', rbac.requireNgRole('programme_admin', 'platform_admin', 'super_admin'), asyncHandler(async (req, res) => {
  const actorUserId = actor(req);
  const settings = await service.updateSettings(req.body || {}, actorUserId);
  await governanceService.writeAuditLineage({
    actorUserId,
    action: 'modify',
    resourceType: 'dhis2_settings',
    ip: req.ip,
    userAgent: req.get('user-agent'),
    metadata: { changedFields: Object.keys(req.body || {}).filter((key) => key !== 'apiToken') },
  });
  res.json({ settings });
}));

router.post('/test-connection', rbac.requireNgRole('programme_admin', 'platform_admin', 'super_admin'), asyncHandler(async (_req, res) => {
  res.json(await service.testConnection());
}));

router.post('/dry-run/:reportId', rbac.requireExportAuthority(), requireReportExport, asyncHandler(async (req, res) => {
  const actorUserId = actor(req);
  const preview = await service.dryRunDhis2(req.params.reportId, actorUserId);
  await governanceService.writeAuditLineage({
    actorUserId,
    action: 'dry_run',
    resourceType: 'report',
    resourceId: req.params.reportId,
    exportFormat: 'dhis2_preview',
    ip: req.ip,
    userAgent: req.get('user-agent'),
  });
  res.json(preview);
}));

router.post('/sync/:reportId', rbac.requireApprovalAuthority(), requireReportApproval, requireReportExport, asyncHandler(async (req, res) => {
  const actorUserId = actor(req);
  try {
    const result = await service.syncDhis2(req.params.reportId, actorUserId);
    await governanceService.writeAuditLineage({
      actorUserId,
      action: 'sync',
      resourceType: 'report',
      resourceId: req.params.reportId,
      exportFormat: 'dhis2',
      ip: req.ip,
      userAgent: req.get('user-agent'),
      metadata: { outcome: result.delivery.status, responseStatus: result.status },
    });
    res.json(result);
  } catch (error) {
    await governanceService.writeAuditLineage({
      actorUserId,
      action: 'sync',
      resourceType: 'report',
      resourceId: req.params.reportId,
      exportFormat: 'dhis2',
      ip: req.ip,
      userAgent: req.get('user-agent'),
      metadata: { outcome: 'blocked_or_failed', errorCode: error.code || null },
    });
    throw error;
  }
}));

router.get('/sync-logs', rbac.requireReviewer, rbac.auditRequest('view', 'dhis2_sync_logs'), asyncHandler(async (req, res) => {
  const result = await service.getSyncLogs(req.query);
  const permitted = await Promise.all(result.logs.map(async (entry) => entry.report_id && await canAccessReport(req.user, entry.report_id) ? entry : null));
  res.json({ logs: permitted.filter(Boolean) });
}));

module.exports = router;
