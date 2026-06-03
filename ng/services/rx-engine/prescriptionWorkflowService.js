'use strict';

/**
 * ng/services/rx-engine/prescriptionWorkflowService.js
 *
 * Prescription lifecycle on top of ng_digital_prescriptions + ng_rx_items.
 *
 * State machine (lifecycle_status):
 *   drafted → signed → sent_to_pharmacy → received
 *           → partially_dispensed → fully_dispensed → completed
 *           | cancelled (any non-terminal)
 *           | expired  (sent_to_pharmacy | received | partially_dispensed)
 */

const crypto = require('crypto');
const { getPool, transaction } = require('../../../server/db');

const TRANSITIONS = {
  drafted:             ['signed', 'cancelled'],
  signed:              ['sent_to_pharmacy', 'cancelled'],
  sent_to_pharmacy:    ['received', 'cancelled', 'expired'],
  received:            ['partially_dispensed', 'fully_dispensed', 'cancelled', 'expired'],
  partially_dispensed: ['partially_dispensed', 'fully_dispensed', 'cancelled', 'expired'],
  fully_dispensed:     ['completed'],
  completed:           [],
  cancelled:           [],
  expired:             [],
};

function isValidTransition(from, to) {
  return (TRANSITIONS[from] || []).includes(to);
}
function isTerminal(s) { return (TRANSITIONS[s] || []).length === 0; }

/**
 * Pure dispense-completion decision, shared by the live service and the
 * simulation harness so they can never drift. Given the current status and the
 * item tallies, returns the next lifecycle status.
 *   counts: { total, dispensed, finalized }
 *     total     = all items
 *     dispensed = items with status 'dispensed'
 *     finalized = items dispensed | cancelled | unavailable
 */
function nextDispenseStatus(fromStatus, { total, dispensed, finalized }) {
  if (!['received', 'partially_dispensed'].includes(fromStatus)) return fromStatus;
  if (finalized === total && dispensed > 0) return 'fully_dispensed';
  if (dispensed > 0 || finalized > 0)       return 'partially_dispensed';
  return fromStatus;
}

let rxSequenceDate = null;
let rxSequenceValue = 0;
let rxSequenceCount = 0;

function generateRxNumber(now = new Date()) {
  const date = now.toISOString().slice(0, 10).replace(/-/g, '');
  if (date !== rxSequenceDate) {
    rxSequenceDate = date;
    rxSequenceValue = crypto.randomInt(0x10000);
    rxSequenceCount = 0;
  }
  if (rxSequenceCount >= 0x10000) {
    throw new Error(`Daily prescription number space exhausted for ${date}`);
  }
  rxSequenceValue = (rxSequenceValue + 1) & 0xffff;
  rxSequenceCount += 1;
  const tail = rxSequenceValue.toString(16).padStart(4, '0').toUpperCase();
  return `NG-RX-${date}-${tail}`;
}

// ─── Create + sign ────────────────────────────────────────────────────────────

/**
 * Create a draft prescription.
 *   input: { provider_id, patient_user_id, appointment_id?, items[], diagnosis?,
 *            preferred_pharmacy_id?, notes?, is_controlled? }
 *   items: [{ drug_id?, drug_name, generic_name?, brand_name?, dosage,
 *             frequency, duration_days?, quantity?, refills_authorized?, notes? }]
 */
