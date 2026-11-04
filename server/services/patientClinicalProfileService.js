/**
 * Patient Clinical Profile Service
 * 
 * Manages patient clinical data for the mini-EHR:
 * - Allergy list
 * - Problem/diagnosis list
 * - Medication list (manually maintained, informational)
 * - Identity verification status
 * - Pharmacy preferences
 */

const database = require('../db');
const { AsyncLocalStorage } = require('node:async_hooks');
const { assertClinicalPatientAccess, references, denied } = require('./clinicalPatientAccessService');
// Every public operation below establishes a private, patient-bound transaction.
// Internal summary/profile calls inherit that exact context, never global storage.
const clinicalContext = new AsyncLocalStorage();
const db = { query(...args) {
  const context = clinicalContext.getStore();
  if (!context) throw denied(403, 'CLINICAL_ACCESS_DENIED', 'A current clinical session is required.');
  return context.client.query(...args);
} };
const logger = require('../middleware/logger');
const { encrypt } = require('../../lib/encryption');
const { readClinicalField } = require('./clinicalContentService');
const { keysToCamel } = require('../../lib/utils');

class PatientClinicalProfileService {
  
  // =========================================================================
  // CLINICAL PROFILE
  // =========================================================================
  
  /**
   * Get or create patient clinical profile
   */
  async getOrCreateProfile(patientId) {
    let { rows } = await db.query(
      `SELECT * FROM patient_clinical_profiles WHERE patient_id = $1`,
      [patientId]
    );
    
    if (rows.length === 0) {
      // Create new profile
      const { rows: newRows } = await db.query(
        `INSERT INTO patient_clinical_profiles (patient_id) VALUES ($1) ON CONFLICT(patient_id) DO NOTHING RETURNING *`,
        [patientId]
      );
      rows = newRows.length ? newRows : (await db.query('SELECT * FROM patient_clinical_profiles WHERE patient_id=$1', [patientId])).rows;
      if (newRows.length) await auditChange(clinicalContext.getStore(), 'getOrCreateProfile', rows[0], { created: true });
    }
    
    return keysToCamel(rows[0]);
  }
  
  /**
   * Update patient clinical profile
   */
  async updateProfile(patientId, data, userId) {
    const allowedFields = [
      'emergency_contact_name', 'emergency_contact_phone', 'emergency_contact_relationship',
      'pcp_name', 'pcp_phone', 'pcp_fax', 'pcp_npi',
      'preferred_pharmacy_name', 'preferred_pharmacy_address', 'preferred_pharmacy_phone', 'preferred_pharmacy_npi',
      'has_advance_directive', 'advance_directive_type', 'advance_directive_notes'
    ];
    
    const updates = [];
    const values = [];
    let paramIndex = 1;
    
    for (const [key, value] of Object.entries(data)) {
      const snakeKey = key.replace(/([A-Z])/g, '_$1').toLowerCase();
      if (allowedFields.includes(snakeKey) && value !== undefined) {
        updates.push(`${snakeKey} = $${paramIndex++}`);
        values.push(value);
      }
    }
    
    if (updates.length === 0) {
      throw denied(400, 'CLINICAL_UPDATE_INVALID', 'No valid profile fields were supplied.');
    }
    
    values.push(patientId);
    
    const { rows } = await db.query(
      `UPDATE patient_clinical_profiles SET ${updates.join(', ')}, updated_at = NOW()
       WHERE patient_id = $${paramIndex}
       RETURNING *`,
      values
    );
    
    if (rows.length === 0) {
      // Profile doesn't exist, create it first
      await this.getOrCreateProfile(patientId);
      return this.updateProfile(patientId, data, userId);
    }
    
    logger.info('Patient clinical profile updated', { patientId, updatedBy: userId });
    
    return keysToCamel(rows[0]);
  }
  
  /**
   * Verify patient identity
   */
  async verifyIdentity(patientId, verificationMethod, verifiedBy) {
    const { rows } = await db.query(
      `UPDATE patient_clinical_profiles SET
        identity_verified = true,
        identity_verification_method = $1,
        identity_verified_at = NOW(),
        identity_verified_by = $2,
        updated_at = NOW()
       WHERE patient_id = $3
       RETURNING *`,
      [verificationMethod, verifiedBy, patientId]
    );
    
    if (rows.length === 0) {
      await this.getOrCreateProfile(patientId);
      return this.verifyIdentity(patientId, verificationMethod, verifiedBy);
    }
    
    logger.info('Patient identity verified', { patientId, verifiedBy });
    
    return keysToCamel(rows[0]);
  }
  
