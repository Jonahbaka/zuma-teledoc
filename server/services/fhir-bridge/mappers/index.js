/**
 * FHIR R4 Resource Mappers
 * 
 * Maps internal PostgreSQL data models to HL7 FHIR R4 resources.
 * Compliant with US Core Implementation Guide.
 * 
 * @see https://www.hl7.org/fhir/R4/
 * @see https://www.hl7.org/fhir/us/core/
 */

const { v4: uuidv4 } = require('uuid');

class FHIRMapper {
  constructor(db) {
    this.db = db;
    this.systemUrl = process.env.FHIR_SYSTEM_URL || 'https://doctarx.com/fhir';
  }

  /**
   * Map internal user/patient to FHIR Patient resource
   * @param {string} patientId - Internal patient UUID
   * @returns {Object} FHIR Patient resource
   */
  async toPatient(patientId) {
    const { rows } = await this.db.query(
      `SELECT 
        u.id, u.email, u.first_name, u.last_name, u.date_of_birth,
        u.phone, u.created_at, u.gender,
        pp.address_line1, pp.address_line2, pp.city, pp.state, pp.zip_code,
        pp.emergency_contact_name, pp.emergency_contact_phone,
        pp.insurance_provider, pp.insurance_member_id,
        pp.primary_language, pp.ethnicity, pp.race
       FROM users u
       LEFT JOIN patient_profiles pp ON pp.user_id = u.id
       WHERE u.id = $1 AND u.role = 'patient'`,
      [patientId]
    );

    if (rows.length === 0) {
      throw new Error(`Patient not found: ${patientId}`);
    }

    const patient = rows[0];

    return {
      resourceType: 'Patient',
      id: patient.id,
      meta: {
        profile: ['http://hl7.org/fhir/us/core/StructureDefinition/us-core-patient'],
        lastUpdated: new Date().toISOString()
      },
      identifier: [
        {
          system: `${this.systemUrl}/patient-id`,
          value: patient.id
        },
        // Insurance Member ID if available
        ...(patient.insurance_member_id ? [{
          type: {
            coding: [{
              system: 'http://terminology.hl7.org/CodeSystem/v2-0203',
              code: 'MB',
              display: 'Member Number'
            }]
          },
          system: `${this.systemUrl}/insurance/${patient.insurance_provider}`,
          value: patient.insurance_member_id
        }] : [])
      ],
      active: true,
      name: [{
        use: 'official',
        family: patient.last_name,
        given: [patient.first_name]
      }],
      telecom: [
        ...(patient.phone ? [{
          system: 'phone',
          value: patient.phone,
          use: 'mobile'
        }] : []),
        {
          system: 'email',
          value: patient.email
        }
      ],
      gender: this.mapGender(patient.gender),
      birthDate: patient.date_of_birth ? patient.date_of_birth.toISOString().split('T')[0] : undefined,
      address: patient.address_line1 ? [{
        use: 'home',
        line: [patient.address_line1, patient.address_line2].filter(Boolean),
        city: patient.city,
        state: patient.state,
        postalCode: patient.zip_code,
        country: 'US'
      }] : [],
      communication: patient.primary_language ? [{
        language: {
          coding: [{
            system: 'urn:ietf:bcp:47',
            code: this.mapLanguageCode(patient.primary_language)
          }]
        },
        preferred: true
      }] : [],
      contact: patient.emergency_contact_name ? [{
        relationship: [{
          coding: [{
            system: 'http://terminology.hl7.org/CodeSystem/v2-0131',
            code: 'C',
            display: 'Emergency Contact'
          }]
        }],
        name: {
          text: patient.emergency_contact_name
        },
        telecom: [{
          system: 'phone',
          value: patient.emergency_contact_phone
        }]
      }] : [],
      extension: [
        // US Core Race Extension
        ...(patient.race ? [{
          url: 'http://hl7.org/fhir/us/core/StructureDefinition/us-core-race',
          extension: [{
            url: 'text',
            valueString: patient.race
          }]
        }] : []),
        // US Core Ethnicity Extension
        ...(patient.ethnicity ? [{
          url: 'http://hl7.org/fhir/us/core/StructureDefinition/us-core-ethnicity',
          extension: [{
            url: 'text',
            valueString: patient.ethnicity
          }]
        }] : [])
      ]
    };
  }

