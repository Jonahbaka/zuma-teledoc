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
const database = require('../db');
const { AsyncLocalStorage } = require('node:async_hooks');
const clinicalReadContext = new AsyncLocalStorage();
const db = { query(...args) {
  const context = clinicalReadContext.getStore();
  if (!context) throw clinicalError(403, 'CLINICAL_ACCESS_DENIED', 'A current clinical read transaction is required.');
  return context.client.query(...args);
}, getPool: () => database.getPool() };
const logger = require('../middleware/logger');
const { encrypt } = require('../../lib/encryption');
const { readClinicalField } = require('./clinicalContentService');
const { keysToCamel } = require('../../lib/utils');
const clinicalError = (statusCode, code, message) => Object.assign(new Error(message), { statusCode, code });
const uuid = /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i;
const readableContext = `JOIN users patient ON patient.id=ce.patient_id AND patient.role='patient' AND patient.is_active=TRUE
  JOIN users author ON author.id=ce.provider_id AND author.role='provider'
  JOIN users actor ON actor.id=$2 AND actor.role=$3 AND actor.is_active=TRUE AND actor.market_scope=$4
  WHERE patient.market_scope=actor.market_scope AND author.market_scope=actor.market_scope
    AND (actor.role='patient' AND ce.patient_id=actor.id OR actor.role='provider' AND actor.provider_status='approved'
      AND (actor.market_scope='US' OR EXISTS(SELECT 1 FROM ng_providers np WHERE np.user_id=actor.id AND np.status='verified'))
      AND (ce.provider_id=actor.id OR EXISTS(SELECT 1 FROM provider_patient_relationships rel WHERE rel.provider_id=actor.id AND rel.patient_id=ce.patient_id AND rel.is_active=TRUE)))`;

class ClinicalEncounterService {
  _references(...values) {
    if (!values.every(value => typeof value === 'string' && uuid.test(value))) throw clinicalError(400, 'CLINICAL_REFERENCE_INVALID', 'Valid clinical record and account references are required.');
  }

  async _reader(userId, userRole) {
    this._references(userId);
    if (!['patient', 'provider'].includes(userRole)) throw clinicalError(403, 'CLINICAL_ACCESS_DENIED', 'Clinical record access denied.');
    const user = (await db.query('SELECT id,role,is_active,market_scope,provider_status FROM users WHERE id=$1 FOR SHARE', [userId])).rows[0];
    if (!user?.is_active || user.role !== userRole || !['US', 'NG'].includes(user.market_scope) || userRole === 'provider' && user.provider_status !== 'approved') throw clinicalError(403, 'CLINICAL_ACCESS_DENIED', 'Clinical record access denied.');
    return user;
  }

  async _lockAccounts(client, patientId, providerId) {
    const row = (await client.query(`SELECT patient.id,actor.market_scope FROM users patient JOIN users actor ON actor.id=$2
      WHERE patient.id=$1 AND patient.role='patient' AND patient.is_active=TRUE
        AND actor.role='provider' AND actor.is_active=TRUE AND actor.provider_status='approved'
        AND actor.market_scope IN ('US','NG') AND patient.market_scope=actor.market_scope FOR SHARE OF patient,actor`, [patientId, providerId])).rows[0];
    if (!row) throw clinicalError(403, 'CLINICAL_CONTEXT_DENIED', 'The current patient and clinician context is unavailable.');
    if (row.market_scope === 'NG' && !(await client.query("SELECT id FROM ng_providers WHERE user_id=$1 AND status='verified' FOR SHARE", [providerId])).rows.length) throw clinicalError(403, 'CLINICAL_CONTEXT_DENIED', 'Verified clinician authority is required.');
    return row;
  }

