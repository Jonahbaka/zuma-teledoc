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

// --- ONBOARDING ---

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
