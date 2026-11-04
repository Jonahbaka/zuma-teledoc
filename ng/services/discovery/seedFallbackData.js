const fs = require('fs');
const path = require('path');
const {
  deriveProviderFlags,
  getApproximateCoordinates,
  inferAcceptedPaymentTypes,
  normalizeText,
  splitMultiValue,
  titleCase,
} = require('./utils');

const DATA_DIR = path.join(__dirname, '..', '..', 'data', 'doctarx_nigeria_data_pack');
const PROVIDER_SEED_FILES = [
  { filename: 'provider_seed_reliance.csv', defaultSource: 'reliance' },
  { filename: 'provider_seed_nhia_hcp.csv', defaultSource: 'nhia_hcp' },
  { filename: 'pharmacy_seed_base.csv', defaultSource: 'reliance', defaultProviderType: 'pharmacy' },
];

let cache = null;

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
  const target = path.join(DATA_DIR, filename);
  if (!fs.existsSync(target)) {
    return [];
  }

  return parseCsv(fs.readFileSync(target, 'utf8'));
}

function boolish(value) {
  return ['true', 'yes', '1'].includes(normalizeText(value));
}

function firstNonEmpty(...values) {
  return values.find((value) => String(value || '').trim() !== '') || '';
}

function sourceIncludes(source, value) {
  return normalizeText(source).includes(value);
}

function getSourceBadgeLabel(source) {
  if (sourceIncludes(source, 'reliance')) return 'Reliance/Alafia Network';
  if (sourceIncludes(source, 'nhia')) return 'NHIA Directory';
  return titleCase(source || 'Seed Directory');
}

function isControlled(row) {
  const safety = normalizeText(row.prescription_class || row.safety_label || row.access_mode);
  return safety.includes('controlled') || safety.includes('restricted') || safety.includes('high risk');
}

function requiresPrescription(row) {
  const safety = normalizeText(row.prescription_class || row.safety_label || row.access_mode);
  if (isControlled(row)) return true;
  if (safety.includes('prescription')) return true;
  if (safety.includes('clinical review')) return true;
  if (safety.includes('otc')) return false;
  return boolish(row.prescription_required);
}

function medicineAccessMode(row) {
  if (isControlled(row)) return 'controlled_or_high_risk_rx';
  if (requiresPrescription(row)) return 'prescription_required';
  if (normalizeText(row.prescription_class || row.safety_label).includes('otc')) {
    return 'pharmacist_review_or_otc_candidate';
  }
  return row.access_mode || 'clinical_review_required';
}

function mapMedicine(row, index = 0) {
  const name = row.medicine_name || row.name || row.display_name || row.generic_name || 'Medicine';
  const accessMode = medicineAccessMode(row);
  return {
    id: row.nhis_code || row.source_med_code || row.id || `seed-med-${index}`,
    name,
    genericName: row.generic_name || name,
    brandName: row.brand_name || null,
    dosageForm: row.dosage_form || row.form || null,
    strength: row.strength || null,
    therapeuticClass: row.category_hint || row.therapeutic_class || row.use_case || null,
    symptomTags: splitMultiValue(row.symptom_tags),
    diseaseTags: splitMultiValue(row.disease_tags),
    requiresPrescription: requiresPrescription(row),
    otcCandidate: accessMode.includes('otc') || accessMode.includes('pharmacist'),
    controlled: isControlled(row),
    nhiaListed: Boolean(row.nhis_code || row.source_med_code || boolish(row.nhia_listed)),
    priceNgn: row.price_ngn || null,
    priceNotes: row.presentation || row.price_notes || null,
    featuredCategory: row.featured_category || row.use_case || null,
    listingStatus: row.listing_status || 'catalog_reference',
    accessMode,
    productLogicNote:
      row.product_logic_note ||
      row.storefront_action ||
      (requiresPrescription(row)
        ? 'Start a consult before purchase or dispensing.'
        : 'Check pharmacy availability and pharmacist review before checkout.'),
  };
}

