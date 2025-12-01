/**
 * Prior Authorization Service
 * Handles Prior Auth automation via CoverMyMeds and Surescripts
 */

const db = require('../db');
const logger = require('../middleware/logger');

class PriorAuthService {
  /**
   * Submit Prior Authorization via CoverMyMeds
   */
  async submitViaCoverMyMeds(paData) {
    try {
      // In production, integrate with CoverMyMeds API
      // For now, simulate the API call
      const coverMyMedsApiKey = process.env.COVERMYMEDS_API_KEY;
      const coverMyMedsApiUrl = process.env.COVERMYMEDS_API_URL || 'https://api.covermymeds.com';
      
      if (!coverMyMedsApiKey) {
        logger.warn('CoverMyMeds API key not configured, using simulation');
        return this.simulateCoverMyMedsSubmission(paData);
      }
      
      // Real API integration would go here
      // const response = await axios.post(`${coverMyMedsApiUrl}/prior_authorizations`, {
      //   headers: { 'Authorization': `Bearer ${coverMyMedsApiKey}` },
      //   data: this.formatCoverMyMedsRequest(paData)
      // });
      
      return this.simulateCoverMyMedsSubmission(paData);
    } catch (error) {
      logger.error('CoverMyMeds submission error:', error);
      throw new Error('Failed to submit prior authorization via CoverMyMeds');
    }
  }
  
  /**
   * Submit Prior Authorization via Surescripts
   */
  async submitViaSurescripts(paData) {
    try {
      const surescriptsApiKey = process.env.SURESCRIPTS_API_KEY;
      const surescriptsApiUrl = process.env.SURESCRIPTS_API_URL || 'https://api.surescripts.com';
      
      if (!surescriptsApiKey) {
        logger.warn('Surescripts API key not configured, using simulation');
        return this.simulateSurescriptsSubmission(paData);
      }
      
      // Real API integration would go here
      return this.simulateSurescriptsSubmission(paData);
    } catch (error) {
      logger.error('Surescripts submission error:', error);
      throw new Error('Failed to submit prior authorization via Surescripts');
    }
  }
  