  async _lockAppointment(client, appointmentId, patientId, providerId, { allowCompleted = false } = {}) {
    const row = (await client.query(`SELECT id,status FROM appointments WHERE id=$1 AND patient_id=$2 AND provider_id=$3
      AND status NOT IN ('cancelled','no_show') ${allowCompleted ? '' : "AND status<>'completed'"} FOR UPDATE`, [appointmentId, patientId, providerId])).rows[0];
    if (!row) throw clinicalError(403, 'CLINICAL_APPOINTMENT_MISMATCH', 'The consultation is unavailable for this patient and clinician.');
    return row;
  }

  async _lockEncounter(client, encounterId, providerId, { allowCompleted = false } = {}) {
    this._references(encounterId, providerId);
    const encounter = (await client.query('SELECT * FROM clinical_encounters WHERE id=$1 FOR UPDATE', [encounterId])).rows[0];
    if (!encounter || encounter.provider_id !== providerId) throw clinicalError(403, 'CLINICAL_CONTEXT_DENIED', 'This encounter is not available to the current clinician.');
    await this._lockAccounts(client, encounter.patient_id, providerId);
    if (!(allowCompleted ? ['in_progress', 'completed'] : ['in_progress']).includes(encounter.status)) throw clinicalError(409, 'CLINICAL_ENCOUNTER_IMMUTABLE', 'This encounter no longer accepts draft changes.');
    if (encounter.appointment_id) await this._lockAppointment(client, encounter.appointment_id, encounter.patient_id, providerId, { allowCompleted });
    return encounter;
  }

  async _lockNote(client, noteId, providerId, options) {
    this._references(noteId, providerId);
    const hint = (await client.query('SELECT encounter_id FROM clinical_notes WHERE id=$1', [noteId])).rows[0];
    if (!hint) throw clinicalError(403, 'CLINICAL_CONTEXT_DENIED', 'This note is not available to the current clinician.');
    const encounter = await this._lockEncounter(client, hint.encounter_id, providerId, { allowCompleted: true });
    const note = (await client.query('SELECT * FROM clinical_notes WHERE id=$1 AND encounter_id=$2 AND patient_id=$3 AND provider_id=$4 FOR UPDATE', [noteId, encounter.id, encounter.patient_id, providerId])).rows[0];
    if (!note) throw clinicalError(403, 'CLINICAL_CONTEXT_DENIED', 'This note does not match its clinical encounter.');
    if (encounter.status === 'completed' && !options?.allowCompleted && !note.is_signed && !note.is_locked) {
      const root = note.is_amendment && note.parent_note_id && (await client.query(`SELECT id FROM clinical_notes
        WHERE id=$1 AND parent_note_id IS NULL AND encounter_id=$2 AND patient_id=$3 AND provider_id=$4 AND is_signed=TRUE FOR SHARE`,
      [note.parent_note_id, encounter.id, encounter.patient_id, providerId])).rows[0];
      if (!root) throw clinicalError(409, 'CLINICAL_ENCOUNTER_IMMUTABLE', 'Only an append-only amendment to a signed note can be completed after this encounter closes.');
    }
    return note;
  }

  async _audit(client, providerId, type, row, action, metadata) {
    await client.query(`INSERT INTO audit_logs (user_id,action,resource_type,resource_id,patient_id,description,new_values,phi_accessed,success)
      VALUES ($1,$2,$3,$4,$5,'Current authorized encounter-bound clinical record operation',$6::jsonb,TRUE,TRUE)`,
    [providerId, action, type, row.id, row.patient_id, JSON.stringify(metadata)]);
  }

  _recordRead(rows, type) {
    const context = clinicalReadContext.getStore();
    if (!context) throw clinicalError(403, 'CLINICAL_ACCESS_DENIED', 'A current clinical read transaction is required.');
    for (const row of rows) context.records.set(type + ':' + row.id, { type, id: row.id, patient_id: row.patient_id });
  }
  
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
    this._references(data?.patientId, providerId);
    if (data.appointmentId) this._references(data.appointmentId);
    if (data.telehealthConsentId) this._references(data.telehealthConsentId);
    const client = await db.getPool().connect();
    
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
      
