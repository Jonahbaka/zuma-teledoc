const ngConfig = require('../../config');
const { getPool } = require('../../../server/db');
const {
  normalizeText,
  scoreProvider,
  splitMultiValue,
} = require('./utils');

const DEFAULT_LIMIT = 12;
const BLOCKED_PUBLIC_PROVIDER_TERMS = [
  'test',
  'qa',
  'demo',
  'sample',
  'fake',
  'internal',
  'jonah baka',
  'apollos goodnews',
  'goodnews.appolos@gmail.com',
  'abugail simon',
  'abigail simon',
];

function unavailableDirectory() {
  return Object.assign(new Error('The DoctaRx directory is currently unavailable. Please retry.'), { statusCode: 503, code: 'DIRECTORY_UNAVAILABLE' });
}

function recordedCoordinates(provider) {
  if (/city|state|area|centroid|postal|country|unresolved/i.test(provider?.geocodeQuality || '')) return null;
  if (provider?.latitude === null || provider?.latitude === undefined || provider?.longitude === null || provider?.longitude === undefined) return null;
  if (![provider.latitude, provider.longitude].every(value => ['number', 'string'].includes(typeof value) && String(value).trim())) return null;
  const latitude = Number(provider.latitude);
  const longitude = Number(provider.longitude);
  return Number.isFinite(latitude) && Math.abs(latitude) <= 90 && Number.isFinite(longitude) && Math.abs(longitude) <= 180
    ? { latitude, longitude } : null;
}

function applyNearbyScope(conditions, values, location, alias, checkPrecision = false) {
  if (location.latitude === null || location.latitude === undefined || location.longitude === null || location.longitude === undefined) return null;
  const latitude = Number(location.latitude); const longitude = Number(location.longitude); const radius = Number(location.radius || 20000);
  if (!recordedCoordinates({ latitude, longitude }) || !Number.isFinite(radius) || radius < 1 || radius > 20000) {
    throw Object.assign(new Error('Valid device coordinates and a radius of at most 20000 metres are required.'), { statusCode: 400 });
  }
  const latitudeRange = radius / 110000; // Conservative bound around the spherical distance calculation.
  const longitudeRange = Math.abs(latitude) + latitudeRange >= 90
    ? 180 : Math.min(180, radius / (110000 * Math.cos(latitude * Math.PI / 180)));
  values.push(latitude, longitude, radius);
  const first = values.length - 2;
  const distance = `CASE WHEN ${alias}.latitude BETWEEN -90 AND 90 AND ${alias}.longitude BETWEEN -180 AND 180
    THEN 6371000 * ACOS(LEAST(1.0, GREATEST(-1.0,
    SIN(RADIANS($${first}::double precision)) * SIN(RADIANS(${alias}.latitude::double precision)) +
    COS(RADIANS($${first}::double precision)) * COS(RADIANS(${alias}.latitude::double precision)) *
    COS(RADIANS(${alias}.longitude::double precision) - RADIANS($${first + 1}::double precision))))) ELSE NULL END`;
  conditions.push(`${alias}.latitude BETWEEN -90 AND 90`, `${alias}.longitude BETWEEN -180 AND 180`);
  values.push(Math.max(-90, latitude - latitudeRange), Math.min(90, latitude + latitudeRange));
  conditions.push(`${alias}.latitude BETWEEN $${values.length - 1} AND $${values.length}`);
  if (longitudeRange < 180) {
    const west = longitude - longitudeRange; const east = longitude + longitudeRange;
    values.push(west < -180 ? west + 360 : west, east > 180 ? east - 360 : east);
    conditions.push(west < -180 || east > 180
      ? `(${alias}.longitude >= $${values.length - 1} OR ${alias}.longitude <= $${values.length})`
      : `${alias}.longitude BETWEEN $${values.length - 1} AND $${values.length}`);
  }
  if (checkPrecision) conditions.push(`COALESCE(${alias}.geocode_quality, '') !~* 'city|state|area|centroid|postal|country|unresolved'`);
  conditions.push(`(${distance}) <= $${first + 2}::double precision`);
  return distance;
}

function recordedDistance(a, b) {
  const left = recordedCoordinates(a);
  const right = recordedCoordinates(b);
  if (!left || !right) return null;
  // The shared utility historically treats 0 as missing. Offset-independent
  // Haversine calculation preserves valid equator/prime-meridian coordinates.
  const radians = value => value * Math.PI / 180;
  const angle = Math.sin(radians(right.latitude - left.latitude) / 2) ** 2 +
    Math.cos(radians(left.latitude)) * Math.cos(radians(right.latitude)) * Math.sin(radians(right.longitude - left.longitude) / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(Math.min(1, angle)), Math.sqrt(Math.max(0, 1 - angle)));
}