async function createDraft(input, existing = null) {
  if (!input.provider_id)     throw new Error('provider_id required');
  if (!input.patient_user_id) throw new Error('patient_user_id required');
  if (!Array.isArray(input.items) || input.items.length === 0) {
    throw new Error('at least one item required');
  }

  const rxNumber = generateRxNumber();
  // Header + all item rows + the drafted event write atomically. Previously these
  // were separate autocommit writes, so a failure partway through the item loop
  // left an orphaned prescription header with partial items and no audit event.
  const run = async (client) => {
    const r = await client.query(
      `INSERT INTO ng_digital_prescriptions
         (provider_id, patient_user_id, appointment_id, prescription_number,
          items, preferred_pharmacy_id, diagnosis, notes, is_controlled,
          lifecycle_status)
       VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,COALESCE($9,false),'drafted')
       RETURNING *`,
      [
        input.provider_id, input.patient_user_id, input.appointment_id || null,
        rxNumber,
        JSON.stringify(input.items),  // keep legacy JSONB blob in sync
        input.preferred_pharmacy_id || null,
        input.diagnosis || null,
        input.notes || null,
        input.is_controlled || false,
      ]
    );
    const rx = r.rows[0];

    // Normalized items
    for (let i = 0; i < input.items.length; i++) {
      const it = input.items[i];
      await client.query(
        `INSERT INTO ng_rx_items
           (prescription_id, position, drug_id, drug_name, generic_name, brand_name,
            dosage, frequency, duration_days, quantity, refills_authorized,
            refills_remaining, notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,COALESCE($11,0),COALESCE($11,0),$12)`,
        [
          rx.id, i + 1, it.drug_id || null,
          it.drug_name, it.generic_name || null, it.brand_name || null,
          it.dosage, it.frequency,
          it.duration_days || null, it.quantity || null,
          it.refills_authorized || 0, it.notes || null,
        ]
      );
    }

    await logEvent(rx.id, null, { kind: 'system' }, 'drafted', null, 'drafted', 'prescription drafted', null, client);
    return rx.id;
  };

  const rxId = existing ? await run(existing) : await transaction(run);
  return getPrescription(rxId);
}

async function getPrescription(id, pool = getPool()) {
  const r = await pool.query(`SELECT * FROM ng_digital_prescriptions WHERE id = $1`, [id]);
  if (!r.rows[0]) return null;
  const items = await pool.query(
    `SELECT * FROM ng_rx_items WHERE prescription_id = $1 ORDER BY position`, [id]
  );
  return { ...r.rows[0], items: items.rows };
}

async function listPrescriptions({ provider_id, patient_user_id, pharmacy_id, status, since, limit = 50 } = {}, pool = getPool()) {
  const where = [];
  const params = [];
  if (provider_id)     { params.push(provider_id);     where.push(`p.provider_id = $${params.length}`); }
  if (patient_user_id) { params.push(patient_user_id); where.push(`p.patient_user_id = $${params.length}`); }
  if (pharmacy_id)     { params.push(pharmacy_id);     where.push(`(p.preferred_pharmacy_id = $${params.length} OR p.routed_pharmacy_id = $${params.length})`); }
  if (status)          { params.push(status);          where.push(`p.lifecycle_status = $${params.length}`); }
  if (since)           { params.push(since);           where.push(`p.created_at >= $${params.length}`); }
  params.push(Math.min(limit, 500));
  const sql = `
    SELECT p.*,
      (SELECT COUNT(*) FROM ng_rx_items i WHERE i.prescription_id = p.id) AS item_count,
      (SELECT COUNT(*) FROM ng_rx_items i WHERE i.prescription_id = p.id AND i.status = 'dispensed') AS dispensed_count
      FROM ng_digital_prescriptions p
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY p.created_at DESC
     LIMIT $${params.length}
  `;
  const r = await pool.query(sql, params);
  return r.rows;
}

/**
 * Sign (lock) a draft. Optional sig_text snapshot saved.
 */
async function sign(id, actor, { sig_text } = {}, pool = getPool()) {
  const rx = await getPrescription(id, pool);
  if (!rx) throwNotFound();
  assertTransition(rx.lifecycle_status, 'signed');
  const r = await pool.query(
    `UPDATE ng_digital_prescriptions
        SET lifecycle_status = 'signed', signed_at = NOW(),
            sig_text = COALESCE($2, sig_text), updated_at = NOW()
      WHERE id = $1 RETURNING *`,
    [id, sig_text || null]
  );
  await logEvent(id, null, actor, 'signed', rx.lifecycle_status, 'signed', 'prescriber signed', null, pool);
  return r.rows[0];
}