      await this._lockAccounts(client, patientId, providerId);
      if (appointmentId) await this._lockAppointment(client, appointmentId, patientId, providerId);
      else if (!(await client.query('SELECT id FROM provider_patient_relationships WHERE provider_id=$1 AND patient_id=$2 AND is_active=TRUE FOR SHARE', [providerId, patientId])).rows.length) throw clinicalError(403, 'CLINICAL_RELATIONSHIP_REQUIRED', 'An owned consultation or active care relationship is required.');
      
      // Verify valid telehealth consent if required for telehealth encounters
      if (encounterType.startsWith('telehealth')) {
        if (!telehealthConsentId) throw clinicalError(400, 'CONSENT_REQUIRED', 'Valid recorded telehealth consent is required.');
        const { rows: consents } = await client.query(
          `SELECT id FROM telehealth_consents 
           WHERE id = $1 AND patient_id = $2 AND patient_state=$3 AND is_valid = true AND revoked_at IS NULL
           AND (expires_at IS NULL OR expires_at > NOW()) FOR SHARE`,
          [telehealthConsentId, patientId, patientState]
        );
        
        if (consents.length === 0) {
          throw clinicalError(400, 'CONSENT_REQUIRED', 'Valid recorded telehealth consent is required.');
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
      if (!encounter) throw clinicalError(503, 'CLINICAL_RECORDING_UNAVAILABLE', 'Encounter recording could not be confirmed.');
      
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
          `UPDATE appointments SET status = 'in_progress', started_at = NOW() WHERE id = $1 AND patient_id=$2 AND provider_id=$3`,
          [appointmentId, patientId, providerId]
        );
      }
      
      await this._audit(client, providerId, 'clinical_encounter', encounter, 'create', { status: encounter.status, appointmentId: appointmentId || null, telehealthConsentId: telehealthConsentId || null });
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
    this._references(encounterId, providerId);
    const client = await db.getPool().connect();
    try {
      await client.query('BEGIN');
      const encounter = await this._lockEncounter(client, encounterId, providerId);
      const { rows } = await client.query(`UPDATE clinical_encounters SET encounter_end=NOW(),encounter_end_time=NOW(),status='completed',updated_at=NOW()
        WHERE id=$1 AND provider_id=$2 AND status='in_progress' RETURNING *`, [encounterId, providerId]);
      if (!rows[0]) throw clinicalError(409, 'CLINICAL_ENCOUNTER_IMMUTABLE', 'Encounter completion could not be confirmed.');
      if (encounter.appointment_id) await client.query("UPDATE appointments SET status='completed',completed_at=NOW() WHERE id=$1 AND patient_id=$2 AND provider_id=$3", [encounter.appointment_id, encounter.patient_id, providerId]);
      await this._audit(client, providerId, 'clinical_encounter', rows[0], 'update', { status: 'completed', appointmentId: encounter.appointment_id });
      await client.query('COMMIT');
      return this._formatEncounter(rows[0]);
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }
  