  // =========================================================================
  // ALLERGY MANAGEMENT
  // =========================================================================
  
  /**
   * Add an allergy to patient's record
   */
  async addAllergy(patientId, allergyData, createdBy) {
    const {
      allergen,
      allergenType,
      reaction,
      severity,
      onsetDate,
      source
    } = allergyData;
    
    // Encrypt PHI fields
    const allergenEnc = encrypt(allergen);
    const reactionEnc = reaction ? encrypt(reaction) : { encrypted: null, iv: null, tag: null };
    
    const { rows } = await db.query(
      `INSERT INTO patient_allergies (
        patient_id, 
        allergen_encrypted, allergen_iv, allergen_tag,
        allergen_type,
        reaction_encrypted, reaction_iv, reaction_tag,
        severity, onset_date, source, created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      RETURNING *`,
      [
        patientId,
        allergenEnc.encrypted, allergenEnc.iv, allergenEnc.tag,
        allergenType,
        reactionEnc.encrypted, reactionEnc.iv, reactionEnc.tag,
        severity || null,
        onsetDate || null,
        source || 'patient_reported',
        createdBy
      ]
    );
    
    logger.info('Allergy added', { patientId, createdBy });
    
    return this._formatAllergy(rows[0], true);
  }
  
  /**
   * Get patient's allergies
   */
  async getAllergies(patientId, includeInactive = false) {
    let query = `
      SELECT pa.*, 
             u.first_name as verified_by_first_name, u.last_name as verified_by_last_name
      FROM patient_allergies pa
      LEFT JOIN users u ON u.id = pa.verified_by
      WHERE pa.patient_id = $1
    `;
    
    if (!includeInactive) {
      query += ` AND pa.is_active = true`;
    }
    
    query += ` ORDER BY pa.allergen_type, pa.created_at`;
    
    const { rows } = await db.query(query, [patientId]);
    
    return rows.map(r => this._formatAllergy(r, true));
  }
  
  /**
   * Verify an allergy (provider action)
   */
  async verifyAllergy(allergyId, providerId) {
    const { rows } = await db.query(
      `UPDATE patient_allergies SET
        verified_by = $1,
        verified_at = NOW(),
        updated_at = NOW()
       WHERE id = $2
       RETURNING *`,
      [providerId, allergyId]
    );
    
    if (rows.length === 0) {
      throw new Error('Allergy not found');
    }
    
    logger.info('Allergy verified', { allergyId, providerId });
    
    return this._formatAllergy(rows[0], true);
  }
  
  /**
   * Inactivate an allergy (soft delete)
   */
  async inactivateAllergy(allergyId, userId, reason) {
    const { rows } = await db.query(
      `UPDATE patient_allergies SET
        is_active = false,
        inactivated_at = NOW(),
        inactivated_by = $1,
        inactivation_reason = $2,
        updated_at = NOW()
       WHERE id = $3
       RETURNING *`,
      [userId, reason, allergyId]
    );
    
    if (rows.length === 0) {
      throw new Error('Allergy not found');
    }
    
    logger.info('Allergy inactivated', { allergyId, userId });
    
    return this._formatAllergy(rows[0], true);
  }
  
  // =========================================================================
  // PROBLEM LIST / DIAGNOSES
  // =========================================================================
  
  /**
   * Add a problem/diagnosis
   */
  async addProblem(patientId, problemData, documentedBy) {
    const {
      icd10Code,
      icd10Description,
      problemDescription,
      problemType,
      priority,
      onsetDate,
      encounterId
    } = problemData;
    
    // Encrypt problem description
    const descEnc = problemDescription 
      ? encrypt(problemDescription) 
      : { encrypted: null, iv: null, tag: null };
    
    const { rows } = await db.query(
      `INSERT INTO patient_problems (
        patient_id, encounter_id, icd10_code, icd10_description,
        problem_description_encrypted, problem_description_iv, problem_description_tag,
        problem_type, priority, onset_date, documented_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING *`,
      [
        patientId,
        encounterId || null,
        icd10Code || null,
        icd10Description || null,
        descEnc.encrypted, descEnc.iv, descEnc.tag,
        problemType || 'chronic',
        priority || 'secondary',
        onsetDate || null,
        documentedBy
      ]
    );
    
    logger.info('Problem added', { patientId, documentedBy });
    
    return this._formatProblem(rows[0], true);
  }
  
