const ngConfig = require('../../config');
const { getPool } = require('../../../server/db');
const {
  haversineDistanceKm,
  normalizeText,
  scoreProvider,
  splitMultiValue,
} = require('./utils');

const DEFAULT_LIMIT = 12;

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
    geocodeQuality: row.latitude && row.longitude ? 'street' : 'city_only',
    addressConfidence: row.latitude && row.longitude ? 'street' : 'city_only',
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
    lastVerifiedAt: row.verified_at || row.updated_at,
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

function buildProviderResponse(provider, scoring) {
  const distanceKm = scoring?.distanceKm ?? haversineDistanceKm(scoring?.userLocation, provider);
  const etaMinutes = distanceKm !== null ? Math.max(8, Math.round(distanceKm * 4.5)) : null;

  return {
    ...provider,
    distanceKm,
    etaMinutes,
    score: Number((scoring?.finalScore || 0).toFixed(4)),
    displayBadges: [
      ...(provider.sourceBadges || []),
      provider.telehealthCapable ? 'Telehealth available' : 'In-person only',
    ],
  };
}

async function getFeaturedMedicines(limit = 18) {
  const pool = getPoolSafe();
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

async function getFeaturedMedicineCategories(limit = 8) {
  const pool = getPoolSafe();
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

  return result.rows.map((row) => ({
    category: row.featured_category,
    accessMode: row.access_mode,
    medCount: Number(row.med_count || 0),
    medicineExamples: (row.medicine_examples || []).slice(0, 4),
  }));
}

async function getPayers(limit = 50) {
  const pool = getPoolSafe();
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

  const sql = `
    SELECT *
    FROM ng_provider_match_groups
    ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''}
    ORDER BY trust_score DESC, source_count DESC, canonical_name ASC
    LIMIT 200
  `;

  const result = await pool.query(sql, values);
  return result.rows.map(mapGroupRow);
}

async function getApprovedPharmacies({ state, city, medicine }) {
  const pool = getPoolSafe();
  const values = [];
  const conditions = [`status = 'approved'`];

  if (state) {
    values.push(state);
    conditions.push(`state ILIKE $${values.length}`);
  }

  if (city) {
    values.push(city);
    conditions.push(`city ILIKE $${values.length}`);
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

  const sql = `
    SELECT
      p.*,
      stock.medicine_stock_hint
    FROM ng_pharmacies p
    ${stockJoin}
    WHERE ${conditions.join(' AND ')}
    ORDER BY verified_at DESC NULLS LAST, rating DESC NULLS LAST, total_orders DESC NULLS LAST
    LIMIT 100
  `;

  const result = await pool.query(sql, values);
  return result.rows.map((row) => mapPharmacyRow(row, medicine));
}

async function getInternalTelehealthProviders({ state, city, specialty, query }) {
  const pool = getPoolSafe();
  const values = [];
  const conditions = [
    `role = 'provider'`,
    `provider_status = 'approved'`,
    `(COALESCE(region::text, '') = 'NG' OR LOWER(COALESCE(country, '')) IN ('nigeria', 'ng'))`,
  ];

  if (state) {
    values.push(state);
    conditions.push(`state ILIKE $${values.length}`);
  }

  if (city) {
    values.push(city);
    conditions.push(`city ILIKE $${values.length}`);
  }

  if (specialty) {
    values.push(`%${specialty}%`);
    conditions.push(`COALESCE(specialty, '') ILIKE $${values.length}`);
  }

  if (query) {
    values.push(`%${query}%`);
    conditions.push(`(
      CONCAT_WS(' ', first_name, last_name) ILIKE $${values.length}
      OR COALESCE(specialty, '') ILIKE $${values.length}
    )`);
  }

  const sql = `
    SELECT
      id,
      first_name,
      last_name,
      specialty,
      city,
      state,
      phone,
      phone_number,
      email,
      created_at,
      updated_at
    FROM users
    WHERE ${conditions.join(' AND ')}
    ORDER BY updated_at DESC NULLS LAST, created_at DESC
    LIMIT 100
  `;

  const result = await pool.query(sql, values);
  return result.rows.map(mapInternalProviderRow);
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
    medicine,
    limit = DEFAULT_LIMIT,
    sessionId,
  } = params;

  const preferredTypes =
    providerType && providerType !== 'all'
      ? [providerType]
      : symptom && SYMPTOM_PROVIDER_MAP[normalizeText(symptom)]
        ? SYMPTOM_PROVIDER_MAP[normalizeText(symptom)]
        : [];

  const userLocation = {
    latitude: latitude ? Number(latitude) : null,
    longitude: longitude ? Number(longitude) : null,
    state: state || null,
    city: city || null,
    lga: lga || null,
  };

  const [groups, telehealthProviders, pharmacies] = await Promise.all([
    getGroupProviders({ state, city, providerType, query }),
    mode === 'teleconsult' || specialty || !providerType || providerType === 'doctor'
      ? getInternalTelehealthProviders({ state, city, specialty, query })
      : Promise.resolve([]),
    mode === 'pharmacy' || medicine
      ? getApprovedPharmacies({ state, city, medicine: medicine || query })
      : Promise.resolve([]),
  ]);

  const mergedProviders = [...groups, ...telehealthProviders, ...pharmacies]
    .filter((provider) => {
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
        if (!preferredTypes.some((type) => providerTypeText.includes(normalizeText(type)))) {
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
    .sort((a, b) => b.score - a.score)
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
    locationSource: latitude && longitude ? 'gps' : state || city ? 'manual' : 'unresolved',
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

  const result = await pool.query(sql, values);
  const medicines = result.rows.map((row) => ({
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
        latitude ? Number(latitude) : null,
        longitude ? Number(longitude) : null,
        state || null,
        city || null,
        lga || null,
        query || null,
        symptomTags || [],
        preferredProviderTypes || [],
        sortMode || 'nearest',
        latitude && longitude ? 'gps' : state || city ? 'manual' : 'unresolved',
      ]
    );
  } catch (error) {
    console.error('[NG Discovery] Failed to log search', error.message);
  }
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