  /**
   * Get encounter by ID with full clinical context
   */
  async getEncounterById(encounterId, userId, userRole) {
    this._references(encounterId);
    const actor = await this._reader(userId, userRole);
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
       ${readableContext} AND ce.id = $1`,
      [encounterId, userId, userRole, actor.market_scope]
    );
    
    if (rows.length === 0) {
      return null;
    }
    
    const encounter = rows[0];
    this._recordRead(rows, 'clinical_encounter');
    return this._formatEncounter(encounter, true);
  }
  
  /**
   * Get patient's encounter history
   */
  async getPatientEncounters(patientId, options = {}) {
    this._references(patientId);
    const { limit = 50, offset = 0, status, userId, userRole } = options;
    const actor = await this._reader(userId, userRole);
    if (!Number.isInteger(limit) || limit < 1 || limit > 200 || !Number.isInteger(offset) || offset < 0 || status !== undefined && (typeof status !== 'string' || status.length > 50)) throw clinicalError(400, 'CLINICAL_LIST_INVALID', 'Invalid clinical list controls.');
    
    let query = `
      SELECT ce.*,
             pr.first_name as provider_first_name, pr.last_name as provider_last_name,
             pr.credentials as provider_credentials
      FROM clinical_encounters ce
      JOIN users pr ON pr.id = ce.provider_id
      ${readableContext} AND ce.patient_id = $1
    `;
    const params = [patientId, userId, userRole, actor.market_scope];
    let paramIndex = 5;
    
    if (status) {
      query += ` AND ce.status = $${paramIndex++}`;
      params.push(status);
    }
    
    query += ` ORDER BY ce.encounter_start DESC LIMIT $${paramIndex++} OFFSET $${paramIndex}`;
    params.push(limit, offset);
    
    const { rows } = await db.query(query, params);
    this._recordRead(rows, 'clinical_encounter');
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
    this._references(encounterId, providerId);
    const client = await db.getPool().connect();
    
    try {
      await client.query('BEGIN');
      
      const encounter = await this._lockEncounter(client, encounterId, providerId);
      
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
      
      if (!rows[0]) throw clinicalError(503, 'CLINICAL_RECORDING_UNAVAILABLE', 'Note recording could not be confirmed.');
      await this._audit(client, providerId, 'clinical_note', rows[0], 'create', { encounterId, version: rows[0].version, signed: false });
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
    this._references(noteId, providerId);
    const client = await db.getPool().connect();
    try {
      await client.query('BEGIN');
      const existing = await this._lockNote(client, noteId, providerId);
      if (existing.is_signed || existing.is_locked) throw clinicalError(409, 'CLINICAL_NOTE_IMMUTABLE', 'Signed or locked notes cannot be modified. Create an amendment instead.');
    
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
      throw clinicalError(400, 'CLINICAL_NOTE_UPDATE_INVALID', 'No valid note changes were supplied.');
    }
    
    values.push(noteId, providerId);
    
    const { rows } = await client.query(
      `UPDATE clinical_notes SET ${updates.join(', ')}, updated_at = NOW()
       WHERE id = $${paramIndex} AND provider_id=$${paramIndex + 1} AND is_signed IS NOT TRUE AND is_locked IS NOT TRUE
       RETURNING *`,
      values
    );
    
    if (!rows[0]) throw clinicalError(409, 'CLINICAL_NOTE_IMMUTABLE', 'The note no longer accepts draft changes.');
    await this._audit(client, providerId, 'clinical_note', rows[0], 'update', { encounterId: existing.encounter_id, version: existing.version, signed: false, changedFields: Object.keys(noteData) });
    await client.query('COMMIT');
    logger.info('Clinical note updated', { noteId, providerId });
    
    return this._formatNote(rows[0]);
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }
  
  /**
   * Sign and lock a clinical note
   * Creates a cryptographic hash of the note content for integrity verification
   */
  async signNote(noteId, providerId) {
    this._references(noteId, providerId);
    const client = await db.getPool().connect();
    
    try {
      await client.query('BEGIN');
      
      const note = await this._lockNote(client, noteId, providerId);
      if (note.is_signed || note.is_locked) throw clinicalError(409, 'CLINICAL_NOTE_IMMUTABLE', 'This note is already signed or locked.');
      
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
         WHERE id = $2 AND provider_id=$3 AND is_signed IS NOT TRUE AND is_locked IS NOT TRUE
         RETURNING *`,
        [signatureHash, noteId, providerId]
      );
      
      if (!rows[0]) throw clinicalError(409, 'CLINICAL_NOTE_IMMUTABLE', 'The note no longer accepts a signature.');
      await this._audit(client, providerId, 'clinical_note', rows[0], 'update', { encounterId: note.encounter_id, version: note.version, signed: true, signatureHash });
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
    this._references(originalNoteId, providerId);
    if (typeof amendmentData?.reason !== 'string' || amendmentData.reason.trim().length < 3 || amendmentData.reason.trim().length > 2000) throw clinicalError(400, 'CLINICAL_AMENDMENT_REASON_INVALID', 'A reason of 3–2000 characters is required.');
    const client = await db.getPool().connect();
    
