/**
 * Electronic Prescribing Integration Service
 * 
 * Abstraction layer for external e-prescribing services (iPrescribe, Surescripts, etc.)
 * 
 * IMPORTANT: This platform does NOT generate or transmit prescriptions internally.
 * Instead, it:
 * 1. Stores prescription intent metadata locally
 * 2. Hands off to external e-prescribing service
 * 3. Reconciles status from external service
 * 
 * Future integration points for iPrescribe Enterprise APIs:
 * - Provider authentication handoff (SSO/OAuth)
 * - Patient context linking
 * - Prescription status webhooks
 * - Medication history import
 */

const db = require('../db');
const logger = require('../middleware/logger');
const { encrypt, decrypt } = require('../../lib/encryption');
const { keysToCamel } = require('../../lib/utils');

// Configuration for supported e-prescribing systems
const ERX_SYSTEMS = {
  iprescribe: {
    name: 'iPrescribe',
    baseUrl: process.env.IPRESCRIBE_API_URL || 'https://api.iprescribe.com',
    clientId: process.env.IPRESCRIBE_CLIENT_ID,
    clientSecret: process.env.IPRESCRIBE_CLIENT_SECRET,
    // OAuth scopes for provider handoff
    scopes: ['prescribe', 'patient:read', 'provider:read', 'rx:write', 'rx:status'],
    supportsControlled: true,
    supportsEpcs: true // Electronic Prescribing for Controlled Substances
  },
  surescripts: {
    name: 'Surescripts',
    baseUrl: process.env.SURESCRIPTS_API_URL,
    supportsControlled: true,
    supportsEpcs: true
  }
};

class ERxIntegrationService {
  
  constructor() {
    this.defaultSystem = process.env.ERX_DEFAULT_SYSTEM || 'iprescribe';
  }
  
  // =========================================================================
  // PRESCRIPTION INTENT MANAGEMENT
  // =========================================================================
  
  /**
   * Create a prescription intent (local record before handoff to external eRx)
   * This stores the clinical rationale and medication details without transmitting a prescription
   */
  async createPrescriptionIntent(data, providerId) {
    const {
      encounterId,
      patientId,
      medicationName,
      genericName,
      dosageStrength,
      dosageForm,
      route,
      quantity,
      daysSupply,
      refillsAuthorized,
      indication,
      indicationIcd10,
      rationale,
      sigDirections,
      patientInstructions,
      pharmacyName,
      pharmacyNpi,
      pharmacyAddress,
      isControlled,
      scheduleClass
    } = data;
    
    // Verify encounter exists
    const { rows: encounters } = await db.query(
      `SELECT id, patient_id FROM clinical_encounters WHERE id = $1 AND provider_id = $2`,
      [encounterId, providerId]
    );
    
    if (encounters.length === 0) {
      throw new Error('Encounter not found or access denied');
    }
    
    // Encrypt clinical rationale
    const rationaleEncrypted = rationale 
      ? encrypt(rationale) 
      : { encrypted: null, iv: null, tag: null };
    
    const { rows } = await db.query(
      `INSERT INTO prescription_intents (
        encounter_id, patient_id, provider_id,
        medication_name, generic_name, dosage_strength, dosage_form, route,
        quantity, days_supply, refills_authorized,
        indication, indication_icd10,
        rationale_encrypted, rationale_iv, rationale_tag,
        sig_directions, patient_instructions,
        pharmacy_name, pharmacy_npi, pharmacy_address,
        is_controlled, schedule_class,
        status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, 'draft')
      RETURNING *`,
      [
        encounterId,
        patientId,
        providerId,
        medicationName,
        genericName || null,
        dosageStrength,
        dosageForm,
        route || 'oral',
        quantity,
        daysSupply,
        refillsAuthorized || 0,
        indication,
        indicationIcd10 || null,
        rationaleEncrypted.encrypted,
        rationaleEncrypted.iv,
        rationaleEncrypted.tag,
        sigDirections,
        patientInstructions || null,
        pharmacyName || null,
        pharmacyNpi || null,
        pharmacyAddress || null,
        isControlled || false,
        scheduleClass || null
      ]
    );
    
    logger.info('Prescription intent created', {
      intentId: rows[0].id,
      encounterId,
      providerId,
      medication: medicationName
    });
    
    return this._formatPrescriptionIntent(rows[0]);
  }
  
