'use strict';

const decisions = require('./adminVerificationService');

function checkoutUnavailable() {
  return Object.assign(decisions.actionError(503,
    'Subscription checkout is not activated. A subscription-specific verified payment attempt and receipt workflow is required before collecting payment.'),
  { code: 'SUBSCRIPTION_CHECKOUT_NOT_ACTIVATED' });
}

// Existing consultation/order receipts cannot safely be repurposed as paid
// subscription evidence. Keep customer checkout closed until it has its own
// immutable amount/currency/environment snapshot and receipt reconciliation.
async function assertCheckoutUnavailable(pool, { actorId, subscriptionId, activation }) {
  if (subscriptionId !== undefined) decisions.validateId(subscriptionId);
  if (activation) {
    const reference = activation.payment_reference;
    if (typeof reference !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(reference) ||
        (activation.payment_provider !== undefined && activation.payment_provider !== 'paystack')) {
      throw decisions.actionError(400, 'A valid saved Paystack reference is required.');
    }
  }
  await decisions.withActionTransaction(pool, async (client) => {
    await decisions.requireCurrentNGActor(client, actorId, false);
    if (subscriptionId !== undefined) {
      const { rows } = await client.query(
        `SELECT id, status, currency, amount_per_period, last_payment_reference
           FROM ng_subscriptions WHERE id = $1 AND subscriber_user_id = $2 FOR SHARE`, [subscriptionId, actorId]
      );
      const subscription = rows[0];
      if (!subscription) throw decisions.actionError(404, 'Subscription not found in this market.');
      if (['active', 'canceled', 'expired'].includes(subscription.status)) {
        throw decisions.actionError(409, 'This subscription cannot accept a new customer activation.');
      }
      if (activation && (!subscription.last_payment_reference || subscription.last_payment_reference !== activation.payment_reference)) {
        throw decisions.actionError(409, 'The payment reference does not match this subscription.');
      }
    }
    throw checkoutUnavailable();
  });
}

function sendCheckoutError(res, error) {
  if (error.code === 'SUBSCRIPTION_CHECKOUT_NOT_ACTIVATED') {
    return res.status(503).json({ success: false, error: error.message, code: error.code });
  }
  return decisions.sendActionError(res, error);
}

module.exports = { assertCheckoutUnavailable, sendCheckoutError };
