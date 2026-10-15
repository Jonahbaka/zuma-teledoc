-- Keep the permanent prescription/order history while releasing a cancelled,
-- undispatched order's claim. A pharmacy outage must not consume a valid Rx.
ALTER TABLE ng_medication_fulfillments ADD COLUMN IF NOT EXISTS prescription_claim_active BOOLEAN NOT NULL DEFAULT true;
UPDATE ng_medication_fulfillments f SET prescription_claim_active=false
FROM ng_orders o WHERE o.id=f.order_id AND o.status='cancelled'
  AND f.inventory_released_at IS NOT NULL AND f.return_received_at IS NULL
  AND NOT EXISTS(SELECT 1 FROM ng_medication_bookings b WHERE b.order_id=f.order_id
    AND (b.pickup_proof IS NOT NULL OR b.status IN ('picked_up','in_transit','return_pending','returned','proof_pending','delivered')))
  AND NOT EXISTS(SELECT 1 FROM ng_rx_items i WHERE i.fulfillment_order_id=f.order_id AND i.status='dispensed');
DROP INDEX IF EXISTS ng_medication_one_digital_rx;
CREATE UNIQUE INDEX IF NOT EXISTS ng_medication_one_digital_rx
  ON ng_medication_fulfillments(digital_prescription_id)
  WHERE digital_prescription_id IS NOT NULL AND prescription_claim_active=true;
