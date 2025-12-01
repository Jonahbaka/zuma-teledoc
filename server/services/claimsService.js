/**
 * Claims Service
 * Handles claim scrubbing, submission, and clearinghouse integration
 */

const db = require('../db');
const logger = require('../middleware/logger');

class ClaimsService {
  /**
   * Scrub claim using Change Healthcare ClaimXchange
   */
  async scrubClaimViaChangeHealthcare(claimData) {
    try {
      const apiKey = process.env.CHANGE_HEALTHCARE_API_KEY;
      const apiUrl = process.env.CHANGE_HEALTHCARE_API_URL || 'https://api.changehealthcare.com';
      
      if (!apiKey) {
        logger.warn('Change Healthcare API key not configured, using simulation');
        return this.simulateClaimScrubbing(claimData);
      }
      
      // Real API integration would go here
      // const response = await axios.post(`${apiUrl}/claims/scrub`, {
      //   headers: { 'Authorization': `Bearer ${apiKey}` },
      //   data: this.formatChangeHealthcareClaim(claimData)
      // });
      
      return this.simulateClaimScrubbing(claimData);
    } catch (error) {
      logger.error('Change Healthcare claim scrubbing error:', error);
      throw new Error('Failed to scrub claim via Change Healthcare');
    }
  }
  
  /**
   * Scrub claim using Waystar
   */
  async scrubClaimViaWaystar(claimData) {
    try {
      const apiKey = process.env.WAYSTAR_API_KEY;
      const apiUrl = process.env.WAYSTAR_API_URL || 'https://api.waystar.com';
      
      if (!apiKey) {
        logger.warn('Waystar API key not configured, using simulation');
        return this.simulateClaimScrubbing(claimData);
      }
      
      // Real API integration would go here
      return this.simulateClaimScrubbing(claimData);
    } catch (error) {
      logger.error('Waystar claim scrubbing error:', error);
      throw new Error('Failed to scrub claim via Waystar');
    }
  }
  
