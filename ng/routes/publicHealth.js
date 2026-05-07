const express = require('express');
const service = require('../services/public-health/publicHealthProgrammeService');

const router = express.Router();

function asyncHandler(handler) {
  return async (req, res) => {
    try {
      await handler(req, res);
    } catch (error) {
      const status = error.status || error.statusCode || 500;
      res.status(status).json({
        error: status === 500 ? 'Public-health programme request failed.' : error.message,
        details: status === 500 ? undefined : error.blockers,
        preview: error.preview,
      });
    }
  };
}

function actor(req) {
  return service.getActorId(req.user);
}

function requireApprover(req, res, next) {
  if (!['admin', 'super_admin', 'compliance'].includes(String(req.user?.role || '').toLowerCase())) {
    return res.status(403).json({ error: 'Report approval requires admin, super-admin, or compliance access.' });
  }
  next();
}

router.get('/programme/overview', asyncHandler(async (req, res) => {
  res.json(await service.getOverview(req.query));
}));

router.get('/programme/executive-dashboard', asyncHandler(async (req, res) => {
  res.json(await service.getExecutiveDashboard(req.query));
}));

router.get('/programme/areas', asyncHandler(async (req, res) => {
  res.json({ areas: await service.getProgrammeAreas(req.query) });
}));

router.get('/analytics', asyncHandler(async (req, res) => {
  res.json(await service.getAnalytics(req.query));
}));

router.get('/chart-data', asyncHandler(async (req, res) => {
  res.json(await service.getChartData(req.query));
}));

router.get('/indicators', asyncHandler(async (_req, res) => {
  res.json({ indicators: await service.listIndicators() });
}));

router.post('/indicators', asyncHandler(async (req, res) => {
  const indicator = await service.upsertIndicator(req.body || {});
  res.status(201).json({ indicator });
}));

router.patch('/indicators/:id', asyncHandler(async (req, res) => {
  const indicator = await service.patchIndicator(req.params.id, req.body || {});
  res.json({ indicator });
}));

router.post('/reports/generate', asyncHandler(async (req, res) => {
  const report = await service.generateReport({ ...(req.body || {}), actorUserId: actor(req) });
  res.status(201).json(report);
}));

router.get('/reports', asyncHandler(async (req, res) => {
  res.json(await service.listReports(req.query));
}));

router.get('/reports/:id', asyncHandler(async (req, res) => {
  res.json(await service.getReport(req.params.id));
}));

router.post('/reports/:id/approve', requireApprover, asyncHandler(async (req, res) => {
  res.json(await service.approveReport(req.params.id, actor(req), req.body?.notes));
}));

router.post('/reports/:id/export/csv', asyncHandler(async (req, res) => {
  const bundle = await service.getReport(req.params.id);
  const csv = service.reportToCsv(bundle);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="doctarx-ng-public-health-${bundle.report.report_period}.csv"`);
  res.send(csv);
}));

router.post('/reports/:id/export/json', asyncHandler(async (req, res) => {
  res.json(service.reportToJson(await service.getReport(req.params.id)));
}));

router.post('/reports/:id/export/dhis2-preview', asyncHandler(async (req, res) => {
  res.json(await service.buildDhis2Preview(req.params.id));
}));

router.get('/forecast', asyncHandler(async (req, res) => {
  res.json(await service.getForecast(req.query));
}));

router.get('/insights', asyncHandler(async (req, res) => {
  res.json(await service.getInsights(req.query));
}));

router.get('/audit-logs', asyncHandler(async (req, res) => {
  res.json(await service.getAuditLogs(req.query));
}));

module.exports = router;
