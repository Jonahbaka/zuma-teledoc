#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { getPool } = require('../../server/db');
const { runNgMigrations } = require('../migrations/migrate');
const {
  buildProviderMatchKey,
  deriveProviderFlags,
  getApproximateCoordinates,
  inferAcceptedPaymentTypes,
  normalizeProviderName,
  normalizeText,
  parseBoolean,
  slugify,
  splitMultiValue,
  titleCase,
} = require('../services/discovery/utils');

const DATA_DIR = path.join(__dirname, '..', 'data', 'doctarx_nigeria_data_pack');
const PROVIDER_SEED_FILES = [
  { filename: 'provider_seed_reliance.csv', defaultSource: 'reliance' },
  { filename: 'provider_seed_nhia_hcp.csv', defaultSource: 'nhia_hcp' },
  { filename: 'pharmacy_seed_base.csv', defaultSource: 'reliance', defaultProviderType: 'pharmacy' },
];

function parseCsv(text) {
  const rows = [];
  let current = '';
  let row = [];
  let inQuotes = false;

  const normalized = String(text || '').replace(/^\uFEFF/, '');

  for (let index = 0; index < normalized.length; index += 1) {
    const char = normalized[index];
    const next = normalized[index + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === ',' && !inQuotes) {
      row.push(current);
      current = '';
      continue;
    }

    if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && next === '\n') {
        index += 1;
      }

      if (current.length > 0 || row.length > 0) {
        row.push(current);
        rows.push(row);
      }

      row = [];
      current = '';
      continue;
    }

    current += char;
  }

  if (current.length > 0 || row.length > 0) {
    row.push(current);
    rows.push(row);
  }

  const [header = [], ...records] = rows;
  const columns = header.map((item) => item.trim());

  return records
    .filter((record) => record.some((cell) => String(cell || '').trim() !== ''))
    .map((record) =>
      columns.reduce((accumulator, column, index) => {
        accumulator[column] = String(record[index] || '').trim();
        return accumulator;
      }, {})
    );
}

function readCsv(filename) {
  return parseCsv(fs.readFileSync(path.join(DATA_DIR, filename), 'utf8'));
}

function firstNonEmpty(...values) {
  return values.find((value) => String(value || '').trim() !== '') || '';
}

function inferPrescriptionFlags(row) {
  const prescriptionClass = normalizeText(row.prescription_class || row.safety_label || row.access_mode);
  const controlled = parseBoolean(row.controlled) || prescriptionClass.includes('controlled') || prescriptionClass.includes('restricted');
  const requiresPrescription =
    controlled ||
    parseBoolean(row.prescription_required) ||
    prescriptionClass.includes('prescription') ||
    prescriptionClass.includes('clinical review');
  const otcCandidate = prescriptionClass.includes('otc') || prescriptionClass.includes('pharmacist');

  return { controlled, requiresPrescription, otcCandidate };
}

function normalizeHmoRow(row) {
  return {
    source: firstNonEmpty(row.source, 'nhia'),
    payer_name: firstNonEmpty(row.payer_name, row.organization_name, row.HMO, row.hmo),
    payer_type: firstNonEmpty(row.payer_type, 'HMO'),
    payer_code: firstNonEmpty(row.payer_code, row.nhia_hmo_id, row['HMO ID']),
    website: firstNonEmpty(row.website, row.WEBSITES),
    address_raw: firstNonEmpty(row.address_raw, row.address, row.Address),
    email: firstNonEmpty(row.email, row.Email),
    phone: firstNonEmpty(row.phone, row['Call Center Numbers'], row.call_center_numbers),
    state: firstNonEmpty(row.state, row.state_hint),
  };
}

function normalizeStateSchemeRow(row) {
  return {
    source: firstNonEmpty(row.source, 'nhia'),
    organization: firstNonEmpty(row.organization, row.organization_name, row.agency_name),
    state_code: firstNonEmpty(row.state_code, row.state),
    director: firstNonEmpty(row.director),
    website: firstNonEmpty(row.website),
    address_raw: firstNonEmpty(row.address_raw, row.address),
    email: firstNonEmpty(row.email),
    phone: firstNonEmpty(row.phone),
  };
}