function providerMatchesType(provider, requestedType) {
  const typeNeedle = normalizeText(requestedType);
  if (!typeNeedle || typeNeedle === 'all') {
    return true;
  }

  const providerTypeText = normalizeText(`${provider.providerType || ''} ${provider.providerSubtype || ''} ${provider.canonicalName || ''}`);
  if (providerTypeText.includes(typeNeedle)) {
    return true;
  }

  if (typeNeedle === 'lab') {
    return provider.labRelevant || providerTypeText.includes('laboratory') || providerTypeText.includes('diagnostic');
  }

  if (typeNeedle === 'optical') {
    return provider.opticalCapable || providerTypeText.includes('eye');
  }

  if (typeNeedle === 'dental') {
    return provider.dentalCapable || providerTypeText.includes('dent');
  }

  if (typeNeedle === 'specialist') {
    return providerTypeText.includes('specialist') || providerTypeText.includes('doctor');
  }

  return false;
}

const SYMPTOM_PROVIDER_MAP = {
  malaria: ['clinic', 'hospital'],
  fever: ['clinic', 'hospital'],
  pain: ['clinic', 'hospital'],
  dehydration: ['clinic', 'hospital', 'pharmacy'],
  gastric: ['clinic', 'hospital', 'pharmacy'],
  hypertension: ['clinic', 'hospital'],
  diabetes: ['clinic', 'hospital'],
  respiratory: ['clinic', 'hospital'],
};

function getPoolSafe() {
  return getPool();
}

function mapGroupRow(row) {
  return {
    id: row.id,
    kind: 'directory_provider',
    sourceType: 'directory',
    canonicalName: row.canonical_name,
    providerType: row.provider_type || 'provider',
    providerSubtype: row.provider_subtype,
    city: row.city,
    state: row.state,
    lga: row.lga,
    addressRaw: row.address_raw,
    latitude: row.latitude,
    longitude: row.longitude,
    geocodeQuality: row.geocode_quality,
    addressConfidence: row.address_confidence,
    phone: row.phone || [],
    email: row.email || [],
    website: row.website,
    sourceBadges: row.source_badges || [],
    acceptedPaymentTypes: row.accepted_payment_types || ['cash', 'self_pay'],
    telehealthCapable: row.telehealth_capable,
    emergencyCapable: row.emergency_capable,
    maternityCapable: row.maternity_capable,
    pediatricCapable: row.pediatric_capable,
    opticalCapable: row.optical_capable,
    dentalCapable: row.dental_capable,
    pharmacyRelevant: row.pharmacy_relevant,
    labRelevant: row.lab_relevant,
    trustScore: Number(row.trust_score || 0.5),
    popularityScore: Number(row.popularity_score || 0.5),
    dataConfidence: Number(row.data_confidence || 0.5),
    sourceCount: Number(row.source_count || 1),
    lastVerifiedAt: row.last_verified_at,
    services: Array.isArray(row.services) ? row.services : [],
    specialties: Array.isArray(row.specialties) ? row.specialties : [],
    insurances: Array.isArray(row.insurances) ? row.insurances : [],
    payerIds: Array.isArray(row.payer_ids) ? row.payer_ids : [],
  };
}

function mapPharmacyRow(row, medicineName) {
  return {
    id: `pharmacy:${row.id}`,
    rawId: row.id,
    kind: 'pharmacy',
    sourceType: 'internal_pharmacy',
    canonicalName: row.name,
    providerType: 'pharmacy',
    providerSubtype: 'partner_pharmacy',
    city: row.city,
    state: row.state,
    lga: row.lga,
    addressRaw: row.address_line1,
    latitude: row.latitude,
    longitude: row.longitude,
    geocodeQuality: recordedCoordinates(row) ? 'street' : 'city_only',
    addressConfidence: recordedCoordinates(row) ? 'street' : 'city_only',
    phone: splitMultiValue(row.phone),
    email: splitMultiValue(row.email),
    website: row.website,
    sourceBadges: ['DoctaRx Verified'],
    acceptedPaymentTypes: ['cash', 'self_pay', 'card', 'bank_transfer'],
    telehealthCapable: false,
    emergencyCapable: false,
    maternityCapable: false,
    pediatricCapable: false,
    opticalCapable: false,
    dentalCapable: false,
    pharmacyRelevant: true,
    labRelevant: false,
    trustScore: Number(row.rating ? Math.min(1, Number(row.rating) / 5) : 0.82),
    popularityScore: Number(row.total_orders ? Math.min(1, Number(row.total_orders) / 100) : 0.6),
    dataConfidence: 0.88,
    sourceCount: 1,
    lastVerifiedAt: row.verified_at || null,
    services: ['medication_fulfilment', 'pharmacy_review'],
    specialties: medicineName ? [medicineName] : [],
    insurances: [],
    payerIds: [],
    medicineStockHint: row.medicine_stock_hint,
  };
}

