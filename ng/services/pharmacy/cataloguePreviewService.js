'use strict';

// A transport-free validation contract, not an inventory importer or partner
// activation mechanism. No patient data, URL, token, or availability claim is
// accepted. External API/file activation remains independently blocked.
const { z } = require('zod');
const MAX_ROWS = 500;
const MAX_BYTES = 256 * 1024;
const text = max => z.string().regex(/^[^\u0000-\u001f\u007f]+$/).trim().min(1).max(max);
const envelopeSchema = z.object({
  schemaVersion: z.literal(1),
  profileId: z.string().uuid(),
  partnerBranchReference: text(120),
  generatedAt: z.string().datetime({ offset: true }),
  items: z.array(z.unknown()).min(1).max(MAX_ROWS),
}).strict();
const itemSchema = z.object({
  partnerItemId: text(120), drugId: z.string().uuid(),
  identity: z.object({ name: text(255), dosageForm: text(100), strength: text(100), packSize: text(50), manufacturer: text(255) }).strict(),
  quantityUnit: z.literal('catalogue_pack'),
  quantityAvailable: z.number().int().min(0).max(2147483647),
  unitPriceMinor: z.number().int().min(0).max(999999999999),
  currency: z.literal('NGN'),
  batchNumber: text(50),
  expiryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  observedAt: z.string().datetime({ offset: true }),
}).strict();
function fail(statusCode, code, message) { return Object.assign(new Error(message), { statusCode, code }); }
function validateEnvelope(input) {
  let size;
  try { size = Buffer.byteLength(JSON.stringify(input) || '', 'utf8'); }
  catch { throw fail(400, 'CATALOGUE_PREVIEW_INVALID', 'Supply a JSON catalogue envelope.'); }
  if (size > MAX_BYTES) throw fail(413, 'CATALOGUE_PREVIEW_TOO_LARGE', 'Catalogue preview is limited to 256 KiB.');
  const parsed = envelopeSchema.safeParse(input);
  if (!parsed.success) throw fail(400, 'CATALOGUE_PREVIEW_INVALID', 'Supply schemaVersion 1, profileId, partnerBranchReference, generatedAt and 1–500 items only.');
  return parsed.data;
}
const normalized = value => typeof value === 'string' ? value.trim().toLowerCase() : '';
function validateRows(envelope, catalogue, maxAgeSeconds, nowMs = Date.now()) {
  if (!Number.isInteger(maxAgeSeconds) || maxAgeSeconds < 60 || maxAgeSeconds > 86400) {
    throw fail(409, 'CATALOGUE_FRESHNESS_NOT_CONFIGURED', 'Configure the agreed inventory freshness window before validating a feed.');
  }
  if (!Number.isFinite(nowMs)) throw fail(500, 'CATALOGUE_CLOCK_INVALID', 'Catalogue validation is temporarily unavailable.');
  const generatedMs = Date.parse(envelope.generatedAt);
  if (generatedMs > nowMs || nowMs - generatedMs > maxAgeSeconds * 1000) {
    throw fail(422, 'CATALOGUE_FEED_STALE', 'The feed timestamp is stale or in the future.');
  }
  const parsedRows = envelope.items.map(item => itemSchema.safeParse(item));
  const partnerCounts = new Map(), stockCounts = new Map();
  for (const parsed of parsedRows) if (parsed.success) {
    const row = parsed.data, stockKey = `${row.drugId.toLowerCase()}:${normalized(row.batchNumber)}`;
    partnerCounts.set(row.partnerItemId, (partnerCounts.get(row.partnerItemId) || 0) + 1);
    stockCounts.set(stockKey, (stockCounts.get(stockKey) || 0) + 1);
  }
  const byId = new Map(catalogue.map(drug => [String(drug.id).toLowerCase(), drug]));
  const today = new Date(nowMs).toISOString().slice(0, 10);
  const rows = parsedRows.map((parsed, index) => {
    if (!parsed.success) return { index, valid: false, reasons: ['INVALID_ROW_SHAPE'] };
    const row = parsed.data, drug = byId.get(row.drugId.toLowerCase()), reasons = [];
    if (partnerCounts.get(row.partnerItemId) > 1 || stockCounts.get(`${row.drugId.toLowerCase()}:${normalized(row.batchNumber)}`) > 1) reasons.push('DUPLICATE_PRODUCT_OR_BATCH');
    if (!drug || drug.is_active !== true || drug.nafdac_approved !== true) reasons.push('CATALOGUE_MAPPING_UNAVAILABLE');
    else {
      const fields = { name: 'name', dosageForm: 'dosage_form', strength: 'strength', packSize: 'pack_size', manufacturer: 'manufacturer' };
      // No synonym, brand, unit conversion, substitution or fuzzy-name inference.
      if (Object.entries(fields).some(([incoming, stored]) => !normalized(drug[stored]) || normalized(row.identity[incoming]) !== normalized(drug[stored]))) reasons.push('CATALOGUE_IDENTITY_MISMATCH');
    }
    const expiryMs = Date.parse(`${row.expiryDate}T00:00:00Z`);
    if (!Number.isFinite(expiryMs) || new Date(expiryMs).toISOString().slice(0, 10) !== row.expiryDate || row.expiryDate <= today) reasons.push('BATCH_EXPIRED_OR_INVALID');
    const observedMs = Date.parse(row.observedAt);
    if (observedMs > generatedMs || observedMs > nowMs || nowMs - observedMs > maxAgeSeconds * 1000) reasons.push('STOCK_TIMESTAMP_STALE_OR_INVALID');
    return { index, valid: reasons.length === 0, reasons };
  });
  return {
    schemaVersion: 1, valid: rows.every(row => row.valid), persisted: false,
    liveConnection: false, availabilityVerified: false, activationAuthorized: false,
    quantityUnit: 'catalogue_pack', currency: 'NGN', priceUnit: 'kobo_per_catalogue_pack',
    rows, accepted: rows.filter(row => row.valid).length, rejected: rows.filter(row => !row.valid).length,
    notice: 'Validation preview only. No inventory was imported, availability verified, partner connected or activation approved.',
  };
}
async function previewCatalogue(pool, actor, pharmacyId, input) {
  if (!z.string().uuid().safeParse(pharmacyId).success || !z.string().uuid().safeParse(actor?.id || actor?.userId || actor?.sub).success) {
    throw fail(403, 'CATALOGUE_SCOPE_DENIED', 'An authorized pharmacy workspace is required.');
  }
  const envelope = validateEnvelope(input);
  const actorId = actor.id || actor.userId || actor.sub;
  // Read current account, pharmacy ownership and configured partner branch in
  // one statement. Never trust client role claims or a supplied profile alone.
  const scope = await pool.query(
    `SELECT profile.id, profile.version, profile.settings
       FROM users actor
       JOIN ng_pharmacies pharmacy ON pharmacy.id=$2
       JOIN ng_pharmacy_commercial_branches branch ON branch.pharmacy_id=pharmacy.id
       JOIN ng_pharmacy_commercial_profiles profile ON profile.id=branch.profile_id
      WHERE actor.id=$1 AND actor.is_active=TRUE AND actor.market_scope='NG'
        AND (actor.role IN ('admin','super_admin') OR (actor.role='pharmacy' AND pharmacy.owner_user_id=actor.id))
        AND pharmacy.status='approved' AND pharmacy.verified_at IS NOT NULL AND pharmacy.pcn_license_expiry>=CURRENT_DATE
        AND profile.id=$3 AND profile.status IN ('draft','testing','active')
        AND branch.partner_branch_reference=$4`,
    [actorId, pharmacyId, envelope.profileId, envelope.partnerBranchReference]
  );
  if (!scope.rows.length) throw fail(403, 'CATALOGUE_SCOPE_DENIED', 'An authorized pharmacy and configured partner branch are required.');
  const profile = scope.rows[0];
  const ids = [...new Set(envelope.items.map(item => itemSchema.safeParse(item)).filter(parsed => parsed.success).map(parsed => parsed.data.drugId))];
  const catalogue = ids.length ? (await pool.query(
    'SELECT id,name,dosage_form,strength,pack_size,manufacturer,is_active,nafdac_approved FROM ng_drug_catalog WHERE id=ANY($1::uuid[])', [ids]
  )).rows : [];
  return { ...validateRows(envelope, catalogue, profile.settings?.inventoryMaxAgeSeconds), profileVersion: profile.version };
}
module.exports = { previewCatalogue, validateEnvelope, validateRows, MAX_ROWS, MAX_BYTES };
