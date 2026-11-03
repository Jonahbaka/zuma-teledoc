/**
 * Nigeria Pharmacy Routes
 * Handles pharmacy onboarding, inventory, orders, wallet
 */

const express = require('express');
const router = express.Router();
const pharmacyOnboardingService = require('../services/pharmacy/pharmacyOnboardingService');
const inventoryService = require('../services/pharmacy/inventoryService');
const inventoryMutations = require('../services/pharmacy/inventoryMutationService');
const { previewCatalogue } = require('../services/pharmacy/cataloguePreviewService');
const orderService = require('../services/pharmacy/orderService');
const medicationRequests = require('../services/pharmacy/medicationRequestService');
const clinicalInbox = require('../services/pharmacy/clinicalInboxService');
const returnCustody = require('../services/pharmacy/returnCustodyService');
const medicationDelivery = require('../services/logistics/medicationDeliveryWorkflowService');
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

async function assertPharmacyOrderAccess(req) {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuid.test(req.params.orderId) || !uuid.test(req.params.pharmacyId)) {
    const error = new Error('A valid pharmacy and order identifier are required.');
    error.status = 400;
    throw error;
  }
  await assertPharmacyAccess(req, req.params.pharmacyId);
  const result = await getPool().query(
    'SELECT id FROM ng_orders WHERE id = $1 AND pharmacy_id = $2 LIMIT 1',
    [req.params.orderId, req.params.pharmacyId]
  );
  if (!result.rows.length) {
    const error = new Error('Order not found for this pharmacy.');
    error.status = 404;
    throw error;
  }
}

function handleMedicationOrderError(res, error) {
  const explicitStatus = error.status ?? error.statusCode;
  const hasSafeStatus = Number.isInteger(explicitStatus) && explicitStatus >= 400 && explicitStatus <= 599;
  const status = hasSafeStatus ? explicitStatus : ['42P01', '42703'].includes(error.code) ? 503 : 500;
  res.status(status).json({ error: hasSafeStatus ? error.message : 'Medication order service is temporarily unavailable.' });
}

function handleRouteError(res, err) {
  const status = err.statusCode || (err.code === '42703' || err.code === '42P01' ? 503 : 400);
  res.status(status).json({
    error: status === 503 ? 'Nigeria pharmacy tables are not migrated yet.' : err.message,
  });
}

router.use(requirePharmacyPortalRole);

// Alternate return custody is a separately authorized, default-disabled manual
// protocol. It does not grant access to the original pharmacy's clinical order.
router.get('/:pharmacyId/return-custody', async (req, res) => {
  res.set('Cache-Control', 'private, no-store');
  try { res.json(await returnCustody.list(req.params.pharmacyId, req.user, req.query)); }
  catch (error) { handleMedicationOrderError(res, error); }
});
router.post('/:pharmacyId/return-custody/:orderId/receive', async (req, res) => {
  res.set('Cache-Control', 'private, no-store');
  try { res.json(await returnCustody.receive(req.params.orderId, req.params.pharmacyId, req.user, req.body)); }
  catch (error) { handleMedicationOrderError(res, error); }
});

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
    const deliveryRadiusKm = req.body.deliveryRadiusKm === undefined || req.body.deliveryRadiusKm === null || req.body.deliveryRadiusKm === ''
      ? null
      : Number(req.body.deliveryRadiusKm);

    if (deliveryRadiusKm !== null && !Number.isFinite(deliveryRadiusKm)) {
      return res.status(400).json({ error: 'Delivery radius must be a number.' });
    }

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
              delivery_enabled = COALESCE($10, delivery_enabled),
              pickup_enabled = COALESCE($11, pickup_enabled),
              delivery_radius_km = COALESCE($12, delivery_radius_km),
              service_categories = COALESCE($13::jsonb, service_categories),
              onboarding_notes = COALESCE($14, onboarding_notes),
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
        typeof req.body.deliveryEnabled === 'boolean' ? req.body.deliveryEnabled : null,
        typeof req.body.pickupEnabled === 'boolean' ? req.body.pickupEnabled : null,
        deliveryRadiusKm,
        Array.isArray(req.body.serviceCategories) ? JSON.stringify(req.body.serviceCategories) : null,
        req.body.onboardingNotes || null,
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
  res.set('Cache-Control', 'private, no-store');
  try { res.json(await inventoryMutations.mutate(getPool(), req.user, req.params.pharmacyId, 'add', req.body)); }
  catch (error) { inventoryMutations.sendError(res, error); }
});