  /**
   * Create and scrub claim
   */
  async createAndScrubClaim(claimData) {
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      
      const {
        patientId,
        providerId,
        visitId,
        appointmentId,
        cptCodes,
        icdCodes,
        modifiers = [],
        serviceDateStart,
        serviceDateEnd,
        totalChargeAmount,
        billingProviderNpi,
        renderingProviderNpi,
        insuranceId,
        payerName,
        payerId,
        subscriberId,
        createdBy
      } = claimData;
      
      // Generate claim number
      const claimNumber = `CLM-${Date.now().toString().slice(-10)}`;
      
      const query = `
        INSERT INTO claims (
          patient_id, provider_id, visit_id, appointment_id,
          claim_number, claim_type, billing_provider_npi, rendering_provider_npi,
          service_date_start, service_date_end, cpt_codes, icd_codes, modifiers,
          total_charge_amount, insurance_id, payer_name, payer_id, subscriber_id,
          scrubbing_status, created_by, claim_status
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)
        RETURNING *
      `;
      
      const result = await client.query(query, [
        patientId,
        providerId,
        visitId || null,
        appointmentId || null,
        claimNumber,
        'professional',
        billingProviderNpi,
        renderingProviderNpi || billingProviderNpi,
        serviceDateStart,
        serviceDateEnd || serviceDateStart,
        cptCodes,
        icdCodes,
        modifiers,
        totalChargeAmount,
        insuranceId || null,
        payerName || null,
        payerId || null,
        subscriberId || null,
        'pending',
        createdBy || providerId,
        'draft'
      ]);
      
      // Scrub the claim
      const scrubbingProvider = process.env.CLAIMS_CLEARINGHOUSE || 'change_healthcare';
      let scrubbingResult;
      
      if (scrubbingProvider === 'change_healthcare') {
        scrubbingResult = await this.scrubClaimViaChangeHealthcare({
          ...claimData,
          claimNumber,
          claimId: result.rows[0].id
        });
      } else if (scrubbingProvider === 'waystar') {
        scrubbingResult = await this.scrubClaimViaWaystar({
          ...claimData,
          claimNumber,
          claimId: result.rows[0].id
        });
      }
      
      // Update claim with scrubbing results
      if (scrubbingResult) {
        const updateQuery = `
          UPDATE claims
          SET scrubbing_status = $1,
              scrubbing_errors = $2,
              scrubbing_warnings = $3,
              auto_corrected_issues = $4,
              requires_review = $5,
              claim_status = $6,
              metadata = $7
          WHERE id = $8
        `;
        
        const hasErrors = scrubbingResult.errors && scrubbingResult.errors.length > 0;
        const hasWarnings = scrubbingResult.warnings && scrubbingResult.warnings.length > 0;
        const requiresReview = hasErrors || (hasWarnings && scrubbingResult.requiresManualReview);
        
        await client.query(updateQuery, [
          hasErrors ? 'failed' : (hasWarnings ? 'warnings' : 'passed'),
          JSON.stringify(scrubbingResult.errors || []),
          JSON.stringify(scrubbingResult.warnings || []),
          JSON.stringify(scrubbingResult.autoCorrected || []),
          requiresReview,
          requiresReview ? 'scrubbed' : 'scrubbed',
          JSON.stringify(scrubbingResult.metadata || {})
        ]);
      }
      
      await client.query('COMMIT');
      
      const finalResult = await client.query('SELECT * FROM claims WHERE id = $1', [result.rows[0].id]);
      return finalResult.rows[0];
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error('Error creating claim:', error);
      throw error;
    } finally {
      client.release();
    }
  }
  
  /**
   * Submit claim to clearinghouse
   */
  async submitClaimToClearinghouse(claimId) {
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      
      const claimResult = await client.query('SELECT * FROM claims WHERE id = $1', [claimId]);
      const claim = claimResult.rows[0];
      
      if (!claim) {
        throw new Error('Claim not found');
      }
      
      if (claim.claim_status === 'submitted') {
        throw new Error('Claim already submitted');
      }
      
      if (claim.scrubbing_status === 'failed' && claim.requires_review) {
        throw new Error('Claim has scrubbing errors and requires review before submission');
      }
      
      const clearinghouse = process.env.CLAIMS_CLEARINGHOUSE || 'change_healthcare';
      let submissionResult;
      
      if (clearinghouse === 'change_healthcare') {
        submissionResult = await this.submitToChangeHealthcare(claim);
      } else if (clearinghouse === 'waystar') {
        submissionResult = await this.submitToWaystar(claim);
      }
      
      // Update claim with submission details
      const updateQuery = `
        UPDATE claims
        SET claim_status = $1,
            clearinghouse_provider = $2,
            edi_837_transaction_id = $3,
            submission_timestamp = CURRENT_TIMESTAMP,
            submission_response = $4,
            metadata = $5
        WHERE id = $6
        RETURNING *
      `;
      
      const result = await client.query(updateQuery, [
        'submitted',
        clearinghouse,
        submissionResult.transactionId || null,
        JSON.stringify(submissionResult),
        JSON.stringify({ ...(claim.metadata || {}), submissionAttempts: (claim.metadata?.submissionAttempts || 0) + 1 }),
        claimId
      ]);
      
      await client.query('COMMIT');
      return result.rows[0];
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error('Error submitting claim:', error);
      throw error;
    } finally {
      client.release();
    }
  }
  
  /**
   * Apply auto-corrections to claim
   */
  async applyAutoCorrections(claimId, corrections) {
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      
      const claimResult = await client.query('SELECT * FROM claims WHERE id = $1', [claimId]);
      const claim = claimResult.rows[0];
      
      if (!claim) {
        throw new Error('Claim not found');
      }
      
      const updates = {};
      const autoCorrected = claim.auto_corrected_issues || [];
      
      // Apply corrections
      if (corrections.modifiers) {
        updates.modifiers = corrections.modifiers;
        autoCorrected.push({ field: 'modifiers', old: claim.modifiers, new: corrections.modifiers, timestamp: new Date().toISOString() });
      }
      
      if (corrections.cptCodes) {
        updates.cpt_codes = corrections.cptCodes;
        autoCorrected.push({ field: 'cptCodes', old: claim.cpt_codes, new: corrections.cptCodes, timestamp: new Date().toISOString() });
      }
      
      if (corrections.icdCodes) {
        updates.icd_codes = corrections.icdCodes;
        autoCorrected.push({ field: 'icdCodes', old: claim.icd_codes, new: corrections.icdCodes, timestamp: new Date().toISOString() });
      }
      
      const setClauses = Object.keys(updates).map((key, index) => `${key} = $${index + 2}`).join(', ');
      const values = [claimId, ...Object.values(updates), JSON.stringify(autoCorrected)];
      
      const updateQuery = `
        UPDATE claims
        SET ${setClauses},
            auto_corrected_issues = $${values.length},
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
        RETURNING *
      `;
      
      const result = await client.query(updateQuery, values);
      
      await client.query('COMMIT');
      return result.rows[0];
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error('Error applying auto-corrections:', error);
      throw error;
    } finally {
      client.release();
    }
  }
  
  /**
   * Get claims by patient
   */
  async getClaimsByPatient(patientId) {
    const result = await db.pool.query(
      'SELECT * FROM claims WHERE patient_id = $1 ORDER BY created_at DESC',
      [patientId]
    );
    return result.rows;
  }
  
  /**
   * Get claims requiring review
   */
  async getClaimsRequiringReview() {
    const result = await db.pool.query(
      `SELECT * FROM claims 
       WHERE requires_review = true 
       AND claim_status IN ('draft', 'scrubbed')
       ORDER BY created_at DESC`
    );
    return result.rows;
  }
  
  /**
   * Update claim with remittance advice
   */
  async updateClaimRemittance(claimId, remittanceData) {
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      
      const updateQuery = `
        UPDATE claims
        SET claim_status = $1,
            remittance_advice = $2,
            eob_document_url = $3,
            insurance_payment = $4,
            patient_responsibility = $5,
            adjusted_amount = $6,
            payment_date = $7,
            edi_835_transaction_id = $8,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $9
        RETURNING *
      `;
      
      const result = await client.query(updateQuery, [
        remittanceData.status || 'paid',
        JSON.stringify(remittanceData),
        remittanceData.eobUrl || null,
        remittanceData.insurancePayment || null,
        remittanceData.patientResponsibility || null,
        remittanceData.adjustedAmount || null,
        remittanceData.paymentDate || null,
        remittanceData.transactionId || null,
        claimId
      ]);
      
      await client.query('COMMIT');
      return result.rows[0];
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error('Error updating claim remittance:', error);
      throw error;
    } finally {
      client.release();
    }
  }
  
  // Simulation methods (remove in production)
  simulateClaimScrubbing(claimData) {
    return new Promise((resolve) => {
      setTimeout(() => {
        const errors = [];
        const warnings = [];
        const autoCorrected = [];
        
        // Simulate missing modifier detection
        if (claimData.cptCodes?.includes('99214') && !claimData.modifiers?.includes('25')) {
          warnings.push({
            code: 'MISSING_MODIFIER',
            message: 'Modifier 25 may be required for E&M services',
            field: 'modifiers',
            suggestion: ['25']
          });
        }
        
        // Simulate invalid NPI detection
        if (claimData.billingProviderNpi?.length !== 10) {
          errors.push({
            code: 'INVALID_NPI',
            message: 'Billing provider NPI must be 10 digits',
            field: 'billingProviderNpi'
          });
        }
        
        // Simulate auto-correction
        if (claimData.modifiers && claimData.modifiers.length === 0 && warnings.length > 0) {
          autoCorrected.push({
            field: 'modifiers',
            action: 'added',
            value: ['25']
          });
        }
        
        resolve({
          errors,
          warnings,
          autoCorrected: autoCorrected.length > 0 ? autoCorrected : null,
          requiresManualReview: errors.length > 0,
          metadata: {
            scrubbedAt: new Date().toISOString(),
            provider: 'change_healthcare'
          }
        });
      }, 1000);
    });
  }
  
  async submitToChangeHealthcare(claim) {
    return new Promise((resolve) => {
      setTimeout(() => {
        resolve({
          transactionId: `EDI837-${Date.now()}`,
          status: 'accepted',
          message: 'Claim submitted successfully'
        });
      }, 800);
    });
  }
  
  async submitToWaystar(claim) {
    return new Promise((resolve) => {
      setTimeout(() => {
        resolve({
          transactionId: `WAY-${Date.now()}`,
          status: 'accepted',
          message: 'Claim submitted successfully'
        });
      }, 800);
    });
  }
}

module.exports = new ClaimsService();

