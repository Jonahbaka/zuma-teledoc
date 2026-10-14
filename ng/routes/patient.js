/**
 * Nigeria Patient Routes
 * Drug search, prescription upload, order management, delivery tracking
 */

const express = require('express');
const router = express.Router();
const rxRouter = require('../services/rx-engine/rxRouter');
const privateUpload = require('../services/rx-engine/privatePrescriptionUploadService');
const multer = require('multer');
const { requireRole } = require('../../server/middleware/auth');
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: privateUpload.MAX_IMAGE_BYTES, files: 1, fields: 0, parts: 1 } }).single('image');
const orderService = require('../services/pharmacy/orderService');
const deliveryService = require('../services/logistics/deliveryService');
const { getPool } = require('../../server/db');

// --- DRUG SEARCH ---

// Search drugs in catalog
router.get('/drugs/search', async (req, res) => {
  try {
    const { q, category, limit } = req.query;
    if (!q) return res.status(400).json({ error: 'Search query required' });

    const results = await rxRouter.searchDrugs(q, category, parseInt(limit) || 20);
    res.json({ results, count: results.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Compare pharmacies for a drug
router.post('/drugs/compare', async (req, res) => {
  try {
    const { items, latitude, longitude, strategy, maxRadiusKm, allowSubstitution } = req.body;
    if (!items?.length) return res.status(400).json({ error: 'At least one drug item required' });
    if (!latitude || !longitude) return res.status(400).json({ error: 'Location required' });

    const results = await rxRouter.routePrescription({
      items, latitude, longitude,
      strategy: strategy || 'best_match',
      maxRadiusKm: maxRadiusKm || 25,
      allowSubstitution: allowSubstitution !== false,
    });
    res.json(results);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Check drug availability at a pharmacy
router.get('/drugs/:drugId/availability/:pharmacyId', async (req, res) => {
  try {
    const result = await rxRouter.checkAvailability(req.params.pharmacyId, req.params.drugId);
    res.json(result || { available: false });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- PRESCRIPTIONS ---

// Upload prescription image
router.post('/prescriptions/upload', requireRole('patient'), (req, res, next) => upload(req, res, (error) => error ? res.status(400).json({ error: 'Choose one JPEG or PNG image up to 5 MB.' }) : next()), async (req, res) => {
  try {
    const result = await privateUpload.saveSubmission(getPool(), req, { image: req.file });
    res.status(201).json(result);
  } catch (err) {
    res.status(err.status || (['42P01','42703'].includes(err.code) ? 503 : 500)).json({ error: err.status ? err.message : 'Prescription submission is temporarily unavailable.' });
  }
});

router.get('/prescriptions/:id/image', requireRole('patient'), async (req, res) => {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(req.params.id)) return res.status(400).json({ error: 'Invalid prescription.' });
  try {
    const image = await privateUpload.readOwnedImage(getPool(), req, req.params.id);
    res.set({ 'Content-Type': 'image/png', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Disposition': 'inline; filename="prescription.png"' }).send(image);
  } catch (err) { res.status(err.status || 503).json({ error: err.status ? err.message : 'This image could not be opened.' }); }
});

// Submit prescription as text
router.post('/prescriptions/text', requireRole('patient'), async (req, res) => {
  try {
    const { text } = req.body;
    if (!text) return res.status(400).json({ error: 'Prescription text required' });

    const result = await privateUpload.saveSubmission(getPool(), req, { text });
    res.status(201).json(result);
  } catch (err) {
    res.status(err.status || 503).json({ error: err.status ? err.message : 'Prescription submission is temporarily unavailable.' });
  }
});

// Route prescription to pharmacies
router.post('/prescriptions/:prescriptionId/route', async (req, res) => {
  try {
    const pool = getPool();
    const rx = await pool.query(
      'SELECT * FROM ng_prescriptions WHERE id = $1 AND patient_user_id = $2',
      [req.params.prescriptionId, req.user.id]
    );

    if (!rx.rows.length) return res.status(404).json({ error: 'Prescription not found' });
    if (!['verified','matched','dispensing'].includes(rx.rows[0].status)) return res.status(409).json({ error: 'Prescription review is required before pharmacy routing.' });

    const items = typeof rx.rows[0].items === 'string'
      ? JSON.parse(rx.rows[0].items) : rx.rows[0].items;

    const { latitude, longitude, strategy } = req.body;
    if (!latitude || !longitude) return res.status(400).json({ error: 'Location required' });

    const rxItems = items.map(i => ({
      drug_name: i.catalogMatch?.name || i.drug_name,
      generic_name: i.generic_name,
      quantity: i.quantity || 1,
    }));

    const results = await rxRouter.routePrescription({
      items: rxItems, latitude, longitude,
      strategy: strategy || 'best_match',
    });

    res.json(results);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get patient prescriptions
router.get('/prescriptions', async (req, res) => {
  try {
    const pool = getPool();
    const limit = parseInt(req.query.limit) || 20;
    const offset = ((parseInt(req.query.page) || 1) - 1) * limit;
    const uploaded = await pool.query(
      `SELECT id, status, created_at, items, prescriber_name, ocr_confidence,
              is_controlled_substance, expires_at
       FROM ng_prescriptions WHERE patient_user_id = $1
       ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
      [req.user.id, limit, offset]
    );
    const digital = await pool.query(
      `SELECT rx.id,
              rx.status,
              rx.dispense_status,
              rx.pharmacy_response_status,
              rx.created_at,
              rx.items,
              rx.prescription_number,
              rx.expires_at,
              provider.full_name AS prescriber_name,
              pharmacy.name AS pharmacy_name,
              pharmacy.phone AS pharmacy_phone,
              pharmacy.whatsapp_business_number,
              rx.fulfillment_preference,
              rx.confirmed_price_ngn,
              rx.pharmacy_notes
         FROM ng_digital_prescriptions rx
         JOIN ng_providers provider ON provider.id = rx.provider_id
         LEFT JOIN ng_pharmacies pharmacy
           ON pharmacy.id = COALESCE(rx.routed_pharmacy_id, rx.preferred_pharmacy_id, rx.dispensed_by_pharmacy_id)
        WHERE rx.patient_user_id = $1
        ORDER BY rx.created_at DESC
        LIMIT $2 OFFSET $3`,
      [req.user.id, limit, offset]
    );

    res.json([
      ...digital.rows.map((row) => ({ ...row, source_type: 'provider_digital_prescription' })),
      ...uploaded.rows.map((row) => ({ ...row, source_type: 'patient_uploaded_prescription' })),
    ].sort((a, b) => new Date(b.created_at) - new Date(a.created_at)));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- ORDERS ---

// Create order
router.post('/orders', async (req, res) => {
  try {
    const result = await orderService.createOrder({
      patientUserId: req.user.id,
      ...req.body,
    });
    res.status(201).json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Pay for order
router.post('/orders/:orderId/pay', async (req, res) => {
  try {
    const result = await orderService.initiatePayment(req.params.orderId, req.user.id);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Get order details
router.get('/orders/:orderId', async (req, res) => {
  try {
    const result = await orderService.getOrder(req.params.orderId, req.user.id);
    if (!result) return res.status(404).json({ error: 'Order not found' });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// List patient orders
router.get('/orders', async (req, res) => {
  try {
    const result = await orderService.listPatientOrders(req.user.id, {
      page: parseInt(req.query.page) || 1,
      limit: parseInt(req.query.limit) || 20,
      status: req.query.status,
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Cancel order
router.post('/orders/:orderId/cancel', async (req, res) => {
  try {
    const result = await orderService.cancelOrder(
      req.params.orderId, req.user.id, req.body.reason || 'Patient cancelled'
    );
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// --- DELIVERY TRACKING ---

// Get delivery tracking
router.get('/tracking/:trackingId', async (req, res) => {
  try {
    const result = await deliveryService.getTracking(req.params.trackingId);
    if (!result) return res.status(404).json({ error: 'Tracking not found' });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- NEARBY PHARMACIES ---

// Find pharmacies near patient
router.get('/pharmacies/nearby', async (req, res) => {
  try {
    const { latitude, longitude, radius } = req.query;
    if (!latitude || !longitude) return res.status(400).json({ error: 'Location required' });

    const pool = getPool();
    const result = await pool.query(
      `SELECT id, name, slug, address_line1, city, state, phone,
              rating, total_orders, delivery_enabled, delivery_radius_km,
              minimum_order_amount, operating_hours,
              (6371 * acos(cos(radians($1)) * cos(radians(latitude))
                * cos(radians(longitude) - radians($2))
                + sin(radians($1)) * sin(radians(latitude)))) AS distance_km
       FROM ng_pharmacies
       WHERE status = 'approved' AND latitude IS NOT NULL
         AND (6371 * acos(cos(radians($1)) * cos(radians(latitude))
           * cos(radians(longitude) - radians($2))
           + sin(radians($1)) * sin(radians(latitude)))) <= $3
       ORDER BY distance_km ASC
       LIMIT 20`,
      [parseFloat(latitude), parseFloat(longitude), parseFloat(radius) || 25]
    );

    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