function mapFeaturedMedicine(row, medicines, index = 0) {
  const match =
    medicines.find((item) => normalizeText(item.name).includes(normalizeText(row.display_name))) ||
    medicines.find((item) => item.id && item.id === row.nhis_code);
  return {
    ...mapMedicine({ ...row, ...(match || {}) }, index),
    id: row.nhis_code || match?.id || `featured-med-${index}`,
    name: row.display_name || match?.name || 'Featured medicine',
    genericName: match?.genericName || row.display_name || 'Featured medicine',
    featuredCategory: row.use_case || match?.featuredCategory || 'Featured medicines',
    productLogicNote: row.storefront_action || match?.productLogicNote,
    accessMode: medicineAccessMode(row),
    listingStatus: 'featured',
  };
}

function mapProvider(row, index = 0) {
  const providerName = firstNonEmpty(row.provider_name, row.facility_name, row.pharmacy_name, row.name, 'Provider');
  const providerType = firstNonEmpty(
    row.provider_type,
    row.service_category,
    row.default_provider_type,
    row.pharmacy_name ? 'pharmacy' : '',
    'healthcare_provider'
  );
  const state = row.state || row.state_hint || null;
  const city = row.city || null;
  const coordinates = getApproximateCoordinates({ city, state });
  const flags = deriveProviderFlags(providerType, providerName);
  const source = sourceIncludes(row.source || row.source_url, 'reliance') ? 'reliance' : row.source || 'seed';
  const sourceBadge = getSourceBadgeLabel(source);
  const rowKey = firstNonEmpty(row.source_code, row.serial_no, `${row.source_file || 'seed'}:${index}`);

  return {
    id: `seed-provider:${row.source_file || source}:${rowKey}`,
    rawId: row.serial_no || null,
    kind: 'directory_provider',
    sourceType: 'seed_directory',
    canonicalName: providerName,
    providerType,
    providerSubtype: row.service_category || providerType,
    city,
    state,
    lga: row.lga || null,
    addressRaw: row.address_raw || row.address || null,
    latitude: row.latitude ? Number(row.latitude) : coordinates.latitude,
    longitude: row.longitude ? Number(row.longitude) : coordinates.longitude,
    geocodeQuality: row.geocode_status || coordinates.geocodeQuality,
    addressConfidence: row.geocode_status || coordinates.geocodeQuality,
    phone: splitMultiValue(row.phone),
    email: splitMultiValue(row.email),
    website: row.website || null,
    sourceBadges: [sourceBadge],
    acceptedPaymentTypes: inferAcceptedPaymentTypes(source),
    telehealthCapable: boolish(row.telehealth_enabled),
    emergencyCapable: flags.emergencyCapable,
    maternityCapable: flags.maternityCapable,
    pediatricCapable: flags.pediatricCapable,
    opticalCapable: flags.opticalCapable,
    dentalCapable: flags.dentalCapable,
    pharmacyRelevant: flags.pharmacyRelevant || normalizeText(providerType).includes('pharmacy'),
    labRelevant: flags.labRelevant,
    trustScore: sourceIncludes(source, 'reliance') ? 0.76 : sourceIncludes(source, 'nhia') ? 0.72 : 0.62,
    popularityScore: 0.55,
    dataConfidence: row.address || row.address_raw ? 0.72 : 0.55,
    sourceCount: 1,
    lastVerifiedAt: row.extracted_at || null,
    services: [titleCase(providerType), ...Object.entries(flags).filter(([, enabled]) => enabled).map(([key]) => key.replace(/Capable|Relevant/g, ''))],
    specialties: [],
    insurances: sourceIncludes(source, 'reliance') ? ['Reliance Health'] : sourceIncludes(source, 'nhia') ? ['NHIA'] : [],
    payerIds: [],
  };
}

function readProviderSeedRows() {
  return PROVIDER_SEED_FILES.flatMap((seedFile) =>
    readCsv(seedFile.filename).map((row) => ({
      ...row,
      source: firstNonEmpty(row.source, seedFile.defaultSource),
      source_file: seedFile.filename,
      default_provider_type: seedFile.defaultProviderType || '',
    }))
  );
}

