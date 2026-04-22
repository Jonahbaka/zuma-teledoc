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

  const trustScore = row.source === 'reliance' ? 0.78 : 0.64;
  const dataConfidence = row.city && row.state ? 0.84 : 0.68;

  return {
    normalizedName,
    matchKey,
    coordinates,
    flags,
    services,
    trustScore,
    dataConfidence,
    acceptedPaymentTypes: inferAcceptedPaymentTypes(row.source),
    sourceBadges: [row.source === 'reliance' ? 'Reliance Network' : titleCase(row.source)],
    insurances: row.source === 'reliance' ? ['Reliance Health'] : [],
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
      : !requiresPrescription;

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
    const slugBase = slugify(`${row.provider_name}-${row.city || row.state || 'ng'}`) || slugify(row.provider_name);

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
          $1, $2, $3, $4, $5, $6, 'Reliance Health', 'listed', $7, $8, $9, 'Nigeria',
          $10, $11, $12, $13, $14, $15, $16, $17, false, $18, $19, $20, $21, $22, $23, $24,
          $25, $26, 0.55, $27, 1, NOW()
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
          $1, $2, $3, $4, $5, $6, $7, 'Reliance Health', 'listed', $8, $9, $10, 'Nigeria',
          $11, $12, $13, $14, $15, false, $16, $17, $18, $19, $20, $21, $22, 0.55, $23, $24, NOW()
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
        { sourceFile: 'provider_seed_reliance.csv', notes: row.notes || null },
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

  const hmoRows = readCsv('nhia_hmo_seed.csv');
  const stateSchemeRows = readCsv('nhia_sshia_seed.csv');
  const medRows = readCsv('nhia_meds_seed.csv');
  const featuredRows = readCsv('featured_meds.csv');
  const providerRows = readCsv('provider_seed_reliance.csv');

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

if (require.main === module) {
  ingestNigeriaPack()
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
};
