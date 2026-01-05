/**
 * AI Triage Engine Service
 * Comprehensive symptom analysis with emergency detection,
 * body system categorization, and intelligent routing
 */

const logger = require('../middleware/logger');

// Triage levels with priority scores
const TRIAGE_LEVELS = {
  EMERGENT: { level: 'EMERGENT', priority: 100, color: 'red', maxWaitMinutes: 0 },
  URGENT: { level: 'URGENT', priority: 80, color: 'orange', maxWaitMinutes: 15 },
  SEMI_URGENT: { level: 'SEMI_URGENT', priority: 60, color: 'yellow', maxWaitMinutes: 60 },
  ROUTINE: { level: 'ROUTINE', priority: 40, color: 'green', maxWaitMinutes: 120 },
  NON_URGENT: { level: 'NON_URGENT', priority: 20, color: 'blue', maxWaitMinutes: 240 }
};

// Body systems for categorization
const BODY_SYSTEMS = {
  CARDIOVASCULAR: 'Cardiovascular',
  RESPIRATORY: 'Respiratory',
  NEUROLOGICAL: 'Neurological',
  GASTROINTESTINAL: 'Gastrointestinal',
  MUSCULOSKELETAL: 'Musculoskeletal',
  DERMATOLOGICAL: 'Dermatological',
  GENITOURINARY: 'Genitourinary',
  ENDOCRINE: 'Endocrine',
  PSYCHIATRIC: 'Psychiatric',
  ENT: 'Ear/Nose/Throat',
  OPHTHALMOLOGIC: 'Ophthalmologic',
  HEMATOLOGIC: 'Hematologic',
  IMMUNOLOGIC: 'Immunologic',
  INFECTIOUS: 'Infectious Disease',
  RENAL: 'Renal/Kidney',
  GENERAL: 'General/Constitutional'
};

