/**
 * Smart Referral Dispatcher
 * 
 * Creates FHIR Bundles for patient referrals and dispatches them
 * to hospital EHR systems via secure REST API.
 * 
 * Supports: Epic, Cerner, Allscripts, and generic FHIR R4 endpoints
 */

const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const FHIRMapper = require('./mappers');

class SmartReferralDispatcher {
  constructor(db) {
    this.db = db;
    this.mapper = new FHIRMapper(db);
    this.systemUrl = process.env.FHIR_SYSTEM_URL || 'https://doctarx.com/fhir';
  }

  /**
   * Create a complete FHIR Bundle for referral
   * Bundle type: 'message' for referral workflow
   */
  async createBundle(patientId, referralData) {
    const {
      referringProviderId,
      destinationOrganization,
      specialty,
      urgency,
      reasonForReferral,
      clinicalNotes,
      includeHistory = true,
      includeMedications = true,
      includeVitals = true
    } = referralData;

    // Gather all resources
    const patient = await this.mapper.toPatient(patientId);
    const resources = [patient];

    // Get referring provider info
    const referringPractitioner = await this.getPractitioner(referringProviderId);
    resources.push(referringPractitioner);

    // Add recent encounters if requested
    if (includeHistory) {
      const encounters = await this.getRecentEncounters(patientId, 5);
      resources.push(...encounters);
    }

    // Add active medications if requested
    if (includeMedications) {
      const medications = await this.getActiveMedications(patientId);
      resources.push(...medications);
    }

    // Add recent vitals if requested
    if (includeVitals) {
      const observations = await this.mapper.toObservations(patientId, {
        startDate: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) // Last 30 days
      });
      resources.push(...observations);
    }

    // Create the ServiceRequest (the actual referral)
    const serviceRequest = this.createServiceRequest({
      patientId,
      referringProviderId,
      destinationOrganization,
      specialty,
      urgency,
      reasonForReferral,
      clinicalNotes
    });
    resources.push(serviceRequest);

    // Create the MessageHeader
    const messageHeader = this.createMessageHeader({
      serviceRequestId: serviceRequest.id,
      referringProviderId,
      destinationOrganization
    });

    // Build the Bundle
    const bundle = {
      resourceType: 'Bundle',
      id: uuidv4(),
      meta: {
        lastUpdated: new Date().toISOString(),
        profile: ['http://hl7.org/fhir/us/core/StructureDefinition/us-core-documentreference']
      },
      identifier: {
        system: `${this.systemUrl}/referral-bundle`,
        value: uuidv4()
      },
      type: 'message',
      timestamp: new Date().toISOString(),
      entry: [
        { fullUrl: `urn:uuid:${messageHeader.id}`, resource: messageHeader },
        ...resources.map(resource => ({
          fullUrl: `urn:uuid:${resource.id}`,
          resource
        }))
      ]
    };

    // Log the referral creation
    await this.logReferralCreation(bundle, patientId, referralData);

