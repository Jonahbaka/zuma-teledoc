/**
 * Financial System API Routes
 * Corporate Treasury, Bank, Accounting, Stripe Bridge
 */

const express = require('express');
const router = express.Router();
const { authenticate, requireRole } = require('../middleware/auth');

const adminOnly = [authenticate, requireRole('admin', 'super_admin')];

let financialService;
try {
  financialService = require('../services/financialService');
} catch (err) {
  console.warn('Financial service not available:', err.message);
}

let paymentSimService;
try {
  paymentSimService = require('../services/paymentSimulationService');
} catch (err) {
  console.warn('Payment simulation service not available:', err.message);
}

// ═══ DASHBOARD ═══
router.get('/dashboard', ...adminOnly, async (req, res) => {
  try {
    const stats = await financialService.getDashboardStats();
    res.json({ success: true, data: stats });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ═══ CHART OF ACCOUNTS ═══
router.get('/coa', ...adminOnly, async (req, res) => {
  try {
    const accounts = await financialService.getChartOfAccounts(req.query);
    res.json({ success: true, data: accounts });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/coa/:accountNumber/balance', ...adminOnly, async (req, res) => {
  try {
    const balance = await financialService.getAccountBalance(req.params.accountNumber);
    res.json({ success: true, data: balance });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ═══ JOURNAL ENTRIES ═══
router.get('/journal', ...adminOnly, async (req, res) => {
  try {
    const entries = await financialService.getJournalEntries(req.query);
    res.json({ success: true, data: entries });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/journal', ...adminOnly, async (req, res) => {
  try {
    const entry = await financialService.createJournalEntry(req.body);
    res.status(201).json({ success: true, data: entry });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// ═══ BANK ACCOUNTS ═══
router.get('/bank/accounts', ...adminOnly, async (req, res) => {
  try {
    const accounts = await financialService.getBankAccounts();
    res.json({ success: true, data: accounts });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/bank/transactions/:accountId', ...adminOnly, async (req, res) => {
  try {
    const transactions = await financialService.getBankTransactions(req.params.accountId, parseInt(req.query.limit) || 50);
    res.json({ success: true, data: transactions });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/bank/transaction', ...adminOnly, async (req, res) => {
  try {
    const txn = await financialService.recordBankTransaction(req.body);
    res.status(201).json({ success: true, data: txn });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// ═══ STRIPE BRIDGE ═══
router.post('/stripe-bridge/record', ...adminOnly, async (req, res) => {
  try {
    const result = await financialService.recordStripeRevenue(req.body);
    res.status(201).json({ success: true, data: result });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// ═══ ACCOUNTS RECEIVABLE ═══
router.get('/ar', ...adminOnly, async (req, res) => {
  try {
    const ar = await financialService.getAccountsReceivable(req.query);
    res.json({ success: true, data: ar });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/ar/invoice', ...adminOnly, async (req, res) => {
  try {
    const invoice = await financialService.createInvoice(req.body);
    res.status(201).json({ success: true, data: invoice });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// ═══ ACCOUNTS PAYABLE ═══
router.get('/ap', ...adminOnly, async (req, res) => {
  try {
    const ap = await financialService.getAccountsPayable(req.query);
    res.json({ success: true, data: ap });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/ap/bill', ...adminOnly, async (req, res) => {
  try {
    const bill = await financialService.createBill(req.body);
    res.status(201).json({ success: true, data: bill });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// ═══ FINANCIAL REPORTS ═══
router.get('/reports/trial-balance', ...adminOnly, async (req, res) => {
  try {
    const tb = await financialService.getTrialBalance();
    res.json({ success: true, data: tb });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/reports/balance-sheet', ...adminOnly, async (req, res) => {
  try {
    const bs = await financialService.getBalanceSheet();
    res.json({ success: true, data: bs });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/reports/income-statement', ...adminOnly, async (req, res) => {
  try {
    const is_ = await financialService.getIncomeStatement(req.query.start, req.query.end);
    res.json({ success: true, data: is_ });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/reports/cash-flow', ...adminOnly, async (req, res) => {
  try {
    const cf = await financialService.getCashFlowStatement(req.query.start, req.query.end);
    res.json({ success: true, data: cf });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ═══ ROI ═══
router.get('/roi', ...adminOnly, async (req, res) => {
  try {
    const roi = await financialService.getROIMetrics();
    res.json({ success: true, data: roi });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/roi', ...adminOnly, async (req, res) => {
  try {
    const roi = await financialService.trackROI(req.body);
    res.status(201).json({ success: true, data: roi });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// ═══ BUDGETS ═══
router.get('/budgets', ...adminOnly, async (req, res) => {
  try {
    const budgets = await financialService.getBudgets();
    res.json({ success: true, data: budgets });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ═══ INVESTOR RELATIONS ═══
router.get('/investors', ...adminOnly, async (req, res) => {
  try {
    const investors = await financialService.getInvestorRelations();
    res.json({ success: true, data: investors });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/investors', ...adminOnly, async (req, res) => {
  try {
    const investor = await financialService.addInvestor(req.body);
    res.status(201).json({ success: true, data: investor });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// ═══ PAYROLL ═══
router.get('/payroll', ...adminOnly, async (req, res) => {
  try {
    const payroll = await financialService.getPayroll(req.query);
    res.json({ success: true, data: payroll });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ═══ TAX OBLIGATIONS ═══
router.get('/taxes', ...adminOnly, async (req, res) => {
  try {
    const taxes = await financialService.getTaxObligations();
    res.json({ success: true, data: taxes });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ═══ REVENUE RECOGNITION ═══
router.get('/revenue-recognition', ...adminOnly, async (req, res) => {
  try {
    const rr = await financialService.getRevenueRecognition();
    res.json({ success: true, data: rr });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ═══ STRIPE SIMULATION & TESTING (Agent Access) ═══

router.get('/stripe/health', ...adminOnly, async (req, res) => {
  try {
    if (!paymentSimService) return res.json({ success: true, data: { healthy: false, error: 'Service not loaded' } });
    const health = await paymentSimService.stripeHealthCheck();
    res.json({ success: true, data: health });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/stripe/dashboard', ...adminOnly, async (req, res) => {
  try {
    if (!paymentSimService) return res.json({ success: true, data: { available: false } });
    const dashboard = await paymentSimService.getStripeDashboard();
    res.json({ success: true, data: dashboard });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/stripe/codebase-knowledge', ...adminOnly, async (req, res) => {
  try {
    if (!paymentSimService) return res.json({ success: false, error: 'Service not loaded' });
    const knowledge = paymentSimService.getCodebaseKnowledge();
    res.json({ success: true, data: knowledge });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/stripe/simulate-payment', ...adminOnly, async (req, res) => {
  try {
    if (!paymentSimService) return res.status(503).json({ success: false, error: 'Service not loaded' });
    const result = await paymentSimService.simulatePayment(req.body);
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

router.post('/stripe/simulate-subscription', ...adminOnly, async (req, res) => {
  try {
    if (!paymentSimService) return res.status(503).json({ success: false, error: 'Service not loaded' });
    const result = await paymentSimService.simulateSubscription(req.body);
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

router.post('/stripe/verify-pipeline', ...adminOnly, async (req, res) => {
  try {
    if (!paymentSimService) return res.status(503).json({ success: false, error: 'Service not loaded' });
    const result = await paymentSimService.verifyPaymentFlow();
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

router.post('/stripe/test-customer', ...adminOnly, async (req, res) => {
  try {
    if (!paymentSimService) return res.status(503).json({ success: false, error: 'Service not loaded' });
    const result = await paymentSimService.createTestCustomer(req.body.name, req.body.email);
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// ═══ REAL STRIPE BALANCE (Live from Stripe API) ═══
router.get('/stripe/real-balance', ...adminOnly, async (req, res) => {
  try {
    const data = await financialService.getRealStripeData();
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
