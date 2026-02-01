/**
 * FHIR Consent Manager
 * 
 * Manages patient consent for data sharing with external organizations.
 * Compliant with SMART on FHIR and OAuth 2.0 specifications.
 * 
 * @see https://www.hl7.org/fhir/consent.html
 * @see https://docs.smarthealthit.org/
 */

const { v4: uuidv4 } = require('uuid');

class ConsentManager {
  constructor(db) {
    this.db = db;
    this.systemUrl = process.env.FHIR_SYSTEM_URL || 'https://doctarx.com/fhir';
  }

  /**
   * Create a new consent record
   */
  async createConsent(consentData) {
    const {
      patientId,
      organizationId,
      organizationName,
      purpose,
      scope,
      dataCategories,
      validFrom,
      validUntil,
      grantedBy // patient or guardian
    } = consentData;

    const consentId = uuidv4();

    await this.db.query(
      `INSERT INTO patient_consents 
       (id, patient_id, organization_id, organization_name, purpose, scope,
        data_categories, valid_from, valid_until, granted_by, status, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'active', NOW())`,
      [
        consentId, patientId, organizationId, organizationName,
        purpose, scope, JSON.stringify(dataCategories),
        validFrom || new Date(), validUntil, grantedBy || patientId
      ]
    );

    // Create FHIR Consent resource
    const fhirConsent = this.toFHIRConsent({
      id: consentId,
      patientId,
      organizationId,
      organizationName,
      purpose,
      scope,
      dataCategories,
      validFrom,
      validUntil,
      status: 'active'
    });

    // Log the consent grant
    await this.logConsentEvent(consentId, patientId, 'granted', {
      organizationId,
      purpose,
      scope
    });

    return { consentId, fhirConsent };
  }

  /**
   * Check if patient has valid consent for a specific organization and purpose
   */
  async checkConsent(patientId, organizationId, purpose) {
    const { rows } = await this.db.query(
      `SELECT id, scope, data_categories, valid_until 
       FROM patient_consents
       WHERE patient_id = $1 
         AND organization_id = $2 
         AND (purpose = $3 OR purpose = 'all')
         AND status = 'active'
         AND (valid_until IS NULL OR valid_until > NOW())
       ORDER BY created_at DESC
       LIMIT 1`,
      [patientId, organizationId, purpose]
    );

    if (rows.length === 0) {
      return false;
    }

    return {
      valid: true,
      consentId: rows[0].id,
      scope: rows[0].scope,
      dataCategories: rows[0].data_categories,
      expiresAt: rows[0].valid_until
    };
  }

  /**
   * Revoke a consent
   */
  async revokeConsent(consentId, patientId, reason) {
    const { rowCount } = await this.db.query(
      `UPDATE patient_consents 
       SET status = 'revoked', revoked_at = NOW(), revoke_reason = $3
       WHERE id = $1 AND patient_id = $2`,
      [consentId, patientId, reason]
    );

    if (rowCount === 0) {
      throw new Error('Consent not found or already revoked');
    }

    // Log the revocation
    await this.logConsentEvent(consentId, patientId, 'revoked', { reason });

    return { success: true, consentId };
  }

  /**
   * Get all consents for a patient
   */
  async getPatientConsents(patientId, includeRevoked = false) {
    let query = `
      SELECT id, organization_id, organization_name, purpose, scope,
             data_categories, valid_from, valid_until, status,
             granted_by, created_at, revoked_at, revoke_reason
      FROM patient_consents
      WHERE patient_id = $1
    `;

    if (!includeRevoked) {
      query += ` AND status = 'active'`;
    }

    query += ` ORDER BY created_at DESC`;

    const { rows } = await this.db.query(query, [patientId]);
    return rows;
  }

  /**
   * Get consent as FHIR resource
   */
  async getFHIRConsent(consentId) {
    const { rows } = await this.db.query(
      `SELECT * FROM patient_consents WHERE id = $1`,
      [consentId]
    );

    if (rows.length === 0) {
      throw new Error('Consent not found');
    }

    return this.toFHIRConsent(rows[0]);
  }

