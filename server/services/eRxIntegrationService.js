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
const { assertEncounterWriteOwnership } = require('../../ng/services/clinical/clinicalRecordIntegrityService');
const uuidPattern = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const intentAccessError = (status, message, code) => Object.assign(new Error(message), { status, statusCode: status, code });

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
    
    if (![encounterId, patientId, providerId].every(value => typeof value === 'string' && uuidPattern.test(value))) {
      throw intentAccessError(400, 'Valid patient, encounter and clinician references are required.', 'PRESCRIPTION_REFERENCE_INVALID');
    }
    const client = await db.getPool().connect();
    try {
      await client.query('BEGIN');
      // This is an owned clinical encounter, not a caller-supplied care link.
      // Lock both current accounts and the encounter until insert/audit commit.
      const { rows: encounters } = await client.query(
        `SELECT ce.id,ce.patient_id,ce.provider_id AS provider_user_id,ce.appointment_id
           FROM clinical_encounters ce
           JOIN users actor ON actor.id=ce.provider_id
           JOIN users patient ON patient.id=ce.patient_id
          WHERE ce.id=$1 AND ce.patient_id=$2 AND ce.provider_id=$3
            AND actor.role='provider' AND actor.is_active=TRUE AND actor.provider_status='approved'
            AND patient.role='patient' AND patient.is_active=TRUE
            AND actor.market_scope IN ('US','NG') AND actor.market_scope=patient.market_scope
            AND (actor.market_scope='US' OR EXISTS (SELECT 1 FROM ng_providers profile WHERE profile.user_id=actor.id AND profile.status='verified'))
            AND ce.status::text NOT IN ('cancelled','voided','entered_in_error')
          FOR SHARE OF ce,actor,patient`,
        [encounterId, patientId, providerId]
      );
      const encounter = encounters[0];
      if (!encounter) throw intentAccessError(403, 'This patient and encounter are not available to this clinician.', 'PRESCRIPTION_CONTEXT_DENIED');
      assertEncounterWriteOwnership({ encounter, actorUserId: providerId });
      if (encounter.appointment_id) {
        const appointment = await client.query(
          `SELECT id FROM appointments WHERE id=$1 AND patient_id=$2 AND provider_id=$3
             AND status NOT IN ('cancelled','no_show') FOR SHARE`,
          [encounter.appointment_id, patientId, providerId]
        );
        if (!appointment.rows.length) throw intentAccessError(403, 'The encounter consultation does not match this patient and clinician.', 'PRESCRIPTION_APPOINTMENT_MISMATCH');
      }

    // Encrypt clinical rationale
    const rationaleEncrypted = rationale 
      ? encrypt(rationale) 
      : { encrypted: null, iv: null, tag: null };
    
    const { rows } = await client.query(
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
    
      const intent = rows[0];
      if (!intent) throw intentAccessError(503, 'Prescription intent recording could not be confirmed.', 'PRESCRIPTION_RECORDING_UNAVAILABLE');
      await client.query(
        `INSERT INTO audit_logs (user_id,action,resource_type,resource_id,patient_id,description,new_values,phi_accessed,success)
         VALUES ($1,'create','prescription_intent',$2,$3,'Clinician recorded an encounter-bound prescription draft',$4::jsonb,TRUE,TRUE)`,
        [providerId, intent.id, patientId, JSON.stringify({ encounterId, status: 'draft' })]
      );
      await client.query('COMMIT');
      logger.info('Prescription intent created', { intentId: intent.id, encounterId, providerId });
      return this._formatPrescriptionIntent(intent);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
  }
  
  /**
   * Update a prescription intent (before handoff)
   */
  async updatePrescriptionIntent(intentId, providerId, data) {
    this._assertIntentReferences(intentId, providerId);
    if (!data || typeof data !== 'object' || Array.isArray(data) ||
        (data.rationale !== undefined && data.rationale !== null && typeof data.rationale !== 'string')) {
      throw intentAccessError(400, 'Valid prescription draft changes are required.', 'PRESCRIPTION_UPDATE_INVALID');
    }
    const updates = [];
    const values = [];
    const changedFields = [];
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
        changedFields.push(key);
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
      changedFields.push('rationale');
    }
    
    if (updates.length === 0) {
      throw intentAccessError(400, 'No valid prescription draft changes were supplied.', 'PRESCRIPTION_UPDATE_INVALID');
    }
    const client = await db.getPool().connect();
    try {
      await client.query('BEGIN');
      const existing = await this._lockWritablePrescriptionIntent(client, intentId, providerId);
      this._assertLocalMutableIntent(existing, ['draft']);
      values.push(intentId, providerId);
      const { rows } = await client.query(
        `UPDATE prescription_intents SET ${updates.join(', ')}, updated_at = NOW()
         WHERE id=$${paramIndex} AND provider_id=$${paramIndex + 1} AND status='draft'
         RETURNING *`, values
      );
      if (!rows[0]) throw intentAccessError(503, 'Prescription draft changes could not be confirmed.', 'PRESCRIPTION_RECORDING_UNAVAILABLE');
      await client.query(
        `INSERT INTO audit_logs (user_id,action,resource_type,resource_id,patient_id,description,new_values,phi_accessed,success)
         VALUES ($1,'update','prescription_intent',$2,$3,'Clinician updated an encounter-bound prescription draft',$4::jsonb,TRUE,TRUE)`,
        [providerId, intentId, existing.patient_id, JSON.stringify({ encounterId: existing.encounter_id, status: 'draft', changedFields })]
      );
      await client.query('COMMIT');
      return this._formatPrescriptionIntent(rows[0]);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
  }

  _assertIntentReferences(intentId, providerId) {
    if (![intentId, providerId].every(value => typeof value === 'string' && uuidPattern.test(value))) {
      throw intentAccessError(400, 'Valid prescription and clinician references are required.', 'PRESCRIPTION_REFERENCE_INVALID');
    }
  }

  async _lockWritablePrescriptionIntent(client, intentId, providerId) {
    // Ownership alone does not authorize returning or changing a clinical row.
    // Keep its current patient, encounter, accounts and consultation bound until audit commit.
    const { rows } = await client.query(
      `SELECT pi.*,ce.appointment_id AS bound_appointment_id,ce.provider_id AS provider_user_id,actor.market_scope AS actor_market
         FROM prescription_intents pi
         JOIN clinical_encounters ce ON ce.id=pi.encounter_id AND ce.patient_id=pi.patient_id AND ce.provider_id=pi.provider_id
         JOIN users actor ON actor.id=pi.provider_id
         JOIN users patient ON patient.id=pi.patient_id
        WHERE pi.id=$1 AND pi.provider_id=$2
          AND actor.role='provider' AND actor.is_active=TRUE AND actor.provider_status='approved'
          AND patient.role='patient' AND patient.is_active=TRUE
          AND actor.market_scope IN ('US','NG') AND actor.market_scope=patient.market_scope
          AND ce.status::text NOT IN ('cancelled','voided','entered_in_error')
        FOR UPDATE OF pi FOR SHARE OF ce,actor,patient`, [intentId, providerId]
    );
    const intent = rows[0];
    if (!intent) throw intentAccessError(403, 'This prescription and encounter are not available to this clinician.', 'PRESCRIPTION_CONTEXT_DENIED');
    assertEncounterWriteOwnership({ encounter: intent, actorUserId: providerId });
    if (intent.actor_market === 'NG') {
      const profile = await client.query("SELECT id FROM ng_providers WHERE user_id=$1 AND status='verified' FOR SHARE", [providerId]);
      if (!profile.rows.length) throw intentAccessError(403, 'This prescription and encounter are not available to this clinician.', 'PRESCRIPTION_CONTEXT_DENIED');
    }
    if (intent.bound_appointment_id) {
      const appointment = await client.query(
        `SELECT id FROM appointments WHERE id=$1 AND patient_id=$2 AND provider_id=$3
           AND status NOT IN ('cancelled','no_show') FOR SHARE`,
        [intent.bound_appointment_id, intent.patient_id, providerId]
      );
      if (!appointment.rows.length) throw intentAccessError(403, 'The encounter consultation does not match this patient and clinician.', 'PRESCRIPTION_APPOINTMENT_MISMATCH');
    }
    return intent;
  }

  _assertLocalMutableIntent(intent, allowedStatuses) {
    if (!allowedStatuses.includes(intent.status) || intent.external_erx_id || intent.external_erx_sent_at ||
        intent.external_erx_status || intent.external_erx_status_updated_at) {
      throw intentAccessError(409, 'This prescription is no longer a mutable local draft. External prescription changes require a verified prescribing service.', 'PRESCRIPTION_IMMUTABLE');
    }
  }

  /**
   * Get prescription intent by ID
   */
  async _listOwnedIntents(userId, expectedRole, { intentId, encounterId, status, limit = 50, offset = 0, includeRationale = false } = {}) {
    if (!uuidPattern.test(String(userId || '')) || !['patient', 'provider'].includes(expectedRole)) throw intentAccessError(403, 'Prescription record access denied.', 'PRESCRIPTION_READER_DENIED');
    const actor = (await db.query(
      `SELECT id,role,market_scope,is_active,provider_status FROM users WHERE id=$1`, [userId]
    )).rows[0];
    if (!actor?.is_active || actor.role !== expectedRole || !['US', 'NG'].includes(actor.market_scope) ||
      (actor.role === 'provider' && actor.provider_status !== 'approved')) throw intentAccessError(403, 'Prescription record access denied.', 'PRESCRIPTION_READER_DENIED');
    if ((intentId && !uuidPattern.test(String(intentId))) || (encounterId && !uuidPattern.test(String(encounterId)))) throw intentAccessError(400, 'A valid prescription or encounter reference is required.', 'PRESCRIPTION_REFERENCE_INVALID');
    if (!Number.isInteger(limit) || limit < 1 || limit > 200 || !Number.isInteger(offset) || offset < 0 ||
      (status !== undefined && (typeof status !== 'string' || status.length > 50))) throw intentAccessError(400, 'Invalid prescription list controls.', 'PRESCRIPTION_LIST_INVALID');
    const params = [userId, actor.market_scope, actor.role];
    let query = `SELECT pi.*,p.first_name AS patient_first_name,p.last_name AS patient_last_name,
        pr.first_name AS provider_first_name,pr.last_name AS provider_last_name,pr.credentials AS provider_credentials
      FROM prescription_intents pi
      JOIN clinical_encounters ce ON ce.id=pi.encounter_id AND ce.patient_id=pi.patient_id AND ce.provider_id=pi.provider_id
      JOIN users p ON p.id=pi.patient_id AND p.role='patient'
      JOIN users pr ON pr.id=pi.provider_id AND pr.role='provider'
      JOIN users actor ON actor.id=$1
      WHERE actor.is_active=TRUE AND actor.role=$3 AND actor.market_scope=$2 AND p.market_scope=$2 AND pr.market_scope=$2
        AND (actor.role='patient' AND pi.patient_id=actor.id OR actor.role='provider' AND pi.provider_id=actor.id AND actor.provider_status='approved')`;
    if (intentId) { params.push(intentId); query += ' AND pi.id=$' + params.length; }
    if (encounterId) { params.push(encounterId); query += ' AND pi.encounter_id=$' + params.length; }
    if (status) { params.push(status); query += ' AND pi.status=$' + params.length; }
    params.push(limit, offset); query += ' ORDER BY pi.created_at DESC,pi.id DESC LIMIT $' + (params.length - 1) + ' OFFSET $' + params.length;
    const result = await db.query(query, params);
    return result.rows.map(row => this._formatPrescriptionIntent(row, includeRationale));
  }

  async getPrescriptionIntent(intentId, userId, userRole) {
    return (await this._listOwnedIntents(userId, userRole, { intentId, limit: 1, includeRationale: true }))[0] || null;
  }

  async getEncounterPrescriptionIntents(encounterId, userId, userRole) {
    return this._listOwnedIntents(userId, userRole, { encounterId, limit: 200 });
  }

  async getProviderPrescriptionIntents(providerId, options = {}) {
    return this._listOwnedIntents(providerId, 'provider', options);
  }

  async getPatientPrescriptionIntents(patientId, options = {}) {
    return this._listOwnedIntents(patientId, 'patient', options);
  }
  
  // =========================================================================
  // EXTERNAL E-PRESCRIBING HANDOFF
  // =========================================================================
  
  /**
   * Generate handoff URL/context for external e-prescribing
   * This prepares the context for the provider to complete prescribing in iPrescribe
   */
  async initiateERxHandoff(_intentId, _providerId, _eRxSystem = null) {
    // A URL assembled from configuration is not an authenticated partner
    // handoff. Preserve the draft until an actual adapter can confirm it.
    throw intentAccessError(503, 'External prescribing handoff is not activated. The recorded draft has not been transmitted.', 'ERX_ADAPTER_NOT_ACTIVATED');
  }
  
  /**
   * Process callback from external e-prescribing system
   * This would be called via webhook when the prescription is sent/updated
   */
  async processERxCallback(_intentId, _callbackData) {
    // No authenticated provider callback/receipt verifier is implemented.
    // Caller-supplied status can never attest to transmission or dispensing.
    throw intentAccessError(503, 'External prescribing callback verification is not activated.', 'ERX_CALLBACK_NOT_ACTIVATED');
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
    this._assertIntentReferences(intentId, providerId);
    if (typeof reason !== 'string' || !reason.trim() || reason.trim().length > 2000) {
      throw intentAccessError(400, 'A cancellation reason of at most 2000 characters is required.', 'PRESCRIPTION_CANCELLATION_REASON_INVALID');
    }
    const client = await db.getPool().connect();
    try {
      await client.query('BEGIN');
      const existing = await this._lockWritablePrescriptionIntent(client, intentId, providerId);
      this._assertLocalMutableIntent(existing, ['draft', 'pending_erx']);
      const { rows } = await client.query(
        `UPDATE prescription_intents SET status='cancelled',updated_at=NOW()
         WHERE id=$1 AND provider_id=$2 AND status IN ('draft','pending_erx') RETURNING *`,
        [intentId, providerId]
      );
      if (!rows[0]) throw intentAccessError(503, 'Prescription draft cancellation could not be confirmed.', 'PRESCRIPTION_RECORDING_UNAVAILABLE');
      await client.query(
        `INSERT INTO audit_logs (user_id,action,resource_type,resource_id,patient_id,description,new_values,phi_accessed,success)
         VALUES ($1,'update','prescription_intent',$2,$3,'Clinician cancelled a local encounter-bound prescription draft',$4::jsonb,TRUE,TRUE)`,
        [providerId, intentId, existing.patient_id, JSON.stringify({ encounterId: existing.encounter_id, status: 'cancelled', cancellationReasonEncrypted: encrypt(reason.trim()) })]
      );
      await client.query('COMMIT');
      logger.info('Prescription intent cancelled', { intentId, providerId });
      return this._formatPrescriptionIntent(rows[0]);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
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
