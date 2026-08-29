/**
 * Clinical Encounter Service
 * Mini-EHR System of Record for Telehealth Encounters
 * 
 * HIPAA-compliant clinical documentation with:
 * - Append-only notes with version history
 * - Provider electronic signatures
 * - PHI encryption at rest
 * - Full audit trail
 */

const crypto = require('crypto');
const db = require('../db');
const logger = require('../middleware/logger');
const { encrypt, decrypt } = require('../../lib/encryption');
const { keysToCamel } = require('../../lib/utils');
const { createAuditLog } = require('../middleware/audit');

class ClinicalEncounterService {
  
  // =========================================================================
  // ENCOUNTER MANAGEMENT
  // =========================================================================
  
  /**
   * Create a new clinical encounter
   * @param {Object} data - Encounter data
   * @param {string} providerId - Provider creating the encounter
   * @returns {Object} Created encounter
   */
  async createEncounter(data, providerId) {
    const client = await db.pool.connect();
    
    try {
      await client.query('BEGIN');
      
      const {
        appointmentId,
        patientId,
        encounterType,
        patientState,
        patientLocationMethod,
        providerState,
        chiefComplaint,
        telehealthConsentId
      } = data;
      
      // Verify patient exists
      const { rows: patients } = await client.query(
        `SELECT id FROM users WHERE id = $1 AND role = 'patient'`,
        [patientId]
      );
      
      if (patients.length === 0) {
        throw new Error('Patient not found');
      }
      
      // Verify valid telehealth consent if required for telehealth encounters
      if (encounterType.startsWith('telehealth') && telehealthConsentId) {
        const { rows: consents } = await client.query(
          `SELECT id FROM telehealth_consents 
           WHERE id = $1 AND patient_id = $2 AND is_valid = true
           AND (expires_at IS NULL OR expires_at > NOW())`,
          [telehealthConsentId, patientId]
        );
        
        if (consents.length === 0) {
          throw new Error('Valid telehealth consent required');
        }
      }
      
      // Encrypt chief complaint
      const ccEncrypted = chiefComplaint ? encrypt(chiefComplaint) : { encrypted: null, iv: null, tag: null };
      
      // Create encounter
      const { rows } = await client.query(
        `INSERT INTO clinical_encounters (
          appointment_id, patient_id, provider_id, encounter_type,
          patient_state, patient_location_verified, patient_location_method,
          provider_state, encounter_start, encounter_start_time,
          chief_complaint_encrypted, chief_complaint_iv, chief_complaint_tag,
          telehealth_consent_id, status
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW(), $9, $10, $11, $12, 'in_progress')
        RETURNING *`,
        [
          appointmentId || null,
          patientId,
          providerId,
          encounterType,
          patientState,
          !!patientLocationMethod,
          patientLocationMethod || 'self_reported',
          providerState || null,
          ccEncrypted.encrypted,
          ccEncrypted.iv,
          ccEncrypted.tag,
          telehealthConsentId || null
        ]
      );
      
      const encounter = rows[0];
      
      // Create or update provider-patient relationship
      await client.query(
        `INSERT INTO provider_patient_relationships (
          provider_id, patient_id, relationship_type, established_encounter_id
        ) VALUES ($1, $2, 'treating', $3)
        ON CONFLICT (provider_id, patient_id, relationship_type) 
        DO UPDATE SET 
          established_encounter_id = COALESCE(provider_patient_relationships.established_encounter_id, EXCLUDED.established_encounter_id)`,
        [providerId, patientId, encounter.id]
      );
      
      // Update appointment status if linked
      if (appointmentId) {
        await client.query(
          `UPDATE appointments SET status = 'in_progress', started_at = NOW() WHERE id = $1`,
          [appointmentId]
        );
      }
      
      await client.query('COMMIT');
      
      logger.info('Clinical encounter created', {
        encounterId: encounter.id,
        patientId,
        providerId,
        encounterType
      });
      
      return this._formatEncounter(encounter);
      
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error('Create encounter error:', error);
      throw error;
    } finally {
      client.release();
    }
  }
  