    try {
      await client.query('BEGIN');
      
      const original = await this._lockNote(client, originalNoteId, providerId, { allowCompleted: true });
      if (original.provider_id !== providerId) {
        throw clinicalError(403, 'CLINICAL_CONTEXT_DENIED', 'Only the authoring provider can amend this note');
      }
      
      if (!original.is_signed) {
        throw clinicalError(409, 'CLINICAL_NOTE_NOT_SIGNED', 'Only signed notes can be amended.');
      }
      
      const rootId = original.parent_note_id || original.id;
      const root = await this._lockNote(client, rootId, providerId, { allowCompleted: true });
      if (root.parent_note_id || root.encounter_id !== original.encounter_id || !root.is_signed) throw clinicalError(409, 'CLINICAL_NOTE_CHAIN_INVALID', 'The signed note history requires reconciliation.');
      
      // Get current max version for this note chain
      const { rows: versionResult } = await client.query(
        `SELECT MAX(version) as max_version FROM clinical_notes 
         WHERE encounter_id = $1 AND (id = $2 OR parent_note_id = $2)`,
        [original.encounter_id, rootId]
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
          rootId,
          amendmentData.reason.trim(),
          subjective.encrypted, subjective.iv, subjective.tag,
          objective.encrypted, objective.iv, objective.tag,
          assessment.encrypted, assessment.iv, assessment.tag,
          plan.encrypted, plan.iv, plan.tag,
          amendmentData.icdCodes || original.icd_codes,
          amendmentData.cptCodes || original.cpt_codes
        ]
      );
      
