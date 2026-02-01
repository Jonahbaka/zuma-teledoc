/**
 * FHIR Resource Validator
 * 
 * Validates FHIR R4 resources before sending to external systems
 */

class FHIRValidator {
  /**
   * Validate a FHIR resource
   */
  validate(resource) {
    const errors = [];

    // Check required fields
    if (!resource.resourceType) {
      errors.push('Missing resourceType');
    }

    // Resource-specific validation
    switch (resource.resourceType) {
      case 'Patient':
        this.validatePatient(resource, errors);
        break;
      case 'Encounter':
        this.validateEncounter(resource, errors);
        break;
      case 'MedicationRequest':
        this.validateMedicationRequest(resource, errors);
        break;
      case 'Observation':
        this.validateObservation(resource, errors);
        break;
      case 'ServiceRequest':
        this.validateServiceRequest(resource, errors);
        break;
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Validate a FHIR Bundle
   */
  validateBundle(bundle) {
    const errors = [];

    if (bundle.resourceType !== 'Bundle') {
      errors.push('Resource must be a Bundle');
    }

    if (!bundle.type) {
      errors.push('Bundle must have a type');
    }

    if (!bundle.entry || bundle.entry.length === 0) {
      errors.push('Bundle must have at least one entry');
    }

    // Validate each entry
    if (bundle.entry) {
      for (let i = 0; i < bundle.entry.length; i++) {
        const entry = bundle.entry[i];
        if (!entry.resource) {
          errors.push(`Entry ${i} is missing resource`);
          continue;
        }

        const resourceValidation = this.validate(entry.resource);
        if (!resourceValidation.valid) {
          errors.push(`Entry ${i} (${entry.resource.resourceType}): ${resourceValidation.errors.join(', ')}`);
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  validatePatient(patient, errors) {
    if (!patient.name || patient.name.length === 0) {
      errors.push('Patient must have at least one name');
    }
  }

  validateEncounter(encounter, errors) {
    if (!encounter.status) {
      errors.push('Encounter must have a status');
    }
    if (!encounter.class) {
      errors.push('Encounter must have a class');
    }
    if (!encounter.subject) {
      errors.push('Encounter must have a subject (patient reference)');
    }
  }

  validateMedicationRequest(medRequest, errors) {
    if (!medRequest.status) {
      errors.push('MedicationRequest must have a status');
    }
    if (!medRequest.intent) {
      errors.push('MedicationRequest must have an intent');
    }
    if (!medRequest.subject) {
      errors.push('MedicationRequest must have a subject');
    }
    if (!medRequest.medicationCodeableConcept && !medRequest.medicationReference) {
      errors.push('MedicationRequest must have medication information');
    }
  }

  validateObservation(observation, errors) {
    if (!observation.status) {
      errors.push('Observation must have a status');
    }
    if (!observation.code) {
      errors.push('Observation must have a code');
    }
  }

  validateServiceRequest(serviceRequest, errors) {
    if (!serviceRequest.status) {
      errors.push('ServiceRequest must have a status');
    }
    if (!serviceRequest.intent) {
      errors.push('ServiceRequest must have an intent');
    }
    if (!serviceRequest.subject) {
      errors.push('ServiceRequest must have a subject');
    }
  }
}

module.exports = FHIRValidator;
