'use strict';

/**
 * ng/routes/publicHealth.js  (hardened replacement)
 *
 * Replaces the existing publicHealth.js router with:
 *  - per-route RBAC via ng/middleware/rbac.js
 *  - audit lineage recording on export and approval actions
 *  - organization + facility boundary enforcement
 *  - export authority gating (CSV, JSON, DHIS2-preview)
 *
 * Mounted at /api/ng/public-health in ng/routes/index.js
 */

const express = require('express');
const service  = require('../services/public-health/publicHealthProgrammeService');
const rbac     = require('../middleware/rbac');
const govSvc   = require('../services/public-health/governanceService');

const router = express.Router();

// ─── Helpers ──────────────────────────────────────────────────────────────────

function wrap(fn) {
  return async (req, res) => {
    try {
      await fn(req, res);
    } catch (err) {
      const status = err.status || err.statusCode || 500;
      res.status(status).json({
        error: status === 500 ? 'Public-health programme request failed.' : err.message,
        details: status === 500 ? undefined : err.blockers,
        preview: err.preview,
      });
    }
  };
}

function actor(req) {
  return service.getActorId(req.user);
}

// ─── Programme overview & areas (analyst+) ───────────────────────────────────

router.get(
  '/programme/overview',
  rbac.requireAnalystPlus,
  rbac.auditRequest('view', 'programme_overview'),
  wrap(async (req, res) => {
    res.json(await service.getOverview(req.query));
  })
);

router.get(
  '/programme/executive-dashboard',
  rbac.requireExecutiveView,
  rbac.auditRequest('view', 'executive_dashboard'),
  wrap(async (req, res) => {
    const jurisdictionIds = await rbac.getAccessibleJurisdictionIds(req.user);
    if (jurisdictionIds === undefined) {
      return res.status(503).json({ error: 'Government authorization scopes are unavailable.' });
    }
    res.json(await service.getExecutiveDashboard({ ...req.query, jurisdictionIds }));
  })
);

router.get(
  '/programme/areas',
  rbac.requireAnalystPlus,
  wrap(async (req, res) => {
    res.json({ areas: await service.getProgrammeAreas(req.query) });
  })
);

// ─── Analytics (analyst+) ────────────────────────────────────────────────────

router.get(
  '/analytics',
  rbac.requireAnalystPlus,
  rbac.auditRequest('view', 'analytics'),
  wrap(async (req, res) => {
    res.json(await service.getAnalytics(req.query));
  })
);

router.get(
  '/chart-data',
  rbac.requireAnalystPlus,
  wrap(async (req, res) => {
    res.json(await service.getChartData(req.query));
  })
);

// ─── Indicators (analyst+ read, programme_admin write) ──────────────────────

router.get(
  '/indicators',
  rbac.requireAnalystPlus,
  wrap(async (_req, res) => {
    res.json({ indicators: await service.listIndicators() });
  })
);

router.post(
  '/indicators',
  rbac.requireNgRole('programme_admin', 'platform_admin', 'super_admin'),
  wrap(async (req, res) => {
    const indicator = await service.upsertIndicator(req.body || {});
    res.status(201).json({ indicator });
  })
);

router.patch(
  '/indicators/:id',
  rbac.requireNgRole('programme_admin', 'platform_admin', 'super_admin'),
  wrap(async (req, res) => {
    const indicator = await service.patchIndicator(req.params.id, req.body || {});
    res.json({ indicator });
  })
);

// ─── Reports (analyst+ read, analyst+ generate, approver approve) ─────────────

router.post(
  '/reports/generate',
  rbac.requireAnalystPlus,
  wrap(async (req, res) => {
    const report = await service.generateReport({ ...(req.body || {}), actorUserId: actor(req) });

    // Record lineage
    await govSvc.writeAuditLineage({
      actorUserId: actor(req),
      action:       'generate',
      resourceType: 'report',
      resourceId:   report.report?.id || null,
      ip:           req.ip,
      userAgent:    req.get('user-agent'),
      metadata:     { period: req.body?.period },
    });

    res.status(201).json(report);
  })
);

router.get(
  '/reports',
  rbac.requireAnalystPlus,
  rbac.auditRequest('view', 'reports'),
  wrap(async (req, res) => {
    res.json(await service.listReports(req.query));
  })
);

router.get(
  '/reports/:id',
  rbac.requireAnalystPlus,
  rbac.auditRequest('view', 'report'),
  wrap(async (req, res) => {
    res.json(await service.getReport(req.params.id));
  })
);

router.post(
  '/reports/:id/approve',
  rbac.requireApprovalAuthority(),
  wrap(async (req, res) => {
    const result = await service.approveReport(req.params.id, actor(req), req.body?.notes);

    await govSvc.writeAuditLineage({
      actorUserId: actor(req),
      action:       'approve',
      resourceType: 'report',
      resourceId:   req.params.id,
      ip:           req.ip,
      userAgent:    req.get('user-agent'),
      metadata:     { notes: req.body?.notes },
    });

    res.json(result);
  })
);

// ─── Exports (export authority required) ─────────────────────────────────────

router.post(
  '/reports/:id/export/csv',
  rbac.requireExportAuthority(),
  wrap(async (req, res) => {
    const bundle = await service.getReport(req.params.id);
    const csv    = service.reportToCsv(bundle);

    await govSvc.writeAuditLineage({
      actorUserId:  actor(req),
      action:       'export',
      resourceType: 'report',
      resourceId:   req.params.id,
      exportFormat: 'csv',
      ip:           req.ip,
      userAgent:    req.get('user-agent'),
    });

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="doctarx-ng-public-health-${bundle.report.report_period}.csv"`);
    res.send(csv);
  })
);

router.post(
  '/reports/:id/export/json',
  rbac.requireExportAuthority(),
  wrap(async (req, res) => {
    const bundle = service.reportToJson(await service.getReport(req.params.id));

    await govSvc.writeAuditLineage({
      actorUserId:  actor(req),
      action:       'export',
      resourceType: 'report',
      resourceId:   req.params.id,
      exportFormat: 'json',
      ip:           req.ip,
      userAgent:    req.get('user-agent'),
    });

    res.json(bundle);
  })
);

router.post(
  '/reports/:id/export/dhis2-preview',
  rbac.requireExportAuthority(),
  wrap(async (req, res) => {
    const preview = await service.buildDhis2Preview(req.params.id);

    await govSvc.writeAuditLineage({
      actorUserId:  actor(req),
      action:       'dry_run',
      resourceType: 'report',
      resourceId:   req.params.id,
      exportFormat: 'dhis2_preview',
      ip:           req.ip,
      userAgent:    req.get('user-agent'),
    });

    res.json(preview);
  })
);

// ─── Forecast & insights (analyst+) ─────────────────────────────────────────

router.get(
  '/forecast',
  rbac.requireAnalystPlus,
  wrap(async (req, res) => {
    res.json(await service.getForecast(req.query));
  })
);

router.get(
  '/insights',
  rbac.requireAnalystPlus,
  wrap(async (req, res) => {
    res.json(await service.getInsights(req.query));
  })
);

// ─── Audit logs (platform_admin+) ────────────────────────────────────────────

router.get(
  '/audit-logs',
  rbac.requirePlatformAdmin,
  rbac.auditRequest('view', 'audit_logs'),
  wrap(async (req, res) => {
    res.json(await service.getAuditLogs(req.query));
  })
);

module.exports = router;