  /**
   * Complete a clinical encounter
   */
  async completeEncounter(encounterId, providerId) {
    const { rows } = await db.query(
      `UPDATE clinical_encounters SET
        encounter_end = NOW(),
        encounter_end_time = NOW(),
        status = 'completed',
        updated_at = NOW()
       WHERE id = $1 AND provider_id = $2 AND status = 'in_progress'
       RETURNING *`,
      [encounterId, providerId]
    );
    
    if (rows.length === 0) {
      throw new Error('Encounter not found or already completed');
    }
    
    // Update linked appointment
    if (rows[0].appointment_id) {
      await db.query(
        `UPDATE appointments SET status = 'completed', completed_at = NOW() WHERE id = $1`,
        [rows[0].appointment_id]
      );
    }
    
    logger.info('Clinical encounter completed', { encounterId, providerId });
    
    return this._formatEncounter(rows[0]);
  }
  
  /**
   * Get encounter by ID with full clinical context
   */
  async getEncounterById(encounterId, userId, userRole) {
    const { rows } = await db.query(
      `SELECT ce.*,
              p.first_name as patient_first_name, p.last_name as patient_last_name,
              p.date_of_birth as patient_dob,
              pr.first_name as provider_first_name, pr.last_name as provider_last_name,
              pr.credentials as provider_credentials, pr.specialty as provider_specialty,
              a.scheduled_at, a.reason_for_visit
       FROM clinical_encounters ce
       JOIN users p ON p.id = ce.patient_id
       JOIN users pr ON pr.id = ce.provider_id
       LEFT JOIN appointments a ON a.id = ce.appointment_id
       WHERE ce.id = $1`,
      [encounterId]
    );
    
    if (rows.length === 0) {
      return null;
    }
    
    const encounter = rows[0];
    
    // Access control
    if (userRole === 'patient' && encounter.patient_id !== userId) {
      throw new Error('Access denied');
    }
    
    if (userRole === 'provider') {
      // Check provider-patient relationship
      const { rows: rel } = await db.query(
        `SELECT 1 FROM provider_patient_relationships 
         WHERE provider_id = $1 AND patient_id = $2 AND is_active = true`,
        [userId, encounter.patient_id]
      );
      
      if (rel.length === 0 && encounter.provider_id !== userId) {
        throw new Error('No provider-patient relationship found');
      }
    }
    
    return this._formatEncounter(encounter, true);
  }
  
  /**
   * Get patient's encounter history
   */
  async getPatientEncounters(patientId, options = {}) {
    const { limit = 50, offset = 0, status } = options;
    
    let query = `
      SELECT ce.*,
             pr.first_name as provider_first_name, pr.last_name as provider_last_name,
             pr.credentials as provider_credentials
      FROM clinical_encounters ce
      JOIN users pr ON pr.id = ce.provider_id
      WHERE ce.patient_id = $1
    `;
    const params = [patientId];
    let paramIndex = 2;
    
    if (status) {
      query += ` AND ce.status = $${paramIndex++}`;
      params.push(status);
    }
    
    query += ` ORDER BY ce.encounter_start DESC LIMIT $${paramIndex++} OFFSET $${paramIndex}`;
    params.push(limit, offset);
    
    const { rows } = await db.query(query, params);
    
    return rows.map(r => this._formatEncounter(r));
  }
  
  // =========================================================================
  // CLINICAL NOTES (Append-Only with Versioning)
  // =========================================================================
  