function normalizeMedicineRow(row) {
  const flags = inferPrescriptionFlags(row);
  const genericName = firstNonEmpty(row.generic_name, row.medicine_name, row.name);

  return {
    source: firstNonEmpty(row.source, 'nhia'),
    source_med_code: firstNonEmpty(row.source_med_code, row.nhis_code),
    generic_name: genericName,
    form: firstNonEmpty(row.form, row.dosage_form),
    strength: firstNonEmpty(row.strength),
    pack_size: firstNonEmpty(row.pack_size, row.presentation),
    therapeutic_class: firstNonEmpty(row.therapeutic_class, row.category_hint),
    symptom_tags: firstNonEmpty(row.symptom_tags),
    prescription_required: flags.requiresPrescription ? 'true' : 'false',
    controlled: flags.controlled ? 'true' : 'false',
    nhia_listed: row.nhia_listed || row.nhis_code ? 'true' : 'false',
    otc_candidate: flags.otcCandidate ? 'true' : 'false',
  };
}

function normalizeFeaturedRow(row) {
  const flags = inferPrescriptionFlags(row);
  const displayName = firstNonEmpty(row.generic_name, row.display_name, row.name);
  const accessMode = firstNonEmpty(
    row.access_mode,
    flags.controlled ? 'controlled_or_high_risk_rx' : flags.requiresPrescription ? 'prescription_required' : 'pharmacist_review_or_otc_candidate'
  );

  return {
    generic_name: displayName,
    ui_category: firstNonEmpty(row.ui_category, row.use_case, row.featured_category, 'Featured medicines'),
    listing_status: firstNonEmpty(row.listing_status, 'featured'),
    access_mode: accessMode,
    product_logic_note: firstNonEmpty(row.product_logic_note, row.storefront_action),
  };
}

function inferProviderType(row, defaultProviderType = '') {
  const name = firstNonEmpty(row.provider_name, row.facility_name, row.pharmacy_name, row.name);
  const explicitType = firstNonEmpty(row.provider_type, row.service_category, defaultProviderType);
  if (explicitType) return explicitType;
  if (row.pharmacy_name || normalizeText(name).includes('pharm')) return 'pharmacy';
  return 'healthcare_provider';
}

function normalizeProviderRow(row, options = {}) {
  const providerType = inferProviderType(row, options.defaultProviderType);
  const sourceUrl = firstNonEmpty(row.source_url);
  const source = firstNonEmpty(
    row.source,
    options.defaultSource,
    normalizeText(sourceUrl).includes('reliance') ? 'reliance' : ''
  );

  return {
    source: source || 'seed',
    source_file: options.filename || null,
    source_code: firstNonEmpty(row.source_code, row.code, row.provider_code),
    provider_name: firstNonEmpty(row.provider_name, row.facility_name, row.pharmacy_name, row.name),
    provider_type: providerType,
    city: firstNonEmpty(row.city),
    lga: firstNonEmpty(row.lga),
    state: firstNonEmpty(row.state, row.state_hint),
    address_raw: firstNonEmpty(row.address_raw, row.address),
    phone: firstNonEmpty(row.phone),
    email: firstNonEmpty(row.email),
    website: firstNonEmpty(row.website),
    notes: firstNonEmpty(row.notes, row.service_category, row.accreditation_hint),
  };
}

function sourceIncludes(source, value) {
  return normalizeText(source).includes(value);
}

function getSourceBadgeLabel(source) {
  if (sourceIncludes(source, 'reliance')) return 'Reliance Network';
  if (sourceIncludes(source, 'nhia')) return 'NHIA Directory';
  return titleCase(source || 'Seed Directory');
}

function getAccreditationAuthority(row) {
  if (sourceIncludes(row.source, 'nhia')) return 'NHIA';
  if (sourceIncludes(row.source, 'reliance')) return 'Reliance Health';
  return getSourceBadgeLabel(row.source);
}

function getAccreditationStatus(row) {
  if (normalizeText(row.verification_status).includes('verified')) return 'verified';
  return 'listed';
}