    return bundle;
  }

  /**
   * Create ServiceRequest resource (the referral order)
   */
  createServiceRequest(data) {
    const {
      patientId,
      referringProviderId,
      destinationOrganization,
      specialty,
      urgency,
      reasonForReferral,
      clinicalNotes
    } = data;

    return {
      resourceType: 'ServiceRequest',
      id: uuidv4(),
      meta: {
        profile: ['http://hl7.org/fhir/us/core/StructureDefinition/us-core-servicerequest']
      },
      identifier: [{
        system: `${this.systemUrl}/referral-id`,
        value: uuidv4()
      }],
      status: 'active',
      intent: 'order',
      priority: this.mapUrgency(urgency),
      category: [{
        coding: [{
          system: 'http://snomed.info/sct',
          code: '3457005',
          display: 'Patient referral'
        }]
      }],
      code: {
        coding: [{
          system: 'http://snomed.info/sct',
          code: this.getSpecialtyCode(specialty),
          display: `Referral to ${specialty} service`
        }]
      },
      subject: {
        reference: `Patient/${patientId}`
      },
      occurrenceDateTime: new Date().toISOString(),
      authoredOn: new Date().toISOString(),
      requester: {
        reference: `Practitioner/${referringProviderId}`
      },
      performer: [{
        reference: `Organization/${destinationOrganization.id}`,
        display: destinationOrganization.name
      }],
      reasonCode: [{
        text: reasonForReferral
      }],
      note: clinicalNotes ? [{
        text: clinicalNotes
      }] : []
    };
  }

  /**
   * Create MessageHeader for the referral message
   */
  createMessageHeader(data) {
    const { serviceRequestId, referringProviderId, destinationOrganization } = data;

    return {
      resourceType: 'MessageHeader',
      id: uuidv4(),
      eventCoding: {
        system: 'http://terminology.hl7.org/CodeSystem/v2-0003',
        code: 'REF_I12',
        display: 'Patient referral'
      },
      destination: [{
        name: destinationOrganization.name,
        endpoint: destinationOrganization.fhirEndpoint
      }],
      source: {
        name: 'Docta Telehealth',
        endpoint: this.systemUrl
      },
      focus: [{
        reference: `ServiceRequest/${serviceRequestId}`
      }],
      sender: {
        reference: `Practitioner/${referringProviderId}`
      }
    };
  }

  /**
   * Dispatch the referral bundle to the destination
   */
  async dispatch(bundle, destinationEndpoint) {
    const { url, authType, credentials } = destinationEndpoint;

    try {
      // Build headers based on auth type
      const headers = {
        'Content-Type': 'application/fhir+json',
        'Accept': 'application/fhir+json'
      };

      if (authType === 'bearer') {
        headers['Authorization'] = `Bearer ${credentials.token}`;
      } else if (authType === 'basic') {
        const auth = Buffer.from(`${credentials.username}:${credentials.password}`).toString('base64');
        headers['Authorization'] = `Basic ${auth}`;
      } else if (authType === 'smart') {
        // SMART on FHIR OAuth flow
        const token = await this.getSmartToken(destinationEndpoint);
        headers['Authorization'] = `Bearer ${token}`;
      }

      const response = await axios.post(url, bundle, {
        headers,
        timeout: 30000
      });

      // Log successful dispatch
      await this.logReferralDispatch(bundle.id, destinationEndpoint, 'success', response.data);

      return {
        success: true,
        bundleId: bundle.id,
        response: response.data,
        timestamp: new Date().toISOString()
      };

    } catch (error) {
      // Log failed dispatch
      await this.logReferralDispatch(bundle.id, destinationEndpoint, 'failed', {
        error: error.message,
        status: error.response?.status
      });

      throw new Error(`Referral dispatch failed: ${error.message}`);
    }
  }

  /**
   * Get SMART on FHIR access token
   */
  async getSmartToken(endpoint) {
    const { tokenUrl, clientId, clientSecret, scope } = endpoint.credentials;

    const response = await axios.post(tokenUrl, 
      new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: clientId,
        client_secret: clientSecret,
        scope: scope || 'system/*.write'
      }), 
      {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
      }
    );

    return response.data.access_token;
  }

  /**
   * Helper: Get Practitioner resource
   */
  async getPractitioner(providerId) {
    const { rows } = await this.db.query(
      `SELECT id, email, first_name, last_name, specialty, npi_number,
              license_number, license_state, credentials
       FROM users WHERE id = $1 AND role = 'provider'`,
      [providerId]
    );

    if (rows.length === 0) {
      throw new Error(`Provider not found: ${providerId}`);
    }

    const provider = rows[0];

    return {
      resourceType: 'Practitioner',
      id: provider.id,
      identifier: [
        {
          system: 'http://hl7.org/fhir/sid/us-npi',
          value: provider.npi_number
        },
        {
          system: `${this.systemUrl}/provider-id`,
          value: provider.id
        }
      ],
      active: true,
      name: [{
        family: provider.last_name,
        given: [provider.first_name],
        suffix: provider.credentials ? [provider.credentials] : []
      }],
      telecom: [{
        system: 'email',
        value: provider.email
      }],
      qualification: [{
        code: {
          text: provider.specialty
        },
        identifier: [{
          system: `urn:oid:2.16.840.1.113883.4.6`,
          value: provider.license_number
        }],
        issuer: {
          display: `State of ${provider.license_state}`
        }
      }]
    };
  }

  /**
   * Helper: Get recent encounters for patient
   */
  async getRecentEncounters(patientId, limit = 5) {
    const { rows } = await this.db.query(
      `SELECT id FROM appointments 
       WHERE patient_id = $1 AND status = 'completed'
       ORDER BY scheduled_time DESC LIMIT $2`,
      [patientId, limit]
    );

    const encounters = [];
    for (const row of rows) {
      const encounter = await this.mapper.toEncounter(row.id);
      encounters.push(encounter);
    }

    return encounters;
  }

  /**
   * Helper: Get active medications for patient
   */
  async getActiveMedications(patientId) {
    const { rows } = await this.db.query(
      `SELECT id FROM prescriptions 
       WHERE patient_id = $1 AND status = 'active'
       ORDER BY prescribed_date DESC`,
      [patientId]
    );

    const medications = [];
    for (const row of rows) {
      const medication = await this.mapper.toMedicationRequest(row.id);
      medications.push(medication);
    }

    return medications;
  }

  // Mapping helpers
  mapUrgency(urgency) {
    const urgencyMap = {
      'routine': 'routine',
      'urgent': 'urgent',
      'emergent': 'stat',
      'asap': 'asap'
    };
    return urgencyMap[urgency?.toLowerCase()] || 'routine';
  }

  getSpecialtyCode(specialty) {
    const specialtyCodes = {
      'cardiology': '3842006',
      'dermatology': '394582007',
      'endocrinology': '394583002',
      'gastroenterology': '394584008',
      'neurology': '394585009',
      'oncology': '394592004',
      'orthopedics': '394601005',
      'psychiatry': '394587001',
      'pulmonology': '418112009',
      'rheumatology': '394810000'
    };
    return specialtyCodes[specialty?.toLowerCase()] || '3457005';
  }

  /**
   * Log referral creation for audit trail
   */
  async logReferralCreation(bundle, patientId, referralData) {
    await this.db.query(
      `INSERT INTO referral_audit_log 
       (bundle_id, patient_id, destination_org, specialty, status, created_at)
       VALUES ($1, $2, $3, $4, 'created', NOW())`,
      [bundle.id, patientId, referralData.destinationOrganization?.name, referralData.specialty]
    );
  }

  /**
   * Log referral dispatch attempt
   */
  async logReferralDispatch(bundleId, endpoint, status, response) {
    await this.db.query(
      `INSERT INTO referral_dispatch_log 
       (bundle_id, endpoint_url, status, response_data, dispatched_at)
       VALUES ($1, $2, $3, $4, NOW())`,
      [bundleId, endpoint.url, status, JSON.stringify(response)]
    );
  }
}

module.exports = SmartReferralDispatcher;
