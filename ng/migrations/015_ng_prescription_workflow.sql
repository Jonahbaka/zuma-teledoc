-- =============================================================================
-- 015_ng_prescription_workflow.sql
-- DoctaRx Nigeria — Prescription lifecycle v2
--
-- Extends the existing ng_digital_prescriptions table (from migration 003)
-- with a strict enum-typed lifecycle column, normalized per-item dispense
-- tracking, refill requests, and an audit event log.
--
-- We do NOT drop the existing string `status` column — it stays for
-- backward compatibility with any callers still reading it. New code uses
-- `lifecycle_status`.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------------
-- Enum: strict prescription lifecycle
-- ---------------------------------------------------------------------------
DO $$ BEGIN CREATE TYPE ng_rx_status AS ENUM (
  'drafted',             -- prescriber composing
  'signed',              -- locked, no further edits
  'sent_to_pharmacy',    -- routed to a specific pharmacy
  'received',            -- pharmacy acknowledged receipt
  'partially_dispensed', -- some items dispensed, others pending/unavailable
  'fully_dispensed',     -- all items dispensed
  'completed',           -- patient picked up / delivered; final state
  'cancelled',           -- cancelled by prescriber or patient
  'expired'              -- past expiry without full dispense
); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE ng_rx_item_status AS ENUM (
  'pending',          -- not yet acted on
  'available',        -- pharmacy confirmed stock
  'unavailable',      -- pharmacy has none — patient referred elsewhere
  'substituted',      -- generic/brand substitution recorded
  'dispensed',        -- handed over
  'cancelled'         -- prescriber pulled this item
); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE ng_rx_refill_status AS ENUM (
  'requested', 'approved', 'denied', 'dispensed', 'cancelled'
); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------------------------------------------------------------------------
-- Add lifecycle_status to existing table (additive, non-breaking)
-- ---------------------------------------------------------------------------
ALTER TABLE ng_digital_prescriptions
  ADD COLUMN IF NOT EXISTS lifecycle_status ng_rx_status DEFAULT 'drafted';

CREATE INDEX IF NOT EXISTS idx_ng_digirx_lifecycle
  ON ng_digital_prescriptions (lifecycle_status);

ALTER TABLE ng_digital_prescriptions
  ADD COLUMN IF NOT EXISTS signed_at        TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS sent_at          TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS received_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS completed_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancelled_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancellation_reason TEXT,
  ADD COLUMN IF NOT EXISTS sig_text         TEXT;   -- prescriber sig text snapshot

-- ---------------------------------------------------------------------------
-- Normalized per-item table (mirrors the existing JSONB `items` blob).
-- Older rows can keep their JSONB; new code reads from this table.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ng_rx_items (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prescription_id     UUID NOT NULL REFERENCES ng_digital_prescriptions(id) ON DELETE CASCADE,
  position            INTEGER NOT NULL DEFAULT 1,

  drug_id             UUID REFERENCES ng_drug_catalog(id) ON DELETE SET NULL,
  drug_name           TEXT NOT NULL,
  generic_name        TEXT,
  brand_name          TEXT,
  dosage              TEXT NOT NULL,                  -- e.g. "500 mg"
  frequency           TEXT NOT NULL,                  -- e.g. "BD x 5 days"
  duration_days       INTEGER,
  quantity            INTEGER,
  refills_authorized  INTEGER DEFAULT 0,
  refills_remaining   INTEGER DEFAULT 0,
  notes               TEXT,

  status              ng_rx_item_status NOT NULL DEFAULT 'pending',
  dispensed_quantity  INTEGER DEFAULT 0,
  substitute_drug_id  UUID REFERENCES ng_drug_catalog(id) ON DELETE SET NULL,
  substitute_reason   TEXT,
  pharmacy_id         UUID REFERENCES ng_pharmacies(id) ON DELETE SET NULL,
  dispensed_at        TIMESTAMPTZ,

  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE (prescription_id, position)
);

