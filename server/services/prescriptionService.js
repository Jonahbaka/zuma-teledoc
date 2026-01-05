/**
 * Prescription Service
 * Handles e-prescribing, medication management, and pharmacy routing
 */

const db = require('../db');
const logger = require('../middleware/logger');
const notificationService = require('./notifications');
const { keysToCamel } = require('../../lib/utils');

class PrescriptionService {
  /**
   * Create a new prescription
   */
  async createPrescription(prescriptionData, providerId) {
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      
      const {
        patientId,
        appointmentId,
        visitId,
        medicationName,
        genericName,
        ndcCode,
        dosageStrength,
        dosageForm,
        dosageUnit,
        routeOfAdministration,
        quantity,
        quantityUnit,
        daysSupply,
        refillsAllowed,
        dispenseAsWritten,
        scheduleClass,
        sigDirections,
        patientInstructions,
        pharmacyNotes,
        diagnosisCode,
        diagnosisDescription,
        indication,
        requiresPriorAuth,
        pharmacy
      } = prescriptionData;
      
      // Insert prescription
      const { rows } = await client.query(`
        INSERT INTO prescriptions (
          patient_id, provider_id, appointment_id, visit_id,
          medication_name, generic_name, ndc_code,
          dosage_strength, dosage_form, dosage_unit, route_of_administration,
          quantity, quantity_unit, days_supply, refills_allowed, refills_remaining,
          dispense_as_written, schedule_class, is_controlled,
          sig_directions, patient_instructions, pharmacy_notes,
          diagnosis_code, diagnosis_description, indication,
          requires_prior_auth,
          pharmacy_id, pharmacy_name, pharmacy_npi, pharmacy_address, pharmacy_phone, pharmacy_fax,
          status
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $15,
          $16, $17, $18, $19, $20, $21, $22, $23, $24, $25,
          $26, $27, $28, $29, $30, $31, 'draft'
        )
        RETURNING *
      `, [
        patientId, providerId, appointmentId || null, visitId || null,
        medicationName, genericName || null, ndcCode || null,
        dosageStrength, dosageForm, dosageUnit || null, routeOfAdministration || 'oral',
        quantity, quantityUnit || 'tablets', daysSupply, refillsAllowed || 0,
        dispenseAsWritten || false, scheduleClass || 'non-controlled',
        scheduleClass && ['II', 'III', 'IV', 'V'].includes(scheduleClass),
        sigDirections, patientInstructions || null, pharmacyNotes || null,
        diagnosisCode || null, diagnosisDescription || null, indication || null,
        requiresPriorAuth || false,
        pharmacy?.id || null, pharmacy?.name || null, pharmacy?.npi || null,
        pharmacy?.address || null, pharmacy?.phone || null, pharmacy?.fax || null
      ]);
      
      const prescription = keysToCamel(rows[0]);
      
      // Record history
      await this._recordHistory(client, prescription.id, 'created', providerId, null, prescription);
      
      await client.query('COMMIT');
      
      logger.info('Prescription created', {
        prescriptionId: prescription.id,
        providerId,
        patientId,
        medication: medicationName
      });
      
      return prescription;
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error('Create prescription error:', error);
      throw error;
    } finally {
      client.release();
    }
  }
  
  /**
   * Sign and send prescription to pharmacy
   */
  async signAndSend(prescriptionId, providerId, deaNumber = null, signature = null) {
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      
      // Get prescription
      const { rows: prescriptions } = await client.query(
        'SELECT * FROM prescriptions WHERE id = $1 AND provider_id = $2',
        [prescriptionId, providerId]
      );
      
      if (prescriptions.length === 0) {
        throw new Error('Prescription not found or unauthorized');
      }
      
      const prescription = prescriptions[0];
      
      // Validate prescription has pharmacy
      if (!prescription.pharmacy_npi && !prescription.pharmacy_name) {
        throw new Error('Pharmacy must be selected before sending prescription');
      }
      
      // Update prescription status
      const { rows: updated } = await client.query(`
        UPDATE prescriptions
        SET status = 'sent',
            signed_at = CURRENT_TIMESTAMP,
            erx_sent_at = CURRENT_TIMESTAMP,
            provider_signature = $3,
            dea_number = $4
        WHERE id = $1 AND provider_id = $2
        RETURNING *
      `, [prescriptionId, providerId, signature, deaNumber]);
      
      const updatedPrescription = keysToCamel(updated[0]);
      
      // Record history
      await this._recordHistory(
        client,
        prescriptionId,
        'signed',
        providerId,
        { status: prescription.status },
        { status: 'sent', signed_at: updated[0].signed_at }
      );
      
      await this._recordHistory(
        client,
        prescriptionId,
        'sent',
        providerId,
        null,
        { pharmacy: prescription.pharmacy_name, sent_at: updated[0].erx_sent_at }
      );
      
      // Notify patient
      await notificationService.createNotification({
        userId: prescription.patient_id,
        type: 'prescription',
        title: 'New Prescription Sent',
        message: `Your prescription for ${prescription.medication_name} has been sent to ${prescription.pharmacy_name || 'your pharmacy'}.`,
        referenceType: 'prescription',
        referenceId: prescriptionId,
        actionUrl: '/patient/prescriptions',
        actionText: 'View Prescription'
      });
      
      await client.query('COMMIT');
      
      logger.info('Prescription signed and sent', {
        prescriptionId,
        providerId,
        pharmacy: prescription.pharmacy_name
      });
      
      return updatedPrescription;
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error('Sign and send prescription error:', error);
      throw error;
    } finally {
      client.release();
    }
  }
  
  /**
   * Update prescription pharmacy
   */
  async updatePharmacy(prescriptionId, providerId, pharmacy) {
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      
      const { rows } = await client.query(`
        UPDATE prescriptions
        SET pharmacy_id = $3,
            pharmacy_name = $4,
            pharmacy_npi = $5,
            pharmacy_address = $6,
            pharmacy_phone = $7,
            pharmacy_fax = $8
        WHERE id = $1 AND provider_id = $2 AND status IN ('draft', 'pending_review')
        RETURNING *
      `, [
        prescriptionId, providerId,
        pharmacy.id || null, pharmacy.name, pharmacy.npi || null,
        pharmacy.address, pharmacy.phone || null, pharmacy.fax || null
      ]);
      
      if (rows.length === 0) {
        throw new Error('Prescription not found, unauthorized, or already sent');
      }
      
      await this._recordHistory(client, prescriptionId, 'pharmacy_changed', providerId, null, {
        pharmacy_name: pharmacy.name,
        pharmacy_npi: pharmacy.npi
      });
      
      await client.query('COMMIT');
      
      return keysToCamel(rows[0]);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
  
  /**
   * Cancel prescription
   */
  async cancelPrescription(prescriptionId, providerId, reason = null) {
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      
      const { rows } = await client.query(`
        UPDATE prescriptions
        SET status = 'cancelled',
            metadata = metadata || jsonb_build_object('cancellation_reason', $3::text)
        WHERE id = $1 AND provider_id = $2 AND status NOT IN ('picked_up', 'delivered')
        RETURNING *
      `, [prescriptionId, providerId, reason]);
      
      if (rows.length === 0) {
        throw new Error('Prescription not found, unauthorized, or already dispensed');
      }
      
      await this._recordHistory(client, prescriptionId, 'cancelled', providerId, null, {
        reason
      });
      
      // Notify patient
      await notificationService.createNotification({
        userId: rows[0].patient_id,
        type: 'prescription',
        title: 'Prescription Cancelled',
        message: `Your prescription for ${rows[0].medication_name} has been cancelled.${reason ? ` Reason: ${reason}` : ''}`,
        referenceType: 'prescription',
        referenceId: prescriptionId
      });
      
      await client.query('COMMIT');
      
      return keysToCamel(rows[0]);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
  
  /**
   * Get prescriptions for patient
   */
  async getPatientPrescriptions(patientId, options = {}) {
    const { status, limit = 50, offset = 0 } = options;
    
    let query = `
      SELECT p.*,
             prov.first_name as provider_first_name,
             prov.last_name as provider_last_name,
             prov.specialty as provider_specialty
      FROM prescriptions p
      JOIN users prov ON prov.id = p.provider_id
      WHERE p.patient_id = $1
    `;
    const params = [patientId];
    let paramIndex = 2;
    
    if (status) {
      query += ` AND p.status = $${paramIndex}`;
      params.push(status);
      paramIndex++;
    }
    
    query += ` ORDER BY p.created_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    params.push(limit, offset);
    
    const { rows } = await db.query(query, params);
    return rows.map(r => keysToCamel(r));
  }
  
  /**
   * Get prescriptions by provider
   */
  async getProviderPrescriptions(providerId, options = {}) {
    const { status, patientId, limit = 50, offset = 0 } = options;
    
    let query = `
      SELECT p.*,
             pat.first_name as patient_first_name,
             pat.last_name as patient_last_name,
             pat.date_of_birth as patient_dob
      FROM prescriptions p
      JOIN users pat ON pat.id = p.patient_id
      WHERE p.provider_id = $1
    `;
    const params = [providerId];
    let paramIndex = 2;
    
    if (status) {
      query += ` AND p.status = $${paramIndex}`;
      params.push(status);
      paramIndex++;
    }
    
    if (patientId) {
      query += ` AND p.patient_id = $${paramIndex}`;
      params.push(patientId);
      paramIndex++;
    }
    
    query += ` ORDER BY p.created_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    params.push(limit, offset);
    
    const { rows } = await db.query(query, params);
    return rows.map(r => keysToCamel(r));
  }
  
  /**
   * Get prescription by ID
   */
  async getPrescriptionById(prescriptionId, userId, userRole) {
    let query = `
      SELECT p.*,
             pat.first_name as patient_first_name,
             pat.last_name as patient_last_name,
             pat.date_of_birth as patient_dob,
             prov.first_name as provider_first_name,
             prov.last_name as provider_last_name,
             prov.specialty as provider_specialty
      FROM prescriptions p
      JOIN users pat ON pat.id = p.patient_id
      JOIN users prov ON prov.id = p.provider_id
      WHERE p.id = $1
    `;
    
    const params = [prescriptionId];
    
    // Access control
    if (userRole === 'patient') {
      query += ' AND p.patient_id = $2';
      params.push(userId);
    } else if (userRole === 'provider') {
      query += ' AND p.provider_id = $2';
      params.push(userId);
    }
    // Admin/super_admin can see all
    
    const { rows } = await db.query(query, params);
    return rows.length > 0 ? keysToCamel(rows[0]) : null;
  }
  
  /**
   * Get prescription history
   */
  async getPrescriptionHistory(prescriptionId) {
    const { rows } = await db.query(`
      SELECT * FROM prescription_history
      WHERE prescription_id = $1
      ORDER BY created_at DESC
    `, [prescriptionId]);
    
    return rows.map(r => keysToCamel(r));
  }
  
  /**
   * Request refill
   */
  async requestRefill(prescriptionId, patientId) {
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      
      // Check prescription eligibility
      const { rows: prescriptions } = await client.query(`
        SELECT * FROM prescriptions
        WHERE id = $1 AND patient_id = $2
        AND refills_remaining > 0
        AND status IN ('ready', 'picked_up', 'delivered')
      `, [prescriptionId, patientId]);
      
      if (prescriptions.length === 0) {
        throw new Error('Prescription not eligible for refill');
      }
      
      const prescription = prescriptions[0];
      
      // Update refill count and status
      await client.query(`
        UPDATE prescriptions
        SET refills_remaining = refills_remaining - 1,
            status = 'sent',
            erx_sent_at = CURRENT_TIMESTAMP,
            last_fill_date = fill_date,
            fill_date = NULL
        WHERE id = $1
      `, [prescriptionId]);
      
      await this._recordHistory(client, prescriptionId, 'refill_requested', patientId, null, {
        refills_remaining: prescription.refills_remaining - 1
      });
      
      // Notify provider
      await notificationService.createNotification({
        userId: prescription.provider_id,
        type: 'prescription',
        title: 'Refill Requested',
        message: `Refill requested for ${prescription.medication_name}`,
        referenceType: 'prescription',
        referenceId: prescriptionId,
        actionUrl: `/provider/prescriptions/${prescriptionId}`,
        actionText: 'Review Refill'
      });
      
      await client.query('COMMIT');
      
      return keysToCamel(prescriptions[0]);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
  
  /**
   * Record prescription history
   */
  async _recordHistory(client, prescriptionId, action, performedBy, oldValues = null, newValues = null) {
    let userName = 'System';
    let userRole = 'system';
    
    if (performedBy) {
      const { rows: users } = await client.query(
        'SELECT first_name, last_name, role FROM users WHERE id = $1',
        [performedBy]
      );
      if (users.length > 0) {
        userName = `${users[0].first_name} ${users[0].last_name}`;
        userRole = users[0].role;
      }
    }
    
    await client.query(`
      INSERT INTO prescription_history (
        prescription_id, action, performed_by,
        performed_by_name, performed_by_role,
        old_values, new_values
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
    `, [
      prescriptionId,
      action,
      performedBy,
      userName,
      userRole,
      oldValues ? JSON.stringify(oldValues) : null,
      newValues ? JSON.stringify(newValues) : null
    ]);
  }
  
  /**
   * Search medications (for auto-complete)
   */
  async searchMedications(query) {
    // In production, this would connect to a drug database like FDB or RxNorm
    // For now, return common medications matching the query
    const commonMedications = [
      { name: 'Lisinopril', genericName: 'Lisinopril', dosages: ['5mg', '10mg', '20mg', '40mg'], forms: ['tablet'] },
      { name: 'Metformin', genericName: 'Metformin HCl', dosages: ['500mg', '850mg', '1000mg'], forms: ['tablet', 'ER tablet'] },
      { name: 'Amlodipine', genericName: 'Amlodipine Besylate', dosages: ['2.5mg', '5mg', '10mg'], forms: ['tablet'] },
      { name: 'Atorvastatin', genericName: 'Atorvastatin Calcium', dosages: ['10mg', '20mg', '40mg', '80mg'], forms: ['tablet'] },
      { name: 'Metoprolol', genericName: 'Metoprolol Tartrate', dosages: ['25mg', '50mg', '100mg'], forms: ['tablet'] },
      { name: 'Omeprazole', genericName: 'Omeprazole', dosages: ['20mg', '40mg'], forms: ['capsule', 'DR capsule'] },
      { name: 'Losartan', genericName: 'Losartan Potassium', dosages: ['25mg', '50mg', '100mg'], forms: ['tablet'] },
      { name: 'Gabapentin', genericName: 'Gabapentin', dosages: ['100mg', '300mg', '400mg', '600mg'], forms: ['capsule', 'tablet'] },
      { name: 'Sertraline', genericName: 'Sertraline HCl', dosages: ['25mg', '50mg', '100mg'], forms: ['tablet'] },
      { name: 'Levothyroxine', genericName: 'Levothyroxine Sodium', dosages: ['25mcg', '50mcg', '75mcg', '100mcg', '125mcg'], forms: ['tablet'] },
      { name: 'Amoxicillin', genericName: 'Amoxicillin', dosages: ['250mg', '500mg', '875mg'], forms: ['capsule', 'tablet'] },
      { name: 'Azithromycin', genericName: 'Azithromycin', dosages: ['250mg', '500mg'], forms: ['tablet', 'Z-Pack'] },
      { name: 'Prednisone', genericName: 'Prednisone', dosages: ['5mg', '10mg', '20mg'], forms: ['tablet'] },
      { name: 'Ibuprofen', genericName: 'Ibuprofen', dosages: ['200mg', '400mg', '600mg', '800mg'], forms: ['tablet'] },
      { name: 'Albuterol', genericName: 'Albuterol Sulfate', dosages: ['90mcg/actuation'], forms: ['HFA inhaler', 'nebulizer solution'] },
      { name: 'Fluticasone', genericName: 'Fluticasone Propionate', dosages: ['50mcg/spray', '100mcg/spray'], forms: ['nasal spray', 'inhaler'] },
      { name: 'Tramadol', genericName: 'Tramadol HCl', dosages: ['50mg', '100mg'], forms: ['tablet', 'ER tablet'], scheduleClass: 'IV' },
      { name: 'Hydrocodone/APAP', genericName: 'Hydrocodone/Acetaminophen', dosages: ['5/325mg', '7.5/325mg', '10/325mg'], forms: ['tablet'], scheduleClass: 'II' },
      { name: 'Alprazolam', genericName: 'Alprazolam', dosages: ['0.25mg', '0.5mg', '1mg', '2mg'], forms: ['tablet'], scheduleClass: 'IV' }
    ];
    
    const lowerQuery = query.toLowerCase();
    return commonMedications.filter(med =>
      med.name.toLowerCase().includes(lowerQuery) ||
      med.genericName.toLowerCase().includes(lowerQuery)
    );
  }
}

module.exports = new PrescriptionService();

