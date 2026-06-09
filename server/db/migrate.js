/**
 * Database Migration Script
 * Runs all migrations to set up the DoctaRx production database
 */

require('dotenv').config();
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

// Database configuration
let connectionString = process.env.DATABASE_URL || '';
let sslConfig = false;

if (connectionString && connectionString.includes('sslmode=')) {
  const certPath = process.env.PGSSLROOTCERT
    ? path.resolve(process.cwd(), process.env.PGSSLROOTCERT)
    : null;

  if (connectionString.includes('sslmode=verify-full') && certPath && fs.existsSync(certPath)) {
    sslConfig = {
      rejectUnauthorized: true,
      ca: fs.readFileSync(certPath).toString()
    };
  } else {
    sslConfig = { rejectUnauthorized: false };
  }

  connectionString = connectionString.replace(/[?&]sslmode=[^&]+/, (match) =>
    match.startsWith('?') ? '?' : ''
  ).replace(/\?$/, '');
}

const pool = new Pool({
  connectionString,
  ssl: sslConfig
});

const migrations = [
  // Migration 001: Create extensions
  {
    name: '001_create_extensions',
    up: `
      CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
      CREATE EXTENSION IF NOT EXISTS "pgcrypto";
    `
  },

  // Migration 002: Create enum types
  {
    name: '002_create_enums',
    up: `
      DO $$ BEGIN
        CREATE TYPE user_role AS ENUM ('patient', 'provider', 'pharmacy', 'admin', 'super_admin');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
      
      -- If enum already exists, add new values if they don't exist
      DO $$ 
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_enum 
          WHERE enumlabel = 'pharmacy' 
          AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'user_role')
        ) THEN
          ALTER TYPE user_role ADD VALUE 'pharmacy';
        END IF;

        IF NOT EXISTS (
          SELECT 1 FROM pg_enum 
          WHERE enumlabel = 'super_admin' 
          AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'user_role')
        ) THEN
          ALTER TYPE user_role ADD VALUE 'super_admin';
        END IF;
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
      
      DO $$ BEGIN
        CREATE TYPE appointment_status AS ENUM ('scheduled', 'confirmed', 'in_progress', 'completed', 'cancelled', 'no_show');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
      
      DO $$ BEGIN
        CREATE TYPE provider_status AS ENUM ('pending', 'approved', 'suspended', 'rejected');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
      
      DO $$ BEGIN
        CREATE TYPE subscription_tier AS ENUM ('free', 'gold', 'platinum');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
      
      DO $$ BEGIN
        CREATE TYPE access_level AS ENUM ('read_only', 'pay_per_visit', 'gold_monthly', 'gold_yearly', 'insurance');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
      
      DO $$ BEGIN
        CREATE TYPE payment_status AS ENUM ('pending', 'completed', 'failed', 'refunded');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
      
      DO $$ BEGIN
        CREATE TYPE payment_type AS ENUM ('subscription', 'pay_per_visit', 'insurance_copay', 'refund');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
      
      DO $$ BEGIN
        CREATE TYPE access_level AS ENUM ('read_only', 'pay_per_visit', 'gold_monthly', 'gold_yearly', 'insurance');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
      
      DO $$ BEGIN
        CREATE TYPE payment_status AS ENUM ('pending', 'completed', 'failed', 'refunded');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
      
      DO $$ BEGIN
        CREATE TYPE payment_type AS ENUM ('subscription', 'pay_per_visit', 'insurance_copay', 'refund');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
      
      DO $$ BEGIN
        CREATE TYPE subscription_tier AS ENUM ('free', 'gold', 'platinum');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
      
      DO $$ BEGIN
        CREATE TYPE subscription_status AS ENUM ('active', 'cancelled', 'expired', 'past_due');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
      
      DO $$ BEGIN
        CREATE TYPE message_status AS ENUM ('sent', 'delivered', 'read');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
      
      DO $$ BEGIN
        CREATE TYPE notification_type AS ENUM ('appointment', 'message', 'system', 'billing', 'medical');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
      
      DO $$ BEGIN
        CREATE TYPE audit_action AS ENUM ('create', 'read', 'update', 'delete', 'login', 'logout', 'export', 'access_phi');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `
  },

  // Migration 003: Create users table
  {
    name: '003_create_users_table',
    up: `
      CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        email VARCHAR(255) NOT NULL UNIQUE,
        password_hash VARCHAR(255) NOT NULL,
        role user_role NOT NULL DEFAULT 'patient',
        
        -- Personal Information
        first_name VARCHAR(100) NOT NULL,
        last_name VARCHAR(100) NOT NULL,
        date_of_birth DATE,
        phone VARCHAR(20),
        
        -- Address
        address_line1 VARCHAR(255),
        address_line2 VARCHAR(255),
        city VARCHAR(100),
        state VARCHAR(50),
        zip_code VARCHAR(20),
        country VARCHAR(50) DEFAULT 'USA',
        
        -- Provider-specific fields
        provider_status provider_status,
        license_number VARCHAR(100),
        license_state VARCHAR(50),
        license_expiry DATE,
        specialty VARCHAR(100),
        npi_number VARCHAR(20),
        credentials VARCHAR(50),
        bio TEXT,
        
        -- MFA
        mfa_enabled BOOLEAN DEFAULT FALSE,
        mfa_secret VARCHAR(255),
        mfa_backup_codes TEXT[],
        
        -- Account Status
        is_active BOOLEAN DEFAULT TRUE,
        is_verified BOOLEAN DEFAULT FALSE,
        email_verified_at TIMESTAMP WITH TIME ZONE,
        
        -- Security
        failed_login_attempts INTEGER DEFAULT 0,
        locked_until TIMESTAMP WITH TIME ZONE,
        password_changed_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        
        -- Consent
        hipaa_consent_at TIMESTAMP WITH TIME ZONE,
        terms_accepted_at TIMESTAMP WITH TIME ZONE,
        
        -- Timestamps
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        last_login_at TIMESTAMP WITH TIME ZONE
      );
      
      -- Indexes for users table
      CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
      CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
      CREATE INDEX IF NOT EXISTS idx_users_provider_status ON users(provider_status) WHERE role = 'provider';
      CREATE INDEX IF NOT EXISTS idx_users_is_active ON users(is_active);
      CREATE INDEX IF NOT EXISTS idx_users_created_at ON users(created_at);
    `
  },

  // Migration 004: Create password_reset_tokens table
  {
    name: '004_create_password_reset_tokens_table',
    up: `
      CREATE TABLE IF NOT EXISTS password_reset_tokens (
        user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        token_hash VARCHAR(255) NOT NULL,
        expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
      
      CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_token_hash ON password_reset_tokens(token_hash);
      CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_expires_at ON password_reset_tokens(expires_at);
    `
  },

  // Migration 005: Create refresh_tokens table
  {
    name: '005_create_refresh_tokens_table',
    up: `
      CREATE TABLE IF NOT EXISTS refresh_tokens (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token_hash VARCHAR(255) NOT NULL UNIQUE,
        device_info TEXT,
        ip_address INET,
        expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
        revoked_at TIMESTAMP WITH TIME ZONE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
      
      CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user_id ON refresh_tokens(user_id);
      CREATE INDEX IF NOT EXISTS idx_refresh_tokens_token_hash ON refresh_tokens(token_hash);
      CREATE INDEX IF NOT EXISTS idx_refresh_tokens_expires_at ON refresh_tokens(expires_at);
    `
  },

  // Migration 006: Create appointments table
  {
    name: '006_create_appointments_table',
    up: `
      CREATE TABLE IF NOT EXISTS appointments (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        patient_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        provider_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        
        -- Appointment Details
        scheduled_at TIMESTAMP WITH TIME ZONE NOT NULL,
        duration_minutes INTEGER DEFAULT 30,
        status appointment_status DEFAULT 'scheduled',
        type VARCHAR(50) DEFAULT 'video',
        
        -- Reason and Notes
        reason_for_visit TEXT,
        patient_notes TEXT,
        provider_notes TEXT,
        
        -- Video Call
        room_id VARCHAR(255),
        join_url TEXT,
        
        -- Cancellation
        cancelled_by UUID REFERENCES users(id),
        cancellation_reason TEXT,
        cancelled_at TIMESTAMP WITH TIME ZONE,
        
        -- Timestamps
        confirmed_at TIMESTAMP WITH TIME ZONE,
        started_at TIMESTAMP WITH TIME ZONE,
        completed_at TIMESTAMP WITH TIME ZONE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
      
      -- Indexes for appointments table
      CREATE INDEX IF NOT EXISTS idx_appointments_patient_id ON appointments(patient_id);
      CREATE INDEX IF NOT EXISTS idx_appointments_provider_id ON appointments(provider_id);
      CREATE INDEX IF NOT EXISTS idx_appointments_scheduled_at ON appointments(scheduled_at);
      CREATE INDEX IF NOT EXISTS idx_appointments_status ON appointments(status);
      CREATE INDEX IF NOT EXISTS idx_appointments_patient_provider ON appointments(patient_id, provider_id);
    `
  },

  // Migration 007: Create medical_records table
  {
    name: '007_create_medical_records_table',
    up: `
      CREATE TABLE IF NOT EXISTS medical_records (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        patient_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_by UUID NOT NULL REFERENCES users(id),
        appointment_id UUID REFERENCES appointments(id),
        
        -- Record Type
        record_type VARCHAR(50) NOT NULL,
        title VARCHAR(255) NOT NULL,
        
        -- Encrypted Content (AES-GCM)
        content_encrypted TEXT NOT NULL,
        content_iv VARCHAR(32) NOT NULL,
        content_tag VARCHAR(32) NOT NULL,
        
        -- Metadata (not encrypted)
        file_name VARCHAR(255),
        file_type VARCHAR(100),
        file_size INTEGER,
        
        -- Access Control
        is_sensitive BOOLEAN DEFAULT FALSE,
        access_restricted BOOLEAN DEFAULT FALSE,
        
        -- Timestamps
        recorded_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
      
      -- Indexes for medical_records table
      CREATE INDEX IF NOT EXISTS idx_medical_records_patient_id ON medical_records(patient_id);
      CREATE INDEX IF NOT EXISTS idx_medical_records_created_by ON medical_records(created_by);
      CREATE INDEX IF NOT EXISTS idx_medical_records_appointment_id ON medical_records(appointment_id);
      CREATE INDEX IF NOT EXISTS idx_medical_records_record_type ON medical_records(record_type);
      CREATE INDEX IF NOT EXISTS idx_medical_records_recorded_at ON medical_records(recorded_at);
    `
  },

  // Migration 008: Create visits (SOAP notes) table
  {
    name: '008_create_visits_table',
    up: `
      CREATE TABLE IF NOT EXISTS visits (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        appointment_id UUID NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
        patient_id UUID NOT NULL REFERENCES users(id),
        provider_id UUID NOT NULL REFERENCES users(id),
        
        -- SOAP Note Fields (Encrypted)
        subjective_encrypted TEXT,
        subjective_iv VARCHAR(32),
        subjective_tag VARCHAR(32),
        
        objective_encrypted TEXT,
        objective_iv VARCHAR(32),
        objective_tag VARCHAR(32),
        
        assessment_encrypted TEXT,
        assessment_iv VARCHAR(32),
        assessment_tag VARCHAR(32),
        
        plan_encrypted TEXT,
        plan_iv VARCHAR(32),
        plan_tag VARCHAR(32),
        
        -- Vital Signs (Encrypted)
        vitals_encrypted TEXT,
        vitals_iv VARCHAR(32),
        vitals_tag VARCHAR(32),
        
        -- Diagnosis Codes
        icd_codes TEXT[],
        cpt_codes TEXT[],
        
        -- Status
        is_signed BOOLEAN DEFAULT FALSE,
        signed_at TIMESTAMP WITH TIME ZONE,
        is_locked BOOLEAN DEFAULT FALSE,
        
        -- Follow-up
        follow_up_required BOOLEAN DEFAULT FALSE,
        follow_up_notes TEXT,
        
        -- Timestamps
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
      
      -- Indexes for visits table
      CREATE INDEX IF NOT EXISTS idx_visits_appointment_id ON visits(appointment_id);
      CREATE INDEX IF NOT EXISTS idx_visits_patient_id ON visits(patient_id);
      CREATE INDEX IF NOT EXISTS idx_visits_provider_id ON visits(provider_id);
      CREATE INDEX IF NOT EXISTS idx_visits_created_at ON visits(created_at);
      CREATE INDEX IF NOT EXISTS idx_visits_is_signed ON visits(is_signed);
    `
  },

  // Migration 009: Create messages table
  {
    name: '009_create_messages_table',
    up: `
      CREATE TABLE IF NOT EXISTS messages (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        conversation_id UUID NOT NULL,
        sender_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        recipient_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        
        -- Message Content (E2EE)
        content_encrypted TEXT NOT NULL,
        content_iv VARCHAR(32) NOT NULL,
        content_tag VARCHAR(32) NOT NULL,
        
        -- Attachment (if any)
        has_attachment BOOLEAN DEFAULT FALSE,
        attachment_name VARCHAR(255),
        attachment_type VARCHAR(100),
        attachment_encrypted TEXT,
        attachment_iv VARCHAR(32),
        attachment_tag VARCHAR(32),
        
        -- Status
        status message_status DEFAULT 'sent',
        delivered_at TIMESTAMP WITH TIME ZONE,
        read_at TIMESTAMP WITH TIME ZONE,
        
        -- Metadata
        is_urgent BOOLEAN DEFAULT FALSE,
        is_deleted_sender BOOLEAN DEFAULT FALSE,
        is_deleted_recipient BOOLEAN DEFAULT FALSE,
        
        -- Timestamps
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
      
      -- Indexes for messages table
      CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON messages(conversation_id);
      CREATE INDEX IF NOT EXISTS idx_messages_sender_id ON messages(sender_id);
      CREATE INDEX IF NOT EXISTS idx_messages_recipient_id ON messages(recipient_id);
      CREATE INDEX IF NOT EXISTS idx_messages_status ON messages(status);
      CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at);
      CREATE INDEX IF NOT EXISTS idx_messages_conversation_created ON messages(conversation_id, created_at);
    `
  },

  // Migration 010: Create notifications table
  {
    name: '010_create_notifications_table',
    up: `
      CREATE TABLE IF NOT EXISTS notifications (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        
        -- Notification Content
        type notification_type NOT NULL,
        title VARCHAR(255) NOT NULL,
        message TEXT NOT NULL,
        
        -- Reference
        reference_type VARCHAR(50),
        reference_id UUID,
        
        -- Action
        action_url VARCHAR(500),
        action_text VARCHAR(100),
        
        -- Status
        is_read BOOLEAN DEFAULT FALSE,
        read_at TIMESTAMP WITH TIME ZONE,
        
        -- Email/SMS delivery
        email_sent BOOLEAN DEFAULT FALSE,
        sms_sent BOOLEAN DEFAULT FALSE,
        
        -- Timestamps
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        expires_at TIMESTAMP WITH TIME ZONE
      );
      
      -- Indexes for notifications table
      CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id);
      CREATE INDEX IF NOT EXISTS idx_notifications_type ON notifications(type);
      CREATE INDEX IF NOT EXISTS idx_notifications_is_read ON notifications(is_read);
      CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON notifications(created_at);
      CREATE INDEX IF NOT EXISTS idx_notifications_user_unread ON notifications(user_id, is_read) WHERE is_read = FALSE;
    `
  },

  // Migration 011: Create subscriptions table
  {
    name: '011_create_subscriptions_table',
    up: `
      CREATE TABLE IF NOT EXISTS subscriptions (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        
        -- Subscription Details
        tier subscription_tier DEFAULT 'free',
        status subscription_status DEFAULT 'active',
        
        -- Billing
        stripe_customer_id VARCHAR(255),
        stripe_subscription_id VARCHAR(255),
        
        -- Period
        current_period_start TIMESTAMP WITH TIME ZONE,
        current_period_end TIMESTAMP WITH TIME ZONE,
        
        -- Trial
        trial_ends_at TIMESTAMP WITH TIME ZONE,
        
        -- Cancellation
        cancelled_at TIMESTAMP WITH TIME ZONE,
        cancel_at_period_end BOOLEAN DEFAULT FALSE,
        
        -- Timestamps
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
      
      -- Indexes for subscriptions table
      CREATE INDEX IF NOT EXISTS idx_subscriptions_user_id ON subscriptions(user_id);
      CREATE INDEX IF NOT EXISTS idx_subscriptions_tier ON subscriptions(tier);
      CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON subscriptions(status);
      CREATE INDEX IF NOT EXISTS idx_subscriptions_stripe_customer ON subscriptions(stripe_customer_id);
    `
  },

  // Migration 012: Create audit_logs table (HIPAA requirement)
  {
    name: '012_create_audit_logs_table',
    up: `
      CREATE TABLE IF NOT EXISTS audit_logs (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        user_id UUID REFERENCES users(id),
        
        -- Action Details
        action audit_action NOT NULL,
        resource_type VARCHAR(50) NOT NULL,
        resource_id UUID,
        
        -- Request Context
        ip_address INET,
        user_agent TEXT,
        
        -- Details
        description TEXT,
        old_values JSONB,
        new_values JSONB,
        
        -- PHI Access Tracking
        phi_accessed BOOLEAN DEFAULT FALSE,
        patient_id UUID REFERENCES users(id),
        
        -- Status
        success BOOLEAN DEFAULT TRUE,
        error_message TEXT,
        
        -- Timestamps
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
      
      -- Indexes for audit_logs table
      CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON audit_logs(user_id);
      CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action);
      CREATE INDEX IF NOT EXISTS idx_audit_logs_resource ON audit_logs(resource_type, resource_id);
      CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at);
      CREATE INDEX IF NOT EXISTS idx_audit_logs_phi_accessed ON audit_logs(phi_accessed) WHERE phi_accessed = TRUE;
      CREATE INDEX IF NOT EXISTS idx_audit_logs_patient_id ON audit_logs(patient_id);
    `
  },

  // Migration 013: Create provider_schedule table
  {
    name: '013_create_provider_schedule_table',
    up: `
      CREATE TABLE IF NOT EXISTS provider_schedules (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        provider_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        
        -- Schedule
        day_of_week INTEGER NOT NULL CHECK (day_of_week >= 0 AND day_of_week <= 6),
        start_time TIME NOT NULL,
        end_time TIME NOT NULL,
        
        -- Slot Configuration
        slot_duration_minutes INTEGER DEFAULT 30,
        buffer_minutes INTEGER DEFAULT 5,
        
        -- Availability
        is_available BOOLEAN DEFAULT TRUE,
        
        -- Timestamps
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        
        CONSTRAINT unique_provider_day UNIQUE (provider_id, day_of_week)
      );
      
      CREATE INDEX IF NOT EXISTS idx_provider_schedules_provider_id ON provider_schedules(provider_id);
      CREATE INDEX IF NOT EXISTS idx_provider_schedules_day ON provider_schedules(day_of_week);
    `
  },

  // Migration 014: Create provider_time_off table
  {
    name: '014_create_provider_time_off_table',
    up: `
      CREATE TABLE IF NOT EXISTS provider_time_off (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        provider_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        
        -- Time Off Period
        start_datetime TIMESTAMP WITH TIME ZONE NOT NULL,
        end_datetime TIMESTAMP WITH TIME ZONE NOT NULL,
        
        -- Details
        reason VARCHAR(255),
        is_recurring BOOLEAN DEFAULT FALSE,
        
        -- Timestamps
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
      
      CREATE INDEX IF NOT EXISTS idx_provider_time_off_provider_id ON provider_time_off(provider_id);
      CREATE INDEX IF NOT EXISTS idx_provider_time_off_dates ON provider_time_off(start_datetime, end_datetime);
    `
  },

  // Migration 015: Create migration tracking table
  {
    name: '015_create_migrations_table',
    up: `
      CREATE TABLE IF NOT EXISTS migrations (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL UNIQUE,
        executed_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `
  },

  // Migration 016: Create updated_at trigger function
  {
    name: '016_create_updated_at_trigger',
    up: `
      CREATE OR REPLACE FUNCTION update_updated_at_column()
      RETURNS TRIGGER AS $$
      BEGIN
        NEW.updated_at = CURRENT_TIMESTAMP;
        RETURN NEW;
      END;
      $$ language 'plpgsql';
      
      -- Apply trigger to tables with updated_at column
      DROP TRIGGER IF EXISTS update_users_updated_at ON users;
      CREATE TRIGGER update_users_updated_at
        BEFORE UPDATE ON users
        FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
        
      DROP TRIGGER IF EXISTS update_appointments_updated_at ON appointments;
      CREATE TRIGGER update_appointments_updated_at
        BEFORE UPDATE ON appointments
        FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
        
      DROP TRIGGER IF EXISTS update_medical_records_updated_at ON medical_records;
      CREATE TRIGGER update_medical_records_updated_at
        BEFORE UPDATE ON medical_records
        FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
        
      DROP TRIGGER IF EXISTS update_visits_updated_at ON visits;
      CREATE TRIGGER update_visits_updated_at
        BEFORE UPDATE ON visits
        FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
        
      DROP TRIGGER IF EXISTS update_subscriptions_updated_at ON subscriptions;
      CREATE TRIGGER update_subscriptions_updated_at
        BEFORE UPDATE ON subscriptions
        FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
        
      DROP TRIGGER IF EXISTS update_provider_schedules_updated_at ON provider_schedules;
      CREATE TRIGGER update_provider_schedules_updated_at
        BEFORE UPDATE ON provider_schedules
        FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    `
  },

  // Migration 017: Create medical imaging tables
  {
    name: '017_create_medical_imaging_tables',
    up: `
      -- Imaging Studies Table
      CREATE TABLE IF NOT EXISTS imaging_studies (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        patient_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        provider_id UUID REFERENCES users(id),
        appointment_id UUID REFERENCES appointments(id),
        
        -- Study Details
        modality VARCHAR(50) NOT NULL CHECK (modality IN ('CT', 'MR', 'XR', 'US', 'NM', 'PT', 'photo', 'document')),
        study_date TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        body_part VARCHAR(100),
        laterality VARCHAR(20) CHECK (laterality IN ('left', 'right', 'bilateral', 'na')),
        description TEXT,
        clinical_indication TEXT,
        
        -- Status
        status VARCHAR(20) DEFAULT 'Unread' CHECK (status IN ('Unread', 'In Progress', 'Peer Review', 'Finalized', 'Archived')),
        
        -- Storage
        orthanc_id VARCHAR(255),
        storage_path TEXT,
        
        -- Metadata
        patient_name VARCHAR(255),
        patient_dob DATE,
        patient_sex VARCHAR(10),
        
        -- Timestamps
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        deleted_at TIMESTAMP WITH TIME ZONE
      );
      
      -- Image Instances Table
      CREATE TABLE IF NOT EXISTS image_instances (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        imaging_study_id UUID NOT NULL REFERENCES imaging_studies(id) ON DELETE CASCADE,
        file_name VARCHAR(255) NOT NULL,
        original_file_name VARCHAR(255),
        file_type VARCHAR(50) NOT NULL,
        mime_type VARCHAR(100),
        file_size INTEGER,
        storage_url TEXT NOT NULL,
        thumbnail_url TEXT,
        checksum VARCHAR(64),
        width INTEGER,
        height INTEGER,
        frames INTEGER DEFAULT 1,
        sort_order INTEGER DEFAULT 0,
        is_primary BOOLEAN DEFAULT false,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
      
      -- AI Findings Table
      CREATE TABLE IF NOT EXISTS ai_findings (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        imaging_study_id UUID NOT NULL REFERENCES imaging_studies(id) ON DELETE CASCADE,
        image_instance_id UUID REFERENCES image_instances(id) ON DELETE CASCADE,
        finding_type VARCHAR(50) NOT NULL,
        title VARCHAR(255) NOT NULL,
        description TEXT,
        confidence NUMERIC(5,2) NOT NULL,
        location_x NUMERIC(10,2),
        location_y NUMERIC(10,2),
        location_width NUMERIC(10,2),
        location_height NUMERIC(10,2),
        severity VARCHAR(20) CHECK (severity IN ('critical', 'warning', 'normal', 'info')),
        ai_model VARCHAR(100),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
      
      -- Collaboration Timeline Table
      CREATE TABLE IF NOT EXISTS imaging_timeline (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        imaging_study_id UUID NOT NULL REFERENCES imaging_studies(id) ON DELETE CASCADE,
        user_id UUID NOT NULL REFERENCES users(id),
        user_name VARCHAR(255) NOT NULL,
        user_role VARCHAR(50) NOT NULL,
        action VARCHAR(50) NOT NULL CHECK (action IN ('comment', 'status_change', 'upload', 'handoff')),
        content TEXT NOT NULL,
        acknowledged BOOLEAN DEFAULT false,
        acknowledged_by UUID REFERENCES users(id),
        acknowledged_at TIMESTAMP WITH TIME ZONE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
      
      -- Indexes
      CREATE INDEX IF NOT EXISTS idx_imaging_studies_patient_id ON imaging_studies(patient_id);
      CREATE INDEX IF NOT EXISTS idx_imaging_studies_provider_id ON imaging_studies(provider_id);
      CREATE INDEX IF NOT EXISTS idx_imaging_studies_status ON imaging_studies(status);
      CREATE INDEX IF NOT EXISTS idx_imaging_studies_study_date ON imaging_studies(study_date);
      CREATE INDEX IF NOT EXISTS idx_image_instances_study_id ON image_instances(imaging_study_id);
      CREATE INDEX IF NOT EXISTS idx_ai_findings_study_id ON ai_findings(imaging_study_id);
      CREATE INDEX IF NOT EXISTS idx_imaging_timeline_study_id ON imaging_timeline(imaging_study_id);
      CREATE INDEX IF NOT EXISTS idx_imaging_timeline_created_at ON imaging_timeline(created_at);
      
      -- Updated_at trigger for imaging_studies
      DROP TRIGGER IF EXISTS update_imaging_studies_updated_at ON imaging_studies;
      CREATE TRIGGER update_imaging_studies_updated_at
        BEFORE UPDATE ON imaging_studies
        FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
      
      -- Add foreign key constraint for appointment_id if appointments table exists
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'appointments') THEN
          IF NOT EXISTS (
            SELECT 1 FROM information_schema.table_constraints 
            WHERE constraint_name = 'imaging_studies_appointment_id_fkey'
          ) THEN
            ALTER TABLE imaging_studies 
            ADD CONSTRAINT imaging_studies_appointment_id_fkey 
            FOREIGN KEY (appointment_id) REFERENCES appointments(id);
          END IF;
        END IF;
      END $$;
    `
  },
  {
    name: '018_create_email_verification_tokens_table',
    up: `
      -- Email Verification Tokens Table
      CREATE TABLE IF NOT EXISTS email_verification_tokens (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token VARCHAR(255) NOT NULL UNIQUE,
        expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
        used_at TIMESTAMP WITH TIME ZONE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
      
      CREATE INDEX IF NOT EXISTS idx_email_verification_tokens_user_id ON email_verification_tokens(user_id);
      CREATE INDEX IF NOT EXISTS idx_email_verification_tokens_token ON email_verification_tokens(token);
      CREATE INDEX IF NOT EXISTS idx_email_verification_tokens_expires_at ON email_verification_tokens(expires_at);
    `
  },
  {
    name: '019_create_payments_and_access_control_tables',
    up: `
      -- Create enum types if they don't exist
      DO $$ BEGIN
        CREATE TYPE access_level AS ENUM ('read_only', 'pay_per_visit', 'gold_monthly', 'gold_yearly', 'insurance');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
      
      DO $$ BEGIN
        CREATE TYPE payment_status AS ENUM ('pending', 'completed', 'failed', 'refunded');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
      
      DO $$ BEGIN
        CREATE TYPE payment_type AS ENUM ('subscription', 'pay_per_visit', 'insurance_copay', 'refund');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
      
      -- Patient Insurance Table (must exist before payments references it)
      CREATE TABLE IF NOT EXISTS patient_insurance (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        insurance_provider VARCHAR(255),
        plan_name VARCHAR(255),
        member_id VARCHAR(255),
        group_number VARCHAR(255),
        subscriber_name VARCHAR(255),
        subscriber_dob DATE,
        relationship_to_subscriber VARCHAR(50),
        effective_date DATE,
        termination_date DATE,
        is_primary BOOLEAN DEFAULT true,
        is_active BOOLEAN DEFAULT true,
        tokenized_member_id VARCHAR(255),
        ocr_confidence_score DECIMAL(5,2),
        ocr_extracted_data JSONB,
        ocr_provider VARCHAR(50) CHECK (ocr_provider IN ('google_vision', 'aws_textract', 'manual')),
        front_image_encrypted TEXT,
        back_image_encrypted TEXT,
        eligibility_last_checked TIMESTAMP WITH TIME ZONE,
        eligibility_status VARCHAR(50) CHECK (eligibility_status IN ('active', 'inactive', 'pending', 'expired', 'unknown')),
        eligibility_response JSONB,
        rx_bin VARCHAR(50),
        rx_pcn VARCHAR(50),
        rx_group VARCHAR(50),
        audit_log JSONB DEFAULT '[]'::jsonb,
        consent_given BOOLEAN DEFAULT false,
        consent_timestamp TIMESTAMP WITH TIME ZONE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );

      -- Payments Table
      CREATE TABLE IF NOT EXISTS payments (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        appointment_id UUID REFERENCES appointments(id) ON DELETE SET NULL,
        
        -- Payment Details
        type payment_type NOT NULL,
        status payment_status DEFAULT 'pending',
        amount DECIMAL(10, 2) NOT NULL,
        currency VARCHAR(3) DEFAULT 'USD',
        
        -- Payment Provider
        stripe_payment_intent_id VARCHAR(255),
        stripe_charge_id VARCHAR(255),
        payment_method_id VARCHAR(255),
        
        -- Subscription Payment
        subscription_id UUID REFERENCES subscriptions(id) ON DELETE SET NULL,
        
        -- Insurance
        insurance_id UUID REFERENCES patient_insurance(id) ON DELETE SET NULL,
        copay_amount DECIMAL(10, 2),
        claim_submitted BOOLEAN DEFAULT FALSE,
        claim_id VARCHAR(255),
        
        -- Metadata
        description TEXT,
        metadata JSONB,
        
        -- Timestamps
        paid_at TIMESTAMP WITH TIME ZONE,
        refunded_at TIMESTAMP WITH TIME ZONE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
      
      -- PBM Rebates Table (Prescription Benefit Manager rebates)
      CREATE TABLE IF NOT EXISTS pbm_rebates (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        prescription_id UUID REFERENCES visits(id) ON DELETE CASCADE,
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        
        -- Rebate Details
        rebate_amount DECIMAL(10, 2) NOT NULL DEFAULT 6.00,
        currency VARCHAR(3) DEFAULT 'USD',
        status VARCHAR(50) DEFAULT 'pending' CHECK (status IN ('pending', 'processed', 'paid', 'failed')),
        
        -- PBM Provider
        pbm_provider VARCHAR(255),
        rebate_reference_id VARCHAR(255),
        
        -- Timestamps
        processed_at TIMESTAMP WITH TIME ZONE,
        paid_at TIMESTAMP WITH TIME ZONE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
      
      -- Appointment Payments Junction Table
      CREATE TABLE IF NOT EXISTS appointment_payments (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        appointment_id UUID NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
        payment_id UUID NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
        payment_required BOOLEAN DEFAULT TRUE,
        payment_completed BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(appointment_id, payment_id)
      );
      
      -- Add access_level column to users if it doesn't exist
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name = 'users' AND column_name = 'access_level'
        ) THEN
          ALTER TABLE users ADD COLUMN access_level access_level DEFAULT 'read_only';
        END IF;
      END $$;
      
      -- Add payment_required and payment_completed to appointments
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name = 'appointments' AND column_name = 'payment_required'
        ) THEN
          ALTER TABLE appointments ADD COLUMN payment_required BOOLEAN DEFAULT TRUE;
        END IF;
        
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name = 'appointments' AND column_name = 'payment_completed'
        ) THEN
          ALTER TABLE appointments ADD COLUMN payment_completed BOOLEAN DEFAULT FALSE;
        END IF;
        
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name = 'appointments' AND column_name = 'payment_id'
        ) THEN
          ALTER TABLE appointments ADD COLUMN payment_id UUID REFERENCES payments(id) ON DELETE SET NULL;
        END IF;
      END $$;
      
      -- Indexes
      CREATE INDEX IF NOT EXISTS idx_payments_user_id ON payments(user_id);
      CREATE INDEX IF NOT EXISTS idx_payments_appointment_id ON payments(appointment_id);
      CREATE INDEX IF NOT EXISTS idx_payments_subscription_id ON payments(subscription_id);
      CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status);
      CREATE INDEX IF NOT EXISTS idx_payments_type ON payments(type);
      CREATE INDEX IF NOT EXISTS idx_payments_created_at ON payments(created_at);
      
      CREATE INDEX IF NOT EXISTS idx_pbm_rebates_prescription_id ON pbm_rebates(prescription_id);
      CREATE INDEX IF NOT EXISTS idx_pbm_rebates_user_id ON pbm_rebates(user_id);
      CREATE INDEX IF NOT EXISTS idx_pbm_rebates_status ON pbm_rebates(status);
      
      CREATE INDEX IF NOT EXISTS idx_appointment_payments_appointment_id ON appointment_payments(appointment_id);
      CREATE INDEX IF NOT EXISTS idx_appointment_payments_payment_id ON appointment_payments(payment_id);
      
      CREATE INDEX IF NOT EXISTS idx_users_access_level ON users(access_level);
      CREATE INDEX IF NOT EXISTS idx_appointments_payment_completed ON appointments(payment_completed);
      
      -- Updated_at triggers
      DROP TRIGGER IF EXISTS update_payments_updated_at ON payments;
      CREATE TRIGGER update_payments_updated_at
        BEFORE UPDATE ON payments
        FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
      
      DROP TRIGGER IF EXISTS update_pbm_rebates_updated_at ON pbm_rebates;
      CREATE TRIGGER update_pbm_rebates_updated_at
        BEFORE UPDATE ON pbm_rebates
        FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    `
  },
  {
    name: '020_create_prior_auth_claims_rtbc_tables',
    up: `
      -- Prior Authorization Table
      CREATE TABLE IF NOT EXISTS prior_authorizations (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        patient_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        provider_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        visit_id UUID REFERENCES visits(id) ON DELETE SET NULL,
        appointment_id UUID REFERENCES appointments(id) ON DELETE SET NULL,
        
        -- PA Details
        pa_number VARCHAR(255) UNIQUE,
        status VARCHAR(50) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'submitted', 'in_review', 'approved', 'denied', 'expired', 'cancelled')),
        payer_name VARCHAR(255) NOT NULL,
        payer_id VARCHAR(255),
        
        -- Medication/Service
        medication_name VARCHAR(255),
        ndc_code VARCHAR(50),
        service_type VARCHAR(100),
        cpt_codes TEXT[],
        icd_codes TEXT[],
        
        -- Clinical Information
        diagnosis_description TEXT,
        clinical_notes TEXT,
        supporting_documents JSONB DEFAULT '[]'::jsonb,
        
        -- Submission Details
        submitted_via VARCHAR(50) CHECK (submitted_via IN ('covermymeds', 'surescripts', 'manual', 'api')),
        submission_payload JSONB,
        submission_timestamp TIMESTAMP WITH TIME ZONE,
        submitted_by UUID REFERENCES users(id),
        
        -- Response Details
        response_payload JSONB,
        response_timestamp TIMESTAMP WITH TIME ZONE,
        approval_number VARCHAR(255),
        expiration_date DATE,
        denial_reason TEXT,
        appeal_required BOOLEAN DEFAULT false,
        
        -- Decision Routing
        requires_peer_to_peer BOOLEAN DEFAULT false,
        peer_to_peer_scheduled TIMESTAMP WITH TIME ZONE,
        alternative_therapy_suggested TEXT[],
        auto_routed BOOLEAN DEFAULT false,
        
        -- Audit Trail
        audit_log JSONB DEFAULT '[]'::jsonb,
        created_by UUID REFERENCES users(id),
        
        -- Timestamps
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
      
      -- Claims Table
      CREATE TABLE IF NOT EXISTS claims (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        patient_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        provider_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        visit_id UUID REFERENCES visits(id) ON DELETE SET NULL,
        appointment_id UUID REFERENCES appointments(id) ON DELETE SET NULL,
        
        -- Claim Details
        claim_number VARCHAR(255) UNIQUE,
        claim_type VARCHAR(50) NOT NULL CHECK (claim_type IN ('professional', 'institutional', 'pharmacy', 'dental')),
        claim_status VARCHAR(50) NOT NULL DEFAULT 'draft' CHECK (claim_status IN ('draft', 'scrubbed', 'submitted', 'accepted', 'rejected', 'pending', 'paid', 'denied', 'cancelled')),
        
        -- Billing Information
        billing_provider_npi VARCHAR(20) NOT NULL,
        rendering_provider_npi VARCHAR(20),
        service_date_start DATE NOT NULL,
        service_date_end DATE NOT NULL,
        cpt_codes TEXT[] NOT NULL,
        icd_codes TEXT[] NOT NULL,
        modifiers TEXT[],
        
        -- Financial
        total_charge_amount DECIMAL(10, 2) NOT NULL,
        patient_responsibility DECIMAL(10, 2),
        insurance_payment DECIMAL(10, 2),
        adjusted_amount DECIMAL(10, 2),
        
        -- Insurance
        insurance_id UUID REFERENCES patient_insurance(id) ON DELETE SET NULL,
        payer_name VARCHAR(255),
        payer_id VARCHAR(255),
        subscriber_id VARCHAR(255),
        
        -- Clearinghouse
        clearinghouse_provider VARCHAR(50) CHECK (clearinghouse_provider IN ('change_healthcare', 'waystar', 'availity', 'other')),
        edi_837_transaction_id VARCHAR(255),
        edi_835_transaction_id VARCHAR(255),
        submission_timestamp TIMESTAMP WITH TIME ZONE,
        submission_response JSONB,
        
        -- Scrubbing Results
        scrubbing_status VARCHAR(50) DEFAULT 'pending' CHECK (scrubbing_status IN ('pending', 'passed', 'failed', 'warnings')),
        scrubbing_errors JSONB DEFAULT '[]'::jsonb,
        scrubbing_warnings JSONB DEFAULT '[]'::jsonb,
        auto_corrected_issues JSONB DEFAULT '[]'::jsonb,
        requires_review BOOLEAN DEFAULT false,
        
        -- Remittance & EOB
        remittance_advice JSONB,
        eob_document_url TEXT,
        payment_date DATE,
        
        -- Retry Logic
        retry_count INTEGER DEFAULT 0,
        last_retry_at TIMESTAMP WITH TIME ZONE,
        next_retry_at TIMESTAMP WITH TIME ZONE,
        
        -- Metadata
        metadata JSONB DEFAULT '{}'::jsonb,
        created_by UUID REFERENCES users(id),
        
        -- Timestamps
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
      
      -- Real-Time Benefit Check (RTBC) Cache
      CREATE TABLE IF NOT EXISTS rtbc_cache (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        patient_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        medication_name VARCHAR(255) NOT NULL,
        ndc_code VARCHAR(50),
        
        -- Insurance Context
        insurance_id UUID REFERENCES patient_insurance(id) ON DELETE SET NULL,
        payer_name VARCHAR(255),
        member_id VARCHAR(255),
        
        -- Formulary & Coverage
        is_covered BOOLEAN,
        tier_level VARCHAR(50),
        copay_amount DECIMAL(10, 2),
        coinsurance_percent DECIMAL(5, 2),
        deductible_applies BOOLEAN,
        
        -- Prior Auth Requirements
        requires_prior_auth BOOLEAN DEFAULT false,
        prior_auth_criteria TEXT,
        step_therapy_required BOOLEAN DEFAULT false,
        quantity_limit VARCHAR(100),
        age_restriction VARCHAR(100),
        
        -- Alternatives
        preferred_alternatives JSONB DEFAULT '[]'::jsonb,
        lower_cost_alternatives JSONB DEFAULT '[]'::jsonb,
        
        -- Pricing
        cash_price DECIMAL(10, 2),
        insurance_price DECIMAL(10, 2),
        best_price_option VARCHAR(50),
        coupon_available BOOLEAN DEFAULT false,
        coupon_info JSONB,
        
        -- Formulary Source
        formulary_source VARCHAR(100),
        fdb_formulary_id VARCHAR(255),
        surescripts_response_id VARCHAR(255),
        
        -- Cache Metadata
        response_payload JSONB NOT NULL,
        expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        
        -- Index for cache lookups
        UNIQUE(patient_id, medication_name, ndc_code, insurance_id)
      );
      
      -- Insurance Wallet Enhancements (extend existing patient_insurance table)
      DO $$
      BEGIN
        -- Add tokenized fields
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'patient_insurance' AND column_name = 'tokenized_member_id') THEN
          ALTER TABLE patient_insurance ADD COLUMN tokenized_member_id VARCHAR(255);
        END IF;
        
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'patient_insurance' AND column_name = 'ocr_confidence_score') THEN
          ALTER TABLE patient_insurance ADD COLUMN ocr_confidence_score DECIMAL(5,2);
        END IF;
        
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'patient_insurance' AND column_name = 'ocr_extracted_data') THEN
          ALTER TABLE patient_insurance ADD COLUMN ocr_extracted_data JSONB;
        END IF;
        
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'patient_insurance' AND column_name = 'ocr_provider') THEN
          ALTER TABLE patient_insurance ADD COLUMN ocr_provider VARCHAR(50) CHECK (ocr_provider IN ('google_vision', 'aws_textract', 'manual'));
        END IF;
        
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'patient_insurance' AND column_name = 'front_image_encrypted') THEN
          ALTER TABLE patient_insurance ADD COLUMN front_image_encrypted TEXT;
        END IF;
        
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'patient_insurance' AND column_name = 'back_image_encrypted') THEN
          ALTER TABLE patient_insurance ADD COLUMN back_image_encrypted TEXT;
        END IF;
        
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'patient_insurance' AND column_name = 'eligibility_last_checked') THEN
          ALTER TABLE patient_insurance ADD COLUMN eligibility_last_checked TIMESTAMP WITH TIME ZONE;
        END IF;
        
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'patient_insurance' AND column_name = 'eligibility_status') THEN
          ALTER TABLE patient_insurance ADD COLUMN eligibility_status VARCHAR(50) CHECK (eligibility_status IN ('active', 'inactive', 'pending', 'expired', 'unknown'));
        END IF;
        
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'patient_insurance' AND column_name = 'eligibility_response') THEN
          ALTER TABLE patient_insurance ADD COLUMN eligibility_response JSONB;
        END IF;
        
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'patient_insurance' AND column_name = 'rx_bin') THEN
          ALTER TABLE patient_insurance ADD COLUMN rx_bin VARCHAR(50);
        END IF;
        
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'patient_insurance' AND column_name = 'rx_pcn') THEN
          ALTER TABLE patient_insurance ADD COLUMN rx_pcn VARCHAR(50);
        END IF;
        
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'patient_insurance' AND column_name = 'rx_group') THEN
          ALTER TABLE patient_insurance ADD COLUMN rx_group VARCHAR(50);
        END IF;
        
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'patient_insurance' AND column_name = 'audit_log') THEN
          ALTER TABLE patient_insurance ADD COLUMN audit_log JSONB DEFAULT '[]'::jsonb;
        END IF;
        
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'patient_insurance' AND column_name = 'consent_given') THEN
          ALTER TABLE patient_insurance ADD COLUMN consent_given BOOLEAN DEFAULT false;
        END IF;
        
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'patient_insurance' AND column_name = 'consent_timestamp') THEN
          ALTER TABLE patient_insurance ADD COLUMN consent_timestamp TIMESTAMP WITH TIME ZONE;
        END IF;
      END $$;
      
      -- Pharmacy Preferences (extend patient preferences)
      CREATE TABLE IF NOT EXISTS pharmacy_preferences (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        patient_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        pharmacy_name VARCHAR(255) NOT NULL,
        pharmacy_address TEXT NOT NULL,
        pharmacy_phone VARCHAR(50),
        pharmacy_npi VARCHAR(20),
        is_preferred BOOLEAN DEFAULT false,
        latitude DECIMAL(10, 8),
        longitude DECIMAL(11, 8),
        distance_miles DECIMAL(5, 2),
        is_open BOOLEAN DEFAULT true,
        source VARCHAR(50) CHECK (source IN ('patient_selected', 'ocr_extracted', 'gps_located')),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(patient_id, pharmacy_npi)
      );
      
      -- Indexes
      CREATE INDEX IF NOT EXISTS idx_prior_authorizations_patient_id ON prior_authorizations(patient_id);
      CREATE INDEX IF NOT EXISTS idx_prior_authorizations_provider_id ON prior_authorizations(provider_id);
      CREATE INDEX IF NOT EXISTS idx_prior_authorizations_visit_id ON prior_authorizations(visit_id);
      CREATE INDEX IF NOT EXISTS idx_prior_authorizations_status ON prior_authorizations(status);
      CREATE INDEX IF NOT EXISTS idx_prior_authorizations_pa_number ON prior_authorizations(pa_number);
      CREATE INDEX IF NOT EXISTS idx_prior_authorizations_created_at ON prior_authorizations(created_at);
      
      CREATE INDEX IF NOT EXISTS idx_claims_patient_id ON claims(patient_id);
      CREATE INDEX IF NOT EXISTS idx_claims_provider_id ON claims(provider_id);
      CREATE INDEX IF NOT EXISTS idx_claims_visit_id ON claims(visit_id);
      CREATE INDEX IF NOT EXISTS idx_claims_status ON claims(claim_status);
      CREATE INDEX IF NOT EXISTS idx_claims_scrubbing_status ON claims(scrubbing_status);
      CREATE INDEX IF NOT EXISTS idx_claims_claim_number ON claims(claim_number);
      CREATE INDEX IF NOT EXISTS idx_claims_submission_timestamp ON claims(submission_timestamp);
      CREATE INDEX IF NOT EXISTS idx_claims_next_retry_at ON claims(next_retry_at) WHERE next_retry_at IS NOT NULL;
      
      CREATE INDEX IF NOT EXISTS idx_rtbc_cache_patient_id ON rtbc_cache(patient_id);
      CREATE INDEX IF NOT EXISTS idx_rtbc_cache_medication ON rtbc_cache(medication_name);
      CREATE INDEX IF NOT EXISTS idx_rtbc_cache_expires_at ON rtbc_cache(expires_at);
      CREATE INDEX IF NOT EXISTS idx_rtbc_cache_insurance_id ON rtbc_cache(insurance_id);
      
      CREATE INDEX IF NOT EXISTS idx_pharmacy_preferences_patient_id ON pharmacy_preferences(patient_id);
      CREATE INDEX IF NOT EXISTS idx_pharmacy_preferences_is_preferred ON pharmacy_preferences(is_preferred);
      
      -- Updated_at triggers
      DROP TRIGGER IF EXISTS update_prior_authorizations_updated_at ON prior_authorizations;
      CREATE TRIGGER update_prior_authorizations_updated_at
        BEFORE UPDATE ON prior_authorizations
        FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
      
      DROP TRIGGER IF EXISTS update_claims_updated_at ON claims;
      CREATE TRIGGER update_claims_updated_at
        BEFORE UPDATE ON claims
        FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
      
      DROP TRIGGER IF EXISTS update_pharmacy_preferences_updated_at ON pharmacy_preferences;
      CREATE TRIGGER update_pharmacy_preferences_updated_at
        BEFORE UPDATE ON pharmacy_preferences
        FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    `
  },
  {
    name: '021_add_metadata_to_appointments',
    up: `
      -- Add metadata column to appointments table for storing triage and other structured data
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name = 'appointments' AND column_name = 'metadata'
        ) THEN
          ALTER TABLE appointments ADD COLUMN metadata JSONB DEFAULT '{}'::jsonb;
          CREATE INDEX IF NOT EXISTS idx_appointments_metadata_triage ON appointments USING GIN ((metadata -> 'triage'));
        END IF;
      END $$;
    `
  }
  ,
  // Migration 022: Allow same email across roles (unique by email+role)
  {
    name: '022_allow_duplicate_email_across_roles',
    up: `
      -- Drop the original unique constraint on users.email (created by column-level UNIQUE)
      ALTER TABLE users DROP CONSTRAINT IF EXISTS users_email_key;

      -- Enforce uniqueness per (email, role) instead
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM pg_constraint
          WHERE conname = 'users_email_role_key'
        ) THEN
          ALTER TABLE users
          ADD CONSTRAINT users_email_role_key UNIQUE (email, role);
        END IF;
      END $$;
    `
  },
  // Migration 023: Create prescriptions, e-dispensing, and enhanced triage tables
  {
    name: '023_create_prescriptions_and_triage_tables',
    up: `
      -- =====================================================
      -- PRESCRIPTIONS TABLE (E-PRESCRIBING)
      -- =====================================================
      CREATE TABLE IF NOT EXISTS prescriptions (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        patient_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        provider_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        appointment_id UUID REFERENCES appointments(id) ON DELETE SET NULL,
        visit_id UUID REFERENCES visits(id) ON DELETE SET NULL,
        
        -- Medication Details
        medication_name VARCHAR(255) NOT NULL,
        generic_name VARCHAR(255),
        ndc_code VARCHAR(20),
        rx_norm_code VARCHAR(20),
        
        -- Dosage Information
        dosage_strength VARCHAR(100) NOT NULL,
        dosage_form VARCHAR(100) NOT NULL,
        dosage_unit VARCHAR(50),
        route_of_administration VARCHAR(100) DEFAULT 'oral',
        
        -- Prescription Details
        quantity INTEGER NOT NULL,
        quantity_unit VARCHAR(50) DEFAULT 'tablets',
        days_supply INTEGER NOT NULL,
        refills_allowed INTEGER DEFAULT 0,
        refills_remaining INTEGER DEFAULT 0,
        dispense_as_written BOOLEAN DEFAULT false,
        
        -- Scheduling
        schedule_class VARCHAR(20) CHECK (schedule_class IN ('II', 'III', 'IV', 'V', 'non-controlled')),
        is_controlled BOOLEAN DEFAULT false,
        
        -- Instructions
        sig_directions TEXT NOT NULL,
        patient_instructions TEXT,
        pharmacy_notes TEXT,
        
        -- Clinical Information
        diagnosis_code VARCHAR(20),
        diagnosis_description TEXT,
        indication TEXT,
        
        -- Prior Authorization
        requires_prior_auth BOOLEAN DEFAULT false,
        prior_auth_id UUID,
        prior_auth_number VARCHAR(100),
        
        -- Pharmacy Information
        pharmacy_id UUID,
        pharmacy_name VARCHAR(255),
        pharmacy_npi VARCHAR(20),
        pharmacy_address TEXT,
        pharmacy_phone VARCHAR(50),
        pharmacy_fax VARCHAR(50),
        
        -- E-Prescribing Status
        status VARCHAR(50) DEFAULT 'draft' CHECK (status IN (
          'draft', 'pending_review', 'signed', 'sent', 
          'received', 'processing', 'ready', 'picked_up', 
          'delivered', 'cancelled', 'denied', 'transferred'
        )),
        
        -- Surescripts/E-Prescribing
        surescripts_message_id VARCHAR(255),
        erx_sent_at TIMESTAMP WITH TIME ZONE,
        erx_received_at TIMESTAMP WITH TIME ZONE,
        erx_response JSONB,
        
        -- Digital Signature
        provider_signature TEXT,
        signed_at TIMESTAMP WITH TIME ZONE,
        dea_number VARCHAR(20),
        
        -- Tracking
        fill_date DATE,
        last_fill_date DATE,
        next_fill_date DATE,
        
        -- Metadata
        metadata JSONB DEFAULT '{}'::jsonb,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
      
      -- =====================================================
      -- TRIAGE SESSIONS TABLE (Independent of Appointments)
      -- =====================================================
      CREATE TABLE IF NOT EXISTS triage_sessions (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        patient_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        appointment_id UUID REFERENCES appointments(id) ON DELETE SET NULL,
        
        -- Symptoms
        chief_complaint TEXT NOT NULL,
        symptoms TEXT NOT NULL,
        symptom_duration VARCHAR(100),
        symptom_onset TIMESTAMP WITH TIME ZONE,
        symptom_severity INTEGER CHECK (symptom_severity >= 1 AND symptom_severity <= 10),
        
        -- Vital Signs (if available)
        temperature DECIMAL(4,1),
        heart_rate INTEGER,
        blood_pressure_systolic INTEGER,
        blood_pressure_diastolic INTEGER,
        respiratory_rate INTEGER,
        oxygen_saturation DECIMAL(4,1),
        pain_level INTEGER CHECK (pain_level >= 0 AND pain_level <= 10),
        
        -- AI Triage Results
        ai_severity INTEGER CHECK (ai_severity >= 1 AND ai_severity <= 5),
        ai_triage_level VARCHAR(50) CHECK (ai_triage_level IN ('EMERGENT', 'URGENT', 'SEMI_URGENT', 'ROUTINE', 'NON_URGENT')),
        ai_recommended_specialty VARCHAR(100),
        ai_soap_draft TEXT,
        ai_suggested_medications JSONB DEFAULT '[]'::jsonb,
        ai_clinical_flags JSONB DEFAULT '[]'::jsonb,
        ai_differential_diagnosis JSONB DEFAULT '[]'::jsonb,
        ai_recommended_tests JSONB DEFAULT '[]'::jsonb,
        ai_confidence_score DECIMAL(5,2),
        
        -- Body System Categorization
        affected_body_systems JSONB DEFAULT '[]'::jsonb,
        
        -- Emergency Detection
        is_emergency BOOLEAN DEFAULT false,
        emergency_flags JSONB DEFAULT '[]'::jsonb,
        requires_immediate_attention BOOLEAN DEFAULT false,
        
        -- Provider Review
        reviewed_by UUID REFERENCES users(id),
        reviewed_at TIMESTAMP WITH TIME ZONE,
        provider_override_severity INTEGER,
        provider_notes TEXT,
        
        -- Disposition
        disposition VARCHAR(50) CHECK (disposition IN (
          'pending', 'scheduled', 'referred', 'emergency_transfer',
          'self_care', 'completed', 'cancelled'
        )) DEFAULT 'pending',
        disposition_notes TEXT,
        
        -- Queue Management
        queue_priority INTEGER DEFAULT 50,
        queue_entered_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        queue_exited_at TIMESTAMP WITH TIME ZONE,
        wait_time_minutes INTEGER,
        
        -- Routing
        auto_routed BOOLEAN DEFAULT false,
        routed_to_provider_id UUID REFERENCES users(id),
        routed_to_specialty VARCHAR(100),
        routing_reason TEXT,
        
        -- Timestamps
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
      
      -- =====================================================
      -- TRIAGE QUEUE TABLE (Real-time Queue Management)
      -- =====================================================
      CREATE TABLE IF NOT EXISTS triage_queue (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        triage_session_id UUID NOT NULL REFERENCES triage_sessions(id) ON DELETE CASCADE,
        patient_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        
        -- Queue Position
        queue_number INTEGER NOT NULL,
        priority_score INTEGER DEFAULT 50 CHECK (priority_score >= 0 AND priority_score <= 100),
        
        -- Triage Level (determines base priority)
        triage_level VARCHAR(50) NOT NULL CHECK (triage_level IN ('EMERGENT', 'URGENT', 'SEMI_URGENT', 'ROUTINE', 'NON_URGENT')),
        severity INTEGER CHECK (severity >= 1 AND severity <= 5),
        
        -- Assignment
        assigned_provider_id UUID REFERENCES users(id),
        assigned_specialty VARCHAR(100),
        
        -- Status
        status VARCHAR(50) DEFAULT 'waiting' CHECK (status IN (
          'waiting', 'called', 'in_progress', 'on_hold', 
          'completed', 'no_show', 'left_without_being_seen'
        )),
        
        -- Timing
        entered_queue_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        called_at TIMESTAMP WITH TIME ZONE,
        started_at TIMESTAMP WITH TIME ZONE,
        completed_at TIMESTAMP WITH TIME ZONE,
        estimated_wait_minutes INTEGER,
        actual_wait_minutes INTEGER,
        
        -- Flags
        is_callback BOOLEAN DEFAULT false,
        callback_requested_at TIMESTAMP WITH TIME ZONE,
        callback_phone VARCHAR(50),
        
        -- Metadata
        notes TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
      
      -- =====================================================
      -- PHARMACY NETWORK TABLE (Enhanced Pharmacy Directory)
      -- =====================================================
      CREATE TABLE IF NOT EXISTS pharmacy_network (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        
        -- Pharmacy Details
        name VARCHAR(255) NOT NULL,
        chain_name VARCHAR(100),
        npi VARCHAR(20) UNIQUE,
        ncpdp_id VARCHAR(20),
        
        -- Address
        address_line1 VARCHAR(255) NOT NULL,
        address_line2 VARCHAR(255),
        city VARCHAR(100) NOT NULL,
        state VARCHAR(50) NOT NULL,
        zip_code VARCHAR(20) NOT NULL,
        country VARCHAR(50) DEFAULT 'USA',
        
        -- Contact
        phone VARCHAR(50),
        fax VARCHAR(50),
        email VARCHAR(255),
        
        -- Location
        latitude DECIMAL(10, 8),
        longitude DECIMAL(11, 8),
        
        -- Hours
        hours_monday VARCHAR(50),
        hours_tuesday VARCHAR(50),
        hours_wednesday VARCHAR(50),
        hours_thursday VARCHAR(50),
        hours_friday VARCHAR(50),
        hours_saturday VARCHAR(50),
        hours_sunday VARCHAR(50),
        timezone VARCHAR(50) DEFAULT 'America/New_York',
        
        -- Capabilities
        accepts_eprescriptions BOOLEAN DEFAULT true,
        has_drive_thru BOOLEAN DEFAULT false,
        has_24_hour BOOLEAN DEFAULT false,
        has_delivery BOOLEAN DEFAULT false,
        has_compounding BOOLEAN DEFAULT false,
        accepts_controlled_substances BOOLEAN DEFAULT true,
        dea_number VARCHAR(20),
        
        -- Network Status
        is_in_network BOOLEAN DEFAULT true,
        is_preferred BOOLEAN DEFAULT false,
        is_active BOOLEAN DEFAULT true,
        
        -- Metadata
        metadata JSONB DEFAULT '{}'::jsonb,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
      
      -- =====================================================
      -- PRESCRIPTION HISTORY TABLE (Track All Activities)
      -- =====================================================
      CREATE TABLE IF NOT EXISTS prescription_history (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        prescription_id UUID NOT NULL REFERENCES prescriptions(id) ON DELETE CASCADE,
        
        -- Activity
        action VARCHAR(50) NOT NULL CHECK (action IN (
          'created', 'updated', 'signed', 'sent', 'received',
          'filled', 'picked_up', 'delivered', 'cancelled',
          'transferred', 'refill_requested', 'refill_approved',
          'refill_denied', 'prior_auth_submitted', 'prior_auth_approved',
          'prior_auth_denied', 'pharmacy_changed'
        )),
        
        -- Actor
        performed_by UUID REFERENCES users(id),
        performed_by_name VARCHAR(255),
        performed_by_role VARCHAR(50),
        
        -- Details
        old_values JSONB,
        new_values JSONB,
        notes TEXT,
        
        -- Timestamps
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
      
      -- =====================================================
      -- INDEXES
      -- =====================================================
      CREATE INDEX IF NOT EXISTS idx_prescriptions_patient_id ON prescriptions(patient_id);
      CREATE INDEX IF NOT EXISTS idx_prescriptions_provider_id ON prescriptions(provider_id);
      CREATE INDEX IF NOT EXISTS idx_prescriptions_appointment_id ON prescriptions(appointment_id);
      CREATE INDEX IF NOT EXISTS idx_prescriptions_status ON prescriptions(status);
      CREATE INDEX IF NOT EXISTS idx_prescriptions_pharmacy_npi ON prescriptions(pharmacy_npi);
      CREATE INDEX IF NOT EXISTS idx_prescriptions_medication ON prescriptions(medication_name);
      CREATE INDEX IF NOT EXISTS idx_prescriptions_created_at ON prescriptions(created_at);
      
      CREATE INDEX IF NOT EXISTS idx_triage_sessions_patient_id ON triage_sessions(patient_id);
      CREATE INDEX IF NOT EXISTS idx_triage_sessions_appointment_id ON triage_sessions(appointment_id);
      CREATE INDEX IF NOT EXISTS idx_triage_sessions_severity ON triage_sessions(ai_severity);
      CREATE INDEX IF NOT EXISTS idx_triage_sessions_triage_level ON triage_sessions(ai_triage_level);
      CREATE INDEX IF NOT EXISTS idx_triage_sessions_disposition ON triage_sessions(disposition);
      CREATE INDEX IF NOT EXISTS idx_triage_sessions_created_at ON triage_sessions(created_at);
      CREATE INDEX IF NOT EXISTS idx_triage_sessions_is_emergency ON triage_sessions(is_emergency) WHERE is_emergency = true;
      
      CREATE INDEX IF NOT EXISTS idx_triage_queue_session_id ON triage_queue(triage_session_id);
      CREATE INDEX IF NOT EXISTS idx_triage_queue_patient_id ON triage_queue(patient_id);
      CREATE INDEX IF NOT EXISTS idx_triage_queue_status ON triage_queue(status);
      CREATE INDEX IF NOT EXISTS idx_triage_queue_priority ON triage_queue(priority_score DESC);
      CREATE INDEX IF NOT EXISTS idx_triage_queue_assigned_provider ON triage_queue(assigned_provider_id);
      CREATE INDEX IF NOT EXISTS idx_triage_queue_waiting ON triage_queue(status, priority_score DESC) WHERE status = 'waiting';
      
      CREATE INDEX IF NOT EXISTS idx_pharmacy_network_npi ON pharmacy_network(npi);
      CREATE INDEX IF NOT EXISTS idx_pharmacy_network_zip ON pharmacy_network(zip_code);
      CREATE INDEX IF NOT EXISTS idx_pharmacy_network_active ON pharmacy_network(is_active) WHERE is_active = true;
      
      CREATE INDEX IF NOT EXISTS idx_prescription_history_prescription_id ON prescription_history(prescription_id);
      CREATE INDEX IF NOT EXISTS idx_prescription_history_action ON prescription_history(action);
      CREATE INDEX IF NOT EXISTS idx_prescription_history_created_at ON prescription_history(created_at);
      
      -- =====================================================
      -- TRIGGERS
      -- =====================================================
      DROP TRIGGER IF EXISTS update_prescriptions_updated_at ON prescriptions;
      CREATE TRIGGER update_prescriptions_updated_at
        BEFORE UPDATE ON prescriptions
        FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
      
      DROP TRIGGER IF EXISTS update_triage_sessions_updated_at ON triage_sessions;
      CREATE TRIGGER update_triage_sessions_updated_at
        BEFORE UPDATE ON triage_sessions
        FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
      
      DROP TRIGGER IF EXISTS update_triage_queue_updated_at ON triage_queue;
      CREATE TRIGGER update_triage_queue_updated_at
        BEFORE UPDATE ON triage_queue
        FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
      
      DROP TRIGGER IF EXISTS update_pharmacy_network_updated_at ON pharmacy_network;
      CREATE TRIGGER update_pharmacy_network_updated_at
        BEFORE UPDATE ON pharmacy_network
        FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    `
  },

  // Migration 024: Create invitations and campaigns tables
  {
    name: '024_create_invitations_and_campaigns',
    up: `
      -- =====================================================
      -- INVITATIONS TABLE
      -- =====================================================
      CREATE TABLE IF NOT EXISTS invitations (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        
        -- Invite details
        email VARCHAR(255) NOT NULL,
        first_name VARCHAR(100),
        last_name VARCHAR(100),
        role VARCHAR(50) NOT NULL CHECK (role IN ('provider', 'admin', 'super_admin')),
        specialty VARCHAR(100),
        
        -- Token and status
        token VARCHAR(255) UNIQUE NOT NULL,
        status VARCHAR(50) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'expired', 'revoked')),
        
        -- Invite metadata
        invited_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
        organization_name VARCHAR(255),
        personal_message TEXT,
        
        -- Dates
        expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
        accepted_at TIMESTAMP WITH TIME ZONE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
      
      -- =====================================================
      -- EMAIL TEMPLATES TABLE
      -- =====================================================
      CREATE TABLE IF NOT EXISTS email_templates (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        
        -- Template details
        name VARCHAR(255) NOT NULL,
        category VARCHAR(50) NOT NULL CHECK (category IN ('invitation', 'campaign', 'vc_pitch', 'partnership', 'welcome', 'announcement', 'custom')),
        subject VARCHAR(500) NOT NULL,
        body TEXT NOT NULL,
        preview TEXT,
        
        -- Metadata
        is_system_template BOOLEAN DEFAULT FALSE,
        created_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
        
        -- Timestamps
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
      
      -- =====================================================
      -- EMAIL CAMPAIGNS TABLE
      -- =====================================================
      CREATE TABLE IF NOT EXISTS email_campaigns (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        
        -- Campaign details
        name VARCHAR(255) NOT NULL,
        template_id UUID REFERENCES email_templates(id) ON DELETE SET NULL,
        
        -- Recipients (stored as JSON array of emails or user IDs)
        recipients JSONB NOT NULL DEFAULT '[]',
        recipient_count INTEGER DEFAULT 0,
        
        -- Variables for template
        variables JSONB DEFAULT '{}',
        
        -- Scheduling
        status VARCHAR(50) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'scheduled', 'sending', 'sent', 'failed', 'cancelled')),
        scheduled_at TIMESTAMP WITH TIME ZONE,
        sent_at TIMESTAMP WITH TIME ZONE,
        
        -- Stats
        emails_sent INTEGER DEFAULT 0,
        emails_opened INTEGER DEFAULT 0,
        emails_clicked INTEGER DEFAULT 0,
        emails_bounced INTEGER DEFAULT 0,
        
        -- Metadata
        created_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
        
        -- Timestamps
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
      
      -- =====================================================
      -- CAMPAIGN EMAIL LOGS TABLE
      -- =====================================================
      CREATE TABLE IF NOT EXISTS campaign_email_logs (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        campaign_id UUID NOT NULL REFERENCES email_campaigns(id) ON DELETE CASCADE,
        recipient_email VARCHAR(255) NOT NULL,
        status VARCHAR(50) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'opened', 'clicked', 'bounced', 'failed')),
        sent_at TIMESTAMP WITH TIME ZONE,
        opened_at TIMESTAMP WITH TIME ZONE,
        clicked_at TIMESTAMP WITH TIME ZONE,
        error_message TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
      
      -- =====================================================
      -- ADD must_change_password TO USERS TABLE
      -- =====================================================
      ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN DEFAULT FALSE;
      
      -- =====================================================
      -- INDEXES
      -- =====================================================
      CREATE INDEX IF NOT EXISTS idx_invitations_email ON invitations(email);
      CREATE INDEX IF NOT EXISTS idx_invitations_token ON invitations(token);
      CREATE INDEX IF NOT EXISTS idx_invitations_status ON invitations(status);
      CREATE INDEX IF NOT EXISTS idx_invitations_invited_by ON invitations(invited_by_user_id);
      CREATE INDEX IF NOT EXISTS idx_email_templates_category ON email_templates(category);
      CREATE INDEX IF NOT EXISTS idx_email_campaigns_status ON email_campaigns(status);
      CREATE INDEX IF NOT EXISTS idx_email_campaigns_scheduled_at ON email_campaigns(scheduled_at);
      CREATE INDEX IF NOT EXISTS idx_campaign_email_logs_campaign ON campaign_email_logs(campaign_id);
      
      -- =====================================================
      -- TRIGGERS
      -- =====================================================
      DROP TRIGGER IF EXISTS update_invitations_updated_at ON invitations;
      CREATE TRIGGER update_invitations_updated_at
        BEFORE UPDATE ON invitations
        FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
      
      DROP TRIGGER IF EXISTS update_email_templates_updated_at ON email_templates;
      CREATE TRIGGER update_email_templates_updated_at
        BEFORE UPDATE ON email_templates
        FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
      
      DROP TRIGGER IF EXISTS update_email_campaigns_updated_at ON email_campaigns;
      CREATE TRIGGER update_email_campaigns_updated_at
        BEFORE UPDATE ON email_campaigns
        FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    `
  },

  // Migration 025: Provider Credentialing System
  {
    name: '025_provider_credentialing',
    up: `
      -- Credentialing status enum
      DO $$ BEGIN
        CREATE TYPE credentialing_status AS ENUM (
          'not_started', 'pending_payment', 'documents_required', 'documents_under_review',
          'license_verification', 'dea_verification', 'npi_verification', 'background_check',
          'malpractice_verification', 'education_verification', 'references_check',
          'committee_review', 'approved', 'rejected', 'suspended', 'expired'
        );
      EXCEPTION WHEN duplicate_object THEN null;
      END $$;

      -- Credentialing step status enum
      DO $$ BEGIN
        CREATE TYPE step_status AS ENUM (
          'not_started', 'in_progress', 'pending_review', 'approved', 'rejected', 'requires_resubmission'
        );
      EXCEPTION WHEN duplicate_object THEN null;
      END $$;

      -- Document type enum
      DO $$ BEGIN
        CREATE TYPE credential_document_type AS ENUM (
          'medical_license', 'dea_certificate', 'npi_certificate', 'board_certification',
          'medical_degree', 'cv_resume', 'malpractice_insurance', 'photo_id', 'proof_of_address',
          'background_check_consent', 'reference_letter', 'immunization_records',
          'cpr_certification', 'hipaa_training', 'state_license', 'work_history', 'other'
        );
      EXCEPTION WHEN duplicate_object THEN null;
      END $$;

      -- Main provider credentialing table
      CREATE TABLE IF NOT EXISTS provider_credentialing (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        provider_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        status credentialing_status DEFAULT 'not_started',
        progress_percentage INTEGER DEFAULT 0,
        payment_completed BOOLEAN DEFAULT FALSE,
        payment_id TEXT,
        payment_amount DECIMAL(10, 2),
        payment_date TIMESTAMPTZ,
        application_submitted_at TIMESTAMPTZ,
        application_type VARCHAR(50) DEFAULT 'new',
        legal_first_name VARCHAR(100),
        legal_middle_name VARCHAR(100),
        legal_last_name VARCHAR(100),
        date_of_birth DATE,
        ssn_last_four VARCHAR(4),
        gender VARCHAR(20),
        primary_address TEXT,
        city VARCHAR(100),
        state VARCHAR(50),
        zip_code VARCHAR(20),
        country VARCHAR(100) DEFAULT 'United States',
        specialty VARCHAR(100),
        subspecialties TEXT[],
        years_in_practice INTEGER,
        practice_type VARCHAR(50),
        medical_license_number VARCHAR(100),
        medical_license_state VARCHAR(50),
        medical_license_expiry DATE,
        license_verified BOOLEAN DEFAULT FALSE,
        license_verified_at TIMESTAMPTZ,
        license_verification_notes TEXT,
        dea_number VARCHAR(50),
        dea_expiry DATE,
        dea_verified BOOLEAN DEFAULT FALSE,
        dea_verified_at TIMESTAMPTZ,
        dea_verification_notes TEXT,
        npi_number VARCHAR(20),
        npi_verified BOOLEAN DEFAULT FALSE,
        npi_verified_at TIMESTAMPTZ,
        npi_verification_notes TEXT,
        board_certified BOOLEAN DEFAULT FALSE,
        board_name VARCHAR(200),
        board_certification_number VARCHAR(100),
        board_certification_expiry DATE,
        board_verified BOOLEAN DEFAULT FALSE,
        board_verified_at TIMESTAMPTZ,
        medical_school VARCHAR(200),
        graduation_year INTEGER,
        degree_type VARCHAR(50),
        residency_program VARCHAR(200),
        residency_completion_year INTEGER,
        fellowship_program VARCHAR(200),
        fellowship_completion_year INTEGER,
        education_verified BOOLEAN DEFAULT FALSE,
        education_verified_at TIMESTAMPTZ,
        malpractice_carrier VARCHAR(200),
        malpractice_policy_number VARCHAR(100),
        malpractice_coverage_amount DECIMAL(12, 2),
        malpractice_expiry DATE,
        malpractice_verified BOOLEAN DEFAULT FALSE,
        malpractice_verified_at TIMESTAMPTZ,
        background_check_consent BOOLEAN DEFAULT FALSE,
        background_check_submitted_at TIMESTAMPTZ,
        background_check_completed_at TIMESTAMPTZ,
        background_check_status VARCHAR(50),
        background_check_clear BOOLEAN,
        background_check_notes TEXT,
        references_submitted INTEGER DEFAULT 0,
        references_required INTEGER DEFAULT 3,
        references_verified INTEGER DEFAULT 0,
        work_history_gaps_explained BOOLEAN DEFAULT FALSE,
        committee_review_date TIMESTAMPTZ,
        committee_decision VARCHAR(50),
        committee_notes TEXT,
        approved_at TIMESTAMPTZ,
        approved_by UUID REFERENCES users(id),
        approval_expiry DATE,
        rejection_reason TEXT,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(provider_id)
      );

      -- Credentialing steps tracking table
      CREATE TABLE IF NOT EXISTS credentialing_steps (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        credentialing_id UUID NOT NULL REFERENCES provider_credentialing(id) ON DELETE CASCADE,
        step_number INTEGER NOT NULL,
        step_name VARCHAR(100) NOT NULL,
        step_description TEXT,
        status step_status DEFAULT 'not_started',
        started_at TIMESTAMPTZ,
        completed_at TIMESTAMPTZ,
        due_date DATE,
        reviewed_by UUID REFERENCES users(id),
        review_notes TEXT,
        rejection_reason TEXT,
        metadata JSONB DEFAULT '{}',
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(credentialing_id, step_number)
      );

      -- Credentialing documents table
      CREATE TABLE IF NOT EXISTS credentialing_documents (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        credentialing_id UUID NOT NULL REFERENCES provider_credentialing(id) ON DELETE CASCADE,
        document_type credential_document_type NOT NULL,
        document_name VARCHAR(255) NOT NULL,
        file_url TEXT NOT NULL,
        file_size INTEGER,
        mime_type VARCHAR(100),
        status step_status DEFAULT 'pending_review',
        verified_at TIMESTAMPTZ,
        verified_by UUID REFERENCES users(id),
        verification_notes TEXT,
        expiry_date DATE,
        reminder_sent BOOLEAN DEFAULT FALSE,
        metadata JSONB DEFAULT '{}',
        uploaded_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      );

      -- Professional references table
      CREATE TABLE IF NOT EXISTS credentialing_references (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        credentialing_id UUID NOT NULL REFERENCES provider_credentialing(id) ON DELETE CASCADE,
        reference_name VARCHAR(200) NOT NULL,
        reference_title VARCHAR(100),
        reference_organization VARCHAR(200),
        reference_email VARCHAR(255),
        reference_phone VARCHAR(50),
        relationship VARCHAR(100),
        years_known INTEGER,
        contacted_at TIMESTAMPTZ,
        response_received_at TIMESTAMPTZ,
        verification_status step_status DEFAULT 'not_started',
        verification_notes TEXT,
        recommendation VARCHAR(50),
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      );

      -- Work history table
      CREATE TABLE IF NOT EXISTS credentialing_work_history (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        credentialing_id UUID NOT NULL REFERENCES provider_credentialing(id) ON DELETE CASCADE,
        employer_name VARCHAR(200) NOT NULL,
        employer_address TEXT,
        position_title VARCHAR(100),
        department VARCHAR(100),
        start_date DATE NOT NULL,
        end_date DATE,
        is_current BOOLEAN DEFAULT FALSE,
        reason_for_leaving TEXT,
        supervisor_name VARCHAR(200),
        supervisor_phone VARCHAR(50),
        verified BOOLEAN DEFAULT FALSE,
        verified_at TIMESTAMPTZ,
        verification_notes TEXT,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      );

      -- Credentialing audit log
      CREATE TABLE IF NOT EXISTS credentialing_audit_log (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        credentialing_id UUID NOT NULL REFERENCES provider_credentialing(id) ON DELETE CASCADE,
        action VARCHAR(100) NOT NULL,
        action_by UUID REFERENCES users(id),
        action_by_role VARCHAR(50),
        previous_status credentialing_status,
        new_status credentialing_status,
        details JSONB DEFAULT '{}',
        ip_address VARCHAR(50),
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      );

      -- Add Stripe columns to users and subscriptions
      ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_customer_id VARCHAR(100);
      ALTER TABLE users ADD COLUMN IF NOT EXISTS subscription_tier VARCHAR(50) DEFAULT 'free';
      ALTER TABLE payments ADD COLUMN IF NOT EXISTS stripe_payment_id VARCHAR(100);
      ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS stripe_subscription_id VARCHAR(100);

      -- Indexes
      CREATE INDEX IF NOT EXISTS idx_credentialing_provider ON provider_credentialing(provider_id);
      CREATE INDEX IF NOT EXISTS idx_credentialing_status ON provider_credentialing(status);
      CREATE INDEX IF NOT EXISTS idx_credentialing_steps ON credentialing_steps(credentialing_id);
      CREATE INDEX IF NOT EXISTS idx_credentialing_docs ON credentialing_documents(credentialing_id);
      CREATE INDEX IF NOT EXISTS idx_credentialing_refs ON credentialing_references(credentialing_id);
      CREATE INDEX IF NOT EXISTS idx_users_stripe ON users(stripe_customer_id);
      CREATE INDEX IF NOT EXISTS idx_subscriptions_stripe ON subscriptions(stripe_subscription_id);

      -- Trigger for default steps
      CREATE OR REPLACE FUNCTION create_default_credentialing_steps()
      RETURNS TRIGGER AS $$
      BEGIN
        INSERT INTO credentialing_steps (credentialing_id, step_number, step_name, step_description) VALUES
          (NEW.id, 1, 'Application Fee', 'Pay the credentialing application fee'),
          (NEW.id, 2, 'Personal Information', 'Complete personal and contact information'),
          (NEW.id, 3, 'Professional Information', 'Provide specialty and practice details'),
          (NEW.id, 4, 'Medical License', 'Upload and verify medical license'),
          (NEW.id, 5, 'DEA Registration', 'Provide DEA registration information'),
          (NEW.id, 6, 'NPI Verification', 'Verify National Provider Identifier'),
          (NEW.id, 7, 'Education & Training', 'Provide education and training history'),
          (NEW.id, 8, 'Board Certification', 'Upload board certification if applicable'),
          (NEW.id, 9, 'Malpractice Insurance', 'Provide malpractice insurance details'),
          (NEW.id, 10, 'Work History', 'Complete 10-year work history'),
          (NEW.id, 11, 'References', 'Provide professional references'),
          (NEW.id, 12, 'Background Check', 'Consent to background check'),
          (NEW.id, 13, 'Document Upload', 'Upload all required documents'),
          (NEW.id, 14, 'Committee Review', 'Credentialing committee review'),
          (NEW.id, 15, 'Final Approval', 'Final approval and activation');
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;

      DROP TRIGGER IF EXISTS create_credentialing_steps_trigger ON provider_credentialing;
      CREATE TRIGGER create_credentialing_steps_trigger
        AFTER INSERT ON provider_credentialing
        FOR EACH ROW
        EXECUTE FUNCTION create_default_credentialing_steps();

      -- Updated_at triggers
      DROP TRIGGER IF EXISTS update_provider_credentialing_updated_at ON provider_credentialing;
      CREATE TRIGGER update_provider_credentialing_updated_at
        BEFORE UPDATE ON provider_credentialing
        FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

      DROP TRIGGER IF EXISTS update_credentialing_steps_updated_at ON credentialing_steps;
      CREATE TRIGGER update_credentialing_steps_updated_at
        BEFORE UPDATE ON credentialing_steps
        FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    `
  },

  // Migration 026: Membership cards + access levels for Stripe plans
  {
    name: '026_membership_cards_and_access_levels',
    up: `
      -- Expand access_level enum (used for paid-access gating)
      DO $$ BEGIN
        ALTER TYPE access_level ADD VALUE IF NOT EXISTS 'basic_monthly';
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;

      DO $$ BEGIN
        ALTER TYPE access_level ADD VALUE IF NOT EXISTS 'platinum_monthly';
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;

      -- Expand subscription_tier enum to include 'basic' (Stripe plan exists)
      DO $$ BEGIN
        ALTER TYPE subscription_tier ADD VALUE IF NOT EXISTS 'basic';
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;

      -- Membership cards (Gold/Platinum issued after successful payment)
      CREATE TABLE IF NOT EXISTS membership_cards (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

        tier subscription_tier NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'revoked')),

        card_number VARCHAR(32) NOT NULL UNIQUE,
        stripe_subscription_id VARCHAR(100),
        current_period_end TIMESTAMPTZ,

        issued_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        suspended_at TIMESTAMPTZ,
        revoked_at TIMESTAMPTZ,

        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_membership_cards_user_id ON membership_cards(user_id);
      CREATE INDEX IF NOT EXISTS idx_membership_cards_tier ON membership_cards(tier);
      CREATE INDEX IF NOT EXISTS idx_membership_cards_status ON membership_cards(status);
      CREATE INDEX IF NOT EXISTS idx_membership_cards_stripe_sub ON membership_cards(stripe_subscription_id);

      DROP TRIGGER IF EXISTS update_membership_cards_updated_at ON membership_cards;
      CREATE TRIGGER update_membership_cards_updated_at
        BEFORE UPDATE ON membership_cards
        FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    `
  },

  // Migration 027: Stripe webhook idempotency (avoid double-processing on retries)
  {
    name: '027_stripe_webhook_idempotency',
    up: `
      CREATE TABLE IF NOT EXISTS stripe_webhook_events (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        event_id VARCHAR(255) NOT NULL UNIQUE,
        event_type VARCHAR(255) NOT NULL,
        received_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_stripe_webhook_events_received_at ON stripe_webhook_events(received_at DESC);
      CREATE INDEX IF NOT EXISTS idx_stripe_webhook_events_event_type ON stripe_webhook_events(event_type);
    `
  },

  // Migration 028: Mini-EHR Clinical Records Module
  {
    name: '028_mini_ehr_clinical_records',
    up: `
      -- =====================================================
      -- PATIENT ALLERGIES TABLE
      -- =====================================================
      CREATE TABLE IF NOT EXISTS patient_allergies (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        patient_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        allergy_name VARCHAR(255) NOT NULL,
        reaction TEXT,
        severity VARCHAR(50) CHECK (severity IN ('mild', 'moderate', 'severe', 'anaphylaxis')),
        onset_date DATE,
        status VARCHAR(50) DEFAULT 'active' CHECK (status IN ('active', 'resolved', 'inactive')),
        recorded_by UUID REFERENCES users(id),
        recorded_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE (patient_id, allergy_name)
      );

      CREATE INDEX IF NOT EXISTS idx_patient_allergies_patient_id ON patient_allergies(patient_id);

      -- =====================================================
      -- PATIENT MEDICATIONS TABLE (Manually maintained, informational)
      -- =====================================================
      CREATE TABLE IF NOT EXISTS patient_medications (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        patient_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        medication_name VARCHAR(255) NOT NULL,
        dosage VARCHAR(100),
        frequency VARCHAR(100),
        route VARCHAR(100),
        start_date DATE,
        end_date DATE,
        status VARCHAR(50) DEFAULT 'active' CHECK (status IN ('active', 'discontinued', 'completed')),
        notes TEXT,
        recorded_by UUID REFERENCES users(id),
        recorded_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_patient_medications_patient_id ON patient_medications(patient_id);

      -- =====================================================
      -- PATIENT PROBLEMS / DIAGNOSES TABLE
      -- =====================================================
      CREATE TABLE IF NOT EXISTS patient_problems (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        patient_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        problem_name VARCHAR(255) NOT NULL,
        icd_code VARCHAR(20),
        onset_date DATE,
        resolved_date DATE,
        status VARCHAR(50) DEFAULT 'active' CHECK (status IN ('active', 'resolved', 'chronic')),
        notes TEXT,
        recorded_by UUID REFERENCES users(id),
        recorded_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_patient_problems_patient_id ON patient_problems(patient_id);

      -- =====================================================
      -- CLINICAL ENCOUNTERS TABLE (System of Record)
      -- =====================================================
      CREATE TABLE IF NOT EXISTS clinical_encounters (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        patient_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        provider_id UUID NOT NULL REFERENCES users(id),
        appointment_id UUID REFERENCES appointments(id) ON DELETE SET NULL,
        encounter_type VARCHAR(100) NOT NULL,
        encounter_start_time TIMESTAMPTZ NOT NULL,
        encounter_end_time TIMESTAMPTZ,
        patient_location_state VARCHAR(100),
        identity_verified BOOLEAN DEFAULT FALSE,
        identity_verification_method VARCHAR(100),
        chief_complaint TEXT,
        status VARCHAR(50) DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'signed', 'amended', 'finalized')),
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_clinical_encounters_patient_id ON clinical_encounters(patient_id);
      CREATE INDEX IF NOT EXISTS idx_clinical_encounters_provider_id ON clinical_encounters(provider_id);
      CREATE INDEX IF NOT EXISTS idx_clinical_encounters_appointment_id ON clinical_encounters(appointment_id);
      CREATE INDEX IF NOT EXISTS idx_clinical_encounters_status ON clinical_encounters(status);

      -- =====================================================
      -- CLINICAL NOTES TABLE (Append-only header)
      -- =====================================================
      CREATE TABLE IF NOT EXISTS clinical_notes (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        encounter_id UUID NOT NULL REFERENCES clinical_encounters(id) ON DELETE CASCADE,
        note_type VARCHAR(50) NOT NULL DEFAULT 'SOAP',
        current_version_id UUID,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_clinical_notes_encounter_id ON clinical_notes(encounter_id);

      -- =====================================================
      -- CLINICAL NOTE VERSIONS TABLE (Append-only, full history)
      -- =====================================================
      CREATE TABLE IF NOT EXISTS clinical_note_versions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        note_id UUID NOT NULL REFERENCES clinical_notes(id) ON DELETE CASCADE,
        version_number INTEGER NOT NULL,
        subjective_encrypted TEXT,
        subjective_iv VARCHAR(255),
        subjective_tag VARCHAR(255),
        objective_encrypted TEXT,
        objective_iv VARCHAR(255),
        objective_tag VARCHAR(255),
        assessment_encrypted TEXT,
        assessment_iv VARCHAR(255),
        assessment_tag VARCHAR(255),
        plan_encrypted TEXT,
        plan_iv VARCHAR(255),
        plan_tag VARCHAR(255),
        icd_codes TEXT[],
        cpt_codes TEXT[],
        provider_signature_text VARCHAR(255),
        provider_signature_timestamp TIMESTAMPTZ,
        signed_by UUID REFERENCES users(id),
        is_amendment BOOLEAN DEFAULT FALSE,
        amends_version_id UUID REFERENCES clinical_note_versions(id),
        created_by UUID NOT NULL REFERENCES users(id),
        created_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE (note_id, version_number)
      );

      CREATE INDEX IF NOT EXISTS idx_clinical_note_versions_note_id ON clinical_note_versions(note_id);
      CREATE INDEX IF NOT EXISTS idx_clinical_note_versions_created_by ON clinical_note_versions(created_by);

      -- Add FK constraint for current_version_id after versions table exists
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.table_constraints
          WHERE constraint_name = 'fk_clinical_notes_current_version'
        ) THEN
          ALTER TABLE clinical_notes
          ADD CONSTRAINT fk_clinical_notes_current_version
          FOREIGN KEY (current_version_id)
          REFERENCES clinical_note_versions(id)
          ON DELETE SET NULL;
        END IF;
      END $$;

      -- =====================================================
      -- TELEHEALTH CONSENTS TABLE
      -- =====================================================
      CREATE TABLE IF NOT EXISTS telehealth_consents (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        patient_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        encounter_id UUID REFERENCES clinical_encounters(id) ON DELETE SET NULL,
        consent_text_version VARCHAR(50) NOT NULL,
        consent_granted_at TIMESTAMPTZ DEFAULT NOW(),
        ip_address VARCHAR(45),
        user_agent TEXT,
        is_valid BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_telehealth_consents_patient_id ON telehealth_consents(patient_id);
      CREATE INDEX IF NOT EXISTS idx_telehealth_consents_encounter_id ON telehealth_consents(encounter_id);

      -- =====================================================
      -- EXTERNAL E-PRESCRIBING REFERENCES TABLE (iPrescribe integration)
      -- =====================================================
      CREATE TABLE IF NOT EXISTS erx_prescriptions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        patient_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        provider_id UUID NOT NULL REFERENCES users(id),
        clinical_encounter_id UUID REFERENCES clinical_encounters(id) ON DELETE SET NULL,
        medication_name VARCHAR(255) NOT NULL,
        dosage VARCHAR(100),
        route VARCHAR(100),
        indication TEXT,
        rationale TEXT,
        external_rx_id VARCHAR(255),
        external_status VARCHAR(50) DEFAULT 'pending_external_creation',
        external_status_details JSONB,
        prescribed_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_erx_prescriptions_patient_id ON erx_prescriptions(patient_id);
      CREATE INDEX IF NOT EXISTS idx_erx_prescriptions_provider_id ON erx_prescriptions(provider_id);
      CREATE INDEX IF NOT EXISTS idx_erx_prescriptions_encounter_id ON erx_prescriptions(clinical_encounter_id);
      CREATE INDEX IF NOT EXISTS idx_erx_prescriptions_external_rx_id ON erx_prescriptions(external_rx_id);

      -- =====================================================
      -- EXTEND USERS TABLE FOR PROVIDER METADATA
      -- =====================================================
      ALTER TABLE users ADD COLUMN IF NOT EXISTS dea_number VARCHAR(255);
      ALTER TABLE users ADD COLUMN IF NOT EXISTS business_associate_agreement_signed BOOLEAN DEFAULT FALSE;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS business_associate_agreement_signed_at TIMESTAMPTZ;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS primary_address VARCHAR(255);
      ALTER TABLE users ADD COLUMN IF NOT EXISTS gender VARCHAR(50);
      ALTER TABLE users ADD COLUMN IF NOT EXISTS identity_verified BOOLEAN DEFAULT FALSE;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS identity_verification_method VARCHAR(100);

      -- =====================================================
      -- EXTEND APPOINTMENTS TABLE TO LINK TO CLINICAL ENCOUNTERS
      -- =====================================================
      ALTER TABLE appointments ADD COLUMN IF NOT EXISTS clinical_encounter_id UUID REFERENCES clinical_encounters(id) ON DELETE SET NULL;

      -- =====================================================
      -- TRIGGERS FOR UPDATED_AT
      -- =====================================================
      DROP TRIGGER IF EXISTS update_patient_allergies_updated_at ON patient_allergies;
      CREATE TRIGGER update_patient_allergies_updated_at
        BEFORE UPDATE ON patient_allergies
        FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

      DROP TRIGGER IF EXISTS update_patient_medications_updated_at ON patient_medications;
      CREATE TRIGGER update_patient_medications_updated_at
        BEFORE UPDATE ON patient_medications
        FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

      DROP TRIGGER IF EXISTS update_patient_problems_updated_at ON patient_problems;
      CREATE TRIGGER update_patient_problems_updated_at
        BEFORE UPDATE ON patient_problems
        FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

      DROP TRIGGER IF EXISTS update_clinical_encounters_updated_at ON clinical_encounters;
      CREATE TRIGGER update_clinical_encounters_updated_at
        BEFORE UPDATE ON clinical_encounters
        FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

      DROP TRIGGER IF EXISTS update_clinical_notes_updated_at ON clinical_notes;
      CREATE TRIGGER update_clinical_notes_updated_at
        BEFORE UPDATE ON clinical_notes
        FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

      DROP TRIGGER IF EXISTS update_erx_prescriptions_updated_at ON erx_prescriptions;
      CREATE TRIGGER update_erx_prescriptions_updated_at
        BEFORE UPDATE ON erx_prescriptions
        FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    `
  },

  // Migration 029: Mini-EHR schema alignment (match services + encrypted PHI-by-default)
  {
    name: '029_mini_ehr_schema_alignment',
    up: `
      -- =====================================================
      -- PROVIDER <-> PATIENT RELATIONSHIPS (access scoping)
      -- =====================================================
      CREATE TABLE IF NOT EXISTS provider_patient_relationships (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        provider_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        patient_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        relationship_type VARCHAR(50) NOT NULL DEFAULT 'treating',
        established_encounter_id UUID REFERENCES clinical_encounters(id) ON DELETE SET NULL,
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(provider_id, patient_id, relationship_type)
      );

      CREATE INDEX IF NOT EXISTS idx_provider_patient_relationships_provider ON provider_patient_relationships(provider_id);
      CREATE INDEX IF NOT EXISTS idx_provider_patient_relationships_patient ON provider_patient_relationships(patient_id);
      CREATE INDEX IF NOT EXISTS idx_provider_patient_relationships_active ON provider_patient_relationships(is_active) WHERE is_active = true;

      DROP TRIGGER IF EXISTS update_provider_patient_relationships_updated_at ON provider_patient_relationships;
      CREATE TRIGGER update_provider_patient_relationships_updated_at
        BEFORE UPDATE ON provider_patient_relationships
        FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

      -- =====================================================
      -- PATIENT CLINICAL PROFILE (non-note chart data)
      -- =====================================================
      CREATE TABLE IF NOT EXISTS patient_clinical_profiles (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        patient_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,

        identity_verified BOOLEAN DEFAULT FALSE,
        identity_verification_method VARCHAR(100),
        identity_verified_at TIMESTAMPTZ,
        identity_verified_by UUID REFERENCES users(id),

        emergency_contact_name VARCHAR(255),
        emergency_contact_phone VARCHAR(50),
        emergency_contact_relationship VARCHAR(100),

        pcp_name VARCHAR(255),
        pcp_phone VARCHAR(50),
        pcp_fax VARCHAR(50),
        pcp_npi VARCHAR(50),

        preferred_pharmacy_name VARCHAR(255),
        preferred_pharmacy_address TEXT,
        preferred_pharmacy_phone VARCHAR(50),
        preferred_pharmacy_npi VARCHAR(50),

        has_advance_directive BOOLEAN DEFAULT FALSE,
        advance_directive_type VARCHAR(100),
        advance_directive_notes TEXT,

        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_patient_clinical_profiles_patient_id ON patient_clinical_profiles(patient_id);

      DROP TRIGGER IF EXISTS update_patient_clinical_profiles_updated_at ON patient_clinical_profiles;
      CREATE TRIGGER update_patient_clinical_profiles_updated_at
        BEFORE UPDATE ON patient_clinical_profiles
        FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

      -- =====================================================
      -- ALIGN patient_allergies to encrypted format used by services
      -- (keeps existing columns for backward compatibility)
      -- =====================================================
      ALTER TABLE patient_allergies ADD COLUMN IF NOT EXISTS allergen_encrypted TEXT;
      ALTER TABLE patient_allergies ADD COLUMN IF NOT EXISTS allergen_iv VARCHAR(255);
      ALTER TABLE patient_allergies ADD COLUMN IF NOT EXISTS allergen_tag VARCHAR(255);
      ALTER TABLE patient_allergies ADD COLUMN IF NOT EXISTS allergen_type VARCHAR(50);
      ALTER TABLE patient_allergies ADD COLUMN IF NOT EXISTS reaction_encrypted TEXT;
      ALTER TABLE patient_allergies ADD COLUMN IF NOT EXISTS reaction_iv VARCHAR(255);
      ALTER TABLE patient_allergies ADD COLUMN IF NOT EXISTS reaction_tag VARCHAR(255);
      ALTER TABLE patient_allergies ADD COLUMN IF NOT EXISTS source VARCHAR(50);
      ALTER TABLE patient_allergies ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES users(id);
      ALTER TABLE patient_allergies ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();
      ALTER TABLE patient_allergies ADD COLUMN IF NOT EXISTS verified_by UUID REFERENCES users(id);
      ALTER TABLE patient_allergies ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ;
      ALTER TABLE patient_allergies ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE;
      ALTER TABLE patient_allergies ADD COLUMN IF NOT EXISTS inactivated_at TIMESTAMPTZ;
      ALTER TABLE patient_allergies ADD COLUMN IF NOT EXISTS inactivated_by UUID REFERENCES users(id);
      ALTER TABLE patient_allergies ADD COLUMN IF NOT EXISTS inactivation_reason TEXT;

      -- =====================================================
      -- ALIGN patient_problems to encrypted format used by services
      -- =====================================================
      ALTER TABLE patient_problems ADD COLUMN IF NOT EXISTS encounter_id UUID REFERENCES clinical_encounters(id) ON DELETE SET NULL;
      ALTER TABLE patient_problems ADD COLUMN IF NOT EXISTS icd10_code VARCHAR(20);
      ALTER TABLE patient_problems ADD COLUMN IF NOT EXISTS icd10_description VARCHAR(255);
      ALTER TABLE patient_problems ADD COLUMN IF NOT EXISTS problem_description_encrypted TEXT;
      ALTER TABLE patient_problems ADD COLUMN IF NOT EXISTS problem_description_iv VARCHAR(255);
      ALTER TABLE patient_problems ADD COLUMN IF NOT EXISTS problem_description_tag VARCHAR(255);
      ALTER TABLE patient_problems ADD COLUMN IF NOT EXISTS problem_type VARCHAR(50) DEFAULT 'chronic';
      ALTER TABLE patient_problems ADD COLUMN IF NOT EXISTS priority VARCHAR(20) DEFAULT 'secondary';
      ALTER TABLE patient_problems ADD COLUMN IF NOT EXISTS documented_by UUID REFERENCES users(id);
      ALTER TABLE patient_problems ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();
      ALTER TABLE patient_problems ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE;

      CREATE INDEX IF NOT EXISTS idx_patient_problems_active ON patient_problems(patient_id, is_active);
      CREATE INDEX IF NOT EXISTS idx_patient_problems_encounter_id ON patient_problems(encounter_id);

      -- =====================================================
      -- ALIGN patient_medications to encrypted format used by services
      -- =====================================================
      ALTER TABLE patient_medications ADD COLUMN IF NOT EXISTS medication_name_encrypted TEXT;
      ALTER TABLE patient_medications ADD COLUMN IF NOT EXISTS medication_name_iv VARCHAR(255);
      ALTER TABLE patient_medications ADD COLUMN IF NOT EXISTS medication_name_tag VARCHAR(255);
      ALTER TABLE patient_medications ADD COLUMN IF NOT EXISTS dosage_encrypted TEXT;
      ALTER TABLE patient_medications ADD COLUMN IF NOT EXISTS dosage_iv VARCHAR(255);
      ALTER TABLE patient_medications ADD COLUMN IF NOT EXISTS dosage_tag VARCHAR(255);
      ALTER TABLE patient_medications ADD COLUMN IF NOT EXISTS medication_type VARCHAR(50) DEFAULT 'prescription';
      ALTER TABLE patient_medications ADD COLUMN IF NOT EXISTS is_prn BOOLEAN DEFAULT FALSE;
      ALTER TABLE patient_medications ADD COLUMN IF NOT EXISTS source VARCHAR(50);
      ALTER TABLE patient_medications ADD COLUMN IF NOT EXISTS prescriber_name VARCHAR(255);
      ALTER TABLE patient_medications ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES users(id);
      ALTER TABLE patient_medications ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();
      ALTER TABLE patient_medications ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE;
      ALTER TABLE patient_medications ADD COLUMN IF NOT EXISTS discontinued_at TIMESTAMPTZ;
      ALTER TABLE patient_medications ADD COLUMN IF NOT EXISTS discontinued_by UUID REFERENCES users(id);
      ALTER TABLE patient_medications ADD COLUMN IF NOT EXISTS discontinuation_reason TEXT;

      CREATE INDEX IF NOT EXISTS idx_patient_medications_active ON patient_medications(patient_id, is_active);

      -- =====================================================
      -- ALIGN clinical_encounters to service expectations
      -- =====================================================
      ALTER TABLE clinical_encounters ADD COLUMN IF NOT EXISTS patient_state CHAR(2);
      ALTER TABLE clinical_encounters ADD COLUMN IF NOT EXISTS patient_location_verified BOOLEAN DEFAULT FALSE;
      ALTER TABLE clinical_encounters ADD COLUMN IF NOT EXISTS patient_location_method VARCHAR(50) DEFAULT 'self_reported';
      ALTER TABLE clinical_encounters ADD COLUMN IF NOT EXISTS provider_state CHAR(2);
      ALTER TABLE clinical_encounters ADD COLUMN IF NOT EXISTS encounter_start TIMESTAMPTZ;
      ALTER TABLE clinical_encounters ADD COLUMN IF NOT EXISTS encounter_end TIMESTAMPTZ;
      ALTER TABLE clinical_encounters ADD COLUMN IF NOT EXISTS chief_complaint_encrypted TEXT;
      ALTER TABLE clinical_encounters ADD COLUMN IF NOT EXISTS chief_complaint_iv VARCHAR(255);
      ALTER TABLE clinical_encounters ADD COLUMN IF NOT EXISTS chief_complaint_tag VARCHAR(255);
      ALTER TABLE clinical_encounters ADD COLUMN IF NOT EXISTS telehealth_consent_id UUID REFERENCES telehealth_consents(id) ON DELETE SET NULL;

      -- Drop restrictive status check if present and replace with expanded one
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'clinical_encounters_status_check') THEN
          ALTER TABLE clinical_encounters DROP CONSTRAINT clinical_encounters_status_check;
        END IF;
      END $$;

      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'clinical_encounters_status_check_v2') THEN
          ALTER TABLE clinical_encounters
            ADD CONSTRAINT clinical_encounters_status_check_v2
            CHECK (status IN ('in_progress', 'completed', 'signed', 'amended', 'finalized', 'cancelled'));
        END IF;
      END $$;

      -- =====================================================
      -- ALIGN clinical_notes to service expectations (append-only + amendments)
      -- =====================================================
      ALTER TABLE clinical_notes ADD COLUMN IF NOT EXISTS patient_id UUID REFERENCES users(id) ON DELETE SET NULL;
      ALTER TABLE clinical_notes ADD COLUMN IF NOT EXISTS provider_id UUID REFERENCES users(id) ON DELETE SET NULL;
      ALTER TABLE clinical_notes ADD COLUMN IF NOT EXISTS version INTEGER DEFAULT 1;
      ALTER TABLE clinical_notes ADD COLUMN IF NOT EXISTS parent_note_id UUID REFERENCES clinical_notes(id) ON DELETE SET NULL;
      ALTER TABLE clinical_notes ADD COLUMN IF NOT EXISTS is_amendment BOOLEAN DEFAULT FALSE;
      ALTER TABLE clinical_notes ADD COLUMN IF NOT EXISTS amendment_reason TEXT;

      ALTER TABLE clinical_notes ADD COLUMN IF NOT EXISTS subjective_encrypted TEXT;
      ALTER TABLE clinical_notes ADD COLUMN IF NOT EXISTS subjective_iv VARCHAR(255);
      ALTER TABLE clinical_notes ADD COLUMN IF NOT EXISTS subjective_tag VARCHAR(255);
      ALTER TABLE clinical_notes ADD COLUMN IF NOT EXISTS objective_encrypted TEXT;
      ALTER TABLE clinical_notes ADD COLUMN IF NOT EXISTS objective_iv VARCHAR(255);
      ALTER TABLE clinical_notes ADD COLUMN IF NOT EXISTS objective_tag VARCHAR(255);
      ALTER TABLE clinical_notes ADD COLUMN IF NOT EXISTS assessment_encrypted TEXT;
      ALTER TABLE clinical_notes ADD COLUMN IF NOT EXISTS assessment_iv VARCHAR(255);
      ALTER TABLE clinical_notes ADD COLUMN IF NOT EXISTS assessment_tag VARCHAR(255);
      ALTER TABLE clinical_notes ADD COLUMN IF NOT EXISTS plan_encrypted TEXT;
      ALTER TABLE clinical_notes ADD COLUMN IF NOT EXISTS plan_iv VARCHAR(255);
      ALTER TABLE clinical_notes ADD COLUMN IF NOT EXISTS plan_tag VARCHAR(255);
      ALTER TABLE clinical_notes ADD COLUMN IF NOT EXISTS vitals_encrypted TEXT;
      ALTER TABLE clinical_notes ADD COLUMN IF NOT EXISTS vitals_iv VARCHAR(255);
      ALTER TABLE clinical_notes ADD COLUMN IF NOT EXISTS vitals_tag VARCHAR(255);
      ALTER TABLE clinical_notes ADD COLUMN IF NOT EXISTS physical_exam_encrypted TEXT;
      ALTER TABLE clinical_notes ADD COLUMN IF NOT EXISTS physical_exam_iv VARCHAR(255);
      ALTER TABLE clinical_notes ADD COLUMN IF NOT EXISTS physical_exam_tag VARCHAR(255);

      ALTER TABLE clinical_notes ADD COLUMN IF NOT EXISTS icd_codes TEXT[];
      ALTER TABLE clinical_notes ADD COLUMN IF NOT EXISTS cpt_codes TEXT[];
      ALTER TABLE clinical_notes ADD COLUMN IF NOT EXISTS follow_up_required BOOLEAN DEFAULT FALSE;
      ALTER TABLE clinical_notes ADD COLUMN IF NOT EXISTS follow_up_interval VARCHAR(100);
      ALTER TABLE clinical_notes ADD COLUMN IF NOT EXISTS follow_up_notes TEXT;

      ALTER TABLE clinical_notes ADD COLUMN IF NOT EXISTS is_signed BOOLEAN DEFAULT FALSE;
      ALTER TABLE clinical_notes ADD COLUMN IF NOT EXISTS signed_at TIMESTAMPTZ;
      ALTER TABLE clinical_notes ADD COLUMN IF NOT EXISTS signature_hash TEXT;
      ALTER TABLE clinical_notes ADD COLUMN IF NOT EXISTS is_locked BOOLEAN DEFAULT FALSE;
      ALTER TABLE clinical_notes ADD COLUMN IF NOT EXISTS locked_at TIMESTAMPTZ;
      ALTER TABLE clinical_notes ADD COLUMN IF NOT EXISTS locked_reason TEXT;

      CREATE INDEX IF NOT EXISTS idx_clinical_notes_encounter_version ON clinical_notes(encounter_id, version DESC);
      CREATE INDEX IF NOT EXISTS idx_clinical_notes_patient_id ON clinical_notes(patient_id);
      CREATE INDEX IF NOT EXISTS idx_clinical_notes_provider_id ON clinical_notes(provider_id);
      CREATE INDEX IF NOT EXISTS idx_clinical_notes_signed ON clinical_notes(is_signed) WHERE is_signed = true;

      -- =====================================================
      -- TELEHEALTH CONSENT TEMPLATES + CONSENT CAPTURE (versioned)
      -- =====================================================
      CREATE TABLE IF NOT EXISTS telehealth_consent_templates (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        version VARCHAR(50) NOT NULL,
        title VARCHAR(255) NOT NULL,
        content_html TEXT,
        content_plain TEXT,
        applicable_states TEXT[],
        effective_date DATE NOT NULL DEFAULT CURRENT_DATE,
        expiry_date DATE,
        is_active BOOLEAN DEFAULT TRUE,
        created_by UUID REFERENCES users(id),
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_telehealth_consent_templates_active ON telehealth_consent_templates(is_active) WHERE is_active = true;
      CREATE INDEX IF NOT EXISTS idx_telehealth_consent_templates_effective ON telehealth_consent_templates(effective_date DESC);

      DROP TRIGGER IF EXISTS update_telehealth_consent_templates_updated_at ON telehealth_consent_templates;
      CREATE TRIGGER update_telehealth_consent_templates_updated_at
        BEFORE UPDATE ON telehealth_consent_templates
        FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

      ALTER TABLE telehealth_consents ADD COLUMN IF NOT EXISTS template_id UUID REFERENCES telehealth_consent_templates(id) ON DELETE SET NULL;
      ALTER TABLE telehealth_consents ADD COLUMN IF NOT EXISTS template_version VARCHAR(50);
      ALTER TABLE telehealth_consents ADD COLUMN IF NOT EXISTS consent_method VARCHAR(50);
      ALTER TABLE telehealth_consents ADD COLUMN IF NOT EXISTS patient_state CHAR(2);
      ALTER TABLE telehealth_consents ADD COLUMN IF NOT EXISTS signature_data_encrypted TEXT;
      ALTER TABLE telehealth_consents ADD COLUMN IF NOT EXISTS signature_data_iv VARCHAR(255);
      ALTER TABLE telehealth_consents ADD COLUMN IF NOT EXISTS signature_data_tag VARCHAR(255);
      ALTER TABLE telehealth_consents ADD COLUMN IF NOT EXISTS consent_captured_at TIMESTAMPTZ DEFAULT NOW();
      ALTER TABLE telehealth_consents ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;
      ALTER TABLE telehealth_consents ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ;
      ALTER TABLE telehealth_consents ADD COLUMN IF NOT EXISTS revoked_reason TEXT;
      ALTER TABLE telehealth_consents ADD COLUMN IF NOT EXISTS witness_name VARCHAR(255);
      ALTER TABLE telehealth_consents ADD COLUMN IF NOT EXISTS witness_id UUID REFERENCES users(id) ON DELETE SET NULL;

      CREATE INDEX IF NOT EXISTS idx_telehealth_consents_patient_state ON telehealth_consents(patient_id, patient_state);
      CREATE INDEX IF NOT EXISTS idx_telehealth_consents_valid ON telehealth_consents(is_valid) WHERE is_valid = true;

      -- =====================================================
      -- PRESCRIPTION INTENTS (external eRx handoff only; no internal transmission)
      -- =====================================================
      CREATE TABLE IF NOT EXISTS prescription_intents (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        encounter_id UUID NOT NULL REFERENCES clinical_encounters(id) ON DELETE CASCADE,
        patient_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        provider_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

        medication_name VARCHAR(255) NOT NULL,
        generic_name VARCHAR(255),
        dosage_strength VARCHAR(100) NOT NULL,
        dosage_form VARCHAR(100) NOT NULL,
        route VARCHAR(100) DEFAULT 'oral',
        quantity INTEGER NOT NULL,
        days_supply INTEGER NOT NULL,
        refills_authorized INTEGER DEFAULT 0,

        indication TEXT NOT NULL,
        indication_icd10 VARCHAR(20),

        rationale_encrypted TEXT,
        rationale_iv VARCHAR(255),
        rationale_tag VARCHAR(255),

        sig_directions TEXT NOT NULL,
        patient_instructions TEXT,

        pharmacy_name VARCHAR(255),
        pharmacy_npi VARCHAR(50),
        pharmacy_address TEXT,

        is_controlled BOOLEAN DEFAULT FALSE,
        schedule_class VARCHAR(20),

        status VARCHAR(50) NOT NULL DEFAULT 'draft',

        external_erx_system VARCHAR(50),
        external_erx_id VARCHAR(255),
        external_erx_status VARCHAR(50),
        external_erx_sent_at TIMESTAMPTZ,
        external_erx_status_updated_at TIMESTAMPTZ,

        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_prescription_intents_encounter_id ON prescription_intents(encounter_id);
      CREATE INDEX IF NOT EXISTS idx_prescription_intents_patient_id ON prescription_intents(patient_id);
      CREATE INDEX IF NOT EXISTS idx_prescription_intents_provider_id ON prescription_intents(provider_id);
      CREATE INDEX IF NOT EXISTS idx_prescription_intents_status ON prescription_intents(status);
      CREATE INDEX IF NOT EXISTS idx_prescription_intents_created_at ON prescription_intents(created_at DESC);

      DROP TRIGGER IF EXISTS update_prescription_intents_updated_at ON prescription_intents;
      CREATE TRIGGER update_prescription_intents_updated_at
        BEFORE UPDATE ON prescription_intents
        FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    `
  },

  // Migration 030: Testing Access Links (time-limited bypass for demos)
  {
    name: '030_testing_access_links',
    up: `
      -- =====================================================
      -- TESTING ACCESS LINKS - Time-limited demo access tokens
      -- Allows providers/patients to bypass payment for testing
      -- =====================================================
      CREATE TABLE IF NOT EXISTS testing_access_links (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        token VARCHAR(64) NOT NULL UNIQUE,
        link_type VARCHAR(20) NOT NULL CHECK (link_type IN ('provider', 'patient')),
        label VARCHAR(255),
        description TEXT,
        
        -- Access control
        max_uses INTEGER DEFAULT 1,
        current_uses INTEGER DEFAULT 0,
        expires_at TIMESTAMPTZ NOT NULL,
        is_active BOOLEAN DEFAULT TRUE,
        
        -- What this link bypasses
        bypass_payment BOOLEAN DEFAULT TRUE,
        bypass_subscription BOOLEAN DEFAULT TRUE,
        grant_tier VARCHAR(50) DEFAULT 'gold',
        
        -- Tracking
        created_by UUID REFERENCES users(id) ON DELETE SET NULL,
        last_used_at TIMESTAMPTZ,
        last_used_by UUID REFERENCES users(id) ON DELETE SET NULL,
        
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_testing_access_links_token ON testing_access_links(token);
      CREATE INDEX IF NOT EXISTS idx_testing_access_links_type ON testing_access_links(link_type);
      CREATE INDEX IF NOT EXISTS idx_testing_access_links_active ON testing_access_links(is_active) WHERE is_active = true;
      CREATE INDEX IF NOT EXISTS idx_testing_access_links_expires ON testing_access_links(expires_at);

      DROP TRIGGER IF EXISTS update_testing_access_links_updated_at ON testing_access_links;
      CREATE TRIGGER update_testing_access_links_updated_at
        BEFORE UPDATE ON testing_access_links
        FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

      -- Track which users were created/activated via testing links
      CREATE TABLE IF NOT EXISTS testing_link_activations (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        link_id UUID NOT NULL REFERENCES testing_access_links(id) ON DELETE CASCADE,
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        activated_at TIMESTAMPTZ DEFAULT NOW(),
        ip_address VARCHAR(45),
        user_agent TEXT,
        bypass_expires_at TIMESTAMPTZ,
        UNIQUE(link_id, user_id)
      );

      CREATE INDEX IF NOT EXISTS idx_testing_link_activations_link ON testing_link_activations(link_id);
      CREATE INDEX IF NOT EXISTS idx_testing_link_activations_user ON testing_link_activations(user_id);
      CREATE INDEX IF NOT EXISTS idx_testing_link_activations_expires ON testing_link_activations(bypass_expires_at);

      -- Add testing_bypass flag to users table
      ALTER TABLE users ADD COLUMN IF NOT EXISTS testing_bypass_active BOOLEAN DEFAULT FALSE;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS testing_bypass_expires_at TIMESTAMPTZ;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS testing_bypass_tier VARCHAR(50);
    `
  },

  // Migration 031: Agent Chat Uploads (files for analysis)
  {
    name: '031_agent_chat_uploads',
    up: `
      CREATE TABLE IF NOT EXISTS ai_chat_messages (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        conversation_id UUID NOT NULL DEFAULT gen_random_uuid(),
        sender_type VARCHAR(20) NOT NULL CHECK (sender_type IN ('operator', 'agent', 'system')),
        sender_id VARCHAR(100) NOT NULL,
        sender_name VARCHAR(200) NOT NULL,
        recipient_type VARCHAR(20) NOT NULL CHECK (recipient_type IN ('operator', 'agent', 'all', 'group')),
        recipient_id VARCHAR(100),
        content TEXT NOT NULL,
        message_type VARCHAR(30) DEFAULT 'text' CHECK (message_type IN ('text', 'report', 'alert', 'request', 'approval', 'result', 'credential_request')),
        metadata JSONB DEFAULT '{}',
        read_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_chat_messages_conversation ON ai_chat_messages(conversation_id);
      CREATE INDEX IF NOT EXISTS idx_chat_messages_sender ON ai_chat_messages(sender_type, sender_id);
      CREATE INDEX IF NOT EXISTS idx_chat_messages_recipient ON ai_chat_messages(recipient_type, recipient_id);
      CREATE INDEX IF NOT EXISTS idx_chat_messages_created ON ai_chat_messages(created_at DESC);

      CREATE TABLE IF NOT EXISTS ai_uploaded_files (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        uploader_id UUID,
        original_name TEXT NOT NULL,
        stored_name TEXT NOT NULL,
        mime_type VARCHAR(200) NOT NULL,
        size_bytes BIGINT NOT NULL DEFAULT 0,
        sha256 VARCHAR(64) NOT NULL,
        storage_path TEXT NOT NULL,
        extracted_text TEXT,
        extraction_status VARCHAR(30) DEFAULT 'pending' CHECK (extraction_status IN ('pending', 'extracted', 'skipped', 'failed')),
        extraction_error TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_uploaded_files_created ON ai_uploaded_files(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_uploaded_files_sha ON ai_uploaded_files(sha256);

      CREATE TABLE IF NOT EXISTS ai_chat_message_attachments (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        message_id UUID NOT NULL REFERENCES ai_chat_messages(id) ON DELETE CASCADE,
        file_id UUID NOT NULL REFERENCES ai_uploaded_files(id) ON DELETE CASCADE,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE (message_id, file_id)
      );

      CREATE INDEX IF NOT EXISTS idx_chat_attachments_message ON ai_chat_message_attachments(message_id);
      CREATE INDEX IF NOT EXISTS idx_chat_attachments_file ON ai_chat_message_attachments(file_id);
    `
  },

  // Migration 032: Market-scoped admin test accounts and testing links
  {
    name: '032_market_scoped_admin_testing',
    up: `
      DO $$ BEGIN
        CREATE TYPE region_code AS ENUM ('US', 'NG', 'GH', 'KE', 'ZA');
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;

      ALTER TABLE users ADD COLUMN IF NOT EXISTS region region_code DEFAULT 'US';
      ALTER TABLE users ADD COLUMN IF NOT EXISTS market_scope VARCHAR(10) DEFAULT 'US';
      ALTER TABLE users ADD COLUMN IF NOT EXISTS test_account_metadata JSONB DEFAULT '{}'::jsonb;

      UPDATE users
         SET market_scope = CASE
           WHEN region::text = 'NG' OR UPPER(COALESCE(country, '')) IN ('NG', 'NIGERIA') THEN 'NG'
           ELSE COALESCE(NULLIF(market_scope, ''), 'US')
         END
       WHERE market_scope IS NULL OR market_scope = '';

      CREATE INDEX IF NOT EXISTS idx_users_market_scope ON users(market_scope);
      CREATE INDEX IF NOT EXISTS idx_users_role_market_scope ON users(role, market_scope);

      ALTER TABLE testing_access_links ADD COLUMN IF NOT EXISTS market_scope VARCHAR(10) DEFAULT 'US';
      UPDATE testing_access_links SET market_scope = 'US' WHERE market_scope IS NULL OR market_scope = '';
      CREATE INDEX IF NOT EXISTS idx_testing_access_links_market_scope ON testing_access_links(market_scope);
      CREATE INDEX IF NOT EXISTS idx_testing_access_links_type_market_scope ON testing_access_links(link_type, market_scope);

      ALTER TABLE invitations ADD COLUMN IF NOT EXISTS market_scope VARCHAR(10) DEFAULT 'US';
      UPDATE invitations SET market_scope = 'US' WHERE market_scope IS NULL OR market_scope = '';
      CREATE INDEX IF NOT EXISTS idx_invitations_market_scope ON invitations(market_scope);
      CREATE INDEX IF NOT EXISTS idx_invitations_email_role_market_scope ON invitations(email, role, market_scope);
    `
  },
  {
    name: '033_market_scoped_invitations',
    up: `
      ALTER TABLE invitations ADD COLUMN IF NOT EXISTS market_scope VARCHAR(10) DEFAULT 'US';
      UPDATE invitations SET market_scope = 'US' WHERE market_scope IS NULL OR market_scope = '';
      CREATE INDEX IF NOT EXISTS idx_invitations_market_scope ON invitations(market_scope);
      CREATE INDEX IF NOT EXISTS idx_invitations_email_role_market_scope ON invitations(email, role, market_scope);
    `
  },
  {
    name: '034_users_ng_whatsapp_location_consent',
    up: `
      ALTER TABLE users ADD COLUMN IF NOT EXISTS whatsapp_number VARCHAR(40);
      ALTER TABLE users ADD COLUMN IF NOT EXISTS whatsapp_consent_service_updates BOOLEAN DEFAULT FALSE;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS whatsapp_consent_service_updates_at TIMESTAMPTZ;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS whatsapp_consent_marketing BOOLEAN DEFAULT FALSE;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS whatsapp_consent_marketing_at TIMESTAMPTZ;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS location_permission_status VARCHAR(30) DEFAULT 'not_requested';
      ALTER TABLE users ADD COLUMN IF NOT EXISTS location_latitude DOUBLE PRECISION;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS location_longitude DOUBLE PRECISION;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS location_accuracy DOUBLE PRECISION;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS location_captured_at TIMESTAMPTZ;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS manual_country VARCHAR(100);
      ALTER TABLE users ADD COLUMN IF NOT EXISTS manual_state VARCHAR(100);
      ALTER TABLE users ADD COLUMN IF NOT EXISTS manual_city VARCHAR(100);
      ALTER TABLE users ADD COLUMN IF NOT EXISTS manual_lga VARCHAR(100);
      ALTER TABLE users ADD COLUMN IF NOT EXISTS manual_area VARCHAR(150);
      ALTER TABLE users ADD COLUMN IF NOT EXISTS manual_address VARCHAR(255);
      ALTER TABLE users ADD COLUMN IF NOT EXISTS manual_landmark VARCHAR(255);
      ALTER TABLE users ADD COLUMN IF NOT EXISTS provider_service_radius_km NUMERIC(6,2);
      ALTER TABLE users ADD COLUMN IF NOT EXISTS pharmacy_delivery_available BOOLEAN DEFAULT FALSE;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS pharmacy_pickup_available BOOLEAN DEFAULT FALSE;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS lab_home_sample_collection_available BOOLEAN DEFAULT FALSE;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS public_address_visible BOOLEAN DEFAULT FALSE;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS onboarding_contact_metadata JSONB DEFAULT '{}'::jsonb;

      CREATE INDEX IF NOT EXISTS idx_users_whatsapp_number ON users(whatsapp_number) WHERE whatsapp_number IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_users_location_permission_status ON users(location_permission_status);
      CREATE INDEX IF NOT EXISTS idx_users_manual_ng_location ON users(manual_state, manual_city, manual_lga);
      CREATE INDEX IF NOT EXISTS idx_users_ng_provider_service_radius ON users(provider_service_radius_km) WHERE provider_service_radius_km IS NOT NULL;
    `
  },
  {
    name: '035_harden_testing_access_lifecycle',
    up: `
      ALTER TABLE testing_access_links ADD COLUMN IF NOT EXISTS status VARCHAR(30) DEFAULT 'active';
      ALTER TABLE testing_access_links ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ;
      ALTER TABLE testing_access_links ADD COLUMN IF NOT EXISTS revoked_by UUID REFERENCES users(id) ON DELETE SET NULL;
      ALTER TABLE testing_access_links ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
      ALTER TABLE testing_access_links ADD COLUMN IF NOT EXISTS deleted_by UUID REFERENCES users(id) ON DELETE SET NULL;

      DO $$ BEGIN
        IF EXISTS (
          SELECT 1
            FROM pg_constraint
           WHERE conname = 'testing_access_links_link_type_check'
             AND conrelid = 'testing_access_links'::regclass
        ) THEN
          ALTER TABLE testing_access_links DROP CONSTRAINT testing_access_links_link_type_check;
        END IF;
      END $$;

      ALTER TABLE testing_access_links
        ADD CONSTRAINT testing_access_links_link_type_check
        CHECK (link_type IN ('provider', 'patient', 'pharmacy', 'admin'));

      UPDATE testing_access_links
         SET status = CASE
           WHEN deleted_at IS NOT NULL THEN 'deleted'
           WHEN revoked_at IS NOT NULL OR is_active = FALSE THEN 'revoked'
           WHEN expires_at <= NOW() THEN 'expired'
           WHEN max_uses IS NOT NULL AND current_uses >= max_uses THEN 'used'
           ELSE COALESCE(NULLIF(status, ''), 'active')
         END;

      CREATE INDEX IF NOT EXISTS idx_testing_access_links_status ON testing_access_links(status);
      CREATE INDEX IF NOT EXISTS idx_testing_access_links_deleted_at ON testing_access_links(deleted_at);
      CREATE INDEX IF NOT EXISTS idx_testing_access_links_created_by ON testing_access_links(created_by);
      CREATE INDEX IF NOT EXISTS idx_testing_access_links_last_used_by ON testing_access_links(last_used_by);
    `
  }
];