  /**
   * Update a prescription intent (before handoff)
   */
  async updatePrescriptionIntent(intentId, providerId, data) {
    // Verify ownership and status
    const { rows: existing } = await db.query(
      `SELECT * FROM prescription_intents WHERE id = $1 AND provider_id = $2`,
      [intentId, providerId]
    );
    
    if (existing.length === 0) {
      throw new Error('Prescription intent not found or access denied');
    }
    
    if (existing[0].status !== 'draft') {
      throw new Error('Cannot modify prescription intent after handoff');
    }
    
    const updates = [];
    const values = [];
    let paramIndex = 1;
    
    const allowedFields = [
      'medicationName', 'genericName', 'dosageStrength', 'dosageForm', 'route',
      'quantity', 'daysSupply', 'refillsAuthorized', 'indication', 'indicationIcd10',
      'sigDirections', 'patientInstructions', 'pharmacyName', 'pharmacyNpi', 'pharmacyAddress'
    ];
    
    for (const [key, value] of Object.entries(data)) {
      if (allowedFields.includes(key) && value !== undefined) {
        const snakeKey = key.replace(/([A-Z])/g, '_$1').toLowerCase();
        updates.push(`${snakeKey} = $${paramIndex++}`);
        values.push(value);
      }
    }
    
    if (data.rationale !== undefined) {
      const enc = encrypt(data.rationale);
      updates.push(`rationale_encrypted = $${paramIndex++}`);
      values.push(enc.encrypted);
      updates.push(`rationale_iv = $${paramIndex++}`);
      values.push(enc.iv);
      updates.push(`rationale_tag = $${paramIndex++}`);
      values.push(enc.tag);
    }
    
    if (updates.length === 0) {
      throw new Error('No valid fields to update');
    }
    
    values.push(intentId);
    
    const { rows } = await db.query(
      `UPDATE prescription_intents SET ${updates.join(', ')}, updated_at = NOW()
       WHERE id = $${paramIndex}
       RETURNING *`,
      values
    );
    
    return this._formatPrescriptionIntent(rows[0]);
  }
  
  /**
   * Get prescription intent by ID
   */
  async getPrescriptionIntent(intentId, userId, userRole) {
    const { rows } = await db.query(
      `SELECT pi.*,
              p.first_name as patient_first_name, p.last_name as patient_last_name,
              pr.first_name as provider_first_name, pr.last_name as provider_last_name,
              pr.credentials as provider_credentials
       FROM prescription_intents pi
       JOIN users p ON p.id = pi.patient_id
       JOIN users pr ON pr.id = pi.provider_id
       WHERE pi.id = $1`,
      [intentId]
    );
    
    if (rows.length === 0) {
      return null;
    }
    
    const intent = rows[0];
    
    // Access control
    if (userRole === 'patient' && intent.patient_id !== userId) {
      throw new Error('Access denied');
    }
    
    if (userRole === 'provider' && intent.provider_id !== userId) {
      throw new Error('Access denied');
    }
    
    return this._formatPrescriptionIntent(intent, true);
  }
  
  /**
   * Get prescription intents for an encounter
   */
  async getEncounterPrescriptionIntents(encounterId, userId, userRole) {
    let query = `
      SELECT pi.*,
             p.first_name as patient_first_name, p.last_name as patient_last_name
      FROM prescription_intents pi
      JOIN users p ON p.id = pi.patient_id
      WHERE pi.encounter_id = $1
    `;
    const params = [encounterId];
    
    if (userRole === 'patient') {
      query += ` AND pi.patient_id = $2`;
      params.push(userId);
    } else if (userRole === 'provider') {
      query += ` AND pi.provider_id = $2`;
      params.push(userId);
    }
    
    query += ` ORDER BY pi.created_at DESC`;
    
    const { rows } = await db.query(query, params);
    
    return rows.map(r => this._formatPrescriptionIntent(r));
  }

