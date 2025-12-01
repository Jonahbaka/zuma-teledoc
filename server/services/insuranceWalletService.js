/**
 * Insurance Wallet Service
 * Manages patient insurance wallet with tokenization, encryption, and audit logging
 */

const db = require('../db');
const logger = require('../middleware/logger');
const { encrypt, decrypt } = require('../../lib/encryption');
const eligibilityService = require('./eligibilityService');

class InsuranceWalletService {
  /**
   * Get patient's insurance wallet
   */
  async getWallet(patientId) {
    const result = await db.pool.query(
      `SELECT 
        id, patient_id, insurance_provider, policy_number, group_number,
        subscriber_name, subscriber_dob, relationship_to_subscriber,
        is_primary, is_verified, eligibility_status, eligibility_last_checked,
        effective_date, expiration_date,
        ocr_provider, ocr_confidence_score,
        tokenized_member_id,
        created_at, updated_at
      FROM patient_insurance 
      WHERE patient_id = $1 
      ORDER BY is_primary DESC, created_at DESC`,
      [patientId]
    );
    
    // Don't return encrypted images or raw PHI in list
    return result.rows.map(insurance => ({
      ...insurance,
      policyNumber: this.maskSensitiveData(insurance.policy_number)
    }));
  }
  
  /**
   * Get insurance by ID (for provider access with audit)
   */
  async getInsuranceById(insuranceId, accessedBy, accessReason) {
    const client = await db.pool.connect();
    try {
      const result = await client.query(
        'SELECT * FROM patient_insurance WHERE id = $1',
        [insuranceId]
      );
      
      if (result.rows.length === 0) {
        return null;
      }
      
      const insurance = result.rows[0];
      
      // Log access for audit
      await this.logAccess(insuranceId, accessedBy, accessReason);
      
      // Return with decrypted images if needed
      let frontImageDecrypted = null;
      let backImageDecrypted = null;
      
      if (insurance.front_image_encrypted) {
        try {
          const encrypted = JSON.parse(insurance.front_image_encrypted);
          frontImageDecrypted = decrypt(encrypted.encrypted, encrypted.iv, encrypted.tag);
        } catch (e) {
          logger.warn('Failed to decrypt front image:', e);
        }
      }
      
      if (insurance.back_image_encrypted) {
        try {
          const encrypted = JSON.parse(insurance.back_image_encrypted);
          backImageDecrypted = decrypt(encrypted.encrypted, encrypted.iv, encrypted.tag);
        } catch (e) {
          logger.warn('Failed to decrypt back image:', e);
        }
      }
      
      return {
        ...insurance,
        frontImageDecrypted,
        backImageDecrypted
      };
    } finally {
      client.release();
    }
  }
  
