/**
 * Medical Records Routes
 * Encrypted PHI storage and retrieval
 */

const express = require('express');
const db = require('../db');
const logger = require('../middleware/logger');
const { authenticate, requireRole, canAccessPatient } = require('../middleware/auth');
const { auditMiddleware, auditPhiAccess, auditExport } = require('../middleware/audit');
const { encrypt, decrypt, encryptFields, decryptFields } = require('../../lib/encryption');
const { validate, createMedicalRecordSchema, paginationSchema } = require('../../lib/validation');
const { keysToCamel, parseQueryParams, getPaginationMeta } = require('../../lib/utils');

const router = express.Router();

/**
 * POST /api/medical-records
 * Create new medical record
 */
router.post('/',
  authenticate,
  requireRole('provider', 'admin'),
  auditMiddleware('create', 'medical_record', { phiAccessed: true }),
  async (req, res) => {
    try {
      const data = validate(createMedicalRecordSchema, req.body);
      
      // Verify patient exists
      const { rows: patients } = await db.query(
        `SELECT id FROM users WHERE id = $1 AND role = 'patient'`,
        [data.patientId]
      );
      
      if (patients.length === 0) {
        return res.status(404).json({
          success: false,
          error: 'Patient not found'
        });
      }
      
      // Encrypt content
      const { encrypted, iv, tag } = encrypt(data.content);
      
      const { rows } = await db.query(
        `INSERT INTO medical_records (
          patient_id, created_by, appointment_id, record_type, title,
          content_encrypted, content_iv, content_tag,
          file_name, file_type, file_size, is_sensitive, access_restricted
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
        RETURNING id, patient_id, record_type, title, file_name, file_type,
                  file_size, is_sensitive, access_restricted, recorded_at, created_at`,
        [
          data.patientId,
          req.user.id,
          data.appointmentId || null,
          data.recordType,
          data.title,
          encrypted,
          iv,
          tag,
          data.fileName || null,
          data.fileType || null,
          data.fileSize || null,
          data.isSensitive,
          data.accessRestricted
        ]
      );
      
      logger.info('Medical record created', { 
        recordId: rows[0].id, 
        patientId: data.patientId,
        createdBy: req.user.id 
      });
      
      res.status(201).json({
        success: true,
        message: 'Medical record created successfully',
        record: keysToCamel(rows[0])
      });
    } catch (error) {
      if (error.status === 400) {
        return res.status(400).json({
          success: false,
          error: 'Validation failed',
          errors: error.errors
        });
      }
      
      logger.error('Create medical record error', { error: error.message });
      res.status(500).json({
        success: false,
        error: 'Failed to create medical record'
      });
    }
  }
);

/**
 * GET /api/medical-records/patient/:patientId
 * Get all records for a patient
 */
router.get('/patient/:patientId',
  authenticate,
  canAccessPatient,
  auditPhiAccess('medical_record'),
  async (req, res) => {
    try {
      const { patientId } = req.params;
      const filters = validate(paginationSchema, req.query);
      const { page, limit, sortOrder } = parseQueryParams(filters);
      const offset = (page - 1) * limit;
      
      // Get total count
      const { rows: countResult } = await db.query(
        `SELECT COUNT(*) FROM medical_records WHERE patient_id = $1`,
        [patientId]
      );
      const total = parseInt(countResult[0].count);
      
      // Get records (without encrypted content for list view)
      const { rows } = await db.query(
        `SELECT mr.id, mr.patient_id, mr.record_type, mr.title,
                mr.file_name, mr.file_type, mr.file_size,
                mr.is_sensitive, mr.access_restricted,
                mr.recorded_at, mr.created_at,
                u.first_name as created_by_first_name,
                u.last_name as created_by_last_name
         FROM medical_records mr
         JOIN users u ON u.id = mr.created_by
         WHERE mr.patient_id = $1
         ORDER BY mr.recorded_at ${sortOrder}
         LIMIT $2 OFFSET $3`,
        [patientId, limit, offset]
      );
      
      // Store patient ID for audit
      res.locals.patientId = patientId;
      
      res.json({
        success: true,
        records: rows.map(keysToCamel),
        pagination: getPaginationMeta(total, page, limit)
      });
    } catch (error) {
      logger.error('Get medical records error', { error: error.message });
      res.status(500).json({
        success: false,
        error: 'Failed to get medical records'
      });
    }
  }
);

