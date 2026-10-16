-- Scoped insurance metadata, consultation invoices, and integration evidence.
-- No live partner, tariff, gateway, or institutional approval is seeded.
CREATE TABLE IF NOT EXISTS ng_insurance_partners (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  programme_id UUID NOT NULL REFERENCES public_health_programmes(id) ON DELETE RESTRICT,
  partner_key TEXT NOT NULL,
  display_name TEXT NOT NULL,
  onboarding_status TEXT NOT NULL DEFAULT 'review' CHECK (onboarding_status IN ('prospect','review','contracted','sandbox','live','suspended','ended')),
  submission_channel TEXT NOT NULL DEFAULT 'unconfirmed' CHECK (submission_channel IN ('unconfirmed','manual','batch','api','fhir')),
  contract_reference TEXT,
  activation_evidence_reference TEXT,
  capabilities_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  updated_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(programme_id, partner_key),
  CHECK (onboarding_status <> 'live' OR (contract_reference IS NOT NULL AND activation_evidence_reference IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS ng_consultation_tariffs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_key TEXT NOT NULL,
  display_name TEXT NOT NULL,
  amount_minor BIGINT NOT NULL CHECK (amount_minor > 0 AND amount_minor <= 9007199254740991),
  currency TEXT NOT NULL DEFAULT 'NGN' CHECK (currency = 'NGN'),
  effective_from TIMESTAMPTZ NOT NULL,
  effective_to TIMESTAMPTZ,
  approved_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  approval_reference TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (effective_to IS NULL OR effective_to > effective_from)
);

CREATE TABLE IF NOT EXISTS ng_consultation_invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  appointment_id UUID NOT NULL REFERENCES appointments(id) ON DELETE RESTRICT,
  patient_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  tariff_id UUID NOT NULL REFERENCES ng_consultation_tariffs(id) ON DELETE RESTRICT,
  amount_minor BIGINT NOT NULL CHECK (amount_minor > 0 AND amount_minor <= 9007199254740991),
  currency TEXT NOT NULL DEFAULT 'NGN' CHECK (currency = 'NGN'),
  funding_source TEXT NOT NULL DEFAULT 'self_pay' CHECK (funding_source IN ('self_pay','patient_copay')),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','paid','cancelled','reconciliation','refund_pending','refunded')),
  price_snapshot_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  paid_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(appointment_id)
);

CREATE TABLE IF NOT EXISTS ng_consultation_payment_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id UUID NOT NULL REFERENCES ng_consultation_invoices(id) ON DELETE RESTRICT,
  reference TEXT NOT NULL UNIQUE,
  provider TEXT NOT NULL DEFAULT 'paystack' CHECK (provider = 'paystack'),
  environment TEXT NOT NULL CHECK (environment IN ('test','live')),
  status TEXT NOT NULL DEFAULT 'initializing' CHECK (status IN ('initializing','ready','confirmed','reconciliation','failed')),
  authorization_url TEXT,
  receipt_json JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(invoice_id)
);

CREATE TABLE IF NOT EXISTS ng_payment_ledger_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id UUID NOT NULL REFERENCES ng_consultation_invoices(id) ON DELETE RESTRICT,
  attempt_id UUID NOT NULL REFERENCES ng_consultation_payment_attempts(id) ON DELETE RESTRICT,
  entry_type TEXT NOT NULL CHECK (entry_type IN ('payment','refund')),
  amount_minor BIGINT NOT NULL CHECK (amount_minor > 0),
  currency TEXT NOT NULL CHECK (currency = 'NGN'),
  external_reference TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(attempt_id, entry_type)
);

CREATE TABLE IF NOT EXISTS ng_integration_webhook_receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider TEXT NOT NULL CHECK (provider IN ('paystack','livekit')),
  event_key TEXT NOT NULL,
  event_type TEXT NOT NULL,
  resource_reference TEXT,
  status TEXT NOT NULL DEFAULT 'received' CHECK (status IN ('received','processed','failed')),
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ,
  UNIQUE(provider, event_key)
);

CREATE TABLE IF NOT EXISTS ng_dhis2_delivery_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id UUID NOT NULL REFERENCES public_health_reports(id) ON DELETE RESTRICT,
  payload_hash CHAR(64) NOT NULL,
  destination_hash CHAR(64) NOT NULL,
  approved_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  approved_at TIMESTAMPTZ NOT NULL,
  payload_json JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','submitting','confirmed','rejected','reconciliation','failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  lease_token UUID,
  lease_until TIMESTAMPTZ,
  remote_job_id TEXT,
  result_summary_json JSONB,
  last_error_code TEXT,
  created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(report_id, payload_hash, destination_hash)
);
CREATE INDEX IF NOT EXISTS idx_ng_dhis2_delivery_jobs_status ON ng_dhis2_delivery_jobs(status, created_at);
