/**
 * Nigeria Pharmacy Routes
 * Handles pharmacy onboarding, inventory, orders, wallet
 */

const express = require('express');
const router = express.Router();
const pharmacyOnboardingService = require('../services/pharmacy/pharmacyOnboardingService');
const inventoryService = require('../services/pharmacy/inventoryService');
const orderService = require('../services/pharmacy/orderService');
const walletService = require('../services/pharmacy/walletService');
const complianceService = require('../services/compliance/complianceService');
const { getPool } = require('../../server/db');

function getActorUserId(user = {}) {
  return user.id || user.userId || user.sub || null;
}

function isAdminUser(user = {}) {
  return ['admin', 'super_admin'].includes(user.role);
}

function requirePharmacyPortalRole(req, res, next) {
  if (isAdminUser(req.user) || req.user?.role === 'pharmacy') {
    return next();
  }

  return res.status(403).json({ error: 'Pharmacy account access required.' });
}

async function assertPharmacyAccess(req, pharmacyId) {
  if (isAdminUser(req.user)) {
    return;
  }

  const actorUserId = getActorUserId(req.user);
  if (!actorUserId) {
    const error = new Error('Authentication required');
    error.statusCode = 401;
    throw error;
  }

  const pool = getPool();
  const result = await pool.query(
    `SELECT id
       FROM ng_pharmacies
      WHERE id = $1
        AND owner_user_id = $2
      LIMIT 1`,
    [pharmacyId, actorUserId]
  );

  if (!result.rows.length) {
    const error = new Error('Pharmacy access required');
    error.statusCode = 403;
    throw error;
  }
}

function handleRouteError(res, err) {
  const status = err.statusCode || (err.code === '42703' || err.code === '42P01' ? 503 : 400);
  res.status(status).json({
    error: status === 503 ? 'Nigeria pharmacy tables are not migrated yet.' : err.message,
  });
}

router.use(requirePharmacyPortalRole);

// --- ONBOARDING ---

