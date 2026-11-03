/**
 * Order Service
 * Handles the full order lifecycle:
 * Search → Add to Cart → Checkout → Pay → Dispatch → Deliver → Settle
 */

const { getPool } = require('../../../server/db');
const paymentOrchestrator = require('../payments/paymentOrchestrator');
const workflow = require('../logistics/medicationDeliveryWorkflowService');
const complianceService = require('../compliance/complianceService');
const { assertClinicalPharmacyActive } = require('./clinicalPharmacyAuthorization');

class OrderService {
  /**
   * Create a new order
   */
  createOrder(input, actor) { return workflow.createOrder(input, actor); }
  initiatePayment(orderId, actor, input) { return workflow.initiatePayment(orderId, actor, input); }

  async confirmPayment(paymentReference, provider) {
    const stage = await getPool().query('SELECT 1 FROM ng_medication_payment_attempts WHERE provider_reference=$1', [paymentReference]);
    if (stage.rows.length) {
      if (provider !== 'paystack') throw new Error('Medication payments require the configured payment provider.');
      return workflow.confirmPaymentReference(paymentReference);
    }
    const medicationOrder = await getPool().query('SELECT 1 FROM ng_orders o JOIN ng_medication_fulfillments f ON f.order_id=o.id WHERE o.payment_reference=$1', [paymentReference]);
    if (medicationOrder.rows.length) throw new Error('Medication payment requires stage reconciliation.');

    const pool = getPool();

    // Verify with payment provider
    const verification = await paymentOrchestrator.verifyPayment(paymentReference, provider);

    if (!verification.verified) {
      throw new Error('Payment verification failed');
    }

    const client = await pool.connect();
    let o;
    try {
      await client.query('BEGIN');
      const locked = await client.query(
        'SELECT * FROM ng_orders WHERE payment_reference = $1 AND payment_provider = $2 FOR UPDATE',
        [paymentReference, provider]
      );
      if (!locked.rows.length) throw new Error('Order not found for payment reference');
      o = locked.rows[0];
      const { assertPaymentMatches, toMinorUnits } = require('../payments/paymentIntegrity');
      const secretKey = require('../../config').paystack.secretKey;
      assertPaymentMatches(verification, {
        reference: paymentReference,
        amountMinor: toMinorUnits(o.total_amount),
        currency: 'NGN',
        environment: provider === 'paystack' ? (secretKey?.startsWith('sk_live_') ? 'live' : 'test') : null,
      });
      if (o.payment_status === 'completed') {
        await client.query('COMMIT');
        return { order: o, verification, alreadyConfirmed: true };
      }
      if (o.payment_status !== 'pending' || o.status === 'cancelled') {
        throw new Error('Payment requires reconciliation against the current order state');
      }
      const order = await client.query(
        `UPDATE ng_orders SET
        payment_status = 'completed',
        paid_at = NOW(),
        status = 'confirmed',
        updated_at = NOW()
      WHERE payment_reference = $1
      RETURNING *`,
      [paymentReference]
      );
      o = order.rows[0];

    // Credit pharmacy wallet (pending settlement)
    const walletCredit = await client.query(
      `UPDATE ng_pharmacy_wallets SET
        pending_balance = pending_balance + $1,
        updated_at = NOW()
      WHERE pharmacy_id = $2 RETURNING id`,
      [parseFloat(o.pharmacy_payout_amount), o.pharmacy_id]
    );
    if (!walletCredit.rows.length) throw new Error('Pharmacy settlement wallet is unavailable; reconciliation is required');

    // Record wallet transaction
    const wallet = await client.query(
      'SELECT * FROM ng_pharmacy_wallets WHERE pharmacy_id = $1', [o.pharmacy_id]
    );
    if (wallet.rows.length) {
      await client.query(
        `INSERT INTO ng_wallet_transactions (
          wallet_id, pharmacy_id, order_id, type, amount, balance_after,
          description, reference, payment_provider
        ) VALUES ($1,$2,$3,'credit',$4,$5,$6,$7,$8)`,
        [
          wallet.rows[0].id, o.pharmacy_id, o.id,
          parseFloat(o.pharmacy_payout_amount),
          wallet.rows[0].pending_balance,
          `Order ${o.order_number} payment received`,
          paymentReference, provider,
        ]
      );
    }

    // Record platform revenue
    await client.query(
      `INSERT INTO ng_platform_revenue (date, pharmacy_id, rx_fee_revenue, total_orders, total_gmv)
       VALUES (CURRENT_DATE, $1, $2, 1, $3)
       ON CONFLICT (date, pharmacy_id)
       DO UPDATE SET
         rx_fee_revenue = ng_platform_revenue.rx_fee_revenue + EXCLUDED.rx_fee_revenue,
         total_orders = ng_platform_revenue.total_orders + 1,
         total_gmv = ng_platform_revenue.total_gmv + EXCLUDED.total_gmv`,
      [o.pharmacy_id, parseFloat(o.platform_fee), parseFloat(o.total_amount)]
    );

      await complianceService.logAction({
        actorUserId: o.patient_user_id, actorType: 'system', action: 'order.payment_confirmed',
        resourceType: 'order', resourceId: o.id, pharmacyId: o.pharmacy_id,
        details: { amount: o.total_amount, provider, reference: paymentReference },
      }, client);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

    return { order: o, verification };
  }

  /**
   * Pharmacy confirms order (starts preparing)
   */
  pharmacyConfirmOrder(orderId, actor, input) { return workflow.confirmPharmacy(orderId, actor, input); }
  markReady(orderId, actor, input) { return workflow.markReady(orderId, actor, input); }
  cancelOrder(orderId, actor, input) { return workflow.cancel(orderId, actor, input); }

  async getOrder(orderId, userId) {
    const pool = getPool();
    const result = await pool.query(
      `SELECT o.*, p.name as pharmacy_name, p.phone as pharmacy_phone,
              p.address_line1 as pharmacy_address, p.city as pharmacy_city,
              t.status as delivery_status, t.rider_name, t.rider_phone,
              t.current_location, t.estimated_delivery_at as delivery_eta
       FROM ng_orders o
       JOIN ng_pharmacies p ON p.id = o.pharmacy_id
       LEFT JOIN ng_delivery_tracking t ON t.order_id = o.id
       WHERE o.id = $1 AND (o.patient_user_id = $2 OR p.owner_user_id = $2)`,
      [orderId, userId]
    );
    return result.rows[0] || null;
  }

  /**
   * List orders for a patient
   */
  async listPatientOrders(patientUserId, { page = 1, limit = 20, status = null } = {}) {
    const pool = getPool();
    const offset = (page - 1) * limit;

    let sql = `SELECT o.*, p.name as pharmacy_name, p.city as pharmacy_city
       FROM ng_orders o JOIN ng_pharmacies p ON p.id = o.pharmacy_id
       WHERE o.patient_user_id = $1`;
    const params = [patientUserId];

    if (status) {
      params.push(status);
      sql += ` AND o.status = $${params.length}`;
    }

    sql += ` ORDER BY o.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limit, offset);

    const result = await pool.query(sql, params);
    return result.rows;
  }

  /**
   * List orders for a pharmacy
   */
  async listPharmacyOrders(pharmacyId, { page = 1, limit = 20, status = null } = {}, actor) {
    const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
    const denied = () => Object.assign(new Error('An active authorized pharmacy account is required.'), { status: 403 });
    if (!uuid.test(String(actor?.id || '')) || actor?.role !== 'pharmacy') throw denied();
    if (!uuid.test(String(pharmacyId || '')) || !Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100
      || !Number.isSafeInteger((page - 1) * limit)
      || status && !['pending', 'confirmed', 'preparing', 'ready_for_pickup', 'dispatched', 'in_transit', 'delivered', 'cancelled', 'refunded'].includes(status)) {
      throw Object.assign(new Error('Choose valid order filters and a page size of 1 to 100.'), { status: 400 });
    }
    const client = await getPool().connect();
    try {
      await client.query('BEGIN');
      const account = (await client.query("SELECT id FROM users WHERE id=$1 AND role='pharmacy' AND is_active=TRUE AND account_status='active' AND market_scope='NG' FOR SHARE", [actor.id])).rows[0];
      if (!account) throw denied();
      const pharmacy = (await client.query("SELECT *,to_char(pcn_license_expiry,'YYYY-MM-DD') AS pcn_license_expiry FROM ng_pharmacies WHERE id=$1 AND owner_user_id=$2 FOR SHARE", [pharmacyId, account.id])).rows[0];
      assertClinicalPharmacyActive(pharmacy);
      const result = await client.query(`SELECT o.*, u.first_name, u.last_name, u.phone AS phone_number
        FROM ng_orders o JOIN users u ON u.id=o.patient_user_id
        WHERE o.pharmacy_id=$1 AND ($2::text IS NULL OR o.status::text=$2)
        ORDER BY o.created_at DESC,o.id LIMIT $3 OFFSET $4 FOR SHARE OF o`, [pharmacyId, status || null, limit, (page - 1) * limit]);
      await complianceService.logAction({ actorUserId: account.id, actorType: 'pharmacist', action: 'pharmacy.orders_viewed',
        resourceType: 'pharmacy', resourceId: pharmacyId, pharmacyId, details: { count: result.rows.length } }, client);
      await client.query('COMMIT');
      return result.rows;
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }
}

module.exports = new OrderService();
