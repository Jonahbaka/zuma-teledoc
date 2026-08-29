/**
 * Nigeria Admin Routes
 * Platform analytics, pharmacy approval, fraud detection, revenue tracking
 */

const express = require('express');
const router = express.Router();
const pharmacyOnboardingService = require('../services/pharmacy/pharmacyOnboardingService');
const complianceService = require('../services/compliance/complianceService');
const { getPool } = require('../../server/db');
const { requireSuperAdmin } = require('../../server/middleware/auth');
const {
  createAdminTestAccount,
  listAdminTestAccounts,
  updateAdminTestAccountLifecycle,
} = require('../../server/services/adminTestAccountService');

// --- TEST ACCOUNT MANAGEMENT ---

router.get('/test-accounts', requireSuperAdmin, async (req, res) => {
  return listAdminTestAccounts(req, res, { marketScope: 'NG' });
});

router.post('/test-accounts', requireSuperAdmin, async (req, res) => {
  return createAdminTestAccount(req, res, { marketScope: 'NG' });
});

router.patch('/test-accounts/:id', requireSuperAdmin, async (req, res) => {
  const action = req.body?.action === 'delete'
    ? 'delete'
    : req.body?.action === 'restore'
      ? 'restore'
      : 'revoke';
  return updateAdminTestAccountLifecycle(req, res, { marketScope: 'NG', action });
});

router.delete('/test-accounts/:id', requireSuperAdmin, async (req, res) => {
  return updateAdminTestAccountLifecycle(req, res, { marketScope: 'NG', action: 'delete' });
});


function parsePagination(query = {}) {
  const limit = Math.min(Math.max(parseInt(query.limit, 10) || 25, 1), 100);
  const page = Math.max(parseInt(query.page, 10) || 1, 1);
  return { limit, page, offset: (page - 1) * limit };
}

function addNigeriaUserScope(where, params) {
  where.push(`(
    COALESCE(u.market_scope, 'US') = 'NG'
    OR u.region::text = 'NG'
    OR UPPER(COALESCE(u.country, '')) IN ('NG', 'NIGERIA')
  )`);
  return { where, params };
}

function isQueryEnabled(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').toLowerCase());
}

function getActorUserId(user = {}) {
  return user.id || user.userId || user.sub || null;
}

const MEDICINE_SOURCE_STATUSES = new Set(['approved', 'reference_only', 'needs_admin_review', 'unsupported', 'disabled']);

