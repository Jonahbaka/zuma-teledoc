/**
 * Order Service
 * Handles the full order lifecycle:
 * Search → Add to Cart → Checkout → Pay → Dispatch → Deliver → Settle
 */

const { getPool } = require('../../../server/db');
const paymentOrchestrator = require('../payments/paymentOrchestrator');
const deliveryService = require('../logistics/deliveryService');
const complianceService = require('../compliance/complianceService');

class OrderService {
  /**
   * Create a new order
   */
  async createOrder({
    patientUserId, pharmacyId, prescriptionId = null,
    items, deliveryType = 'delivery', deliveryAddress = null,
    paymentMethod = 'card', notes = null,
  }) {
    const pool = getPool();

    // Validate pharmacy
    const pharmacy = await pool.query(
      `SELECT id, name, status, minimum_order_amount, delivery_enabled,
              delivery_radius_km, paystack_subaccount_code, flutterwave_subaccount_id,
              subscription_tier, latitude, longitude
       FROM ng_pharmacies WHERE id = $1 AND status = 'approved'`,
      [pharmacyId]
    );
    if (!pharmacy.rows.length) throw new Error('Pharmacy not found or not approved');
    const pharm = pharmacy.rows[0];

    // Validate and price items
    let subtotal = 0;
    const pricedItems = [];

    for (const item of items) {
      // Check inventory
      const inv = await pool.query(
        `SELECT i.*, d.name as drug_name, d.generic_name, d.requires_prescription, d.category
         FROM ng_pharmacy_inventory i
         JOIN ng_drug_catalog d ON d.id = i.drug_id
         WHERE i.pharmacy_id = $1 AND i.drug_id = $2
           AND i.is_available = true AND i.quantity_available >= $3`,
        [pharmacyId, item.drugId, item.quantity]
      );

      if (!inv.rows.length) {
        throw new Error(`Drug ${item.drugId} not available in requested quantity`);
      }

      const invItem = inv.rows[0];

      // Check if prescription is required
      if (invItem.requires_prescription && !prescriptionId) {
        throw new Error(`${invItem.drug_name} requires a valid prescription`);
      }

      // Check controlled substance compliance
      if (invItem.category === 'controlled') {
        const compCheck = await complianceService.canSellWithoutPrescription(item.drugId);
        if (!compCheck.allowed) throw new Error(compCheck.reason);
      }

      const effectivePrice = invItem.discount_percent
        ? invItem.selling_price * (1 - invItem.discount_percent / 100)
        : invItem.selling_price;

      const lineTotal = Math.round(effectivePrice * item.quantity);
      subtotal += lineTotal;

      pricedItems.push({
        drug_id: item.drugId,
        drug_name: invItem.drug_name,
        generic_name: invItem.generic_name,
        quantity: item.quantity,
        unit_price: effectivePrice,
        total_price: lineTotal,
        is_prescription: invItem.requires_prescription,
        batch_number: invItem.batch_number,
      });
    }

    // Minimum order check
    if (subtotal < parseFloat(pharm.minimum_order_amount)) {
      throw new Error(`Minimum order amount is ₦${pharm.minimum_order_amount}`);
    }

    // Calculate fees
    const fees = paymentOrchestrator.calculateFees(subtotal, pharm.subscription_tier);

    // Calculate delivery fee if applicable
    let deliveryFee = 0;
    if (deliveryType === 'delivery' && deliveryAddress) {
      if (!pharm.delivery_enabled) throw new Error('This pharmacy does not offer delivery');
      const distance = deliveryService.calculateDistance(
        pharm.latitude, pharm.longitude,
        deliveryAddress.latitude, deliveryAddress.longitude
      );
      if (distance > parseFloat(pharm.delivery_radius_km)) {
        throw new Error('Delivery address is outside pharmacy delivery radius');
      }
      deliveryFee = deliveryService.calculateDeliveryFee(distance);
    }

    const totalAmount = subtotal + fees.platformFee + deliveryFee + fees.vat;
    const orderNumber = await paymentOrchestrator.generateOrderNumber();

    // Create the order
    const orderResult = await pool.query(
      `INSERT INTO ng_orders (
        order_number, patient_user_id, pharmacy_id, prescription_id,
        items, subtotal, platform_fee, delivery_fee, vat_amount, total_amount,
        delivery_type, delivery_address, payment_method, notes,
        pharmacy_payout_amount
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
      RETURNING *`,
      [
        orderNumber, patientUserId, pharmacyId, prescriptionId,
        JSON.stringify(pricedItems), subtotal, fees.platformFee, deliveryFee,
        fees.vat, totalAmount, deliveryType,
        deliveryAddress ? JSON.stringify(deliveryAddress) : null,
        paymentMethod, notes,
        subtotal - fees.marginShare, // Pharmacy gets subtotal minus margin share
      ]
    );

    const order = orderResult.rows[0];

    // Reserve inventory
    for (const item of pricedItems) {
      await pool.query(
        `UPDATE ng_pharmacy_inventory SET
          quantity_reserved = quantity_reserved + $1,
          quantity_available = quantity_available - $1,
          updated_at = NOW()
        WHERE pharmacy_id = $2 AND drug_id = $3`,
        [item.quantity, pharmacyId, item.drug_id]
      );
    }

    // Log compliance event
    await complianceService.logAction({
      actorUserId: patientUserId,
      actorType: 'patient',
      action: 'order.created',
      resourceType: 'order',
      resourceId: order.id,
      details: {
        orderNumber, subtotal, totalAmount,
        itemCount: pricedItems.length,
        hasPrescription: !!prescriptionId,
      },
      pharmacyId,
    });

    return {
      order,
      fees: {
        subtotal,
        platformFee: fees.platformFee,
        deliveryFee,
        vat: fees.vat,
        total: totalAmount,
      },
    };
  }

