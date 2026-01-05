/**
 * Provider Credentialing Routes
 * Industry-standard credentialing process for healthcare providers
 */

const express = require('express');
const router = express.Router();
const db = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');
const { validate } = require('../../lib/validation');
const z = require('zod');
const { keysToCamel, keysToSnake } = require('../../lib/utils');
const logger = require('../middleware/logger');
const multer = require('multer');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

// Configure multer for document uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/credentialing/');
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = `${Date.now()}-${uuidv4()}`;
    cb(null, `${uniqueSuffix}${path.extname(file.originalname)}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['application/pdf', 'image/jpeg', 'image/png', 'image/jpg'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only PDF, JPEG, and PNG are allowed.'));
    }
  }
});

// ============================================================================
// CREDENTIALING STEPS CONFIGURATION
// ============================================================================

const CREDENTIALING_STEPS = [
  { number: 1, name: 'Application Fee', key: 'payment' },
  { number: 2, name: 'Personal Information', key: 'personal_info' },
  { number: 3, name: 'Professional Information', key: 'professional_info' },
  { number: 4, name: 'Medical License', key: 'license' },
  { number: 5, name: 'DEA Registration', key: 'dea' },
  { number: 6, name: 'NPI Verification', key: 'npi' },
  { number: 7, name: 'Education & Training', key: 'education' },
  { number: 8, name: 'Board Certification', key: 'board_cert' },
  { number: 9, name: 'Malpractice Insurance', key: 'malpractice' },
  { number: 10, name: 'Work History', key: 'work_history' },
  { number: 11, name: 'References', key: 'references' },
  { number: 12, name: 'Background Check', key: 'background' },
  { number: 13, name: 'Document Upload', key: 'documents' },
  { number: 14, name: 'Committee Review', key: 'committee' },
  { number: 15, name: 'Final Approval', key: 'approval' }
];

// ============================================================================
// PROVIDER ENDPOINTS
// ============================================================================

/**
 * Get or create credentialing record for provider
 */
router.get('/me', authenticate, requireRole(['provider']), async (req, res) => {
  try {
    let { rows } = await db.query(
      `SELECT * FROM provider_credentialing WHERE provider_id = $1`,
      [req.user.id]
    );
    
    // Create new credentialing record if doesn't exist
    if (rows.length === 0) {
      const { rows: newRows } = await db.query(
        `INSERT INTO provider_credentialing (provider_id, status) 
         VALUES ($1, 'not_started') 
         RETURNING *`,
        [req.user.id]
      );
      rows = newRows;
    }
    
    const credentialing = keysToCamel(rows[0]);
    
    // Get steps
    const { rows: stepRows } = await db.query(
      `SELECT * FROM credentialing_steps 
       WHERE credentialing_id = $1 
       ORDER BY step_number`,
      [credentialing.id]
    );
    
    // Get documents
    const { rows: docRows } = await db.query(
      `SELECT * FROM credentialing_documents 
       WHERE credentialing_id = $1 
       ORDER BY uploaded_at DESC`,
      [credentialing.id]
    );
    
    // Get references
    const { rows: refRows } = await db.query(
      `SELECT * FROM credentialing_references 
       WHERE credentialing_id = $1`,
      [credentialing.id]
    );
    
    // Get work history
    const { rows: workRows } = await db.query(
      `SELECT * FROM credentialing_work_history 
       WHERE credentialing_id = $1 
       ORDER BY start_date DESC`,
      [credentialing.id]
    );
    
    res.json({
      success: true,
      credentialing: {
        ...credentialing,
        steps: stepRows.map(keysToCamel),
        documents: docRows.map(keysToCamel),
        references: refRows.map(keysToCamel),
        workHistory: workRows.map(keysToCamel),
        stepsConfig: CREDENTIALING_STEPS
      }
    });
  } catch (error) {
    logger.error('Get credentialing error', { error: error.message, userId: req.user.id });
    res.status(500).json({ success: false, error: 'Failed to fetch credentialing data' });
  }
});

/**
 * Update personal information
 */
const personalInfoSchema = z.object({
  legalFirstName: z.string().min(1).max(100),
  legalMiddleName: z.string().max(100).optional(),
  legalLastName: z.string().min(1).max(100),
  dateOfBirth: z.string(),
  ssnLastFour: z.string().length(4).optional(),
  gender: z.string().optional(),
  primaryAddress: z.string().min(1),
  city: z.string().min(1),
  state: z.string().min(1),
  zipCode: z.string().min(1),
  country: z.string().default('United States')
});

router.put('/personal-info', authenticate, requireRole(['provider']), async (req, res) => {
  try {
    const data = validate(personalInfoSchema, req.body);
    
    const { rows } = await db.query(
      `UPDATE provider_credentialing SET
        legal_first_name = $1,
        legal_middle_name = $2,
        legal_last_name = $3,
        date_of_birth = $4,
        ssn_last_four = $5,
        gender = $6,
        primary_address = $7,
        city = $8,
        state = $9,
        zip_code = $10,
        country = $11,
        status = CASE WHEN status = 'not_started' THEN 'documents_required' ELSE status END,
        updated_at = CURRENT_TIMESTAMP
       WHERE provider_id = $12
       RETURNING *`,
      [
        data.legalFirstName,
        data.legalMiddleName,
        data.legalLastName,
        data.dateOfBirth,
        data.ssnLastFour,
        data.gender,
        data.primaryAddress,
        data.city,
        data.state,
        data.zipCode,
        data.country,
        req.user.id
      ]
    );
    
    // Update step status
    await updateStepStatus(rows[0].id, 2, 'approved');
    
    await logCredentialingAction(rows[0].id, 'personal_info_updated', req.user.id, req.user.role);
    
    res.json({
      success: true,
      credentialing: keysToCamel(rows[0])
    });
  } catch (error) {
    if (error.status === 400) {
      return res.status(400).json({ success: false, error: 'Validation failed', errors: error.errors });
    }
    logger.error('Update personal info error', { error: error.message, userId: req.user.id });
    res.status(500).json({ success: false, error: 'Failed to update personal information' });
  }
});

/**
 * Update professional information
 */
const professionalInfoSchema = z.object({
  specialty: z.string().min(1),
  subspecialties: z.array(z.string()).optional(),
  yearsInPractice: z.number().int().min(0),
  practiceType: z.string()
});

router.put('/professional-info', authenticate, requireRole(['provider']), async (req, res) => {
  try {
    const data = validate(professionalInfoSchema, req.body);
    
    const { rows } = await db.query(
      `UPDATE provider_credentialing SET
        specialty = $1,
        subspecialties = $2,
        years_in_practice = $3,
        practice_type = $4,
        updated_at = CURRENT_TIMESTAMP
       WHERE provider_id = $5
       RETURNING *`,
      [
        data.specialty,
        data.subspecialties || [],
        data.yearsInPractice,
        data.practiceType,
        req.user.id
      ]
    );
    
    await updateStepStatus(rows[0].id, 3, 'approved');
    await logCredentialingAction(rows[0].id, 'professional_info_updated', req.user.id, req.user.role);
    
    res.json({
      success: true,
      credentialing: keysToCamel(rows[0])
    });
  } catch (error) {
    if (error.status === 400) {
      return res.status(400).json({ success: false, error: 'Validation failed', errors: error.errors });
    }
    logger.error('Update professional info error', { error: error.message, userId: req.user.id });
    res.status(500).json({ success: false, error: 'Failed to update professional information' });
  }
});

/**
 * Update license information
 */
const licenseInfoSchema = z.object({
  medicalLicenseNumber: z.string().min(1),
  medicalLicenseState: z.string().min(1),
  medicalLicenseExpiry: z.string()
});

router.put('/license', authenticate, requireRole(['provider']), async (req, res) => {
  try {
    const data = validate(licenseInfoSchema, req.body);
    
    const { rows } = await db.query(
      `UPDATE provider_credentialing SET
        medical_license_number = $1,
        medical_license_state = $2,
        medical_license_expiry = $3,
        status = CASE WHEN status IN ('not_started', 'documents_required') THEN 'license_verification' ELSE status END,
        updated_at = CURRENT_TIMESTAMP
       WHERE provider_id = $4
       RETURNING *`,
      [
        data.medicalLicenseNumber,
        data.medicalLicenseState,
        data.medicalLicenseExpiry,
        req.user.id
      ]
    );
    
    await updateStepStatus(rows[0].id, 4, 'pending_review');
    await logCredentialingAction(rows[0].id, 'license_submitted', req.user.id, req.user.role);
    
    res.json({
      success: true,
      credentialing: keysToCamel(rows[0])
    });
  } catch (error) {
    if (error.status === 400) {
      return res.status(400).json({ success: false, error: 'Validation failed', errors: error.errors });
    }
    logger.error('Update license error', { error: error.message, userId: req.user.id });
    res.status(500).json({ success: false, error: 'Failed to update license information' });
  }
});

/**
 * Update DEA information
 */
const deaInfoSchema = z.object({
  deaNumber: z.string().min(1),
  deaExpiry: z.string()
});

router.put('/dea', authenticate, requireRole(['provider']), async (req, res) => {
  try {
    const data = validate(deaInfoSchema, req.body);
    
    const { rows } = await db.query(
      `UPDATE provider_credentialing SET
        dea_number = $1,
        dea_expiry = $2,
        updated_at = CURRENT_TIMESTAMP
       WHERE provider_id = $3
       RETURNING *`,
      [data.deaNumber, data.deaExpiry, req.user.id]
    );
    
    await updateStepStatus(rows[0].id, 5, 'pending_review');
    await logCredentialingAction(rows[0].id, 'dea_submitted', req.user.id, req.user.role);
    
    res.json({
      success: true,
      credentialing: keysToCamel(rows[0])
    });
  } catch (error) {
    if (error.status === 400) {
      return res.status(400).json({ success: false, error: 'Validation failed', errors: error.errors });
    }
    logger.error('Update DEA error', { error: error.message, userId: req.user.id });
    res.status(500).json({ success: false, error: 'Failed to update DEA information' });
  }
});

/**
 * Update NPI information
 */
const npiInfoSchema = z.object({
  npiNumber: z.string().length(10)
});

router.put('/npi', authenticate, requireRole(['provider']), async (req, res) => {
  try {
    const data = validate(npiInfoSchema, req.body);
    
    const { rows } = await db.query(
      `UPDATE provider_credentialing SET
        npi_number = $1,
        updated_at = CURRENT_TIMESTAMP
       WHERE provider_id = $2
       RETURNING *`,
      [data.npiNumber, req.user.id]
    );
    
    await updateStepStatus(rows[0].id, 6, 'pending_review');
    await logCredentialingAction(rows[0].id, 'npi_submitted', req.user.id, req.user.role);
    
    res.json({
      success: true,
      credentialing: keysToCamel(rows[0])
    });
  } catch (error) {
    if (error.status === 400) {
      return res.status(400).json({ success: false, error: 'Validation failed', errors: error.errors });
    }
    logger.error('Update NPI error', { error: error.message, userId: req.user.id });
    res.status(500).json({ success: false, error: 'Failed to update NPI information' });
  }
});

/**
 * Update education information
 */
const educationInfoSchema = z.object({
  medicalSchool: z.string().min(1),
  graduationYear: z.number().int(),
  degreeType: z.string(),
  residencyProgram: z.string().optional(),
  residencyCompletionYear: z.number().int().optional(),
  fellowshipProgram: z.string().optional(),
  fellowshipCompletionYear: z.number().int().optional()
});

router.put('/education', authenticate, requireRole(['provider']), async (req, res) => {
  try {
    const data = validate(educationInfoSchema, req.body);
    
    const { rows } = await db.query(
      `UPDATE provider_credentialing SET
        medical_school = $1,
        graduation_year = $2,
        degree_type = $3,
        residency_program = $4,
        residency_completion_year = $5,
        fellowship_program = $6,
        fellowship_completion_year = $7,
        updated_at = CURRENT_TIMESTAMP
       WHERE provider_id = $8
       RETURNING *`,
      [
        data.medicalSchool,
        data.graduationYear,
        data.degreeType,
        data.residencyProgram,
        data.residencyCompletionYear,
        data.fellowshipProgram,
        data.fellowshipCompletionYear,
        req.user.id
      ]
    );
    
    await updateStepStatus(rows[0].id, 7, 'pending_review');
    await logCredentialingAction(rows[0].id, 'education_submitted', req.user.id, req.user.role);
    
    res.json({
      success: true,
      credentialing: keysToCamel(rows[0])
    });
  } catch (error) {
    if (error.status === 400) {
      return res.status(400).json({ success: false, error: 'Validation failed', errors: error.errors });
    }
    logger.error('Update education error', { error: error.message, userId: req.user.id });
    res.status(500).json({ success: false, error: 'Failed to update education information' });
  }
});

/**
 * Update board certification
 */
const boardCertSchema = z.object({
  boardCertified: z.boolean(),
  boardName: z.string().optional(),
  boardCertificationNumber: z.string().optional(),
  boardCertificationExpiry: z.string().optional()
});

router.put('/board-certification', authenticate, requireRole(['provider']), async (req, res) => {
  try {
    const data = validate(boardCertSchema, req.body);
    
    const { rows } = await db.query(
      `UPDATE provider_credentialing SET
        board_certified = $1,
        board_name = $2,
        board_certification_number = $3,
        board_certification_expiry = $4,
        updated_at = CURRENT_TIMESTAMP
       WHERE provider_id = $5
       RETURNING *`,
      [
        data.boardCertified,
        data.boardName,
        data.boardCertificationNumber,
        data.boardCertificationExpiry,
        req.user.id
      ]
    );
    
    await updateStepStatus(rows[0].id, 8, 'pending_review');
    await logCredentialingAction(rows[0].id, 'board_cert_submitted', req.user.id, req.user.role);
    
    res.json({
      success: true,
      credentialing: keysToCamel(rows[0])
    });
  } catch (error) {
    if (error.status === 400) {
      return res.status(400).json({ success: false, error: 'Validation failed', errors: error.errors });
    }
    logger.error('Update board cert error', { error: error.message, userId: req.user.id });
    res.status(500).json({ success: false, error: 'Failed to update board certification' });
  }
});

/**
 * Update malpractice insurance
 */
const malpracticeSchema = z.object({
  malpracticeCarrier: z.string().min(1),
  malpracticePolicyNumber: z.string().min(1),
  malpracticeCoverageAmount: z.number(),
  malpracticeExpiry: z.string()
});

router.put('/malpractice', authenticate, requireRole(['provider']), async (req, res) => {
  try {
    const data = validate(malpracticeSchema, req.body);
    
    const { rows } = await db.query(
      `UPDATE provider_credentialing SET
        malpractice_carrier = $1,
        malpractice_policy_number = $2,
        malpractice_coverage_amount = $3,
        malpractice_expiry = $4,
        updated_at = CURRENT_TIMESTAMP
       WHERE provider_id = $5
       RETURNING *`,
      [
        data.malpracticeCarrier,
        data.malpracticePolicyNumber,
        data.malpracticeCoverageAmount,
        data.malpracticeExpiry,
        req.user.id
      ]
    );
    
    await updateStepStatus(rows[0].id, 9, 'pending_review');
    await logCredentialingAction(rows[0].id, 'malpractice_submitted', req.user.id, req.user.role);
    
    res.json({
      success: true,
      credentialing: keysToCamel(rows[0])
    });
  } catch (error) {
    if (error.status === 400) {
      return res.status(400).json({ success: false, error: 'Validation failed', errors: error.errors });
    }
    logger.error('Update malpractice error', { error: error.message, userId: req.user.id });
    res.status(500).json({ success: false, error: 'Failed to update malpractice insurance' });
  }
});

/**
 * Add work history entry
 */
const workHistorySchema = z.object({
  employerName: z.string().min(1),
  employerAddress: z.string().optional(),
  positionTitle: z.string().min(1),
  department: z.string().optional(),
  startDate: z.string(),
  endDate: z.string().optional(),
  isCurrent: z.boolean().default(false),
  reasonForLeaving: z.string().optional(),
  supervisorName: z.string().optional(),
  supervisorPhone: z.string().optional()
});

router.post('/work-history', authenticate, requireRole(['provider']), async (req, res) => {
  try {
    const data = validate(workHistorySchema, req.body);
    
    // Get credentialing ID
    const { rows: credRows } = await db.query(
      'SELECT id FROM provider_credentialing WHERE provider_id = $1',
      [req.user.id]
    );
    
    if (credRows.length === 0) {
      return res.status(404).json({ success: false, error: 'Credentialing record not found' });
    }
    
    const { rows } = await db.query(
      `INSERT INTO credentialing_work_history (
        credentialing_id, employer_name, employer_address, position_title,
        department, start_date, end_date, is_current, reason_for_leaving,
        supervisor_name, supervisor_phone
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING *`,
      [
        credRows[0].id,
        data.employerName,
        data.employerAddress,
        data.positionTitle,
        data.department,
        data.startDate,
        data.endDate,
        data.isCurrent,
        data.reasonForLeaving,
        data.supervisorName,
        data.supervisorPhone
      ]
    );
    
    await logCredentialingAction(credRows[0].id, 'work_history_added', req.user.id, req.user.role);
    
    res.status(201).json({
      success: true,
      workHistory: keysToCamel(rows[0])
    });
  } catch (error) {
    if (error.status === 400) {
      return res.status(400).json({ success: false, error: 'Validation failed', errors: error.errors });
    }
    logger.error('Add work history error', { error: error.message, userId: req.user.id });
    res.status(500).json({ success: false, error: 'Failed to add work history' });
  }
});

/**
 * Add reference
 */
const referenceSchema = z.object({
  referenceName: z.string().min(1),
  referenceTitle: z.string().optional(),
  referenceOrganization: z.string().optional(),
  referenceEmail: z.string().email(),
  referencePhone: z.string().optional(),
  relationship: z.string(),
  yearsKnown: z.number().int().optional()
});

router.post('/references', authenticate, requireRole(['provider']), async (req, res) => {
  try {
    const data = validate(referenceSchema, req.body);
    
    // Get credentialing ID
    const { rows: credRows } = await db.query(
      'SELECT id, references_submitted FROM provider_credentialing WHERE provider_id = $1',
      [req.user.id]
    );
    
    if (credRows.length === 0) {
      return res.status(404).json({ success: false, error: 'Credentialing record not found' });
    }
    
    const { rows } = await db.query(
      `INSERT INTO credentialing_references (
        credentialing_id, reference_name, reference_title, reference_organization,
        reference_email, reference_phone, relationship, years_known
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *`,
      [
        credRows[0].id,
        data.referenceName,
        data.referenceTitle,
        data.referenceOrganization,
        data.referenceEmail,
        data.referencePhone,
        data.relationship,
        data.yearsKnown
      ]
    );
    
    // Update references count
    await db.query(
      `UPDATE provider_credentialing 
       SET references_submitted = references_submitted + 1 
       WHERE id = $1`,
      [credRows[0].id]
    );
    
    await logCredentialingAction(credRows[0].id, 'reference_added', req.user.id, req.user.role);
    
    res.status(201).json({
      success: true,
      reference: keysToCamel(rows[0])
    });
  } catch (error) {
    if (error.status === 400) {
      return res.status(400).json({ success: false, error: 'Validation failed', errors: error.errors });
    }
    logger.error('Add reference error', { error: error.message, userId: req.user.id });
    res.status(500).json({ success: false, error: 'Failed to add reference' });
  }
});

/**
 * Upload document
 */
router.post('/documents', authenticate, requireRole(['provider']), upload.single('document'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No file uploaded' });
    }
    
    const { documentType, expiryDate } = req.body;
    
    // Get credentialing ID
    const { rows: credRows } = await db.query(
      'SELECT id FROM provider_credentialing WHERE provider_id = $1',
      [req.user.id]
    );
    
    if (credRows.length === 0) {
      return res.status(404).json({ success: false, error: 'Credentialing record not found' });
    }
    
    const { rows } = await db.query(
      `INSERT INTO credentialing_documents (
        credentialing_id, document_type, document_name, file_url,
        file_size, mime_type, expiry_date
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *`,
      [
        credRows[0].id,
        documentType,
        req.file.originalname,
        `/uploads/credentialing/${req.file.filename}`,
        req.file.size,
        req.file.mimetype,
        expiryDate || null
      ]
    );
    
    await logCredentialingAction(credRows[0].id, 'document_uploaded', req.user.id, req.user.role, {
      documentType,
      fileName: req.file.originalname
    });
    
    res.status(201).json({
      success: true,
      document: keysToCamel(rows[0])
    });
  } catch (error) {
    logger.error('Upload document error', { error: error.message, userId: req.user.id });
    res.status(500).json({ success: false, error: 'Failed to upload document' });
  }
});

/**
 * Consent to background check
 */
router.post('/background-check/consent', authenticate, requireRole(['provider']), async (req, res) => {
  try {
    const { rows } = await db.query(
      `UPDATE provider_credentialing SET
        background_check_consent = true,
        background_check_submitted_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
       WHERE provider_id = $1
       RETURNING *`,
      [req.user.id]
    );
    
    await updateStepStatus(rows[0].id, 12, 'pending_review');
    await logCredentialingAction(rows[0].id, 'background_check_consent', req.user.id, req.user.role);
    
    res.json({
      success: true,
      credentialing: keysToCamel(rows[0])
    });
  } catch (error) {
    logger.error('Background check consent error', { error: error.message, userId: req.user.id });
    res.status(500).json({ success: false, error: 'Failed to submit background check consent' });
  }
});

/**
 * Submit application for review
 */
router.post('/submit', authenticate, requireRole(['provider']), async (req, res) => {
  try {
    const { rows } = await db.query(
      `UPDATE provider_credentialing SET
        application_submitted_at = CURRENT_TIMESTAMP,
        status = 'documents_under_review',
        updated_at = CURRENT_TIMESTAMP
       WHERE provider_id = $1
       RETURNING *`,
      [req.user.id]
    );
    
    await logCredentialingAction(rows[0].id, 'application_submitted', req.user.id, req.user.role);
    
    res.json({
      success: true,
      credentialing: keysToCamel(rows[0]),
      message: 'Application submitted for review'
    });
  } catch (error) {
    logger.error('Submit application error', { error: error.message, userId: req.user.id });
    res.status(500).json({ success: false, error: 'Failed to submit application' });
  }
});

// ============================================================================
// ADMIN ENDPOINTS
// ============================================================================

/**
 * Get all credentialing applications (Admin)
 */
router.get('/admin/all', authenticate, requireRole(['admin', 'super_admin']), async (req, res) => {
  try {
    const { status, page = 1, limit = 20 } = req.query;
    const offset = (page - 1) * limit;
    
    let whereClause = '';
    const params = [];
    
    if (status && status !== 'all') {
      params.push(status);
      whereClause = `WHERE pc.status = $${params.length}`;
    }
    
    const { rows } = await db.query(
      `SELECT pc.*, u.first_name, u.last_name, u.email,
              (SELECT COUNT(*) FROM credentialing_documents WHERE credentialing_id = pc.id) as document_count,
              (SELECT COUNT(*) FROM credentialing_references WHERE credentialing_id = pc.id) as reference_count
       FROM provider_credentialing pc
       JOIN users u ON u.id = pc.provider_id
       ${whereClause}
       ORDER BY 
         CASE pc.status 
           WHEN 'documents_under_review' THEN 1
           WHEN 'committee_review' THEN 2
           ELSE 3 
         END,
         pc.application_submitted_at DESC NULLS LAST
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset]
    );
    
    // Get total count
    const { rows: countRows } = await db.query(
      `SELECT COUNT(*) FROM provider_credentialing pc ${whereClause}`,
      params
    );
    
    res.json({
      success: true,
      applications: rows.map(keysToCamel),
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: parseInt(countRows[0].count),
        totalPages: Math.ceil(countRows[0].count / limit)
      }
    });
  } catch (error) {
    logger.error('Get all credentialing error', { error: error.message });
    res.status(500).json({ success: false, error: 'Failed to fetch credentialing applications' });
  }
});

