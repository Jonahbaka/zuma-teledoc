/**
 * AI Clinical Assist Routes
 * SOAP note suggestions, diagnostic assistance, and clinical decision support
 */

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const logger = require('../middleware/logger');
const { authenticate, requireRole } = require('../middleware/auth');
const { createAuditLog } = require('../middleware/audit');

const router = express.Router();

// Clinical knowledge base for demonstrations
const ICD_CODES = {
  'headache': [
    { code: 'R51.9', description: 'Headache, unspecified' },
    { code: 'G43.909', description: 'Migraine, unspecified, not intractable' },
    { code: 'G44.209', description: 'Tension-type headache, unspecified, not intractable' }
  ],
  'cough': [
    { code: 'R05.9', description: 'Cough, unspecified' },
    { code: 'J06.9', description: 'Acute upper respiratory infection, unspecified' },
    { code: 'J20.9', description: 'Acute bronchitis, unspecified' }
  ],
  'chest pain': [
    { code: 'R07.9', description: 'Chest pain, unspecified' },
    { code: 'R07.89', description: 'Other chest pain' },
    { code: 'I20.9', description: 'Angina pectoris, unspecified' }
  ],
  'fatigue': [
    { code: 'R53.83', description: 'Other fatigue' },
    { code: 'R53.1', description: 'Weakness' },
    { code: 'G93.32', description: 'Myalgic encephalomyelitis/chronic fatigue syndrome' }
  ],
  'anxiety': [
    { code: 'F41.9', description: 'Anxiety disorder, unspecified' },
    { code: 'F41.1', description: 'Generalized anxiety disorder' },
    { code: 'F41.0', description: 'Panic disorder without agoraphobia' }
  ],
  'back pain': [
    { code: 'M54.5', description: 'Low back pain' },
    { code: 'M54.9', description: 'Dorsalgia, unspecified' },
    { code: 'M54.4', description: 'Lumbago with sciatica' }
  ],
  'skin rash': [
    { code: 'R21', description: 'Rash and other nonspecific skin eruption' },
    { code: 'L30.9', description: 'Dermatitis, unspecified' },
    { code: 'L50.9', description: 'Urticaria, unspecified' }
  ]
};

/**
 * POST /api/ai-assist/soap
 * Generate AI-assisted SOAP note suggestions
 */
router.post('/soap',
  authenticate,
  requireRole('provider'),
  async (req, res) => {
    try {
      const {
        appointmentId,
        patientHistory,
        chiefComplaint,
        symptoms,
        vitals,
        physicalExam,
        existingConditions,
        medications
      } = req.body;
      
      // Get appointment and patient info
      let patientInfo = null;
      if (appointmentId) {
        const { rows } = await db.query(
          `SELECT a.*, p.first_name, p.last_name, p.date_of_birth, p.gender
           FROM appointments a
           JOIN users p ON p.id = a.patient_id
           WHERE a.id = $1`,
          [appointmentId]
        );
        if (rows.length > 0) patientInfo = rows[0];
      }
      
      // Generate AI-assisted SOAP suggestions
      // In production, this would call a medical AI model
      const suggestion = generateSOAPSuggestion({
        patientInfo,
        chiefComplaint,
        symptoms,
        vitals,
        physicalExam,
        existingConditions,
        medications
      });
      
      // Find relevant ICD codes
      const icdCodes = findRelevantICDCodes(chiefComplaint, symptoms);
      
      // Save suggestion
      const { rows: saved } = await db.query(
        `INSERT INTO ai_soap_suggestions (
          appointment_id, provider_id, model_name, model_version,
          input_symptoms, input_vitals, input_history,
          suggested_subjective, suggested_objective, suggested_assessment, suggested_plan,
          suggested_icd_codes, differential_diagnoses, confidence_scores
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
        RETURNING *`,
        [
          appointmentId || null,
          req.user.id,
          'zuma-clinical-v1',
          '1.0.0',
          symptoms,
          vitals,
          patientHistory,
          suggestion.subjective,
          suggestion.objective,
          suggestion.assessment,
          suggestion.plan,
          JSON.stringify(icdCodes),
          JSON.stringify(suggestion.differentialDiagnoses),
          JSON.stringify(suggestion.confidenceScores)
        ]
      );
      
      await createAuditLog(req, 'ai_soap_generated', 'ai_soap_suggestions', saved[0].id);
      
      logger.info('AI SOAP suggestion generated', {
        suggestionId: saved[0].id,
        providerId: req.user.id,
        appointmentId
      });
      
      res.json({
        success: true,
        suggestion: {
          id: saved[0].id,
          subjective: suggestion.subjective,
          objective: suggestion.objective,
          assessment: suggestion.assessment,
          plan: suggestion.plan,
          icdCodes,
          differentialDiagnoses: suggestion.differentialDiagnoses,
          confidenceScores: suggestion.confidenceScores,
          disclaimer: 'AI-generated suggestions are for clinical decision support only. Provider review and clinical judgment are required.'
        }
      });
    } catch (error) {
      logger.error('AI SOAP generation error', { error: error.message });
      res.status(500).json({ success: false, error: 'Failed to generate SOAP suggestions' });
    }
  }
);

