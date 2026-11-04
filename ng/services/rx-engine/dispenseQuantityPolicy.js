'use strict';

// No partial-fill/remainder lifecycle is implemented. Preserve legacy records,
// but never treat a short or inconsistent quantity as a completed signed item.
function quantities(item) {
  return { prescribed: Number(item?.quantity), recorded: Number(item?.dispensed_quantity ?? 0) };
}
function requiresQuantityReview(items) {
  return !Array.isArray(items) || items.some(item => {
    const { prescribed, recorded } = quantities(item);
    return !Number.isSafeInteger(prescribed) || prescribed <= 0 || !Number.isSafeInteger(recorded) || recorded < 0
      || (item.status === 'dispensed' ? recorded !== prescribed : recorded !== 0);
  });
}
function hasCompleteDispensingEvidence(items) {
  return Array.isArray(items) && items.length > 0 && !requiresQuantityReview(items)
    && items.some(item => item.status === 'dispensed')
    && items.every(item => ['dispensed', 'cancelled', 'unavailable'].includes(item.status));
}
function canRecordFullDispense(item, quantity) {
  const { prescribed, recorded } = quantities(item);
  return Number.isSafeInteger(prescribed) && prescribed > 0 && recorded === 0
    && Number.isSafeInteger(quantity) && quantity === prescribed;
}
function orderQuantitiesMatch(orderItems, signedItems) {
  function totals(items) {
    if (!Array.isArray(items) || !items.length) return null;
    const result = new Map();
    for (const item of items) {
      if (!item.drug_id || !Number.isSafeInteger(item.quantity) || item.quantity <= 0) return null;
      const total = (result.get(item.drug_id) || 0) + item.quantity;
      if (!Number.isSafeInteger(total)) return null;
      result.set(item.drug_id, total);
    }
    return result;
  }
  const ordered = totals(orderItems), signed = totals(signedItems);
  return !!ordered && !!signed && ordered.size === signed.size && [...ordered].every(([drug, quantity]) => signed.get(drug) === quantity);
}
// Events remain an unresolved hold until an explicitly reviewed resolution
// workflow exists. Editing a quantity or lifecycle label does not clear it.
async function isQuantityReviewHeld(client, prescriptionId) {
  const result = await client.query(`SELECT EXISTS(SELECT 1 FROM ng_medication_events e
    JOIN ng_medication_fulfillments f ON f.order_id=e.order_id
    WHERE f.digital_prescription_id=$1 AND e.action='handover_requires_clinical_review'
      AND e.details->>'reason' IN ('dispense_quantity_conflict','order_quantity_conflict','multiple_signed_items_same_drug')) AS required`, [prescriptionId]);
  return result.rows[0]?.required === true;
}
module.exports = { requiresQuantityReview, hasCompleteDispensingEvidence, canRecordFullDispense, orderQuantitiesMatch, isQuantityReviewHeld };