  /**
   * Get patient's problem list
   */
  async getProblems(patientId, options = {}) {
    const { includeInactive = false, problemType } = options;
    
    let query = `
      SELECT pp.*,
             u.first_name as documented_by_first_name, u.last_name as documented_by_last_name
      FROM patient_problems pp
      LEFT JOIN users u ON u.id = pp.documented_by
      WHERE pp.patient_id = $1
    `;
    const params = [patientId];
    let paramIndex = 2;
    
    if (!includeInactive) {
      query += ` AND pp.is_active = true`;
    }
    
    if (problemType) {
      query += ` AND pp.problem_type = $${paramIndex++}`;
      params.push(problemType);
    }
    
    query += ` ORDER BY pp.priority, pp.onset_date DESC`;
    
    const { rows } = await db.query(query, params);
    
    return rows.map(r => this._formatProblem(r, true));
  }
  
  /**
   * Update problem status
   */
  async updateProblem(problemId, updates, userId) {
    const allowedUpdates = ['problem_type', 'priority', 'resolved_date', 'is_active'];
    const updateClauses = [];
    const values = [];
    let paramIndex = 1;
    
    for (const [key, value] of Object.entries(updates)) {
      const snakeKey = key.replace(/([A-Z])/g, '_$1').toLowerCase();
      if (allowedUpdates.includes(snakeKey) && value !== undefined) {
        updateClauses.push(`${snakeKey} = $${paramIndex++}`);
        values.push(value);
      }
    }
    
    if (updateClauses.length === 0) {
      throw denied(400, 'CLINICAL_UPDATE_INVALID', 'No valid problem fields were supplied.');
    }
    
    values.push(problemId);
    
    const { rows } = await db.query(
      `UPDATE patient_problems SET ${updateClauses.join(', ')}, updated_at = NOW()
       WHERE id = $${paramIndex}
       RETURNING *`,
      values
    );
    
    if (rows.length === 0) {
      throw new Error('Problem not found');
    }
    
    logger.info('Problem updated', { problemId, userId });
    
    return this._formatProblem(rows[0], true);
  }
  
  // =========================================================================
  // MEDICATION LIST (Manually Maintained)
  // =========================================================================
  
  /**
   * Add a medication to the list
   */
  async addMedication(patientId, medicationData, createdBy) {
    const {
      medicationName,
      dosage,
      frequency,
      route,
      medicationType,
      isPrn,
      source,
      prescriberName,
      startDate,
      endDate
    } = medicationData;
    
    // Encrypt medication name and dosage
    const nameEnc = encrypt(medicationName);
    const dosageEnc = dosage ? encrypt(dosage) : { encrypted: null, iv: null, tag: null };
    
    const { rows } = await db.query(
      `INSERT INTO patient_medications (
        patient_id,
        medication_name_encrypted, medication_name_iv, medication_name_tag,
        dosage_encrypted, dosage_iv, dosage_tag,
        frequency, route, medication_type, is_prn,
        source, prescriber_name, start_date, end_date, created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
      RETURNING *`,
      [
        patientId,
        nameEnc.encrypted, nameEnc.iv, nameEnc.tag,
        dosageEnc.encrypted, dosageEnc.iv, dosageEnc.tag,
        frequency || null,
        route || null,
        medicationType || 'prescription',
        isPrn || false,
        source || 'patient_reported',
        prescriberName || null,
        startDate || null,
        endDate || null,
        createdBy
      ]
    );
    
    logger.info('Medication added', { patientId, createdBy });
    
    return this._formatMedication(rows[0], true);
  }
  
