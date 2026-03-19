/**
 * Payment Orchestrator
 * Routes payments to Paystack (primary) or Flutterwave (fallback)
 * Handles split payments, settlements, and reconciliation
 */

const paystackService = require('./paystackService');
const flutterwaveService = require('./flutterwaveService');
const { getPool } = require('../../../server/db');

class PaymentOrchestrator {
  constructor() {
    this.primaryProvider = 'paystack';
    this.fallbackProvider = 'flutterwave';
  }

  /**
   * Generate unique transaction reference
   */
  generateReference(prefix = 'NG-RX') {
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const rand = Math.random().toString(36).substring(2, 8).toUpperCase();
    return `${prefix}-${date}-${rand}`;
  }

  /**
   * Generate order number
   */
  async generateOrderNumber() {
    const pool = getPool();
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const result = await pool.query(
      `SELECT COUNT(*) as count FROM ng_orders WHERE created_at::date = CURRENT_DATE`
    );
    const seq = String(parseInt(result.rows[0].count) + 1).padStart(4, '0');
    return `NG-RX-${date}-${seq}`;
  }

  /**
   * Initialize a payment for an order
   * Uses split payment: pharmacy gets order amount, platform keeps fee
   */
  async initializePayment({
    orderId, email, amount, pharmacySubaccountCode, pharmacySubaccountId,
    platformFee, patientName, patientPhone, paymentMethod = 'card',
    provider = null,
  }) {
    const reference = this.generateReference();
    const callbackUrl = `${process.env.NEXT_PUBLIC_APP_URL}/ng/patient/orders?ref=${reference}`;
    const selectedProvider = provider || this.primaryProvider;

    const metadata = {
      order_id: orderId,
      patient_name: patientName,
      payment_method: paymentMethod,
    };

    try {
      let result;

      if (selectedProvider === 'paystack') {
        const channelMap = {
          card: ['card'],
          bank_transfer: ['bank_transfer'],
          ussd: ['ussd'],
          all: ['card', 'bank', 'ussd', 'bank_transfer'],
        };

        result = await paystackService.initializeTransaction({
          email,
          amount: amount * 100, // Convert to kobo
          reference,
          callbackUrl,
          metadata,
          channels: channelMap[paymentMethod] || channelMap.all,
          subaccountCode: pharmacySubaccountCode,
          platformFee: platformFee * 100,
        });

        return {
          provider: 'paystack',
          reference,
          authorizationUrl: result.data.authorization_url,
          accessCode: result.data.access_code,
        };
      }

      if (selectedProvider === 'flutterwave') {
        result = await flutterwaveService.createPayment({
          txRef: reference,
          amount,
          email,
          phone: patientPhone,
          name: patientName,
          callbackUrl,
          subaccountId: pharmacySubaccountId,
          platformFee,
          metadata,
        });

        return {
          provider: 'flutterwave',
          reference,
          authorizationUrl: result.data.link,
        };
      }

      throw new Error(`Unknown payment provider: ${selectedProvider}`);
    } catch (error) {
      // Fallback to secondary provider
      if (selectedProvider === this.primaryProvider) {
        console.error(`Primary provider (${this.primaryProvider}) failed, falling back:`, error.message);
        return this.initializePayment({
          orderId, email, amount, pharmacySubaccountCode, pharmacySubaccountId,
          platformFee, patientName, patientPhone, paymentMethod,
          provider: this.fallbackProvider,
        });
      }
      throw error;
    }
  }

  /**
   * Verify a payment by reference
   */
  async verifyPayment(reference, provider) {
    if (provider === 'paystack') {
      const result = await paystackService.verifyTransaction(reference);
      return {
        verified: result.data.status === 'success',
        amount: result.data.amount / 100, // Convert from kobo
        channel: result.data.channel,
        paidAt: result.data.paid_at,
        customerEmail: result.data.customer?.email,
        metadata: result.data.metadata,
        raw: result.data,
      };
    }

    if (provider === 'flutterwave') {
      const result = await flutterwaveService.verifyTransaction(reference);
      return {
        verified: result.data.status === 'successful',
        amount: result.data.amount,
        channel: result.data.payment_type,
        paidAt: result.data.created_at,
        customerEmail: result.data.customer?.email,
        metadata: result.data.meta,
        raw: result.data,
      };
    }

    throw new Error(`Unknown provider: ${provider}`);
  }

  /**
   * Process settlement to pharmacy
   */
  async settlePharmacy({ pharmacyId, amount, orderId, provider = 'paystack' }) {
    const pool = getPool();

    // Get pharmacy bank details
    const pharmacy = await pool.query(
      `SELECT bank_code, bank_account_number, bank_account_name, name
       FROM ng_pharmacies WHERE id = $1`,
      [pharmacyId]
    );

    if (!pharmacy.rows.length) throw new Error('Pharmacy not found');
    const p = pharmacy.rows[0];
    const reference = this.generateReference('NG-STL');

    if (provider === 'paystack') {
      // Create transfer recipient if not exists
      const recipient = await paystackService.createTransferRecipient({
        name: p.bank_account_name,
        accountNumber: p.bank_account_number,
        bankCode: p.bank_code,
      });

      const transfer = await paystackService.initiateTransfer({
        amount: amount * 100,
        recipientCode: recipient.data.recipient_code,
        reason: `Settlement for order ${orderId}`,
        reference,
      });

      return { reference, transferCode: transfer.data.transfer_code, provider: 'paystack' };
    }

    if (provider === 'flutterwave') {
      const transfer = await flutterwaveService.initiateTransfer({
        accountBank: p.bank_code,
        accountNumber: p.bank_account_number,
        amount,
        narration: `Settlement for order ${orderId}`,
        reference,
        beneficiaryName: p.bank_account_name,
      });

      return { reference, transferId: transfer.data.id, provider: 'flutterwave' };
    }

    throw new Error(`Unknown provider: ${provider}`);
  }

  /**
   * Process refund
   */
  async processRefund({ paymentReference, amount, provider, reason }) {
    if (provider === 'paystack') {
      return paystackService.createRefund({
        transactionReference: paymentReference,
        amount: amount ? amount * 100 : null,
        reason,
      });
    }

    if (provider === 'flutterwave') {
      return flutterwaveService.createRefund(paymentReference, amount);
    }

    throw new Error(`Unknown provider: ${provider}`);
  }

  /**
   * Calculate platform fees for an order
   */
  calculateFees(subtotal, pharmacyTier = 'basic') {
    const feeRates = {
      basic: { rxFee: 200, marginPercent: 0.05 },
      standard: { rxFee: 150, marginPercent: 0.04 },
      premium: { rxFee: 100, marginPercent: 0.03 },
    };

    const rate = feeRates[pharmacyTier] || feeRates.basic;
    const rxFee = rate.rxFee;
    const marginShare = Math.round(subtotal * rate.marginPercent);
    const vatRate = 0.075; // 7.5% VAT
    const vat = Math.round(subtotal * vatRate);

    return {
      rxFee,
      marginShare,
      platformFee: rxFee + marginShare,
      vat,
      totalFees: rxFee + marginShare + vat,
    };
  }
}

module.exports = new PaymentOrchestrator();
