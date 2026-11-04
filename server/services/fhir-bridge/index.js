/**
 * FHIR Bridge Service - Enterprise Healthcare Interoperability Layer
 * 
 * This service provides HL7 FHIR R4 compliance for integration with
 * major EHR systems like Epic, Cerner, and Allscripts.
 * 
 * @module fhir-bridge
 * @version 1.0.0
 */

const FHIRMapper = require('./mappers');
const SmartReferralDispatcher = require('./referral-dispatcher');
const ConsentManager = require('./consent-manager');
const FHIRValidator = require('./validator');

class FHIRBridge {
  constructor(db) {
    this.db = db;
    this.mapper = new FHIRMapper(db);
    this.referralDispatcher = new SmartReferralDispatcher(db);
    this.consentManager = new ConsentManager(db);
    this.validator = new FHIRValidator();
  }

  /**
   * Convert internal patient to FHIR Patient resource
   */
  async toFHIRPatient(patientId) {
    return this.mapper.toPatient(patientId);
  }

  /**
   * Convert internal encounter to FHIR Encounter resource
   */
  async toFHIREncounter(encounterId) {
    return this.mapper.toEncounter(encounterId);
  }

  /**
   * Convert internal prescription to FHIR MedicationRequest
   */
  async toFHIRMedicationRequest(prescriptionId) {
    return this.mapper.toMedicationRequest(prescriptionId);
  }

  /**
   * Convert vitals/labs to FHIR Observation resources
   */
  async toFHIRObservations(patientId, options = {}) {
    return this.mapper.toObservations(patientId, options);
  }

  /**
   * Create a FHIR Bundle for referral
   */
  async createReferralBundle(patientId, referralData) {
    // Check consent first
    const hasConsent = await this.consentManager.checkConsent(
      patientId,
      referralData.destinationOrganization,
      'referral'
    );

    if (!hasConsent) {
      throw new Error('Patient has not consented to data sharing with this organization');
    }

    const bundle = await this.referralDispatcher.createBundle(patientId, referralData);
    
    // Validate the bundle
    const validation = this.validator.validateBundle(bundle);
    if (!validation.valid) {
      throw new Error(`Invalid FHIR Bundle: ${validation.errors.join(', ')}`);
    }

    return bundle;
  }

  /**
   * Send referral to external hospital system
   */
  async dispatchReferral(patientId, referralData, destinationEndpoint) {
    const bundle = await this.createReferralBundle(patientId, referralData);
    return this.referralDispatcher.dispatch(bundle, destinationEndpoint);
  }

  /**
   * Generate CCDA document (Consolidated Clinical Document Architecture)
   */
  async generateCCDA(patientId, options = {}) {
    const CCDAGenerator = require('./ccda-generator');
    const generator = new CCDAGenerator(this.db, this.mapper);
    return generator.generate(patientId, options);
  }

  /**
   * Import FHIR resources from external system
   */
  async importFHIRResource(resource) {
    return this.mapper.fromFHIR(resource);
  }

  /**
   * Bulk export patient data in FHIR format (for population health)
   */
  async bulkExport(options = {}) {
    const { startDate, endDate, resourceTypes } = options;
    return this.mapper.bulkExport({ startDate, endDate, resourceTypes });
  }
}

module.exports = FHIRBridge;