  /**
   * Create a new clinical note (SOAP)
   * Notes are append-only - once signed, they cannot be modified
   */
  async createNote(encounterId, providerId, noteData) {
    const client = await db.pool.connect();
    
    try {
      await client.query('BEGIN');
      
      // Verify encounter exists and belongs to provider
      const { rows: encounters } = await client.query(
        `SELECT id, patient_id, provider_id, status FROM clinical_encounters WHERE id = $1`,
        [encounterId]
      );
      
      if (encounters.length === 0) {
        throw new Error('Encounter not found');
      }
      
      const encounter = encounters[0];
      if (encounter.provider_id !== providerId) {
        throw new Error('Encounter not found or access denied');
      }
      
      // Encrypt SOAP fields
      const subjective = noteData.subjective ? encrypt(noteData.subjective) : { encrypted: null, iv: null, tag: null };
      const objective = noteData.objective ? encrypt(noteData.objective) : { encrypted: null, iv: null, tag: null };
      const assessment = noteData.assessment ? encrypt(noteData.assessment) : { encrypted: null, iv: null, tag: null };
      const plan = noteData.plan ? encrypt(noteData.plan) : { encrypted: null, iv: null, tag: null };
      const vitals = noteData.vitals ? encrypt(JSON.stringify(noteData.vitals)) : { encrypted: null, iv: null, tag: null };
      const physicalExam = noteData.physicalExam ? encrypt(noteData.physicalExam) : { encrypted: null, iv: null, tag: null };
      
      const { rows } = await client.query(
        `INSERT INTO clinical_notes (
          encounter_id, patient_id, provider_id, note_type, version,
          subjective_encrypted, subjective_iv, subjective_tag,
          objective_encrypted, objective_iv, objective_tag,
          assessment_encrypted, assessment_iv, assessment_tag,
          plan_encrypted, plan_iv, plan_tag,
          vitals_encrypted, vitals_iv, vitals_tag,
          physical_exam_encrypted, physical_exam_iv, physical_exam_tag,
          icd_codes, cpt_codes,
          follow_up_required, follow_up_interval, follow_up_notes
        ) VALUES ($1, $2, $3, $4, 1, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27)
        RETURNING *`,
        [
          encounterId,
          encounter.patient_id,
          providerId,
          noteData.noteType || 'soap',
          subjective.encrypted, subjective.iv, subjective.tag,
          objective.encrypted, objective.iv, objective.tag,
          assessment.encrypted, assessment.iv, assessment.tag,
          plan.encrypted, plan.iv, plan.tag,
          vitals.encrypted, vitals.iv, vitals.tag,
          physicalExam.encrypted, physicalExam.iv, physicalExam.tag,
          noteData.icdCodes || [],
          noteData.cptCodes || [],
          noteData.followUpRequired || false,
          noteData.followUpInterval || null,
          noteData.followUpNotes || null
        ]
      );
      
      await client.query('COMMIT');
      
      logger.info('Clinical note created', {
        noteId: rows[0].id,
        encounterId,
        providerId
      });
      
      return this._formatNote(rows[0]);
      
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error('Create note error:', error);
      throw error;
    } finally {
      client.release();
    }
  }
  
  /**
   * Update an unsigned note
   * Only allowed before signing
   */
  async updateNote(noteId, providerId, noteData) {
    // First check if note is signed
    const { rows: existing } = await db.query(
      `SELECT id, is_signed, is_locked, provider_id FROM clinical_notes WHERE id = $1`,
      [noteId]
    );
    
    if (existing.length === 0) {
      throw new Error('Note not found');
    }
    
    if (existing[0].provider_id !== providerId) {
      throw new Error('Only the authoring provider can update this note');
    }
    
    if (existing[0].is_signed || existing[0].is_locked) {
      throw new Error('Signed notes cannot be modified. Create an amendment instead.');
    }
    
    // Build update
    const updates = [];
    const values = [];
    let paramIndex = 1;
    
    if (noteData.subjective !== undefined) {
      const enc = encrypt(noteData.subjective);
      updates.push(`subjective_encrypted = $${paramIndex++}`, `subjective_iv = $${paramIndex++}`, `subjective_tag = $${paramIndex++}`);
      values.push(enc.encrypted, enc.iv, enc.tag);
    }
    
    if (noteData.objective !== undefined) {
      const enc = encrypt(noteData.objective);
      updates.push(`objective_encrypted = $${paramIndex++}`, `objective_iv = $${paramIndex++}`, `objective_tag = $${paramIndex++}`);
      values.push(enc.encrypted, enc.iv, enc.tag);
    }
    
    if (noteData.assessment !== undefined) {
      const enc = encrypt(noteData.assessment);
      updates.push(`assessment_encrypted = $${paramIndex++}`, `assessment_iv = $${paramIndex++}`, `assessment_tag = $${paramIndex++}`);
      values.push(enc.encrypted, enc.iv, enc.tag);
    }
    
    if (noteData.plan !== undefined) {
      const enc = encrypt(noteData.plan);
      updates.push(`plan_encrypted = $${paramIndex++}`, `plan_iv = $${paramIndex++}`, `plan_tag = $${paramIndex++}`);
      values.push(enc.encrypted, enc.iv, enc.tag);
    }
    
    if (noteData.vitals !== undefined) {
      const enc = encrypt(JSON.stringify(noteData.vitals));
      updates.push(`vitals_encrypted = $${paramIndex++}`, `vitals_iv = $${paramIndex++}`, `vitals_tag = $${paramIndex++}`);
      values.push(enc.encrypted, enc.iv, enc.tag);
    }
    
    if (noteData.physicalExam !== undefined) {
      const enc = encrypt(noteData.physicalExam);
      updates.push(`physical_exam_encrypted = $${paramIndex++}`, `physical_exam_iv = $${paramIndex++}`, `physical_exam_tag = $${paramIndex++}`);
      values.push(enc.encrypted, enc.iv, enc.tag);
    }
    
    if (noteData.icdCodes !== undefined) {
      updates.push(`icd_codes = $${paramIndex++}`);
      values.push(noteData.icdCodes);
    }
    
    if (noteData.cptCodes !== undefined) {
      updates.push(`cpt_codes = $${paramIndex++}`);
      values.push(noteData.cptCodes);
    }
    
    if (noteData.followUpRequired !== undefined) {
      updates.push(`follow_up_required = $${paramIndex++}`);
      values.push(noteData.followUpRequired);
    }
    
    if (noteData.followUpInterval !== undefined) {
      updates.push(`follow_up_interval = $${paramIndex++}`);
      values.push(noteData.followUpInterval);
    }
    
    if (noteData.followUpNotes !== undefined) {
      updates.push(`follow_up_notes = $${paramIndex++}`);
      values.push(noteData.followUpNotes);
    }
    
    if (updates.length === 0) {
      throw new Error('No fields to update');
    }
    
    values.push(noteId);
    
    const { rows } = await db.query(
      `UPDATE clinical_notes SET ${updates.join(', ')}, updated_at = NOW()
       WHERE id = $${paramIndex}
       RETURNING *`,
      values
    );
    
    logger.info('Clinical note updated', { noteId, providerId });
    
    return this._formatNote(rows[0]);
  }
  