function loadSeedData() {
  if (cache) {
    return cache;
  }

  const medicines = readCsv('nhia_meds_seed.csv').map(mapMedicine);
  const featuredMedicines = readCsv('featured_meds.csv').map((row, index) => mapFeaturedMedicine(row, medicines, index));
  const providers = readProviderSeedRows().map(mapProvider);
  const hmos = readCsv('nhia_hmo_seed.csv').map((row, index) => ({
    id: `seed-hmo:${row.nhia_hmo_id || row.payer_code || index}`,
    name: row.organization_name || row.payer_name || row.hmo || 'HMO',
    type: row.payer_type || 'HMO',
    code: row.nhia_hmo_id || row.payer_code || null,
    state: row.state_hint || row.state || null,
    website: row.website || null,
  }));
  const stateSchemes = readCsv('nhia_sshia_seed.csv').map((row, index) => ({
    id: `seed-sshia:${row.state || row.state_code || index}`,
    name: row.organization_name || row.organization || row.agency_name || 'State health insurance agency',
    state: row.state || row.state_code || null,
    website: row.website || null,
  }));

  cache = { medicines, featuredMedicines, providers, hmos, stateSchemes };
  return cache;
}

function matches(value, query) {
  if (!query) return true;
  return normalizeText(value).includes(normalizeText(query));
}

function getSeedProviders(filters = {}) {
  const { providers } = loadSeedData();
  const providerNeedle = normalizeText(filters.providerType);
  const query = normalizeText(filters.query || filters.medicine);

  return providers.filter((provider) => {
    if (filters.state && !matches(provider.state, filters.state)) return false;
    if (filters.city && !matches(provider.city || provider.addressRaw, filters.city)) return false;
    if (filters.lga && !matches(provider.lga || provider.addressRaw, filters.lga)) return false;

    if (providerNeedle && providerNeedle !== 'all') {
      const haystack = normalizeText(`${provider.providerType} ${provider.providerSubtype} ${provider.canonicalName}`);
      const labMatch = providerNeedle === 'lab' && (haystack.includes('lab') || haystack.includes('diagnostic'));
      const opticalMatch = providerNeedle === 'optical' && (haystack.includes('eye') || haystack.includes('optical'));
      if (!haystack.includes(providerNeedle) && !labMatch && !opticalMatch) return false;
    }

    if (!query) return true;
    return matches(`${provider.canonicalName} ${provider.providerType} ${provider.addressRaw} ${provider.state}`, query);
  });
}

function getSeedMedicines(filters = {}) {
  const { medicines, featuredMedicines } = loadSeedData();
  const filtered = medicines.filter((medicine) => {
    if (filters.query && !matches(`${medicine.name} ${medicine.genericName} ${medicine.strength} ${medicine.therapeuticClass}`, filters.query)) {
      return false;
    }
    if (filters.category && !matches(medicine.featuredCategory || medicine.therapeuticClass, filters.category)) {
      return false;
    }
    if (filters.accessMode && filters.accessMode !== 'all' && medicine.accessMode !== filters.accessMode) {
      return false;
    }
    if (filters.symptom && !matches(`${medicine.name} ${medicine.genericName} ${medicine.therapeuticClass}`, filters.symptom)) {
      return false;
    }
    return true;
  });

  if (filtered.length > 0 || (!filters.query && !filters.symptom)) {
    return filtered;
  }

  const fallbackNeedle = filters.query || filters.symptom;
  return featuredMedicines.filter((medicine) =>
    matches(`${medicine.name} ${medicine.genericName} ${medicine.featuredCategory} ${medicine.productLogicNote}`, fallbackNeedle)
  );
}

function getSeedFeaturedMedicines(limit = 12) {
  return loadSeedData().featuredMedicines.slice(0, limit);
}

function getSeedFeaturedCategories(limit = 8) {
  const categories = new Map();

  for (const medicine of loadSeedData().featuredMedicines) {
    const category = medicine.featuredCategory || 'Featured medicines';
    const current = categories.get(category) || {
      category,
      accessMode: medicine.accessMode,
      medCount: 0,
      medicineExamples: [],
    };

    current.medCount += 1;
    if (current.medicineExamples.length < 4) {
      current.medicineExamples.push(medicine.name);
    }

    categories.set(category, current);
  }

  return Array.from(categories.values()).slice(0, limit);
}

function getSeedPayers(limit = 50) {
  const { hmos, stateSchemes } = loadSeedData();
  return {
    hmos: hmos.slice(0, limit),
    stateSchemes: stateSchemes.slice(0, limit),
  };
}

module.exports = {
  getSeedFeaturedCategories,
  getSeedFeaturedMedicines,
  getSeedMedicines,
  getSeedPayers,
  getSeedProviders,
  loadSeedData,
};
