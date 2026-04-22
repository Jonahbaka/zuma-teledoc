const CITY_COORDINATES = {
  abuja: { latitude: 9.0765, longitude: 7.3986, state: 'FCT Abuja' },
  lagos: { latitude: 6.5244, longitude: 3.3792, state: 'Lagos' },
  port_harcourt: { latitude: 4.8156, longitude: 7.0498, state: 'Rivers' },
  warri: { latitude: 5.554, longitude: 5.7932, state: 'Delta' },
  awka: { latitude: 6.2104, longitude: 7.0741, state: 'Anambra' },
  onitsha: { latitude: 6.1498, longitude: 6.7857, state: 'Anambra' },
  uyo: { latitude: 5.0377, longitude: 7.9128, state: 'Akwa Ibom' },
  eket: { latitude: 4.6412, longitude: 7.9321, state: 'Akwa Ibom' },
  sango_ota: { latitude: 6.6872, longitude: 3.2454, state: 'Ogun' },
  arepo: { latitude: 6.6331, longitude: 3.4355, state: 'Ogun' },
};

const STATE_COORDINATES = {
  'akwa ibom': { latitude: 5.0178, longitude: 7.9208 },
  anambra: { latitude: 6.2209, longitude: 6.937 },
  delta: { latitude: 5.532, longitude: 5.8987 },
  lagos: { latitude: 6.5244, longitude: 3.3792 },
  ogun: { latitude: 7.1604, longitude: 3.3508 },
  rivers: { latitude: 4.7497, longitude: 6.8277 },
  'fct abuja': { latitude: 9.0765, longitude: 7.3986 },
  abuja: { latitude: 9.0765, longitude: 7.3986 },
};

const PROVIDER_SYNONYMS = [
  ['hospital', 'hospital'],
  ['hosp', 'hospital'],
  ['clinic', 'clinic'],
  ['medical centre', 'medical center'],
  ['medical center', 'medical center'],
  ['specialist hospital', 'specialist hospital'],
  ['family clinics', 'family clinic'],
  ['eye clinic', 'eye clinic'],
  ['dental clinic', 'dental clinic'],
];

