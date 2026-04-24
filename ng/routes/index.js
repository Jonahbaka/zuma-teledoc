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

// Health check for NG region
router.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    region: 'NG',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    features: {
      pharmacy: true,
      rxEngine: true,
      payments: { paystack: true, flutterwave: true },
      delivery: true,
      compliance: { pcn: true, ndpa: true, nafdac: true },
      providers: true,
      organizations: true,
      hospitals: true,
      subscriptions: true,
      digitalPrescriptions: true,
      appointments: true,
    },
  });
});

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
router.use('/pharmacy', authenticate, pharmacyRoutes);
router.use('/patient', authenticate, patientRoutes);
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
