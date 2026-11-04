/**
 * Flutterwave Payment Service
 * Secondary payment provider for Nigeria — fallback and additional channels
 */

const https = require('https');
const ngConfig = require('../../config');

function flwRequest(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.flutterwave.com',
      port: 443,
      path: `/v3${path}`,
      method,
      headers: {
        Authorization: `Bearer ${ngConfig.flutterwave.secretKey}`,
        'Content-Type': 'application/json',
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.status === 'success') {
            resolve(parsed);
          } else {
            reject(new Error(parsed.message || 'Flutterwave request failed'));
          }
        } catch (e) {
          reject(new Error(`Failed to parse Flutterwave response: ${e.message}`));
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(30000, () => {
      req.destroy();
      reject(new Error('Flutterwave request timeout'));
    });

    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

class FlutterwaveService {
  /**
   * Create a standard payment
   */
  async createPayment({
    txRef, amount, email, phone, name, callbackUrl,
    paymentOptions = 'card,banktransfer,ussd',
    subaccountId = null, platformFee = 0,
    metadata = {},
  }) {
    const body = {
      tx_ref: txRef,
      amount,
      currency: 'NGN',
      redirect_url: callbackUrl,
      payment_options: paymentOptions,
      customer: { email, phonenumber: phone, name },
      customizations: {
        title: 'DoctaRx Nigeria',
        description: 'Medication order payment',
        logo: `${process.env.NEXT_PUBLIC_APP_URL}/logo.png`,
      },
      meta: { ...metadata, platform: 'zuma_teledoc_ng', region: 'NG' },
    };

    if (subaccountId) {
      body.subaccounts = [{ id: subaccountId }];
      // Platform fee is automatically deducted
    }

    return flwRequest('POST', '/payments', body);
  }

  /**
   * Verify a transaction
   */
  async verifyTransaction(transactionId) {
    return flwRequest('GET', `/transactions/${transactionId}/verify`);
  }

  /**
   * Create a subaccount for a pharmacy
   */
  async createSubaccount({
    accountBank, accountNumber, businessName, businessEmail,
    businessContact, businessMobile, splitType = 'flat',
    splitValue = 0, country = 'NG',
  }) {
    return flwRequest('POST', '/subaccounts', {
      account_bank: accountBank,
      account_number: accountNumber,
      business_name: businessName,
      business_email: businessEmail,
      business_contact: businessContact,
      business_mobile: businessMobile,
      split_type: splitType,
      split_value: splitValue,
      country,
    });
  }

  /**
   * Initiate a bank transfer (settlement)
   */
  async initiateTransfer({
    accountBank, accountNumber, amount, narration, reference, beneficiaryName,
  }) {
    return flwRequest('POST', '/transfers', {
      account_bank: accountBank,
      account_number: accountNumber,
      amount,
      narration,
      currency: 'NGN',
      reference,
      beneficiary_name: beneficiaryName,
    });
  }

  /**
   * Get bank list
   */
  async getBanks(country = 'NG') {
    return flwRequest('GET', `/banks/${country}`);
  }

  /**
   * Verify bank account
   */
  async verifyAccount(accountNumber, accountBank) {
    return flwRequest('POST', '/accounts/resolve', {
      account_number: accountNumber,
      account_bank: accountBank,
    });
  }

  /**
   * Create a refund
   */
  async createRefund(transactionId, amount = null) {
    const body = {};
    if (amount) body.amount = amount;
    return flwRequest('POST', `/transactions/${transactionId}/refund`, body);
  }

  /**
   * Verify webhook signature
   */
  verifyWebhookSignature(signature) {
    return signature === ngConfig.flutterwave.webhookSecret;
  }

  /**
   * Handle webhook events
   */
  async handleWebhook(event) {
    const { event: eventType, data } = event;

    switch (eventType) {
      case 'charge.completed':
        if (data.status === 'successful') {
          return { type: 'payment_success', data };
        }
        return { type: 'payment_failed', data };

      case 'transfer.completed':
        return { type: 'settlement_success', data };

      default:
        return { type: 'unknown', data };
    }
  }
}

module.exports = new FlutterwaveService();
