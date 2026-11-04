const crypto = require('crypto');
const { getPool } = require('../../../server/db');
const {
  getNigeriaConsultationPriceList,
} = require('../../../lib/ngConsultationPricing.cjs');
const {
  buildNigeriaContactPayload,
  validateNigeriaContactPayload,
} = require('../../../lib/nigeriaContact');

const NIGERIA_PENDING_MESSAGE =
  'This feature is not yet available in Nigeria. DoctaRx Nigeria is preparing this capability for future rollout.';

const PATIENT_PLANS = [
  { code: 'patient_basic', name: 'Basic', priceMonthly: 1000, consultationsIncluded: 0 },
  { code: 'patient_standard', name: 'Standard', priceMonthly: 2500, consultationsIncluded: 1 },
  { code: 'patient_premium', name: 'Premium', priceMonthly: 5000, consultationsIncluded: 'fair_use' },
];

const ORGANIZATION_PER_MEMBER = [
  { code: 'org_small_per_member', label: 'Small organization', maxMembers: 50, pricePerMember: 2000 },
  { code: 'org_medium_per_member', label: 'Medium organization', maxMembers: 200, pricePerMember: 1500 },
  { code: 'org_large_per_member', label: 'Large organization', maxMembers: null, pricePerMember: 1000 },
];

const ORGANIZATION_BUNDLES = [
  { code: 'org_starter_bundle', name: 'Starter', memberLimit: 25, priceMonthly: 40000 },
  { code: 'org_growth_bundle', name: 'Growth', memberLimit: 100, priceMonthly: 120000 },
  { code: 'org_enterprise_custom', name: 'Enterprise', memberLimit: null, priceMonthly: null },
];

const ORGANIZATION_ADD_ONS = [
  { code: 'priority_access', name: 'Priority doctor access', pricePerMember: 500 },
  { code: 'chronic_care', name: 'Chronic care plan', pricePerMember: 1000 },
  { code: 'ai_analytics', name: 'AI health analytics dashboard', customPricing: true },
  { code: 'health_campaigns', name: 'On-site/community health campaigns', minPrice: 100000, maxPrice: 1000000 },
];

const PHARMACY_PLANS = [
  { code: 'pharmacy_saas_basic', name: 'Pharmacy SaaS Basic', priceMonthly: 10000 },
  { code: 'pharmacy_saas_growth', name: 'Pharmacy SaaS Growth', priceMonthly: 30000 },
  { code: 'pharmacy_saas_premium', name: 'Pharmacy SaaS Premium', priceMonthly: 50000 },
  { code: 'pharmacy_commission', name: 'Per-order commission', commission: true },
];

const PROVIDER_PLANS = [
  { code: 'provider_basic', name: 'Provider Basic', priceMonthly: 10000 },
  { code: 'provider_standard', name: 'Provider Standard', priceMonthly: 20000 },
  { code: 'provider_premium', name: 'Provider Premium', priceMonthly: 30000 },
  { code: 'provider_commission', name: 'Per-consult commission', commissionRange: '10%-20%' },
];

const MARKETPLACE_PRICING = [
  { code: 'featured_hospital', name: 'Featured hospitals', monthlyRange: '20000-200000' },
  { code: 'featured_pharmacy', name: 'Featured pharmacies', monthlyRange: '20000-200000' },
  { code: 'featured_provider', name: 'Featured providers', monthlyRange: '20000-200000' },
  { code: 'sponsored_medication', name: 'Sponsored medication placement', customPricing: true },
];

function slugify(value = '') {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 80);
}

function generateReference(prefix) {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const random = crypto.randomBytes(4).toString('hex').toUpperCase();
  return `${prefix}-${date}-${random}`;
}

function normalizeOrganizationType(value) {
  const normalized = String(value || '').trim().toLowerCase();
  const mappings = {
    corporate: 'company',
    company: 'company',
    government_phc: 'government',
    phc: 'government',
    government: 'government',
    hmo: 'association',
    clinic_group: 'clinic',
    hospital_group: 'hospital',
    ngo: 'ngo',
    school: 'school',
    church: 'church',
    mosque: 'mosque',
  };
  return mappings[normalized] || 'other';
}

function getOrganizationTier(memberCount = 0) {
  const members = Number(memberCount || 0);
  return ORGANIZATION_PER_MEMBER.find((tier) => !tier.maxMembers || members <= tier.maxMembers) || ORGANIZATION_PER_MEMBER[2];
}