/**
 * POST /api/ai-assist/diagnose
 * Generate diagnostic suggestions
 */
router.post('/diagnose',
  authenticate,
  requireRole('provider'),
  async (req, res) => {
    try {
      const {
        patientId,
        appointmentId,
        symptoms,
        duration,
        severity,
        vitals,
        patientHistory,
        labResults,
        imagingFindings
      } = req.body;
      
      // Generate diagnostic suggestions
      const diagnosticResult = generateDiagnosticSuggestions({
        symptoms,
        duration,
        severity,
        vitals,
        patientHistory,
        labResults,
        imagingFindings
      });
      
      // Save to database
      const { rows } = await db.query(
        `INSERT INTO ai_diagnostic_suggestions (
          patient_id, appointment_id, provider_id, symptoms,
          patient_history, vitals, lab_results, imaging_findings,
          suggested_diagnoses, differential_diagnoses, recommended_tests,
          treatment_suggestions, urgency_level, confidence, model_name
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
        RETURNING *`,
        [
          patientId || null,
          appointmentId || null,
          req.user.id,
          symptoms,
          patientHistory ? JSON.stringify(patientHistory) : null,
          vitals ? JSON.stringify(vitals) : null,
          labResults ? JSON.stringify(labResults) : null,
          imagingFindings ? JSON.stringify(imagingFindings) : null,
          JSON.stringify(diagnosticResult.suggestedDiagnoses),
          JSON.stringify(diagnosticResult.differentialDiagnoses),
          JSON.stringify(diagnosticResult.recommendedTests),
          JSON.stringify(diagnosticResult.treatmentSuggestions),
          diagnosticResult.urgencyLevel,
          diagnosticResult.confidence,
          'zuma-diagnostic-v1'
        ]
      );
      
      await createAuditLog(req, 'ai_diagnostic_generated', 'ai_diagnostic_suggestions', rows[0].id);
      
      res.json({
        success: true,
        diagnostic: {
          id: rows[0].id,
          ...diagnosticResult,
          disclaimer: 'AI diagnostic suggestions are for clinical decision support only. These suggestions do not replace clinical judgment, examination, and standard diagnostic procedures.'
        }
      });
    } catch (error) {
      logger.error('AI diagnostic error', { error: error.message });
      res.status(500).json({ success: false, error: 'Failed to generate diagnostic suggestions' });
    }
  }
);

/**
 * POST /api/ai-assist/soap/:id/feedback
 * Record provider feedback on AI suggestion
 */
router.post('/soap/:id/feedback',
  authenticate,
  requireRole('provider'),
  async (req, res) => {
    try {
      const { id } = req.params;
      const { feedback, notes } = req.body;
      
      await db.query(
        `UPDATE ai_soap_suggestions SET provider_feedback = $1, provider_notes = $2 WHERE id = $3`,
        [feedback, notes, id]
      );
      
      res.json({ success: true, message: 'Feedback recorded' });
    } catch (error) {
      logger.error('AI feedback error', { error: error.message });
      res.status(500).json({ success: false, error: 'Failed to record feedback' });
    }
  }
);

/**
 * GET /api/ai-assist/icd-search
 * Search ICD codes
 */
router.get('/icd-search', authenticate, async (req, res) => {
  try {
    const { query } = req.query;
    
    if (!query || query.length < 2) {
      return res.json({ success: true, codes: [] });
    }
    
    // Search through our ICD codes
    const results = [];
    const queryLower = query.toLowerCase();
    
    Object.entries(ICD_CODES).forEach(([keyword, codes]) => {
      if (keyword.includes(queryLower)) {
        results.push(...codes);
      } else {
        codes.forEach(code => {
          if (code.description.toLowerCase().includes(queryLower) || 
              code.code.toLowerCase().includes(queryLower)) {
            results.push(code);
          }
        });
      }
    });
    
    // Remove duplicates
    const uniqueResults = [...new Map(results.map(item => [item.code, item])).values()];
    
    res.json({
      success: true,
      codes: uniqueResults.slice(0, 20)
    });
  } catch (error) {
    logger.error('ICD search error', { error: error.message });
    res.status(500).json({ success: false, error: 'Failed to search ICD codes' });
  }
});

// Helper Functions