function mapInternalProviderRow(row) {
  return {
    id: `provider:${row.id}`,
    rawId: row.id,
    kind: 'telehealth_provider',
    sourceType: 'internal_provider',
    canonicalName: `Dr. ${row.first_name} ${row.last_name}`.trim(),
    credentialingStatus: row.credentialing_status || null,
    providerVerificationStatus: row.provider_status || null,
    publicCredentialed: row.credentialing_status === 'approved' && row.provider_status === 'approved',
    providerType: row.specialty ? 'specialist' : 'doctor',
    providerSubtype: row.specialty || 'telehealth',
    city: row.city,
    state: row.state,
    addressRaw: [row.city, row.state, 'Nigeria'].filter(Boolean).join(', '),
    latitude: row.latitude || null,
    longitude: row.longitude || null,
    geocodeQuality: row.state ? 'city_only' : 'unresolved',
    addressConfidence: row.state ? 'city_only' : 'unresolved',
    phone: splitMultiValue(row.phone || row.phone_number),
    email: splitMultiValue(row.email),
    website: null,
    sourceBadges: ['DoctaRx Verified'],
    acceptedPaymentTypes: ['cash', 'self_pay', 'card', 'bank_transfer'],
    telehealthCapable: true,
    emergencyCapable: false,
    maternityCapable: false,
    pediatricCapable: normalizeText(row.specialty).includes('pediatric'),
    opticalCapable: normalizeText(row.specialty).includes('ophthalm'),
    dentalCapable: normalizeText(row.specialty).includes('dental'),
    pharmacyRelevant: false,
    labRelevant: true,
    trustScore: 0.92,
    popularityScore: 0.78,
    dataConfidence: 0.95,
    sourceCount: 1,
    lastVerifiedAt: row.updated_at || row.created_at,
    services: ['video_consult', 'audio_consult', 'async_follow_up'],
    specialties: row.specialty ? [row.specialty] : [],
    insurances: [],
    payerIds: [],
  };
}

function isDoctaRxVerifiedProvider(provider) {
  if (provider.kind === 'telehealth_provider') {
    return provider.publicCredentialed === true;
  }

  if (provider.kind === 'pharmacy') {
    return provider.sourceType === 'internal_pharmacy';
  }

  return false;
}

function hasBlockedPublicProviderMarker(provider = {}) {
  const haystack = normalizeText([
    provider.canonicalName,
    provider.email,
  ].filter(Boolean).join(' '));

  return BLOCKED_PUBLIC_PROVIDER_TERMS.some((term) => /^[a-z]+$/.test(term)
    ? new RegExp(`\\b${term}\\b`).test(haystack) : haystack.includes(term));
}

function sanitizePublicProvider(provider) {
  if (!provider || hasBlockedPublicProviderMarker(provider)) {
    return null;
  }

  if (provider.kind === 'telehealth_provider' && !isDoctaRxVerifiedProvider(provider)) {
    return null;
  }

  const canShowVerifiedBadge = isDoctaRxVerifiedProvider(provider);
  return {
    ...provider,
    sourceBadges: (provider.sourceBadges || []).filter((badge) => {
      if (normalizeText(badge) === 'doctarx verified') {
        return canShowVerifiedBadge;
      }
      return true;
    }),
  };
}

function buildProviderResponse(provider, scoring) {
  const distanceKm = recordedDistance(scoring?.userLocation, provider);

  return {
    ...provider,
    distanceKm,
    etaMinutes: null,
    score: Number((scoring?.finalScore || 0).toFixed(4)),
    displayBadges: [
      ...(provider.sourceBadges || []),
      provider.telehealthCapable ? 'Telehealth available' : 'In-person only',
    ],
  };
}

