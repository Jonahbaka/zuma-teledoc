-- Video Sessions Table removed - video calling implementation deleted

-- Patient Insurance Documents Table
CREATE TABLE IF NOT EXISTS patient_insurance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  insurance_provider VARCHAR(255) NOT NULL,
  policy_number VARCHAR(100) NOT NULL,
  group_number VARCHAR(100),
  subscriber_name VARCHAR(255),
  subscriber_dob DATE,
  relationship_to_subscriber VARCHAR(50) DEFAULT 'self',
  front_image_url TEXT,
  back_image_url TEXT,
  is_primary BOOLEAN DEFAULT true,
  is_verified BOOLEAN DEFAULT false,
  verified_at TIMESTAMPTZ,
  verified_by UUID REFERENCES users(id),
  effective_date DATE,
  expiration_date DATE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Appointment Documents Table (for visit-specific uploads)
CREATE TABLE IF NOT EXISTS appointment_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  appointment_id UUID NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
  patient_id UUID NOT NULL REFERENCES users(id),
  document_type VARCHAR(50) NOT NULL CHECK (document_type IN ('insurance_front', 'insurance_back', 'id_front', 'id_back', 'referral', 'prior_auth', 'lab_results', 'imaging', 'other')),
  file_name VARCHAR(255) NOT NULL,
  file_url TEXT NOT NULL,
  file_size INTEGER,
  mime_type VARCHAR(100),
  notes TEXT,
  uploaded_at TIMESTAMPTZ DEFAULT NOW()
);

-- Waiting Room Queue Table removed - waiting room implementation deleted

-- Indexes
-- Video sessions indexes removed - video calling implementation deleted
CREATE INDEX IF NOT EXISTS idx_patient_insurance_patient ON patient_insurance(patient_id);
CREATE INDEX IF NOT EXISTS idx_appointment_documents_appointment ON appointment_documents(appointment_id);
-- Waiting room indexes removed - waiting room implementation deleted