/**
 * GET /api/medical-records/:id
 * Get single medical record with decrypted content
 */
router.get('/:id',
  authenticate,
  auditPhiAccess('medical_record'),
  async (req, res) => {
    try {
      const { id } = req.params;
      
      const { rows } = await db.query(
        `SELECT mr.*,
                u.first_name as created_by_first_name,
                u.last_name as created_by_last_name
         FROM medical_records mr
         JOIN users u ON u.id = mr.created_by
         WHERE mr.id = $1`,
        [id]
      );
      
      if (rows.length === 0) {
        return res.status(404).json({
          success: false,
          error: 'Medical record not found'
        });
      }
      
      const record = rows[0];
      
      // Check access
      if (req.user.role === 'patient' && record.patient_id !== req.user.id) {
        return res.status(403).json({
          success: false,
          error: 'Access denied'
        });
      }
      
      if (req.user.role === 'provider') {
        // Check if provider has relationship with patient
        const { rows: appointments } = await db.query(
          `SELECT 1 FROM appointments 
           WHERE provider_id = $1 AND patient_id = $2 LIMIT 1`,
          [req.user.id, record.patient_id]
        );
        
        if (appointments.length === 0) {
          return res.status(403).json({
            success: false,
            error: 'No provider-patient relationship found'
          });
        }
      }
      
      // Decrypt content
      const decryptedContent = decrypt(
        record.content_encrypted,
        record.content_iv,
        record.content_tag
      );
      
      // Store patient ID for audit
      res.locals.patientId = record.patient_id;
      
      res.json({
        success: true,
        record: {
          id: record.id,
          patientId: record.patient_id,
          recordType: record.record_type,
          title: record.title,
          content: decryptedContent,
          fileName: record.file_name,
          fileType: record.file_type,
          fileSize: record.file_size,
          isSensitive: record.is_sensitive,
          accessRestricted: record.access_restricted,
          recordedAt: record.recorded_at,
          createdAt: record.created_at,
          createdBy: {
            firstName: record.created_by_first_name,
            lastName: record.created_by_last_name
          }
        }
      });
    } catch (error) {
      logger.error('Get medical record error', { error: error.message });
      res.status(500).json({
        success: false,
        error: 'Failed to get medical record'
      });
    }
  }
);

/**
 * PUT /api/medical-records/:id
 * Update medical record
 */
router.put('/:id',
  authenticate,
  requireRole('provider', 'admin'),
  auditMiddleware('update', 'medical_record', { phiAccessed: true, logChanges: true }),
  async (req, res) => {
    try {
      const { id } = req.params;
      const { title, content, recordType, isSensitive, accessRestricted } = req.body;
      
      // Get current record
      const { rows: current } = await db.query(
        'SELECT * FROM medical_records WHERE id = $1',
        [id]
      );
      
      if (current.length === 0) {
        return res.status(404).json({
          success: false,
          error: 'Medical record not found'
        });
      }
      
      // Only creator or admin can update
      if (req.user.role !== 'admin' && current[0].created_by !== req.user.id) {
        return res.status(403).json({
          success: false,
          error: 'Only the creator can update this record'
        });
      }
      
      // Build update
      const updates = [];
      const values = [];
      let paramIndex = 1;
      
      if (title) {
        updates.push(`title = $${paramIndex}`);
        values.push(title);
        paramIndex++;
      }
      
      if (content) {
        const { encrypted, iv, tag } = encrypt(content);
        updates.push(`content_encrypted = $${paramIndex}`);
        values.push(encrypted);
        paramIndex++;
        updates.push(`content_iv = $${paramIndex}`);
        values.push(iv);
        paramIndex++;
        updates.push(`content_tag = $${paramIndex}`);
        values.push(tag);
        paramIndex++;
      }
      
      if (recordType) {
        updates.push(`record_type = $${paramIndex}`);
        values.push(recordType);
        paramIndex++;
      }
      
      if (isSensitive !== undefined) {
        updates.push(`is_sensitive = $${paramIndex}`);
        values.push(isSensitive);
        paramIndex++;
      }
      
      if (accessRestricted !== undefined) {
        updates.push(`access_restricted = $${paramIndex}`);
        values.push(accessRestricted);
        paramIndex++;
      }
      
      if (updates.length === 0) {
        return res.status(400).json({
          success: false,
          error: 'No fields to update'
        });
      }
      
      values.push(id);
      
      const { rows } = await db.query(
        `UPDATE medical_records SET ${updates.join(', ')}, updated_at = NOW()
         WHERE id = $${paramIndex}
         RETURNING id, patient_id, record_type, title, is_sensitive, 
                   access_restricted, recorded_at, updated_at`,
        values
      );
      
      // Store for audit
      res.locals.patientId = current[0].patient_id;
      res.locals.oldValues = { title: current[0].title, recordType: current[0].record_type };
      
      logger.info('Medical record updated', { recordId: id });
      
      res.json({
        success: true,
        message: 'Medical record updated successfully',
        record: keysToCamel(rows[0])
      });
    } catch (error) {
      logger.error('Update medical record error', { error: error.message });
      res.status(500).json({
        success: false,
        error: 'Failed to update medical record'
      });
    }
  }
);