function readProviderSeedRows() {
  return PROVIDER_SEED_FILES.flatMap((seedFile) =>
    readCsv(seedFile.filename).map((row) => normalizeProviderRow(row, seedFile))
  ).filter((row) => row.provider_name);
}

function buildGroupMetadata(row) {
  const normalizedName = normalizeProviderName(row.provider_name);
  const matchKey = buildProviderMatchKey({
    normalizedName,
    city: row.city,
    state: row.state,
  });
  const coordinates = getApproximateCoordinates({ city: row.city, state: row.state });
  const flags = deriveProviderFlags(row.provider_type, row.provider_name);
  const services = [
    titleCase(row.provider_type || 'Provider'),
    flags.emergencyCapable ? 'Emergency support' : null,
    flags.maternityCapable ? 'Maternity care' : null,
    flags.pediatricCapable ? 'Pediatric support' : null,
    flags.opticalCapable ? 'Optical care' : null,
    flags.dentalCapable ? 'Dental care' : null,
  ].filter(Boolean);

  const isReliance = sourceIncludes(row.source, 'reliance');
  const isNhia = sourceIncludes(row.source, 'nhia');
  const trustScore = isReliance ? 0.78 : isNhia ? 0.74 : 0.64;
  const dataConfidence = row.city && row.state ? 0.84 : row.address_raw && row.state ? 0.78 : 0.68;

  return {
    normalizedName,
    matchKey,
    coordinates,
    flags,
    services,
    trustScore,
    dataConfidence,
    acceptedPaymentTypes: inferAcceptedPaymentTypes(row.source),
    sourceBadges: [getSourceBadgeLabel(row.source)],
    insurances: isReliance ? ['Reliance Health'] : isNhia ? ['NHIA'] : [],
  };
}

function buildProviderDedupeKey(row) {
  return [
    normalizeText(row.source),
    normalizeProviderName(row.provider_name),
    normalizeText(row.city),
    normalizeText(row.state),
    normalizeText(row.address_raw),
  ]
    .filter(Boolean)
    .join('::');
}

async function upsertPayerNetworks(pool, rows) {
  for (const row of rows) {
    const normalizedName = normalizeText(row.payer_name);
    const dedupeKey = [normalizeText(row.source || 'nhia'), normalizedName, normalizeText(row.state)].join('::');
    await pool.query(
      `
        INSERT INTO ng_payer_networks (
          dedupe_key,
          source,
          payer_name,
          normalized_name,
          payer_type,
          payer_code,
          website,
          address_raw,
          email,
          phone,
          state,
          metadata
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        ON CONFLICT (dedupe_key)
        DO UPDATE SET
          payer_name = EXCLUDED.payer_name,
          payer_type = EXCLUDED.payer_type,
          payer_code = EXCLUDED.payer_code,
          website = EXCLUDED.website,
          address_raw = EXCLUDED.address_raw,
          email = EXCLUDED.email,
          phone = EXCLUDED.phone,
          metadata = EXCLUDED.metadata,
          updated_at = NOW()
      `,
      [
        dedupeKey,
        row.source || 'nhia',
        row.payer_name,
        normalizedName,
        row.payer_type || 'HMO',
        row.payer_code || null,
        row.website || null,
        row.address_raw || null,
        splitMultiValue(row.email),
        splitMultiValue(row.phone),
        row.state || null,
        { sourceFile: 'nhia_hmo_seed.csv' },
      ]
    );
  }
}

