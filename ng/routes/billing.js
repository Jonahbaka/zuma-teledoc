'use strict';
const express = require('express');
const { z } = require('zod');
const db = require('../../server/db');
const service = require('../services/payments/consultationBillingService');
const { auditMiddleware } = require('../../server/middleware/audit');
const router = express.Router();

router.use(async (req, res, next) => {
  try {
    const { rows } = await db.query("SELECT id FROM users WHERE id = $1 AND role = 'patient' AND market_scope = 'NG' AND is_active = true", [req.user.id]);
    if (!rows.length) return res.status(403).json({ error: 'Nigeria patient access is required.' });
    next();
  } catch (error) { next(error); }
});

function wrap(handler) {
  return async (req, res) => {
    try { await handler(req, res); }
    catch (error) {
      const status = ['42P01', '42703'].includes(error.code) ? 503 : error.statusCode || 500;
      res.status(status).json({ error: status === 500 ? 'Billing operation failed.' : error.message, code: error.code });
    }
  };
}

router.get('/invoices', wrap(async (req, res) => res.json({ ok: true, invoices: await service.listInvoices(req.user.id) })));
router.post('/invoices', auditMiddleware('create', 'consultation_invoice'), wrap(async (req, res) => {
  const input = z.object({ appointmentId: z.string().uuid() }).safeParse(req.body);
  if (!input.success) return res.status(400).json({ error: 'A valid appointment is required.' });
  res.status(201).json({ ok: true, invoice: await service.createInvoice(req.user.id, input.data.appointmentId) });
}));
router.use('/invoices/:id', (req, res, next) => {
  if (!z.string().uuid().safeParse(req.params.id).success) return res.status(400).json({ error: 'Invalid invoice identifier.' });
  next();
});
router.post('/invoices/:id/checkout', auditMiddleware('create', 'payment_attempt'), wrap(async (req, res) => res.json({ ok: true, ...await service.initializeCheckout(req.user.id, req.params.id) })));
router.post('/invoices/:id/verify', auditMiddleware('verify', 'payment_attempt'), wrap(async (req, res) => res.json({ ok: true, ...await service.verifyOwnedInvoice(req.user.id, req.params.id) })));
router.post('/invoices/:id/refund-request', auditMiddleware('create', 'refund_request'), wrap(async (req, res) => res.json({ ok: true, invoice: await service.requestRefund(req.user.id, req.params.id), message: 'Refund requested for review; funds have not been returned.' })));
module.exports = router;