  /**
   * List prescription intents for a provider (across encounters)
   */
  async getProviderPrescriptionIntents(providerId, { status, limit = 50, offset = 0 } = {}) {
    let query = `
      SELECT pi.*,
             p.first_name as patient_first_name, p.last_name as patient_last_name
      FROM prescription_intents pi
      JOIN users p ON p.id = pi.patient_id
      WHERE pi.provider_id = $1
    `;
    const params = [providerId];
    let paramIndex = 2;

    if (status) {
      query += ` AND pi.status = $${paramIndex++}`;
      params.push(status);
    }

    query += ` ORDER BY pi.created_at DESC LIMIT $${paramIndex++} OFFSET $${paramIndex++}`;
    params.push(limit, offset);

    const { rows } = await db.query(query, params);
    return rows.map(r => this._formatPrescriptionIntent(r));
  }

  /**
   * List prescription intents for a patient (across encounters)
   */
  async getPatientPrescriptionIntents(patientId, { status, limit = 50, offset = 0 } = {}) {
    let query = `
      SELECT pi.*,
             pr.first_name as provider_first_name, pr.last_name as provider_last_name,
             pr.credentials as provider_credentials
      FROM prescription_intents pi
      JOIN users pr ON pr.id = pi.provider_id
      WHERE pi.patient_id = $1
    `;
    const params = [patientId];
    let paramIndex = 2;

    if (status) {
      query += ` AND pi.status = $${paramIndex++}`;
      params.push(status);
    }

    query += ` ORDER BY pi.created_at DESC LIMIT $${paramIndex++} OFFSET $${paramIndex++}`;
    params.push(limit, offset);

    const { rows } = await db.query(query, params);
    return rows.map(r => this._formatPrescriptionIntent(r));
  }
  
  // =========================================================================
  // EXTERNAL E-PRESCRIBING HANDOFF
  // =========================================================================
  
  /**
   * Generate handoff URL/context for external e-prescribing
   * This prepares the context for the provider to complete prescribing in iPrescribe
   */
  async initiateERxHandoff(intentId, providerId, eRxSystem = null) {
    const system = eRxSystem || this.defaultSystem;
    const config = ERX_SYSTEMS[system];
    
    if (!config) {
      throw new Error(`Unsupported e-prescribing system: ${system}`);
    }
    
    // Get prescription intent
    const { rows } = await db.query(
      `SELECT pi.*, 
              p.first_name as patient_first_name, p.last_name as patient_last_name,
              p.date_of_birth as patient_dob, p.phone as patient_phone,
              pr.npi_number, pr.license_number, pr.license_state
       FROM prescription_intents pi
       JOIN users p ON p.id = pi.patient_id
       JOIN users pr ON pr.id = pi.provider_id
       WHERE pi.id = $1 AND pi.provider_id = $2`,
      [intentId, providerId]
    );
    
    if (rows.length === 0) {
      throw new Error('Prescription intent not found');
    }
    
    const intent = rows[0];
    
    // Check if controlled and if EPCS is supported
    if (intent.is_controlled && !config.supportsEpcs) {
      throw new Error(`${config.name} does not support electronic prescribing for controlled substances`);
    }
    
    // Update status to pending
    await db.query(
      `UPDATE prescription_intents SET 
        status = 'pending_erx',
        external_erx_system = $1,
        updated_at = NOW()
       WHERE id = $2`,
      [system, intentId]
    );
    
    // Generate handoff context
    // In production, this would create an OAuth state, generate JWT, etc.
    const handoffContext = {
      intentId,
      system,
      systemName: config.name,
      
      // Patient context (to be passed to external system)
      patient: {
        firstName: intent.patient_first_name,
        lastName: intent.patient_last_name,
        dateOfBirth: intent.patient_dob,
        phone: intent.patient_phone
      },
      
      // Provider context
      provider: {
        npi: intent.npi_number,
        licenseNumber: intent.license_number,
        licenseState: intent.license_state
      },
      
      // Medication context
      medication: {
        name: intent.medication_name,
        genericName: intent.generic_name,
        dosageStrength: intent.dosage_strength,
        dosageForm: intent.dosage_form,
        quantity: intent.quantity,
        daysSupply: intent.days_supply,
        refills: intent.refills_authorized,
        sig: intent.sig_directions,
        isControlled: intent.is_controlled,
        schedule: intent.schedule_class
      },
      
      // Pharmacy context
      pharmacy: intent.pharmacy_npi ? {
        name: intent.pharmacy_name,
        npi: intent.pharmacy_npi,
        address: intent.pharmacy_address
      } : null,
      
      // Handoff URL (in production, this would be the actual SSO/OAuth URL)
      handoffUrl: this._generateHandoffUrl(config, intentId),
      
      // Callback URL for status updates
      callbackUrl: `${process.env.NEXT_PUBLIC_API_URL}/api/erx/callback/${intentId}`
    };
    
    logger.info('eRx handoff initiated', {
      intentId,
      system,
      providerId
    });
    
    return handoffContext;
  }
  