/**
 * Route a signed prescription to a specific pharmacy.
 */
async function sendToPharmacy(id, pharmacyId, actor, pool = getPool()) {
  if (!pharmacyId) throw new Error('pharmacyId required');
  const rx = await getPrescription(id, pool);
  if (!rx) throwNotFound();
  assertTransition(rx.lifecycle_status, 'sent_to_pharmacy');
  const r = await pool.query(
    `UPDATE ng_digital_prescriptions
        SET lifecycle_status = 'sent_to_pharmacy',
            routed_pharmacy_id = $2, routed_at = NOW(),
            sent_at = NOW(), updated_at = NOW()
      WHERE id = $1 RETURNING *`,
    [id, pharmacyId]
  );
  await logEvent(id, null, actor, 'sent', rx.lifecycle_status, 'sent_to_pharmacy',
    `routed to pharmacy ${pharmacyId}`, { pharmacy_id: pharmacyId }, pool);
  return r.rows[0];
}

/**
 * Pharmacy acknowledges receipt.
 */
async function acknowledgeReceipt(id, actor, pool = getPool()) {
  const rx = await getPrescription(id, pool);
  if (!rx) throwNotFound();
  assertTransition(rx.lifecycle_status, 'received');
  const r = await pool.query(
    `UPDATE ng_digital_prescriptions
        SET lifecycle_status = 'received', received_at = NOW(), updated_at = NOW()
      WHERE id = $1 RETURNING *`, [id]
  );
  await logEvent(id, null, actor, 'received', rx.lifecycle_status, 'received',
    'pharmacy acknowledged receipt', null, pool);
  return r.rows[0];
}

// ─── Item-level dispense ─────────────────────────────────────────────────────

/**
 * Dispense a single item. Updates the item row, recomputes the prescription
 * status (partial vs full), writes an audit event.
 *   opts: { quantity, substitute_drug_id?, substitute_reason?, pharmacy_id?, notes? }
 */
async function dispenseItem(prescriptionId, itemId, actor, opts = {}, pool = getPool()) {
  const rx = await getPrescription(prescriptionId, pool);
  if (!rx) throwNotFound();
  if (!['received', 'partially_dispensed'].includes(rx.lifecycle_status)) {
    const e = new Error(`Cannot dispense from status ${rx.lifecycle_status}`);
    e.code = 'INVALID_STATE'; throw e;
  }
  const item = rx.items.find(i => i.id === itemId);
  if (!item) {
    const e = new Error('Item not found on this prescription');
    e.code = 'NOT_FOUND'; throw e;
  }
  if (['dispensed', 'cancelled'].includes(item.status)) {
    const e = new Error(`Item already in terminal state ${item.status}`);
    e.code = 'INVALID_STATE'; throw e;
  }

  const qty = Number(opts.quantity ?? item.quantity ?? 0);
  await pool.query(
    `UPDATE ng_rx_items
        SET status = 'dispensed',
            dispensed_quantity = $2,
            substitute_drug_id = $3,
            substitute_reason  = $4,
            pharmacy_id        = COALESCE($5, pharmacy_id),
            dispensed_at       = NOW(),
            updated_at         = NOW()
      WHERE id = $1`,
    [itemId, qty, opts.substitute_drug_id || null, opts.substitute_reason || null, opts.pharmacy_id || null]
  );

  const advanced = await recomputeDispenseStatus(prescriptionId, rx.lifecycle_status, itemId, actor, pool, { quantity: qty });
  if (!advanced) {
    await logEvent(prescriptionId, itemId, actor, 'item_dispensed', null, null,
      `item ${item.drug_name} dispensed`, { quantity: qty }, pool);
  }

  return getPrescription(prescriptionId, pool);
}