async function upsertStateInsuranceAgencies(pool, rows) {
  for (const row of rows) {
    const normalizedName = normalizeText(row.organization);
    const dedupeKey = [normalizeText(row.source || 'nhia'), normalizedName, normalizeText(row.state_code)].join('::');
    await pool.query(
      `
        INSERT INTO ng_state_insurance_agencies (
          dedupe_key,
          source,
          agency_name,
          normalized_name,
          website,
          address_raw,
          email,
          phone,
          state,
          metadata
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        ON CONFLICT (dedupe_key)
        DO UPDATE SET
          agency_name = EXCLUDED.agency_name,
          website = EXCLUDED.website,
          address_raw = EXCLUDED.address_raw,
          email = EXCLUDED.email,
          phone = EXCLUDED.phone,
          metadata = EXCLUDED.metadata,
          updated_at = NOW()
      `,
      [
        dedupeKey,
        row.source || 'nhia',
        row.organization,
        normalizedName,
        row.website || null,
        row.address_raw || null,
        splitMultiValue(row.email),
        splitMultiValue(row.phone),
        row.state_code || null,
        { director: row.director || null, sourceFile: 'nhia_sshia_seed.csv' },
      ]
    );
  }
}

async function upsertMedCatalog(pool, medRows, featuredRows) {
  const featuredByGeneric = new Map(
    featuredRows.map((row) => [normalizeText(row.generic_name), row])
  );

  for (const row of medRows) {
    const featured = featuredByGeneric.get(normalizeText(row.generic_name));
    const name = [row.generic_name, row.strength].filter(Boolean).join(' ').trim() || row.generic_name;
    const requiresPrescription = parseBoolean(row.prescription_required);
    const controlled = parseBoolean(row.controlled);
    const otcCandidate = featured
      ? normalizeText(featured.access_mode).includes('otc')
      : parseBoolean(row.otc_candidate) || !requiresPrescription;

    await pool.query(
      `
        INSERT INTO ng_drug_catalog (
          source,
          source_med_code,
          name,
          generic_name,
          dosage_form,
          strength,
          pack_size,
          therapeutic_class,
          symptom_tags,
          controlled,
          requires_prescription,
          nhia_listed,
          otc_candidate,
          price_ngn,
          featured_category,
          listing_status,
          access_mode,
          product_logic_note
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
        ON CONFLICT (name)
        DO UPDATE SET
          source = EXCLUDED.source,
          source_med_code = EXCLUDED.source_med_code,
          generic_name = EXCLUDED.generic_name,
          dosage_form = EXCLUDED.dosage_form,
          strength = EXCLUDED.strength,
          pack_size = EXCLUDED.pack_size,
          therapeutic_class = EXCLUDED.therapeutic_class,
          symptom_tags = EXCLUDED.symptom_tags,
          controlled = EXCLUDED.controlled,
          requires_prescription = EXCLUDED.requires_prescription,
          nhia_listed = EXCLUDED.nhia_listed,
          otc_candidate = EXCLUDED.otc_candidate,
          price_ngn = EXCLUDED.price_ngn,
          featured_category = COALESCE(EXCLUDED.featured_category, ng_drug_catalog.featured_category),
          listing_status = COALESCE(EXCLUDED.listing_status, ng_drug_catalog.listing_status),
          access_mode = COALESCE(EXCLUDED.access_mode, ng_drug_catalog.access_mode),
          product_logic_note = COALESCE(EXCLUDED.product_logic_note, ng_drug_catalog.product_logic_note),
          updated_at = NOW()
      `,
      [
        row.source || 'nhia',
        row.source_med_code || null,
        name,
        row.generic_name,
        row.form || null,
        row.strength || null,
        row.pack_size || null,
        row.therapeutic_class || null,
        splitMultiValue(row.symptom_tags),
        controlled,
        requiresPrescription,
        parseBoolean(row.nhia_listed),
        otcCandidate,
        null,
        featured?.ui_category || null,
        featured?.listing_status || null,
        featured?.access_mode || null,
        featured?.product_logic_note || null,
      ]
    );
  }

  for (const row of featuredRows) {
    const name = row.generic_name.trim();
    const updateResult = await pool.query(
      `
        UPDATE ng_drug_catalog
        SET
          featured_category = $2,
          listing_status = $3,
          access_mode = $4,
          product_logic_note = $5,
          otc_candidate = $6,
          updated_at = NOW()
        WHERE LOWER(COALESCE(generic_name, name)) = LOWER($1)
           OR LOWER(name) = LOWER($1)
      `,
      [
        name,
        row.ui_category,
        row.listing_status || null,
        row.access_mode || null,
        row.product_logic_note || null,
        normalizeText(row.access_mode).includes('otc'),
      ]
    );

    if (updateResult.rowCount > 0) {
      continue;
    }

    await pool.query(
      `
        INSERT INTO ng_drug_catalog (
          source,
          name,
          generic_name,
          featured_category,
          listing_status,
          access_mode,
          product_logic_note,
          otc_candidate,
          nhia_listed,
          requires_prescription
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, false, false)
        ON CONFLICT (name)
        DO UPDATE SET
          featured_category = EXCLUDED.featured_category,
          listing_status = EXCLUDED.listing_status,
          access_mode = EXCLUDED.access_mode,
          product_logic_note = EXCLUDED.product_logic_note,
          otc_candidate = EXCLUDED.otc_candidate,
          updated_at = NOW()
      `,
      [
        'featured_seed',
        name,
        name,
        row.ui_category,
        row.listing_status || null,
        row.access_mode || null,
        row.product_logic_note || null,
        normalizeText(row.access_mode).includes('otc'),
      ]
    );
  }
}