async function getFeaturedMedicines(limit = 18) {
  const pool = getPoolSafe();

  try {
    const result = await pool.query(
      `
        SELECT
          id,
          name,
          generic_name,
          dosage_form,
          strength,
          featured_category,
          access_mode,
          product_logic_note,
          listing_status,
          price_ngn,
          requires_prescription,
          otc_candidate,
          therapeutic_class
        FROM ng_drug_catalog
        WHERE featured_category IS NOT NULL
        ORDER BY featured_category ASC, generic_name ASC
        LIMIT $1
      `,
      [limit]
    );

    if (result.rows.length > 0) {
      return result.rows.map((row) => ({
        id: row.id,
        name: row.name,
        genericName: row.generic_name,
        dosageForm: row.dosage_form,
        strength: row.strength,
        featuredCategory: row.featured_category,
        accessMode: row.access_mode,
        productLogicNote: row.product_logic_note,
        listingStatus: row.listing_status,
        priceNgn: row.price_ngn,
        requiresPrescription: row.requires_prescription,
        otcCandidate: row.otc_candidate,
        therapeuticClass: row.therapeutic_class,
      }));
    }
  } catch (_) { throw unavailableDirectory(); }
  return [];
}

async function getFeaturedMedicineCategories(limit = 8) {
  const pool = getPoolSafe();

  try {
    const result = await pool.query(
      `
        SELECT
          featured_category,
          MIN(access_mode) AS access_mode,
          COUNT(*) AS med_count,
          ARRAY_REMOVE(ARRAY_AGG(DISTINCT generic_name ORDER BY generic_name), NULL) AS medicine_examples
        FROM ng_drug_catalog
        WHERE featured_category IS NOT NULL
        GROUP BY featured_category
        ORDER BY COUNT(*) DESC, featured_category ASC
        LIMIT $1
      `,
      [limit]
    );

    if (result.rows.length > 0) {
      return result.rows.map((row) => ({
        category: row.featured_category,
        accessMode: row.access_mode,
        medCount: Number(row.med_count || 0),
        medicineExamples: (row.medicine_examples || []).slice(0, 4),
      }));
    }
  } catch (_) { throw unavailableDirectory(); }
  return [];
}

async function getPayers(limit = 50) {
  const pool = getPoolSafe();
  try {
    const [hmos, agencies] = await Promise.all([
      pool.query(
        `
          SELECT id, payer_name, payer_type, payer_code, state, website
          FROM ng_payer_networks
          ORDER BY payer_name ASC
          LIMIT $1
        `,
        [limit]
      ),
      pool.query(
        `
          SELECT id, agency_name, state, website
          FROM ng_state_insurance_agencies
          ORDER BY agency_name ASC
          LIMIT $1
        `,
        [limit]
      ),
    ]);

    if (hmos.rows.length > 0 || agencies.rows.length > 0) {
      return {
        hmos: hmos.rows.map((row) => ({
          id: row.id,
          name: row.payer_name,
          type: row.payer_type,
          code: row.payer_code,
          state: row.state,
          website: row.website,
        })),
        stateSchemes: agencies.rows.map((row) => ({
          id: row.id,
          name: row.agency_name,
          state: row.state,
          website: row.website,
        })),
      };
    }
  } catch (_) { throw unavailableDirectory(); }
  return { hmos: [], stateSchemes: [] };
}

async function getGroupProviders(filters = {}) {
  const pool = getPoolSafe();
  const conditions = [];
  const values = [];

  if (filters.state) {
    values.push(filters.state);
    conditions.push(`state ILIKE $${values.length}`);
  }

  if (filters.city) {
    values.push(filters.city);
    conditions.push(`city ILIKE $${values.length}`);
  }

  if (filters.providerType && filters.providerType !== 'all') {
    values.push(`%${filters.providerType}%`);
    conditions.push(`COALESCE(provider_type, '') ILIKE $${values.length}`);
  }

  if (filters.query) {
    const normalized = normalizeText(filters.query);
    values.push(`%${normalized}%`);
    conditions.push(`normalized_name ILIKE $${values.length}`);
  }
  const distanceOrder = applyNearbyScope(conditions, values, filters, 'g', true);

  const sql = `
    SELECT *
    FROM ng_provider_match_groups g
    ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''}
    ORDER BY ${distanceOrder ? `(${distanceOrder}) ASC,` : ''} trust_score DESC, source_count DESC, canonical_name ASC
    LIMIT 200
  `;

  try {
    const result = await pool.query(sql, values);
    if (result.rows.length > 0) {
      return result.rows.map(mapGroupRow);
    }
  } catch (_) { throw unavailableDirectory(); }
  return [];
}

