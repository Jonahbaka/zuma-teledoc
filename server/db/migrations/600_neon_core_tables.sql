-- Migration 600: Neon primary — core DoctaRx tables
-- Idempotent: all statements use IF NOT EXISTS / DO $$ guards.
-- These five tables are the canonical source of truth on Neon.
-- The AWS mirror replicates them read-only; no DDL runs there.

-- ── Extensions (safe to re-run) ─────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ── users ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id              UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  email           VARCHAR(255) UNIQUE NOT NULL,
  password_hash   VARCHAR(255) NOT NULL,
  role            VARCHAR(50)  NOT NULL DEFAULT 'patient'
                    CHECK (role IN ('patient','provider','pharmacy','admin','super_admin')),
  first_name      VARCHAR(100),
  last_name       VARCHAR(100),
  phone           VARCHAR(30),
  email_verified  BOOLEAN      NOT NULL DEFAULT FALSE,
  is_active       BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_email  ON users (email);
CREATE INDEX IF NOT EXISTS idx_users_role   ON users (role);

-- ── doctors ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS doctors (
  id                UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id           UUID        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  license_number    VARCHAR(100) UNIQUE NOT NULL,
  specialization    VARCHAR(150),
  years_experience  INT          CHECK (years_experience >= 0),
  bio               TEXT,
  consultation_fee  NUMERIC(10,2),
  currency          VARCHAR(3)   NOT NULL DEFAULT 'USD',
  status            VARCHAR(20)  NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending','approved','suspended','rejected')),
  created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_doctors_user_id ON doctors (user_id);
CREATE INDEX IF NOT EXISTS idx_doctors_status  ON doctors (status);

-- ── patients ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS patients (
  id                    UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id               UUID        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  date_of_birth         DATE,
  gender                VARCHAR(20),
  blood_type            VARCHAR(5),
  medical_record_number VARCHAR(50) UNIQUE,
  emergency_contact     VARCHAR(255),
  allergies             TEXT,
  chronic_conditions    TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_patients_user_id ON patients (user_id);
CREATE INDEX IF NOT EXISTS idx_patients_mrn     ON patients (medical_record_number);

-- ── visits ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS visits (
  id               UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  patient_id       UUID        NOT NULL REFERENCES patients (id) ON DELETE RESTRICT,
  doctor_id        UUID        NOT NULL REFERENCES doctors  (id) ON DELETE RESTRICT,
  visit_date       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  visit_type       VARCHAR(30)  NOT NULL DEFAULT 'telemedicine'
                     CHECK (visit_type IN ('in_person','telemedicine','home_visit')),
  chief_complaint  TEXT,
  diagnosis        TEXT,
  notes            TEXT,
  status           VARCHAR(20)  NOT NULL DEFAULT 'scheduled'
                     CHECK (status IN ('scheduled','in_progress','completed','cancelled','no_show')),
  duration_minutes INT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_visits_patient_id ON visits (patient_id);
CREATE INDEX IF NOT EXISTS idx_visits_doctor_id  ON visits (doctor_id);
CREATE INDEX IF NOT EXISTS idx_visits_date        ON visits (visit_date DESC);
CREATE INDEX IF NOT EXISTS idx_visits_status      ON visits (status);

-- ── prescriptions ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS prescriptions (
  id               UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  visit_id         UUID        REFERENCES visits   (id) ON DELETE SET NULL,
  patient_id       UUID        NOT NULL REFERENCES patients (id) ON DELETE RESTRICT,
  doctor_id        UUID        NOT NULL REFERENCES doctors  (id) ON DELETE RESTRICT,
  medication_name  VARCHAR(255) NOT NULL,
  dosage           VARCHAR(100),
  frequency        VARCHAR(100),
  duration_days    INT          CHECK (duration_days > 0),
  quantity         INT,
  unit             VARCHAR(30),
  instructions     TEXT,
  refills_allowed  INT          NOT NULL DEFAULT 0,
  refills_used     INT          NOT NULL DEFAULT 0,
  status           VARCHAR(20)  NOT NULL DEFAULT 'active'
                     CHECK (status IN ('active','dispensed','cancelled','expired')),
  dispensed_at     TIMESTAMPTZ,
  expires_at       TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rx_patient_id ON prescriptions (patient_id);
CREATE INDEX IF NOT EXISTS idx_rx_doctor_id  ON prescriptions (doctor_id);
CREATE INDEX IF NOT EXISTS idx_rx_visit_id   ON prescriptions (visit_id);
CREATE INDEX IF NOT EXISTS idx_rx_status     ON prescriptions (status);

-- ── updated_at triggers ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;

DO $$ BEGIN
  CREATE TRIGGER trg_users_updated_at
    BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TRIGGER trg_doctors_updated_at
    BEFORE UPDATE ON doctors FOR EACH ROW EXECUTE FUNCTION set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TRIGGER trg_patients_updated_at
    BEFORE UPDATE ON patients FOR EACH ROW EXECUTE FUNCTION set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TRIGGER trg_visits_updated_at
    BEFORE UPDATE ON visits FOR EACH ROW EXECUTE FUNCTION set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TRIGGER trg_rx_updated_at
    BEFORE UPDATE ON prescriptions FOR EACH ROW EXECUTE FUNCTION set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