  /**
   * Convert internal consent to FHIR Consent resource
   */
  toFHIRConsent(consent) {
    return {
      resourceType: 'Consent',
      id: consent.id,
      meta: {
        lastUpdated: new Date().toISOString(),
        profile: ['http://hl7.org/fhir/us/core/StructureDefinition/us-core-consent']
      },
      status: this.mapConsentStatus(consent.status),
      scope: {
        coding: [{
          system: 'http://terminology.hl7.org/CodeSystem/consentscope',
          code: 'patient-privacy',
          display: 'Privacy Consent'
        }]
      },
      category: [{
        coding: [{
          system: 'http://terminology.hl7.org/CodeSystem/v3-ActCode',
          code: 'IDSCL',
          display: 'Information Disclosure'
        }]
      }],
      patient: {
        reference: `Patient/${consent.patientId || consent.patient_id}`
      },
      dateTime: consent.created_at?.toISOString() || new Date().toISOString(),
      performer: [{
        reference: `Patient/${consent.granted_by || consent.patientId || consent.patient_id}`
      }],
      organization: [{
        reference: `Organization/${consent.organizationId || consent.organization_id}`,
        display: consent.organizationName || consent.organization_name
      }],
      sourceReference: {
        reference: `${this.systemUrl}/consent/${consent.id}`
      },
      policy: [{
        authority: this.systemUrl,
        uri: 'https://doctarx.com/privacy-policy'
      }],
      provision: {
        type: 'permit',
        period: {
          start: consent.validFrom?.toISOString() || consent.valid_from?.toISOString(),
          end: consent.validUntil?.toISOString() || consent.valid_until?.toISOString()
        },
        action: [{
          coding: [{
            system: 'http://terminology.hl7.org/CodeSystem/consentaction',
            code: 'disclose',
            display: 'Disclose'
          }]
        }],
        purpose: [{
          system: 'http://terminology.hl7.org/CodeSystem/v3-ActReason',
          code: this.mapPurposeCode(consent.purpose),
          display: consent.purpose
        }],
        class: this.mapDataCategories(consent.dataCategories || consent.data_categories)
      }
    };
  }

  /**
   * Validate consent request
   */
  validateConsentRequest(request) {
    const errors = [];

    if (!request.patientId) {
      errors.push('Patient ID is required');
    }

    if (!request.organizationId) {
      errors.push('Organization ID is required');
    }

    if (!request.purpose) {
      errors.push('Purpose is required');
    }

    const validPurposes = ['referral', 'treatment', 'payment', 'operations', 'research', 'all'];
    if (request.purpose && !validPurposes.includes(request.purpose)) {
      errors.push(`Invalid purpose. Must be one of: ${validPurposes.join(', ')}`);
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Log consent event for audit trail
   */
  async logConsentEvent(consentId, patientId, action, details) {
    await this.db.query(
      `INSERT INTO consent_audit_log 
       (consent_id, patient_id, action, details, created_at)
       VALUES ($1, $2, $3, $4, NOW())`,
      [consentId, patientId, action, JSON.stringify(details)]
    );
  }

  // Helper methods
  mapConsentStatus(status) {
    const statusMap = {
      'active': 'active',
      'revoked': 'rejected',
      'expired': 'inactive',
      'pending': 'proposed'
    };
    return statusMap[status] || 'inactive';
  }

  mapPurposeCode(purpose) {
    const purposeMap = {
      'referral': 'TREAT',
      'treatment': 'TREAT',
      'payment': 'HPAYMT',
      'operations': 'HOPERAT',
      'research': 'HRESCH',
      'all': 'TREAT'
    };
    return purposeMap[purpose] || 'TREAT';
  }

  mapDataCategories(categories) {
    if (!categories) return [];
    
    const categoryList = typeof categories === 'string' ? JSON.parse(categories) : categories;
    
    const categoryMap = {
      'demographics': { system: 'http://terminology.hl7.org/CodeSystem/v3-ActCode', code: 'DEMO' },
      'diagnoses': { system: 'http://terminology.hl7.org/CodeSystem/v3-ActCode', code: 'DIA' },
      'medications': { system: 'http://terminology.hl7.org/CodeSystem/v3-ActCode', code: 'DRUG' },
      'labs': { system: 'http://terminology.hl7.org/CodeSystem/v3-ActCode', code: 'LABCAT' },
      'vitals': { system: 'http://terminology.hl7.org/CodeSystem/v3-ActCode', code: 'COBSCAT' },
      'procedures': { system: 'http://terminology.hl7.org/CodeSystem/v3-ActCode', code: 'PROC' },
      'immunizations': { system: 'http://terminology.hl7.org/CodeSystem/v3-ActCode', code: 'IMMUCAT' }
    };

    return categoryList.map(cat => ({
      coding: [categoryMap[cat] || { system: 'http://terminology.hl7.org/CodeSystem/v3-ActCode', code: 'OBS' }]
    }));
  }
}

module.exports = ConsentManager;