/**
 * Recompute a prescription's lifecycle status from its item rows and persist any
 * advance (partial → full). Returns true if the prescription status changed.
 *
 * Completion rule: every item must be finalized (dispensed / cancelled /
 * unavailable) AND at least one item actually dispensed. The previous inline
 * check used `dispensed === total`, which permanently stalled any prescription
 * containing an unavailable or cancelled item — it could never reach
 * fully_dispensed, and therefore never `completed`.
 */
async function recomputeDispenseStatus(prescriptionId, fromStatus, itemId, actor, pool = getPool(), meta = {}) {
  if (!['received', 'partially_dispensed'].includes(fromStatus)) return false;
  const after = await pool.query(
    `SELECT
       COUNT(*)::int AS total,
       COUNT(*) FILTER (WHERE status = 'dispensed')::int AS dispensed,
       COUNT(*) FILTER (WHERE status IN ('dispensed','cancelled','unavailable'))::int AS finalized
     FROM ng_rx_items WHERE prescription_id = $1`, [prescriptionId]
  );
  const { total, dispensed, finalized } = after.rows[0];
  const next = nextDispenseStatus(fromStatus, { total, dispensed, finalized });

  if (next === fromStatus) return false;
  await pool.query(
    `UPDATE ng_digital_prescriptions SET lifecycle_status = $2, updated_at = NOW() WHERE id = $1`,
    [prescriptionId, next]
  );
  await logEvent(prescriptionId, itemId, actor,
    next === 'fully_dispensed' ? 'full' : 'partial',
    fromStatus, next, `auto-advance after item ${meta.quantity != null ? 'dispense' : 'status change'}`,
    { item_id: itemId, ...meta }, pool);
  return true;
}

/**
 * Mark an item as unavailable (out of stock). Optionally suggest a substitute.
 */
async function markItemUnavailable(prescriptionId, itemId, actor, { notes } = {}, pool = getPool()) {
  const rx = await getPrescription(prescriptionId, pool);
  if (!rx) throwNotFound();
  await pool.query(
    `UPDATE ng_rx_items SET status = 'unavailable', notes = COALESCE($2, notes), updated_at = NOW()
      WHERE id = $1 AND prescription_id = $3`,
    [itemId, notes || null, prescriptionId]
  );
  await logEvent(prescriptionId, itemId, actor, 'item_unavailable', null, null,
    'pharmacy reports item unavailable', { notes }, pool);
  // Marking the last pending item unavailable can complete the dispense.
  await recomputeDispenseStatus(prescriptionId, rx.lifecycle_status, itemId, actor, pool);
  return getPrescription(prescriptionId, pool);
}

async function cancel(id, actor, { reason } = {}, pool = getPool()) {
  const rx = await getPrescription(id, pool);
  if (!rx) throwNotFound();
  if (isTerminal(rx.lifecycle_status)) {
    const e = new Error(`Cannot cancel from terminal ${rx.lifecycle_status}`);
    e.code = 'INVALID_STATE'; throw e;
  }
  const r = await pool.query(
    `UPDATE ng_digital_prescriptions
        SET lifecycle_status = 'cancelled', cancelled_at = NOW(),
            cancellation_reason = $2, updated_at = NOW()
      WHERE id = $1 RETURNING *`, [id, reason || null]
  );
  await logEvent(id, null, actor, 'cancelled', rx.lifecycle_status, 'cancelled', reason || null, null, pool);
  return r.rows[0];
}

async function complete(id, actor, pool = getPool()) {
  const rx = await getPrescription(id, pool);
  if (!rx) throwNotFound();
  assertTransition(rx.lifecycle_status, 'completed');
  const r = await pool.query(
    `UPDATE ng_digital_prescriptions
        SET lifecycle_status = 'completed', completed_at = NOW(), updated_at = NOW()
      WHERE id = $1 RETURNING *`, [id]
  );
  await logEvent(id, null, actor, 'completed', rx.lifecycle_status, 'completed', null, null, pool);
  return r.rows[0];
}