/**
 * Get single credentialing application details (Admin)
 */
router.get('/admin/:providerId', authenticate, requireRole(['admin', 'super_admin']), async (req, res) => {
  try {
    const { providerId } = req.params;
    
    const { rows } = await db.query(
      `SELECT pc.*, u.first_name, u.last_name, u.email, u.phone
       FROM provider_credentialing pc
       JOIN users u ON u.id = pc.provider_id
       WHERE pc.provider_id = $1`,
      [providerId]
    );
    
    if (rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Credentialing record not found' });
    }
    
    const credentialing = keysToCamel(rows[0]);
    
    // Get all related data
    const [steps, documents, references, workHistory, auditLog] = await Promise.all([
      db.query('SELECT * FROM credentialing_steps WHERE credentialing_id = $1 ORDER BY step_number', [credentialing.id]),
      db.query('SELECT * FROM credentialing_documents WHERE credentialing_id = $1 ORDER BY uploaded_at DESC', [credentialing.id]),
      db.query('SELECT * FROM credentialing_references WHERE credentialing_id = $1', [credentialing.id]),
      db.query('SELECT * FROM credentialing_work_history WHERE credentialing_id = $1 ORDER BY start_date DESC', [credentialing.id]),
      db.query('SELECT * FROM credentialing_audit_log WHERE credentialing_id = $1 ORDER BY created_at DESC LIMIT 50', [credentialing.id])
    ]);
    
    res.json({
      success: true,
      credentialing: {
        ...credentialing,
        steps: steps.rows.map(keysToCamel),
        documents: documents.rows.map(keysToCamel),
        references: references.rows.map(keysToCamel),
        workHistory: workHistory.rows.map(keysToCamel),
        auditLog: auditLog.rows.map(keysToCamel),
        stepsConfig: CREDENTIALING_STEPS
      }
    });
  } catch (error) {
    logger.error('Get credentialing detail error', { error: error.message });
    res.status(500).json({ success: false, error: 'Failed to fetch credentialing details' });
  }
});

