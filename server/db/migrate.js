/**
 * Database Migration Script
 * Runs all migrations to set up the Docta. production database
 */

require('dotenv').config();
const { Pool } = require('pg');

// Database configuration
let connectionString = process.env.DATABASE_URL || '';
let sslConfig = false;

// Configure SSL for Aiven Cloud
if (connectionString && (connectionString.includes('aivencloud.com') || connectionString.includes('sslmode=require'))) {
  sslConfig = { rejectUnauthorized: false };
  // Remove sslmode=require from connection string
  if (connectionString.includes('sslmode=require')) {
    connectionString = connectionString.replace(/[?&]sslmode=require/, '');
  }
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
        CREATE TYPE user_role AS ENUM ('patient', 'provider', 'admin', 'super_admin');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
      
      -- If enum already exists, add super_admin if it doesn't exist
      DO $$ 
      BEGIN
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
];

async function runMigrations() {
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
    
    for (const migration of migrations) {
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

// Run migrations
runMigrations();