// Get the authenticated pharmacy workspace
router.get('/me', async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.query(
      `SELECT p.*, u.email AS owner_email
       FROM ng_pharmacies p
       LEFT JOIN users u ON u.id = p.owner_user_id
       WHERE p.owner_user_id = $1
       ORDER BY p.updated_at DESC NULLS LAST, p.created_at DESC
       LIMIT 1`,
      [req.user.id]
    );

    res.json(result.rows[0] || null);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Register a new pharmacy
router.post('/register', async (req, res) => {
  try {
    const result = await pharmacyOnboardingService.registerPharmacy(req.user.id, req.body);
    res.status(201).json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Update the authenticated pharmacy workspace settings.
router.patch('/me', async (req, res) => {
  try {
    const pool = getPool();
    const workspace = await pool.query(
      `SELECT id
         FROM ng_pharmacies
        WHERE owner_user_id = $1
        ORDER BY updated_at DESC NULLS LAST, created_at DESC
        LIMIT 1`,
      [req.user.id]
    );

    if (!workspace.rows.length) {
      return res.status(404).json({ error: 'No pharmacy workspace exists for this account yet.' });
    }

    const receivingMethod = ['dashboard', 'whatsapp', 'dashboard_whatsapp'].includes(req.body.preferredPrescriptionReceivingMethod)
      ? req.body.preferredPrescriptionReceivingMethod
      : null;
    const notificationPreferences = receivingMethod
      ? {
          dashboard: receivingMethod === 'dashboard' || receivingMethod === 'dashboard_whatsapp',
          whatsapp: receivingMethod === 'whatsapp' || receivingMethod === 'dashboard_whatsapp',
        }
      : req.body.notificationPreferences || null;

    const result = await pool.query(
      `UPDATE ng_pharmacies
          SET whatsapp = COALESCE($2, whatsapp),
              whatsapp_business_number = COALESCE($3, whatsapp_business_number),
              preferred_prescription_receiving_method = COALESCE($4, preferred_prescription_receiving_method),
              notification_preferences = COALESCE($5::jsonb, notification_preferences),
              accepts_bank_transfer = COALESCE($6, accepts_bank_transfer),
              accepts_pos = COALESCE($7, accepts_pos),
              accepts_cash = COALESCE($8, accepts_cash),
              operating_hours = COALESCE($9::jsonb, operating_hours),
              updated_at = NOW()
        WHERE id = $1
        RETURNING *`,
      [
        workspace.rows[0].id,
        req.body.whatsapp || null,
        req.body.whatsappBusinessNumber || null,
        receivingMethod,
        notificationPreferences ? JSON.stringify(notificationPreferences) : null,
        typeof req.body.acceptsBankTransfer === 'boolean' ? req.body.acceptsBankTransfer : null,
        typeof req.body.acceptsPos === 'boolean' ? req.body.acceptsPos : null,
        typeof req.body.acceptsCash === 'boolean' ? req.body.acceptsCash : null,
        req.body.operatingHours ? JSON.stringify(req.body.operatingHours) : null,
      ]
    );

    res.json({ pharmacy: result.rows[0] });
  } catch (err) {
    handleRouteError(res, err);
  }
});

// Upload documents (PCN license, etc.)
router.post('/:pharmacyId/documents', async (req, res) => {
  try {
    await assertPharmacyAccess(req, req.params.pharmacyId);
    const result = await pharmacyOnboardingService.uploadDocuments(
      req.params.pharmacyId, req.user.id, req.body
    );
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Get onboarding status
router.get('/:pharmacyId/onboarding-status', async (req, res) => {
  try {
    await assertPharmacyAccess(req, req.params.pharmacyId);
    const result = await pharmacyOnboardingService.getOnboardingStatus(req.params.pharmacyId);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Go live
router.post('/:pharmacyId/go-live', async (req, res) => {
  try {
    await assertPharmacyAccess(req, req.params.pharmacyId);
    const result = await pharmacyOnboardingService.goLive(
      req.params.pharmacyId, req.user.id, req.body
    );
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// --- INVENTORY ---

// Get pharmacy inventory
router.get('/:pharmacyId/inventory', async (req, res) => {
  try {
    await assertPharmacyAccess(req, req.params.pharmacyId);
    const result = await inventoryService.getInventory(req.params.pharmacyId, {
      page: parseInt(req.query.page) || 1,
      limit: parseInt(req.query.limit) || 50,
      search: req.query.search || '',
      category: req.query.category,
      lowStock: req.query.lowStock === 'true',
    });
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Add inventory items
router.post('/:pharmacyId/inventory', async (req, res) => {
  try {
    await assertPharmacyAccess(req, req.params.pharmacyId);
    const result = await pharmacyOnboardingService.addInventory(
      req.params.pharmacyId, req.user.id, req.body.items
    );
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Update inventory item
router.patch('/:pharmacyId/inventory/:itemId', async (req, res) => {
  try {
    await assertPharmacyAccess(req, req.params.pharmacyId);
    const result = await inventoryService.updateItem(
      req.params.pharmacyId, req.params.itemId, req.body
    );
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Bulk import inventory
router.post('/:pharmacyId/inventory/bulk-import', async (req, res) => {
  try {
    await assertPharmacyAccess(req, req.params.pharmacyId);
    const result = await inventoryService.bulkImport(
      req.params.pharmacyId, req.body.items
    );
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Get low stock alerts
router.get('/:pharmacyId/inventory/alerts', async (req, res) => {
  try {
    await assertPharmacyAccess(req, req.params.pharmacyId);
    const result = await inventoryService.getLowStockAlerts(req.params.pharmacyId);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Get pricing suggestion
router.get('/:pharmacyId/inventory/:drugId/pricing', async (req, res) => {
  try {
    await assertPharmacyAccess(req, req.params.pharmacyId);
    const result = await inventoryService.suggestPricing(
      req.params.pharmacyId, req.params.drugId
    );
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Get inventory dashboard stats
router.get('/:pharmacyId/inventory/stats', async (req, res) => {
  try {
    await assertPharmacyAccess(req, req.params.pharmacyId);
    const result = await inventoryService.getDashboardStats(req.params.pharmacyId);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// --- ORDERS ---

// Get pharmacy orders
router.get('/:pharmacyId/orders', async (req, res) => {
  try {
    await assertPharmacyAccess(req, req.params.pharmacyId);
    const result = await orderService.listPharmacyOrders(req.params.pharmacyId, {
      page: parseInt(req.query.page) || 1,
      limit: parseInt(req.query.limit) || 20,
      status: req.query.status,
    });
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Provider-generated prescriptions routed to this pharmacy.
router.get('/:pharmacyId/prescriptions', async (req, res) => {
  try {
    await assertPharmacyAccess(req, req.params.pharmacyId);

    const pool = getPool();
    const result = await pool.query(
      `SELECT rx.*,
              patient.first_name AS patient_first_name,
              patient.last_name AS patient_last_name,
              patient.email AS patient_email,
              patient.phone AS patient_phone,
              provider.full_name AS provider_name,
              provider.email AS provider_email,
              provider.phone AS provider_phone,
              provider.mdcn_number,
              pharmacy.name AS pharmacy_name,
              pharmacy.preferred_prescription_receiving_method
         FROM ng_digital_prescriptions rx
         JOIN users patient ON patient.id = rx.patient_user_id
         JOIN ng_providers provider ON provider.id = rx.provider_id
         LEFT JOIN ng_pharmacies pharmacy
           ON pharmacy.id = COALESCE(rx.routed_pharmacy_id, rx.preferred_pharmacy_id, rx.dispensed_by_pharmacy_id)
        WHERE rx.routed_pharmacy_id = $1
           OR rx.preferred_pharmacy_id = $1
           OR rx.dispensed_by_pharmacy_id = $1
        ORDER BY
          CASE rx.pharmacy_response_status
            WHEN 'pending_pharmacy_confirmation' THEN 1
            WHEN 'pharmacy_reviewing' THEN 2
            WHEN 'clarification_requested' THEN 3
            WHEN 'accepted' THEN 4
            WHEN 'ready_for_pickup' THEN 5
            WHEN 'out_for_delivery' THEN 6
            WHEN 'fulfilled' THEN 7
            WHEN 'unavailable' THEN 8
            WHEN 'cancelled' THEN 9
            ELSE 10
          END,
          rx.created_at DESC
        LIMIT 100`,
      [req.params.pharmacyId]
    );

    res.json(result.rows);
  } catch (err) {
    handleRouteError(res, err);
  }
});

router.patch('/:pharmacyId/prescriptions/:prescriptionId', async (req, res) => {
  try {
    await assertPharmacyAccess(req, req.params.pharmacyId);

    const allowedStatuses = new Set([
      'pharmacy_reviewing',
      'accepted',
      'ready_for_pickup',
      'out_for_delivery',
      'fulfilled',
      'unavailable',
      'clarification_requested',
      'cancelled',
    ]);
    const nextStatus = String(req.body.status || '').trim();
    if (!allowedStatuses.has(nextStatus)) {
      return res.status(400).json({ error: 'Unsupported pharmacy prescription status.' });
    }

    const confirmedPrice = req.body.confirmedPriceNgn === undefined || req.body.confirmedPriceNgn === '' || req.body.confirmedPriceNgn === null
      ? null
      : Number(req.body.confirmedPriceNgn);
    if (confirmedPrice !== null && !Number.isFinite(confirmedPrice)) {
      return res.status(400).json({ error: 'Confirmed price must be a number.' });
    }

    const statusMap = {
      pharmacy_reviewing: { prescription: 'routed', dispense: 'pending' },
      accepted: { prescription: 'dispensing', dispense: 'accepted' },
      ready_for_pickup: { prescription: 'dispensing', dispense: 'ready_for_pickup' },
      out_for_delivery: { prescription: 'dispensing', dispense: 'out_for_delivery' },
      fulfilled: { prescription: 'dispensed', dispense: 'dispensed' },
      unavailable: { prescription: 'routed', dispense: 'unavailable' },
      clarification_requested: { prescription: 'routed', dispense: 'pending_clarification' },
      cancelled: { prescription: 'canceled', dispense: 'cancelled' },
    };

    const mapped = statusMap[nextStatus];
    const pool = getPool();
    const result = await pool.query(
      `UPDATE ng_digital_prescriptions
          SET pharmacy_response_status = $1,
              status = $2,
              dispense_status = $3,
              confirmed_price_ngn = $4,
              pharmacy_notes = $5,
              clarification_request = $6,
              routed_pharmacy_id = COALESCE(routed_pharmacy_id, $7),
              dispensed_by_pharmacy_id = CASE WHEN $1 = 'fulfilled' THEN $7 ELSE dispensed_by_pharmacy_id END,
              pharmacy_responded_at = NOW(),
              ready_at = CASE WHEN $1 = 'ready_for_pickup' THEN NOW() ELSE ready_at END,
              fulfilled_at = CASE WHEN $1 = 'fulfilled' THEN NOW() ELSE fulfilled_at END,
              dispensed_at = CASE WHEN $1 = 'fulfilled' THEN NOW() ELSE dispensed_at END,
              cancelled_at = CASE WHEN $1 = 'cancelled' THEN NOW() ELSE cancelled_at END,
              updated_at = NOW()
        WHERE id = $8
          AND (preferred_pharmacy_id = $7 OR routed_pharmacy_id = $7 OR dispensed_by_pharmacy_id = $7)
        RETURNING *`,
      [
        nextStatus,
        mapped.prescription,
        mapped.dispense,
        confirmedPrice,
        req.body.pharmacyNotes || null,
        req.body.clarificationRequest || null,
        req.params.pharmacyId,
        req.params.prescriptionId,
      ]
    );

    if (!result.rows.length) {
      return res.status(404).json({ error: 'Prescription not found for this pharmacy.' });
    }

    await complianceService.logAction({
      actorUserId: req.user.id,
      actorType: 'pharmacist',
      action: 'pharmacy.prescription_status_updated',
      resourceType: 'digital_prescription',
      resourceId: req.params.prescriptionId,
      details: { status: nextStatus },
      pharmacyId: req.params.pharmacyId,
    }).catch(() => null);

    res.json({ prescription: result.rows[0] });
  } catch (err) {
    handleRouteError(res, err);
  }
});

// Get medication availability requests routed to this pharmacy.
router.get('/:pharmacyId/medication-requests', async (req, res) => {
  try {
    await assertPharmacyAccess(req, req.params.pharmacyId);

    const pool = getPool();
    const params = [req.params.pharmacyId];
    const where = ['(r.preferred_pharmacy_id = $1 OR r.assigned_pharmacy_id = $1)'];

    if (req.query.status) {
      params.push(String(req.query.status).trim());
      where.push(`r.status = $${params.length}`);
    }

    const result = await pool.query(
      `SELECT r.*,
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
        WHERE ${where.join(' AND ')}
        ORDER BY
          CASE r.status
            WHEN 'pending_pharmacy_confirmation' THEN 1
            WHEN 'pharmacy_reviewing' THEN 2
            WHEN 'clarification_requested' THEN 3
            WHEN 'available' THEN 4
            WHEN 'unavailable' THEN 5
            WHEN 'fulfilled' THEN 6
            WHEN 'completed' THEN 7
            WHEN 'cancelled' THEN 8
            ELSE 9
          END,
          r.created_at DESC
        LIMIT 100`,
      params
    );

    res.json(result.rows);
  } catch (err) {
    const status = err.statusCode || (err.code === '42703' || err.code === '42P01' ? 503 : 400);
    res.status(status).json({
      error: status === 503 ? 'Nigeria medication request tables are not migrated yet.' : err.message,
    });
  }
});

// Let a routed pharmacy respond to an availability request without verifying global live inventory.
router.patch('/:pharmacyId/medication-requests/:requestId', async (req, res) => {
  try {
    await assertPharmacyAccess(req, req.params.pharmacyId);

    const allowedStatuses = new Set([
      'pharmacy_reviewing',
      'available',
      'unavailable',
      'clarification_requested',
      'fulfilled',
      'completed',
    ]);
    const nextStatus = String(req.body.status || '').trim();

    if (!allowedStatuses.has(nextStatus)) {
      return res.status(400).json({ error: 'Unsupported pharmacy medication request status.' });
    }

    const confirmedPrice = req.body.confirmedPriceNgn === undefined || req.body.confirmedPriceNgn === '' || req.body.confirmedPriceNgn === null
      ? null
      : Number(req.body.confirmedPriceNgn);
    if (confirmedPrice !== null && !Number.isFinite(confirmedPrice)) {
      return res.status(400).json({ error: 'Confirmed price must be a number.' });
    }

    const pool = getPool();
    const result = await pool.query(
      `UPDATE ng_medication_requests
          SET status = $1,
              pharmacy_response_notes = $2,
              confirmed_price_ngn = $3,
              pharmacy_notes = $4,
              clarification_request = $5,
              pharmacy_responded_at = NOW(),
              assigned_pharmacy_id = COALESCE(assigned_pharmacy_id, $6),
              updated_at = NOW()
        WHERE id = $7
          AND (preferred_pharmacy_id = $6 OR assigned_pharmacy_id = $6)
        RETURNING *`,
      [
        nextStatus,
        req.body.pharmacyResponseNotes || null,
        confirmedPrice,
        req.body.pharmacyNotes || null,
        req.body.clarificationRequest || null,
        req.params.pharmacyId,
        req.params.requestId,
      ]
    );

    if (!result.rows.length) {
      return res.status(404).json({ error: 'Medication request not found for this pharmacy.' });
    }

    res.json({ request: result.rows[0] });
  } catch (err) {
    const status = err.statusCode || (err.code === '42703' || err.code === '42P01' ? 503 : 400);
    res.status(status).json({
      error: status === 503 ? 'Nigeria medication request tables are not migrated yet.' : err.message,
    });
  }
});

// Confirm order (start preparing)
router.post('/:pharmacyId/orders/:orderId/confirm', async (req, res) => {
  try {
    await assertPharmacyAccess(req, req.params.pharmacyId);
    const result = await orderService.pharmacyConfirmOrder(
      req.params.orderId, req.params.pharmacyId
    );
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Mark order ready
router.post('/:pharmacyId/orders/:orderId/ready', async (req, res) => {
  try {
    await assertPharmacyAccess(req, req.params.pharmacyId);
    const result = await orderService.markReady(
      req.params.orderId, req.params.pharmacyId
    );
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// --- WALLET ---

// Get wallet
router.get('/:pharmacyId/wallet', async (req, res) => {
  try {
    await assertPharmacyAccess(req, req.params.pharmacyId);
    const result = await walletService.getWallet(req.params.pharmacyId);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Request settlement
router.post('/:pharmacyId/wallet/settle', async (req, res) => {
  try {
    await assertPharmacyAccess(req, req.params.pharmacyId);
    const result = await walletService.processSettlement(req.params.pharmacyId);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Get transaction history
router.get('/:pharmacyId/wallet/transactions', async (req, res) => {
  try {
    await assertPharmacyAccess(req, req.params.pharmacyId);
    const result = await walletService.getTransactions(req.params.pharmacyId, {
      page: parseInt(req.query.page) || 1,
      limit: parseInt(req.query.limit) || 50,
      type: req.query.type,
      startDate: req.query.startDate,
      endDate: req.query.endDate,
    });
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// --- COMPLIANCE ---

// Get compliance status
router.get('/:pharmacyId/compliance', async (req, res) => {
  try {
    await assertPharmacyAccess(req, req.params.pharmacyId);
    const result = await complianceService.validatePharmacyCompliance(req.params.pharmacyId);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Get audit log
router.get('/:pharmacyId/audit-log', async (req, res) => {
  try {
    await assertPharmacyAccess(req, req.params.pharmacyId);
    const result = await complianceService.getAuditLog(req.params.pharmacyId, {
      page: parseInt(req.query.page) || 1,
      limit: parseInt(req.query.limit) || 50,
      action: req.query.action,
      severity: req.query.severity,
    });
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
