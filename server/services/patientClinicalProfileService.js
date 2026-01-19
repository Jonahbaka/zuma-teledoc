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

const db = require('../db');
const logger = require('../middleware/logger');
const { encrypt, decrypt } = require('../../lib/encryption');
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
        `INSERT INTO patient_clinical_profiles (patient_id) VALUES ($1) RETURNING *`,
        [patientId]
      );
      rows = newRows;
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
      throw new Error('No valid fields to update');
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
    
    logger.info('Patient identity verified', { patientId, method: verificationMethod, verifiedBy });
    
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
    
    logger.info('Allergy added', { patientId, allergenType, createdBy });
    
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
    
    logger.info('Allergy inactivated', { allergyId, userId, reason });
    
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
    
    logger.info('Problem added', { patientId, icd10Code, documentedBy });
    
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
      throw new Error('No valid fields to update');
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
    
    logger.info('Medication added', { patientId, medicationType, createdBy });
    
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
    
    logger.info('Medication discontinued', { medicationId, userId, reason });
    
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
    
    // Fetch all clinical data in parallel
    const [profile, allergies, problems, medications] = await Promise.all([
      this.getOrCreateProfile(patientId),
      this.getAllergies(patientId),
      this.getProblems(patientId),
      this.getMedications(patientId)
    ]);
    
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
      formatted.allergen = decrypt(allergy.allergen_encrypted, allergy.allergen_iv, allergy.allergen_tag);
      formatted.reaction = decrypt(allergy.reaction_encrypted, allergy.reaction_iv, allergy.reaction_tag);
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
    
    if (includeDecrypted && problem.problem_description_encrypted) {
      formatted.problemDescription = decrypt(
        problem.problem_description_encrypted,
        problem.problem_description_iv,
        problem.problem_description_tag
      );
    }
    
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
      formatted.medicationName = decrypt(
        medication.medication_name_encrypted,
        medication.medication_name_iv,
        medication.medication_name_tag
      );
      formatted.dosage = decrypt(
        medication.dosage_encrypted,
        medication.dosage_iv,
        medication.dosage_tag
      );
    }
    
    return formatted;
  }
}

module.exports = new PatientClinicalProfileService();
