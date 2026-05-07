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

router.get('/settings', asyncHandler(async (_req, res) => {
  res.json({ settings: await service.getSettings() });
}));

router.post('/settings', asyncHandler(async (req, res) => {
  res.json({ settings: await service.updateSettings(req.body || {}, actor(req)) });
}));

router.post('/test-connection', asyncHandler(async (_req, res) => {
  res.json(await service.testConnection());
}));

router.post('/dry-run/:reportId', asyncHandler(async (req, res) => {
  res.json(await service.dryRunDhis2(req.params.reportId, actor(req)));
}));

router.post('/sync/:reportId', asyncHandler(async (req, res) => {
  res.json(await service.syncDhis2(req.params.reportId, actor(req)));
}));

router.get('/sync-logs', asyncHandler(async (req, res) => {
  res.json(await service.getSyncLogs(req.query));
}));

module.exports = router;