// Medication availability requests created from /ng/medicines.
router.get('/medication-requests', async (req, res) => {
  try {
    const pool = getPool();
    const { limit, page, offset } = parsePagination(req.query);
    const params = [];
    const where = [];

    if (req.query.status) {
      params.push(String(req.query.status).trim());
      where.push(`r.status = $${params.length}`);
    }

    if (req.query.query) {
      params.push(`%${String(req.query.query).trim()}%`);
      where.push(`(
        r.medicine_name ILIKE $${params.length}
        OR r.generic_name ILIKE $${params.length}
        OR r.phone ILIKE $${params.length}
        OR r.email ILIKE $${params.length}
      )`);
    }

    if (req.query.fulfillmentPreference) {
      params.push(String(req.query.fulfillmentPreference).trim());
      where.push(`r.fulfillment_preference = $${params.length}`);
    }

    const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const countResult = await pool.query(`SELECT COUNT(*) FROM ng_medication_requests r ${whereClause}`, params);

    params.push(limit, offset);
    const result = await pool.query(
      `SELECT r.*,
              d.source AS catalog_source,
              d.source_name,
              d.source_type,
              d.source_reference,
              d.source_quality_status,
              preferred.name AS preferred_pharmacy_name,
              assigned.name AS assigned_pharmacy_name
         FROM ng_medication_requests r
         LEFT JOIN ng_drug_catalog d ON d.id = r.medicine_catalog_id
         LEFT JOIN ng_pharmacies preferred ON preferred.id = r.preferred_pharmacy_id
         LEFT JOIN ng_pharmacies assigned ON assigned.id = r.assigned_pharmacy_id
         ${whereClause}
        ORDER BY r.created_at DESC
        LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    res.json({
      requests: result.rows,
      pagination: {
        page,
        limit,
        total: Number(countResult.rows[0]?.count || 0),
      },
    });
  } catch (err) {
    const status = err.code === '42703' || err.code === '42P01' ? 503 : 500;
    res.status(status).json({
      error: status === 503 ? 'Nigeria medication request tables are not migrated yet.' : err.message,
    });
  }
});

router.patch('/medication-requests/:requestId', async (req, res) => {
  try {
    const allowedStatuses = new Set([
      'pending_pharmacy_confirmation',
      'pharmacy_reviewing',
      'available',
      'unavailable',
      'clarification_requested',
      'fulfilled',
      'completed',
      'cancelled',
    ]);
    const nextStatus = req.body.status ? String(req.body.status).trim() : null;

    if (nextStatus && !allowedStatuses.has(nextStatus)) {
      return res.status(400).json({ error: 'Unsupported medication request status.' });
    }

    const pool = getPool();
    const updates = [];
    const values = [];

    if (nextStatus) {
      values.push(nextStatus);
      updates.push(`status = $${values.length}`);
    }

    if (req.body.assignedPharmacyId !== undefined) {
      values.push(req.body.assignedPharmacyId || null);
      updates.push(`assigned_pharmacy_id = $${values.length}`);
    }

    if (req.body.adminNotes !== undefined) {
      values.push(req.body.adminNotes || null);
      updates.push(`admin_notes = $${values.length}`);
    }

    if (req.body.confirmedPriceNgn !== undefined) {
      const confirmedPrice = req.body.confirmedPriceNgn === '' || req.body.confirmedPriceNgn === null
        ? null
        : Number(req.body.confirmedPriceNgn);
      if (confirmedPrice !== null && !Number.isFinite(confirmedPrice)) {
        return res.status(400).json({ error: 'Confirmed price must be a number.' });
      }
      values.push(confirmedPrice);
      updates.push(`confirmed_price_ngn = $${values.length}`);
    }

    if (req.body.pharmacyNotes !== undefined) {
      values.push(req.body.pharmacyNotes || null);
      updates.push(`pharmacy_notes = $${values.length}`);
    }

    if (req.body.clarificationRequest !== undefined) {
      values.push(req.body.clarificationRequest || null);
      updates.push(`clarification_request = $${values.length}`);
    }

    if (!updates.length) {
      return res.status(400).json({ error: 'No medication request updates supplied.' });
    }

    updates.push('updated_at = NOW()');
    values.push(req.params.requestId);

    const result = await pool.query(
      `UPDATE ng_medication_requests
          SET ${updates.join(', ')}
        WHERE id = $${values.length}
        RETURNING *`,
      values
    );

    if (!result.rows.length) {
      return res.status(404).json({ error: 'Medication request not found.' });
    }

    res.json({ request: result.rows[0] });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Medication source audit and catalog quality controls.
router.get('/medicines', async (req, res) => {
  try {
    const pool = getPool();
    const { limit, page, offset } = parsePagination(req.query);
    const params = [];
    const where = [];

    if (req.query.query) {
      params.push(`%${String(req.query.query).trim()}%`);
      where.push(`(
        d.name ILIKE $${params.length}
        OR d.generic_name ILIKE $${params.length}
        OR d.brand_name ILIKE $${params.length}
        OR d.source_name ILIKE $${params.length}
        OR d.source_reference ILIKE $${params.length}
      )`);
    }

    if (req.query.sourceQualityStatus) {
      params.push(String(req.query.sourceQualityStatus).trim());
      where.push(`COALESCE(d.source_quality_status, 'needs_admin_review') = $${params.length}`);
    }

    if (isQueryEnabled(req.query.disabled)) {
      where.push('d.disabled_at IS NOT NULL');
    }

    if (isQueryEnabled(req.query.unsupported)) {
      where.push('COALESCE(d.is_supported, false) = false');
    }

    if (isQueryEnabled(req.query.supported)) {
      where.push('COALESCE(d.is_supported, false) = true AND d.disabled_at IS NULL');
    }

    const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const countResult = await pool.query(`SELECT COUNT(*) FROM ng_drug_catalog d ${whereClause}`, params);

    params.push(limit, offset);
    const result = await pool.query(
      `SELECT d.id,
              d.name,
              d.generic_name,
              d.brand_name,
              d.dosage_form,
              d.strength,
              d.requires_prescription,
              d.nhia_listed,
              d.featured_category,
              d.source,
              d.source_name,
              d.source_type,
              d.source_reference,
              d.source_url,
              d.source_quality_status,
              d.source_verified_at,
              d.is_supported,
              d.disabled_at,
              d.disabled_reason,
              d.admin_review_notes,
              COALESCE(verified.verified_inventory_count, 0) AS verified_inventory_count,
              COALESCE(requests.request_count, 0) AS request_count,
              d.updated_at
         FROM ng_drug_catalog d
         LEFT JOIN LATERAL (
           SELECT COUNT(*)::INTEGER AS verified_inventory_count
             FROM ng_pharmacy_inventory i
            WHERE i.drug_id = d.id
              AND i.is_available = true
              AND i.quantity_available > 0
              AND i.availability_verification_status = 'verified'
              AND i.availability_verified_at IS NOT NULL
         ) verified ON TRUE
         LEFT JOIN LATERAL (
           SELECT COUNT(*)::INTEGER AS request_count
             FROM ng_medication_requests r
            WHERE r.medicine_catalog_id = d.id
         ) requests ON TRUE
         ${whereClause}
        ORDER BY d.disabled_at NULLS FIRST,
                 COALESCE(d.source_quality_status, 'needs_admin_review') ASC,
                 d.updated_at DESC NULLS LAST,
                 d.name ASC
        LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    res.json({
      medicines: result.rows,
      pagination: {
        page,
        limit,
        total: Number(countResult.rows[0]?.count || 0),
      },
    });
  } catch (err) {
    const status = err.code === '42703' || err.code === '42P01' ? 503 : 500;
    res.status(status).json({
      error: status === 503 ? 'Nigeria medication catalog quality columns are not migrated yet.' : err.message,
    });
  }
});

router.patch('/medicines/:medicineId', requireSuperAdmin, async (req, res) => {
  try {
    const pool = getPool();
    const updates = [];
    const values = [];
    let nextStatus = req.body.sourceQualityStatus ? String(req.body.sourceQualityStatus).trim() : null;

    if (nextStatus && !MEDICINE_SOURCE_STATUSES.has(nextStatus)) {
      return res.status(400).json({ error: 'Unsupported medicine source quality status.' });
    }

    if (req.body.disabled === true) {
      nextStatus = nextStatus || 'disabled';
      values.push(new Date());
      updates.push(`disabled_at = $${values.length}`);
      values.push(getActorUserId(req.user));
      updates.push(`disabled_by = $${values.length}`);
      values.push(req.body.disabledReason || 'Disabled by Nigeria admin source review.');
      updates.push(`disabled_reason = $${values.length}`);
      values.push(false);
      updates.push(`is_supported = $${values.length}`);
    } else if (req.body.disabled === false) {
      values.push(null);
      updates.push(`disabled_at = $${values.length}`);
      values.push(null);
      updates.push(`disabled_by = $${values.length}`);
      values.push(null);
      updates.push(`disabled_reason = $${values.length}`);
    }

    if (nextStatus) {
      values.push(nextStatus);
      updates.push(`source_quality_status = $${values.length}`);
    }

    if (req.body.isSupported !== undefined) {
      values.push(Boolean(req.body.isSupported));
      updates.push(`is_supported = $${values.length}`);
    }

    if (req.body.adminReviewNotes !== undefined) {
      values.push(req.body.adminReviewNotes || null);
      updates.push(`admin_review_notes = $${values.length}`);
    }

    if (!updates.length) {
      return res.status(400).json({ error: 'No medicine source updates supplied.' });
    }

    updates.push('updated_at = NOW()');
    values.push(req.params.medicineId);

    const previous = await pool.query(
      `SELECT source_quality_status FROM ng_drug_catalog WHERE id = $1`,
      [req.params.medicineId]
    );

    const result = await pool.query(
      `UPDATE ng_drug_catalog
          SET ${updates.join(', ')}
        WHERE id = $${values.length}
        RETURNING id, name, source_quality_status, is_supported, disabled_at, disabled_reason, admin_review_notes`,
      values
    );

    if (!result.rows.length) {
      return res.status(404).json({ error: 'Medicine record not found.' });
    }

    await pool.query(
      `INSERT INTO ng_medication_source_audit_log (
         drug_catalog_id, actor_user_id, action, from_status, to_status, details
       ) VALUES ($1, $2, 'medicine_source_updated', $3, $4, $5)`,
      [
        req.params.medicineId,
        getActorUserId(req.user),
        previous.rows[0]?.source_quality_status || null,
        result.rows[0].source_quality_status || null,
        {
          disabled: req.body.disabled,
          isSupported: req.body.isSupported,
          adminReviewNotes: req.body.adminReviewNotes || null,
        },
      ]
    );

    res.json({ medicine: result.rows[0] });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/pharmacy-inventory', async (req, res) => {
  try {
    const pool = getPool();
    const { limit, page, offset } = parsePagination(req.query);
    const params = [];
    const where = [];

    if (req.query.medicineId) {
      params.push(req.query.medicineId);
      where.push(`i.drug_id = $${params.length}`);
    }

    if (req.query.verificationStatus) {
      params.push(String(req.query.verificationStatus).trim());
      where.push(`COALESCE(i.availability_verification_status, 'unverified') = $${params.length}`);
    }

    if (req.query.query) {
      params.push(`%${String(req.query.query).trim()}%`);
      where.push(`(
        d.name ILIKE $${params.length}
        OR d.generic_name ILIKE $${params.length}
        OR p.name ILIKE $${params.length}
      )`);
    }

    const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const countResult = await pool.query(
      `SELECT COUNT(*)
         FROM ng_pharmacy_inventory i
         JOIN ng_drug_catalog d ON d.id = i.drug_id
         JOIN ng_pharmacies p ON p.id = i.pharmacy_id
         ${whereClause}`,
      params
    );

    params.push(limit, offset);
    const result = await pool.query(
      `SELECT i.id,
              i.pharmacy_id,
              i.drug_id,
              i.quantity_available,
              i.selling_price,
              i.is_available,
              i.expiry_date,
              i.availability_verification_status,
              i.availability_verified_at,
              i.availability_source,
              i.availability_notes,
              d.name AS drug_name,
              d.generic_name,
              d.source_quality_status,
              p.name AS pharmacy_name,
              p.status AS pharmacy_status,
              COALESCE(p.manual_city, p.city) AS city,
              COALESCE(p.manual_state, p.state) AS state
         FROM ng_pharmacy_inventory i
         JOIN ng_drug_catalog d ON d.id = i.drug_id
         JOIN ng_pharmacies p ON p.id = i.pharmacy_id
         ${whereClause}
        ORDER BY i.updated_at DESC NULLS LAST, d.name ASC
        LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    res.json({
      inventory: result.rows,
      pagination: {
        page,
        limit,
        total: Number(countResult.rows[0]?.count || 0),
      },
    });
  } catch (err) {
    const status = err.code === '42703' || err.code === '42P01' ? 503 : 500;
    res.status(status).json({
      error: status === 503 ? 'Nigeria pharmacy inventory verification columns are not migrated yet.' : err.message,
    });
  }
});

router.patch('/pharmacy-inventory/:inventoryId/availability-verification', requireSuperAdmin, async (req, res) => {
  try {
    const pool = getPool();
    const verified = req.body.verified === true;
    const nextStatus = verified ? 'verified' : 'unverified';

    const previous = await pool.query(
      `SELECT availability_verification_status FROM ng_pharmacy_inventory WHERE id = $1`,
      [req.params.inventoryId]
    );

    const result = await pool.query(
      `UPDATE ng_pharmacy_inventory
          SET availability_verification_status = $2,
              availability_verified_at = CASE WHEN $2 = 'verified' THEN NOW() ELSE NULL END,
              availability_verified_by = CASE WHEN $2 = 'verified' THEN $3 ELSE NULL END,
              availability_source = $4,
              availability_notes = $5,
              updated_at = NOW()
        WHERE id = $1
        RETURNING *`,
      [
        req.params.inventoryId,
        nextStatus,
        getActorUserId(req.user),
        req.body.availabilitySource || 'admin_confirmation',
        req.body.availabilityNotes || null,
      ]
    );

    if (!result.rows.length) {
      return res.status(404).json({ error: 'Pharmacy inventory record not found.' });
    }

    await pool.query(
      `INSERT INTO ng_medication_source_audit_log (
         inventory_id, actor_user_id, action, from_status, to_status, details
       ) VALUES ($1, $2, 'pharmacy_availability_verification_updated', $3, $4, $5)`,
      [
        req.params.inventoryId,
        getActorUserId(req.user),
        previous.rows[0]?.availability_verification_status || null,
        nextStatus,
        {
          availabilitySource: req.body.availabilitySource || 'admin_confirmation',
          availabilityNotes: req.body.availabilityNotes || null,
        },
      ]
    );

    res.json({ inventory: result.rows[0] });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

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
      `UPDATE ng_pharmacies
          SET status = 'suspended',
              account_status = 'suspended',
              updated_at = NOW()
        WHERE id = $1`,
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

router.get('/whatsapp-notifications', async (req, res) => {
  try {
    const pool = getPool();
    const { pharmacyId, status, limit = 50 } = req.query;
    const params = [];
    const where = ['1=1'];

    if (pharmacyId) {
      params.push(pharmacyId);
      where.push(`l.pharmacy_id = $${params.length}`);
    }

    if (status) {
      params.push(status);
      where.push(`l.status = $${params.length}`);
    }

    params.push(parseInt(limit, 10) || 50);
    const result = await pool.query(
      `SELECT l.*,
              p.name AS pharmacy_name,
              p.whatsapp_business_number,
              p.whatsapp
         FROM ng_whatsapp_notification_log l
         LEFT JOIN ng_pharmacies p ON p.id = l.pharmacy_id
        WHERE ${where.join(' AND ')}
        ORDER BY l.created_at DESC
        LIMIT $${params.length}`,
      params
    );

    res.json(result.rows);
  } catch (err) {
    const status = err.code === '42P01' ? 503 : 500;
    res.status(status).json({
      error: status === 503 ? 'WhatsApp notification log table is not migrated yet.' : err.message,
    });
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

// --- CONSULTATION LIFECYCLE OVERSIGHT ---

router.get('/consultations/lifecycle', async (req, res) => {
  try {
    const pool = getPool();
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const result = await pool.query(`
      SELECT
        a.id                        AS appointment_id,
        a.scheduled_at,
        a.status                    AS appointment_status,
        COALESCE(pu.first_name || ' ' || pu.last_name, a.patient_user_id::text) AS patient_name,
        a.patient_user_id           AS patient_id,
        COALESCE(prov.first_name || ' ' || prov.last_name, np.full_name, a.provider_id::text) AS provider_name,
        np.user_id                  AS provider_id,
        a.provider_id              AS provider_profile_id,
        cr.id                       AS room_id,
        cr.status                   AS room_status,
        cr.started_at               AS call_started_at,
        cr.ended_at                 AS call_ended_at,
        ce.id                       AS encounter_id,
        ce.status                   AS encounter_status,
        dp.id                       AS prescription_id,
        dp.status                   AS rx_status,
        dp.dispense_status,
        pu.account_status           AS patient_status
      FROM ng_appointments a
      LEFT JOIN users pu   ON pu.id = a.patient_user_id
      LEFT JOIN ng_providers np ON np.id = a.provider_id
      LEFT JOIN users prov ON prov.id = np.user_id
      LEFT JOIN ng_conf_rooms     cr ON cr.appointment_id = a.id
      LEFT JOIN ng_clinical_encounters ce ON ce.appointment_id = a.id
      LEFT JOIN ng_digital_prescriptions dp ON dp.patient_user_id = a.patient_user_id
        AND dp.created_at >= a.scheduled_at - INTERVAL '1 hour'
        AND dp.created_at <= COALESCE(cr.ended_at, NOW()) + INTERVAL '2 hours'
      ORDER BY a.scheduled_at DESC
      LIMIT $1
    `, [limit]);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
