'use strict';

const express = require('express');
const multer = require('multer');
const service = require('../services/public-health/governmentDataService');
const rbac = require('../middleware/rbac');

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { files: 1, fileSize: 15 * 1024 * 1024, fields: 30 },
});
const requireGovernmentReader = rbac.requireNgRole(
  'analyst', 'reviewer', 'approver', 'programme_admin',
  'executive_read_only', 'platform_admin', 'super_admin'
);

function wrap(fn) {
  return async (req, res) => {
    try { await fn(req, res); }
    catch (error) {
      console.error('[Government data]', error.message);
      res.status(error.status || error.statusCode || 500).json({
        error: error.status || error.statusCode ? error.message : 'Government data request failed.',
        details: error.details,
      });
    }
  };
}

function actor(req) { return req.user; }
function userId(req) { return req.user?.id || req.user?.userId; }

async function ensureScope(req, res, resource) {
  const access = await rbac.userCanAccessResource(req.user, {
    jurisdictionId: resource?.jurisdiction_id || resource?.jurisdictionId,
    facilityId: resource?.facility_id || resource?.facilityId,
    programmeArea: resource?.programme_area || resource?.programmeArea,
  });
  if (access === null) { res.status(503).json({ error: 'Government authorization scopes are unavailable.' }); return false; }
  if (!access) { res.status(403).json({ error: 'Access outside your assigned government scope is denied.' }); return false; }
  return true;
}

async function accessibleJurisdictions(req, res) {
  const ids = await rbac.getAccessibleJurisdictionIds(req.user);
  if (ids === undefined) res.status(503).json({ error: 'Government authorization scopes are unavailable.' });
  return ids;
}

async function scopedBatch(req, res) {
  const report = await service.getBatchReport(req.params.id);
  if (!(await ensureScope(req, res, report.batch))) return null;
  return report;
}

router.post('/public/accept-invitation', wrap(async (req, res) => {
  res.status(201).json(await service.acceptGovernmentInvitation(req.body || {}));
}));

router.post('/access/invitations', rbac.requirePlatformAdmin, rbac.auditRequest('permission_grant', 'government_invitation'), wrap(async (req, res) => {
  const created = await service.createGovernmentInvitation(req.body || {}, actor(req));
  res.status(201).json({
    invitation: created.invitation,
    acceptUrl: `/ng/government-access/accept?token=${encodeURIComponent(created.token)}`,
  });
}));

router.delete('/access/invitations/:id', rbac.requirePlatformAdmin, rbac.auditRequest('permission_revoke', 'government_invitation'), wrap(async (req, res) => {
  res.json(await service.revokeInvitation(req.params.id, actor(req)));
}));

router.post('/access/accounts/:userId/revoke', rbac.requirePlatformAdmin, wrap(async (req, res) => {
  const result = await service.revokeGovernmentAccount(req.params.userId, actor(req));
  rbac.invalidateScopeCache(req.params.userId);
  res.json(result);
}));

router.get('/sources', requireGovernmentReader, wrap(async (req, res) => {
  const ids = await accessibleJurisdictions(req, res);
  if (ids === undefined) return;
  res.json({ sources: await service.listSources({ accessibleJurisdictionIds: ids, status: req.query.status || 'active' }) });
}));

router.post(
  '/sources',
  rbac.requireNgRole('programme_admin', 'platform_admin', 'super_admin'),
  rbac.auditRequest('modify', 'government_data_source'),
  wrap(async (req, res) => {
    if (!(await ensureScope(req, res, req.body || {}))) return;
    res.status(201).json({ source: await service.registerSource(req.body || {}, actor(req)) });
  })
);

router.post(
  '/sources/:sourceId/mappings',
  rbac.requireNgRole('analyst', 'programme_admin', 'platform_admin', 'super_admin'),
  rbac.auditRequest('modify', 'government_data_mapping'),
  wrap(async (req, res) => {
    const ids = await accessibleJurisdictions(req, res);
    if (ids === undefined) return;
    const source = (await service.listSources({ accessibleJurisdictionIds: ids })).find((item) => String(item.id) === String(req.params.sourceId));
    if (!source) return res.status(404).json({ error: 'Source not found in your assigned scope.' });
    res.status(201).json({ mapping: await service.saveMapping(req.params.sourceId, req.body || {}, actor(req)) });
  })
);

router.post(
  '/imports/preview',
  rbac.requireAnalystPlus,
  rbac.auditRequest('view', 'government_import_preview'),
  upload.single('file'),
  wrap(async (req, res) => {
    if (!req.file) throw new service.RequestError(422, 'Select a CSV, XLSX, or JSON source file.');
    const parsed = await service.parseFile(req.file.buffer, req.file.originalname, req.file.mimetype);
    res.json({
      sourceType: parsed.sourceType,
      headers: [...new Set(parsed.rows.flatMap((row) => Object.keys(row)))],
      rowCount: parsed.rows.length,
      preview: parsed.rows.slice(0, 10),
    });
  })
);