// Emergency keywords and patterns
const EMERGENCY_PATTERNS = [
  // Cardiac emergencies
  { pattern: /chest\s*(pain|pressure|tightness|discomfort)/i, system: 'CARDIOVASCULAR', severity: 5, flags: ['CARDIAC_EMERGENCY'] },
  { pattern: /heart\s*attack/i, system: 'CARDIOVASCULAR', severity: 5, flags: ['CARDIAC_EMERGENCY', 'CALL_911'] },
  { pattern: /crushing\s*(chest|pain)/i, system: 'CARDIOVASCULAR', severity: 5, flags: ['CARDIAC_EMERGENCY'] },
  { pattern: /radiating.*arm/i, system: 'CARDIOVASCULAR', severity: 5, flags: ['CARDIAC_EMERGENCY'] },
  { pattern: /palpitations.*shortness.*breath/i, system: 'CARDIOVASCULAR', severity: 4, flags: ['CARDIAC_CONCERN'] },
  
  // Stroke
  { pattern: /stroke/i, system: 'NEUROLOGICAL', severity: 5, flags: ['STROKE_ALERT', 'CALL_911'] },
  { pattern: /face.*droop/i, system: 'NEUROLOGICAL', severity: 5, flags: ['STROKE_ALERT'] },
  { pattern: /sudden.*weakness.*one\s*side/i, system: 'NEUROLOGICAL', severity: 5, flags: ['STROKE_ALERT'] },
  { pattern: /slurred\s*speech.*sudden/i, system: 'NEUROLOGICAL', severity: 5, flags: ['STROKE_ALERT'] },
  { pattern: /sudden.*confusion/i, system: 'NEUROLOGICAL', severity: 4, flags: ['NEUROLOGICAL_EMERGENCY'] },
  
  // Respiratory emergencies
  { pattern: /can('?t|not)\s*breathe/i, system: 'RESPIRATORY', severity: 5, flags: ['RESPIRATORY_DISTRESS', 'CALL_911'] },
  { pattern: /severe.*shortness.*breath/i, system: 'RESPIRATORY', severity: 5, flags: ['RESPIRATORY_DISTRESS'] },
  { pattern: /choking/i, system: 'RESPIRATORY', severity: 5, flags: ['AIRWAY_OBSTRUCTION', 'CALL_911'] },
  { pattern: /blue\s*(lips|face|skin)/i, system: 'RESPIRATORY', severity: 5, flags: ['CYANOSIS', 'CALL_911'] },
  { pattern: /asthma.*attack.*severe/i, system: 'RESPIRATORY', severity: 5, flags: ['SEVERE_ASTHMA'] },
  
  // Anaphylaxis
  { pattern: /anaphyla/i, system: 'IMMUNOLOGIC', severity: 5, flags: ['ANAPHYLAXIS', 'CALL_911'] },
  { pattern: /throat.*swell.*can('?t|not).*swallow/i, system: 'IMMUNOLOGIC', severity: 5, flags: ['ANAPHYLAXIS'] },
  { pattern: /allergic.*reaction.*severe/i, system: 'IMMUNOLOGIC', severity: 5, flags: ['SEVERE_ALLERGY'] },
  
  // Trauma
  { pattern: /severe.*bleeding/i, system: 'GENERAL', severity: 5, flags: ['HEMORRHAGE', 'CALL_911'] },
  { pattern: /uncontrolled.*bleed/i, system: 'GENERAL', severity: 5, flags: ['HEMORRHAGE'] },
  { pattern: /head\s*injury.*unconscious/i, system: 'NEUROLOGICAL', severity: 5, flags: ['HEAD_TRAUMA', 'CALL_911'] },
  
  // Psychiatric emergencies
  { pattern: /suicid/i, system: 'PSYCHIATRIC', severity: 5, flags: ['SUICIDE_RISK', 'PSYCHIATRIC_EMERGENCY'] },
  { pattern: /want.*to.*die/i, system: 'PSYCHIATRIC', severity: 5, flags: ['SUICIDE_RISK'] },
  { pattern: /self.*harm/i, system: 'PSYCHIATRIC', severity: 4, flags: ['SELF_HARM_RISK'] },
  { pattern: /overdose/i, system: 'GENERAL', severity: 5, flags: ['OVERDOSE', 'CALL_911'] },
  
  // Sepsis/Infection
  { pattern: /fever.*confusion/i, system: 'INFECTIOUS', severity: 4, flags: ['SEPSIS_CONCERN'] },
  { pattern: /high\s*fever.*shaking/i, system: 'INFECTIOUS', severity: 4, flags: ['SEPSIS_CONCERN'] },
  
  // Diabetic emergencies
  { pattern: /diabetic.*coma/i, system: 'ENDOCRINE', severity: 5, flags: ['DKA_CONCERN', 'CALL_911'] },
  { pattern: /very.*high.*blood.*sugar/i, system: 'ENDOCRINE', severity: 4, flags: ['HYPERGLYCEMIA'] },
  { pattern: /low.*blood.*sugar.*unresponsive/i, system: 'ENDOCRINE', severity: 5, flags: ['HYPOGLYCEMIA', 'CALL_911'] }
];

// Symptom patterns for non-emergency conditions
const SYMPTOM_PATTERNS = [
  // Cardiovascular
  { pattern: /high.*blood.*pressure/i, system: 'CARDIOVASCULAR', severity: 3, specialty: 'Cardiology', meds: ['Lisinopril', 'Amlodipine'] },
  { pattern: /palpitations/i, system: 'CARDIOVASCULAR', severity: 3, specialty: 'Cardiology', meds: ['Metoprolol'] },
  { pattern: /swelling.*leg|leg.*swelling|ankle.*swell/i, system: 'CARDIOVASCULAR', severity: 3, specialty: 'Cardiology', meds: ['Furosemide'] },
  { pattern: /dizz(y|iness)/i, system: 'CARDIOVASCULAR', severity: 2, specialty: 'Primary Care', meds: ['Meclizine'] },
  
  // Respiratory
  { pattern: /cough/i, system: 'RESPIRATORY', severity: 2, specialty: 'Primary Care', meds: ['Benzonatate', 'Dextromethorphan'] },
  { pattern: /shortness.*breath|breathless/i, system: 'RESPIRATORY', severity: 3, specialty: 'Pulmonology', meds: ['Albuterol'] },
  { pattern: /wheez(e|ing)/i, system: 'RESPIRATORY', severity: 3, specialty: 'Pulmonology', meds: ['Albuterol', 'Fluticasone'] },
  { pattern: /asthma/i, system: 'RESPIRATORY', severity: 3, specialty: 'Pulmonology', meds: ['Albuterol', 'Fluticasone', 'Montelukast'] },
  { pattern: /pneumonia/i, system: 'RESPIRATORY', severity: 4, specialty: 'Pulmonology', meds: ['Azithromycin', 'Amoxicillin'] },
  { pattern: /bronchitis/i, system: 'RESPIRATORY', severity: 3, specialty: 'Primary Care', meds: ['Azithromycin', 'Benzonatate'] },
  { pattern: /sinus.*infection|sinusitis/i, system: 'ENT', severity: 2, specialty: 'ENT', meds: ['Amoxicillin', 'Fluticasone Nasal'] },
  
  // Neurological
  { pattern: /headache/i, system: 'NEUROLOGICAL', severity: 2, specialty: 'Neurology', meds: ['Ibuprofen', 'Acetaminophen', 'Sumatriptan'] },
  { pattern: /migraine/i, system: 'NEUROLOGICAL', severity: 3, specialty: 'Neurology', meds: ['Sumatriptan', 'Rizatriptan', 'Topiramate'] },
  { pattern: /numbness|tingling/i, system: 'NEUROLOGICAL', severity: 3, specialty: 'Neurology', meds: ['Gabapentin', 'Pregabalin'] },
  { pattern: /seizure/i, system: 'NEUROLOGICAL', severity: 4, specialty: 'Neurology', meds: ['Levetiracetam', 'Valproic Acid'] },
  
  // Gastrointestinal
  { pattern: /nausea/i, system: 'GASTROINTESTINAL', severity: 2, specialty: 'Gastroenterology', meds: ['Ondansetron', 'Metoclopramide'] },
  { pattern: /vomit/i, system: 'GASTROINTESTINAL', severity: 2, specialty: 'Gastroenterology', meds: ['Ondansetron', 'Promethazine'] },
  { pattern: /diarrhea/i, system: 'GASTROINTESTINAL', severity: 2, specialty: 'Gastroenterology', meds: ['Loperamide', 'Bismuth Subsalicylate'] },
  { pattern: /constipat/i, system: 'GASTROINTESTINAL', severity: 2, specialty: 'Gastroenterology', meds: ['Polyethylene Glycol', 'Docusate'] },
  { pattern: /abdominal.*pain|stomach.*pain|belly.*pain/i, system: 'GASTROINTESTINAL', severity: 3, specialty: 'Gastroenterology', meds: ['Omeprazole', 'Dicyclomine'] },
  { pattern: /heartburn|acid.*reflux|gerd/i, system: 'GASTROINTESTINAL', severity: 2, specialty: 'Gastroenterology', meds: ['Omeprazole', 'Famotidine'] },
  { pattern: /blood.*stool/i, system: 'GASTROINTESTINAL', severity: 4, specialty: 'Gastroenterology', flags: ['GI_BLEEDING'] },
  
  // Musculoskeletal
  { pattern: /back.*pain/i, system: 'MUSCULOSKELETAL', severity: 2, specialty: 'Orthopedics', meds: ['Ibuprofen', 'Cyclobenzaprine', 'Naproxen'] },
  { pattern: /joint.*pain/i, system: 'MUSCULOSKELETAL', severity: 2, specialty: 'Rheumatology', meds: ['Ibuprofen', 'Naproxen', 'Meloxicam'] },
  { pattern: /muscle.*pain|sore.*muscle/i, system: 'MUSCULOSKELETAL', severity: 2, specialty: 'Primary Care', meds: ['Ibuprofen', 'Cyclobenzaprine'] },
  { pattern: /arthritis/i, system: 'MUSCULOSKELETAL', severity: 3, specialty: 'Rheumatology', meds: ['Meloxicam', 'Methotrexate', 'Prednisone'] },
  { pattern: /gout/i, system: 'MUSCULOSKELETAL', severity: 3, specialty: 'Rheumatology', meds: ['Colchicine', 'Indomethacin', 'Allopurinol'] },
  
  // Dermatological
  { pattern: /rash/i, system: 'DERMATOLOGICAL', severity: 2, specialty: 'Dermatology', meds: ['Hydrocortisone', 'Diphenhydramine'] },
  { pattern: /itch(y|ing)/i, system: 'DERMATOLOGICAL', severity: 2, specialty: 'Dermatology', meds: ['Diphenhydramine', 'Cetirizine', 'Hydrocortisone'] },
  { pattern: /hives/i, system: 'DERMATOLOGICAL', severity: 3, specialty: 'Allergy/Immunology', meds: ['Diphenhydramine', 'Epinephrine'] },
  { pattern: /acne/i, system: 'DERMATOLOGICAL', severity: 1, specialty: 'Dermatology', meds: ['Tretinoin', 'Benzoyl Peroxide', 'Clindamycin'] },
  { pattern: /eczema/i, system: 'DERMATOLOGICAL', severity: 2, specialty: 'Dermatology', meds: ['Triamcinolone', 'Tacrolimus'] },
  { pattern: /psoriasis/i, system: 'DERMATOLOGICAL', severity: 2, specialty: 'Dermatology', meds: ['Triamcinolone', 'Methotrexate'] },
  
  // Genitourinary
  { pattern: /urinary.*tract.*infection|uti/i, system: 'GENITOURINARY', severity: 3, specialty: 'Urology', meds: ['Nitrofurantoin', 'Ciprofloxacin', 'Trimethoprim/Sulfamethoxazole'] },
  { pattern: /burning.*urinat|painful.*urinat/i, system: 'GENITOURINARY', severity: 3, specialty: 'Urology', meds: ['Phenazopyridine', 'Nitrofurantoin'] },
  { pattern: /frequent.*urinat/i, system: 'GENITOURINARY', severity: 2, specialty: 'Urology', meds: ['Oxybutynin'] },
  { pattern: /blood.*urine/i, system: 'GENITOURINARY', severity: 4, specialty: 'Urology', flags: ['HEMATURIA'] },
  { pattern: /kidney.*stone/i, system: 'RENAL', severity: 4, specialty: 'Urology', meds: ['Ketorolac', 'Tamsulosin'] },
  
  // Renal
  { pattern: /swelling.*ankle.*foamy.*urine|foamy.*urine.*swelling/i, system: 'RENAL', severity: 4, specialty: 'Nephrology', meds: ['Lisinopril', 'Prednisone'], flags: ['RENAL_CONCERN'] },
  { pattern: /kidney.*disease/i, system: 'RENAL', severity: 4, specialty: 'Nephrology', meds: ['Lisinopril'] },
  { pattern: /foamy.*urine/i, system: 'RENAL', severity: 3, specialty: 'Nephrology', flags: ['PROTEINURIA_CONCERN'] },
  
  // Endocrine
  { pattern: /diabetes/i, system: 'ENDOCRINE', severity: 3, specialty: 'Endocrinology', meds: ['Metformin', 'Glipizide'] },
  { pattern: /thyroid/i, system: 'ENDOCRINE', severity: 2, specialty: 'Endocrinology', meds: ['Levothyroxine', 'Methimazole'] },
  { pattern: /weight.*gain.*fatigue/i, system: 'ENDOCRINE', severity: 2, specialty: 'Endocrinology', meds: ['Levothyroxine'] },
  
  // ENT
  { pattern: /ear.*pain|earache/i, system: 'ENT', severity: 2, specialty: 'ENT', meds: ['Amoxicillin', 'Ciprofloxacin Otic'] },
  { pattern: /sore.*throat/i, system: 'ENT', severity: 2, specialty: 'Primary Care', meds: ['Penicillin V', 'Azithromycin'] },
  { pattern: /strep/i, system: 'ENT', severity: 3, specialty: 'Primary Care', meds: ['Penicillin V', 'Amoxicillin'] },
  { pattern: /hearing.*loss/i, system: 'ENT', severity: 3, specialty: 'ENT', meds: [] },
  { pattern: /tinnitus|ringing.*ear/i, system: 'ENT', severity: 2, specialty: 'ENT', meds: [] },
  
  // Ophthalmologic
  { pattern: /eye.*pain|painful.*eye/i, system: 'OPHTHALMOLOGIC', severity: 3, specialty: 'Ophthalmology', meds: ['Erythromycin Ophthalmic'] },
  { pattern: /red.*eye|pink.*eye/i, system: 'OPHTHALMOLOGIC', severity: 2, specialty: 'Ophthalmology', meds: ['Erythromycin Ophthalmic', 'Ofloxacin Ophthalmic'] },
  { pattern: /vision.*change|blurry.*vision/i, system: 'OPHTHALMOLOGIC', severity: 3, specialty: 'Ophthalmology', meds: [] },
  { pattern: /sudden.*vision.*loss/i, system: 'OPHTHALMOLOGIC', severity: 5, specialty: 'Ophthalmology', flags: ['VISION_EMERGENCY'] },
  
  // Psychiatric
  { pattern: /anxiety/i, system: 'PSYCHIATRIC', severity: 2, specialty: 'Psychiatry', meds: ['Sertraline', 'Escitalopram', 'Hydroxyzine'] },
  { pattern: /depress(ed|ion)/i, system: 'PSYCHIATRIC', severity: 3, specialty: 'Psychiatry', meds: ['Sertraline', 'Fluoxetine', 'Bupropion'] },
  { pattern: /insomnia|can('?t|not).*sleep/i, system: 'PSYCHIATRIC', severity: 2, specialty: 'Psychiatry', meds: ['Trazodone', 'Melatonin', 'Zolpidem'] },
  { pattern: /panic.*attack/i, system: 'PSYCHIATRIC', severity: 3, specialty: 'Psychiatry', meds: ['Alprazolam', 'Sertraline'] },
  
  // Infectious
  { pattern: /fever/i, system: 'INFECTIOUS', severity: 2, specialty: 'Infectious Disease', meds: ['Acetaminophen', 'Ibuprofen'] },
  { pattern: /flu|influenza/i, system: 'INFECTIOUS', severity: 3, specialty: 'Primary Care', meds: ['Oseltamivir', 'Acetaminophen'] },
  { pattern: /covid/i, system: 'INFECTIOUS', severity: 3, specialty: 'Infectious Disease', meds: ['Paxlovid', 'Acetaminophen'] },
  { pattern: /cold|congestion/i, system: 'INFECTIOUS', severity: 1, specialty: 'Primary Care', meds: ['Pseudoephedrine', 'Guaifenesin'] },
  
  // Allergies
  { pattern: /allerg(y|ies)/i, system: 'IMMUNOLOGIC', severity: 2, specialty: 'Allergy/Immunology', meds: ['Cetirizine', 'Loratadine', 'Fexofenadine'] },
  { pattern: /runny.*nose.*sneez/i, system: 'ENT', severity: 1, specialty: 'Primary Care', meds: ['Cetirizine', 'Fluticasone Nasal'] },
  
  // General
  { pattern: /fatigue|tired/i, system: 'GENERAL', severity: 2, specialty: 'Primary Care', meds: [] },
  { pattern: /weight.*loss.*unexplained/i, system: 'GENERAL', severity: 4, specialty: 'Internal Medicine', flags: ['MALIGNANCY_CONCERN'] }
];

// Recommended tests by body system
const RECOMMENDED_TESTS = {
  CARDIOVASCULAR: ['ECG', 'Troponin', 'BNP', 'Lipid Panel', 'Echocardiogram'],
  RESPIRATORY: ['Chest X-Ray', 'Pulmonary Function Test', 'Pulse Oximetry', 'ABG'],
  NEUROLOGICAL: ['CT Head', 'MRI Brain', 'Lumbar Puncture', 'EEG'],
  GASTROINTESTINAL: ['CBC', 'CMP', 'Lipase', 'H. pylori Test', 'Stool Culture', 'Endoscopy'],
  MUSCULOSKELETAL: ['X-Ray', 'MRI', 'ESR', 'CRP', 'Uric Acid', 'RF'],
  DERMATOLOGICAL: ['Skin Biopsy', 'KOH Prep', 'Culture'],
  GENITOURINARY: ['Urinalysis', 'Urine Culture', 'BMP', 'PSA'],
  ENDOCRINE: ['TSH', 'Free T4', 'HbA1c', 'Fasting Glucose', 'Cortisol'],
  ENT: ['Audiometry', 'Tympanometry', 'Strep Test', 'Throat Culture'],
  OPHTHALMOLOGIC: ['Visual Acuity', 'Tonometry', 'Fundoscopy', 'OCT'],
  PSYCHIATRIC: ['PHQ-9', 'GAD-7', 'TSH', 'Vitamin B12'],
  INFECTIOUS: ['CBC', 'CMP', 'Blood Culture', 'COVID Test', 'Flu Test'],
  IMMUNOLOGIC: ['IgE', 'Allergen Panel', 'CBC with Diff'],
  RENAL: ['BMP', 'Urinalysis', 'Urine Protein/Creatinine Ratio', 'Renal Ultrasound'],
  GENERAL: ['CBC', 'CMP', 'TSH', 'Urinalysis']
};

class AITriageEngine {
  /**
   * Run comprehensive AI triage analysis
   * @param {string} symptoms - Patient symptoms description
   * @param {object} vitals - Optional vital signs
   * @param {object} patientHistory - Optional patient history
   */
  async runTriage(symptoms, vitals = null, patientHistory = null) {
    try {
      const normalizedSymptoms = symptoms.toLowerCase();
      const analysis = {
        isEmergency: false,
        emergencyFlags: [],
        severity: 1,
        triageLevel: 'NON_URGENT',
        affectedBodySystems: [],
        suggestedSpecialty: 'Primary Care',
        clinicalFlags: [],
        suggestedMedications: [],
        differentialDiagnosis: [],
        recommendedTests: [],
        confidenceScore: 85,
        soapDraft: '',
        requiresImmediateAttention: false,
        routing: null
      };
      
      // Step 1: Check for emergencies
      this._checkEmergencies(normalizedSymptoms, analysis);
      
      // Step 2: Analyze symptoms
      this._analyzeSymptoms(normalizedSymptoms, analysis);
      
      // Step 3: Factor in vitals if available
      if (vitals) {
        this._analyzeVitals(vitals, analysis);
      }
      
      // Step 4: Generate differential diagnosis
      this._generateDifferentials(analysis);
      
      // Step 5: Recommend tests based on body systems
      this._recommendTests(analysis);
      
      // Step 6: Determine triage level
      this._determineTriageLevel(analysis);
      
      // Step 7: Generate SOAP draft
      analysis.soapDraft = this._generateSOAP(symptoms, analysis);
      
      // Step 8: Determine routing
      analysis.routing = this._determineRouting(analysis);
      
      // Step 9: Calculate priority score
      analysis.priorityScore = this._calculatePriorityScore(analysis);
      
      logger.info('AI Triage completed', {
        severity: analysis.severity,
        triageLevel: analysis.triageLevel,
        isEmergency: analysis.isEmergency,
        bodySystemsCount: analysis.affectedBodySystems.length
      });
      
      return analysis;
    } catch (error) {
      logger.error('AI Triage error:', error);
      throw error;
    }
  }
  
  _checkEmergencies(symptoms, analysis) {
    for (const pattern of EMERGENCY_PATTERNS) {
      if (pattern.pattern.test(symptoms)) {
        analysis.isEmergency = true;
        analysis.requiresImmediateAttention = true;
        analysis.emergencyFlags.push(...pattern.flags);
        if (pattern.severity > analysis.severity) {
          analysis.severity = pattern.severity;
        }
        if (!analysis.affectedBodySystems.includes(BODY_SYSTEMS[pattern.system])) {
          analysis.affectedBodySystems.push(BODY_SYSTEMS[pattern.system]);
        }
        analysis.clinicalFlags.push(...pattern.flags);
      }
    }
    
    // Deduplicate
    analysis.emergencyFlags = [...new Set(analysis.emergencyFlags)];
    analysis.clinicalFlags = [...new Set(analysis.clinicalFlags)];
  }
  
  _analyzeSymptoms(symptoms, analysis) {
    const matchedSpecialties = new Map();
    const matchedMeds = new Set();
    
    for (const pattern of SYMPTOM_PATTERNS) {
      if (pattern.pattern.test(symptoms)) {
        // Track severity
        if (pattern.severity > analysis.severity) {
          analysis.severity = pattern.severity;
        }
        
        // Add body system
        if (!analysis.affectedBodySystems.includes(BODY_SYSTEMS[pattern.system])) {
          analysis.affectedBodySystems.push(BODY_SYSTEMS[pattern.system]);
        }
        
        // Track specialty with severity
        const currentSeverity = matchedSpecialties.get(pattern.specialty) || 0;
        if (pattern.severity > currentSeverity) {
          matchedSpecialties.set(pattern.specialty, pattern.severity);
        }
        
        // Add medications
        if (pattern.meds) {
          pattern.meds.forEach(med => matchedMeds.add(med));
        }
        
        // Add flags
        if (pattern.flags) {
          analysis.clinicalFlags.push(...pattern.flags);
        }
      }
    }
    
    // Determine suggested specialty (highest severity match)
    let highestSeverity = 0;
    for (const [specialty, severity] of matchedSpecialties) {
      if (severity > highestSeverity) {
        highestSeverity = severity;
        analysis.suggestedSpecialty = specialty;
      }
    }
    
    // Add medications (limit to top 5 most relevant)
    analysis.suggestedMedications = [...matchedMeds].slice(0, 5);
    analysis.clinicalFlags = [...new Set(analysis.clinicalFlags)];
  }
  
  _analyzeVitals(vitals, analysis) {
    const vitalFlags = [];
    
    // Temperature
    if (vitals.temperature) {
      if (vitals.temperature >= 103) {
        vitalFlags.push('HIGH_FEVER');
        analysis.severity = Math.max(analysis.severity, 4);
      } else if (vitals.temperature >= 100.4) {
        vitalFlags.push('FEVER');
        analysis.severity = Math.max(analysis.severity, 3);
      } else if (vitals.temperature < 96) {
        vitalFlags.push('HYPOTHERMIA');
        analysis.severity = Math.max(analysis.severity, 4);
      }
    }
    
    // Heart rate
    if (vitals.heartRate) {
      if (vitals.heartRate > 120) {
        vitalFlags.push('TACHYCARDIA');
        analysis.severity = Math.max(analysis.severity, 3);
      } else if (vitals.heartRate < 50) {
        vitalFlags.push('BRADYCARDIA');
        analysis.severity = Math.max(analysis.severity, 3);
      }
    }
    
    // Blood pressure
    if (vitals.systolic && vitals.diastolic) {
      if (vitals.systolic >= 180 || vitals.diastolic >= 120) {
        vitalFlags.push('HYPERTENSIVE_CRISIS');
        analysis.severity = Math.max(analysis.severity, 5);
        analysis.isEmergency = true;
      } else if (vitals.systolic >= 140 || vitals.diastolic >= 90) {
        vitalFlags.push('HYPERTENSION');
        analysis.severity = Math.max(analysis.severity, 3);
      } else if (vitals.systolic < 90) {
        vitalFlags.push('HYPOTENSION');
        analysis.severity = Math.max(analysis.severity, 4);
      }
    }
    
    // Oxygen saturation
    if (vitals.oxygenSaturation) {
      if (vitals.oxygenSaturation < 90) {
        vitalFlags.push('SEVERE_HYPOXIA');
        analysis.severity = 5;
        analysis.isEmergency = true;
      } else if (vitals.oxygenSaturation < 94) {
        vitalFlags.push('HYPOXIA');
        analysis.severity = Math.max(analysis.severity, 4);
      }
    }
    
    // Respiratory rate
    if (vitals.respiratoryRate) {
      if (vitals.respiratoryRate > 24) {
        vitalFlags.push('TACHYPNEA');
        analysis.severity = Math.max(analysis.severity, 3);
      } else if (vitals.respiratoryRate < 10) {
        vitalFlags.push('BRADYPNEA');
        analysis.severity = Math.max(analysis.severity, 4);
      }
    }
    
    // Pain level
    if (vitals.painLevel) {
      if (vitals.painLevel >= 8) {
        vitalFlags.push('SEVERE_PAIN');
        analysis.severity = Math.max(analysis.severity, 4);
      } else if (vitals.painLevel >= 6) {
        vitalFlags.push('MODERATE_PAIN');
        analysis.severity = Math.max(analysis.severity, 3);
      }
    }
    
    analysis.clinicalFlags.push(...vitalFlags);
    analysis.clinicalFlags = [...new Set(analysis.clinicalFlags)];
  }
  
  _generateDifferentials(analysis) {
    // Generate differential diagnosis based on body systems and flags
    const differentials = [];
    
    if (analysis.affectedBodySystems.includes(BODY_SYSTEMS.CARDIOVASCULAR)) {
      if (analysis.clinicalFlags.includes('CARDIAC_EMERGENCY')) {
        differentials.push({ condition: 'Acute Myocardial Infarction', likelihood: 'high' });
        differentials.push({ condition: 'Unstable Angina', likelihood: 'moderate' });
      } else {
        differentials.push({ condition: 'Hypertension', likelihood: 'moderate' });
        differentials.push({ condition: 'Heart Failure', likelihood: 'low' });
      }
    }
    
    if (analysis.affectedBodySystems.includes(BODY_SYSTEMS.RESPIRATORY)) {
      differentials.push({ condition: 'Upper Respiratory Infection', likelihood: 'moderate' });
      differentials.push({ condition: 'Bronchitis', likelihood: 'moderate' });
      differentials.push({ condition: 'Pneumonia', likelihood: 'low' });
      differentials.push({ condition: 'Asthma Exacerbation', likelihood: 'low' });
    }
    
    if (analysis.affectedBodySystems.includes(BODY_SYSTEMS.GASTROINTESTINAL)) {
      differentials.push({ condition: 'Gastroenteritis', likelihood: 'moderate' });
      differentials.push({ condition: 'GERD', likelihood: 'moderate' });
      differentials.push({ condition: 'Peptic Ulcer Disease', likelihood: 'low' });
    }
    
    if (analysis.affectedBodySystems.includes(BODY_SYSTEMS.RENAL)) {
      differentials.push({ condition: 'Nephrotic Syndrome', likelihood: 'moderate' });
      differentials.push({ condition: 'Chronic Kidney Disease', likelihood: 'moderate' });
      differentials.push({ condition: 'Acute Kidney Injury', likelihood: 'low' });
    }
    
    if (analysis.affectedBodySystems.includes(BODY_SYSTEMS.NEUROLOGICAL)) {
      differentials.push({ condition: 'Tension Headache', likelihood: 'high' });
      differentials.push({ condition: 'Migraine', likelihood: 'moderate' });
      if (analysis.clinicalFlags.includes('STROKE_ALERT')) {
        differentials.push({ condition: 'Cerebrovascular Accident', likelihood: 'high' });
      }
    }
    
    // Limit to top 5 differentials
    analysis.differentialDiagnosis = differentials.slice(0, 5);
  }
  
  _recommendTests(analysis) {
    const tests = new Set();
    
    for (const system of analysis.affectedBodySystems) {
      const systemKey = Object.keys(BODY_SYSTEMS).find(key => BODY_SYSTEMS[key] === system);
      if (systemKey && RECOMMENDED_TESTS[systemKey]) {
        RECOMMENDED_TESTS[systemKey].forEach(test => tests.add(test));
      }
    }
    
    // Always include basic tests
    tests.add('CBC');
    tests.add('BMP');
    
    // Limit to top 8 tests
    analysis.recommendedTests = [...tests].slice(0, 8);
  }
  
  _determineTriageLevel(analysis) {
    if (analysis.isEmergency || analysis.severity >= 5) {
      analysis.triageLevel = 'EMERGENT';
    } else if (analysis.severity === 4) {
      analysis.triageLevel = 'URGENT';
    } else if (analysis.severity === 3) {
      analysis.triageLevel = 'SEMI_URGENT';
    } else if (analysis.severity === 2) {
      analysis.triageLevel = 'ROUTINE';
    } else {
      analysis.triageLevel = 'NON_URGENT';
    }
  }
  
  _generateSOAP(symptoms, analysis) {
    const subjective = `Chief Complaint: Patient presents with ${symptoms.substring(0, 200)}${symptoms.length > 200 ? '...' : ''}`;
    
    const objective = analysis.affectedBodySystems.length > 0
      ? `Body Systems Affected: ${analysis.affectedBodySystems.join(', ')}\n` +
        `Clinical Flags: ${analysis.clinicalFlags.length > 0 ? analysis.clinicalFlags.join(', ') : 'None identified'}`
      : 'Awaiting physical examination';
    
    const assessment = `Severity: ${analysis.severity}/5\n` +
      `Triage Level: ${analysis.triageLevel}\n` +
      `Recommended Specialty: ${analysis.suggestedSpecialty}\n` +
      (analysis.differentialDiagnosis.length > 0
        ? `Differential Diagnosis:\n${analysis.differentialDiagnosis.map(d => `- ${d.condition} (${d.likelihood})`).join('\n')}`
        : '');
    
    const plan = `Recommended Tests: ${analysis.recommendedTests.join(', ')}\n` +
      (analysis.suggestedMedications.length > 0
        ? `Suggested Medications: ${analysis.suggestedMedications.join(', ')}\n`
        : '') +
      (analysis.isEmergency ? 'URGENT: Immediate medical attention required.\n' : '') +
      'Follow up as directed by healthcare provider.';
    
    return `SUBJECTIVE:\n${subjective}\n\nOBJECTIVE:\n${objective}\n\nASSESSMENT:\n${assessment}\n\nPLAN:\n${plan}`;
  }
  
  _determineRouting(analysis) {
    return {
      specialty: analysis.suggestedSpecialty,
      urgency: analysis.triageLevel,
      autoRoute: analysis.severity >= 4,
      reason: analysis.isEmergency
        ? 'Emergency condition detected - immediate attention required'
        : analysis.severity >= 4
        ? 'High severity - priority routing enabled'
        : 'Standard routing based on specialty match'
    };
  }
  
  _calculatePriorityScore(analysis) {
    // Base score from triage level
    const levelInfo = TRIAGE_LEVELS[analysis.triageLevel];
    let score = levelInfo ? levelInfo.priority : 50;
    
    // Boost for emergencies
    if (analysis.isEmergency) {
      score = Math.min(100, score + 20);
    }
    
    // Boost for multiple body systems
    if (analysis.affectedBodySystems.length > 2) {
      score = Math.min(100, score + 5);
    }
    
    // Boost for clinical flags
    if (analysis.clinicalFlags.length > 3) {
      score = Math.min(100, score + 5);
    }
    
    return score;
  }
  
  /**
   * Get triage level info
   */
  getTriageLevelInfo(level) {
    return TRIAGE_LEVELS[level] || TRIAGE_LEVELS.NON_URGENT;
  }
  
  /**
   * Get all triage levels
   */
  getAllTriageLevels() {
    return TRIAGE_LEVELS;
  }
  
  /**
   * Get body systems
   */
  getBodySystems() {
    return BODY_SYSTEMS;
  }
}

module.exports = new AITriageEngine();