async function upsertProviderRows(pool, rows) {
  for (const row of rows) {
    const metadata = buildGroupMetadata(row);
    const accreditationAuthority = getAccreditationAuthority(row);
    const accreditationStatus = getAccreditationStatus(row);
    const slugBase = slugify(`${row.provider_name}-${row.city || 'ng'}-${row.state || 'ng'}`)
      || slugify(metadata.matchKey)
      || slugify(row.provider_name);

    const groupResult = await pool.query(
      `
        INSERT INTO ng_provider_match_groups (
          match_key,
          canonical_name,
          normalized_name,
          slug,
          provider_type,
          provider_subtype,
          accreditation_authority,
          accreditation_status,
          address_raw,
          city,
          state,
          country,
          latitude,
          longitude,
          geocode_quality,
          address_confidence,
          services,
          insurances,
          source_badges,
          accepted_payment_types,
          telehealth_capable,
          emergency_capable,
          maternity_capable,
          pediatric_capable,
          optical_capable,
          dental_capable,
          pharmacy_relevant,
          lab_relevant,
          gym_spa,
          trust_score,
          popularity_score,
          data_confidence,
          source_count,
          last_verified_at
        )
        VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'Nigeria',
          $12, $13, $14, $15, $16, $17, $18, $19, false, $20, $21, $22, $23, $24, $25, $26,
          $27, $28, 0.55, $29, 1, NOW()
        )
        ON CONFLICT (match_key)
        DO UPDATE SET
          canonical_name = EXCLUDED.canonical_name,
          normalized_name = EXCLUDED.normalized_name,
          provider_type = EXCLUDED.provider_type,
          provider_subtype = EXCLUDED.provider_subtype,
          address_raw = COALESCE(EXCLUDED.address_raw, ng_provider_match_groups.address_raw),
          city = COALESCE(EXCLUDED.city, ng_provider_match_groups.city),
          state = COALESCE(EXCLUDED.state, ng_provider_match_groups.state),
          latitude = COALESCE(EXCLUDED.latitude, ng_provider_match_groups.latitude),
          longitude = COALESCE(EXCLUDED.longitude, ng_provider_match_groups.longitude),
          geocode_quality = COALESCE(EXCLUDED.geocode_quality, ng_provider_match_groups.geocode_quality),
          address_confidence = COALESCE(EXCLUDED.address_confidence, ng_provider_match_groups.address_confidence),
          services = EXCLUDED.services,
          insurances = EXCLUDED.insurances,
          source_badges = EXCLUDED.source_badges,
          accepted_payment_types = EXCLUDED.accepted_payment_types,
          emergency_capable = EXCLUDED.emergency_capable,
          maternity_capable = EXCLUDED.maternity_capable,
          pediatric_capable = EXCLUDED.pediatric_capable,
          optical_capable = EXCLUDED.optical_capable,
          dental_capable = EXCLUDED.dental_capable,
          pharmacy_relevant = EXCLUDED.pharmacy_relevant,
          lab_relevant = EXCLUDED.lab_relevant,
          gym_spa = EXCLUDED.gym_spa,
          trust_score = GREATEST(ng_provider_match_groups.trust_score, EXCLUDED.trust_score),
          data_confidence = GREATEST(ng_provider_match_groups.data_confidence, EXCLUDED.data_confidence),
          last_verified_at = NOW(),
          updated_at = NOW()
        RETURNING id
      `,
      [
        metadata.matchKey,
        row.provider_name,
        metadata.normalizedName,
        slugBase,
        row.provider_type || 'provider',
        row.provider_type || null,
        accreditationAuthority,
        accreditationStatus,
        row.address_raw || null,
        row.city || null,
        row.state || null,
        metadata.coordinates.latitude,
        metadata.coordinates.longitude,
        metadata.coordinates.geocodeQuality,
        metadata.coordinates.geocodeQuality,
        JSON.stringify(metadata.services),
        JSON.stringify(metadata.insurances),
        metadata.sourceBadges,
        metadata.acceptedPaymentTypes,
        metadata.flags.emergencyCapable,
        metadata.flags.maternityCapable,
        metadata.flags.pediatricCapable,
        metadata.flags.opticalCapable,
        metadata.flags.dentalCapable,
        metadata.flags.pharmacyRelevant,
        metadata.flags.labRelevant,
        metadata.flags.gymSpa,
        metadata.trustScore,
        metadata.dataConfidence,
      ]
    );

    await pool.query(
      `
        INSERT INTO ng_provider_directory_rows (
          match_group_id,
          dedupe_key,
          source,
          provider_name,
          normalized_name,
          provider_type,
          provider_subtype,
          accreditation_authority,
          accreditation_status,
          address_raw,
          city,
          state,
          country,
          latitude,
          longitude,
          geocode_quality,
          services,
          insurances,
          telehealth_capable,
          emergency_capable,
          maternity_capable,
          pediatric_capable,
          optical_capable,
          dental_capable,
          gym_spa,
          trust_score,
          popularity_score,
          data_confidence,
          metadata,
          last_verified_at
        )
        VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'Nigeria',
          $13, $14, $15, $16, $17, false, $18, $19, $20, $21, $22, $23, $24, 0.55, $25, $26, NOW()
        )
        ON CONFLICT (dedupe_key)
        DO UPDATE SET
          match_group_id = EXCLUDED.match_group_id,
          provider_name = EXCLUDED.provider_name,
          normalized_name = EXCLUDED.normalized_name,
          provider_type = EXCLUDED.provider_type,
          provider_subtype = EXCLUDED.provider_subtype,
          address_raw = EXCLUDED.address_raw,
          city = EXCLUDED.city,
          state = EXCLUDED.state,
          latitude = EXCLUDED.latitude,
          longitude = EXCLUDED.longitude,
          geocode_quality = EXCLUDED.geocode_quality,
          services = EXCLUDED.services,
          insurances = EXCLUDED.insurances,
          emergency_capable = EXCLUDED.emergency_capable,
          maternity_capable = EXCLUDED.maternity_capable,
          pediatric_capable = EXCLUDED.pediatric_capable,
          optical_capable = EXCLUDED.optical_capable,
          dental_capable = EXCLUDED.dental_capable,
          gym_spa = EXCLUDED.gym_spa,
          trust_score = EXCLUDED.trust_score,
          data_confidence = EXCLUDED.data_confidence,
          metadata = EXCLUDED.metadata,
          last_verified_at = NOW(),
          updated_at = NOW()
      `,
      [
        groupResult.rows[0].id,
        buildProviderDedupeKey(row),
        row.source || 'reliance',
        row.provider_name,
        metadata.normalizedName,
        row.provider_type || 'provider',
        row.provider_type || null,
        accreditationAuthority,
        accreditationStatus,
        row.address_raw || null,
        row.city || null,
        row.state || null,
        metadata.coordinates.latitude,
        metadata.coordinates.longitude,
        metadata.coordinates.geocodeQuality,
        JSON.stringify(metadata.services),
        JSON.stringify(metadata.insurances),
        metadata.flags.emergencyCapable,
        metadata.flags.maternityCapable,
        metadata.flags.pediatricCapable,
        metadata.flags.opticalCapable,
        metadata.flags.dentalCapable,
        metadata.flags.gymSpa,
        metadata.trustScore,
        metadata.dataConfidence,
        {
          sourceFile: row.source_file || 'provider_seed_reliance.csv',
          sourceCode: row.source_code || null,
          notes: row.notes || null,
        },
      ]
    );
  }

  await pool.query(`
    UPDATE ng_provider_match_groups groups
    SET
      source_count = counts.row_count,
      updated_at = NOW()
    FROM (
      SELECT match_group_id, COUNT(*)::INTEGER AS row_count
      FROM ng_provider_directory_rows
      GROUP BY match_group_id
    ) counts
    WHERE groups.id = counts.match_group_id
  `);
}