  /**
   * Get patient's medication list
   */
  async getMedications(patientId, includeInactive = false) {
    let query = `
      SELECT pm.*,
             u.first_name as created_by_first_name, u.last_name as created_by_last_name
      FROM patient_medications pm
      LEFT JOIN users u ON u.id = pm.created_by
      WHERE pm.patient_id = $1
    `;
    
    if (!includeInactive) {
      query += ` AND pm.is_active = true`;
    }
    
    query += ` ORDER BY pm.medication_type, pm.created_at DESC`;
    
    const { rows } = await db.query(query, [patientId]);
    
    return rows.map(r => this._formatMedication(r, true));
  }
  
  /**
   * Discontinue a medication
   */
  async discontinueMedication(medicationId, userId, reason) {
    const { rows } = await db.query(
      `UPDATE patient_medications SET
        is_active = false,
        discontinued_at = NOW(),
        discontinued_by = $1,
        discontinuation_reason = $2,
        updated_at = NOW()
       WHERE id = $3
       RETURNING *`,
      [userId, reason, medicationId]
    );
    
    if (rows.length === 0) {
      throw new Error('Medication not found');
    }
    
    logger.info('Medication discontinued', { medicationId, userId });
    
    return this._formatMedication(rows[0], true);
  }
  
  // =========================================================================
  // COMPLETE CLINICAL SUMMARY
  // =========================================================================
  
  /**
   * Get complete clinical summary for a patient
   */
  async getClinicalSummary(patientId, userId, userRole) {
    // Access control
    if (userRole === 'patient' && patientId !== userId) {
      throw new Error('Access denied');
    }
    
    if (userRole === 'provider') {
      // Check provider-patient relationship
      const { rows: rel } = await db.query(
        `SELECT 1 FROM provider_patient_relationships 
         WHERE provider_id = $1 AND patient_id = $2 AND is_active = true
         UNION
         SELECT 1 FROM appointments WHERE provider_id = $1 AND patient_id = $2
         LIMIT 1`,
        [userId, patientId]
      );
      
      if (rel.length === 0) {
        throw new Error('No provider-patient relationship found');
      }
    }
    
    // These reads share the same patient-bound transaction and connection.
    const profile = await this.getOrCreateProfile(patientId);
    const allergies = await this.getAllergies(patientId);
    const problems = await this.getProblems(patientId);
    const medications = await this.getMedications(patientId);
    
    return {
      profile,
      allergies,
      problems,
      medications,
      summary: {
        totalAllergies: allergies.length,
        totalActiveProblems: problems.filter(p => p.isActive).length,
        totalActiveMedications: medications.filter(m => m.isActive).length,
        identityVerified: profile.identityVerified
      }
    };
  }
  
  // =========================================================================
  // HELPER METHODS
  // =========================================================================
  
  _formatAllergy(allergy, includeDecrypted = false) {
    const formatted = {
      id: allergy.id,
      patientId: allergy.patient_id,
      allergenType: allergy.allergen_type,
      severity: allergy.severity,
      onsetDate: allergy.onset_date,
      source: allergy.source,
      isActive: allergy.is_active,
      verifiedAt: allergy.verified_at,
      inactivatedAt: allergy.inactivated_at,
      inactivationReason: allergy.inactivation_reason,
      createdAt: allergy.created_at,
      updatedAt: allergy.updated_at
    };
    
    if (allergy.verified_by_first_name) {
      formatted.verifiedBy = {
        firstName: allergy.verified_by_first_name,
        lastName: allergy.verified_by_last_name
      };
    }
    
    if (includeDecrypted) {
      formatted.allergen = readClinicalField(allergy, 'allergen', allergy.allergy_name || null);
      formatted.reaction = readClinicalField(allergy, 'reaction', allergy.reaction || null);
    }
    
    return formatted;
  }
  
  _formatProblem(problem, includeDecrypted = false) {
    const formatted = {
      id: problem.id,
      patientId: problem.patient_id,
      encounterId: problem.encounter_id,
      icd10Code: problem.icd10_code,
      icd10Description: problem.icd10_description,
      problemType: problem.problem_type,
      priority: problem.priority,
      onsetDate: problem.onset_date,
      resolvedDate: problem.resolved_date,
      isActive: problem.is_active,
      documentedAt: problem.documented_at,
      createdAt: problem.created_at,
      updatedAt: problem.updated_at
    };
    
    if (problem.documented_by_first_name) {
      formatted.documentedBy = {
        firstName: problem.documented_by_first_name,
        lastName: problem.documented_by_last_name
      };
    }
    
    if (includeDecrypted) formatted.problemDescription = readClinicalField(problem, 'problem_description', problem.problem_name || null);
    
    return formatted;
  }
  