  /**
   * Sign and lock a clinical note
   * Creates a cryptographic hash of the note content for integrity verification
   */
  async signNote(noteId, providerId) {
    const client = await db.pool.connect();
    
    try {
      await client.query('BEGIN');
      
      // Get note
      const { rows: notes } = await client.query(
        `SELECT * FROM clinical_notes WHERE id = $1 FOR UPDATE`,
        [noteId]
      );
      
      if (notes.length === 0) {
        throw new Error('Note not found');
      }
      
      const note = notes[0];
      
      if (note.provider_id !== providerId) {
        throw new Error('Only the authoring provider can sign this note');
      }
      
      if (note.is_signed) {
        throw new Error('Note is already signed');
      }
      
      // Create signature hash of encrypted content
      const contentToHash = [
        note.subjective_encrypted,
        note.objective_encrypted,
        note.assessment_encrypted,
        note.plan_encrypted,
        note.vitals_encrypted,
        note.physical_exam_encrypted,
        JSON.stringify(note.icd_codes),
        JSON.stringify(note.cpt_codes)
      ].filter(Boolean).join('|');
      
      const signatureHash = crypto
        .createHash('sha512')
        .update(contentToHash + providerId + new Date().toISOString())
        .digest('hex');
      
      // Sign and lock
      const { rows } = await client.query(
        `UPDATE clinical_notes SET
          is_signed = true,
          signed_at = NOW(),
          signature_hash = $1,
          is_locked = true,
          locked_at = NOW(),
          locked_reason = 'signed'
         WHERE id = $2
         RETURNING *`,
        [signatureHash, noteId]
      );
      
      await client.query('COMMIT');
      
      logger.info('Clinical note signed', { noteId, providerId, signatureHash: signatureHash.substring(0, 16) + '...' });
      
      return this._formatNote(rows[0]);
      
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error('Sign note error:', error);
      throw error;
    } finally {
      client.release();
    }
  }
  