router.post(
  '/imports/upload',
  rbac.requireAnalystPlus,
  rbac.auditRequest('import', 'government_import_batch'),
  upload.single('file'),
  wrap(async (req, res) => {
    if (!req.file) throw new service.RequestError(422, 'Select a CSV, XLSX, or JSON source file.');
    const parsed = await service.parseFile(req.file.buffer, req.file.originalname, req.file.mimetype);
    const input = {
      ...req.body,
      sourceType: parsed.sourceType,
      rows: parsed.rows,
      rawBuffer: req.file.buffer,
      filename: req.file.originalname,
      mediaType: req.file.mimetype,
    };
    if (!(await ensureScope(req, res, input))) return;
    const result = await service.createImport(input, actor(req));
    res.status(result.created ? 201 : 200).json(result);
  })
);

router.post(
  '/imports/structured',
  rbac.requireAnalystPlus,
  rbac.auditRequest('import', 'government_import_batch'),
  wrap(async (req, res) => {
    if (!(await ensureScope(req, res, req.body || {}))) return;
    const result = await service.createImport({
      ...(req.body || {}),
      rows: req.body?.records,
      mediaType: 'application/json',
    }, actor(req));
    res.status(result.created ? 201 : 200).json(result);
  })
);

router.get('/imports/:id', requireGovernmentReader, rbac.auditRequest('view', 'government_import_batch'), wrap(async (req, res) => {
  const report = await scopedBatch(req, res);
  if (report) res.json(report);
}));

router.post('/imports/:id/validate', rbac.requireAnalystPlus, rbac.auditRequest('validate', 'government_import_batch'), wrap(async (req, res) => {
  if (!(await scopedBatch(req, res))) return;
  res.json(await service.validateBatch(req.params.id, actor(req)));
}));

router.post('/imports/:id/submit', rbac.requireAnalystPlus, rbac.auditRequest('submit', 'government_import_batch'), wrap(async (req, res) => {
  if (!(await scopedBatch(req, res))) return;
  res.json(await service.decideBatch(req.params.id, 'submit', actor(req), req.body?.notes));
}));

router.post('/imports/:id/approve', rbac.requireApprovalAuthority(), rbac.auditRequest('approve', 'government_import_batch'), wrap(async (req, res) => {
  if (!(await scopedBatch(req, res))) return;
  res.json(await service.decideBatch(req.params.id, 'approve', actor(req), req.body?.notes));
}));

router.post('/imports/:id/reject', rbac.requireReviewer, rbac.auditRequest('reject', 'government_import_batch'), wrap(async (req, res) => {
  if (!(await scopedBatch(req, res))) return;
  res.json(await service.decideBatch(req.params.id, 'reject', actor(req), req.body?.notes));
}));

router.post('/imports/:id/commit', rbac.requireApprovalAuthority(), rbac.auditRequest('approve', 'government_import_commit'), wrap(async (req, res) => {
  if (!(await scopedBatch(req, res))) return;
  res.json(await service.commitBatch(req.params.id, actor(req)));
}));

router.post('/imports/:id/rollback', rbac.requirePlatformAdmin, rbac.auditRequest('rollback', 'government_import_batch'), wrap(async (req, res) => {
  if (!(await scopedBatch(req, res))) return;
  res.json(await service.rollbackBatch(req.params.id, actor(req), req.body?.reason));
}));

router.get('/imports/:id/dhis2-export', rbac.requireExportAuthority(), rbac.auditRequest('export', 'government_dhis2_export'), wrap(async (req, res) => {
  if (!(await scopedBatch(req, res))) return;
  res.json(await service.dhis2Export(req.params.id));
}));

router.get('/search', requireGovernmentReader, rbac.auditRequest('search', 'government_records'), wrap(async (req, res) => {
  const ids = await accessibleJurisdictions(req, res);
  if (ids === undefined) return;
  if (req.query.jurisdictionId && !(await ensureScope(req, res, req.query))) return;
  res.json(await service.searchRecords(req.query, actor(req), ids));
}));

router.get('/search/autocomplete', requireGovernmentReader, wrap(async (req, res) => {
  const ids = await accessibleJurisdictions(req, res);
  if (ids === undefined) return;
  res.json({ suggestions: await service.autocomplete(req.query.q, ids) });
}));

router.get('/search/recent', requireGovernmentReader, wrap(async (req, res) => {
  res.json({ searches: await service.recentSearches(userId(req)) });
}));

router.get('/saved-views', requireGovernmentReader, wrap(async (req, res) => {
  res.json({ views: await service.listViews(userId(req)) });
}));

router.post('/saved-views', requireGovernmentReader, rbac.auditRequest('modify', 'government_saved_view'), wrap(async (req, res) => {
  res.status(201).json({ view: await service.saveView(userId(req), req.body || {}) });
}));

router.get('/search/export/:format', rbac.requireExportAuthority(), rbac.auditRequest('export', 'government_records'), wrap(async (req, res) => {
  const ids = await accessibleJurisdictions(req, res);
  if (ids === undefined) return;
  const exported = await service.exportSearch(req.params.format, req.query, actor(req), ids);
  res.setHeader('Content-Type', exported.contentType);
  res.setHeader('Content-Disposition', `attachment; filename="doctarx-government-records.${exported.extension}"`);
  res.send(exported.body);
}));

module.exports = router;