function slugify(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function normalizeText(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[’'`]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-zA-Z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function normalizeProviderName(name) {
  let normalized = normalizeText(name);

  for (const [from, to] of PROVIDER_SYNONYMS) {
    normalized = normalized.replace(new RegExp(`\\b${from}\\b`, 'g'), to);
  }

  return normalized
    .replace(/\b(the|and|limited|ltd|plc|nigeria)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function splitMultiValue(raw) {
  if (!raw) {
    return [];
  }

  return String(raw)
    .split(/[;,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseBoolean(value) {
  if (typeof value === 'boolean') {
    return value;
  }

  const normalized = normalizeText(value);
  return ['true', 'yes', '1'].includes(normalized);
}

function titleCase(value) {
  return String(value || '')
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');
}

function cityKey(value) {
  return slugify(value).replace(/-/g, '_');
}

function getApproximateCoordinates({ city, state }) {
  const exactCity = CITY_COORDINATES[cityKey(city)];
  if (exactCity) {
    return {
      latitude: exactCity.latitude,
      longitude: exactCity.longitude,
      geocodeQuality: 'city_only',
    };
  }

  const exactState = STATE_COORDINATES[normalizeText(state)];
  if (exactState) {
    return {
      latitude: exactState.latitude,
      longitude: exactState.longitude,
      geocodeQuality: 'area',
    };
  }

  return {
    latitude: null,
    longitude: null,
    geocodeQuality: 'unresolved',
  };
}

function haversineDistanceKm(a, b) {
  if (!a?.latitude || !a?.longitude || !b?.latitude || !b?.longitude) {
    return null;
  }

  const toRadians = (degrees) => (degrees * Math.PI) / 180;
  const earthRadiusKm = 6371;
  const latDelta = toRadians(b.latitude - a.latitude);
  const lngDelta = toRadians(b.longitude - a.longitude);
  const lat1 = toRadians(a.latitude);
  const lat2 = toRadians(b.latitude);

  const angle =
    Math.sin(latDelta / 2) * Math.sin(latDelta / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(lngDelta / 2) * Math.sin(lngDelta / 2);

  const c = 2 * Math.atan2(Math.sqrt(angle), Math.sqrt(1 - angle));
  return earthRadiusKm * c;
}

function deriveProviderFlags(providerType, providerName) {
  const type = normalizeText(providerType);
  const name = normalizeText(providerName);
  const haystack = `${type} ${name}`;

  return {
    emergencyCapable: /\bemergency\b/.test(haystack) || /\bhospital\b/.test(type),
    maternityCapable: /\bmaternity\b/.test(haystack) || /\bobs\b/.test(haystack),
    pediatricCapable: /\bpaed\b/.test(haystack) || /\bpediatric\b/.test(haystack),
    opticalCapable: /\beye\b/.test(haystack) || /\boptical\b/.test(haystack),
    dentalCapable: /\bdental\b/.test(haystack),
    gymSpa: /\bgym\b/.test(haystack) || /\bspa\b/.test(haystack),
    pharmacyRelevant: /\bpharmacy\b/.test(haystack),
    labRelevant: /\blab\b/.test(haystack) || /\bdiagnostic\b/.test(haystack),
  };
}

function inferAcceptedPaymentTypes(source) {
  if (normalizeText(source).includes('reliance')) {
    return ['cash', 'self_pay', 'hmo', 'insurance'];
  }

  return ['cash', 'self_pay'];
}

function buildProviderMatchKey({ normalizedName, city, state }) {
  return [normalizedName, normalizeText(city), normalizeText(state)].filter(Boolean).join('::');
}

function scoreProvider({
  provider,
  userLocation,
  query,
  symptomTag,
  preferredProviderType,
  payer,
  mode,
  medicine,
}) {
  const locationDistance = haversineDistanceKm(
    userLocation,
    provider.latitude && provider.longitude
      ? { latitude: provider.latitude, longitude: provider.longitude }
      : null
  );

  let proximity = 0.45;
  if (locationDistance !== null) {
    proximity = Math.max(0, 1 - Math.min(locationDistance, 50) / 50);
  } else if (normalizeText(userLocation?.city) && normalizeText(userLocation.city) === normalizeText(provider.city)) {
    proximity = 0.88;
  } else if (normalizeText(userLocation?.state) && normalizeText(userLocation.state) === normalizeText(provider.state)) {
    proximity = 0.72;
  }

  const typeNeedle = normalizeText(preferredProviderType || mode);
  const typeMatch = typeNeedle && normalizeText(provider.providerType || '').includes(typeNeedle) ? 1 : 0.55;

  const payerMatch = payer
    ? JSON.stringify(provider.insurances || []).toLowerCase().includes(normalizeText(payer)) ||
      (provider.sourceBadges || []).join(' ').toLowerCase().includes(normalizeText(payer))
      ? 1
      : 0
    : 0.5;

  const trustScore = Number(provider.trustScore || 0.5);
  const hoursOpen = provider.telehealthCapable && mode === 'teleconsult' ? 0.9 : 0.6;
  const stockMatch = medicine
    ? provider.providerType === 'pharmacy'
      ? 1
      : provider.pharmacyRelevant
        ? 0.75
        : 0.35
    : 0.5;

  const symptomBonus = symptomTag && JSON.stringify(provider.services || []).toLowerCase().includes(normalizeText(symptomTag)) ? 0.12 : 0;
  const queryBonus = query && normalizeText(provider.canonicalName || '').includes(normalizeText(query)) ? 0.08 : 0;

  const finalScore =
    0.35 * proximity +
    0.2 * typeMatch +
    0.15 * payerMatch +
    0.1 * trustScore +
    0.1 * hoursOpen +
    0.1 * stockMatch +
    symptomBonus +
    queryBonus;

  return {
    finalScore,
    proximity,
    distanceKm: locationDistance,
  };
}

function compactJson(value) {
  return JSON.stringify(value || []);
}

module.exports = {
  CITY_COORDINATES,
  STATE_COORDINATES,
  buildProviderMatchKey,
  compactJson,
  deriveProviderFlags,
  getApproximateCoordinates,
  haversineDistanceKm,
  inferAcceptedPaymentTypes,
  normalizeProviderName,
  normalizeText,
  parseBoolean,
  scoreProvider,
  slugify,
  splitMultiValue,
  titleCase,
};