async function getApprovedPharmacies({ state, city, medicine, query, latitude, longitude, radius }) {
  const pool = getPoolSafe();
  const values = [];
  const conditions = [`p.status = 'approved'`, `p.account_status = 'active'`, `p.pcn_license_expiry >= CURRENT_DATE`];

  if (state) {
    values.push(state);
    conditions.push(`p.state ILIKE $${values.length}`);
  }

  if (city) {
    values.push(city);
    conditions.push(`p.city ILIKE $${values.length}`);
  }

  if (query && !medicine) {
    values.push(`%${normalizeText(query)}%`);
    conditions.push(`LOWER(p.name) LIKE $${values.length}`);
  }

  let stockJoin = '';
  if (medicine) {
    values.push(`%${normalizeText(medicine)}%`);
    stockJoin = `
      LEFT JOIN LATERAL (
        SELECT JSON_BUILD_OBJECT(
          'drugName', d.name,
          'genericName', d.generic_name,
          'sellingPrice', i.selling_price,
          'quantityAvailable', i.quantity_available
        ) AS medicine_stock_hint
        FROM ng_pharmacy_inventory i
        JOIN ng_drug_catalog d ON d.id = i.drug_id
        WHERE i.pharmacy_id = p.id
          AND i.is_available = true
          AND i.quantity_available > 0
          AND (
            LOWER(d.name) LIKE $${values.length}
            OR LOWER(COALESCE(d.generic_name, '')) LIKE $${values.length}
          )
        ORDER BY i.quantity_available DESC
        LIMIT 1
      ) stock ON TRUE
    `;
    conditions.push(`stock.medicine_stock_hint IS NOT NULL`);
  }
  const distanceOrder = applyNearbyScope(conditions, values, { latitude, longitude, radius }, 'p');

  const sql = `
    SELECT
      p.*,
      ${medicine ? 'stock.medicine_stock_hint' : 'NULL::json AS medicine_stock_hint'}
    FROM ng_pharmacies p
    ${stockJoin}
    WHERE ${conditions.join(' AND ')}
    ORDER BY ${distanceOrder ? `(${distanceOrder}) ASC,` : ''} verified_at DESC NULLS LAST, rating DESC NULLS LAST, total_orders DESC NULLS LAST
    LIMIT 100
  `;

  try {
    const result = await pool.query(sql, values);
    if (result.rows.length > 0) {
      return result.rows.map((row) => mapPharmacyRow(row, medicine));
    }
  } catch (_) { throw unavailableDirectory(); }
  return [];
}

async function getInternalTelehealthProviders({ state, city, specialty, query }) {
  const pool = getPoolSafe();
  const values = [];
  const conditions = [
    `u.role = 'provider'`,
    `u.provider_status = 'approved'`,
    `u.is_active = TRUE`,
    `COALESCE(u.is_test_account, FALSE) = FALSE`,
    `COALESCE(u.account_status, 'active') NOT IN ('deleted', 'suspended', 'revoked', 'inactive')`,
    `u.market_scope = 'NG'`,
    `COALESCE(u.test_account_metadata->>'testAccount', '') NOT IN ('true', 'TRUE')`,
    `COALESCE(u.test_account_metadata->>'isTestAccount', '') NOT IN ('true', 'TRUE')`,
    `COALESCE(u.test_account_metadata->>'createdFrom', '') NOT IN ('admin_portal', 'us_admin_portal', 'ng_admin_portal', 'admin_testing_access')`,
    `COALESCE(u.test_account_metadata->>'status', '') NOT IN ('revoked', 'deleted')`,
    `NOT EXISTS (
      SELECT 1
      FROM testing_access_links tal
      WHERE to_jsonb(tal)->>'target_user_id' = u.id::text
         OR LOWER(COALESCE(to_jsonb(tal)->>'target_email', '')) = LOWER(u.email)
         OR tal.last_used_by = u.id
    )`,
    `NOT EXISTS (
      SELECT 1
      FROM unnest($1::text[]) AS blocked(term)
      WHERE LOWER(CONCAT_WS(' ', u.first_name, u.last_name, u.email, COALESCE(u.specialty, ''))) LIKE '%' || blocked.term || '%'
    )`,
    `EXISTS (
      SELECT 1
      FROM provider_credentialing pc
      WHERE pc.provider_id = u.id
        AND pc.status = 'approved'
    )`,
  ];
  values.push(BLOCKED_PUBLIC_PROVIDER_TERMS);

  if (state) {
    values.push(state);
    conditions.push(`u.state ILIKE $${values.length}`);
  }

  if (city) {
    values.push(city);
    conditions.push(`u.city ILIKE $${values.length}`);
  }

  if (specialty) {
    values.push(`%${specialty}%`);
    conditions.push(`COALESCE(u.specialty, '') ILIKE $${values.length}`);
  }

  if (query) {
    values.push(`%${query}%`);
    conditions.push(`(
      CONCAT_WS(' ', u.first_name, u.last_name) ILIKE $${values.length}
      OR COALESCE(u.specialty, '') ILIKE $${values.length}
    )`);
  }

  const sql = `
    SELECT
      u.id,
      u.first_name,
      u.last_name,
      u.specialty,
      u.city,
      u.state,
      u.phone,
      u.phone_number,
      u.email,
      u.provider_status,
      u.created_at,
      u.updated_at,
      pc.status::text AS credentialing_status
    FROM users u
    JOIN provider_credentialing pc
      ON pc.provider_id = u.id
     AND pc.status = 'approved'
    WHERE ${conditions.join(' AND ')}
    ORDER BY u.updated_at DESC NULLS LAST, u.created_at DESC
    LIMIT 100
  `;

  try {
    const result = await pool.query(sql, values);
    return result.rows.map(mapInternalProviderRow).map(sanitizePublicProvider).filter(Boolean);
  } catch (_) { throw unavailableDirectory(); }
}