function calculateOrganizationQuote({
  memberCount = 0,
  billingMode = 'per_member',
  bundleCode,
  addOns = [],
  billingCycle = 'monthly',
  customMonthlyPrice,
} = {}) {
  const members = Math.max(Number(memberCount || 0), 0);
  const selectedAddOns = ORGANIZATION_ADD_ONS.filter((addOn) => addOns.includes(addOn.code));
  const addOnMonthly = selectedAddOns.reduce((total, addOn) => {
    if (addOn.pricePerMember) return total + addOn.pricePerMember * members;
    return total;
  }, 0);

  let monthlySubtotal = Number(customMonthlyPrice || 0);
  let planCode = 'custom_contract';
  let label = 'Custom contract';

  if (!customMonthlyPrice && billingMode === 'bundle') {
    const bundle = ORGANIZATION_BUNDLES.find((item) => item.code === bundleCode) || ORGANIZATION_BUNDLES[0];
    monthlySubtotal = bundle.priceMonthly || 0;
    planCode = bundle.code;
    label = bundle.name;
  }

  if (!customMonthlyPrice && billingMode !== 'bundle') {
    const tier = getOrganizationTier(members);
    monthlySubtotal = tier.pricePerMember * members;
    planCode = tier.code;
    label = tier.label;
  }

  const monthlyTotal = monthlySubtotal + addOnMonthly;
  const annual = billingCycle === 'annual';
  const annualDiscount = annual ? Math.round(monthlyTotal * 12 * 0.1) : 0;
  const amountDue = annual ? monthlyTotal * 12 - annualDiscount : monthlyTotal;

  return {
    memberCount: members,
    billingMode,
    billingCycle,
    planCode,
    label,
    monthlySubtotal,
    addOnMonthly,
    monthlyTotal,
    annualDiscount,
    amountDue,
    addOns: selectedAddOns,
  };
}

function getPaymentReadiness() {
  const paystackConfigured = Boolean(process.env.PAYSTACK_SECRET_KEY && process.env.PAYSTACK_PUBLIC_KEY);
  const flutterwaveConfigured = Boolean(process.env.FLUTTERWAVE_SECRET_KEY && process.env.FLUTTERWAVE_PUBLIC_KEY);

  return {
    paystack: {
      configured: paystackConfigured,
      status: paystackConfigured ? 'configured' : 'unavailable',
      currency: 'NGN',
    },
    flutterwave: {
      configured: flutterwaveConfigured,
      status: flutterwaveConfigured ? 'configured' : 'unavailable',
      currency: 'NGN',
    },
  };
}

function getPricingCatalog() {
  return {
    currency: 'NGN',
    consultations: getNigeriaConsultationPriceList(),
    individual: PATIENT_PLANS,
    organization: {
      perMember: ORGANIZATION_PER_MEMBER,
      bundles: ORGANIZATION_BUNDLES,
      addOns: ORGANIZATION_ADD_ONS,
    },
    pharmacy: PHARMACY_PLANS,
    provider: PROVIDER_PLANS,
    marketplace: MARKETPLACE_PRICING,
    enterprise: {
      range: '500000-5000000+',
      billing: 'annual_or_custom',
      supportedTypes: ['hmo', 'hospital', 'government', 'enterprise', 'school', 'church', 'ngo'],
    },
    medicationRevenue: {
      pharmacyMarginPercent: { min: 5, max: 20 },
      dispenseFee: { min: 200, max: 500 },
      deliveryFee: 'configured_per_order',
      sponsoredMedicationPlacement: 'admin_controlled',
      fulfillmentCommission: 'contract_controlled',
    },
    payments: getPaymentReadiness(),
  };
}

