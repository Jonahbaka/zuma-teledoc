/**
 * Nigeria Admin Routes
 * Platform analytics, pharmacy approval, fraud detection, revenue tracking
 */

const express = require('express');
const router = express.Router();
const pharmacyOnboardingService = require('../services/pharmacy/pharmacyOnboardingService');
const complianceService = require('../services/compliance/complianceService');
const { getPool } = require('../../server/db');

// --- PHARMACY MANAGEMENT ---

// List pharmacies pending approval
router.get('/pharmacies/pending', async (req, res) => {
  try {
    const result = await pharmacyOnboardingService.listPendingPharmacies(
      parseInt(req.query.page) || 1, parseInt(req.query.limit) || 20
    );
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Approve/reject pharmacy
router.post('/pharmacies/:pharmacyId/verify', async (req, res) => {
  try {
    const { approved, rejectionReason } = req.body;
    const result = await pharmacyOnboardingService.verifyPharmacy(
      req.params.pharmacyId, req.user.id, approved, rejectionReason
    );
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Suspend pharmacy
router.post('/pharmacies/:pharmacyId/suspend', async (req, res) => {
  try {
    const pool = getPool();
    await pool.query(
      `UPDATE ng_pharmacies SET status = 'suspended', updated_at = NOW() WHERE id = $1`,
      [req.params.pharmacyId]
    );
    await complianceService.logAction({
      actorUserId: req.user.id,
      actorType: 'admin',
      action: 'pharmacy.suspended',
      resourceType: 'pharmacy',
      resourceId: req.params.pharmacyId,
      details: { reason: req.body.reason },
      complianceFlags: ['PCN'],
      severity: 'critical',
      pharmacyId: req.params.pharmacyId,
    });
    res.json({ status: 'suspended' });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// List all pharmacies
router.get('/pharmacies', async (req, res) => {
  try {
    const pool = getPool();
    const { page = 1, limit = 20, status, state, search } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    let sql = `SELECT p.*, u.email as owner_email,
                (SELECT COUNT(*) FROM ng_orders WHERE pharmacy_id = p.id) as order_count,
                (SELECT COALESCE(SUM(total_amount), 0) FROM ng_orders WHERE pharmacy_id = p.id AND payment_status = 'completed') as total_revenue
               FROM ng_pharmacies p
               LEFT JOIN users u ON u.id = p.owner_user_id WHERE 1=1`;
    const params = [];

    if (status) {
      params.push(status);
      sql += ` AND p.status = $${params.length}`;
    }
    if (state) {
      params.push(state);
      sql += ` AND p.state = $${params.length}`;
    }
    if (search) {
      params.push(`%${search}%`);
      sql += ` AND (LOWER(p.name) LIKE LOWER($${params.length}) OR p.pcn_license_number LIKE $${params.length})`;
    }

    sql += ` ORDER BY p.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(parseInt(limit), offset);

    const result = await pool.query(sql, params);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- PLATFORM ANALYTICS ---

// Dashboard overview
router.get('/analytics/dashboard', async (req, res) => {
  try {
    const pool = getPool();

    const [
      pharmacyStats, orderStats, revenueStats, userStats
    ] = await Promise.all([
      pool.query(`
        SELECT
          COUNT(*) FILTER (WHERE status = 'approved') as active_pharmacies,
          COUNT(*) FILTER (WHERE status IN ('pending_review','documents_submitted','under_verification')) as pending_pharmacies,
          COUNT(*) FILTER (WHERE status = 'suspended') as suspended_pharmacies,
          COUNT(*) as total_pharmacies
        FROM ng_pharmacies
      `),
      pool.query(`
        SELECT
          COUNT(*) as total_orders,
          COUNT(*) FILTER (WHERE status = 'delivered') as delivered_orders,
          COUNT(*) FILTER (WHERE status = 'cancelled') as cancelled_orders,
          COUNT(*) FILTER (WHERE created_at >= CURRENT_DATE) as today_orders,
          COUNT(*) FILTER (WHERE created_at >= date_trunc('month', CURRENT_DATE)) as month_orders,
          COALESCE(SUM(total_amount) FILTER (WHERE payment_status = 'completed'), 0) as total_gmv
        FROM ng_orders
      `),
      pool.query(`
        SELECT
          COALESCE(SUM(rx_fee_revenue), 0) as total_rx_fees,
          COALESCE(SUM(subscription_revenue), 0) as total_subscription_revenue,
          COALESCE(SUM(delivery_markup_revenue), 0) as total_delivery_revenue,
          COALESCE(SUM(margin_share_revenue), 0) as total_margin_share,
          COALESCE(SUM(total_gmv), 0) as platform_gmv
        FROM ng_platform_revenue
      `),
      pool.query(`
        SELECT COUNT(*) as total_ng_users
        FROM users WHERE region = 'NG'
      `),
    ]);

    res.json({
      pharmacies: pharmacyStats.rows[0],
      orders: orderStats.rows[0],
      revenue: revenueStats.rows[0],
      users: userStats.rows[0],
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Revenue over time
router.get('/analytics/revenue', async (req, res) => {
  try {
    const pool = getPool();
    const { period = '30d' } = req.query;
    const days = period === '7d' ? 7 : period === '90d' ? 90 : 30;

    const result = await pool.query(
      `SELECT date,
              SUM(rx_fee_revenue) as rx_fees,
              SUM(subscription_revenue) as subscriptions,
              SUM(delivery_markup_revenue) as delivery_markup,
              SUM(margin_share_revenue) as margin_share,
              SUM(total_orders) as orders,
              SUM(total_gmv) as gmv
       FROM ng_platform_revenue
       WHERE date >= CURRENT_DATE - INTERVAL '${days} days'
       GROUP BY date
       ORDER BY date ASC`
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Top pharmacies
router.get('/analytics/top-pharmacies', async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.query(
      `SELECT p.id, p.name, p.city, p.state, p.rating,
              COUNT(o.id) as order_count,
              COALESCE(SUM(o.total_amount) FILTER (WHERE o.payment_status = 'completed'), 0) as revenue
       FROM ng_pharmacies p
       LEFT JOIN ng_orders o ON o.pharmacy_id = p.id
       WHERE p.status = 'approved'
       GROUP BY p.id, p.name, p.city, p.state, p.rating
       ORDER BY revenue DESC
       LIMIT 20`
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- COMPLIANCE ---

// Platform-wide audit log
router.get('/compliance/audit-log', async (req, res) => {
  try {
    const pool = getPool();
    const { page = 1, limit = 50, action, severity, pharmacyId } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    let sql = 'SELECT * FROM ng_compliance_audit_log WHERE 1=1';
    const params = [];

    if (action) { params.push(action); sql += ` AND action = $${params.length}`; }
    if (severity) { params.push(severity); sql += ` AND severity = $${params.length}`; }
    if (pharmacyId) { params.push(pharmacyId); sql += ` AND pharmacy_id = $${params.length}`; }

    sql += ` ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(parseInt(limit), offset);

    const result = await pool.query(sql, params);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Run expired inventory check
router.post('/compliance/check-expired', async (req, res) => {
  try {
    const result = await complianceService.checkExpiredInventory();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- FRAUD DETECTION ---

// Suspicious activity report
router.get('/fraud/suspicious', async (req, res) => {
  try {
    const pool = getPool();

    // Flag pharmacies with unusual patterns
    const suspicious = await pool.query(`
      SELECT p.id, p.name, p.city,
        -- High cancellation rate
        COUNT(o.id) FILTER (WHERE o.status = 'cancelled') as cancelled_orders,
        COUNT(o.id) as total_orders,
        CASE WHEN COUNT(o.id) > 0
          THEN (COUNT(o.id) FILTER (WHERE o.status = 'cancelled')::decimal / COUNT(o.id) * 100)
          ELSE 0 END as cancellation_rate,
        -- Unusual pricing (>200% markup)
        (SELECT COUNT(*) FROM ng_pharmacy_inventory i WHERE i.pharmacy_id = p.id AND i.markup_percent > 200) as overpriced_items
      FROM ng_pharmacies p
      LEFT JOIN ng_orders o ON o.pharmacy_id = p.id
      WHERE p.status = 'approved'
      GROUP BY p.id, p.name, p.city
      HAVING (
        CASE WHEN COUNT(o.id) > 5
          THEN (COUNT(o.id) FILTER (WHERE o.status = 'cancelled')::decimal / COUNT(o.id) * 100) > 30
          ELSE false END
      ) OR (
        SELECT COUNT(*) FROM ng_pharmacy_inventory i WHERE i.pharmacy_id = p.id AND i.markup_percent > 200
      ) > 5
      ORDER BY cancellation_rate DESC
    `);

    res.json(suspicious.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