// Update inventory item
router.patch('/:pharmacyId/inventory/:itemId', async (req, res) => {
  res.set('Cache-Control', 'private, no-store');
  try { res.json(await inventoryMutations.mutate(getPool(), req.user, req.params.pharmacyId, 'update', req.body, req.params.itemId)); }
  catch (error) { inventoryMutations.sendError(res, error); }
});

// Transport-free partner catalogue validation; never imports or activates.
router.post('/:pharmacyId/inventory/catalogue-preview', async (req, res) => {
  res.set('Cache-Control', 'private, no-store');
  try {
    const result = await previewCatalogue(getPool(), req.user, req.params.pharmacyId, req.body);
    res.json(result);
  } catch (error) {
    const status = error.statusCode || 503;
    res.status(status).json({
      code: error.statusCode ? error.code : 'CATALOGUE_PREVIEW_UNAVAILABLE',
      error: error.statusCode ? error.message : 'Catalogue validation is temporarily unavailable.',
    });
  }
});

// Bulk import inventory
router.post('/:pharmacyId/inventory/bulk-import', async (req, res) => {
  res.set('Cache-Control', 'private, no-store');
  try { res.json(await inventoryMutations.mutate(getPool(), req.user, req.params.pharmacyId, 'import', req.body)); }
  catch (error) { inventoryMutations.sendError(res, error); }
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

router.use('/:pharmacyId/orders', (_req, res, next) => {
  res.set('Cache-Control', 'private, no-store');
  next();
});

// Get pharmacy orders
router.get('/:pharmacyId/orders', async (req, res) => {
  try {
    const result = await orderService.listPharmacyOrders(req.params.pharmacyId, {
      page: parseInt(req.query.page) || 1,
      limit: parseInt(req.query.limit) || 20,
      status: req.query.status,
    }, req.user);
    res.json(result);
  } catch (err) {
    handleMedicationOrderError(res, err);
  }
});

// Signed, explicitly routed clinical records are authorized and audited in the
// same transaction as each read or update. Failed audits never report success.
router.get('/:pharmacyId/prescriptions', async (req, res) => {
  res.set('Cache-Control', 'private, no-store');
  try { res.json(await clinicalInbox.listPrescriptions(getPool(), req.user, req.params.pharmacyId)); }
  catch (error) { clinicalInbox.sendError(res, error); }
});
router.get('/:pharmacyId/whatsapp-notifications', async (req, res) => {
  res.set('Cache-Control', 'private, no-store');
  try { res.json(await clinicalInbox.listNotifications(getPool(), req.user, req.params.pharmacyId)); }
  catch (error) { clinicalInbox.sendError(res, error); }
});
router.patch('/:pharmacyId/prescriptions/:prescriptionId', async (req, res) => {
  res.set('Cache-Control', 'private, no-store');
  try { res.json(await clinicalInbox.updateStatus(getPool(), req.user, req.params.pharmacyId, req.params.prescriptionId, req.body)); }
  catch (error) { clinicalInbox.sendError(res, error); }
});

// Availability responses are scoped and audited independently of fulfillment.
router.use('/:pharmacyId/medication-requests', (_req, res, next) => {
  res.set('Cache-Control', 'private, no-store');
  next();
});
router.get('/:pharmacyId/medication-requests', async (req, res) => {
  try {
    res.json(await medicationRequests.listPharmacyRequests(getPool(), req.user, req.params.pharmacyId, req.query.status));
  } catch (error) { medicationRequests.sendError(res, error); }
});
router.patch('/:pharmacyId/medication-requests/:requestId', async (req, res) => {
  try {
    const request = await medicationRequests.updateRequest(getPool(), req.user, req.params.requestId, req.body, req.params.pharmacyId);
    res.json({ request });
  } catch (error) { medicationRequests.sendError(res, error); }
});

// Confirm order (start preparing)
router.post('/:pharmacyId/orders/:orderId/confirm', async (req, res) => {
  try {
    await assertPharmacyOrderAccess(req);
    const result = await medicationDelivery.confirmPharmacy(req.params.orderId, req.user, req.body);
    res.json(result);
  } catch (err) {
    handleMedicationOrderError(res, err);
  }
});

// Mark order ready
router.post('/:pharmacyId/orders/:orderId/ready', async (req, res) => {
  try {
    await assertPharmacyOrderAccess(req);
    const result = await medicationDelivery.markReady(req.params.orderId, req.user, req.body);
    res.json(result);
  } catch (err) {
    handleMedicationOrderError(res, err);
  }
});

router.get('/:pharmacyId/orders/:orderId/checkout', async (req, res) => {
  res.set('Cache-Control', 'private, no-store');
  try {
    await assertPharmacyOrderAccess(req);
    res.json(await medicationDelivery.getCheckout(req.params.orderId, req.user));
  } catch (err) {
    handleMedicationOrderError(res, err);
  }
});

router.post('/:pharmacyId/orders/:orderId/price', async (req, res) => {
  try {
    await assertPharmacyOrderAccess(req);
    res.json(await medicationDelivery.confirmPrice(req.params.orderId, req.user, req.body));
  } catch (err) {
    handleMedicationOrderError(res, err);
  }
});

router.post('/:pharmacyId/orders/:orderId/delivery/dispatch', async (req, res) => {
  try {
    await assertPharmacyOrderAccess(req);
    res.json(await medicationDelivery.dispatch(req.params.orderId, req.user, req.body));
  } catch (err) {
    handleMedicationOrderError(res, err);
  }
});

router.post('/:pharmacyId/orders/:orderId/delivery/refresh', async (req, res) => {
  try {
    await assertPharmacyOrderAccess(req);
    res.json(await medicationDelivery.refresh(req.params.orderId, req.user, req.body));
  } catch (err) {
    handleMedicationOrderError(res, err);
  }
});

router.post('/:pharmacyId/orders/:orderId/collect', async (req, res) => {
  try {
    await assertPharmacyOrderAccess(req);
    res.json(await medicationDelivery.collect(req.params.orderId, req.user, req.body));
  } catch (err) {
    handleMedicationOrderError(res, err);
  }
});

router.post('/:pharmacyId/orders/:orderId/cancel', async (req, res) => {
  try {
    await assertPharmacyOrderAccess(req);
    res.json(await medicationDelivery.cancel(req.params.orderId, req.user, req.body));
  } catch (err) {
    handleMedicationOrderError(res, err);
  }
});

// --- WALLET ---
router.post('/:pharmacyId/orders/:orderId/returns/receive', async (req, res) => {
  try {
    await assertPharmacyOrderAccess(req);
    res.json(await medicationDelivery.receiveReturn(req.params.orderId, req.user, req.body));
  } catch (err) { handleMedicationOrderError(res, err); }
});

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
  res.set('Cache-Control', 'private, no-store');
  try {
    // Uniform denial needs no wallet lookup, ownership precheck or provider call.
    // The service also rejects direct callers before touching any balance.
    await walletService.processSettlement(req.params.pharmacyId);
  } catch (err) {
    return res.status(503).json({
      code: 'LEGACY_PHARMACY_SETTLEMENT_DISABLED',
      error: err.code === 'LEGACY_PHARMACY_SETTLEMENT_DISABLED' ? err.message : 'Legacy pharmacy payouts are unavailable. No new payout was confirmed.',
    });
  }
  return res.status(503).json({ code: 'LEGACY_PHARMACY_SETTLEMENT_DISABLED', error: 'Legacy pharmacy payouts are unavailable. No new payout was confirmed.' });
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
