'use strict';

const express = require('express');
const rateLimit = require('express-rate-limit');
const { z } = require('zod');
const db = require('../db');
const pharmacyService = require('../services/pharmacyService');

const requestSchema = z.object({
  market: z.literal('US'),
  mode: z.enum(['device', 'manual']).optional(),
  latitude: z.number().finite().min(-90).max(90).optional(),
  longitude: z.number().finite().min(-180).max(180).optional(),
  radius: z.number().int().min(1).max(20000).optional(),
  limit: z.number().int().min(1).max(20).default(15),
  city: z.string().trim().min(1).max(120).optional(),
  state: z.string().trim().min(1).max(120).optional(),
  postalCode: z.string().trim().min(1).max(20).optional(),
  q: z.string().trim().max(120).optional(),
}).strict().superRefine((input, context) => {
  const coordinates = input.latitude !== undefined || input.longitude !== undefined;
  const area = input.city !== undefined || input.state !== undefined || input.postalCode !== undefined;
  if (coordinates && (input.latitude === undefined || input.longitude === undefined || area || input.mode === 'manual')) context.addIssue({ code: 'custom', message: 'Choose device coordinates or a manual area.' });
  if (!coordinates && (!area || input.mode === 'device' || input.radius !== undefined)) context.addIssue({ code: 'custom', message: 'A manual area is required.' });
});

function publicPharmacy(row, input, mode) {
  if (!row || row.synthetic === true || row.source === 'fallback') return null;
  const name = String(row.name || row.canonicalName || '').trim();
  if (!name || !['string', 'number'].includes(typeof row.id)) return null;
  const latitude = row.latitude == null ? null : Number(row.latitude);
  const longitude = row.longitude == null ? null : Number(row.longitude);
  const validCoordinates = latitude !== null && longitude !== null && Number.isFinite(latitude) && Number.isFinite(longitude) && Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180;
  let distanceKm = null;
  if (mode === 'device' && validCoordinates) {
    const radians = (number) => number * Math.PI / 180;
    const deltaLatitude = radians(latitude - input.latitude), deltaLongitude = radians(longitude - input.longitude);
    const haversine = Math.sin(deltaLatitude / 2) ** 2 + Math.cos(radians(input.latitude)) * Math.cos(radians(latitude)) * Math.sin(deltaLongitude / 2) ** 2;
    distanceKm = 6371 * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(Math.max(0, 1 - haversine)));
  }
  return {
    id: row.id,
    name,
    address: row.address || [row.address_line1 || row.addressLine1, row.address_line2 || row.addressLine2, row.city, row.state, row.zip_code || row.zipCode].filter(Boolean).join(', ') || null,
    city: row.city || null,
    state: row.state || null,
    postalCode: row.zip_code || row.zipCode || row.postalCode || null,
    phone: row.phone || null,
    latitude: validCoordinates ? latitude : null,
    longitude: validCoordinates ? longitude : null,
    distanceKm,
    distanceMiles: distanceKm === null ? null : distanceKm * 0.621371,
    source: row.source === 'openstreetmap' ? 'openstreetmap' : 'network',
    verificationStatus: 'details_not_verified',
    isOpen: null,
    isPreferred: null,
  };
}

async function manualPharmacies(database, input) {
  const conditions = ["is_active = true", "UPPER(TRIM(country)) IN ('US','USA','UNITED STATES','UNITED STATES OF AMERICA')"];
  const parameters = [];
  for (const [field, column] of [['city', 'city'], ['state', 'state']]) {
    if (input[field]) { parameters.push(input[field]); conditions.push('LOWER(TRIM(' + column + ')) = LOWER($' + parameters.length + ')'); }
  }
  if (input.postalCode) { parameters.push(input.postalCode); conditions.push('(zip_code = $' + parameters.length + " OR SPLIT_PART(zip_code,'-',1) = $" + parameters.length + ')'); }
  if (input.q) { parameters.push(input.q); conditions.push('(POSITION(LOWER($' + parameters.length + ') IN LOWER(name)) > 0 OR POSITION(LOWER($' + parameters.length + ') IN LOWER(address_line1)) > 0)'); }
  parameters.push(input.limit);
  // These are business directory fields. Patient preferences, coverage,
  // inventory, owner accounts and internal identifiers are never selected.
  const { rows } = await database.query(`SELECT id,name,address_line1,address_line2,city,state,zip_code,phone,latitude,longitude
    FROM pharmacy_network WHERE ${conditions.join(' AND ')} ORDER BY name,id LIMIT $${parameters.length}`, parameters);
  return rows;
}

function createPublicDirectoryRouter({ database = db, lookup = pharmacyService, maxRequests = 30, timeoutMs = 15000 } = {}) {
  const router = express.Router();
  router.use(rateLimit({ windowMs: 60000, max: maxRequests, standardHeaders: true, legacyHeaders: false, message: { success: false, error: 'Too many directory requests. Please wait before trying again.' } }));
  router.use(express.json({ limit: '4kb' }));
  router.post('/pharmacies', async (req, res) => {
    res.set('Cache-Control', 'private, no-store');
    const parsed = requestSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ success: false, code: 'DIRECTORY_LOCATION_INVALID', error: 'Choose a valid device location or a manual city, region, or postal code.' });
    const input = parsed.data;
    const mode = input.latitude !== undefined ? 'device' : 'manual';
    const controller = new AbortController();
    const abort = () => { if (!res.writableEnded) controller.abort(); };
    req.once('aborted', abort);
    res.once('close', abort);
    let timer;
    try {
      const timeout = new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('Directory timeout')); }, timeoutMs); });
      const operation = mode === 'device' ? lookup.findNearbyPharmacies(input.latitude, input.longitude, input.radius || 5000, { signal: controller.signal }) : manualPharmacies(database, input);
      const rows = await Promise.race([operation, timeout]);
      if (controller.signal.aborted || res.destroyed) return;
      if (!Array.isArray(rows)) throw new Error('Directory response invalid');
      let pharmacies = rows.map((row) => publicPharmacy(row, input, mode)).filter(Boolean);
      if (input.q && mode === 'device') { const term = input.q.toLowerCase(); pharmacies = pharmacies.filter((row) => (row.name + ' ' + (row.address || '')).toLowerCase().includes(term)); }
      if (mode === 'device') {
        pharmacies = pharmacies.filter((row) => row.distanceKm !== null && row.distanceKm * 1000 <= (input.radius || 5000));
        pharmacies.sort((first, second) => first.distanceKm - second.distanceKm);
      }
      res.json({ success: true, pharmacies: pharmacies.slice(0, input.limit), locationMode: mode, attribution: mode === 'device' ? 'OpenStreetMap contributors and DoctaRx pharmacy registry' : 'DoctaRx pharmacy registry' });
    } catch {
      if (!res.destroyed && !res.writableEnded) res.status(503).json({ success: false, code: 'PHARMACY_DIRECTORY_UNAVAILABLE', error: 'The pharmacy directory is temporarily unavailable. Try again or enter pharmacy details manually.' });
    } finally { clearTimeout(timer); req.off('aborted', abort); res.off('close', abort); }
  });
  router.use((error, _req, res, next) => {
    if (!error) return next();
    res.status(error.type === 'entity.too.large' ? 413 : 400).json({ success: false, code: 'DIRECTORY_REQUEST_INVALID', error: 'The directory request is invalid.' });
  });
  return router;
}

module.exports = createPublicDirectoryRouter();
module.exports.createPublicDirectoryRouter = createPublicDirectoryRouter;
