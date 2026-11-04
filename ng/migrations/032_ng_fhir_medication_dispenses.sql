-- Append-only, encrypted pharmacy-attributed dispensing facts. No backfill may
-- invent historical handover evidence. Legacy orders remain readable without
-- a fabricated MedicationDispense.
CREATE TABLE IF NOT EXISTS ng_fhir_medication_dispenses (
  id UUID PRIMARY KEY,
  order_id UUID NOT NULL REFERENCES ng_orders(id),
  drug_id UUID NOT NULL REFERENCES ng_drug_catalog(id),
  pharmacy_id UUID NOT NULL REFERENCES ng_pharmacies(id),
  pharmacist_user_id UUID NOT NULL REFERENCES users(id),
  resource_encrypted JSONB NOT NULL CHECK (jsonb_typeof(resource_encrypted)='object'),
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(order_id,drug_id)
);
CREATE INDEX IF NOT EXISTS ng_fhir_dispenses_order ON ng_fhir_medication_dispenses(order_id,recorded_at);
CREATE OR REPLACE FUNCTION ng_protect_fhir_dispense_fact() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Recorded FHIR dispensing facts are append-only; reconcile through a clinical amendment'; END;
$$;
DROP TRIGGER IF EXISTS ng_fhir_dispense_fact_immutable ON ng_fhir_medication_dispenses;
CREATE TRIGGER ng_fhir_dispense_fact_immutable BEFORE UPDATE OR DELETE ON ng_fhir_medication_dispenses FOR EACH ROW EXECUTE FUNCTION ng_protect_fhir_dispense_fact();