async function searchProviders(params = {}) {
  const {
    query,
    symptom,
    specialty,
    providerType,
    payer,
    mode = 'nearest',
    state,
    city,
    lga,
    latitude,
    longitude,
    postalCode,
    radius = 20000,
    medicine,
    limit = DEFAULT_LIMIT,
    sessionId,
  } = params;

  const hasLatitude = latitude !== null && latitude !== undefined;
  const hasLongitude = longitude !== null && longitude !== undefined;
  if (hasLatitude !== hasLongitude || (hasLatitude && (!recordedCoordinates({ latitude, longitude }) || state || city || postalCode))) {
    throw Object.assign(new Error('Choose valid device coordinates or a manual area, without combining them.'), { statusCode: 400 });
  }
  if (postalCode && !state && !city) throw Object.assign(new Error('Postal-code-only lookup is not supported in the Nigeria directory. Choose a city or state.'), { statusCode: 400, code: 'POSTAL_AREA_UNSUPPORTED' });
  if (!hasLatitude && !state && !city) return { providers: [], total: 0, locationSource: 'unresolved' };
  if (!Number.isFinite(Number(radius)) || Number(radius) < 1 || Number(radius) > 20000) throw Object.assign(new Error('Search radius must be between 1 and 20000 metres.'), { statusCode: 400 });

  const preferredTypes =
    providerType && providerType !== 'all'
      ? [providerType]
      : symptom && SYMPTOM_PROVIDER_MAP[normalizeText(symptom)]
        ? SYMPTOM_PROVIDER_MAP[normalizeText(symptom)]
        : [];

  const userLocation = {
    latitude: hasLatitude ? Number(latitude) : null,
    longitude: hasLongitude ? Number(longitude) : null,
    state: state || null,
    city: city || null,
    lga: lga || null,
  };

  const [groups, telehealthProviders, pharmacies] = await Promise.all([
    getGroupProviders({ state, city, providerType, query, latitude: mode === 'teleconsult' ? null : latitude, longitude: mode === 'teleconsult' ? null : longitude, radius }),
    mode === 'teleconsult' || specialty || !providerType || providerType === 'doctor'
      ? getInternalTelehealthProviders({ state, city, specialty, query })
      : Promise.resolve([]),
    mode === 'pharmacy' || medicine
      ? getApprovedPharmacies({ state, city, medicine, query, latitude, longitude, radius })
      : Promise.resolve([]),
  ]);

  const seenProviders = new Set();
  const mergedProviders = [...groups, ...telehealthProviders, ...pharmacies]
    .map(sanitizePublicProvider)
    .filter(Boolean)
    .filter((provider) => {
      const dedupeKey = [
        normalizeText(provider.canonicalName),
        normalizeText(provider.addressRaw),
        normalizeText(provider.city),
        normalizeText(provider.state),
      ].filter(Boolean).join('::');

      if (dedupeKey && seenProviders.has(dedupeKey)) {
        return false;
      }
      if (dedupeKey) {
        seenProviders.add(dedupeKey);
      }

      const providerTypeText = `${provider.providerType || ''} ${provider.providerSubtype || ''}`.toLowerCase();

      if (mode === 'teleconsult' && !provider.telehealthCapable) {
        return false;
      }

      if (mode === 'in_person' && provider.telehealthCapable && provider.kind === 'telehealth_provider') {
        return false;
      }

      if (mode === 'pharmacy' && !(provider.providerType === 'pharmacy' || provider.pharmacyRelevant)) {
        return false;
      }

      if (mode === 'labs' && !(provider.labRelevant || providerTypeText.includes('lab') || providerTypeText.includes('diagnostic'))) {
        return false;
      }

      if (preferredTypes.length > 0) {
        if (!preferredTypes.some((type) => providerMatchesType(provider, type))) {
          return false;
        }
      }

      return true;
    })
    .map((provider) => {
      const scoring = scoreProvider({
        provider,
        userLocation,
        query,
        symptomTag: symptom,
        preferredProviderType: providerType,
        payer,
        mode,
        medicine,
      });

      return buildProviderResponse(provider, { ...scoring, userLocation });
    })
    .filter(provider => !hasLatitude || mode === 'teleconsult' || (provider.distanceKm !== null && provider.distanceKm * 1000 <= Number(radius)))
    .sort((a, b) => hasLatitude && mode !== 'teleconsult' ? a.distanceKm - b.distanceKm : b.score - a.score)
    .slice(0, Number(limit || DEFAULT_LIMIT));

  await logDiscoverySearch({
    sessionId,
    latitude,
    longitude,
    state,
    city,
    lga,
    query,
    symptomTags: symptom ? [symptom] : [],
    preferredProviderTypes: preferredTypes,
    sortMode: mode,
  });

  return {
    providers: mergedProviders,
    total: mergedProviders.length,
    locationSource: hasLatitude ? 'gps' : state || city ? 'manual' : 'unresolved',
  };
}

