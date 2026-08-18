'use strict';

/**
 * ng/routes/governance.js
 * Federated governance API routes for DoctaRx Nigeria.
 *
 * Mounted at: /api/ng/governance
 * Auth required on all routes via ng/routes/index.js
 *
 * Route summary:
 *   GET  /hierarchy                       — jurisdiction tree (analyst+)
 *   GET  /jurisdictions/:id               — single jurisdiction
 *   GET  /executive-summary               — cross-jurisdiction aggregate (executive+)
 *   GET  /programme-spaces                — programme space catalogue
 *   GET  /submissions                     — list governance submissions (reviewer+)
 *   POST /submissions                     — submit a report into workflow (analyst+)
 *   GET  /submissions/:id                 — get single submission
 *   POST /submissions/:id/advance         — advance workflow state (approver-level gates enforced per target)
 *   GET  /submissions/:id/logs            — workflow audit trail
 *   GET  /audit-lineage                   — extended audit lineage (platform_admin+)
 *   GET  /user/:userId/roles              — user's jurisdiction roles (platform_admin+)
 *   POST /user/:userId/roles              — grant role (platform_admin+)
 *   DELETE /user/:userId/roles            — revoke role (platform_admin+)
 *   POST /portal-tokens                   — issue portal access token (platform_admin+)
 */

const express = require('express');
const svc     = require('../services/public-health/governanceService');
const rbac    = require('../middleware/rbac');

const router = express.Router();

// ─── Async error boundary ────────────────────────────────────────────────────

function wrap(fn) {
  return async (req, res) => {
    try {
      await fn(req, res);
    } catch (err) {
      const status = err.status || err.statusCode || 500;
      res.status(status).json({
        error: status === 500 ? 'Governance request failed.' : err.message,
      });
    }
  };
}

function actor(req) {
  return req.user?.id || req.user?.userId || null;
}

async function runGate(middleware, req, res) {
  let allowed = false;
  await middleware(req, res, () => { allowed = true; });
  return allowed;
}

async function ensureResourceScope(req, res, resource) {
  const allowed = await rbac.userCanAccessResource(req.user, {
    jurisdictionId: resource?.jurisdiction_id || resource?.jurisdictionId || null,
    facilityId: resource?.facility_id || resource?.facilityId || null,
    programmeArea: resource?.programme_area || resource?.programmeArea || null,
  });
  if (allowed === null) {
    res.status(503).json({ error: 'Government authorization scopes are unavailable.' });
    return false;
  }
  if (!allowed) {
    res.status(403).json({ error: 'Access outside your assigned government scope is denied.' });
    return false;
  }
  return true;
}

async function accessibleJurisdictions(req, res) {
  const ids = await rbac.getAccessibleJurisdictionIds(req.user);
  if (ids === undefined) {
    res.status(503).json({ error: 'Government authorization scopes are unavailable.' });
    return undefined;
  }
  return ids;
}

// ─── Jurisdiction hierarchy ──────────────────────────────────────────────────

router.get(
  '/hierarchy',
  rbac.requireAnalystPlus,
  rbac.auditRequest('view', 'jurisdiction_hierarchy'),
  wrap(async (req, res) => {
    res.json(await svc.getJurisdictionHierarchy());
  })
);

router.get(
  '/jurisdictions/:id',
  rbac.requireAnalystPlus,
  wrap(async (req, res) => {
    const jur = await svc.getJurisdictionById(req.params.id);
    if (!jur) return res.status(404).json({ error: 'Jurisdiction not found.' });
    if (!(await ensureResourceScope(req, res, { jurisdictionId: jur.id }))) return;
    res.json({ jurisdiction: jur });
  })
);

// ─── Executive summary ───────────────────────────────────────────────────────

router.get(
  '/executive-summary',
  rbac.requireExecutiveView,
  rbac.auditRequest('view', 'executive_summary'),
  wrap(async (req, res) => {
    const jurisdictionIds = await accessibleJurisdictions(req, res);
    if (jurisdictionIds === undefined) return;
    res.json(await svc.getExecutiveSummary({ period: req.query.period, jurisdictionIds }));
  })
);

// ─── Programme spaces ────────────────────────────────────────────────────────