  /**
   * Create Prior Authorization record
   */
  async createPriorAuth(paData) {
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      
      const {
        patientId,
        providerId,
        visitId,
        appointmentId,
        medicationName,
        ndcCode,
        cptCodes = [],
        icdCodes = [],
        payerName,
        payerId,
        diagnosisDescription,
        clinicalNotes,
        submittedVia = 'api',
        submittedBy
      } = paData;
      
      // Generate PA number
      const paNumber = `PA-${Date.now().toString().slice(-8)}`;
      
      const query = `
        INSERT INTO prior_authorizations (
          patient_id, provider_id, visit_id, appointment_id,
          pa_number, medication_name, ndc_code, cpt_codes, icd_codes,
          payer_name, payer_id, diagnosis_description, clinical_notes,
          submitted_via, submitted_by, status, submission_timestamp,
          submission_payload, created_by
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
        RETURNING *
      `;
      
      const submissionPayload = {
        medicationName,
        ndcCode,
        cptCodes,
        icdCodes,
        payerName,
        clinicalNotes
      };
      
      const result = await client.query(query, [
        patientId,
        providerId,
        visitId || null,
        appointmentId || null,
        paNumber,
        medicationName,
        ndcCode || null,
        cptCodes,
        icdCodes,
        payerName,
        payerId || null,
        diagnosisDescription || null,
        clinicalNotes || null,
        submittedVia,
        submittedBy || providerId,
        'submitted',
        new Date(),
        JSON.stringify(submissionPayload),
        submittedBy || providerId
      ]);
      
      // Submit to external service
      let submissionResult;
      if (submittedVia === 'covermymeds') {
        submissionResult = await this.submitViaCoverMyMeds(paData);
      } else if (submittedVia === 'surescripts') {
        submissionResult = await this.submitViaSurescripts(paData);
      }
      
      // Update with submission response
      if (submissionResult) {
        const updateQuery = `
          UPDATE prior_authorizations
          SET submission_payload = $1,
              response_payload = $2,
              status = $3,
              approval_number = $4,
              expiration_date = $5,
              denial_reason = $6
          WHERE id = $7
        `;
        
        await client.query(updateQuery, [
          JSON.stringify({ ...submissionPayload, externalId: submissionResult.externalId }),
          JSON.stringify(submissionResult.response || {}),
          submissionResult.status || 'submitted',
          submissionResult.approvalNumber || null,
          submissionResult.expirationDate || null,
          submissionResult.denialReason || null
        ]);
      }
      
      await client.query('COMMIT');
      
      const finalResult = await client.query('SELECT * FROM prior_authorizations WHERE id = $1', [result.rows[0].id]);
      return finalResult.rows[0];
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error('Error creating prior authorization:', error);
      throw error;
    } finally {
      client.release();
    }
  }
  
  /**
   * Get Prior Authorization by ID
   */
  async getPriorAuthById(paId) {
    const result = await db.pool.query(
      'SELECT * FROM prior_authorizations WHERE id = $1',
      [paId]
    );
    return result.rows[0];
  }
  
  /**
   * Get Prior Authorizations for Patient
   */
  async getPriorAuthsByPatient(patientId) {
    const result = await db.pool.query(
      'SELECT * FROM prior_authorizations WHERE patient_id = $1 ORDER BY created_at DESC',
      [patientId]
    );
    return result.rows;
  }
  
  /**
   * Get Prior Authorizations for Provider
   */
  async getPriorAuthsByProvider(providerId) {
    const result = await db.pool.query(
      'SELECT * FROM prior_authorizations WHERE provider_id = $1 ORDER BY created_at DESC',
      [providerId]
    );
    return result.rows;
  }
  
  /**
   * Update Prior Authorization status
   */
  async updatePriorAuthStatus(paId, status, updates = {}) {
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      
      const {
        approvalNumber,
        expirationDate,
        denialReason,
        requiresPeerToPeer,
        alternativeTherapySuggested,
        responsePayload
      } = updates;
      
      // Get existing PA for audit log
      const existingPa = await client.query('SELECT * FROM prior_authorizations WHERE id = $1', [paId]);
      const auditEntry = {
        timestamp: new Date().toISOString(),
        action: 'status_update',
        oldStatus: existingPa.rows[0]?.status,
        newStatus: status,
        updates
      };
      
      const auditLog = existingPa.rows[0]?.audit_log || [];
      auditLog.push(auditEntry);
      
      const query = `
        UPDATE prior_authorizations
        SET status = $1,
            approval_number = COALESCE($2, approval_number),
            expiration_date = COALESCE($3, expiration_date),
            denial_reason = COALESCE($4, denial_reason),
            requires_peer_to_peer = COALESCE($5, requires_peer_to_peer),
            alternative_therapy_suggested = COALESCE($6, alternative_therapy_suggested),
            response_payload = COALESCE($7::jsonb, response_payload),
            response_timestamp = CASE WHEN $1 != status THEN CURRENT_TIMESTAMP ELSE response_timestamp END,
            audit_log = $8,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $9
        RETURNING *
      `;
      
      const result = await client.query(query, [
        status,
        approvalNumber || null,
        expirationDate || null,
        denialReason || null,
        requiresPeerToPeer ?? null,
        alternativeTherapySuggested || null,
        responsePayload ? JSON.stringify(responsePayload) : null,
        JSON.stringify(auditLog),
        paId
      ]);
      
      await client.query('COMMIT');
      return result.rows[0];
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error('Error updating prior authorization:', error);
      throw error;
    } finally {
      client.release();
    }
  }
  
  /**
   * Auto-submit Prior Auth if medication requires it (based on RTBC)
   */
  async autoSubmitIfRequired(patientId, providerId, medicationName, visitId, appointmentId, rtbcResult) {
    if (!rtbcResult?.requiresPriorAuth) {
      return null;
    }
    
    return await this.createPriorAuth({
      patientId,
      providerId,
      visitId,
      appointmentId,
      medicationName,
      ndcCode: rtbcResult.ndcCode,
      payerName: rtbcResult.payerName,
      payerId: rtbcResult.payerId,
      diagnosisDescription: rtbcResult.diagnosisDescription,
      clinicalNotes: `Auto-submitted based on RTBC requirement for ${medicationName}`,
      submittedVia: 'api',
      submittedBy: providerId,
      autoRouted: true
    });
  }
  
  // Simulation methods (remove in production)
  simulateCoverMyMedsSubmission(paData) {
    // Simulate API delay
    return new Promise((resolve) => {
      setTimeout(() => {
        resolve({
          externalId: `CMM-${Date.now()}`,
          status: Math.random() > 0.3 ? 'submitted' : 'in_review',
          approvalNumber: Math.random() > 0.5 ? `APPROVED-${Date.now()}` : null,
          expirationDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
          response: {
            message: 'Prior authorization submitted successfully',
            trackingId: `CMM-${Date.now()}`
          }
        });
      }, 1500);
    });
  }
  
  simulateSurescriptsSubmission(paData) {
    return new Promise((resolve) => {
      setTimeout(() => {
        resolve({
          externalId: `SURE-${Date.now()}`,
          status: 'submitted',
          approvalNumber: null,
          response: {
            message: 'Prior authorization submitted via Surescripts',
            transactionId: `SURE-${Date.now()}`
          }
        });
      }, 1500);
    });
  }
}

module.exports = new PriorAuthService();