async function searchMedicines(params = {}) {
  const pool = getPoolSafe();
  const {
    query,
    symptom,
    category,
    accessMode,
    limit = DEFAULT_LIMIT,
  } = params;

  const values = [];
  const conditions = [];

  if (query) {
    values.push(`%${normalizeText(query)}%`);
    conditions.push(`(
      LOWER(name) LIKE $${values.length}
      OR LOWER(COALESCE(generic_name, '')) LIKE $${values.length}
      OR LOWER(COALESCE(brand_name, '')) LIKE $${values.length}
      OR LOWER(COALESCE(therapeutic_class, '')) LIKE $${values.length}
      OR LOWER(COALESCE(featured_category, '')) LIKE $${values.length}
      OR LOWER(COALESCE(product_logic_note, '')) LIKE $${values.length}
    )`);
  }

  if (symptom) {
    values.push(normalizeText(symptom));
    conditions.push(`$${values.length} = ANY(symptom_tags)`);
  }

  if (category) {
    values.push(category);
    conditions.push(`featured_category = $${values.length}`);
  }

  if (accessMode && accessMode !== 'all') {
    values.push(accessMode);
    conditions.push(`access_mode = $${values.length}`);
  }

  const sql = `
    SELECT
      id,
      name,
      generic_name,
      brand_name,
      dosage_form,
      strength,
      therapeutic_class,
      symptom_tags,
      disease_tags,
      requires_prescription,
      otc_candidate,
      controlled,
      nhia_listed,
      price_ngn,
      price_notes,
      featured_category,
      listing_status,
      access_mode,
      product_logic_note
    FROM ng_drug_catalog
    ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''}
    ORDER BY
      featured_category NULLS LAST,
      requires_prescription ASC,
      generic_name ASC
    LIMIT $${values.length + 1}
  `;

  values.push(Number(limit || DEFAULT_LIMIT));

  let medicines = [];
  try {
    const result = await pool.query(sql, values);
    medicines = result.rows.map((row) => ({
      id: row.id,
      name: row.name,
      genericName: row.generic_name,
      brandName: row.brand_name,
      dosageForm: row.dosage_form,
      strength: row.strength,
      therapeuticClass: row.therapeutic_class,
      symptomTags: row.symptom_tags || [],
      diseaseTags: row.disease_tags || [],
      requiresPrescription: row.requires_prescription,
      otcCandidate: row.otc_candidate,
      controlled: row.controlled,
      nhiaListed: row.nhia_listed,
      priceNgn: row.price_ngn,
      priceNotes: row.price_notes,
      featuredCategory: row.featured_category,
      listingStatus: row.listing_status,
      accessMode: row.access_mode,
      productLogicNote: row.product_logic_note,
    }));
  } catch (_) { throw unavailableDirectory(); }

  return {
    medicines,
    total: medicines.length,
  };
}

