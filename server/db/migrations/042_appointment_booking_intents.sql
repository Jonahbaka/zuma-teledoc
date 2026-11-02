-- Actor-scoped retry intent. Clinical request details are encrypted, not hashed
-- or stored as plaintext. Existing unkeyed appointments are unchanged.
CREATE TABLE IF NOT EXISTS appointment_booking_intents (
  actor_id UUID NOT NULL REFERENCES users(id),
  client_request_id UUID NOT NULL,
  -- Retain the consumed key if the appointment is explicitly removed; never
  -- turn an old retry into a replacement booking after deletion.
  appointment_id UUID REFERENCES appointments(id) ON DELETE SET NULL,
  intent_envelope JSONB NOT NULL,
  market_scope TEXT NOT NULL CHECK (market_scope IN ('US','NG')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (actor_id, client_request_id)
);
CREATE INDEX IF NOT EXISTS idx_appointment_booking_intents_appointment ON appointment_booking_intents(appointment_id);