  /**
   * Map internal appointment/visit to FHIR Encounter resource
   */
  async toEncounter(encounterId) {
    const { rows } = await this.db.query(
      `SELECT 
        a.id, a.patient_id, a.provider_id, a.scheduled_time, a.end_time,
        a.status, a.visit_type, a.reason, a.chief_complaint,
        a.created_at, a.updated_at,
        u_patient.first_name as patient_first, u_patient.last_name as patient_last,
        u_provider.first_name as provider_first, u_provider.last_name as provider_last,
        u_provider.specialty
       FROM appointments a
       JOIN users u_patient ON u_patient.id = a.patient_id
       JOIN users u_provider ON u_provider.id = a.provider_id
       WHERE a.id = $1`,
      [encounterId]
    );

    if (rows.length === 0) {
      throw new Error(`Encounter not found: ${encounterId}`);
    }

    const encounter = rows[0];

    return {
      resourceType: 'Encounter',
      id: encounter.id,
      meta: {
        profile: ['http://hl7.org/fhir/us/core/StructureDefinition/us-core-encounter'],
        lastUpdated: encounter.updated_at?.toISOString() || new Date().toISOString()
      },
      identifier: [{
        system: `${this.systemUrl}/encounter-id`,
        value: encounter.id
      }],
      status: this.mapEncounterStatus(encounter.status),
      class: {
        system: 'http://terminology.hl7.org/CodeSystem/v3-ActCode',
        code: 'VR', // Virtual (Telehealth)
        display: 'Virtual'
      },
      type: [{
        coding: [{
          system: 'http://snomed.info/sct',
          code: '448337001',
          display: 'Telemedicine consultation with patient'
        }],
        text: encounter.visit_type || 'Telehealth Visit'
      }],
      subject: {
        reference: `Patient/${encounter.patient_id}`,
        display: `${encounter.patient_first} ${encounter.patient_last}`
      },
      participant: [{
        type: [{
          coding: [{
            system: 'http://terminology.hl7.org/CodeSystem/v3-ParticipationType',
            code: 'PPRF',
            display: 'Primary Performer'
          }]
        }],
        individual: {
          reference: `Practitioner/${encounter.provider_id}`,
          display: `${encounter.provider_first} ${encounter.provider_last}`
        }
      }],
      period: {
        start: encounter.scheduled_time?.toISOString(),
        end: encounter.end_time?.toISOString()
      },
      reasonCode: encounter.chief_complaint ? [{
        text: encounter.chief_complaint
      }] : [],
      serviceProvider: {
        reference: 'Organization/doctarx',
        display: 'Docta Telehealth'
      }
    };
  }

