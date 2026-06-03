const NIGERIA_MOBILE_RE = /^\+234[789]\d{9}$/;

function cleanPhoneInput(value) {
  return String(value || '').trim().replace(/[\s().-]/g, '');
}

function normalizeNigerianPhoneNumber(value) {
  const cleaned = cleanPhoneInput(value);
  if (!cleaned) return '';

  if (/^\+234\d{10}$/.test(cleaned)) return cleaned;
  if (/^234\d{10}$/.test(cleaned)) return `+${cleaned}`;
  if (/^0\d{10}$/.test(cleaned)) return `+234${cleaned.slice(1)}`;
  if (/^\d{10}$/.test(cleaned)) return `+234${cleaned}`;

  return cleaned;
}

function normalizeNigerianWhatsAppNumber(value) {
  return normalizeNigerianPhoneNumber(value);
}

function isValidNigerianWhatsAppNumber(value) {
  const normalized = normalizeNigerianWhatsAppNumber(value);
  return NIGERIA_MOBILE_RE.test(normalized);
}

function booleanOrFalse(value) {
  return value === true || value === 'true';
}

function toNumberOrNull(value) {
  if (value === undefined || value === null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeLocationPermissionStatus(value) {
  const status = String(value || 'not_requested').trim().toLowerCase();
  if (['granted', 'denied', 'prompt', 'manual', 'unsupported', 'error', 'not_requested'].includes(status)) {
    return status;
  }
  return 'not_requested';
}

function buildNigeriaContactPayload(input = {}) {
  const whatsappNumber = normalizeNigerianWhatsAppNumber(input.whatsappNumber || input.whatsapp || '');
  const serviceConsent = booleanOrFalse(input.whatsappConsentServiceUpdates);
  const marketingConsent = booleanOrFalse(input.whatsappConsentMarketing);
  const locationPermissionStatus = normalizeLocationPermissionStatus(input.locationPermissionStatus);
  const locationLatitude = toNumberOrNull(input.locationLatitude);
  const locationLongitude = toNumberOrNull(input.locationLongitude);
  const locationAccuracy = toNumberOrNull(input.locationAccuracy);
  const now = new Date().toISOString();

  return {
    whatsappNumber: whatsappNumber || null,
    whatsappConsentServiceUpdates: serviceConsent,
    whatsappConsentMarketing: marketingConsent,
    whatsappConsentServiceUpdatesAt: whatsappNumber && serviceConsent
      ? (input.whatsappConsentServiceUpdatesAt || now)
      : null,
    whatsappConsentMarketingAt: whatsappNumber && marketingConsent
      ? (input.whatsappConsentMarketingAt || now)
      : null,
    locationPermissionStatus,
    locationLatitude: locationPermissionStatus === 'granted' ? locationLatitude : null,
    locationLongitude: locationPermissionStatus === 'granted' ? locationLongitude : null,
    locationAccuracy: locationPermissionStatus === 'granted' ? locationAccuracy : null,
    locationCapturedAt: locationPermissionStatus === 'granted'
      ? (input.locationCapturedAt || now)
      : null,
    manualCountry: input.manualCountry || 'Nigeria',
    manualState: input.manualState || input.manualRegion || null,
    manualCity: input.manualCity || null,
    manualLga: input.manualLga || input.lga || null,
    manualArea: input.manualArea || null,
    manualAddress: input.manualAddress || input.addressLine1 || null,
    manualLandmark: input.manualLandmark || null,
    providerServiceRadiusKm: toNumberOrNull(input.providerServiceRadiusKm),
    pharmacyDeliveryAvailable: booleanOrFalse(input.pharmacyDeliveryAvailable),
    pharmacyPickupAvailable: booleanOrFalse(input.pharmacyPickupAvailable),
    labHomeSampleCollectionAvailable: booleanOrFalse(input.labHomeSampleCollectionAvailable),
    publicAddressVisible: booleanOrFalse(input.publicAddressVisible),
  };
}

function validateNigeriaContactPayload(input = {}) {
  const whatsappNumber = input.whatsappNumber || input.whatsapp || '';
  if (whatsappNumber && !isValidNigerianWhatsAppNumber(whatsappNumber)) {
    return {
      valid: false,
      error: 'Enter a valid Nigerian WhatsApp number, for example +2348012345678.',
    };
  }

  if (whatsappNumber && !booleanOrFalse(input.whatsappConsentServiceUpdates)) {
    return {
      valid: false,
      error: 'Service-update consent is required when a WhatsApp number is provided.',
    };
  }

  return { valid: true, error: null };
}

module.exports = {
  buildNigeriaContactPayload,
  isValidNigerianWhatsAppNumber,
  normalizeLocationPermissionStatus,
  normalizeNigerianPhoneNumber,
  normalizeNigerianWhatsAppNumber,
  validateNigeriaContactPayload,
};