router.get(
  '/programme-spaces',
  rbac.requireAnalystPlus,
  wrap(async (req, res) => {
    const spaces = await svc.listProgrammeSpaces();
    res.json({ programmeSpaces: spaces });
  })
);

router.get(
  '/programme-spaces/:key',
  rbac.requireAnalystPlus,
  wrap(async (req, res) => {
    const space = await svc.getProgrammeSpace(req.params.key);
    if (!space) return res.status(404).json({ error: 'Programme space not found.' });
    res.json({ programmeSpace: space });
  })
);

// ─── Governance submissions ──────────────────────────────────────────────────

router.get(
  '/submissions',
  rbac.requireReviewer,
  rbac.auditRequest('view', 'governance_submissions'),
  wrap(async (req, res) => {
    const allowedJurisdictionIds = await accessibleJurisdictions(req, res);
    if (allowedJurisdictionIds === undefined) return;
    res.json(await svc.listSubmissions({
      status:         req.query.status,
      jurisdictionId: req.query.jurisdiction_id,
      period:         req.query.period,
      limit:          Number(req.query.limit) || 50,
      page:           Number(req.query.page)  || 1,
      allowedJurisdictionIds,
    }));
  })
);

router.post(
  '/submissions',
  rbac.requireAnalystPlus,
  wrap(async (req, res) => {
    const { reportId, facilityId, jurisdictionId, period, metadata } = req.body || {};
    if (!reportId || !period) {
      return res.status(422).json({ error: 'reportId and period are required.' });
    }
    if (!jurisdictionId) {
      return res.status(422).json({ error: 'jurisdictionId is required for an auditable government submission.' });
    }
    if (!(await ensureResourceScope(req, res, { jurisdictionId, facilityId }))) return;
    const submission = await svc.submitReport({
      reportId,
      facilityId:      facilityId      || null,
      submitterUserId: actor(req),
      jurisdictionId:  jurisdictionId  || null,
      period,
      metadata:        metadata        || {},
    });
    res.status(201).json({ submission });
  })
);

router.get(
  '/submissions/:id',
  rbac.requireAnalystPlus,
  rbac.auditRequest('view', 'governance_submission'),
  wrap(async (req, res) => {
    const sub = await svc.getSubmission(req.params.id);
    if (!sub) return res.status(404).json({ error: 'Submission not found.' });
    if (!(await ensureResourceScope(req, res, sub))) return;
    res.json({ submission: sub });
  })
);

/**
 * POST /submissions/:id/advance
 * Body: { targetStatus, notes }
 *
 * Role gates per targetStatus:
 *   area_council_review → reviewer+
 *   fcta_review         → reviewer+
 *   approved            → approver+
 *   rejected            → reviewer+
 *   dhis2_ready         → approver+
 *   exported            → export authority
 */
