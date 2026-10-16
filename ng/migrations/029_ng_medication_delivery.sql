-- Additive medication fulfilment v2. No legacy orders, prices or accounts change.
ALTER TABLE ng_pharmacies
  ADD COLUMN IF NOT EXISTS paystack_transfer_recipient_code TEXT,
  ADD COLUMN IF NOT EXISTS settlement_approval_reference TEXT,
  ADD COLUMN IF NOT EXISTS settlement_approved_at TIMESTAMPTZ;
ALTER TABLE ng_drug_catalog ADD COLUMN IF NOT EXISTS delivery_restriction TEXT NOT NULL DEFAULT 'pharmacist_review_required'
  CHECK (delivery_restriction IN ('pharmacist_review_required','ambient_approved','cold_chain','restricted','prohibited'));
ALTER TABLE ng_rx_items ADD COLUMN IF NOT EXISTS fulfillment_order_id UUID REFERENCES ng_orders(id);
CREATE TABLE IF NOT EXISTS ng_medication_fulfillments (
  order_id UUID PRIMARY KEY REFERENCES ng_orders(id),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  create_key TEXT NOT NULL,
  create_digest CHAR(64) NOT NULL,
  digital_prescription_id UUID REFERENCES ng_digital_prescriptions(id),
  address_encrypted JSONB,
  contact_consent_at TIMESTAMPTZ,
  fulfillment_consent_at TIMESTAMPTZ,
  pharmacy_confirmed_at TIMESTAMPTZ,
  pharmacy_ready_at TIMESTAMPTZ,
  pharmacist_user_id UUID REFERENCES users(id),
  pharmacist_registration TEXT,
  package_category TEXT CHECK (package_category IS NULL OR package_category IN ('sealed_ambient_medication','cold_chain','restricted')),
  medicines_minor BIGINT NOT NULL DEFAULT 0 CHECK (medicines_minor BETWEEN 0 AND 9007199254740991),
  coordination JSONB NOT NULL DEFAULT '{}',
  coverage JSONB NOT NULL DEFAULT '{}',
  medicines_approval JSONB,
  delivery_approval JSONB,
  delivery_repricing_refund_required BOOLEAN NOT NULL DEFAULT false,
  current_quote_id UUID,
  inventory_released_at TIMESTAMPTZ,
  collected_at TIMESTAMPTZ,
  return_received_at TIMESTAMPTZ,
  return_evidence_reference TEXT,
  return_refund_approval_reference TEXT,
  cancellation_requested_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS ng_medication_create_key ON ng_medication_fulfillments(create_key);
CREATE UNIQUE INDEX IF NOT EXISTS ng_medication_one_digital_rx ON ng_medication_fulfillments(digital_prescription_id) WHERE digital_prescription_id IS NOT NULL;
-- The uploaded prescription association is serialized by its row lock in the service.

CREATE TABLE IF NOT EXISTS ng_medication_reservations (
  order_id UUID NOT NULL REFERENCES ng_orders(id),
  inventory_id UUID NOT NULL REFERENCES ng_pharmacy_inventory(id),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  PRIMARY KEY(order_id,inventory_id)
);
CREATE TABLE IF NOT EXISTS ng_medication_quotes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES ng_orders(id),
  provider TEXT NOT NULL CHECK (provider='uber_direct'),
  provider_quote_id TEXT NOT NULL,
  fare_minor BIGINT NOT NULL CHECK (fare_minor BETWEEN 0 AND 9007199254740991),
  currency TEXT NOT NULL CHECK (currency='NGN'),
  expires_at TIMESTAMPTZ NOT NULL,
  request_fingerprint TEXT NOT NULL,
  normalized JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(provider,provider_quote_id)
);
CREATE TABLE IF NOT EXISTS ng_medication_payment_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES ng_orders(id),
  stage TEXT NOT NULL CHECK (stage IN ('medicines','delivery')),
  approval_digest CHAR(64) NOT NULL,
  provider_reference TEXT NOT NULL UNIQUE,
  amount_minor BIGINT NOT NULL CHECK (amount_minor BETWEEN 1 AND 9007199254740991),
  currency TEXT NOT NULL DEFAULT 'NGN' CHECK (currency='NGN'),
  status TEXT NOT NULL CHECK (status IN ('initializing','pending','verified','failed','reconciliation_required','refund_pending','refunded')),
  authorization_url TEXT,
  processing_cost_minor BIGINT CHECK (processing_cost_minor >= 0),
  provider_transaction_id TEXT,
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(order_id,stage,approval_digest)
);
CREATE TABLE IF NOT EXISTS ng_medication_bookings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL UNIQUE REFERENCES ng_orders(id),
  quote_id UUID NOT NULL REFERENCES ng_medication_quotes(id),
  idempotency_key TEXT NOT NULL UNIQUE,
  provider TEXT NOT NULL DEFAULT 'uber_direct' CHECK (provider='uber_direct'),
  provider_delivery_id TEXT UNIQUE,
  status TEXT NOT NULL,
  normalized JSONB,
  pickup_proof JSONB,
  delivery_proof JSONB,
  last_provider_at TIMESTAMPTZ,
  cancellation_requested_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS ng_medication_events (
  id BIGSERIAL PRIMARY KEY,
  order_id UUID NOT NULL REFERENCES ng_orders(id),
  actor_user_id UUID REFERENCES users(id),
  action TEXT NOT NULL,
  details JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS ng_medication_operations (
  order_id UUID NOT NULL REFERENCES ng_orders(id),
  operation_key TEXT NOT NULL,
  action TEXT NOT NULL,
  digest CHAR(64) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(order_id,operation_key)
);
CREATE TABLE IF NOT EXISTS ng_courier_webhook_receipts (
  provider TEXT NOT NULL CHECK (provider='uber_direct'),
  event_id TEXT NOT NULL,
  digest CHAR(64) NOT NULL,
  status TEXT NOT NULL DEFAULT 'received' CHECK (status IN ('received','processed','unmatched')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(provider,event_id)
);
CREATE TABLE IF NOT EXISTS ng_medication_refunds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id UUID NOT NULL UNIQUE REFERENCES ng_medication_payment_attempts(id),
  provider_refund_id TEXT UNIQUE,
  amount_minor BIGINT NOT NULL CHECK (amount_minor > 0),
  status TEXT NOT NULL CHECK (status IN ('requested','pending','processed','failed','reconciliation_required')),
  reason_code TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS ng_medication_ledger (
  id BIGSERIAL PRIMARY KEY,
  order_id UUID NOT NULL REFERENCES ng_orders(id),
  posting_key TEXT NOT NULL UNIQUE,
  account TEXT NOT NULL,
  debit_minor BIGINT NOT NULL DEFAULT 0 CHECK (debit_minor >= 0),
  credit_minor BIGINT NOT NULL DEFAULT 0 CHECK (credit_minor >= 0),
  currency TEXT NOT NULL DEFAULT 'NGN' CHECK (currency='NGN'),
  evidence_reference TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((debit_minor=0) <> (credit_minor=0))
);
CREATE TABLE IF NOT EXISTS ng_medication_settlements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES ng_orders(id),
  payee TEXT NOT NULL CHECK (payee IN ('pharmacy','courier')),
  amount_minor BIGINT NOT NULL CHECK (amount_minor > 0),
  provider_reference TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('pending','verified','failed','reconciliation_required')),
  evidence_reference TEXT,
  recipient_code TEXT,
  recipient_id TEXT,
  processing_cost_minor BIGINT CHECK (processing_cost_minor >= 0),
  recipient_evidence_digest CHAR(64),
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(order_id,payee)
);
CREATE INDEX IF NOT EXISTS ng_medication_ledger_order ON ng_medication_ledger(order_id,id);
CREATE INDEX IF NOT EXISTS ng_medication_events_order ON ng_medication_events(order_id,id);
CREATE OR REPLACE FUNCTION ng_medication_immutable_history() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION 'Medication financial and audit history is append only'; END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS ng_medication_ledger_immutable ON ng_medication_ledger;
CREATE TRIGGER ng_medication_ledger_immutable BEFORE UPDATE OR DELETE ON ng_medication_ledger FOR EACH ROW EXECUTE FUNCTION ng_medication_immutable_history();
DROP TRIGGER IF EXISTS ng_medication_events_immutable ON ng_medication_events;
CREATE TRIGGER ng_medication_events_immutable BEFORE UPDATE OR DELETE ON ng_medication_events FOR EACH ROW EXECUTE FUNCTION ng_medication_immutable_history();
