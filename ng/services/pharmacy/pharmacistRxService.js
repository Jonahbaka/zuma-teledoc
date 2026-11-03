'use strict';

// Public pharmacist API boundary. Trusted medication-order reconciliation keeps
// using the internal workflow directly; no request flag can select that path.
const { z } = require('zod');
const { sqlDateEndUtc } = require('../shared/sqlDate');
const workflow = require('../rx-engine/prescriptionWorkflowService');
const compliance = require('../compliance/complianceService');
const { assertClinicalPharmacyActive } = require('./clinicalPharmacyAuthorization');
const uuid = z.string().uuid();
const note = z.string().trim().max(4000).refine(value => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value));
const dispense = z.object({ quantity: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).nullable().optional(), substitute_drug_id: uuid.nullable().optional(), substitute_reason: note.nullable().optional(), notes: note.nullable().optional() }).strict();
const unavailable = z.object({ notes: note.nullable().optional() }).strict();
const filters = z.object({ pharmacy_id: uuid.optional(), status: z.enum(Object.keys(workflow.TRANSITIONS)).optional(),
  since: z.string().datetime({ offset: true }).optional(), limit: z.string().regex(/^[1-9]\d{0,2}$/).transform(Number).refine(value => value <= 500).optional() }).strict();
const pharmacyFields = "p.id,p.owner_user_id,p.status,p.account_status,p.verified_at,to_char(p.pcn_license_expiry,'YYYY-MM-DD') AS pcn_license_expiry,p.pcn_license_number,p.superintendent_pcn_number";
const permitted = "'sent_to_pharmacy','received','partially_dispensed','fully_dispensed','completed'";
function fail(status, message) { return Object.assign(new Error(message), { status, code: 'PHARMACIST_RX_REJECTED' }); }
function parse(schema, input) { const result = schema.safeParse(input); if (!result.success) throw fail(400, 'Supply valid prescription identifiers, filters and bounded clinical fields.'); return result.data; }
async function tx(pool, fn) {
  const client = await pool.connect();
  try { await client.query('BEGIN'); const result = await fn(client); await client.query('COMMIT'); return result; }
  catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
}
async function account(client, actor) {
  if (actor?.role !== 'pharmacy' || !uuid.safeParse(actor?.id).success) throw fail(403, 'Current Nigeria pharmacy professional access is required.');
  const user = (await client.query("SELECT id,role FROM users WHERE id=$1 AND role='pharmacy' AND is_active=TRUE AND account_status='active' AND market_scope='NG' FOR SHARE", [actor.id])).rows[0];
  if (!user) throw fail(403, 'Current Nigeria pharmacy professional access is required.');
  return user;
}
async function audit(client, user, pharmacyId, action, resourceId, details = {}) {
  await compliance.logAction({ actorUserId: user.id, actorType: 'pharmacist', action: `pharmacist_rx.${action}`, resourceType: 'digital_prescription', resourceId, pharmacyId, details }, client);
}
async function scoped(client, user, prescriptionId, mutation) {
  // Resolve only authority metadata before the clinical read. A preferred
  // pharmacy, or a formerly routed one, does not obtain patient data here.
  const p = (await client.query(`SELECT ${pharmacyFields} FROM ng_pharmacies p
    JOIN ng_digital_prescriptions rx ON rx.routed_pharmacy_id=p.id
    WHERE rx.id=$1 AND p.owner_user_id=$2 FOR SHARE OF p`, [prescriptionId, user.id])).rows[0];
  if (!p) throw fail(404, 'Prescription not found for this pharmacy.');
  assertClinicalPharmacyActive(p);
  const rx = (await client.query(`SELECT id,to_char(expires_at,'YYYY-MM-DD') AS expires_at FROM ng_digital_prescriptions
    WHERE id=$1 AND routed_pharmacy_id=$2 AND signed_at IS NOT NULL AND lifecycle_status IN (${permitted})
    FOR ${mutation ? 'UPDATE' : 'SHARE'}`, [prescriptionId, p.id])).rows[0];
  if (!rx) throw fail(404, 'Prescription not found for this pharmacy.');
  return { p, rx };
}
async function list(pool, actor, query = {}) {
  const data = parse(filters, query);
  return tx(pool, async client => {
    const user = await account(client, actor);
    const p = (await client.query(`SELECT ${pharmacyFields} FROM ng_pharmacies p
      WHERE p.owner_user_id=$1 AND ($2::uuid IS NULL OR p.id=$2) AND p.status='approved' AND p.account_status='active'
        AND p.verified_at IS NOT NULL AND p.pcn_license_expiry>=CURRENT_DATE
      ORDER BY p.id LIMIT 1 FOR SHARE OF p`, [user.id, data.pharmacy_id || null])).rows[0];
    assertClinicalPharmacyActive(p);
    const rows = (await client.query(`SELECT rx.*,
      (SELECT COUNT(*) FROM ng_rx_items i WHERE i.prescription_id=rx.id) AS item_count,
      (SELECT COUNT(*) FROM ng_rx_items i WHERE i.prescription_id=rx.id AND i.status='dispensed') AS dispensed_count
      FROM ng_digital_prescriptions rx WHERE rx.routed_pharmacy_id=$1 AND rx.signed_at IS NOT NULL
        AND rx.lifecycle_status IN (${permitted}) AND ($2::ng_rx_status IS NULL OR rx.lifecycle_status=$2::ng_rx_status)
        AND ($3::timestamptz IS NULL OR rx.created_at>=$3)
      ORDER BY CASE rx.lifecycle_status WHEN 'sent_to_pharmacy' THEN 1 WHEN 'received' THEN 2 WHEN 'partially_dispensed' THEN 3 ELSE 4 END,
        rx.created_at DESC,rx.id LIMIT $4 FOR SHARE OF rx`, [p.id, data.status || null, data.since || null, data.limit || 50])).rows;
    await audit(client, user, p.id, 'list_viewed', null, { count: rows.length });
    return rows;
  });
}
async function read(pool, actor, prescriptionId, events = false) {
  parse(uuid, prescriptionId);
  return tx(pool, async client => {
    const user = await account(client, actor); const { p } = await scoped(client, user, prescriptionId, false);
    const result = events ? await workflow.listEvents(prescriptionId, client) : await workflow.getPrescription(prescriptionId, client);
    await audit(client, user, p.id, events ? 'events_viewed' : 'prescription_viewed', prescriptionId);
    return result;
  });
}
async function mutate(pool, actor, prescriptionId, action, raw = {}, itemId = null) {
  parse(uuid, prescriptionId);
  if (!['receive', 'dispense', 'unavailable', 'complete'].includes(action)) throw fail(400, 'Unsupported pharmacist prescription action.');
  if (['dispense', 'unavailable'].includes(action)) parse(uuid, itemId);
  const data = parse(action === 'dispense' ? dispense : action === 'unavailable' ? unavailable : z.object({}).strict(), raw);
  return tx(pool, async client => {
    const user = await account(client, actor); const { p, rx } = await scoped(client, user, prescriptionId, true);
    if (action === 'dispense') {
      const end = sqlDateEndUtc(rx.expires_at);
      if (!rx.expires_at || !Number.isFinite(end) || end <= Date.now()) throw fail(409, 'A current unexpired signed prescription is required for new dispensing.');
    }
    const professional = { user_id: user.id, kind: 'pharmacist' };
    let result;
    if (action === 'receive') result = await workflow.acknowledgeReceipt(prescriptionId, professional, client);
    if (action === 'dispense') result = await workflow.dispenseItem(prescriptionId, itemId, professional, { ...data, pharmacy_id: p.id }, client);
    if (action === 'unavailable') result = await workflow.markItemUnavailable(prescriptionId, itemId, professional, data, client);
    if (action === 'complete') result = await workflow.complete(prescriptionId, professional, client);
    if (action === 'dispense' && data.notes) {
      await client.query(`INSERT INTO ng_rx_events(prescription_id,item_id,actor_user_id,actor_kind,event_kind,notes)
        VALUES($1,$2,$3,'pharmacist','dispense_note_recorded',$4)`, [prescriptionId, itemId, user.id, data.notes]);
    }
    await audit(client, user, p.id, action, prescriptionId, { ...(itemId ? { itemId } : {}) });
    return result;
  });
}
function sendError(res, error) {
  const explicit = ['PHARMACIST_RX_REJECTED', 'PHARMACY_CLINICAL_ACCESS_INACTIVE'].includes(error.code);
  const workflowStatus = { NOT_FOUND: 404, INVALID_STATE: 409, INVALID_TRANSITION: 409 }[error.code];
  const status = explicit && [400, 403, 404, 409].includes(error.status) ? error.status : workflowStatus || 503;
  return res.status(status).json({ ok: false, error: explicit ? error.message : workflowStatus ? 'The current prescription or medicine state does not permit this action.' : 'Prescription access is temporarily unavailable. No action was confirmed.' });
}
module.exports = { list, read, mutate, sendError };