/**
 * Update step status (Admin)
 */
const updateStepSchema = z.object({
  stepNumber: z.number().int().min(1).max(15),
  status: z.enum(['not_started', 'in_progress', 'pending_review', 'approved', 'rejected', 'requires_resubmission']),
  reviewNotes: z.string().optional(),
  rejectionReason: z.string().optional()
});

router.put('/admin/:providerId/step', authenticate, requireRole(['admin', 'super_admin']), async (req, res) => {
  try {
    const { providerId } = req.params;
    const data = validate(updateStepSchema, req.body);
    
    // Get credentialing ID
    const { rows: credRows } = await db.query(
      'SELECT id FROM provider_credentialing WHERE provider_id = $1',
      [providerId]
    );
    
    if (credRows.length === 0) {
      return res.status(404).json({ success: false, error: 'Credentialing record not found' });
    }
    
    const { rows } = await db.query(
      `UPDATE credentialing_steps SET
        status = $1,
        review_notes = COALESCE($2, review_notes),
        rejection_reason = $3,
        reviewed_by = $4,
        completed_at = CASE WHEN $1 = 'approved' THEN CURRENT_TIMESTAMP ELSE completed_at END,
        updated_at = CURRENT_TIMESTAMP
       WHERE credentialing_id = $5 AND step_number = $6
       RETURNING *`,
      [
        data.status,
        data.reviewNotes,
        data.rejectionReason,
        req.user.id,
        credRows[0].id,
        data.stepNumber
      ]
    );
    
    await logCredentialingAction(credRows[0].id, 'step_updated', req.user.id, req.user.role, {
      stepNumber: data.stepNumber,
      newStatus: data.status
    });
    
    res.json({
      success: true,
      step: keysToCamel(rows[0])
    });
  } catch (error) {
    if (error.status === 400) {
      return res.status(400).json({ success: false, error: 'Validation failed', errors: error.errors });
    }
    logger.error('Update step error', { error: error.message });
    res.status(500).json({ success: false, error: 'Failed to update step' });
  }
});

