/**
 * Nigeria Region Router
 * Mounts all NG routes under /api/ng/
 * Does NOT modify any existing US routes
 */

const express = require('express');
const router = express.Router();

// Import NG routes
const discoveryRoutes = require('./discovery');
const pharmacyRoutes = require('./pharmacy');
const patientRoutes = require('./patient');
const adminRoutes = require('./admin');
const webhookRoutes = require('./webhooks');
const providerRoutes = require('./provider');
const organizationRoutes = require('./organization');
const hospitalRoutes = require('./hospital');
const subscriptionRoutes = require('./subscriptions');
const testingLinksRoutes = require('../../server/routes/testingLinks');
const publicHealthRoutes  = require('./publicHealth');
const dhis2Routes         = require('./dhis2');
const governanceRoutes    = require('./governance');
const executiveViewRoutes = require('./executiveView');
const governmentDataRoutes = require('./governmentData');
const referralNetworkRoutes = require('./referralNetwork');
const medicationsRoutes     = require('./medications');
const soapRoutes            = require('./soap');
const prescriptionsRoutes   = require('./prescriptions');
const conferenceRoutes      = require('./conference');
const clinicalRoutes        = require('./clinical');
const { getPool }           = require('../../server/db');
const rbac                  = require('../middleware/rbac');

let discoverySeedScheduled = false;

function scheduleDiscoverySeed() {
  if (discoverySeedScheduled || process.env.NG_AUTO_SEED_DISCOVERY === 'false') {
    return;
  }

  discoverySeedScheduled = true;
  const delayMs = parseInt(process.env.NG_AUTO_SEED_DELAY_MS, 10) || 15000;
  const timer = setTimeout(async () => {
    try {
      const { seedNigeriaDiscoveryIfNeeded } = require('../scripts/ingest-doctarx-nigeria-pack');
      const result = await seedNigeriaDiscoveryIfNeeded();
      console.log('[NG Discovery] Seed bootstrap result:', JSON.stringify(result));
    } catch (error) {
      console.error('[NG Discovery] Seed bootstrap skipped:', error.message);
    }
  }, delayMs);

  if (typeof timer.unref === 'function') {
    timer.unref();
  }
}

scheduleDiscoverySeed();

// Health check for NG region. Feature readiness is derived from the active
// database schema and external-provider configuration; it is not a static list
// of marketing claims.
router.get('/health', async (_req, res) => {
  const tables = {
    appointments: 'ng_appointments',
    clinicalEncounters: 'ng_clinical_encounters',
    soapNotes: 'ng_soap_notes',
    prescriptions: 'ng_prescriptions',
    pharmacies: 'ng_pharmacies',
    referrals: 'ng_referrals',
    conferenceRooms: 'ng_conf_rooms',
    publicHealthIndicators: 'public_health_indicators',
    publicHealthReports: 'public_health_reports',
    jurisdictions: 'ng_jurisdictions',
    jurisdictionRoles: 'ng_user_jurisdiction_roles',
    governanceSubmissions: 'ng_governance_submissions',
    auditLineage: 'ng_audit_lineage',
    governmentDataSources: 'ng_government_data_sources',
    governmentImportBatches: 'ng_government_import_batches',
    governmentImportRows: 'ng_government_import_rows',
    dataQualityFindings: 'ng_data_quality_findings',
    governmentSourceFiles: 'ng_government_source_files',
    governmentDataMappings: 'ng_government_data_mappings',
    governmentQuarantine: 'ng_government_quarantined_records',
    governmentImportDecisions: 'ng_government_import_decisions',
    governmentReconciliations: 'ng_government_import_reconciliations',
    governmentLineage: 'ng_government_import_lineage',
    governmentRecords: 'ng_government_records',
    indicatorObservations: 'ng_indicator_observations',
    governmentSavedViews: 'ng_government_saved_views',
    governmentRecentSearches: 'ng_government_recent_searches',
    governmentAccountInvitations: 'ng_government_account_invitations',
    dhis2Settings: 'dhis2_integration_settings',
  };
  const schema = Object.fromEntries(Object.keys(tables).map((key) => [key, false]));
  let database = { healthy: false, error: 'Database readiness check did not run.' };
  let dhis2 = { schemaReady: false, enabled: false, dryRunOnly: true, approvalsComplete: false };

  try {
    const pool = getPool();
    const expressions = Object.entries(tables).map(
      ([key, table]) => `to_regclass('public.${table}') IS NOT NULL AS "${key}"`
    );
    const result = await pool.query(`SELECT ${expressions.join(', ')}`);
    Object.assign(schema, result.rows[0] || {});
    database = { healthy: true };

    if (schema.dhis2Settings) {
      const settings = await pool.query(
        `SELECT enabled, dry_run_only,
                government_approval_status = 'approved'
                  AND data_sharing_agreement_status = 'approved'
                  AND api_credentials_status = 'configured' AS approvals_complete
           FROM dhis2_integration_settings
          ORDER BY updated_at DESC
          LIMIT 1`
      );
      const row = settings.rows[0] || {};
      dhis2 = {
        schemaReady: true,
        enabled: row.enabled === true,
        dryRunOnly: row.dry_run_only !== false,
        approvalsComplete: row.approvals_complete === true,
      };
    }
  } catch (error) {
    console.error('[NG health] Database readiness check failed:', error.message);
    database = { healthy: false, error: 'Database readiness check failed.' };
  }

  const clinicalEmr = schema.clinicalEncounters && schema.soapNotes && schema.prescriptions;
  const governmentDataPlatform = schema.publicHealthIndicators && schema.publicHealthReports &&
    schema.jurisdictions && schema.jurisdictionRoles && schema.governanceSubmissions && schema.auditLineage &&
    schema.governmentDataSources && schema.governmentImportBatches && schema.governmentImportRows &&
    schema.dataQualityFindings && schema.governmentSourceFiles && schema.governmentDataMappings &&
    schema.governmentQuarantine && schema.governmentImportDecisions && schema.governmentReconciliations &&
    schema.governmentLineage && schema.governmentRecords && schema.indicatorObservations &&
    schema.governmentSavedViews && schema.governmentRecentSearches && schema.governmentAccountInvitations;
  const ready = database.healthy && clinicalEmr && governmentDataPlatform;
  const liveKitConfigured = Boolean(
    process.env.NG_LIVEKIT_URL && process.env.NG_LIVEKIT_API_KEY && process.env.NG_LIVEKIT_API_SECRET
  );
  const turnConfigured = Boolean(process.env.TURN_SHARED_SECRET || process.env.NG_TURN_SHARED_SECRET);

  res.status(ready ? 200 : 503).json({
    status: ready ? 'ok' : 'degraded',
    region: 'NG',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    database,
    features: {
      pharmacy: schema.pharmacies,
      digitalPrescriptions: schema.prescriptions,
      appointments: schema.appointments,
      publicHealthIntelligence: schema.publicHealthIndicators && schema.publicHealthReports,
      federatedGovernance: schema.jurisdictions && schema.jurisdictionRoles && schema.governanceSubmissions && schema.auditLineage,
      executiveCommandCenter: schema.publicHealthReports && schema.governanceSubmissions,
      governmentDataPlatform,
      dhis2Readiness: dhis2,
      referralNetwork: schema.referrals,
      multiPartyConferencing: {
        schemaReady: schema.conferenceRooms,
        liveKitConfigured,
        turnConfigured,
      },
      clinicalEmr,
    },
    schema,
    policyNotice: 'Technical readiness does not constitute legal, clinical, NDPR, or government approval.',
  });
});