  /**
   * Initialize payment for an order
   */
  async initiatePayment(orderId, patientUserId) {
    const pool = getPool();

    const order = await pool.query(
      `SELECT o.*, u.email, u.first_name, u.last_name, u.phone_number,
              p.paystack_subaccount_code, p.flutterwave_subaccount_id
       FROM ng_orders o
       JOIN users u ON u.id = o.patient_user_id
       JOIN ng_pharmacies p ON p.id = o.pharmacy_id
       WHERE o.id = $1 AND o.patient_user_id = $2 AND o.payment_status = 'pending'`,
      [orderId, patientUserId]
    );

    if (!order.rows.length) throw new Error('Order not found or already paid');
    const o = order.rows[0];

    const payment = await paymentOrchestrator.initializePayment({
      orderId: o.id,
      email: o.email,
      amount: parseFloat(o.total_amount),
      pharmacySubaccountCode: o.paystack_subaccount_code,
      pharmacySubaccountId: o.flutterwave_subaccount_id,
      platformFee: parseFloat(o.platform_fee),
      patientName: `${o.first_name} ${o.last_name}`,
      patientPhone: o.phone_number,
      paymentMethod: o.payment_method,
    });

    // Store payment reference
    await pool.query(
      `UPDATE ng_orders SET
        payment_reference = $1,
        payment_provider = $2,
        updated_at = NOW()
      WHERE id = $3`,
      [payment.reference, payment.provider, orderId]
    );

    return payment;
  }

  /**
   * Confirm payment (called from webhook or verification)
   */
  async confirmPayment(paymentReference, provider) {
    const pool = getPool();

    // Verify with payment provider
    const verification = await paymentOrchestrator.verifyPayment(paymentReference, provider);

    if (!verification.verified) {
      throw new Error('Payment verification failed');
    }

    // Update order
    const order = await pool.query(
      `UPDATE ng_orders SET
        payment_status = 'completed',
        paid_at = NOW(),
        status = 'confirmed',
        updated_at = NOW()
      WHERE payment_reference = $1
      RETURNING *`,
      [paymentReference]
    );

    if (!order.rows.length) throw new Error('Order not found for payment reference');
    const o = order.rows[0];

    // Credit pharmacy wallet (pending settlement)
    await pool.query(
      `UPDATE ng_pharmacy_wallets SET
        pending_balance = pending_balance + $1,
        updated_at = NOW()
      WHERE pharmacy_id = $2`,
      [parseFloat(o.pharmacy_payout_amount), o.pharmacy_id]
    );

    // Record wallet transaction
    const wallet = await pool.query(
      'SELECT * FROM ng_pharmacy_wallets WHERE pharmacy_id = $1', [o.pharmacy_id]
    );
    if (wallet.rows.length) {
      await pool.query(
        `INSERT INTO ng_wallet_transactions (
          wallet_id, pharmacy_id, order_id, type, amount, balance_after,
          description, reference, payment_provider
        ) VALUES ($1,$2,$3,'credit',$4,$5,$6,$7,$8)`,
        [
          wallet.rows[0].id, o.pharmacy_id, o.id,
          parseFloat(o.pharmacy_payout_amount),
          parseFloat(wallet.rows[0].pending_balance) + parseFloat(o.pharmacy_payout_amount),
          `Order ${o.order_number} payment received`,
          paymentReference, provider,
        ]
      );
    }

    // Record platform revenue
    await pool.query(
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
      actorUserId: o.patient_user_id,
      actorType: 'system',
      action: 'order.payment_confirmed',
      resourceType: 'order',
      resourceId: o.id,
      details: { amount: o.total_amount, provider, reference: paymentReference },
      pharmacyId: o.pharmacy_id,
    });