/**
 * Verify a specific credential (Admin)
 */
const verifyCredentialSchema = z.object({
  credentialType: z.enum(['license', 'dea', 'npi', 'board', 'education', 'malpractice']),
  verified: z.boolean(),
  notes: z.string().optional()
});

router.put('/admin/:providerId/verify', authenticate, requireRole(['admin', 'super_admin']), async (req, res) => {
  try {
    const { providerId } = req.params;
    const data = validate(verifyCredentialSchema, req.body);
    
    const columnMap = {
      license: { verified: 'license_verified', verifiedAt: 'license_verified_at', notes: 'license_verification_notes' },
      dea: { verified: 'dea_verified', verifiedAt: 'dea_verified_at', notes: 'dea_verification_notes' },
      npi: { verified: 'npi_verified', verifiedAt: 'npi_verified_at', notes: 'npi_verification_notes' },
      board: { verified: 'board_verified', verifiedAt: 'board_verified_at', notes: null },
      education: { verified: 'education_verified', verifiedAt: 'education_verified_at', notes: null },
      malpractice: { verified: 'malpractice_verified', verifiedAt: 'malpractice_verified_at', notes: null }
    };
    
    const cols = columnMap[data.credentialType];
    
    let query = `UPDATE provider_credentialing SET 
      ${cols.verified} = $1,
      ${cols.verifiedAt} = CASE WHEN $1 THEN CURRENT_TIMESTAMP ELSE NULL END,
      updated_at = CURRENT_TIMESTAMP`;
    
    const params = [data.verified];
    
    if (cols.notes && data.notes) {
      params.push(data.notes);
      query += `, ${cols.notes} = $${params.length}`;
    }
    
    params.push(providerId);
    query += ` WHERE provider_id = $${params.length} RETURNING *`;
    
    const { rows } = await db.query(query, params);
    
    if (rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Credentialing record not found' });
    }
    
    await logCredentialingAction(rows[0].id, `${data.credentialType}_verified`, req.user.id, req.user.role, {
      verified: data.verified
    });
    
    res.json({
      success: true,
      credentialing: keysToCamel(rows[0])
    });
  } catch (error) {
    if (error.status === 400) {
      return res.status(400).json({ success: false, error: 'Validation failed', errors: error.errors });
    }
    logger.error('Verify credential error', { error: error.message });
    res.status(500).json({ success: false, error: 'Failed to verify credential' });
  }
});

