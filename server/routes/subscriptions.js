'use strict';

const express = require('express');
const { z } = require('zod');
const { authenticate } = require('../middleware/auth');
const stripeService = require('../services/stripeService');
const membership = require('../services/consumerMembershipService');
const router = express.Router();
router.use(authenticate);
router.use((_req, res, next) => { res.set('Cache-Control', 'private, no-store'); next(); });

function failure(res, error) {
  return res.status(error.statusCode || 503).json({ success: false, code: error.code || 'MEMBERSHIP_UNAVAILABLE',
    error: error.statusCode ? error.message : 'Membership could not be loaded or updated. Please try again.' });
}
router.get('/me', async (req, res) => {
  try { return res.json(await membership.readState(req.user.id, stripeService.PRICING)); }
  catch (error) { return failure(res, error); }
});

// The legacy endpoint fabricated a completed receipt and paid access.
// The existing hosted Stripe route is the sole checkout entry.
router.post('/', (_req, res) => res.status(503).json({ success: false, code: 'HOSTED_CHECKOUT_REQUIRED',
  error: 'Use the configured hosted membership checkout. No payment was collected or membership activated.', checkoutPath: '/api/stripe/checkout/subscription' }));

const updateSchema = z.object({ autoRenew: z.boolean().optional(), cancelAtPeriodEnd: z.boolean().optional() }).strict()
  .refine(value => Object.keys(value).length > 0 && (value.autoRenew === undefined || value.cancelAtPeriodEnd === undefined || value.autoRenew !== value.cancelAtPeriodEnd));
router.patch('/me', async (req, res) => {
  const result = updateSchema.safeParse(req.body);
  if (!result.success) return res.status(400).json({ success: false, error: 'Supply a consistent renewal or cancellation instruction.' });
  try {
    const cancelAtPeriodEnd = result.data.cancelAtPeriodEnd ?? !result.data.autoRenew;
    return res.json({ success: true, subscription: await stripeService.updateOwnSubscription(req.user.id, { cancelAtPeriodEnd }) });
  } catch (error) { return failure(res, error); }
});
router.post('/me/cancel', async (req, res) => {
  try { return res.json({ success: true, subscription: await stripeService.updateOwnSubscription(req.user.id, { cancelAtPeriodEnd: true }), message: 'Stripe confirmed cancellation at the end of the current billing period.' }); }
  catch (error) { return failure(res, error); }
});

module.exports = router;