  /**
   * Set primary insurance
   */
  async setPrimaryInsurance(patientId, insuranceId) {
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      
      // Unset all primary flags
      await client.query(
        'UPDATE patient_insurance SET is_primary = false WHERE patient_id = $1',
        [patientId]
      );
      
      // Set new primary
      const result = await client.query(
        'UPDATE patient_insurance SET is_primary = true WHERE id = $1 AND patient_id = $2 RETURNING *',
        [insuranceId, patientId]
      );
      
      // Log change
      await this.logAuditEvent(insuranceId, 'primary_changed', { newPrimary: insuranceId });
      
      await client.query('COMMIT');
      return result.rows[0];
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error('Error setting primary insurance:', error);
      throw error;
    } finally {
      client.release();
    }
  }
  
  /**
   * Verify insurance eligibility (Change Healthcare RTE)
   */
  async verifyEligibility(insuranceId) {
    const client = await db.pool.connect();
    try {
      const insuranceResult = await client.query(
        'SELECT * FROM patient_insurance WHERE id = $1',
        [insuranceId]
      );
      
      if (insuranceResult.rows.length === 0) {
        throw new Error('Insurance not found');
      }
      
      const insurance = insuranceResult.rows[0];
      
      // Call eligibility service
      const eligibilityResult = await eligibilityService.verifyRealTime(
        insurance.policy_number,
        insurance.insurance_provider
      );
      
      // Update insurance record
      const updateQuery = `
        UPDATE patient_insurance
        SET is_verified = $1,
            eligibility_status = $2,
            eligibility_last_checked = CURRENT_TIMESTAMP,
            eligibility_response = $3,
            verified_at = CASE WHEN $1 = true THEN CURRENT_TIMESTAMP ELSE verified_at END,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $4
        RETURNING *
      `;
      
      const isActive = eligibilityResult.status === 'ACTIVE';
      const status = isActive ? 'active' : 'inactive';
      
      const result = await client.query(updateQuery, [
        isActive,
        status,
        JSON.stringify(eligibilityResult),
        insuranceId
      ]);
      
      // Log verification
      await this.logAuditEvent(insuranceId, 'eligibility_verified', {
        status: eligibilityResult.status,
        verified: isActive
      });
      
      return {
        insurance: result.rows[0],
        eligibility: eligibilityResult
      };
    } catch (error) {
      logger.error('Error verifying eligibility:', error);
      throw error;
    } finally {
      client.release();
    }
  }
  
  /**
   * Mark insurance as active/inactive
   */
  async setInsuranceStatus(insuranceId, status) {
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      
      const result = await client.query(
        'UPDATE patient_insurance SET eligibility_status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING *',
        [status, insuranceId]
      );
      
      await this.logAuditEvent(insuranceId, 'status_changed', { newStatus: status });
      
      await client.query('COMMIT');
      return result.rows[0];
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error('Error setting insurance status:', error);
      throw error;
    } finally {
      client.release();
    }
  }
  
  /**
   * Capture patient consent for insurance data
   */
  async captureConsent(insuranceId, consentGiven) {
    const client = await db.pool.connect();
    try {
      const result = await client.query(
        `UPDATE patient_insurance 
         SET consent_given = $1, 
             consent_timestamp = CASE WHEN $1 = true THEN CURRENT_TIMESTAMP ELSE NULL END,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $2 
         RETURNING *`,
        [consentGiven, insuranceId]
      );
      
      await this.logAuditEvent(insuranceId, 'consent_updated', { consentGiven });
      
      return result.rows[0];
    } catch (error) {
      logger.error('Error capturing consent:', error);
      throw error;
    } finally {
      client.release();
    }
  }
  
  /**
   * Export insurance proof (PDF) - audit logged
   */
  async exportInsuranceProof(insuranceId, requestedBy) {
    const insurance = await this.getInsuranceById(insuranceId, requestedBy, 'export_insurance_proof');
    
    if (!insurance) {
      throw new Error('Insurance not found');
    }
    
    // Log export
    await this.logAuditEvent(insuranceId, 'proof_exported', { requestedBy });
    
    // In production, generate PDF here
    return {
      insuranceId: insurance.id,
      payerName: insurance.insurance_provider,
      memberId: insurance.policy_number,
      groupId: insurance.group_number,
      exportedAt: new Date().toISOString(),
      pdfUrl: null // Would be generated and stored securely
    };
  }
  
  /**
   * Get insurance audit log
   */
  async getAuditLog(insuranceId) {
    const result = await db.pool.query(
      'SELECT audit_log FROM patient_insurance WHERE id = $1',
      [insuranceId]
    );
    
    if (result.rows.length === 0) {
      return [];
    }
    
    return result.rows[0].audit_log || [];
  }
  
  /**
   * Log access to insurance record
   */
  async logAccess(insuranceId, accessedBy, accessReason) {
    const auditEntry = {
      timestamp: new Date().toISOString(),
      action: 'access',
      accessedBy,
      accessReason,
      ipAddress: null // Would be captured from request in production
    };
    
    await this.logAuditEvent(insuranceId, 'access', auditEntry);
  }
  
  /**
   * Log audit event
   */
  async logAuditEvent(insuranceId, action, details) {
    const client = await db.pool.connect();
    try {
      // Get current audit log
      const result = await client.query(
        'SELECT audit_log FROM patient_insurance WHERE id = $1',
        [insuranceId]
      );
      
      if (result.rows.length === 0) {
        return;
      }
      
      const auditLog = result.rows[0].audit_log || [];
      auditLog.push({
        timestamp: new Date().toISOString(),
        action,
        ...details
      });
      
      // Keep only last 100 entries
      if (auditLog.length > 100) {
        auditLog.splice(0, auditLog.length - 100);
      }
      
      await client.query(
        'UPDATE patient_insurance SET audit_log = $1 WHERE id = $2',
        [JSON.stringify(auditLog), insuranceId]
      );
    } catch (error) {
      logger.error('Error logging audit event:', error);
      // Don't throw - audit logging failure shouldn't break the request
    } finally {
      client.release();
    }
  }
  
  /**
   * Mask sensitive data for display
   */
  maskSensitiveData(data) {
    if (!data || data.length <= 4) return data;
    return '****' + data.slice(-4);
  }
}

module.exports = new InsuranceWalletService();