/**
 * Approve/Reject credentialing (Admin)
 */
const decisionSchema = z.object({
  decision: z.enum(['approved', 'rejected']),
  reason: z.string().optional(),
  expiryMonths: z.number().int().default(24) // Credentialing typically expires in 2 years
});

router.put('/admin/:providerId/decision', authenticate, requireRole(['admin', 'super_admin']), async (req, res) => {
  try {
    const { providerId } = req.params;
    const data = validate(decisionSchema, req.body);
    
    const expiryDate = new Date();
    expiryDate.setMonth(expiryDate.getMonth() + data.expiryMonths);
    
    const { rows } = await db.query(
      `UPDATE provider_credentialing SET
        status = $1,
        approved_at = CASE WHEN $1 = 'approved' THEN CURRENT_TIMESTAMP ELSE NULL END,
        approved_by = CASE WHEN $1 = 'approved' THEN $2 ELSE NULL END,
        approval_expiry = CASE WHEN $1 = 'approved' THEN $3 ELSE NULL END,
        rejection_reason = CASE WHEN $1 = 'rejected' THEN $4 ELSE NULL END,
        progress_percentage = CASE WHEN $1 = 'approved' THEN 100 ELSE progress_percentage END,
        updated_at = CURRENT_TIMESTAMP
       WHERE provider_id = $5
       RETURNING *`,
      [data.decision, req.user.id, expiryDate, data.reason, providerId]
    );
    
    if (rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Credentialing record not found' });
    }
    
    // Update provider status in users table
    if (data.decision === 'approved') {
      await db.query(
        `UPDATE users SET provider_status = 'approved' WHERE id = $1`,
        [providerId]
      );
      
      // Mark final step as approved
      await updateStepStatus(rows[0].id, 15, 'approved');
    } else {
      await db.query(
        `UPDATE users SET provider_status = 'rejected' WHERE id = $1`,
        [providerId]
      );
    }
    
    await logCredentialingAction(rows[0].id, `credentialing_${data.decision}`, req.user.id, req.user.role, {
      reason: data.reason
    });
    
    res.json({
      success: true,
      credentialing: keysToCamel(rows[0]),
      message: `Provider credentialing ${data.decision}`
    });
  } catch (error) {
    if (error.status === 400) {
      return res.status(400).json({ success: false, error: 'Validation failed', errors: error.errors });
    }
    logger.error('Credentialing decision error', { error: error.message });
    res.status(500).json({ success: false, error: 'Failed to process decision' });
  }
});

