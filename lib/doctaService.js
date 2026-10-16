/**
 * Client integration helpers. Directory entries are public map information;
 * coverage, clinical assessments and external submissions need live adapters.
 */

import api from './api';

function unavailable(code, message) {
  return Object.assign(new Error(message), { code, status: 503, source: 'unavailable' });
}

function mapDirectoryRows(rows) {
  if (!Array.isArray(rows) || rows.some((pharmacy) => !pharmacy
    || typeof (pharmacy.name || pharmacy.canonicalName) !== 'string'
    || !(pharmacy.name || pharmacy.canonicalName).trim()
    || !['string', 'number'].includes(typeof pharmacy.id)
    || pharmacy.synthetic === true || pharmacy.source === 'fallback')) {
    throw unavailable('PHARMACY_DIRECTORY_UNAVAILABLE', 'The pharmacy directory returned an unreadable result. Try again.');
  }
  return rows.slice(0, 15).map((pharmacy) => ({
    id: pharmacy.id,
    name: pharmacy.name || pharmacy.canonicalName,
    address: pharmacy.address || pharmacy.addressRaw || [pharmacy.city, pharmacy.state].filter(Boolean).join(', ') || 'Address not recorded',
    latitude: pharmacy.latitude ?? null,
    longitude: pharmacy.longitude ?? null,
    source: pharmacy.source === 'openstreetmap' ? 'OpenStreetMap public directory'
      : ['network', 'internal_pharmacy'].includes(pharmacy.source || pharmacy.sourceType) ? 'DoctaRx pharmacy registry'
        : 'Pharmacy directory record',
    verificationStatus: 'details_not_verified',
    isOpen: null,
    isPreferred: null,
  }));
}

export const DoctaService = {
  findPharmacies: async ({ market = 'US', location, query = '', signal } = {}) => {
    if (location?.status !== 'ready') throw unavailable('PHARMACY_LOCATION_REQUIRED', 'Choose an area or use your device location before searching.');
    const search = String(query).trim().slice(0, 120);
    const parameters = {};
    if (location.mode === 'device') {
      const { latitude, longitude } = location;
      if (typeof latitude !== 'number' || typeof longitude !== 'number'
        || !Number.isFinite(latitude) || !Number.isFinite(longitude)
        || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) throw new Error('A valid device location is required.');
      Object.assign(parameters, { latitude, longitude });
    } else if (location.mode === 'manual') {
      for (const field of ['city', 'state', 'postalCode']) {
        const value = String(location[field] || '').trim().slice(0, field === 'postalCode' ? 20 : 120);
        if (value) parameters[field] = value;
      }
      if (!Object.keys(parameters).length) throw new Error('Choose a city, region, or postal code.');
    } else throw new Error('Choose a valid search location.');

    // Browser requests remain on the existing API origin. Manual areas never
    // retain prior GPS coordinates and are text searches, not geocoded distance.
    if (market === 'NG') {
      if (location.mode === 'manual' && !parameters.city && !parameters.state) {
        throw Object.assign(new Error('Postal-code search is not available for the Nigeria directory. Enter a city or state, or use your device location.'), { code: 'POSTAL_AREA_UNSUPPORTED', status: 400 });
      }
      const { data } = await api.get('/ng/discovery/providers', {
        params: { ...parameters, mode: 'pharmacy', providerType: 'pharmacy', q: search || null, limit: 15 },
        signal,
      });
      return mapDirectoryRows(data?.providers);
    }
    const { data } = await api.post('/directory/pharmacies', {
      market: 'US', mode: location.mode, ...parameters,
      ...(search ? { q: search } : {}), ...(location.mode === 'device' ? { radius: 5000 } : {}), limit: 15,
    }, { signal, skipAuth: true });
    if (!data?.success) throw unavailable('PHARMACY_DIRECTORY_UNAVAILABLE', 'The pharmacy directory could not be reached. Try again.');
    return mapDirectoryRows(data.pharmacies);
  },

  findRealPharmacies: async (latitude, longitude, options = {}) => DoctaService.findPharmacies({
    ...options,
    location: { mode: 'device', status: 'ready', latitude, longitude },
  }),

  // Current OCR and benefit adapters do not perform live extraction or
  // adjudication. Entered details must not become verified insurance data.
  verifyInsuranceReal: async () => {
    throw unavailable('INSURANCE_ELIGIBILITY_NOT_CONNECTED', 'Live insurance eligibility is not connected. Coverage must be confirmed with the insurer.');
  },
  ocrScan: async () => {
    throw unavailable('INSURANCE_OCR_NOT_CONNECTED', 'Insurance card scanning is not connected. Enter the details from your own card.');
  },
  runAITriage: async () => {
    throw unavailable('OPTIONAL_SYMPTOM_GUIDANCE_NOT_CONNECTED', 'Optional automated symptom guidance is not connected. You can continue booking and share your symptoms with a clinician.');
  },
  comparePrices: async () => {
    throw unavailable('LIVE_MEDICATION_PRICING_NOT_CONNECTED', 'Live medication pricing and insurance benefits are not connected. Confirm the cost with the pharmacy or insurer.');
  },
  submitPA: async () => {
    throw unavailable('PRIOR_AUTHORIZATION_NOT_CONNECTED', 'Prior authorization submission is not connected. No request has been sent to an insurer.');
  },
};