      if (!rows[0]) throw clinicalError(503, 'CLINICAL_RECORDING_UNAVAILABLE', 'Amendment recording could not be confirmed.');
      await this._audit(client, providerId, 'clinical_note', rows[0], 'create', { encounterId: original.encounter_id, rootNoteId: rootId, amendedNoteId: original.id, version: newVersion, reasonEncrypted: encrypt(amendmentData.reason.trim()) });
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
    this._references(noteId);
    const rows = await this._readNotes(userId, userRole, { noteId });
    return rows[0] ? this._formatNote(rows[0], true) : null;
  }

  async _readNotes(userId, userRole, { noteId, encounterId, rootId } = {}) {
    const actor = await this._reader(userId, userRole);
    // The canonical note schema has no approved patient-release fields or
    // release workflow. A signature alone does not establish patient release.
    if (userRole === 'patient') throw clinicalError(403, 'CLINICAL_NOTE_RELEASE_NOT_CONFIGURED', 'Clinical notes are not available through a configured patient-release workflow.');
    const params = [noteId || encounterId, userId, userRole, actor.market_scope];
    let constraint = noteId ? 'cn.id=$1' : 'cn.encounter_id=$1';
    if (rootId) { this._references(rootId); params.push(rootId); constraint += ' AND (cn.id=$5 OR cn.parent_note_id=$5)'; }
    const rows = (await db.query(`SELECT cn.*,author.first_name AS provider_first_name,author.last_name AS provider_last_name,author.credentials AS provider_credentials
      FROM clinical_notes cn JOIN clinical_encounters ce ON ce.id=cn.encounter_id AND ce.patient_id=cn.patient_id AND ce.provider_id=cn.provider_id
      ${readableContext} AND ${constraint} ORDER BY cn.version ASC,cn.created_at ASC`, params)).rows;
    this._recordRead(rows, 'clinical_note');
    return rows;
  }
  
  /**
   * Get note version history
   */
  async getNoteVersionHistory(noteId, userId, userRole) {
    const accessibleNote = await this.getNoteById(noteId, userId, userRole);
    if (!accessibleNote) {
      throw clinicalError(404, 'CLINICAL_RECORD_NOT_FOUND', 'Note not found.');
    }

    const rows = await this._readNotes(userId, userRole, { encounterId: accessibleNote.encounterId, rootId: accessibleNote.parentNoteId || accessibleNote.id });
    return rows.map(note => keysToCamel({ id: note.id, version: note.version, is_amendment: note.is_amendment, amendment_reason: note.amendment_reason,
      is_signed: note.is_signed, signed_at: note.signed_at, created_at: note.created_at, provider_first_name: note.provider_first_name, provider_last_name: note.provider_last_name, provider_credentials: note.provider_credentials }));
  }
  
  /**
   * Get all notes for an encounter
   */
  async getEncounterNotes(encounterId, userId, userRole) {
    this._references(encounterId);
    // First verify access to encounter
    const encounter = await this.getEncounterById(encounterId, userId, userRole);
    
    if (!encounter) {
      throw clinicalError(404, 'CLINICAL_RECORD_NOT_FOUND', 'Encounter not found.');
    }
    
    const rows = await this._readNotes(userId, userRole, { encounterId });
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
    if (includeDecrypted) formatted.chiefComplaint = readClinicalField(encounter, 'chief_complaint', encounter.chief_complaint || null);
    
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
      formatted.subjective = readClinicalField(note, 'subjective', note.subjective || null);
      formatted.objective = readClinicalField(note, 'objective', note.objective || null);
      formatted.assessment = readClinicalField(note, 'assessment', note.assessment || null);
      formatted.plan = readClinicalField(note, 'plan', note.plan || null);
      formatted.physicalExam = readClinicalField(note, 'physical_exam', note.physical_exam || null);
      const vitalsStr = readClinicalField(note, 'vitals');
      if (vitalsStr !== null) {
        try { formatted.vitals = JSON.parse(vitalsStr); }
        catch (_error) { throw clinicalError(503, 'CLINICAL_DECRYPTION_UNAVAILABLE', 'Protected clinical measurements could not be opened.'); }
      }
    }
    
    return formatted;
  }
}

// Every public read, including nested encounter/note history reads, uses one
// connection and commits its clinical audit before any plaintext is returned.
for (const method of ['getEncounterById', 'getPatientEncounters', 'getNoteById', 'getNoteVersionHistory', 'getEncounterNotes']) {
  const original = ClinicalEncounterService.prototype[method];
  ClinicalEncounterService.prototype[method] = async function auditedClinicalRead(...args) {
    const userId = method === 'getPatientEncounters' ? args[1]?.userId : args[1];
    const role = method === 'getPatientEncounters' ? args[1]?.userRole : args[2];
    this._references(args[0], userId);
    if (!['patient', 'provider'].includes(role)) throw clinicalError(403, 'CLINICAL_ACCESS_DENIED', 'Clinical record access denied.');
    const inherited = clinicalReadContext.getStore();
    if (inherited) {
      if (inherited.userId !== userId || inherited.role !== role) throw clinicalError(403, 'CLINICAL_ACCESS_DENIED', 'Clinical read context changed.');
      return original.apply(this, args);
    }
    const client = await database.getPool().connect();
    try {
      await client.query('BEGIN');
      const context = { client, userId, role, records: new Map() };
      const result = await clinicalReadContext.run(context, () => original.apply(this, args));
      try {
        const records = [...context.records.values()];
        for (const row of records.length ? records : [{ type: method.includes('Note') ? 'clinical_note' : 'clinical_encounter', id: null, patient_id: null }]) {
          await this._audit(client, userId, row.type, row, 'read', { operation: method });
        }
      } catch (_error) { throw clinicalError(503, 'CLINICAL_AUDIT_UNAVAILABLE', 'Clinical access could not be recorded.'); }
      await client.query('COMMIT');
      return result;
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  };
}

module.exports = new ClinicalEncounterService();
