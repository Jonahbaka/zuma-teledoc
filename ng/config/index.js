/**
 * Nigeria Region Configuration
 * All environment variables and constants for the NG deployment
 */

const config = {
  region: 'NG',

  // Paystack
  paystack: {
    secretKey: process.env.PAYSTACK_SECRET_KEY,
    publicKey: process.env.PAYSTACK_PUBLIC_KEY,
    webhookSecret: process.env.PAYSTACK_WEBHOOK_SECRET,
    baseUrl: 'https://api.paystack.co',
    currency: 'NGN',
    channels: ['card', 'bank', 'ussd', 'bank_transfer', 'mobile_money'],
  },

  // Flutterwave
  flutterwave: {
    secretKey: process.env.FLUTTERWAVE_SECRET_KEY,
    publicKey: process.env.FLUTTERWAVE_PUBLIC_KEY,
    webhookSecret: process.env.FLUTTERWAVE_WEBHOOK_SECRET,
    encryptionKey: process.env.FLUTTERWAVE_ENCRYPTION_KEY,
    baseUrl: 'https://api.flutterwave.com/v3',
    currency: 'NGN',
  },

  // Pharmacy
  pharmacy: {
    pcnVerificationUrl: process.env.PCN_VERIFICATION_URL || 'https://www.pcn.gov.ng',
    nafdacApiUrl: process.env.NAFDAC_API_URL,
    maxDeliveryRadiusKm: 25,
    defaultMarkupPercent: 15,
    minOrderAmount: 500, // ₦500
    maxOrderAmount: 5000000, // ₦5,000,000
    settlementDays: 3, // T+3 settlement
  },

  // Delivery
  delivery: {
    gokada: {
      apiKey: process.env.GOKADA_API_KEY,
      baseUrl: process.env.GOKADA_API_URL || 'https://api.gokada.ng/v1',
    },
    kwik: {
      apiKey: process.env.KWIK_API_KEY,
      baseUrl: process.env.KWIK_API_URL || 'https://api.kwik.delivery/v1',
    },
    maxng: {
      apiKey: process.env.MAXNG_API_KEY,
      baseUrl: process.env.MAXNG_API_URL || 'https://api.max.ng/v1',
    },
    defaultProvider: 'gokada',
    baseFee: 500, // ₦500
    perKmFee: 100, // ₦100/km
    maxDistance: 25, // km
  },

  // Compliance
  compliance: {
    ndpaOfficer: process.env.NDPA_OFFICER_EMAIL,
    pcnRegistrationRequired: true,
    superintendentPharmacistRequired: true,
    auditRetentionDays: 2555, // ~7 years
    controlledSubstanceClasses: ['Schedule I', 'Schedule II', 'Schedule III', 'Schedule IV', 'Schedule V'],
  },

  // SMS (for USSD / OTP)
  sms: {
    provider: process.env.SMS_PROVIDER || 'termii',
    termii: {
      apiKey: process.env.TERMII_API_KEY,
      senderId: process.env.TERMII_SENDER_ID || 'ZumaRx',
      baseUrl: 'https://api.ng.termii.com/api',
    },
  },

  // AI / OCR
  ai: {
    prescriptionOcrEnabled: true,
    drugRecommendationEnabled: true,
  },
};

module.exports = config;
