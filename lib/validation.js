/**
 * Zod Validation Schemas
 * Strict input validation for all API endpoints
 */

const { z } = require('zod');

// Common validation patterns
const emailSchema = z.string().email('Invalid email address').toLowerCase().trim();
const passwordSchema = z.string()
  .min(8, 'Password must be at least 8 characters')
  .max(128, 'Password too long')
  .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
  .regex(/[a-z]/, 'Password must contain at least one lowercase letter')
  .regex(/[0-9]/, 'Password must contain at least one number')
  .regex(/[^A-Za-z0-9]/, 'Password must contain at least one special character');

const uuidSchema = z.string().uuid('Invalid ID format');
const phoneSchema = z.string()
  .regex(/^\+?[1-9]\d{1,14}$/, 'Invalid phone number')
  .optional()
  .nullable();

const dateSchema = z.string().refine((val) => !isNaN(Date.parse(val)), {
  message: 'Invalid date format'
});

// User schemas
const userRoleSchema = z.enum(['patient', 'provider', 'admin']);

const registerSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  confirmPassword: z.string(),
  firstName: z.string().min(1, 'First name is required').max(100).trim(),
  lastName: z.string().min(1, 'Last name is required').max(100).trim(),
  role: userRoleSchema.default('patient'),
  dateOfBirth: dateSchema.optional(),
  phone: phoneSchema,
  // Provider-specific fields
  licenseNumber: z.string().max(100).optional(),
  licenseState: z.string().max(50).optional(),
  specialty: z.string().max(100).optional(),
  npiNumber: z.string().max(20).optional(),
  credentials: z.string().max(50).optional(),
  // Consent
  hipaaConsent: z.boolean().refine(val => val === true, {
    message: 'HIPAA consent is required'
  }),
  termsAccepted: z.boolean().refine(val => val === true, {
    message: 'Terms acceptance is required'
  })
}).refine(data => data.password === data.confirmPassword, {
  message: 'Passwords do not match',
  path: ['confirmPassword']
});

const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Password is required'),
  mfaCode: z.string().length(6).optional().nullable(),
  // Optional role for disambiguation when multiple accounts share the same email
  role: z.enum(['patient', 'provider', 'admin', 'super_admin']).optional()
}).transform(data => ({
  ...data,
  mfaCode: data.mfaCode || undefined  // Convert null/empty to undefined
}));

const updateProfileSchema = z.object({
  firstName: z.string().min(1).max(100).trim().optional(),
  lastName: z.string().min(1).max(100).trim().optional(),
  phone: phoneSchema,
  dateOfBirth: dateSchema.optional(),
  addressLine1: z.string().max(255).optional(),
  addressLine2: z.string().max(255).optional(),
  city: z.string().max(100).optional(),
  state: z.string().max(50).optional(),
  zipCode: z.string().max(20).optional(),
  // Provider fields
  bio: z.string().max(2000).optional(),
  specialty: z.string().max(100).optional()
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required'),
  newPassword: passwordSchema,
  confirmNewPassword: z.string()
}).refine(data => data.newPassword === data.confirmNewPassword, {
  message: 'New passwords do not match',
  path: ['confirmNewPassword']
});

// Appointment schemas
const appointmentStatusSchema = z.enum([
  'scheduled', 'confirmed', 'in_progress', 'completed', 'cancelled', 'no_show'
]);

const createAppointmentSchema = z.object({
  providerId: uuidSchema,
  scheduledAt: dateSchema,
  durationMinutes: z.number().int().min(15).max(120).default(30),
  type: z.enum(['video', 'phone', 'in_person']).default('video'),
  reasonForVisit: z.string().max(1000).optional(),
  patientNotes: z.string().max(2000).optional()
});

const updateAppointmentSchema = z.object({
  status: appointmentStatusSchema.optional(),
  scheduledAt: dateSchema.optional(),
  providerNotes: z.string().max(2000).optional(),
  cancellationReason: z.string().max(500).optional()
});

// Medical record schemas
const recordTypeSchema = z.enum([
  'lab_result', 'imaging', 'prescription', 'note', 'referral', 
  'immunization', 'allergy', 'condition', 'procedure', 'document'
]);

const createMedicalRecordSchema = z.object({
  patientId: uuidSchema,
  appointmentId: uuidSchema.optional(),
  recordType: recordTypeSchema,
  title: z.string().min(1).max(255),
  content: z.string().min(1),
  fileName: z.string().max(255).optional(),
  fileType: z.string().max(100).optional(),
  fileSize: z.number().int().positive().optional(),
  isSensitive: z.boolean().default(false),
  accessRestricted: z.boolean().default(false)
});

// Visit / SOAP note schemas
const createVisitSchema = z.object({
  appointmentId: uuidSchema,
  subjective: z.string().optional(),
  objective: z.string().optional(),
  assessment: z.string().optional(),
  plan: z.string().optional(),
  vitals: z.object({
    bloodPressureSystolic: z.number().optional(),
    bloodPressureDiastolic: z.number().optional(),
    heartRate: z.number().optional(),
    temperature: z.number().optional(),
    respiratoryRate: z.number().optional(),
    oxygenSaturation: z.number().optional(),
    weight: z.number().optional(),
    height: z.number().optional()
  }).optional(),
  icdCodes: z.array(z.string()).optional(),
  cptCodes: z.array(z.string()).optional(),
  followUpRequired: z.boolean().default(false),
  followUpNotes: z.string().max(1000).optional()
});

