/**
 * Telehealth Consent Service
 * 
 * Manages informed consent for telehealth encounters:
 * - Versioned consent templates
 * - State-specific consent requirements
 * - Electronic signature capture
 * - Consent validity tracking
 */

const db = require('../db');
const logger = require('../middleware/logger');
const { encrypt, decrypt } = require('../../lib/encryption');
const { keysToCamel } = require('../../lib/utils');

class TelehealthConsentService {
  
  // =========================================================================
  // CONSENT TEMPLATES
  // =========================================================================
  
  /**
   * Create a new consent template version
   */
  async createConsentTemplate(data, createdBy) {
    const {
      version,
      title,
      contentHtml,
      contentPlain,
      applicableStates,
      effectiveDate,
      expiryDate
    } = data;
    
    const { rows } = await db.query(
      `INSERT INTO telehealth_consent_templates (
        version, title, content_html, content_plain,
        applicable_states, effective_date, expiry_date, created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *`,
      [
        version,
        title,
        contentHtml,
        contentPlain,
        applicableStates || null,
        effectiveDate,
        expiryDate || null,
        createdBy
      ]
    );
    
    logger.info('Consent template created', { version, createdBy });
    
    return keysToCamel(rows[0]);
  }
  
  /**
   * Get active consent template for a state
   */
  async getActiveTemplateForState(state) {
    const { rows } = await db.query(
      `SELECT * FROM telehealth_consent_templates
       WHERE is_active = true
       AND effective_date <= CURRENT_DATE
       AND (expiry_date IS NULL OR expiry_date > CURRENT_DATE)
       AND (applicable_states IS NULL OR $1 = ANY(applicable_states))
       ORDER BY effective_date DESC
       LIMIT 1`,
      [state]
    );
    
    if (rows.length === 0) {
      // Return default template
      return this._getDefaultTemplate();
    }
    
    return keysToCamel(rows[0]);
  }
  
  /**
   * Get all consent template versions
   */
  async getAllTemplates() {
    const { rows } = await db.query(
      `SELECT * FROM telehealth_consent_templates ORDER BY effective_date DESC`
    );
    
    return rows.map(keysToCamel);
  }
  
  // =========================================================================
  // PATIENT CONSENT
  // =========================================================================
  
  /**
   * Capture patient telehealth consent
   */
  async captureConsent(patientId, consentData, req) {
    const {
      templateId,
      templateVersion,
      patientState,
      consentMethod,
      signatureData,
      witnessName,
      witnessId
    } = consentData;
    
    // Validate template exists
    const { rows: templates } = await db.query(
      `SELECT id, version FROM telehealth_consent_templates WHERE id = $1`,
      [templateId]
    );
    
    if (templates.length === 0) {
      throw new Error('Consent template not found');
    }
    
    // Encrypt signature data if provided
    const sigEnc = signatureData 
      ? encrypt(JSON.stringify(signatureData))
      : { encrypted: null, iv: null, tag: null };
    
    // Calculate expiration (typically 1 year)
    const expiresAt = new Date();
    expiresAt.setFullYear(expiresAt.getFullYear() + 1);
    
    const { rows } = await db.query(
      `INSERT INTO telehealth_consents (
        patient_id, template_id, template_version,
        consent_text_version,
        consent_method, patient_state,
        signature_data_encrypted, signature_data_iv, signature_data_tag,
        ip_address, user_agent,
        witness_name, witness_id,
        expires_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      RETURNING *`,
      [
        patientId,
        templateId,
        templateVersion || templates[0].version,
        templateVersion || templates[0].version,
        consentMethod,
        patientState,
        sigEnc.encrypted, sigEnc.iv, sigEnc.tag,
        req?.ip || null,
        req?.get?.('user-agent') || null,
        witnessName || null,
        witnessId || null,
        expiresAt
      ]
    );
    
    logger.info('Telehealth consent captured', {
      consentId: rows[0].id,
      patientId,
      templateVersion: templates[0].version,
      method: consentMethod,
      state: patientState
    });
    
    return this._formatConsent(rows[0]);
  }
  
  /**
   * Get patient's valid consent for a state
   */
  async getValidConsent(patientId, state) {
    const { rows } = await db.query(
      `SELECT tc.*, 
              tct.title as template_title, tct.content_plain as template_content
       FROM telehealth_consents tc
       JOIN telehealth_consent_templates tct ON tct.id = tc.template_id
       WHERE tc.patient_id = $1
       AND tc.patient_state = $2
       AND tc.is_valid = true
       AND (tc.expires_at IS NULL OR tc.expires_at > NOW())
       ORDER BY tc.consent_captured_at DESC
       LIMIT 1`,
      [patientId, state]
    );
    
    if (rows.length === 0) {
      return null;
    }
    
    return this._formatConsent(rows[0]);
  }
  
  /**
   * Check if patient has valid consent for telehealth in a state
   */
  async hasValidConsent(patientId, state) {
    const consent = await this.getValidConsent(patientId, state);
    return consent !== null;
  }
  
  /**
   * Get all consents for a patient
   */
  async getPatientConsents(patientId) {
    const { rows } = await db.query(
      `SELECT tc.*,
              tct.title as template_title, tct.version as template_version_display
       FROM telehealth_consents tc
       JOIN telehealth_consent_templates tct ON tct.id = tc.template_id
       WHERE tc.patient_id = $1
       ORDER BY tc.consent_captured_at DESC`,
      [patientId]
    );
    
    return rows.map(r => this._formatConsent(r));
  }
  