router.post(
  '/submissions/:id/advance',
  wrap(async (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Authentication required.' });

    const { targetStatus, notes } = req.body || {};
    if (!targetStatus) return res.status(422).json({ error: 'targetStatus is required.' });

    // Enforce per-target role gates using active jurisdiction assignments.
    const approverTargets = new Set(['approved', 'dhis2_ready']);
    const exporterTargets = new Set(['exported']);
    const reviewerTargets = new Set(['area_council_review', 'fcta_review', 'rejected', 'submitted']);

    const userId = actor(req);
    if (approverTargets.has(targetStatus)) {
      const allowed = await runGate(rbac.requireApprovalAuthority(), req, res);
      if (!allowed) return;
    }
    if (exporterTargets.has(targetStatus)) {
      const allowed = await runGate(rbac.requireExportAuthority(), req, res);
      if (!allowed) return;
    }
    if (reviewerTargets.has(targetStatus)) {
      const allowed = await runGate(rbac.requireReviewer, req, res);
      if (!allowed) return;
    }

    const existing = await svc.getSubmission(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Submission not found.' });
    if (!(await ensureResourceScope(req, res, existing))) return;

    const submission = await svc.advanceWorkflow({
      submissionId: req.params.id,
      actorUserId:  userId,
      targetStatus,
      notes,
      ip:        req.ip || null,
      userAgent: req.get('user-agent') || null,
    });

    res.json({ submission });
  })
);

router.get(
  '/submissions/:id/logs',
  rbac.requireReviewer,
  wrap(async (req, res) => {
    const submission = await svc.getSubmission(req.params.id);
    if (!submission) return res.status(404).json({ error: 'Submission not found.' });
    if (!(await ensureResourceScope(req, res, submission))) return;
    const logs = await svc.getWorkflowLogs(req.params.id);
    res.json({ logs });
  })
);

// ─── Audit lineage ───────────────────────────────────────────────────────────

router.get(
  '/audit-lineage',
  rbac.requirePlatformAdmin,
  wrap(async (req, res) => {
    res.json(await svc.getAuditLineage({
      actorUserId:  req.query.actor_user_id,
      action:       req.query.action,
      resourceType: req.query.resource_type,
      startDate:    req.query.start_date,
      endDate:      req.query.end_date,
      limit:        Number(req.query.limit) || 100,
      page:         Number(req.query.page)  || 1,
    }));
  })
);

// ─── User jurisdiction roles ─────────────────────────────────────────────────

router.get(
  '/user/:userId/roles',
  rbac.requirePlatformAdmin,
  wrap(async (req, res) => {
    const roles = await svc.listUserJurisdictionRoles(req.params.userId);
    res.json({ roles });
  })
);

router.post(
  '/user/:userId/roles',
  rbac.requirePlatformAdmin,
  wrap(async (req, res) => {
    const {
      jurisdictionId, role, facilityId, programmeArea,
      canExport, canApprove, canViewAggregate, dataClassLevel, expiresAt,
    } = req.body || {};

    if (!jurisdictionId || !role) {
      return res.status(422).json({ error: 'jurisdictionId and role are required.' });
    }

    const granted = await svc.grantJurisdictionRole({
      userId:            req.params.userId,
      jurisdictionId,
      role,
      facilityId:        facilityId        || null,
      programmeArea:     programmeArea     || null,
      canExport:         canExport         ?? false,
      canApprove:        canApprove        ?? false,
      canViewAggregate:  canViewAggregate  ?? true,
      dataClassLevel:    dataClassLevel    || 'aggregate',
      grantedBy:         actor(req),
      expiresAt:         expiresAt         || null,
    });
    rbac.invalidateScopeCache(req.params.userId);

    // Write audit lineage
    await svc.writeAuditLineage({
      actorUserId: actor(req),
      action: 'permission_grant',
      resourceType: 'user_jurisdiction_role',
      resourceId: granted.id,
      metadata: { targetUserId: req.params.userId, role, jurisdictionId },
    });

    res.status(201).json({ role: granted });
  })
);

router.delete(
  '/user/:userId/roles',
  rbac.requirePlatformAdmin,
  wrap(async (req, res) => {
    const { jurisdictionId, role } = req.body || {};
    if (!jurisdictionId || !role) {
      return res.status(422).json({ error: 'jurisdictionId and role are required.' });
    }
    await svc.revokeJurisdictionRole(req.params.userId, jurisdictionId, role);
    rbac.invalidateScopeCache(req.params.userId);

    await svc.writeAuditLineage({
      actorUserId: actor(req),
      action: 'permission_revoke',
      resourceType: 'user_jurisdiction_role',
      metadata: { targetUserId: req.params.userId, role, jurisdictionId },
    });

    res.json({ ok: true });
  })
);

// ─── Portal access tokens ────────────────────────────────────────────────────

router.post(
  '/portal-tokens',
  rbac.requirePlatformAdmin,
  wrap(async (req, res) => {
    const { label, portal, jurisdictionId, expiresAt } = req.body || {};
    if (!label || !portal) {
      return res.status(422).json({ error: 'label and portal are required.' });
    }
    const token = await svc.createPortalAccessToken({
      label,
      portal,
      jurisdictionId: jurisdictionId || null,
      createdBy:      actor(req),
      expiresAt:      expiresAt || null,
    });

    await svc.writeAuditLineage({
      actorUserId: actor(req),
      action: 'permission_grant',
      resourceType: 'portal_access_token',
      metadata: { label, portal },
    });

    res.status(201).json(token);
  })
);

module.exports = router;
