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

// Upload documents (PCN license, etc.)
router.post('/:pharmacyId/documents', async (req, res) => {
  try {
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
    const result = await pharmacyOnboardingService.getOnboardingStatus(req.params.pharmacyId);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Go live
router.post('/:pharmacyId/go-live', async (req, res) => {
  try {
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
    const result = await inventoryService.getLowStockAlerts(req.params.pharmacyId);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Get pricing suggestion
router.get('/:pharmacyId/inventory/:drugId/pricing', async (req, res) => {
  try {
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
    const result = await walletService.getWallet(req.params.pharmacyId);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Request settlement
router.post('/:pharmacyId/wallet/settle', async (req, res) => {
  try {
    const result = await walletService.processSettlement(req.params.pharmacyId);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Get transaction history
router.get('/:pharmacyId/wallet/transactions', async (req, res) => {
  try {
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
    const result = await complianceService.validatePharmacyCompliance(req.params.pharmacyId);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Get audit log
router.get('/:pharmacyId/audit-log', async (req, res) => {
  try {
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
