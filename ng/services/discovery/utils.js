const CITY_COORDINATES = {
  abuja: { latitude: 9.0765, longitude: 7.3986, state: 'FCT Abuja' },
  lagos: { latitude: 6.5244, longitude: 3.3792, state: 'Lagos' },
  ikeja: { latitude: 6.6018, longitude: 3.3515, state: 'Lagos' },
  lekki: { latitude: 6.4698, longitude: 3.5852, state: 'Lagos' },
  ikorodu: { latitude: 6.6194, longitude: 3.5105, state: 'Lagos' },
  port_harcourt: { latitude: 4.8156, longitude: 7.0498, state: 'Rivers' },
  ibadan: { latitude: 7.3775, longitude: 3.947, state: 'Oyo' },
  kano: { latitude: 12.0022, longitude: 8.592, state: 'Kano' },
  kaduna: { latitude: 10.5105, longitude: 7.4165, state: 'Kaduna' },
  enugu: { latitude: 6.5244, longitude: 7.5086, state: 'Enugu' },
  benin: { latitude: 6.335, longitude: 5.6037, state: 'Edo' },
  benin_city: { latitude: 6.335, longitude: 5.6037, state: 'Edo' },
  ilorin: { latitude: 8.4966, longitude: 4.5421, state: 'Kwara' },
  jos: { latitude: 9.8965, longitude: 8.8583, state: 'Plateau' },
  maiduguri: { latitude: 11.8311, longitude: 13.151, state: 'Borno' },
  aba: { latitude: 5.1216, longitude: 7.3733, state: 'Abia' },
  umuahia: { latitude: 5.5249, longitude: 7.4946, state: 'Abia' },
  warri: { latitude: 5.554, longitude: 5.7932, state: 'Delta' },
  asaba: { latitude: 6.2059, longitude: 6.6959, state: 'Delta' },
  awka: { latitude: 6.2104, longitude: 7.0741, state: 'Anambra' },
  onitsha: { latitude: 6.1498, longitude: 6.7857, state: 'Anambra' },
  uyo: { latitude: 5.0377, longitude: 7.9128, state: 'Akwa Ibom' },
  eket: { latitude: 4.6412, longitude: 7.9321, state: 'Akwa Ibom' },
  calabar: { latitude: 4.9757, longitude: 8.3417, state: 'Cross River' },
  abeokuta: { latitude: 7.1475, longitude: 3.3619, state: 'Ogun' },
  sango_ota: { latitude: 6.6872, longitude: 3.2454, state: 'Ogun' },
  arepo: { latitude: 6.6331, longitude: 3.4355, state: 'Ogun' },
  akure: { latitude: 7.2571, longitude: 5.2058, state: 'Ondo' },
  ado_ekiti: { latitude: 7.6211, longitude: 5.2215, state: 'Ekiti' },
  osogbo: { latitude: 7.7827, longitude: 4.5418, state: 'Osun' },
  lokoja: { latitude: 7.8023, longitude: 6.7333, state: 'Kogi' },
  makurdi: { latitude: 7.7322, longitude: 8.5391, state: 'Benue' },
  lafia: { latitude: 8.4961, longitude: 8.5166, state: 'Nasarawa' },
  minna: { latitude: 9.6139, longitude: 6.5569, state: 'Niger' },
  sokoto: { latitude: 13.0059, longitude: 5.2476, state: 'Sokoto' },
  katsina: { latitude: 12.9908, longitude: 7.6018, state: 'Katsina' },
  birnin_kebbi: { latitude: 12.4539, longitude: 4.1975, state: 'Kebbi' },
  yola: { latitude: 9.2035, longitude: 12.4954, state: 'Adamawa' },
  jalingo: { latitude: 8.8937, longitude: 11.3596, state: 'Taraba' },
  damaturu: { latitude: 11.7469, longitude: 11.9608, state: 'Yobe' },
  dutse: { latitude: 11.7594, longitude: 9.3392, state: 'Jigawa' },
  gombe: { latitude: 10.2897, longitude: 11.1673, state: 'Gombe' },
  bauchi: { latitude: 10.3158, longitude: 9.8442, state: 'Bauchi' },
  yenagoa: { latitude: 4.9247, longitude: 6.2642, state: 'Bayelsa' },
  owerri: { latitude: 5.4891, longitude: 7.0176, state: 'Imo' },
  abakaliki: { latitude: 6.3249, longitude: 8.1137, state: 'Ebonyi' },
  gusau: { latitude: 12.1628, longitude: 6.6614, state: 'Zamfara' },
};

const STATE_COORDINATES = {
  abia: { latitude: 5.4527, longitude: 7.5248 },
  adamawa: { latitude: 9.3265, longitude: 12.3984 },
  'akwa ibom': { latitude: 5.0178, longitude: 7.9208 },
  anambra: { latitude: 6.2209, longitude: 6.937 },
  bauchi: { latitude: 10.7761, longitude: 9.9992 },
  bayelsa: { latitude: 4.7719, longitude: 6.0699 },
  benue: { latitude: 7.3369, longitude: 8.7404 },
  borno: { latitude: 11.8846, longitude: 13.1519 },
  'cross river': { latitude: 5.8702, longitude: 8.5988 },
  delta: { latitude: 5.532, longitude: 5.8987 },
  ebonyi: { latitude: 6.2649, longitude: 8.0137 },
  edo: { latitude: 6.5438, longitude: 5.8987 },
  ekiti: { latitude: 7.7189, longitude: 5.3103 },
  enugu: { latitude: 6.5364, longitude: 7.4356 },
  fct: { latitude: 9.0765, longitude: 7.3986 },
  lagos: { latitude: 6.5244, longitude: 3.3792 },
  gombe: { latitude: 10.3638, longitude: 11.1928 },
  imo: { latitude: 5.572, longitude: 7.0588 },
  jigawa: { latitude: 12.228, longitude: 9.5616 },
  kaduna: { latitude: 10.3764, longitude: 7.7095 },
  kano: { latitude: 11.7471, longitude: 8.5247 },
  katsina: { latitude: 12.3797, longitude: 7.6306 },
  kebbi: { latitude: 11.6781, longitude: 4.0695 },
  kogi: { latitude: 7.7337, longitude: 6.6906 },
  kwara: { latitude: 8.9669, longitude: 4.3874 },
  nasarawa: { latitude: 8.4998, longitude: 8.1997 },
  niger: { latitude: 9.9309, longitude: 5.5983 },
  ogun: { latitude: 7.1604, longitude: 3.3508 },
  ondo: { latitude: 7.2508, longitude: 5.2103 },
  osun: { latitude: 7.5629, longitude: 4.52 },
  oyo: { latitude: 8.1574, longitude: 3.6147 },
  plateau: { latitude: 9.2182, longitude: 9.5179 },
  rivers: { latitude: 4.7497, longitude: 6.8277 },
  sokoto: { latitude: 13.0533, longitude: 5.3223 },
  taraba: { latitude: 7.9869, longitude: 10.9807 },
  yobe: { latitude: 12.2939, longitude: 11.439 },
  zamfara: { latitude: 12.1222, longitude: 6.2236 },
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