async function registerOrganization(userId, payload = {}) {
  const pool = getPool();
  const slugBase = slugify(payload.name || 'organization');
  const slug = `${slugBase}-${crypto.randomBytes(3).toString('hex')}`;
  const contactPayload = buildNigeriaContactPayload({
    ...payload,
    whatsappNumber: payload.whatsappNumber || payload.whatsapp,
  });
  const contactValidation = validateNigeriaContactPayload(contactPayload);
  if (!contactValidation.valid) {
    const error = new Error(contactValidation.error);
    error.statusCode = 400;
    throw error;
  }

  const insertFields = [
    ['name', payload.name],
    ['slug', slug],
    ['organization_type', normalizeOrganizationType(payload.organizationType)],
    ['owner_user_id', userId || null],
    ['contact_name', payload.contactName || null],
    ['contact_email', payload.contactEmail || null],
    ['contact_phone', payload.contactPhone || null],
    ['whatsapp_number', contactPayload.whatsappNumber || null],
    ['whatsapp_consent_service_updates', Boolean(contactPayload.whatsappConsentServiceUpdates)],
    ['whatsapp_consent_service_updates_at', contactPayload.whatsappConsentServiceUpdatesAt || null],
    ['whatsapp_consent_marketing', Boolean(contactPayload.whatsappConsentMarketing)],
    ['whatsapp_consent_marketing_at', contactPayload.whatsappConsentMarketingAt || null],
    ['location_permission_status', contactPayload.locationPermissionStatus || 'not_requested'],
    ['latitude', contactPayload.locationLatitude || payload.latitude || null],
    ['longitude', contactPayload.locationLongitude || payload.longitude || null],
    ['location_accuracy', contactPayload.locationAccuracy || null],
    ['location_captured_at', contactPayload.locationCapturedAt || null],
    ['manual_country', contactPayload.manualCountry || 'Nigeria'],
    ['manual_state', contactPayload.manualState || payload.state || null],
    ['manual_city', contactPayload.manualCity || payload.city || null],
    ['manual_lga', contactPayload.manualLga || payload.lga || null],
    ['manual_area', contactPayload.manualArea || null],
    ['manual_address', contactPayload.manualAddress || payload.addressLine1 || null],
    ['manual_landmark', contactPayload.manualLandmark || null],
    ['public_address_visible', Boolean(contactPayload.publicAddressVisible)],
    ['onboarding_contact_metadata', {
      source: 'ng_organization_registration',
      marketScope: 'NG',
      requestedOrganizationType: payload.organizationType || null,
    }],
    ['address_line1', payload.addressLine1 || null],
    ['address_line2', payload.addressLine2 || null],
    ['city', payload.city || null],
    ['lga', payload.lga || null],
    ['state', payload.state || null],
    ['billing_email', payload.billingEmail || payload.contactEmail || null],
    ['default_plan_code', payload.planCode || null],
    ['default_billing_cycle', payload.billingCycle || 'monthly'],
    ['custom_contract', payload.customContract || {}],
  ];
  const insertColumns = insertFields.map(([column]) => column).join(', ');
  const insertPlaceholders = insertFields.map((_, index) => `$${index + 1}`).join(',');
  const insertValues = insertFields.map(([, value]) => value);
  const result = await pool.query(
    `INSERT INTO ng_organizations (${insertColumns})
     VALUES (${insertPlaceholders})
     RETURNING *`,
    insertValues
  );

  await pool.query(
    `INSERT INTO ng_corporate_accounts (organization_id, account_type, consultation_credits, credit_balance, subscription_status)
     VALUES ($1, $2, $3, $3, $4)
     ON CONFLICT (organization_id) DO NOTHING`,
    [result.rows[0].id, payload.accountType || 'sponsor_paid', Number(payload.consultationCredits || 0), 'trial']
  );

  return result.rows[0];
}