const SQL_FILE_MIGRATIONS = [
  {
    name: '400_agent_orchestrator_schema',
    file: '400_agent_orchestrator_schema.sql'
  }
];

function loadSqlFileMigrations(migrationsDir = path.join(__dirname, 'migrations')) {
  return SQL_FILE_MIGRATIONS.map((migration) => ({
    name: migration.name,
    up: fs.readFileSync(path.join(migrationsDir, migration.file), 'utf8')
  }));
}

function getMigrations() {
  return [
    ...migrations,
    ...loadSqlFileMigrations()
  ];
}

async function runMigrations(options = {}) {
  const migrationList = options.migrations || getMigrations();
  const client = await pool.connect();
  
  try {
    console.log('🚀 Starting database migrations...\n');
    
    // Create migrations tracking table first
    await client.query(`
      CREATE TABLE IF NOT EXISTS migrations (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL UNIQUE,
        executed_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);
    
    // Get already executed migrations
    const { rows: executedMigrations } = await client.query(
      'SELECT name FROM migrations'
    );
    const executedNames = new Set(executedMigrations.map(m => m.name));
    
    let migrationsRun = 0;
    
    for (const migration of migrationList) {
      if (executedNames.has(migration.name)) {
        console.log(`⏭️  Skipping ${migration.name} (already executed)`);
        continue;
      }
      
      console.log(`📦 Running migration: ${migration.name}`);
      
      await client.query('BEGIN');
      
      try {
        await client.query(migration.up);
        await client.query(
          'INSERT INTO migrations (name) VALUES ($1)',
          [migration.name]
        );
        await client.query('COMMIT');
        console.log(`✅ Completed: ${migration.name}\n`);
        migrationsRun++;
      } catch (error) {
        await client.query('ROLLBACK');
        console.error(`❌ Failed: ${migration.name}`);
        console.error(`   Error: ${error.message}\n`);
        throw error;
      }
    }

    console.log('==========================================');
    console.log(`✅ Migrations complete! (${migrationsRun} new migrations run)`);
    console.log('==========================================\n');

  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

if (require.main === module) {
  runMigrations();
}

module.exports = {
  migrations,
  SQL_FILE_MIGRATIONS,
  loadSqlFileMigrations,
  getMigrations,
  runMigrations,
};

