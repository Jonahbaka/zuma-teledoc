/**
 * Multi-Region Configuration
 * Defines region-specific settings for US and Nigeria (extensible to other African markets)
 */

const REGIONS = {
  US: {
    code: 'US',
    name: 'United States',
    currency: 'USD',
    currencySymbol: '$',
    locale: 'en-US',
    timezone: 'America/New_York',
    paymentProviders: ['stripe'],
    compliance: ['HIPAA', 'HITECH'],
    phonePrefix: '+1',
    dateFormat: 'MM/DD/YYYY',
    drugDatabase: 'FDA',
    prescriptionFormat: 'NCPDP',
    insuranceSystem: 'US_PRIVATE',
    taxRate: 0,
    features: {
      telemedicine: true,
      ePrescribing: true,
      insurance: true,
      pharmacy: true,
      aiTriage: true,
      videoConsult: true,
    },
  },

  NG: {
    code: 'NG',
    name: 'Nigeria',
    currency: 'NGN',
    currencySymbol: '₦',
    locale: 'en-NG',
    timezone: 'Africa/Lagos',
    paymentProviders: ['paystack', 'flutterwave'],
    compliance: ['PCN', 'NDPA', 'NAFDAC'],
    phonePrefix: '+234',
    dateFormat: 'DD/MM/YYYY',
    drugDatabase: 'NAFDAC',
    prescriptionFormat: 'NG_RX',
    insuranceSystem: 'NHIS',
    taxRate: 0.075, // 7.5% VAT
    features: {
      telemedicine: false, // Phase 2
      ePrescribing: true,
      insurance: false, // Phase 2 (NHIS)
      pharmacy: true,
      aiTriage: false, // Phase 2
      videoConsult: false, // Phase 2
      deliveryTracking: true,
      ussd: true,
      bankTransfer: true,
    },
    states: [
      'Abia', 'Adamawa', 'Akwa Ibom', 'Anambra', 'Bauchi', 'Bayelsa', 'Benue',
      'Borno', 'Cross River', 'Delta', 'Ebonyi', 'Edo', 'Ekiti', 'Enugu', 'FCT',
      'Gombe', 'Imo', 'Jigawa', 'Kaduna', 'Kano', 'Katsina', 'Kebbi', 'Kogi',
      'Kwara', 'Lagos', 'Nasarawa', 'Niger', 'Ogun', 'Ondo', 'Osun', 'Oyo',
      'Plateau', 'Rivers', 'Sokoto', 'Taraba', 'Yobe', 'Zamfara',
    ],
    deliveryPartners: ['gokada', 'kwik', 'maxng'],
    subscriptionTiers: {
      basic: { price: 20000, label: 'Basic (₦20,000/mo)' },
      standard: { price: 50000, label: 'Standard (₦50,000/mo)' },
      premium: { price: 100000, label: 'Premium (₦100,000/mo)' },
    },
    rxFees: {
      min: 100,
      max: 500,
      default: 200,
    },
  },
};

function getRegion(code) {
  const region = REGIONS[code?.toUpperCase()];
  if (!region) throw new Error(`Unknown region: ${code}`);
  return region;
}

function getRegionFromPhone(phone) {
  if (phone.startsWith('+234') || phone.startsWith('234')) return REGIONS.NG;
  if (phone.startsWith('+1') || phone.startsWith('1')) return REGIONS.US;
  return null;
}

module.exports = { REGIONS, getRegion, getRegionFromPhone };