const signVisitSchema = z.object({
  visitId: uuidSchema
});

// Message schemas
const createMessageSchema = z.object({
  recipientId: uuidSchema,
  content: z.string().min(1).max(10000),
  isUrgent: z.boolean().default(false),
  attachmentName: z.string().max(255).optional(),
  attachmentType: z.string().max(100).optional()
});

// Provider schedule schemas
const createScheduleSchema = z.object({
  dayOfWeek: z.number().int().min(0).max(6),
  startTime: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/, 'Invalid time format (HH:MM)'),
  endTime: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/, 'Invalid time format (HH:MM)'),
  slotDurationMinutes: z.number().int().min(15).max(120).default(30),
  bufferMinutes: z.number().int().min(0).max(30).default(5),
  isAvailable: z.boolean().default(true)
});

const createTimeOffSchema = z.object({
  startDatetime: dateSchema,
  endDatetime: dateSchema,
  reason: z.string().max(255).optional(),
  isRecurring: z.boolean().default(false)
});

// Admin schemas
const updateUserStatusSchema = z.object({
  userId: uuidSchema,
  isActive: z.boolean().optional(),
  providerStatus: z.enum(['pending', 'approved', 'suspended', 'rejected']).optional()
});

const createNotificationSchema = z.object({
  userId: uuidSchema.optional(),
  type: z.enum(['appointment', 'message', 'system', 'billing', 'medical']),
  title: z.string().min(1).max(255),
  message: z.string().min(1).max(2000),
  referenceType: z.string().max(50).optional(),
  referenceId: uuidSchema.optional(),
  actionUrl: z.string().max(500).optional(),
  actionText: z.string().max(100).optional(),
  broadcast: z.boolean().default(false),
  targetRole: userRoleSchema.optional()
});

// Subscription schemas
const updateSubscriptionSchema = z.object({
  tier: z.enum(['free', 'gold', 'platinum']),
  stripeCustomerId: z.string().optional(),
  stripeSubscriptionId: z.string().optional()
});

// Search and pagination schemas
const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  sortBy: z.string().optional(),
  sortOrder: z.enum(['asc', 'desc']).default('desc')
});

const searchUsersSchema = paginationSchema.extend({
  query: z.string().optional(),
  role: userRoleSchema.optional(),
  providerStatus: z.enum(['pending', 'approved', 'suspended', 'rejected']).optional(),
  isActive: z.coerce.boolean().optional()
});

const searchAppointmentsSchema = paginationSchema.extend({
  patientId: uuidSchema.optional(),
  providerId: uuidSchema.optional(),
  status: appointmentStatusSchema.optional(),
  startDate: dateSchema.optional(),
  endDate: dateSchema.optional()
});

// MFA schemas
const setupMfaSchema = z.object({
  password: z.string().min(1, 'Password is required to enable MFA')
});

const verifyMfaSchema = z.object({
  code: z.string().length(6, 'MFA code must be 6 digits')
});

const disableMfaSchema = z.object({
  password: z.string().min(1, 'Password is required'),
  code: z.string().length(6, 'MFA code is required')
});

// Password reset schemas
const requestPasswordResetSchema = z.object({
  email: emailSchema,
  // Optional role for disambiguation when multiple accounts share the same email
  role: z.enum(['patient', 'provider', 'admin', 'super_admin']).optional()
});

const resetPasswordSchema = z.object({
  token: z.string().min(1),
  newPassword: passwordSchema,
  confirmPassword: z.string()
}).refine(data => data.newPassword === data.confirmPassword, {
  message: 'Passwords do not match',
  path: ['confirmPassword']
});

/**
 * Validate data against a schema
 * @param {z.ZodSchema} schema - Zod schema
 * @param {Object} data - Data to validate
 * @returns {Object} Validated and transformed data
 * @throws {Error} Validation error with details
 */
function validate(schema, data) {
  const result = schema.safeParse(data);
  
  if (!result.success) {
    const errors = result.error.errors.map(err => ({
      field: err.path.join('.'),
      message: err.message
    }));
    
    const error = new Error('Validation failed');
    error.status = 400;
    error.errors = errors;
    throw error;
  }
  
  return result.data;
}

module.exports = {
  // Validation function
  validate,
  
  // Common schemas
  emailSchema,
  passwordSchema,
  uuidSchema,
  phoneSchema,
  dateSchema,
  
  // User schemas
  userRoleSchema,
  registerSchema,
  loginSchema,
  updateProfileSchema,
  changePasswordSchema,
  
  // Appointment schemas
  appointmentStatusSchema,
  createAppointmentSchema,
  updateAppointmentSchema,
  
  // Medical record schemas
  recordTypeSchema,
  createMedicalRecordSchema,
  
  // Visit schemas
  createVisitSchema,
  signVisitSchema,
  
  // Message schemas
  createMessageSchema,
  
  // Schedule schemas
  createScheduleSchema,
  createTimeOffSchema,
  
  // Admin schemas
  updateUserStatusSchema,
  createNotificationSchema,
  updateSubscriptionSchema,
  
  // Search schemas
  paginationSchema,
  searchUsersSchema,
  searchAppointmentsSchema,
  
  // MFA schemas
  setupMfaSchema,
  verifyMfaSchema,
  disableMfaSchema,
  
  // Password reset schemas
  requestPasswordResetSchema,
  resetPasswordSchema
};