/**
 * Get credentialing statistics (Admin)
 */
router.get('/admin/stats', authenticate, requireRole(['admin', 'super_admin']), async (req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT 
        status,
        COUNT(*) as count
      FROM provider_credentialing
      GROUP BY status
    `);
    
    const stats = {
      total: 0,
      notStarted: 0,
      pendingPayment: 0,
      documentsRequired: 0,
      underReview: 0,
      approved: 0,
      rejected: 0
    };
    
    rows.forEach(row => {
      stats.total += parseInt(row.count);
      switch (row.status) {
        case 'not_started': stats.notStarted = parseInt(row.count); break;
        case 'pending_payment': stats.pendingPayment = parseInt(row.count); break;
        case 'documents_required': stats.documentsRequired = parseInt(row.count); break;
        case 'documents_under_review':
        case 'license_verification':
        case 'dea_verification':
        case 'npi_verification':
        case 'background_check':
        case 'malpractice_verification':
        case 'education_verification':
        case 'references_check':
        case 'committee_review':
          stats.underReview += parseInt(row.count); break;
        case 'approved': stats.approved = parseInt(row.count); break;
        case 'rejected': stats.rejected = parseInt(row.count); break;
      }
    });
    
    res.json({
      success: true,
      stats
    });
  } catch (error) {
    logger.error('Get credentialing stats error', { error: error.message });
    res.status(500).json({ success: false, error: 'Failed to fetch statistics' });
  }
});

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

async function updateStepStatus(credentialingId, stepNumber, status) {
  try {
    await db.query(
      `UPDATE credentialing_steps SET 
        status = $1, 
        started_at = CASE WHEN started_at IS NULL THEN CURRENT_TIMESTAMP ELSE started_at END,
        completed_at = CASE WHEN $1 = 'approved' THEN CURRENT_TIMESTAMP ELSE completed_at END,
        updated_at = CURRENT_TIMESTAMP
       WHERE credentialing_id = $2 AND step_number = $3`,
      [status, credentialingId, stepNumber]
    );
  } catch (error) {
    logger.error('Update step status error', { error: error.message, credentialingId, stepNumber });
  }
}

async function logCredentialingAction(credentialingId, action, userId, userRole, details = {}) {
  try {
    await db.query(
      `INSERT INTO credentialing_audit_log (credentialing_id, action, action_by, action_by_role, details)
       VALUES ($1, $2, $3, $4, $5)`,
      [credentialingId, action, userId, userRole, JSON.stringify(details)]
    );
  } catch (error) {
    logger.error('Log credentialing action error', { error: error.message });
  }
}

module.exports = router;