  _formatMedication(medication, includeDecrypted = false) {
    const formatted = {
      id: medication.id,
      patientId: medication.patient_id,
      frequency: medication.frequency,
      route: medication.route,
      medicationType: medication.medication_type,
      isPrn: medication.is_prn,
      source: medication.source,
      prescriberName: medication.prescriber_name,
      startDate: medication.start_date,
      endDate: medication.end_date,
      isActive: medication.is_active,
      discontinuedAt: medication.discontinued_at,
      discontinuationReason: medication.discontinuation_reason,
      createdAt: medication.created_at,
      updatedAt: medication.updated_at
    };
    
    if (medication.created_by_first_name) {
      formatted.createdBy = {
        firstName: medication.created_by_first_name,
        lastName: medication.created_by_last_name
      };
    }
    
    if (includeDecrypted) {
      formatted.medicationName = readClinicalField(medication, 'medication_name', medication.medication_name || null);
      formatted.dosage = readClinicalField(medication, 'dosage', medication.dosage || null);
    }
    
    return formatted;
  }
}

const operations = {
  getOrCreateProfile: {}, updateProfile: { write: true, actorIndex: 2 }, verifyIdentity: { write: true, providerOnly: true, actorIndex: 2 },
  addAllergy: { write: true, actorIndex: 2 }, getAllergies: {}, verifyAllergy: { write: true, providerOnly: true, actorIndex: 1, table: 'patient_allergies' },
  inactivateAllergy: { write: true, providerOnly: true, actorIndex: 1, table: 'patient_allergies', reasonIndex: 2 },
  addProblem: { write: true, providerOnly: true, actorIndex: 2 }, getProblems: {}, updateProblem: { write: true, providerOnly: true, actorIndex: 2, table: 'patient_problems' },
  addMedication: { write: true, actorIndex: 2 }, getMedications: {}, discontinueMedication: { write: true, providerOnly: true, actorIndex: 1, table: 'patient_medications', reasonIndex: 2 },
  getClinicalSummary: { actorIndex: 1, roleIndex: 2 },
};
async function auditChange(context, method, row, extra = {}) {
  if (!row) throw denied(503, 'CLINICAL_RECORDING_UNAVAILABLE', 'Clinical recording could not be confirmed.');
  await context.client.query(`INSERT INTO audit_logs (user_id,action,resource_type,resource_id,patient_id,description,new_values,phi_accessed,success)
    VALUES($1,$2,'patient_clinical_record',$3,$4,'Current authorized clinical profile operation',$5::jsonb,TRUE,TRUE)`,
  [context.actor.id, method.startsWith('add') || extra.created ? 'create' : 'update', row.id || context.patientId, context.patientId, JSON.stringify({ operation: method, ...extra })]);
}
async function auditRead(context, method, result) {
  try {
    await context.client.query(`INSERT INTO audit_logs (user_id,action,resource_type,resource_id,patient_id,description,new_values,phi_accessed,success)
      VALUES($1,'read','patient_clinical_record',$2,$3,'Current authorized clinical profile read',$4::jsonb,TRUE,TRUE)`,
    [context.actor.id, result?.id || context.patientId, context.patientId, JSON.stringify({ operation: method, ...(Array.isArray(result) ? { recordCount: result.length } : {}) })]);
  } catch (_error) {
    throw denied(503, 'CLINICAL_AUDIT_UNAVAILABLE', 'Clinical access could not be recorded.');
  }
}
function validateOperation(method, args, context, policy) {
  if (policy.providerOnly && context.actor.role !== 'provider' || policy.actorIndex !== undefined && args[policy.actorIndex] !== context.actor.id ||
    policy.roleIndex !== undefined && args[policy.roleIndex] !== context.actor.role) throw denied(403, 'CLINICAL_ACCESS_DENIED', 'The current clinical actor does not match this operation.');
  if (policy.reasonIndex !== undefined && (typeof args[policy.reasonIndex] !== 'string' || args[policy.reasonIndex].trim().length < 3 || args[policy.reasonIndex].trim().length > 2000)) throw denied(400, 'CLINICAL_REASON_REQUIRED', 'A reason of 3–2000 characters is required.');
  if (method === 'verifyIdentity' && (typeof args[1] !== 'string' || !args[1].trim() || args[1].length > 100)) throw denied(400, 'CLINICAL_VERIFICATION_INVALID', 'A valid identity verification method is required.');
  if (['addAllergy', 'addMedication'].includes(method)) {
    const name = method === 'addAllergy' ? args[1]?.allergen : args[1]?.medicationName;
    if (typeof name !== 'string' || !name.trim()) throw denied(400, 'CLINICAL_HISTORY_INVALID', 'A recorded history item is required.');
    if (['imported', 'erx_import'].includes(args[1]?.source)) throw denied(400, 'CLINICAL_SOURCE_UNVERIFIED', 'Imported history requires a verified integration.');
    args[1] = { ...args[1], source: context.actor.role === 'patient' ? 'patient_reported' : args[1]?.source || 'provider_documented' };
  }
  if (method === 'addProblem' && !['problemDescription', 'icd10Code', 'icd10Description'].some(field => typeof args[1]?.[field] === 'string' && args[1][field].trim())) throw denied(400, 'CLINICAL_HISTORY_INVALID', 'A documented clinical problem or diagnosis is required.');
}
for (const [method, policy] of Object.entries(operations)) {
  const original = PatientClinicalProfileService.prototype[method];
  PatientClinicalProfileService.prototype[method] = async function scopedClinicalOperation(...args) {
    const supplied = args[args.length - 1];
    const session = supplied && typeof supplied === 'object' && typeof supplied.id === 'string' && typeof supplied.role === 'string' ? args.pop() : null;
    const inherited = clinicalContext.getStore();
    if (inherited) {
      if (session && (session.id !== inherited.actor.id || session.role !== inherited.actor.role || session.marketScope !== inherited.actor.market_scope) || !policy.table && args[0] !== inherited.patientId) throw denied(403, 'CLINICAL_ACCESS_DENIED', 'Clinical context changed.');
      if (policy.table) {
        references(args[0]);
        const record = (await inherited.client.query(`SELECT id,patient_id${policy.table === 'patient_problems' ? ',encounter_id' : ''} FROM ${policy.table} WHERE id=$1 AND patient_id=$2 FOR UPDATE`, [args[0], inherited.patientId])).rows[0];
        if (!record) throw denied(403, 'CLINICAL_ACCESS_DENIED', 'The record does not belong to the current clinical context.');
        if (record.encounter_id) await assertClinicalPatientAccess(inherited.client, inherited.patientId, { id: inherited.actor.id, role: inherited.actor.role, marketScope: inherited.actor.market_scope }, { providerOnly: true, lock: true, encounterId: record.encounter_id });
      }
      validateOperation(method, args, inherited, policy);
      return original.apply(this, args);
    }
    references(args[0], session?.id);
    if (!['patient', 'provider'].includes(session.role) || policy.providerOnly && session.role !== 'provider') throw denied(403, 'CLINICAL_ACCESS_DENIED', 'Current clinical authority is required.');
    const client = await database.getPool().connect();
    try {
      await client.query('BEGIN');
      const hint = policy.table ? (await client.query(`SELECT id,patient_id${policy.table === 'patient_problems' ? ',encounter_id' : ''} FROM ${policy.table} WHERE id=$1 FOR UPDATE`, [args[0]])).rows[0] : null;
      if (policy.table && !hint) throw denied(404, 'CLINICAL_RECORD_NOT_FOUND', 'Clinical record not found.');
      const patientId = policy.table ? hint.patient_id : args[0];
      const actor = await assertClinicalPatientAccess(client, patientId, session, { providerOnly: policy.providerOnly, lock: true,
        encounterId: method === 'addProblem' ? args[1]?.encounterId : hint?.encounter_id });
      const context = { client, actor, patientId };
      validateOperation(method, args, context, policy);
      const result = await clinicalContext.run(context, () => original.apply(this, args));
      if (policy.write) await auditChange(context, method, result, { ...(policy.reasonIndex !== undefined ? { reasonEncrypted: encrypt(args[policy.reasonIndex].trim()) } : {}) });
      else await auditRead(context, method, result);
      await client.query('COMMIT'); return result;
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  };
}

module.exports = new PatientClinicalProfileService();
