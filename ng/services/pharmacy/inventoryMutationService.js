'use strict';

// External inventory mutations require current workspace authority, not clinical
// dispensing approval. Pending pharmacies may still prepare inventory through
// the existing update/import paths; addInventory retains its approval rule.
const { z } = require('zod');
const { sqlDateEndUtc } = require('../shared/sqlDate');
const inventory = require('./inventoryService');
const onboarding = require('./pharmacyOnboardingService');
const compliance = require('../compliance/complianceService');
const uuid = z.string().uuid();
const quantity = z.number().int().min(0).max(2147483647);
const money = z.number().finite().min(0).max(9999999999.99);
const text = max => z.string().max(max).refine(value => !/[\u0000-\u001f\u007f]/.test(value));
const date = z.string().refine(value => Number.isFinite(sqlDateEndUtc(value))).nullable();
const updateSchema = z.object({
  quantityAvailable: quantity.optional(), sellingPrice: money.optional(), costPrice: money.optional(),
  discountPercent: z.number().finite().min(0).max(100).optional(), reorderLevel: quantity.optional(),
  isAvailable: z.boolean().optional(), expiryDate: date.optional(),
}).strict().refine(value => Object.keys(value).length > 0);
const itemSchema = z.object({
  drugId: uuid.optional(), drugName: text(255).optional(), quantity: quantity.optional(),
  costPrice: money.optional(), sellingPrice: money.optional(), batchNumber: text(50).optional(),
  expiryDate: date.optional(), reorderLevel: quantity.optional(),
}).strict();
const addItemSchema = itemSchema.extend({ drugId: uuid, quantity, costPrice: money, sellingPrice: money, markupPercent: z.number().finite().min(-999.99).max(999.99).optional() });
const bulkSchema = z.object({ items: z.array(itemSchema).min(1).max(500) }).strict();
const addSchema = z.object({ items: z.array(addItemSchema).min(1).max(500) }).strict();
function fail(status, message) { return Object.assign(new Error(message), { status, code: 'INVENTORY_MUTATION_REJECTED' }); }
async function mutate(pool, actor, pharmacyId, action, input, inventoryId) {
  const actorId = actor?.id || actor?.userId || actor?.sub;
  if (!uuid.safeParse(actorId).success) throw fail(403, 'An active authorized inventory account is required.');
  const schema = action === 'update' ? updateSchema : action === 'add' ? addSchema : action === 'import' ? bulkSchema : null;
  const parsed = schema?.safeParse(input);
  if (!uuid.safeParse(pharmacyId).success || (action === 'update' && !uuid.safeParse(inventoryId).success) || !parsed?.success || Buffer.byteLength(JSON.stringify(input), 'utf8') > 256 * 1024) throw fail(400, 'Supply a bounded inventory request with supported fields and valid values.');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const current = (await client.query('SELECT id,role,is_active,account_status,market_scope FROM users WHERE id=$1 FOR SHARE', [actorId])).rows[0];
    const admin = current && ['admin', 'super_admin'].includes(current.role);
    if (!current?.is_active || current.account_status !== 'active' || (!admin && (current.role !== 'pharmacy' || current.market_scope !== 'NG'))) throw fail(403, 'An active authorized inventory account is required.');
    const pharmacy = (await client.query('SELECT id,owner_user_id,status,account_status FROM ng_pharmacies WHERE id=$1 FOR SHARE', [pharmacyId])).rows[0];
    if (!pharmacy || !['active', 'pending_onboarding'].includes(pharmacy.account_status)
      || !['pending_review', 'documents_submitted', 'under_verification', 'approved'].includes(pharmacy.status)
      || (!admin && pharmacy.owner_user_id !== current.id)) throw fail(403, 'An active authorized pharmacy workspace is required.');
    let result, previousStatus;
    if (action === 'update') {
      const previous = (await client.query('SELECT availability_verification_status FROM ng_pharmacy_inventory WHERE id=$1 AND pharmacy_id=$2 FOR UPDATE', [inventoryId, pharmacyId])).rows[0];
      if (!previous) throw fail(404, 'Inventory item not found.');
      previousStatus = previous.availability_verification_status;
      result = await inventory.updateItem(pharmacyId, inventoryId, parsed.data, client);
    } else if (action === 'add') {
      // Preserve the existing add endpoint's owner/approved restrictions, even
      // though current administrators may update/import other active workspaces.
      if (pharmacy.owner_user_id !== current.id || pharmacy.status !== 'approved') throw fail(403, 'Approved pharmacy owner access is required to add inventory.');
      result = await onboarding.addInventory(pharmacyId, current.id, parsed.data.items, client);
    } else result = await inventory.bulkImport(pharmacyId, parsed.data.items, client);
    await compliance.logAction({ actorUserId: current.id, actorType: current.role, action: `pharmacy_inventory_${action}`, resourceType: 'ng_pharmacy', resourceId: pharmacyId, pharmacyId,
      details: action === 'update' ? { inventoryId, previousAvailabilityStatus: previousStatus, fields: Object.keys(parsed.data) } : { itemCount: parsed.data.items.length, ...(action === 'import' ? { imported: result.imported, skipped: result.skipped } : { added: result.added.filter(row => row.inventory).length }) },
    }, client);
    await client.query('COMMIT'); return result;
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}
function sendError(res, error) {
  const safe = error.code === 'INVENTORY_MUTATION_REJECTED' && [400,403,404].includes(error.status);
  return res.status(safe ? error.status : 503).json({ error: safe ? error.message : 'Inventory changes could not be confirmed. Refresh the inventory before trying again.' });
}
module.exports = { mutate, sendError };