  /**
   * Create an amendment to a signed note
   * Amendments are new note versions, preserving the original
   */
  async createAmendment(originalNoteId, providerId, amendmentData) {
    const client = await db.pool.connect();
    
    try {
      await client.query('BEGIN');
      
      // Get original note
      const { rows: originals } = await client.query(
        `SELECT * FROM clinical_notes WHERE id = $1`,
        [originalNoteId]
      );
      
      if (originals.length === 0) {
        throw new Error('Original note not found');
      }
      
      const original = originals[0];
      if (original.provider_id !== providerId) {
        throw new Error('Only the authoring provider can amend this note');
      }
      
      if (!original.is_signed) {
        throw new Error('Can only amend signed notes');
      }
      
      if (!amendmentData.reason) {
        throw new Error('Amendment reason is required');
      }
      
      // Get current max version for this note chain
      const { rows: versionResult } = await client.query(
        `SELECT MAX(version) as max_version FROM clinical_notes 
         WHERE encounter_id = $1 AND (id = $2 OR parent_note_id = $2)`,
        [original.encounter_id, originalNoteId]
      );
      
      const newVersion = (versionResult[0].max_version || 1) + 1;
      
      // Create amendment note
      const subjective = amendmentData.subjective ? encrypt(amendmentData.subjective) : { encrypted: null, iv: null, tag: null };
      const objective = amendmentData.objective ? encrypt(amendmentData.objective) : { encrypted: null, iv: null, tag: null };
      const assessment = amendmentData.assessment ? encrypt(amendmentData.assessment) : { encrypted: null, iv: null, tag: null };
      const plan = amendmentData.plan ? encrypt(amendmentData.plan) : { encrypted: null, iv: null, tag: null };
      
      const { rows } = await client.query(
        `INSERT INTO clinical_notes (
          encounter_id, patient_id, provider_id, note_type,
          version, parent_note_id, is_amendment, amendment_reason,
          subjective_encrypted, subjective_iv, subjective_tag,
          objective_encrypted, objective_iv, objective_tag,
          assessment_encrypted, assessment_iv, assessment_tag,
          plan_encrypted, plan_iv, plan_tag,
          icd_codes, cpt_codes
        ) VALUES ($1, $2, $3, 'amendment', $4, $5, true, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
        RETURNING *`,
        [
          original.encounter_id,
          original.patient_id,
          providerId,
          newVersion,
          originalNoteId,
          amendmentData.reason,
          subjective.encrypted, subjective.iv, subjective.tag,
          objective.encrypted, objective.iv, objective.tag,
          assessment.encrypted, assessment.iv, assessment.tag,
          plan.encrypted, plan.iv, plan.tag,
          amendmentData.icdCodes || original.icd_codes,
          amendmentData.cptCodes || original.cpt_codes
        ]
      );
      
      await client.query('COMMIT');
      
      logger.info('Amendment created', {
        amendmentId: rows[0].id,
        originalNoteId,
        version: newVersion,
        providerId
      });
      
      return this._formatNote(rows[0]);
      
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error('Create amendment error:', error);
      throw error;
    } finally {
      client.release();
    }
  }
  
  /**
   * Get note by ID with decrypted content
   */
  async getNoteById(noteId, userId, userRole) {
    const { rows } = await db.query(
      `SELECT cn.*,
              pr.first_name as provider_first_name, pr.last_name as provider_last_name,
              pr.credentials as provider_credentials
       FROM clinical_notes cn
       JOIN users pr ON pr.id = cn.provider_id
       WHERE cn.id = $1`,
      [noteId]
    );
    
    if (rows.length === 0) {
      return null;
    }
    
    const note = rows[0];
    
    // Access control
    if (userRole === 'patient' && note.patient_id !== userId) {
      throw new Error('Access denied');
    }
    
    if (userRole === 'provider') {
      const { rows: rel } = await db.query(
        `SELECT 1 FROM provider_patient_relationships 
         WHERE provider_id = $1 AND patient_id = $2 AND is_active = true`,
        [userId, note.patient_id]
      );
      
      if (rel.length === 0 && note.provider_id !== userId) {
        throw new Error('Access denied');
      }
    }
    
    return this._formatNote(note, true);
  }
  
  /**
   * Get note version history
   */
  async getNoteVersionHistory(noteId, userId, userRole) {
    const accessibleNote = await this.getNoteById(noteId, userId, userRole);
    if (!accessibleNote) {
      throw new Error('Note not found');
    }

    // Get the root note
    const { rows: rootResult } = await db.query(
      `SELECT COALESCE(parent_note_id, id) as root_id FROM clinical_notes WHERE id = $1`,
      [noteId]
    );
    
    if (rootResult.length === 0) {
      throw new Error('Note not found');
    }
    
    const rootId = rootResult[0].root_id;
    
    // Get all versions
    const { rows } = await db.query(
      `SELECT cn.id, cn.version, cn.is_amendment, cn.amendment_reason,
              cn.is_signed, cn.signed_at, cn.created_at,
              pr.first_name as provider_first_name, pr.last_name as provider_last_name,
              pr.credentials as provider_credentials
       FROM clinical_notes cn
       JOIN users pr ON pr.id = cn.provider_id
       WHERE cn.id = $1 OR cn.parent_note_id = $1
       ORDER BY cn.version ASC`,
      [rootId]
    );
    
    return rows.map(keysToCamel);
  }
  