  /**
   * Map internal prescription to FHIR MedicationRequest
   */
  async toMedicationRequest(prescriptionId) {
    const { rows } = await this.db.query(
      `SELECT 
        p.id, p.patient_id, p.provider_id, p.medication_name, p.dosage,
        p.frequency, p.quantity, p.refills, p.instructions, p.rxnorm_code,
        p.status, p.prescribed_date, p.start_date, p.end_date,
        p.pharmacy_name, p.pharmacy_address, p.pharmacy_phone,
        p.created_at, p.updated_at,
        u_patient.first_name as patient_first, u_patient.last_name as patient_last,
        u_provider.first_name as provider_first, u_provider.last_name as provider_last
       FROM prescriptions p
       JOIN users u_patient ON u_patient.id = p.patient_id
       JOIN users u_provider ON u_provider.id = p.provider_id
       WHERE p.id = $1`,
      [prescriptionId]
    );

    if (rows.length === 0) {
      throw new Error(`Prescription not found: ${prescriptionId}`);
    }

    const rx = rows[0];

    return {
      resourceType: 'MedicationRequest',
      id: rx.id,
      meta: {
        profile: ['http://hl7.org/fhir/us/core/StructureDefinition/us-core-medicationrequest'],
        lastUpdated: rx.updated_at?.toISOString() || new Date().toISOString()
      },
      identifier: [{
        system: `${this.systemUrl}/prescription-id`,
        value: rx.id
      }],
      status: this.mapMedicationStatus(rx.status),
      intent: 'order',
      medicationCodeableConcept: {
        coding: rx.rxnorm_code ? [{
          system: 'http://www.nlm.nih.gov/research/umls/rxnorm',
          code: rx.rxnorm_code,
          display: rx.medication_name
        }] : [],
        text: rx.medication_name
      },
      subject: {
        reference: `Patient/${rx.patient_id}`,
        display: `${rx.patient_first} ${rx.patient_last}`
      },
      requester: {
        reference: `Practitioner/${rx.provider_id}`,
        display: `${rx.provider_first} ${rx.provider_last}`
      },
      authoredOn: rx.prescribed_date?.toISOString(),
      dosageInstruction: [{
        text: `${rx.dosage} ${rx.frequency}`,
        timing: {
          code: {
            text: rx.frequency
          }
        },
        doseAndRate: [{
          doseQuantity: {
            value: parseFloat(rx.dosage) || undefined,
            unit: this.extractDosageUnit(rx.dosage)
          }
        }]
      }],
      dispenseRequest: {
        numberOfRepeatsAllowed: rx.refills || 0,
        quantity: {
          value: rx.quantity,
          unit: 'tablets'
        },
        validityPeriod: {
          start: rx.start_date?.toISOString(),
          end: rx.end_date?.toISOString()
        }
      },
      substitution: {
        allowedBoolean: true
      },
      note: rx.instructions ? [{
        text: rx.instructions
      }] : []
    };
  }

  /**
   * Map vitals and lab results to FHIR Observations
   */
  async toObservations(patientId, options = {}) {
    const { startDate, endDate, types } = options;
    
    let query = `
      SELECT 
        v.id, v.patient_id, v.encounter_id, v.recorded_at,
        v.blood_pressure_systolic, v.blood_pressure_diastolic,
        v.heart_rate, v.temperature, v.respiratory_rate,
        v.oxygen_saturation, v.weight, v.height, v.bmi,
        v.pain_level, v.notes
       FROM vitals v
       WHERE v.patient_id = $1
    `;
    const params = [patientId];
    let paramIndex = 2;

    if (startDate) {
      query += ` AND v.recorded_at >= $${paramIndex++}`;
      params.push(startDate);
    }
    if (endDate) {
      query += ` AND v.recorded_at <= $${paramIndex++}`;
      params.push(endDate);
    }

    query += ' ORDER BY v.recorded_at DESC LIMIT 100';

    const { rows } = await this.db.query(query, params);
    const observations = [];

    for (const vital of rows) {
      // Blood Pressure (compound observation)
      if (vital.blood_pressure_systolic && vital.blood_pressure_diastolic) {
        observations.push(this.createBloodPressureObservation(vital));
      }

      // Heart Rate
      if (vital.heart_rate) {
        observations.push(this.createSimpleObservation(vital, {
          code: '8867-4',
          display: 'Heart rate',
          value: vital.heart_rate,
          unit: '/min',
          system: 'http://loinc.org'
        }));
      }

      // Temperature
      if (vital.temperature) {
        observations.push(this.createSimpleObservation(vital, {
          code: '8310-5',
          display: 'Body temperature',
          value: vital.temperature,
          unit: 'degF',
          system: 'http://loinc.org'
        }));
      }

      // Oxygen Saturation
      if (vital.oxygen_saturation) {
        observations.push(this.createSimpleObservation(vital, {
          code: '2708-6',
          display: 'Oxygen saturation',
          value: vital.oxygen_saturation,
          unit: '%',
          system: 'http://loinc.org'
        }));
      }

      // Weight
      if (vital.weight) {
        observations.push(this.createSimpleObservation(vital, {
          code: '29463-7',
          display: 'Body weight',
          value: vital.weight,
          unit: 'lb',
          system: 'http://loinc.org'
        }));
      }

      // Height
      if (vital.height) {
        observations.push(this.createSimpleObservation(vital, {
          code: '8302-2',
          display: 'Body height',
          value: vital.height,
          unit: 'in',
          system: 'http://loinc.org'
        }));
      }

      // BMI
      if (vital.bmi) {
        observations.push(this.createSimpleObservation(vital, {
          code: '39156-5',
          display: 'Body mass index',
          value: vital.bmi,
          unit: 'kg/m2',
          system: 'http://loinc.org'
        }));
      }
    }

    return observations;
  }