function generateSOAPSuggestion({ patientInfo, chiefComplaint, symptoms, vitals, physicalExam, existingConditions, medications }) {
  const symptomsLower = (symptoms || chiefComplaint || '').toLowerCase();
  
  // Generate context-aware suggestions
  let subjective = `Patient presents with ${chiefComplaint || 'complaints'}. `;
  if (symptoms) subjective += `Reports ${symptoms}. `;
  if (existingConditions) subjective += `Past medical history includes: ${existingConditions}. `;
  if (medications) subjective += `Current medications: ${medications}.`;
  
  let objective = 'General: Patient appears ';
  if (vitals) {
    objective += 'comfortable.\n';
    if (vitals.bloodPressure) objective += `BP: ${vitals.bloodPressure}\n`;
    if (vitals.heartRate) objective += `HR: ${vitals.heartRate}\n`;
    if (vitals.temperature) objective += `Temp: ${vitals.temperature}\n`;
    if (vitals.respiratoryRate) objective += `RR: ${vitals.respiratoryRate}\n`;
    if (vitals.oxygenSaturation) objective += `SpO2: ${vitals.oxygenSaturation}\n`;
  } else {
    objective += 'in no acute distress. Vitals pending.';
  }
  if (physicalExam) objective += `\nPhysical Exam: ${physicalExam}`;
  
  // Generate assessment based on symptoms
  let assessment = 'Assessment:\n';
  let differentialDiagnoses = [];
  
  if (symptomsLower.includes('headache')) {
    assessment += '1. Headache - likely tension-type based on presentation\n';
    differentialDiagnoses = [
      { diagnosis: 'Tension headache', probability: 0.65 },
      { diagnosis: 'Migraine', probability: 0.20 },
      { diagnosis: 'Cluster headache', probability: 0.10 },
      { diagnosis: 'Secondary headache', probability: 0.05 }
    ];
  } else if (symptomsLower.includes('cough') || symptomsLower.includes('cold')) {
    assessment += '1. Upper respiratory infection - likely viral\n';
    differentialDiagnoses = [
      { diagnosis: 'Viral URI', probability: 0.70 },
      { diagnosis: 'Acute bronchitis', probability: 0.15 },
      { diagnosis: 'Allergic rhinitis', probability: 0.10 },
      { diagnosis: 'Bacterial infection', probability: 0.05 }
    ];
  } else if (symptomsLower.includes('anxiety') || symptomsLower.includes('stress')) {
    assessment += '1. Anxiety - generalized anxiety symptoms\n';
    differentialDiagnoses = [
      { diagnosis: 'Generalized anxiety disorder', probability: 0.55 },
      { diagnosis: 'Panic disorder', probability: 0.20 },
      { diagnosis: 'Adjustment disorder with anxiety', probability: 0.15 },
      { diagnosis: 'Medical condition-related anxiety', probability: 0.10 }
    ];
  } else if (symptomsLower.includes('back') || symptomsLower.includes('pain')) {
    assessment += '1. Musculoskeletal pain - mechanical/non-specific\n';
    differentialDiagnoses = [
      { diagnosis: 'Mechanical low back pain', probability: 0.60 },
      { diagnosis: 'Muscle strain', probability: 0.25 },
      { diagnosis: 'Disc herniation', probability: 0.10 },
      { diagnosis: 'Other', probability: 0.05 }
    ];
  } else {
    assessment += `1. ${chiefComplaint || 'Symptoms under evaluation'}\n`;
    differentialDiagnoses = [
      { diagnosis: 'Primary condition under evaluation', probability: 0.80 },
      { diagnosis: 'Alternative diagnosis to consider', probability: 0.20 }
    ];
  }
  
  // Generate plan
  let plan = 'Plan:\n';
  plan += '1. Continue current medications\n';
  plan += '2. Symptomatic management as discussed\n';
  plan += '3. Patient education provided\n';
  plan += '4. Return if symptoms worsen or new symptoms develop\n';
  plan += '5. Follow-up in 2 weeks or as needed';
  
  return {
    subjective: subjective.trim(),
    objective: objective.trim(),
    assessment: assessment.trim(),
    plan: plan.trim(),
    differentialDiagnoses,
    confidenceScores: {
      subjective: 0.85,
      objective: 0.90,
      assessment: 0.75,
      plan: 0.80
    }
  };
}