async function getDiscoveryHome(params = {}) {
  const [featuredCategories, featuredMedicines, providerResults, payers] = await Promise.all([
    getFeaturedMedicineCategories(8),
    getFeaturedMedicines(12),
    searchProviders({ ...params, mode: 'nearest', limit: 6, query: params.query || '' }),
    getPayers(12),
  ]);

  return {
    featuredCategories,
    featuredMedicines,
    nearestProviders: providerResults.providers,
    payers,
    telehealthOptions: [
      {
        id: 'video_consult',
        label: 'Video consult',
        description: 'Full consult flow for stronger connections and follow-up planning.',
      },
      {
        id: 'audio_consult',
        label: 'Audio-first consult',
        description: 'Lower-bandwidth consult option when video quality is unreliable.',
      },
      {
        id: 'async_consult',
        label: 'Async consult',
        description: 'Share photos and voice notes, then continue when the network stabilizes.',
      },
      {
        id: 'whatsapp_handoff',
        label: 'WhatsApp handoff',
        description: 'Escalate quickly to a familiar channel when app or checkout flow stalls.',
      },
    ],
    support: {
      whatsappNumber: ngConfig.discovery.whatsappNumber,
      callbackNumber: ngConfig.discovery.callbackNumber,
      callbackLabel: ngConfig.discovery.callbackLabel,
    },
  };
}

async function logDiscoverySearch({
  sessionId,
  latitude,
  longitude,
  state,
  city,
  lga,
  query,
  symptomTags,
  preferredProviderTypes,
  sortMode,
}) {
  const pool = getPoolSafe();

  try {
    await pool.query(
      `
        INSERT INTO ng_provider_search_logs (
          patient_session_id,
          lat,
          lng,
          state,
          city,
          lga,
          query,
          symptom_tags,
          preferred_provider_types,
          sort_mode,
          location_source
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      `,
      [
        sessionId || null,
        null,
        null,
        state || null,
        city || null,
        lga || null,
        query || null,
        symptomTags || [],
        preferredProviderTypes || [],
        sortMode || 'nearest',
        latitude !== null && latitude !== undefined && longitude !== null && longitude !== undefined ? 'gps' : state || city ? 'manual' : 'unresolved',
      ]
    );
  } catch (_) { /* A metrics failure cannot replace an actual directory result. */ }
}

async function logDiscoveryEvent({ eventType, sessionId, providerReference, medReference, query, payload }) {
  const pool = getPoolSafe();
  await pool.query(
    `
      INSERT INTO ng_discovery_events (
        event_type,
        session_id,
        provider_reference,
        med_reference,
        query,
        payload
      )
      VALUES ($1, $2, $3, $4, $5, $6)
    `,
    [
      eventType,
      sessionId || null,
      providerReference || null,
      medReference || null,
      query || null,
      payload || {},
    ]
  );
}

async function createFallbackRequest(input) {
  const pool = getPoolSafe();
  const payload = {
    connection: input.connection || {},
    medication: input.medication || null,
    query: input.query || null,
  };

  const result = await pool.query(
    `
      INSERT INTO ng_care_fallback_requests (
        request_type,
        contact_name,
        phone,
        email,
        preferred_contact_method,
        symptom,
        care_need,
        state,
        city,
        landmark,
        notes,
        payload
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      RETURNING id, request_type, created_at
    `,
    [
      input.requestType,
      input.contactName || null,
      input.phone || null,
      input.email || null,
      input.preferredContactMethod || null,
      input.symptom || null,
      input.careNeed || null,
      input.state || null,
      input.city || null,
      input.landmark || null,
      input.notes || null,
      payload,
    ]
  );

  await logDiscoveryEvent({
    eventType: 'fallback_requested',
    sessionId: input.sessionId,
    query: input.query,
    payload: {
      requestType: input.requestType,
      state: input.state,
      city: input.city,
      preferredContactMethod: input.preferredContactMethod,
    },
  });

  return result.rows[0];
}

module.exports = {
  getDiscoveryHome,
  getFeaturedMedicineCategories,
  getFeaturedMedicines,
  getPayers,
  logDiscoveryEvent,
  mapGroupRow,
  searchMedicines,
  searchProviders,
  createFallbackRequest,
};