CREATE INDEX IF NOT EXISTS idx_ng_rx_items_rx        ON ng_rx_items (prescription_id);
CREATE INDEX IF NOT EXISTS idx_ng_rx_items_status    ON ng_rx_items (status);
CREATE INDEX IF NOT EXISTS idx_ng_rx_items_pharmacy  ON ng_rx_items (pharmacy_id, status);
CREATE INDEX IF NOT EXISTS idx_ng_rx_items_drug      ON ng_rx_items (drug_id);

-- ---------------------------------------------------------------------------
-- Refill requests
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ng_rx_refills (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prescription_id     UUID NOT NULL REFERENCES ng_digital_prescriptions(id) ON DELETE CASCADE,
  item_id             UUID REFERENCES ng_rx_items(id) ON DELETE CASCADE,
  requested_by_user   UUID REFERENCES users(id) ON DELETE SET NULL,
  approved_by_user    UUID REFERENCES users(id) ON DELETE SET NULL,
  status              ng_rx_refill_status NOT NULL DEFAULT 'requested',
  quantity            INTEGER,
  notes               TEXT,
  requested_at        TIMESTAMPTZ DEFAULT NOW(),
  approved_at         TIMESTAMPTZ,
  denied_at           TIMESTAMPTZ,
  dispensed_at        TIMESTAMPTZ,
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ng_rx_refills_rx     ON ng_rx_refills (prescription_id);
CREATE INDEX IF NOT EXISTS idx_ng_rx_refills_status ON ng_rx_refills (status);

-- ---------------------------------------------------------------------------
-- Dispense / lifecycle event log (per-prescription audit)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ng_rx_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prescription_id UUID NOT NULL REFERENCES ng_digital_prescriptions(id) ON DELETE CASCADE,
  item_id         UUID REFERENCES ng_rx_items(id) ON DELETE SET NULL,
  actor_user_id   UUID REFERENCES users(id) ON DELETE SET NULL,
  actor_kind      TEXT NOT NULL,                   -- prescriber | pharmacist | patient | system
  event_kind      TEXT NOT NULL,                   -- drafted | signed | sent | received | item_dispensed | partial | full | cancelled | refill_requested | refill_approved | refill_denied
  from_status     ng_rx_status,
  to_status       ng_rx_status,
  notes           TEXT,
  payload_json    JSONB DEFAULT '{}'::JSONB,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ng_rx_events_rx     ON ng_rx_events (prescription_id, created_at);
CREATE INDEX IF NOT EXISTS idx_ng_rx_events_kind   ON ng_rx_events (event_kind);

-- ---------------------------------------------------------------------------
-- Backfill: copy lifecycle_status from existing string `status` where
-- possible, so old rows participate in the new state machine.
-- ---------------------------------------------------------------------------
UPDATE ng_digital_prescriptions SET lifecycle_status = 'drafted'
  WHERE lifecycle_status IS NULL AND status = 'active';
UPDATE ng_digital_prescriptions SET lifecycle_status = 'sent_to_pharmacy'
  WHERE lifecycle_status IS NULL AND status = 'routed';
UPDATE ng_digital_prescriptions SET lifecycle_status = 'received'
  WHERE lifecycle_status IS NULL AND status = 'dispensing';
UPDATE ng_digital_prescriptions SET lifecycle_status = 'fully_dispensed'
  WHERE lifecycle_status IS NULL AND status = 'dispensed';
UPDATE ng_digital_prescriptions SET lifecycle_status = 'partially_dispensed'
  WHERE lifecycle_status IS NULL AND status = 'partially_dispensed';
UPDATE ng_digital_prescriptions SET lifecycle_status = 'cancelled'
  WHERE lifecycle_status IS NULL AND status = 'canceled';
UPDATE ng_digital_prescriptions SET lifecycle_status = 'expired'
  WHERE lifecycle_status IS NULL AND status = 'expired';
UPDATE ng_digital_prescriptions SET lifecycle_status = 'drafted'
  WHERE lifecycle_status IS NULL;