// ─── Refills ─────────────────────────────────────────────────────────────────

async function requestRefill(prescriptionId, itemId, actor, { quantity, notes } = {}, pool = getPool()) {
  const r = await pool.query(
    `INSERT INTO ng_rx_refills
       (prescription_id, item_id, requested_by_user, quantity, notes, status)
     VALUES ($1,$2,$3,$4,$5,'requested') RETURNING *`,
    [prescriptionId, itemId || null, actor?.user_id || null, quantity || null, notes || null]
  );
  await logEvent(prescriptionId, itemId, actor, 'refill_requested', null, null,
    `refill requested${quantity ? ` qty=${quantity}` : ''}`, null, pool);
  return r.rows[0];
}

async function approveRefill(refillId, actor, pool = getPool()) {
  const r = await pool.query(
    `UPDATE ng_rx_refills
        SET status = 'approved', approved_by_user = $2, approved_at = NOW()
      WHERE id = $1 AND status = 'requested' RETURNING *`,
    [refillId, actor?.user_id || null]
  );
  if (!r.rows[0]) throwNotFound();

  // Decrement refills_remaining if the item is tracked
  if (r.rows[0].item_id) {
    await pool.query(
      `UPDATE ng_rx_items
          SET refills_remaining = GREATEST(refills_remaining - 1, 0)
        WHERE id = $1 AND refills_remaining > 0`,
      [r.rows[0].item_id]
    );
  }
  await logEvent(r.rows[0].prescription_id, r.rows[0].item_id, actor,
    'refill_approved', null, null, 'refill approved', null, pool);
  return r.rows[0];
}

async function denyRefill(refillId, actor, { reason } = {}, pool = getPool()) {
  const r = await pool.query(
    `UPDATE ng_rx_refills SET status = 'denied', denied_at = NOW(), notes = COALESCE($2, notes)
      WHERE id = $1 AND status = 'requested' RETURNING *`,
    [refillId, reason || null]
  );
  if (!r.rows[0]) throwNotFound();
  await logEvent(r.rows[0].prescription_id, r.rows[0].item_id, actor,
    'refill_denied', null, null, reason || 'refill denied', null, pool);
  return r.rows[0];
}

// ─── Utility ─────────────────────────────────────────────────────────────────

async function logEvent(prescriptionId, itemId, actor, eventKind, fromStatus, toStatus, notes, payload, pool = getPool()) {
  await pool.query(
    `INSERT INTO ng_rx_events
       (prescription_id, item_id, actor_user_id, actor_kind, event_kind,
        from_status, to_status, notes, payload_json)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,COALESCE($9::jsonb,'{}'::jsonb))`,
    [
      prescriptionId, itemId || null,
      actor?.user_id || null, actor?.kind || 'system',
      eventKind, fromStatus, toStatus, notes || null,
      payload ? JSON.stringify(payload) : null,
    ]
  );
}

function assertTransition(from, to) {
  if (!isValidTransition(from, to)) {
    const e = new Error(`Invalid transition ${from} → ${to}`);
    e.code = 'INVALID_TRANSITION';
    throw e;
  }
}
function throwNotFound() {
  const e = new Error('Prescription not found');
  e.code = 'NOT_FOUND';
  throw e;
}

async function listEvents(prescriptionId, pool = getPool()) {
  const r = await pool.query(
    `SELECT * FROM ng_rx_events WHERE prescription_id = $1 ORDER BY created_at ASC LIMIT 500`,
    [prescriptionId]
  );
  return r.rows;
}

module.exports = {
  TRANSITIONS,
  isValidTransition,
  isTerminal,
  nextDispenseStatus,
  generateRxNumber,
  createDraft,
  getPrescription,
  listPrescriptions,
  sign,
  sendToPharmacy,
  acknowledgeReceipt,
  dispenseItem,
  markItemUnavailable,
  cancel,
  complete,
  requestRefill,
  approveRefill,
  denyRefill,
  listEvents,
};