async function registerHospital(userId, payload = {}) {
  const pool = getPool();
  const slugBase = slugify(payload.name || 'facility');
  const slug = `${slugBase}-${crypto.randomBytes(3).toString('hex')}`;
  const contactPayload = buildNigeriaContactPayload({
    ...payload,
    whatsappNumber: payload.whatsappNumber || payload.whatsapp,
  });
  const contactValidation = validateNigeriaContactPayload(contactPayload);
  if (!contactValidation.valid) {
    const error = new Error(contactValidation.error);
    error.statusCode = 400;
    throw error;
  }
  const isLabFacility = ['lab', 'laboratory', 'diagnostic', 'diagnostic_center'].includes(
    String(payload.facilityType || '').toLowerCase()
  );

  const insertFields = [
    ['name', payload.name],
    ['slug', slug],
    ['facility_type', payload.facilityType || 'clinic'],
    ['address_line1', payload.addressLine1 || null],
    ['address_line2', payload.addressLine2 || null],
    ['city', payload.city || null],
    ['lga', payload.lga || null],
    ['state', payload.state || null],
    ['latitude', contactPayload.locationLatitude || payload.latitude || null],
    ['longitude', contactPayload.locationLongitude || payload.longitude || null],
    ['contact_person_name', payload.contactPersonName || null],
    ['contact_person_email', payload.contactPersonEmail || null],
    ['contact_person_phone', payload.contactPersonPhone || null],
    ['whatsapp_number', contactPayload.whatsappNumber || payload.whatsapp || null],
    ['whatsapp_consent_service_updates', Boolean(contactPayload.whatsappConsentServiceUpdates)],
    ['whatsapp_consent_service_updates_at', contactPayload.whatsappConsentServiceUpdatesAt || null],
    ['whatsapp_consent_marketing', Boolean(contactPayload.whatsappConsentMarketing)],
    ['whatsapp_consent_marketing_at', contactPayload.whatsappConsentMarketingAt || null],
    ['location_permission_status', contactPayload.locationPermissionStatus || 'not_requested'],
    ['location_accuracy', contactPayload.locationAccuracy || null],
    ['location_captured_at', contactPayload.locationCapturedAt || null],
    ['manual_country', contactPayload.manualCountry || 'Nigeria'],
    ['manual_state', contactPayload.manualState || payload.state || null],
    ['manual_city', contactPayload.manualCity || payload.city || null],
    ['manual_lga', contactPayload.manualLga || payload.lga || null],
    ['manual_area', contactPayload.manualArea || null],
    ['manual_address', contactPayload.manualAddress || payload.addressLine1 || null],
    ['manual_landmark', contactPayload.manualLandmark || null],
    ['provider_service_radius_km', contactPayload.providerServiceRadiusKm || payload.providerServiceRadiusKm || null],
    ['lab_home_sample_collection_available', Boolean(contactPayload.labHomeSampleCollectionAvailable || payload.labHomeSampleCollectionAvailable)],
    ['public_address_visible', Boolean(contactPayload.publicAddressVisible)],
    ['onboarding_contact_metadata', { source: isLabFacility ? 'ng_lab_onboarding' : 'ng_facility_onboarding', marketScope: 'NG' }],
    ['license_number', payload.licenseNumber || null],
    ['registration_authority', payload.registrationAuthority || null],
    ['license_document_url', payload.licenseDocumentUrl || null],
    ['departments', payload.departments || []],
    ['integration_status', payload.integrationStatus || 'pending'],
  ];
  const insertColumns = insertFields.map(([column]) => column).join(', ');
  const insertPlaceholders = insertFields.map((_, index) => `$${index + 1}`).join(',');
  const insertValues = insertFields.map(([, value]) => value);
  const result = await pool.query(
    `INSERT INTO ng_hospitals (${insertColumns})
     VALUES (${insertPlaceholders})
     RETURNING *`,
    insertValues
  );

  if (userId) {
    await pool.query(
      `INSERT INTO ng_hospital_staff (hospital_id, user_id, role, status)
       VALUES ($1, $2, 'facility_admin', 'active')`,
      [result.rows[0].id, userId]
    );
  }

  return result.rows[0];
}

async function getMySubscription(user) {
  const pool = getPool();
  const result = await pool.query(
    `SELECT s.*, p.name AS plan_name, p.audience, p.features
     FROM ng_subscriptions s
     LEFT JOIN ng_subscription_plans p ON p.id = s.plan_id OR p.code = s.plan_code
     WHERE s.user_id = $1 OR s.provider_user_id = $1
     ORDER BY s.created_at DESC
     LIMIT 1`,
    [user.id]
  );
  return result.rows[0] || null;
}

async function createSubscriptionIntent(user, payload = {}) {
  const pool = getPool();
  const plan = await pool.query(
    'SELECT * FROM ng_subscription_plans WHERE code = $1 AND status = $2',
    [payload.planCode, 'active']
  );
  if (!plan.rows.length) {
    const error = new Error('Subscription plan not found or inactive');
    error.statusCode = 404;
    throw error;
  }

  const subscriberType = payload.subscriberType || plan.rows[0].audience;
  const organizationId = ['organization', 'enterprise'].includes(subscriberType) ? payload.organizationId || null : null;
  const pharmacyId = subscriberType === 'pharmacy' ? payload.pharmacyId || null : null;
  const hospitalId = subscriberType === 'hospital' ? payload.hospitalId || null : null;

  const subscription = await pool.query(
    `INSERT INTO ng_subscriptions (
       plan_id, plan_code, subscriber_type, user_id, organization_id, pharmacy_id, hospital_id,
       provider_user_id, status, billing_cycle, member_count, custom_price_monthly, custom_contract,
       current_period_start, current_period_end
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,'pending',$9,$10,$11,$12,NOW(),
       CASE WHEN $9 = 'annual' THEN NOW() + INTERVAL '1 year' ELSE NOW() + INTERVAL '1 month' END
     )
     RETURNING *`,
    [
      plan.rows[0].id,
      plan.rows[0].code,
      subscriberType,
      subscriberType === 'patient' ? user.id : null,
      organizationId,
      pharmacyId,
      hospitalId,
      subscriberType === 'provider' ? user.id : null,
      payload.billingCycle || 'monthly',
      payload.memberCount || null,
      payload.customPriceMonthly || null,
      payload.customContract || {},
    ]
  );

  return subscription.rows[0];
}