  /**
   * Process callback from external e-prescribing system
   * This would be called via webhook when the prescription is sent/updated
   */
  async processERxCallback(intentId, callbackData) {
    const {
      externalRxId,
      status,
      sentAt,
      pharmacyResponse,
      error
    } = callbackData;
    
    // Validate the callback (in production, verify signature/token)
    
    const statusMap = {
      'sent': 'sent_to_erx',
      'confirmed': 'erx_confirmed',
      'dispensed': 'erx_confirmed',
      'cancelled': 'cancelled',
      'error': 'erx_error',
      'denied': 'erx_error'
    };
    
    const internalStatus = statusMap[status] || 'pending_erx';
    
    const { rows } = await db.query(
      `UPDATE prescription_intents SET
        external_erx_id = COALESCE($1, external_erx_id),
        external_erx_status = $2,
        external_erx_sent_at = COALESCE($3, external_erx_sent_at),
        external_erx_status_updated_at = NOW(),
        status = $4,
        updated_at = NOW()
       WHERE id = $5
       RETURNING *`,
      [externalRxId, status, sentAt, internalStatus, intentId]
    );
    
    if (rows.length === 0) {
      logger.warn('eRx callback for unknown intent', { intentId, status });
      return null;
    }
    
    logger.info('eRx callback processed', {
      intentId,
      externalRxId,
      status,
      internalStatus
    });
    
    return this._formatPrescriptionIntent(rows[0]);
  }
  
  /**
   * Poll external system for prescription status
   * This is a fallback for when webhooks aren't available
   */
  async syncPrescriptionStatus(intentId) {
    const { rows } = await db.query(
      `SELECT * FROM prescription_intents WHERE id = $1`,
      [intentId]
    );
    
    if (rows.length === 0) {
      throw new Error('Prescription intent not found');
    }
    
    const intent = rows[0];
    
    if (!intent.external_erx_id || !intent.external_erx_system) {
      throw new Error('Prescription has not been sent to external system');
    }
    
    // In production, this would call the external API
    // const status = await this._fetchExternalStatus(intent.external_erx_system, intent.external_erx_id);
    
    logger.info('Prescription status sync requested', {
      intentId,
      externalId: intent.external_erx_id,
      system: intent.external_erx_system
    });
    
    // For now, return current status
    return this._formatPrescriptionIntent(intent);
  }
  
  /**
   * Cancel a prescription intent
   */
  async cancelPrescriptionIntent(intentId, providerId, reason) {
    const { rows } = await db.query(
      `UPDATE prescription_intents SET
        status = 'cancelled',
        updated_at = NOW()
       WHERE id = $1 AND provider_id = $2 AND status IN ('draft', 'pending_erx')
       RETURNING *`,
      [intentId, providerId]
    );
    
    if (rows.length === 0) {
      throw new Error('Prescription intent not found or cannot be cancelled');
    }
    
    logger.info('Prescription intent cancelled', { intentId, providerId, reason });
    
    return this._formatPrescriptionIntent(rows[0]);
  }
  
  // =========================================================================
  // PROVIDER AUTHENTICATION HANDOFF
  // =========================================================================
  