async function ingestNigeriaPack() {
  const pool = getPool();
  await runNgMigrations(pool);

  const hmoRows = readCsv('nhia_hmo_seed.csv').map(normalizeHmoRow).filter((row) => row.payer_name);
  const stateSchemeRows = readCsv('nhia_sshia_seed.csv').map(normalizeStateSchemeRow).filter((row) => row.organization);
  const medRows = readCsv('nhia_meds_seed.csv').map(normalizeMedicineRow).filter((row) => row.generic_name);
  const featuredRows = readCsv('featured_meds.csv').map(normalizeFeaturedRow).filter((row) => row.generic_name);
  const providerRows = readProviderSeedRows();

  await pool.query('BEGIN');

  try {
    await upsertPayerNetworks(pool, hmoRows);
    await upsertStateInsuranceAgencies(pool, stateSchemeRows);
    await upsertMedCatalog(pool, medRows, featuredRows);
    await upsertProviderRows(pool, providerRows);
    await pool.query('COMMIT');
  } catch (error) {
    await pool.query('ROLLBACK');
    throw error;
  }

  return {
    payers: hmoRows.length,
    stateSchemes: stateSchemeRows.length,
    medicines: medRows.length,
    featuredCategories: featuredRows.length,
    providers: providerRows.length,
  };
}