  /**
   * Create a Blood Pressure Observation (compound)
   */
  createBloodPressureObservation(vital) {
    return {
      resourceType: 'Observation',
      id: `bp-${vital.id}`,
      meta: {
        profile: ['http://hl7.org/fhir/us/core/StructureDefinition/us-core-blood-pressure']
      },
      status: 'final',
      category: [{
        coding: [{
          system: 'http://terminology.hl7.org/CodeSystem/observation-category',
          code: 'vital-signs',
          display: 'Vital Signs'
        }]
      }],
      code: {
        coding: [{
          system: 'http://loinc.org',
          code: '85354-9',
          display: 'Blood pressure panel'
        }]
      },
      subject: {
        reference: `Patient/${vital.patient_id}`
      },
      effectiveDateTime: vital.recorded_at?.toISOString(),
      component: [
        {
          code: {
            coding: [{
              system: 'http://loinc.org',
              code: '8480-6',
              display: 'Systolic blood pressure'
            }]
          },
          valueQuantity: {
            value: vital.blood_pressure_systolic,
            unit: 'mmHg',
            system: 'http://unitsofmeasure.org',
            code: 'mm[Hg]'
          }
        },
        {
          code: {
            coding: [{
              system: 'http://loinc.org',
              code: '8462-4',
              display: 'Diastolic blood pressure'
            }]
          },
          valueQuantity: {
            value: vital.blood_pressure_diastolic,
            unit: 'mmHg',
            system: 'http://unitsofmeasure.org',
            code: 'mm[Hg]'
          }
        }
      ]
    };
  }

  /**
   * Create a simple vital sign Observation
   */
  createSimpleObservation(vital, config) {
    return {
      resourceType: 'Observation',
      id: `${config.code}-${vital.id}`,
      meta: {
        profile: ['http://hl7.org/fhir/us/core/StructureDefinition/us-core-vital-signs']
      },
      status: 'final',
      category: [{
        coding: [{
          system: 'http://terminology.hl7.org/CodeSystem/observation-category',
          code: 'vital-signs',
          display: 'Vital Signs'
        }]
      }],
      code: {
        coding: [{
          system: config.system,
          code: config.code,
          display: config.display
        }]
      },
      subject: {
        reference: `Patient/${vital.patient_id}`
      },
      effectiveDateTime: vital.recorded_at?.toISOString(),
      valueQuantity: {
        value: config.value,
        unit: config.unit,
        system: 'http://unitsofmeasure.org'
      }
    };
  }

  // Helper methods
  mapGender(gender) {
    const genderMap = {
      'male': 'male',
      'm': 'male',
      'female': 'female',
      'f': 'female',
      'other': 'other',
      'unknown': 'unknown'
    };
    return genderMap[gender?.toLowerCase()] || 'unknown';
  }

  mapEncounterStatus(status) {
    const statusMap = {
      'scheduled': 'planned',
      'confirmed': 'planned',
      'checked_in': 'arrived',
      'in_progress': 'in-progress',
      'completed': 'finished',
      'cancelled': 'cancelled',
      'no_show': 'cancelled'
    };
    return statusMap[status] || 'unknown';
  }

  mapMedicationStatus(status) {
    const statusMap = {
      'pending': 'draft',
      'active': 'active',
      'completed': 'completed',
      'cancelled': 'cancelled',
      'expired': 'stopped'
    };
    return statusMap[status] || 'unknown';
  }

  mapLanguageCode(language) {
    const languageMap = {
      'english': 'en',
      'spanish': 'es',
      'mandarin': 'zh',
      'french': 'fr',
      'german': 'de',
      'korean': 'ko',
      'vietnamese': 'vi',
      'tagalog': 'tl'
    };
    return languageMap[language?.toLowerCase()] || 'en';
  }

  extractDosageUnit(dosage) {
    if (!dosage) return undefined;
    const match = dosage.match(/(\d+)\s*(mg|mcg|g|ml|units?)/i);
    return match ? match[2].toLowerCase() : undefined;
  }
}

module.exports = FHIRMapper;