  /**
   * Generate OAuth authorization URL for provider SSO to external eRx
   */
  generateProviderAuthUrl(providerId, system = null) {
    const sysConfig = ERX_SYSTEMS[system || this.defaultSystem];
    
    if (!sysConfig || !sysConfig.clientId) {
      throw new Error('e-Prescribing system not configured');
    }
    
    // In production, this would generate proper OAuth state and redirect
    const state = Buffer.from(JSON.stringify({
      providerId,
      timestamp: Date.now(),
      nonce: Math.random().toString(36).substring(7)
    })).toString('base64');
    
    const authUrl = new URL(`${sysConfig.baseUrl}/oauth/authorize`);
    authUrl.searchParams.set('client_id', sysConfig.clientId);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('scope', sysConfig.scopes.join(' '));
    authUrl.searchParams.set('state', state);
    authUrl.searchParams.set('redirect_uri', `${process.env.NEXT_PUBLIC_API_URL}/api/erx/oauth/callback`);
    
    return authUrl.toString();
  }
  
  /**
   * Handle OAuth callback from external eRx system
   */
  async handleOAuthCallback(code, state) {
    // In production, exchange code for tokens and store securely
    logger.info('eRx OAuth callback received', { hasCode: !!code, hasState: !!state });
    
    // Decode and validate state
    // Exchange code for access token
    // Store tokens securely (encrypted)
    // Return success
    
    return { success: true, message: 'Provider linked to e-prescribing system' };
  }
  
  // =========================================================================
  // HELPER METHODS
  // =========================================================================
  
  _formatPrescriptionIntent(intent, includeRationale = false) {
    const formatted = {
      id: intent.id,
      encounterId: intent.encounter_id,
      patientId: intent.patient_id,
      providerId: intent.provider_id,
      medicationName: intent.medication_name,
      genericName: intent.generic_name,
      dosageStrength: intent.dosage_strength,
      dosageForm: intent.dosage_form,
      route: intent.route,
      quantity: intent.quantity,
      daysSupply: intent.days_supply,
      refillsAuthorized: intent.refills_authorized,
      indication: intent.indication,
      indicationIcd10: intent.indication_icd10,
      sigDirections: intent.sig_directions,
      patientInstructions: intent.patient_instructions,
      pharmacyName: intent.pharmacy_name,
      pharmacyNpi: intent.pharmacy_npi,
      pharmacyAddress: intent.pharmacy_address,
      isControlled: intent.is_controlled,
      scheduleClass: intent.schedule_class,
      externalErxSystem: intent.external_erx_system,
      externalErxId: intent.external_erx_id,
      externalErxStatus: intent.external_erx_status,
      externalErxSentAt: intent.external_erx_sent_at,
      externalErxStatusUpdatedAt: intent.external_erx_status_updated_at,
      status: intent.status,
      createdAt: intent.created_at,
      updatedAt: intent.updated_at
    };
    
    // Add patient/provider names if present
    if (intent.patient_first_name) {
      formatted.patient = {
        firstName: intent.patient_first_name,
        lastName: intent.patient_last_name
      };
    }
    
    if (intent.provider_first_name) {
      formatted.provider = {
        firstName: intent.provider_first_name,
        lastName: intent.provider_last_name,
        credentials: intent.provider_credentials
      };
    }
    
    // Decrypt rationale if requested
    if (includeRationale && intent.rationale_encrypted) {
      formatted.rationale = decrypt(
        intent.rationale_encrypted,
        intent.rationale_iv,
        intent.rationale_tag
      );
    }
    
    return formatted;
  }
  
  _generateHandoffUrl(config, intentId) {
    // In production, this would generate the actual SSO URL
    // For now, return a placeholder that shows the expected format
    return `${config.baseUrl}/prescribe?context=${intentId}&callback=${encodeURIComponent(
      `${process.env.NEXT_PUBLIC_API_URL}/api/erx/callback/${intentId}`
    )}`;
  }
  
  /**
   * Check if provider is authorized to prescribe controlled substances
   */
  async canPrescribeControlled(providerId) {
    const { rows } = await db.query(
      `SELECT dea_number_encrypted, dea_expiration FROM users WHERE id = $1 AND role = 'provider'`,
      [providerId]
    );
    
    if (rows.length === 0) {
      return false;
    }
    
    const provider = rows[0];
    
    // Must have DEA and it must not be expired
    if (!provider.dea_number_encrypted) {
      return false;
    }
    
    if (provider.dea_expiration && new Date(provider.dea_expiration) < new Date()) {
      return false;
    }
    
    return true;
  }
}

module.exports = new ERxIntegrationService();