async function getDiscoverySeedCounts(pool) {
  try {
    const { rows } = await pool.query(`
      SELECT
        (SELECT COUNT(*)::INTEGER FROM ng_provider_match_groups) AS providers,
        (SELECT COUNT(*)::INTEGER FROM ng_drug_catalog WHERE source_med_code IS NOT NULL OR nhia_listed = true) AS medicines,
        (SELECT COUNT(*)::INTEGER FROM ng_payer_networks) AS payers,
        (SELECT COUNT(*)::INTEGER FROM ng_state_insurance_agencies) AS state_schemes
    `);

    return rows[0] || { providers: 0, medicines: 0, payers: 0, state_schemes: 0 };
  } catch (error) {
    return { providers: 0, medicines: 0, payers: 0, state_schemes: 0 };
  }
}

async function seedNigeriaDiscoveryIfNeeded() {
  const pool = getPool();
  const before = await getDiscoverySeedCounts(pool);
  const needsSeed =
    Number(before.providers || 0) < 1000 ||
    Number(before.medicines || 0) < 900 ||
    Number(before.payers || 0) < 60 ||
    Number(before.state_schemes || 0) < 30;

  if (!needsSeed && process.env.NG_FORCE_SEED_DISCOVERY !== 'true') {
    return { skipped: true, before };
  }

  const summary = await ingestNigeriaPack();
  const after = await getDiscoverySeedCounts(pool);
  return { skipped: false, before, after, summary };
}

if (require.main === module) {
  seedNigeriaDiscoveryIfNeeded()
    .then((summary) => {
      console.log('[NG Discovery] Nigeria pack ingestion complete');
      console.log(JSON.stringify(summary, null, 2));
      process.exit(0);
    })
    .catch((error) => {
      console.error('[NG Discovery] Ingestion failed:', error);
      process.exit(1);
    });
}

module.exports = {
  ingestNigeriaPack,
  seedNigeriaDiscoveryIfNeeded,
};