/**
 * DELETE /api/medical-records/:id
 * Soft delete medical record
 */
router.delete('/:id',
  authenticate,
  requireRole('admin'),
  auditMiddleware('delete', 'medical_record', { phiAccessed: true }),
  async (req, res) => {
    try {
      const { id } = req.params;
      
      // Check if exists
      const { rows: current } = await db.query(
        'SELECT patient_id FROM medical_records WHERE id = $1',
        [id]
      );
      
      if (current.length === 0) {
        return res.status(404).json({
          success: false,
          error: 'Medical record not found'
        });
      }
      
      // Soft delete - just mark as deleted but keep for HIPAA compliance
      await db.query(
        `UPDATE medical_records SET 
          access_restricted = true,
          title = CONCAT('[DELETED] ', title),
          updated_at = NOW()
         WHERE id = $1`,
        [id]
      );
      
      res.locals.patientId = current[0].patient_id;
      
      logger.info('Medical record deleted', { recordId: id, deletedBy: req.user.id });
      
      res.json({
        success: true,
        message: 'Medical record deleted'
      });
    } catch (error) {
      logger.error('Delete medical record error', { error: error.message });
      res.status(500).json({
        success: false,
        error: 'Failed to delete medical record'
      });
    }
  }
);

/**
 * GET /api/medical-records/export/:patientId
 * Export all records for a patient (HIPAA data export requirement)
 */
router.get('/export/:patientId',
  authenticate,
  canAccessPatient,
  async (req, res) => {
    try {
      const { patientId } = req.params;
      
      // Only patient themselves or admin can export
      if (req.user.role !== 'admin' && req.user.id !== patientId) {
        return res.status(403).json({
          success: false,
          error: 'Access denied'
        });
      }
      
      // Get all records
      const { rows } = await db.query(
        `SELECT mr.*,
                u.first_name as created_by_first_name,
                u.last_name as created_by_last_name
         FROM medical_records mr
         JOIN users u ON u.id = mr.created_by
         WHERE mr.patient_id = $1
         ORDER BY mr.recorded_at DESC`,
        [patientId]
      );
      
      // Decrypt all content
      const exportData = rows.map(record => ({
        id: record.id,
        recordType: record.record_type,
        title: record.title,
        content: decrypt(record.content_encrypted, record.content_iv, record.content_tag),
        fileName: record.file_name,
        recordedAt: record.recorded_at,
        createdAt: record.created_at,
        createdBy: `${record.created_by_first_name} ${record.created_by_last_name}`
      }));
      
      // Audit this export
      await auditExport(req, 'medical_records', patientId, { recordCount: exportData.length });
      
      logger.info('Medical records exported', { 
        patientId, 
        recordCount: exportData.length,
        exportedBy: req.user.id 
      });
      
      res.json({
        success: true,
        exportDate: new Date().toISOString(),
        patientId,
        recordCount: exportData.length,
        records: exportData
      });
    } catch (error) {
      logger.error('Export medical records error', { error: error.message });
      res.status(500).json({
        success: false,
        error: 'Failed to export medical records'
      });
    }
  }
);

module.exports = router;