function generateDiagnosticSuggestions({ symptoms, duration, severity, vitals, patientHistory, labResults, imagingFindings }) {
  const symptomsLower = (symptoms || '').toLowerCase();
  
  let suggestedDiagnoses = [];
  let recommendedTests = [];
  let treatmentSuggestions = [];
  let urgencyLevel = 'routine';
  
  // Analyze symptoms and generate suggestions
  if (symptomsLower.includes('chest pain')) {
    suggestedDiagnoses = [
      { diagnosis: 'Musculoskeletal chest pain', icd: 'R07.89', confidence: 0.45 },
      { diagnosis: 'Costochondritis', icd: 'M94.0', confidence: 0.25 },
      { diagnosis: 'GERD', icd: 'K21.0', confidence: 0.15 },
      { diagnosis: 'Anxiety-related', icd: 'F41.9', confidence: 0.10 }
    ];
    recommendedTests = [
      { test: 'ECG/EKG', priority: 'high', reason: 'Rule out cardiac cause' },
      { test: 'Troponin', priority: 'high', reason: 'Cardiac marker if ECG abnormal' },
      { test: 'Chest X-ray', priority: 'medium', reason: 'Evaluate for pulmonary causes' }
    ];
    treatmentSuggestions = [
      { treatment: 'NSAIDs for musculoskeletal pain', dosing: 'Ibuprofen 400mg TID PRN' },
      { treatment: 'PPI trial if GERD suspected', dosing: 'Omeprazole 20mg daily' }
    ];
    urgencyLevel = severity === 'severe' || severity === 'urgent' ? 'urgent' : 'soon';
  } else if (symptomsLower.includes('headache')) {
    suggestedDiagnoses = [
      { diagnosis: 'Tension-type headache', icd: 'G44.209', confidence: 0.55 },
      { diagnosis: 'Migraine without aura', icd: 'G43.909', confidence: 0.30 },
      { diagnosis: 'Cervicogenic headache', icd: 'G44.86', confidence: 0.10 }
    ];
    recommendedTests = [
      { test: 'Neurological exam', priority: 'high', reason: 'Assess for red flags' },
      { test: 'Head CT/MRI', priority: 'low', reason: 'Only if red flags present' }
    ];
    treatmentSuggestions = [
      { treatment: 'Acetaminophen', dosing: '650-1000mg Q6H PRN' },
      { treatment: 'NSAIDs', dosing: 'Ibuprofen 400-600mg Q6H PRN' },
      { treatment: 'Lifestyle modifications', dosing: 'Stress management, sleep hygiene' }
    ];
    urgencyLevel = 'routine';
  } else if (symptomsLower.includes('anxiety') || symptomsLower.includes('depression')) {
    suggestedDiagnoses = [
      { diagnosis: 'Generalized anxiety disorder', icd: 'F41.1', confidence: 0.50 },
      { diagnosis: 'Major depressive disorder', icd: 'F32.9', confidence: 0.30 },
      { diagnosis: 'Adjustment disorder', icd: 'F43.20', confidence: 0.15 }
    ];
    recommendedTests = [
      { test: 'PHQ-9 screening', priority: 'high', reason: 'Depression assessment' },
      { test: 'GAD-7 screening', priority: 'high', reason: 'Anxiety assessment' },
      { test: 'TSH', priority: 'medium', reason: 'Rule out thyroid dysfunction' }
    ];
    treatmentSuggestions = [
      { treatment: 'Cognitive behavioral therapy referral', dosing: 'Weekly sessions' },
      { treatment: 'SSRI consideration', dosing: 'Start low, titrate as needed' },
      { treatment: 'Lifestyle modifications', dosing: 'Exercise, sleep hygiene, stress reduction' }
    ];
    urgencyLevel = 'routine';
  } else {
    suggestedDiagnoses = [
      { diagnosis: 'Condition under evaluation', icd: 'R69', confidence: 0.70 }
    ];
    recommendedTests = [
      { test: 'Complete physical examination', priority: 'high', reason: 'Comprehensive assessment' },
      { test: 'Basic metabolic panel', priority: 'medium', reason: 'General screening' }
    ];
    treatmentSuggestions = [
      { treatment: 'Symptomatic management', dosing: 'As appropriate for symptoms' }
    ];
    urgencyLevel = 'routine';
  }
  
  // Adjust urgency based on severity
  if (severity === 'urgent' || severity === 'emergent') {
    urgencyLevel = 'urgent';
  }
  
  return {
    suggestedDiagnoses,
    differentialDiagnoses: suggestedDiagnoses.slice(1),
    recommendedTests,
    treatmentSuggestions,
    urgencyLevel,
    confidence: suggestedDiagnoses[0]?.confidence || 0.5
  };
}

function findRelevantICDCodes(chiefComplaint, symptoms) {
  const searchText = ((chiefComplaint || '') + ' ' + (symptoms || '')).toLowerCase();
  const codes = [];
  
  Object.entries(ICD_CODES).forEach(([keyword, icdList]) => {
    if (searchText.includes(keyword)) {
      codes.push(...icdList);
    }
  });
  
  return codes.slice(0, 5);
}

module.exports = router;




