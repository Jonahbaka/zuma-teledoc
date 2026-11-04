const express = require('express');
const router = express.Router();
const {
  createMedicationAvailabilityRequest,
  createFallbackRequest,
  getDiscoveryHome,
  getPayers,
  logDiscoveryEvent,
  searchMedicines,
  searchProviders,
} = require('../services/discovery/providerDiscoveryService');

function parseNumber(value) {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  if (!['string', 'number'].includes(typeof value) || String(value).trim() === '') return null;

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function publicLocation(query) {
  const latitude = parseNumber(query.latitude);
  const longitude = parseNumber(query.longitude);
  const present = value => value !== undefined && value !== null;
  if ((present(query.latitude) && (latitude === null || Math.abs(latitude) > 90)) ||
      (present(query.longitude) && (longitude === null || Math.abs(longitude) > 180))) {
    throw Object.assign(new Error('Valid device coordinates are required.'), { statusCode: 400 });
  }
  const area = {};
  for (const key of ['city', 'state', 'postalCode']) {
    if (query[key] !== undefined && (typeof query[key] !== 'string' || query[key].length > (key === 'postalCode' ? 20 : 120))) {
      throw Object.assign(new Error('Choose a valid city, state or postal area.'), { statusCode: 400 });
    }
    area[key] = typeof query[key] === 'string' ? query[key].trim() || null : null;
  }
  return { latitude, longitude, ...area, radius: query.radius === undefined ? 20000 : parseNumber(query.radius) };
}

function publicLimit(value, fallback) {
  if (value === undefined) return fallback;
  const limit = parseNumber(value);
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw Object.assign(new Error('Limit must be between 1 and 50.'), { statusCode: 400 });
  return limit;
}

function sendDirectoryError(res, error) {
  return res.status(error.statusCode === 400 ? 400 : 503).json({
    success: false,
    error: [400, 503].includes(error.statusCode) ? error.message : 'The DoctaRx directory is currently unavailable. Please retry.',
    code: error.code === 'POSTAL_AREA_UNSUPPORTED' ? error.code : error.statusCode === 400 ? 'DIRECTORY_INPUT_INVALID' : 'DIRECTORY_UNAVAILABLE',
  });
}

router.get('/home', async (req, res) => {
  try {
    const data = await getDiscoveryHome({
      ...publicLocation(req.query),
      query: req.query.q || null,
    });

    res.json(data);
  } catch (error) {
    sendDirectoryError(res, error);
  }
});

router.get('/providers', async (req, res) => {
  try {
    const data = await searchProviders({
      ...publicLocation(req.query),
      query: req.query.q || null,
      symptom: req.query.symptom || null,
      specialty: req.query.specialty || null,
      providerType: req.query.providerType || req.query.provider_type || null,
      payer: req.query.payer || null,
      mode: req.query.mode || 'nearest',
      lga: req.query.lga || null,
      medicine: req.query.medicine || null,
      limit: publicLimit(req.query.limit, 12),
      sessionId: req.query.sessionId || null,
    });

    res.json(data);
  } catch (error) {
    sendDirectoryError(res, error);
  }
});

router.get('/medicines', async (req, res) => {
  try {
    const data = await searchMedicines({
      query: req.query.q || null,
      symptom: req.query.symptom || null,
      category: req.query.category || null,
      accessMode: req.query.accessMode || null,
      limit: publicLimit(req.query.limit, 16),
    });

    res.json(data);
  } catch (error) {
    sendDirectoryError(res, error);
  }
});

router.post('/medication-requests', async (req, res) => {
  try {
    const request = await createMedicationAvailabilityRequest({
      medicineCatalogId: req.body?.medicineCatalogId || null,
      starterCatalogId: req.body?.starterCatalogId || null,
      medicineName: req.body?.medicineName || null,
      genericName: req.body?.genericName || null,
      dosageStrength: req.body?.dosageStrength || null,
      quantity: req.body?.quantity || req.body?.quantityRequested || null,
      requiresPrescription: req.body?.requiresPrescription,
      prescriptionAttached: req.body?.prescriptionAttached,
      prescriptionAttachmentUrl: req.body?.prescriptionAttachmentUrl || null,
      prescriptionNotes: req.body?.prescriptionNotes || null,
      fulfillmentPreference: req.body?.fulfillmentPreference || null,
      preferredPharmacyId: req.body?.preferredPharmacyId || null,
      contactName: req.body?.contactName || null,
      phone: req.body?.phone || null,
      whatsappNumber: req.body?.whatsappNumber || null,
      email: req.body?.email || null,
      state: req.body?.state || null,
      city: req.body?.city || null,
      lga: req.body?.lga || null,
      landmark: req.body?.landmark || null,
      locationPermissionStatus: req.body?.locationPermissionStatus || null,
      locationLatitude: parseNumber(req.body?.locationLatitude),
      locationLongitude: parseNumber(req.body?.locationLongitude),
      locationAccuracy: parseNumber(req.body?.locationAccuracy),
      notes: req.body?.notes || null,
      sessionId: req.body?.sessionId || null,
    });

    res.status(201).json({
      success: true,
      request,
      statusMessage: 'Pending partner pharmacy confirmation.',
      availabilityMessage: 'Availability will be confirmed by partner pharmacies.',
      pricingMessage: 'Price will be confirmed by the selected pharmacy.',
    });
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.message });
  }
});

router.get('/payers', async (req, res) => {
  try {
    const data = await getPayers(publicLimit(req.query.limit, 40));
    res.json(data);
  } catch (error) {
    sendDirectoryError(res, error);
  }
});

router.post('/events', async (req, res) => {
  try {
    if (!req.body?.eventType) {
      return res.status(400).json({ error: 'eventType is required' });
    }

    await logDiscoveryEvent({
      eventType: req.body.eventType,
      sessionId: req.body.sessionId || null,
      providerReference: req.body.providerReference || null,
      medReference: req.body.medReference || null,
      query: req.body.query || null,
      payload: req.body.payload || {},
    });

    res.status(202).json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/fallback', async (req, res) => {
  try {
    if (!req.body?.requestType) {
      return res.status(400).json({ error: 'requestType is required' });
    }

    if (!req.body?.phone && !req.body?.email) {
      return res.status(400).json({ error: 'phone or email is required' });
    }

    const request = await createFallbackRequest({
      requestType: req.body.requestType,
      contactName: req.body.contactName || null,
      phone: req.body.phone || null,
      email: req.body.email || null,
      preferredContactMethod: req.body.preferredContactMethod || null,
      symptom: req.body.symptom || null,
      careNeed: req.body.careNeed || null,
      state: req.body.state || null,
      city: req.body.city || null,
      landmark: req.body.landmark || null,
      notes: req.body.notes || null,
      query: req.body.query || null,
      sessionId: req.body.sessionId || null,
      connection: req.body.connection || {},
      medication: req.body.medication || null,
    });

    res.status(201).json({
      success: true,
      request,
      message: 'Fallback request received. Our Nigeria care team can continue with phone, WhatsApp, or async follow-up.',
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