  /**
   * Get all notes for an encounter
   */
  async getEncounterNotes(encounterId, userId, userRole) {
    // First verify access to encounter
    const encounter = await this.getEncounterById(encounterId, userId, userRole);
    
    if (!encounter) {
      throw new Error('Encounter not found');
    }
    
    const { rows } = await db.query(
      `SELECT cn.*,
              pr.first_name as provider_first_name, pr.last_name as provider_last_name,
              pr.credentials as provider_credentials
       FROM clinical_notes cn
       JOIN users pr ON pr.id = cn.provider_id
       WHERE cn.encounter_id = $1
       ORDER BY cn.version ASC, cn.created_at ASC`,
      [encounterId]
    );
    
    return rows.map(r => this._formatNote(r, true));
  }
  
  // =========================================================================
  // HELPER METHODS
  // =========================================================================
  
  _formatEncounter(encounter, includeDecrypted = false) {
    const formatted = {
      id: encounter.id,
      appointmentId: encounter.appointment_id,
      patientId: encounter.patient_id,
      providerId: encounter.provider_id,
      encounterType: encounter.encounter_type,
      patientState: encounter.patient_state,
      patientLocationVerified: encounter.patient_location_verified,
      patientLocationMethod: encounter.patient_location_method,
      providerState: encounter.provider_state,
      encounterStart: encounter.encounter_start,
      encounterEnd: encounter.encounter_end,
      status: encounter.status,
      telehealthConsentId: encounter.telehealth_consent_id,
      billingStatus: encounter.billing_status,
      cptCodes: encounter.cpt_codes,
      metadata: encounter.metadata,
      createdAt: encounter.created_at,
      updatedAt: encounter.updated_at
    };
    
    // Add patient/provider names if present
    if (encounter.patient_first_name) {
      formatted.patient = {
        firstName: encounter.patient_first_name,
        lastName: encounter.patient_last_name,
        dateOfBirth: encounter.patient_dob
      };
    }
    
    if (encounter.provider_first_name) {
      formatted.provider = {
        firstName: encounter.provider_first_name,
        lastName: encounter.provider_last_name,
        credentials: encounter.provider_credentials,
        specialty: encounter.provider_specialty
      };
    }
    
    // Decrypt chief complaint if requested
    if (includeDecrypted && encounter.chief_complaint_encrypted) {
      formatted.chiefComplaint = decrypt(
        encounter.chief_complaint_encrypted,
        encounter.chief_complaint_iv,
        encounter.chief_complaint_tag
      );
    }
    
    return formatted;
  }
  
  _formatNote(note, includeDecrypted = false) {
    const formatted = {
      id: note.id,
      encounterId: note.encounter_id,
      patientId: note.patient_id,
      providerId: note.provider_id,
      noteType: note.note_type,
      version: note.version,
      parentNoteId: note.parent_note_id,
      isAmendment: note.is_amendment,
      amendmentReason: note.amendment_reason,
      icdCodes: note.icd_codes,
      cptCodes: note.cpt_codes,
      isSigned: note.is_signed,
      signedAt: note.signed_at,
      signatureHash: note.signature_hash,
      isLocked: note.is_locked,
      lockedAt: note.locked_at,
      followUpRequired: note.follow_up_required,
      followUpInterval: note.follow_up_interval,
      followUpNotes: note.follow_up_notes,
      createdAt: note.created_at,
      updatedAt: note.updated_at
    };
    
    // Add provider info if present
    if (note.provider_first_name) {
      formatted.provider = {
        firstName: note.provider_first_name,
        lastName: note.provider_last_name,
        credentials: note.provider_credentials
      };
    }
    
    // Decrypt SOAP content if requested
    if (includeDecrypted) {
      formatted.subjective = decrypt(note.subjective_encrypted, note.subjective_iv, note.subjective_tag);
      formatted.objective = decrypt(note.objective_encrypted, note.objective_iv, note.objective_tag);
      formatted.assessment = decrypt(note.assessment_encrypted, note.assessment_iv, note.assessment_tag);
      formatted.plan = decrypt(note.plan_encrypted, note.plan_iv, note.plan_tag);
      formatted.physicalExam = decrypt(note.physical_exam_encrypted, note.physical_exam_iv, note.physical_exam_tag);
      
      if (note.vitals_encrypted) {
        const vitalsStr = decrypt(note.vitals_encrypted, note.vitals_iv, note.vitals_tag);
        formatted.vitals = vitalsStr ? JSON.parse(vitalsStr) : null;
      }
    }
    
    return formatted;
  }
}

module.exports = new ClinicalEncounterService();