async function createDraftInvoice({ subscriptionId, billToType, billToId, amount, lineItems = [], createdBy }) {
  const pool = getPool();
  const invoiceNumber = generateReference('NG-INV');
  const result = await pool.query(
    `INSERT INTO ng_invoices (
       invoice_number, subscription_id, bill_to_type, bill_to_id, amount_subtotal,
       amount_total, status, due_at, line_items, created_by
     ) VALUES ($1,$2,$3,$4,$5,$5,'draft',NOW() + INTERVAL '14 days',$6,$7)
     RETURNING *`,
    [invoiceNumber, subscriptionId || null, billToType, billToId || null, Number(amount || 0), lineItems, createdBy || null]
  );
  return result.rows[0];
}

async function createPaymentIntent({ invoiceId, subscriptionId, orderId, paymentType, amount, provider }) {
  const readiness = getPaymentReadiness();
  const selectedProvider = provider || (readiness.paystack.configured ? 'paystack' : 'flutterwave');

  if (!readiness[selectedProvider]?.configured) {
    const error = new Error(`${selectedProvider} is not configured. Payment cannot be initialized.`);
    error.statusCode = 503;
    throw error;
  }

  const pool = getPool();
  const reference = generateReference(selectedProvider === 'paystack' ? 'NG-PSK' : 'NG-FLW');
  const result = await pool.query(
    `INSERT INTO ng_payments (
       invoice_id, subscription_id, order_id, payment_type, amount, provider, provider_reference, status
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,'requires_action')
     RETURNING *`,
    [invoiceId || null, subscriptionId || null, orderId || null, paymentType || 'subscription', Number(amount || 0), selectedProvider, reference]
  );

  return {
    payment: result.rows[0],
    status: 'requires_action',
    provider: selectedProvider,
    reference,
    authorizationUrl: null,
    message: 'Payment record created. Complete provider-specific initialization before redirecting the user.',
  };
}

async function getProviderEarnings(providerUserId) {
  const pool = getPool();
  const result = await pool.query(
    `SELECT
       COUNT(*) AS total_entries,
       COALESCE(SUM(gross_amount), 0) AS gross_amount,
       COALESCE(SUM(commission_amount), 0) AS commission_amount,
       COALESCE(SUM(net_amount), 0) AS net_amount,
       COUNT(*) FILTER (WHERE payout_status = 'pending') AS pending_payouts
     FROM ng_provider_earnings
     WHERE provider_user_id = $1`,
    [providerUserId]
  );

  const recent = await pool.query(
    `SELECT * FROM ng_provider_earnings
     WHERE provider_user_id = $1
     ORDER BY earned_at DESC
     LIMIT 20`,
    [providerUserId]
  );

  return {
    summary: result.rows[0],
    recent: recent.rows,
  };
}

function getInteroperabilityCapabilities() {
  return {
    fhirR4Resources: ['Patient', 'Practitioner', 'Organization', 'MedicationRequest', 'Encounter', 'DiagnosticReport', 'Observation', 'Referral'],
    smartOnFhir: {
      authStyle: 'oauth2_smart_on_fhir_ready',
      status: 'pending',
      liveIntegrationClaimed: false,
    },
    bidirectionalExchange: [
      'sending_referrals',
      'receiving_care_summaries',
      'syncing_medications',
      'syncing_lab_results',
      'syncing_health_records',
      'sharing_encounter_summaries',
    ],
    allowedStatuses: ['active', 'pending', 'sandbox', 'unavailable', 'configured', 'error'],
  };
}

module.exports = {
  NIGERIA_PENDING_MESSAGE,
  calculateOrganizationQuote,
  createDraftInvoice,
  createPaymentIntent,
  createSubscriptionIntent,
  getInteroperabilityCapabilities,
  getMySubscription,
  getOrganizationTier,
  getPaymentReadiness,
  getPricingCatalog,
  getProviderEarnings,
  registerHospital,
  registerOrganization,
};
