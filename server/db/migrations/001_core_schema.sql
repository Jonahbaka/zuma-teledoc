-- Core DoctaRx schema: users, doctors, patients, visits, prescriptions
-- Tables that pre-exist from inline migrations (users, visits, prescriptions) are
-- left untouched via IF NOT EXISTS. Indexes are guarded by column-existence checks
-- so this migration is idempotent regardless of prior schema state.

BEGIN;

-- 1. users (may already exist from inline migration 003)
CREATE TABLE IF NOT EXISTS users (
    id            UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    email         VARCHAR(255)  UNIQUE NOT NULL,
    password_hash TEXT          NOT NULL,
    role          VARCHAR(50)   NOT NULL DEFAULT 'patient'
                                CHECK (role IN ('patient', 'doctor', 'admin', 'super_admin')),
    is_active     BOOLEAN       DEFAULT true,
    created_at    TIMESTAMPTZ   DEFAULT NOW(),
    updated_at    TIMESTAMPTZ   DEFAULT NOW()
);

-- 2. doctors (new)
CREATE TABLE IF NOT EXISTS doctors (
    id               UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id          UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    specialty        VARCHAR(100),
    license_number   VARCHAR(100) UNIQUE,
    years_experience INT,
    bio              TEXT,
    is_verified      BOOLEAN      DEFAULT false,
    created_at       TIMESTAMPTZ  DEFAULT NOW(),
    updated_at       TIMESTAMPTZ  DEFAULT NOW()
);

-- 3. patients (new)
CREATE TABLE IF NOT EXISTS patients (
    id                    UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id               UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    date_of_birth         DATE,
    medical_record_number VARCHAR(100) UNIQUE,
    blood_type            VARCHAR(5),
    allergies             TEXT[],
    created_at            TIMESTAMPTZ  DEFAULT NOW(),
    updated_at            TIMESTAMPTZ  DEFAULT NOW()
);

-- 4. core_visits — renamed to avoid conflict with existing visits table
--    which has a different schema (provider_id, encrypted SOAP notes, etc.)
CREATE TABLE IF NOT EXISTS core_visits (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id      UUID        NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    doctor_id       UUID        NOT NULL REFERENCES doctors(id),
    visit_date      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    chief_complaint TEXT,
    diagnosis       TEXT,
    notes           TEXT,
    status          VARCHAR(50) DEFAULT 'scheduled'
                                CHECK (status IN ('scheduled', 'in_progress', 'completed', 'cancelled')),
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- 5. core_prescriptions — renamed to avoid conflict with existing prescriptions table
CREATE TABLE IF NOT EXISTS core_prescriptions (
    id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    visit_id     UUID         REFERENCES core_visits(id) ON DELETE SET NULL,
    patient_id   UUID         NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    doctor_id    UUID         NOT NULL REFERENCES doctors(id),
    medication   VARCHAR(255) NOT NULL,
    dosage       VARCHAR(100),
    frequency    VARCHAR(100),
    duration     VARCHAR(100),
    instructions TEXT,
    is_active    BOOLEAN      DEFAULT true,
    issued_at    TIMESTAMPTZ  DEFAULT NOW(),
    created_at   TIMESTAMPTZ  DEFAULT NOW(),
    updated_at   TIMESTAMPTZ  DEFAULT NOW()
);

-- Indexes (all on new tables — no conflict risk)
CREATE INDEX IF NOT EXISTS idx_doctors_user_id           ON doctors(user_id);
CREATE INDEX IF NOT EXISTS idx_doctors_license_number    ON doctors(license_number);
CREATE INDEX IF NOT EXISTS idx_patients_user_id          ON patients(user_id);
CREATE INDEX IF NOT EXISTS idx_patients_mrn              ON patients(medical_record_number);
CREATE INDEX IF NOT EXISTS idx_core_visits_patient_id    ON core_visits(patient_id);
CREATE INDEX IF NOT EXISTS idx_core_visits_doctor_id     ON core_visits(doctor_id);
CREATE INDEX IF NOT EXISTS idx_core_visits_status        ON core_visits(status);
CREATE INDEX IF NOT EXISTS idx_core_rx_patient_id        ON core_prescriptions(patient_id);
CREATE INDEX IF NOT EXISTS idx_core_rx_doctor_id         ON core_prescriptions(doctor_id);
CREATE INDEX IF NOT EXISTS idx_core_rx_visit_id          ON core_prescriptions(visit_id);

-- Safe index on pre-existing users table (email column always exists)
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

COMMIT;
