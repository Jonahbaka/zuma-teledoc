/**
 * Paystack Payment Service
 * Handles card, bank transfer, USSD, and mobile money payments for Nigeria
 * Acts as orchestration layer — NOT custodian
 */

const https = require('https');
const ngConfig = require('../../config');

const PAYSTACK_BASE = ngConfig.paystack.baseUrl;
const SECRET_KEY = ngConfig.paystack.secretKey;

// --- HTTP Helper ---
function paystackRequest(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.paystack.co',
      port: 443,
      path,
      method,
      headers: {
        Authorization: `Bearer ${SECRET_KEY}`,
        'Content-Type': 'application/json',
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.status) {
            resolve(parsed);
          } else {
            reject(new Error(parsed.message || 'Paystack request failed'));
          }
        } catch (e) {
          reject(new Error(`Failed to parse Paystack response: ${e.message}`));
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(30000, () => {
      req.destroy();
      reject(new Error('Paystack request timeout'));
    });

    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

class PaystackService {
  /**
   * Initialize a payment transaction
   * @param {Object} params
   * @param {string} params.email - Customer email
   * @param {number} params.amount - Amount in kobo (NGN * 100)
   * @param {string} params.reference - Unique transaction reference
   * @param {string} params.callbackUrl - Redirect URL after payment
   * @param {Object} params.metadata - Additional metadata
   * @param {string[]} params.channels - Payment channels ['card','bank','ussd','bank_transfer']
   * @param {string} params.subaccountCode - Pharmacy subaccount for split payments
   * @param {number} params.platformFee - Platform fee in kobo
   */
  async initializeTransaction({
    email, amount, reference, callbackUrl, metadata = {},
    channels = ['card', 'bank', 'ussd', 'bank_transfer'],
    subaccountCode = null, platformFee = 0,
  }) {
    const body = {
      email,
      amount: Math.round(amount), // Must be in kobo
      reference,
      callback_url: callbackUrl,
      metadata: {
        ...metadata,
        platform: 'zuma_teledoc_ng',
        region: 'NG',
      },
      channels,
      currency: 'NGN',
    };

    // Split payment: pharmacy gets the bulk, platform takes fee
    if (subaccountCode) {
      body.subaccount = subaccountCode;
      body.transaction_charge = platformFee; // Platform keeps this amount
      body.bearer = 'account'; // Main account bears Paystack fees
    }

    return paystackRequest('POST', '/transaction/initialize', body);
  }

  /**
   * Verify a transaction by reference
   */
  async verifyTransaction(reference) {
    return paystackRequest('GET', `/transaction/verify/${encodeURIComponent(reference)}`);
  }

  /**
   * Create a subaccount for a pharmacy (for split payments)
   */
  async createSubaccount({
    businessName, bankCode, accountNumber, percentageCharge = 0,
    description = '', primaryContactEmail, primaryContactPhone, metadata = {},
  }) {
    return paystackRequest('POST', '/subaccount', {
      business_name: businessName,
      bank_code: bankCode,
      account_number: accountNumber,
      percentage_charge: percentageCharge, // We use flat transaction_charge instead
      description,
      primary_contact_email: primaryContactEmail,
      primary_contact_phone: primaryContactPhone,
      metadata,
    });
  }

  /**
   * Update a pharmacy's subaccount
   */
  async updateSubaccount(subaccountCode, updates) {
    return paystackRequest('PUT', `/subaccount/${subaccountCode}`, updates);
  }

  /**
   * List banks for account verification
   */
  async listBanks(country = 'nigeria') {
    return paystackRequest('GET', `/bank?country=${country}&perPage=100`);
  }

  /**
   * Resolve bank account (verify account number + name)
   */
  async resolveAccount(accountNumber, bankCode) {
    return paystackRequest('GET',
      `/bank/resolve?account_number=${accountNumber}&bank_code=${bankCode}`
    );
  }

  /**
   * Initiate a transfer (settlement to pharmacy)
   */
  async initiateTransfer({ amount, recipientCode, reason, reference }) {
    return paystackRequest('POST', '/transfer', {
      source: 'balance',
      amount: Math.round(amount),
      recipient: recipientCode,
      reason,
      reference,
      currency: 'NGN',
    });
  }

  /**
   * Create a transfer recipient (pharmacy bank account)
   */
  async createTransferRecipient({ name, accountNumber, bankCode, currency = 'NGN' }) {
    return paystackRequest('POST', '/transferrecipient', {
      type: 'nuban',
      name,
      account_number: accountNumber,
      bank_code: bankCode,
      currency,
    });
  }

  /**
   * Verify webhook signature
   */
  verifyWebhookSignature(body, signature) {
    const crypto = require('crypto');
    const hash = crypto
      .createHmac('sha512', ngConfig.paystack.webhookSecret)
      .update(JSON.stringify(body))
      .digest('hex');
    return hash === signature;
  }

  /**
   * Handle Paystack webhook events
   */
  async handleWebhook(event) {
    const { event: eventType, data } = event;

    switch (eventType) {
      case 'charge.success':
        return { type: 'payment_success', data };

      case 'transfer.success':
        return { type: 'settlement_success', data };

      case 'transfer.failed':
        return { type: 'settlement_failed', data };

      case 'transfer.reversed':
        return { type: 'settlement_reversed', data };

      case 'refund.processed':
        return { type: 'refund_success', data };

      default:
        return { type: 'unknown', data };
    }
  }

  /**
   * Create a refund
   */
  async createRefund({ transactionReference, amount = null, reason = '' }) {
    const body = { transaction: transactionReference };
    if (amount) body.amount = Math.round(amount);
    if (reason) body.merchant_note = reason;
    return paystackRequest('POST', '/refund', body);
  }

  /**
   * Generate a USSD payment code
   */
  async generateUssdCode({ email, amount, reference }) {
    return this.initializeTransaction({
      email,
      amount,
      reference,
      channels: ['ussd'],
      callbackUrl: `${process.env.NEXT_PUBLIC_APP_URL}/ng/patient/orders`,
    });
  }
}

module.exports = new PaystackService();