    return { order: o, verification };
  }

  /**
   * Pharmacy confirms order (starts preparing)
   */
  async pharmacyConfirmOrder(orderId, pharmacyId) {
    const pool = getPool();

    const result = await pool.query(
      `UPDATE ng_orders SET status = 'preparing', updated_at = NOW()
       WHERE id = $1 AND pharmacy_id = $2 AND status = 'confirmed'
       RETURNING *`,
      [orderId, pharmacyId]
    );

    if (!result.rows.length) throw new Error('Order not found or not in confirmed status');
    return result.rows[0];
  }

  /**
   * Mark order as ready (pickup or delivery)
   */
  async markReady(orderId, pharmacyId) {
    const pool = getPool();

    const order = await pool.query(
      `UPDATE ng_orders SET status = 'ready_for_pickup', updated_at = NOW()
       WHERE id = $1 AND pharmacy_id = $2 AND status = 'preparing'
       RETURNING *`,
      [orderId, pharmacyId]
    );

    if (!order.rows.length) throw new Error('Order not found or not in preparing status');
    const o = order.rows[0];

    // If delivery type, dispatch rider
    if (o.delivery_type === 'delivery') {
      try {
        const delivery = await deliveryService.requestDelivery(orderId);
        return { order: o, delivery };
      } catch (err) {
        console.error('Delivery dispatch failed:', err.message);
        return { order: o, delivery: null, deliveryError: err.message };
      }
    }

    return { order: o };
  }

  /**
   * Cancel an order
   */
  async cancelOrder(orderId, userId, reason) {
    const pool = getPool();

    const order = await pool.query(
      `SELECT * FROM ng_orders WHERE id = $1 AND (patient_user_id = $2 OR pharmacy_id IN (
        SELECT id FROM ng_pharmacies WHERE owner_user_id = $2
      ))`, [orderId, userId]
    );

    if (!order.rows.length) throw new Error('Order not found');
    const o = order.rows[0];

    // Can only cancel if not yet dispatched
    if (['dispatched', 'in_transit', 'delivered'].includes(o.status)) {
      throw new Error('Cannot cancel order after dispatch');
    }

    // Restore inventory
    const items = typeof o.items === 'string' ? JSON.parse(o.items) : o.items;
    for (const item of items) {
      await pool.query(
        `UPDATE ng_pharmacy_inventory SET
          quantity_available = quantity_available + $1,
          quantity_reserved = GREATEST(quantity_reserved - $1, 0),
          updated_at = NOW()
        WHERE pharmacy_id = $2 AND drug_id = $3`,
        [item.quantity, o.pharmacy_id, item.drug_id]
      );
    }

    // Process refund if paid
    if (o.payment_status === 'completed' && o.payment_reference) {
      try {
        await paymentOrchestrator.processRefund({
          paymentReference: o.payment_reference,
          amount: parseFloat(o.total_amount),
          provider: o.payment_provider,
          reason,
        });
      } catch (err) {
        console.error('Refund failed:', err.message);
      }
    }

    await pool.query(
      `UPDATE ng_orders SET
        status = 'cancelled',
        cancellation_reason = $1,
        payment_status = CASE WHEN payment_status = 'completed' THEN 'refunded' ELSE payment_status END,
        updated_at = NOW()
      WHERE id = $2`,
      [reason, orderId]
    );

    return { orderId, status: 'cancelled' };
  }

  /**
   * Get order details
   */
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
  async listPharmacyOrders(pharmacyId, { page = 1, limit = 20, status = null } = {}) {
    const pool = getPool();
    const offset = (page - 1) * limit;

    let sql = `SELECT o.*, u.first_name, u.last_name, u.phone_number
       FROM ng_orders o JOIN users u ON u.id = o.patient_user_id
       WHERE o.pharmacy_id = $1`;
    const params = [pharmacyId];

    if (status) {
      params.push(status);
      sql += ` AND o.status = $${params.length}`;
    }

    sql += ` ORDER BY o.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limit, offset);

    const result = await pool.query(sql, params);
    return result.rows;
  }
}

module.exports = new OrderService();
