-- Additive fictional-data manual lab workflow. No legacy result backfill.
CREATE TABLE IF NOT EXISTS clinical_lab_orders (
  id UUID PRIMARY KEY,
  encounter_id UUID NOT NULL REFERENCES clinical_encounters(id),
  patient_id UUID NOT NULL REFERENCES users(id),
  provider_id UUID NOT NULL REFERENCES users(id),
  request_key UUID NOT NULL,
  request_digest CHAR(64) NOT NULL,
  protected_order JSONB NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('recorded','collected','rejected','resulted','cancelled')),
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  result_revision INTEGER,
  critical BOOLEAN NOT NULL DEFAULT FALSE,
  critical_due_at TIMESTAMPTZ,
  acknowledged_result_revision INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(provider_id,request_key),
  CHECK (NOT critical OR critical_due_at IS NOT NULL)
);
CREATE TABLE IF NOT EXISTS clinical_lab_events (
  id UUID PRIMARY KEY,
  order_id UUID NOT NULL REFERENCES clinical_lab_orders(id),
  actor_id UUID NOT NULL REFERENCES users(id),
  request_key UUID NOT NULL,
  request_digest CHAR(64) NOT NULL,
  revision INTEGER NOT NULL CHECK (revision > 0),
  kind TEXT NOT NULL CHECK (kind IN ('collect','reject','cancel','result','amend','acknowledge')),
  protected_event JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(order_id,request_key),
  UNIQUE(order_id,revision)
);
CREATE INDEX IF NOT EXISTS idx_clinical_lab_orders_encounter ON clinical_lab_orders(encounter_id,created_at,id);
CREATE INDEX IF NOT EXISTS idx_clinical_lab_critical_work ON clinical_lab_orders(provider_id,critical_due_at)
  WHERE critical=TRUE AND acknowledged_result_revision IS DISTINCT FROM result_revision;
