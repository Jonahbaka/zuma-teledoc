'use strict';

/**
 * ng/routes/executiveView.js
 * Executive Command Center API — /api/ng/executive-view
 *
 * Read-only aggregate views for ministry-grade executive access.
 * All endpoints require executive_read_only or higher.
 * No patient identifiers exposed. All data is aggregate only.
 *
 * Routes:
 *   GET /dashboard        — full executive command-center payload
 *   GET /kpis             — core KPI set
 *   GET /trends           — multi-metric trend series (7d / 14d / 30d / 90d)
 *   GET /signals          — early operational signals
 *   GET /forecasts        — demand forecasts across all metric keys
 *   GET /facility-map     — geographic facility intelligence
 *   GET /referral-flow    — referral movement intelligence
 *   GET /programme-health — programme readiness by programme space
 *   GET /governance-status — governance workflow status summary
 */

const express = require('express');
const rbac    = require('../middleware/rbac');
const phSvc   = require('../services/public-health/publicHealthProgrammeService');
const govSvc  = require('../services/public-health/governanceService');

const router = express.Router();

// ─── Error boundary ──────────────────────────────────────────────────────────

function wrap(fn) {
  return async (req, res) => {
    try {
      await fn(req, res);
    } catch (err) {
      const status = err.status || err.statusCode || 500;
      res.status(status).json({
        error: status === 500 ? 'Executive view request failed.' : err.message,
      });
    }
  };
}

// All routes require at least executive_read_only
router.use(rbac.requireExecutiveView);

// ─── Dashboard (full payload) ────────────────────────────────────────────────

router.get(
  '/dashboard',
  rbac.auditRequest('view', 'executive_dashboard'),
  wrap(async (req, res) => {
    const period = req.query.period;
    const [executive, governance] = await Promise.all([
      phSvc.getExecutiveDashboard({ period }),
      govSvc.getExecutiveSummary({ period }),
    ]);
    res.json({
      executive,
      governance,
      generatedAt: new Date().toISOString(),
      dataNote: 'All data is aggregate. No patient identifiers are included.',
    });
  })
);

// ─── KPI snapshot ────────────────────────────────────────────────────────────

router.get(
  '/kpis',
  wrap(async (req, res) => {
    const period = req.query.period;
    const exec = await phSvc.getExecutiveDashboard({ period });
    const kpiSections = exec.kpiSections || exec.sections || [];

    res.json({
      period:      exec.period,
      kpiSections,
      generatedAt: new Date().toISOString(),
    });
  })
);

// ─── Multi-metric trend series ────────────────────────────────────────────────

const ALLOWED_TREND_METRICS = new Set([
  'consultations', 'teleconsultations', 'referrals', 'prescriptions',
  'lab_referrals', 'pharmacy_referrals', 'registrations', 'followups',
]);

router.get(
  '/trends',
  wrap(async (req, res) => {
    const metrics = String(req.query.metrics || 'consultations,teleconsultations')
      .split(',')
      .map((m) => m.trim())
      .filter((m) => ALLOWED_TREND_METRICS.has(m))
      .slice(0, 6);  // cap to 6 series

    const days = Math.min(Math.max(Number(req.query.days) || 90, 7), 180);

    const series = await Promise.all(
      metrics.map(async (metric) => {
        const data = await phSvc.getChartData({ metric, days });
        return { metric, data };
      })
    );

    res.json({ days, series, generatedAt: new Date().toISOString() });
  })
);

// ─── Early operational signals ────────────────────────────────────────────────

router.get(
  '/signals',
  wrap(async (req, res) => {
    const period = req.query.period;
    const exec = await phSvc.getExecutiveDashboard({ period });
    res.json({
      period:            exec.period,
      earlySignals:      exec.complaint?.earlySignals || [],
      planningSignals:   exec.planningSignals || [],
      leadershipActions: exec.leadershipActionItems || [],
      generatedAt:       new Date().toISOString(),
    });
  })
);

// ─── Demand forecasts ────────────────────────────────────────────────────────

const FORECAST_METRICS = [
  'consultations', 'teleconsultations', 'referrals',
  'prescriptions', 'lab_referrals', 'followups',
];
const FORECAST_RANGES = [7, 14, 30];

router.get(
  '/forecasts',
  rbac.auditRequest('view', 'executive_forecasts'),
  wrap(async (req, res) => {
    const period = req.query.period;

    const forecasts = await Promise.all(
      FORECAST_METRICS.flatMap((metric) =>
        FORECAST_RANGES.map(async (range) => {
          const result = await phSvc.getForecast({ metric, range, persist: false });
          return { metric, range, ...result };
        })
      )
    );

    res.json({
      period:      period || null,
      forecasts,
      disclaimer:  'Forecasts are operational planning signals only. They are not outbreak predictions.',
      generatedAt: new Date().toISOString(),
    });
  })
);

// ─── Facility map intelligence ────────────────────────────────────────────────

router.get(
  '/facility-map',
  rbac.auditRequest('view', 'executive_facility_map'),
  wrap(async (req, res) => {
    const period = req.query.period;
    const exec = await phSvc.getExecutiveDashboard({ period });
    res.json({
      period:              exec.period,
      facilityMapPoints:   exec.facility?.facilityMapPoints    || [],
      facilityTypeBreakdown: exec.facility?.facilityTypeBreakdown || [],
      lgaBreakdown:        exec.facility?.lgaBreakdown          || [],
      mapReadiness:        exec.facility?.mapReadiness           || 'pending',
      generatedAt:         new Date().toISOString(),
    });
  })
);

// ─── Referral flow intelligence ──────────────────────────────────────────────

router.get(
  '/referral-flow',
  wrap(async (req, res) => {
    const period = req.query.period;
    const exec = await phSvc.getExecutiveDashboard({ period });
    res.json({
      period:                  exec.period,
      topReferralDestinations: exec.referrals?.topReferralDestinations  || [],
      referralStatusBreakdown: exec.referrals?.referralStatusBreakdown  || [],
      referralLeakage:         exec.referrals?.cancelledReferrals        || 0,
      avgCompletionHours:      exec.referrals?.averageReferralCompletionHours || null,
      generatedAt:             new Date().toISOString(),
    });
  })
);

// ─── Programme space health ───────────────────────────────────────────────────

router.get(
  '/programme-health',
  wrap(async (req, res) => {
    const [programmeSpaces, exec] = await Promise.all([
      govSvc.listProgrammeSpaces(),
      phSvc.getExecutiveDashboard({ period: req.query.period }),
    ]);

    const programmeAreas = exec.areas || [];

    const health = programmeSpaces.map((space) => {
      const area = programmeAreas.find((a) => a.key === space.programme_key);
      return {
        programmeKey:  space.programme_key,
        displayName:   space.display_name,
        tier:          space.tier,
        readinessScore: area?.readinessScore ?? null,
        status:        area?.status          ?? 'not_configured',
        metricsSummary: area?.metricsSummary ?? null,
      };
    });

    res.json({ programmes: health, generatedAt: new Date().toISOString() });
  })
);

// ─── Governance status ────────────────────────────────────────────────────────

router.get(
  '/governance-status',
  rbac.auditRequest('view', 'governance_status'),
  wrap(async (req, res) => {
    const summary = await govSvc.getExecutiveSummary({ period: req.query.period });
    res.json(summary);
  })
);

module.exports = router;