// Medication search v2 (public — no PHI)
router.use('/medications', medicationsRoutes);

// SOAP templates (read-only, no PHI)
router.use('/soap', soapRoutes);

// Referral network: /public/* is unauthenticated (QR slip verify),
// everything else requires authentication. Closure resolves `authenticate`
// at request time, so its TDZ at module-load time is fine here.
const referralNetworkAuth = (req, res, next) => {
  if (req.path.startsWith('/public/')) return next();
  return authenticate(req, res, next);
};
router.use('/referral-network', referralNetworkAuth, referralNetworkRoutes);

// Conference: /public/redeem-invite is unauthenticated, everything else
// requires auth. Same selective-auth pattern as referral-network.
const conferenceAuth = (req, res, next) => {
  if (req.path.startsWith('/public/')) return next();
  return authenticate(req, res, next);
};
router.use('/conference', conferenceAuth, conferenceRoutes);

// Auth middleware (reuse existing)
let authenticate;
try {
  const authMiddleware = require('../../server/middleware/auth');
  authenticate = authMiddleware.authenticate || authMiddleware;
} catch (e) {
  // Fallback: simple JWT verification
  const jwt = require('jsonwebtoken');
  authenticate = (req, res, next) => {
    const token = req.headers.authorization?.replace('Bearer ', '') ||
      req.cookies?.accessToken;
    if (!token) return res.status(401).json({ error: 'Authentication required' });
    try {
      req.user = jwt.verify(token, process.env.JWT_ACCESS_SECRET);
      next();
    } catch (err) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }
  };
}

// Admin-only middleware
const requireAdmin = (req, res, next) => {
  if (!['admin', 'super_admin'].includes(req.user?.role)) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
};

// Mount routes
router.use('/discovery', discoveryRoutes);
router.use('/clinical', authenticate, clinicalRoutes);
router.use('/pharmacy', authenticate, pharmacyRoutes);
router.use('/prescriptions', authenticate, prescriptionsRoutes);
// These routers enforce their own government RBAC/ABAC policies per route.
// A generic admin gate here would incorrectly reject jurisdiction-scoped
// analysts, reviewers, approvers, programme managers, and executives before
// the granular authorization layer can evaluate their assigned scope.
router.use('/public-health', authenticate, rbac.requireGovernmentMfa, publicHealthRoutes);
router.use('/integrations/dhis2', authenticate, rbac.requireGovernmentMfa, dhis2Routes);
router.use('/governance', authenticate, rbac.requireGovernmentMfa, governanceRoutes);
const governmentDataAuth = (req, res, next) => {
  if (req.path === '/public/accept-invitation') return next();
  return authenticate(req, res, () => rbac.requireGovernmentMfa(req, res, next));
};
router.use('/government-data', governmentDataAuth, governmentDataRoutes);
router.use('/executive-view', authenticate, rbac.requireGovernmentMfa, executiveViewRoutes);
router.use('/patient', authenticate, patientRoutes);
router.use('/admin/testing-links', authenticate, requireAdmin, testingLinksRoutes);
router.use('/admin', authenticate, requireAdmin, adminRoutes);
router.use('/webhooks', webhookRoutes); // No auth — signature verified per endpoint
router.use('/providers', providerRoutes);          // public listing + protected profile
router.use('/organizations', organizationRoutes);  // registration public; management protected
router.use('/hospitals', hospitalRoutes);           // registration public; management protected
router.use('/subscriptions', subscriptionRoutes);  // plan listing public; management protected

// Feature flags endpoint
router.get('/features', async (req, res) => {
  try {
    const { getPool } = require('../../server/db');
    const pool = getPool();
    const result = await pool.query(
      'SELECT feature_key, display_name, status, required_plan, required_role FROM ng_feature_flags ORDER BY feature_key'
    );
    res.json({ flags: result.rows });
  } catch (err) {
    res.json({ flags: [], error: 'Feature flags unavailable' });
  }
});

module.exports = router;