  /**
   * Revoke a consent
   */
  async revokeConsent(consentId, patientId, reason) {
    const { rows } = await db.query(
      `UPDATE telehealth_consents SET
        is_valid = false,
        revoked_at = NOW(),
        revoked_reason = $1
       WHERE id = $2 AND patient_id = $3 AND is_valid = true
       RETURNING *`,
      [reason, consentId, patientId]
    );
    
    if (rows.length === 0) {
      throw new Error('Consent not found or already revoked');
    }
    
    logger.info('Telehealth consent revoked', { consentId, patientId, reason });
    
    return this._formatConsent(rows[0]);
  }
  
  /**
   * Renew consent (create new consent referencing updated template)
   */
  async renewConsent(patientId, state, consentMethod, req) {
    // Get the current template for the state
    const template = await this.getActiveTemplateForState(state);
    
    // Capture new consent
    return this.captureConsent(patientId, {
      templateId: template.id,
      templateVersion: template.version,
      patientState: state,
      consentMethod
    }, req);
  }
  
  // =========================================================================
  // CONSENT VALIDATION FOR ENCOUNTERS
  // =========================================================================
  
  /**
   * Validate consent for a telehealth encounter
   * Returns the consent if valid, or throws an error with guidance
   */
  async validateConsentForEncounter(patientId, patientState) {
    const consent = await this.getValidConsent(patientId, patientState);
    
    if (!consent) {
      const error = new Error('Valid telehealth consent required');
      error.code = 'CONSENT_REQUIRED';
      error.data = {
        patientState,
        message: `Informed consent is required for telehealth services in ${patientState}`,
        action: 'capture_consent'
      };
      throw error;
    }
    
    // Check if consent is expiring soon (within 30 days)
    const thirtyDaysFromNow = new Date();
    thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);
    
    if (consent.expiresAt && new Date(consent.expiresAt) < thirtyDaysFromNow) {
      consent.expiringWarning = true;
      consent.expiringMessage = 'Your telehealth consent will expire soon. Please renew it.';
    }
    
    return consent;
  }
  
  // =========================================================================
  // HELPER METHODS
  // =========================================================================
  
  _formatConsent(consent) {
    return {
      id: consent.id,
      patientId: consent.patient_id,
      templateId: consent.template_id,
      templateVersion: consent.template_version,
      templateTitle: consent.template_title,
      consentCapturedAt: consent.consent_captured_at,
      consentMethod: consent.consent_method,
      patientState: consent.patient_state,
      witnessName: consent.witness_name,
      witnessId: consent.witness_id,
      isValid: consent.is_valid,
      revokedAt: consent.revoked_at,
      revokedReason: consent.revoked_reason,
      expiresAt: consent.expires_at,
      createdAt: consent.created_at
    };
  }
  
  _getDefaultTemplate() {
    // Default telehealth consent template
    return {
      id: 'default',
      version: '1.0.0',
      title: 'Telehealth Informed Consent',
      contentHtml: `
        <h2>Informed Consent for Telehealth Services</h2>
        
        <p><strong>Nature of Telehealth Services:</strong></p>
        <p>Telehealth involves the use of electronic communications to enable healthcare providers 
        at different locations to share individual patient medical information for the purpose of 
        improving patient care. This may include live video visits, secure messaging, and review 
        of medical images or records.</p>
        
        <p><strong>Benefits:</strong></p>
        <ul>
          <li>Improved access to healthcare services</li>
          <li>Reduced travel time and waiting</li>
          <li>Ability to receive care from home</li>
          <li>Continuity of care during circumstances that prevent in-person visits</li>
        </ul>
        
        <p><strong>Risks:</strong></p>
        <ul>
          <li>Technology failures may interrupt or prevent services</li>
          <li>Despite security measures, electronic communications carry some risk of interception</li>
          <li>Limitations in physical examination capabilities</li>
          <li>Provider may determine that telehealth is not appropriate and in-person care is needed</li>
        </ul>
        
        <p><strong>Patient Rights:</strong></p>
        <ul>
          <li>Right to withdraw consent at any time</li>
          <li>Right to withhold or withdraw information</li>
          <li>Right to request in-person services</li>
          <li>Right to access medical records</li>
        </ul>
        
        <p><strong>Privacy and Security:</strong></p>
        <p>Our telehealth platform uses encryption and secure protocols to protect your health 
        information. We are HIPAA compliant and take measures to safeguard your privacy.</p>
        
        <p>By providing consent, you acknowledge that you have read and understand the above 
        information, have had the opportunity to ask questions, and agree to participate in 
        telehealth services.</p>
      `,
      contentPlain: `
        INFORMED CONSENT FOR TELEHEALTH SERVICES
        
        Nature of Telehealth Services:
        Telehealth involves the use of electronic communications to enable healthcare providers 
        at different locations to share individual patient medical information for the purpose of 
        improving patient care.
        
        Benefits: Improved access to healthcare services, reduced travel time and waiting, 
        ability to receive care from home.
        
        Risks: Technology failures may interrupt services, electronic communications carry 
        some risk despite security measures, limitations in physical examination, provider 
        may determine in-person care is needed.
        
        Patient Rights: Right to withdraw consent, withhold information, request in-person 
        services, and access medical records.
        
        By providing consent, you acknowledge understanding and agree to participate in 
        telehealth services.
      `,
      effectiveDate: new Date().toISOString(),
      isActive: true
    };
  }
}

module.exports = new TelehealthConsentService();
