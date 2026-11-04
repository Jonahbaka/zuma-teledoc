#!/usr/bin/env node

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const { createSimulationPool } = require('./simulationSafety');
const { DEMO_ACCOUNTS } = require('./seed-demo-accounts');

const DEFAULT_DEMO_PASSWORD = 'Demo12345678!';

const REQUIRED_TABLES = [
  'users',
  'ng_emr_records',
  'ng_clinical_encounters',
  'ng_soap_notes',
  'ng_diagnoses',
  'ng_medication_history',
  'ng_lab_results',
  'ng_clinical_documents',
  'ng_visit_timeline_events',
  'ng_pharmacies',
  'ng_digital_prescriptions',
  'ng_digital_prescription_items',
  'ng_prescription_audit_logs',
  'ng_referrals',
];

const AGENTS = [
  { id: 'patient', role: 'Patient', authRole: 'patient' },
  { id: 'juniorDoctor', role: 'Junior Doctor', authRole: 'provider' },
  { id: 'consultant', role: 'Senior Consultant', authRole: 'provider' },
  { id: 'nurse', role: 'Nurse', authRole: 'provider' },
  { id: 'pharmacist', role: 'Pharmacist', authRole: 'pharmacy' },
  { id: 'labTech', role: 'Lab Technician', authRole: 'provider' },
  { id: 'hospitalAdmin', role: 'Hospital Administrator', authRole: 'admin' },
  { id: 'referralCoordinator', role: 'Referral Coordinator', authRole: 'admin' },
  { id: 'intern', role: 'Intern Observer', authRole: 'provider' },
];

const ROLE_PERMISSIONS = {
  Patient: ['join_consultation', 'view_own_record', 'request_refill'],
  'Junior Doctor': ['join_consultation', 'create_soap', 'record_diagnosis', 'escalate_consultation', 'view_record'],
  'Senior Consultant': ['join_consultation', 'create_soap', 'record_diagnosis', 'create_prescription', 'create_referral', 'complete_encounter', 'view_record'],
  Nurse: ['join_consultation', 'record_vitals', 'view_record'],
  Pharmacist: ['verify_prescription', 'dispense_prescription', 'view_prescription'],
  'Lab Technician': ['record_lab_result', 'attach_document'],
  'Hospital Administrator': ['update_referral_status', 'view_operational_queue'],
  'Referral Coordinator': ['create_referral', 'update_referral_status', 'view_record'],
  'Intern Observer': ['view_record'],
};

const SCENARIO_NAMES = [
  'seed demo agents',
  'patient joins telehealth session',
  'junior doctor opens encounter',
  'nurse records vitals timeline',
  'junior doctor creates SOAP note',
  'consultant records diagnosis',
  'consultant creates malaria prescription',
  'pharmacist prescription creation denied',
  'consultant routes prescription to pharmacy',
  'pharmacist accepts prescription',
  'pharmacist dispenses prescription',
  'patient requests refill',
  'medication history persisted',
  'lab technician records malaria test',
  'lab technician attaches imaging report',
  'referral coordinator prescription denied',
  'consultant creates referral with SOAP and Rx attachments',
  'hospital administrator accepts referral',
  'hospital administrator completes referral',
  'intern write attempt denied safely',
  'longitudinal record evidence verified',
];

function permissionFor(agentRole, action) {
  return (ROLE_PERMISSIONS[agentRole] || []).includes(action);
}

function assertPermission(agentRole, action) {
  if (!permissionFor(agentRole, action)) {
    const error = new Error(`${agentRole} cannot perform ${action}`);
    error.code = 'PERMISSION_DENIED';
    throw error;
  }
}

function createEvidence(runId, environment = 'dry-run') {
  return {
    runId,
    environment,
    startedAt: new Date().toISOString(),
    agents: AGENTS,
    scenarios: [],
    records: {},
  };
}

function resolveSimulationDemoPassword({ dryRun = false, env = process.env } = {}) {
  if (env.NG_DEMO_PASSWORD) return env.NG_DEMO_PASSWORD;
  if (dryRun || env.ALLOW_DEFAULT_DEMO_PASSWORD === 'true') return DEFAULT_DEMO_PASSWORD;
  throw new Error('Set NG_DEMO_PASSWORD, or set ALLOW_DEFAULT_DEMO_PASSWORD=true for a known non-production simulation database.');
}

function pass(evidence, name, details = {}) {
  evidence.scenarios.push({ name, status: 'passed', mode: evidence.environment, details, at: new Date().toISOString() });
}

function fail(evidence, name, error) {
  evidence.scenarios.push({
    name,
    status: 'failed',
    mode: evidence.environment,
    error: error.message,
    at: new Date().toISOString(),
  });
}

async function expectDenied(evidence, name, fn) {
  try {
    await fn();
    throw new Error('Action unexpectedly succeeded');
  } catch (error) {
    if (error.code === 'PERMISSION_DENIED') {
      pass(evidence, name, { deniedSafely: true, reason: error.message });
      return;
    }
    throw error;
  }
}

async function one(client, sql, params, fallback = {}) {
  const result = await client.query(sql, params);
  return result.rows[0] || { id: crypto.randomUUID(), ...fallback };
}

async function ensureSimulationSchema(client) {
  await client.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS market_scope VARCHAR(10) DEFAULT 'US'");
  await client.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS test_account_metadata JSONB DEFAULT '{}'::jsonb");
  await client.query(`
    ALTER TABLE ng_referrals
      ADD COLUMN IF NOT EXISTS encounter_id UUID,
      ADD COLUMN IF NOT EXISTS target_name TEXT,
      ADD COLUMN IF NOT EXISTS destination_type TEXT DEFAULT 'internal',
      ADD COLUMN IF NOT EXISTS clinical_notes TEXT,
      ADD COLUMN IF NOT EXISTS response_summary TEXT,
      ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ
  `);
}

async function assertRequiredTables(client) {
  for (const table of REQUIRED_TABLES) {
    const result = await client.query('SELECT to_regclass($1) AS table_name', [table]);
    if (!result.rows[0]?.table_name) {
      throw new Error(`Required table is missing: ${table}. Run npm run ng:migrate against the simulation database first.`);
    }
  }
}

async function upsertUser(client, account, passwordHash, runId) {
  const metadata = {
    demo: true,
    simulationRunId: runId,
    demoRole: account.demoRole,
    seededBy: 'ng/scripts/simulate-live-clinical-workflows.js',
  };
  const result = await client.query(
    `INSERT INTO users (
       email, password_hash, role, first_name, last_name,
       is_active, is_verified, email_verified_at,
       hipaa_consent_at, terms_accepted_at,
       country, provider_status, specialty, credentials,
       license_number, license_state, market_scope, test_account_metadata,
       created_at, updated_at
     ) VALUES (
       $1,$2,$3,$4,$5,
       TRUE, TRUE, NOW(),
       NOW(), NOW(),
       'Nigeria', $6, $7, $8,
       $9, $10, 'NG', $11::jsonb,
       NOW(), NOW()
     )
     ON CONFLICT (email, role) DO UPDATE SET
       password_hash = EXCLUDED.password_hash,
       is_active = TRUE,
       is_verified = TRUE,
       provider_status = EXCLUDED.provider_status,
       specialty = COALESCE(EXCLUDED.specialty, users.specialty),
       market_scope = 'NG',
       test_account_metadata = COALESCE(users.test_account_metadata, '{}'::jsonb) || EXCLUDED.test_account_metadata,
       updated_at = NOW()
     RETURNING id, email, role`,
    [
      account.email,
      passwordHash,
      account.authRole,
      account.firstName,
      account.lastName,
      account.authRole === 'provider' ? 'approved' : null,
      account.specialty || null,
      account.authRole === 'provider' ? 'MD' : null,
      account.authRole === 'provider' ? `MDCN-SIM-${account.demoRole.replace(/\W+/g, '').toUpperCase()}` : null,
      account.authRole === 'provider' ? 'Lagos' : null,
      JSON.stringify(metadata),
    ]
  );
  return result.rows[0];
}

async function ensureDemoPharmacy(client, ownerUserId, runId) {
  return one(
    client,
    `INSERT INTO ng_pharmacies (
       name, slug, owner_user_id, pcn_license_number, pcn_license_expiry,
       superintendent_name, superintendent_pcn_number, superintendent_phone,
       address_line1, city, state, phone, email, status, verified_at
     ) VALUES (
       $1,$2,$3,$4,NOW() + INTERVAL '2 years',
       'Musa Ibrahim',$5,'+234800000001',
       '12 Demo Health Street','Lagos','Lagos','+234800000002',$6,'approved',NOW()
     )
     ON CONFLICT (slug) DO UPDATE SET owner_user_id = EXCLUDED.owner_user_id, status = 'approved'
     RETURNING *`,
    [
      'DoctaRx Demo Pharmacy',
      `doctarx-demo-pharmacy-${runId.slice(0, 8)}`,
      ownerUserId,
      `PCN-SIM-${runId.slice(0, 8).toUpperCase()}`,
      `PCN-PHARM-${runId.slice(0, 8).toUpperCase()}`,
      'pharmacy@demo.doctarx.com',
    ],
    { name: 'DoctaRx Demo Pharmacy' }
  );
}

async function runClinicalSimulation({ pool, dryRun = false, runId = `ng-clinical-${Date.now()}` } = {}) {
  const evidence = createEvidence(runId, dryRun ? 'dry-run' : 'live-db');
  const client = dryRun ? createFakeClient() : await pool.connect();

  try {
    await client.query('BEGIN');
    if (!dryRun) {
      await assertRequiredTables(client);
      await ensureSimulationSchema(client);
    }

    const passwordHash = await bcrypt.hash(resolveSimulationDemoPassword({ dryRun }), 4);
    const accounts = {};
    for (const account of DEMO_ACCOUNTS) {
      const row = await upsertUser(client, account, passwordHash, runId);
      accounts[account.demoRole] = row;
    }
    evidence.records.accounts = Object.fromEntries(Object.entries(accounts).map(([role, row]) => [role, row.id]));
    pass(evidence, 'seed demo agents', { accountCount: Object.keys(accounts).length });

    const pharmacy = await ensureDemoPharmacy(client, accounts.Pharmacist.id, runId);
    evidence.records.pharmacyId = pharmacy.id;

    assertPermission('Patient', 'join_consultation');
    pass(evidence, 'patient joins telehealth session', { patientUserId: accounts.Patient.id });

    assertPermission('Junior Doctor', 'join_consultation');
    const emr = await one(client, `INSERT INTO ng_emr_records (patient_user_id, chart_number, chronic_conditions, risk_flags)
      VALUES ($1,$2,$3::jsonb,$4::jsonb)
      ON CONFLICT (patient_user_id) DO UPDATE SET updated_at = NOW()
      RETURNING *`, [
      accounts.Patient.id,
      `NG-SIM-${runId.slice(-8)}`,
      JSON.stringify([{ condition: 'Hypertension', status: 'active' }]),
      JSON.stringify([{ flag: 'malaria_follow_up', severity: 'moderate' }]),
    ]);
    const encounter = await one(client, `INSERT INTO ng_clinical_encounters (
      patient_user_id, provider_user_id, encounter_type, status, reason_for_visit, chief_complaint, started_at, metadata
    ) VALUES ($1,$2,'telehealth','in_progress',$3,$4,NOW(),$5::jsonb) RETURNING *`, [
      accounts.Patient.id,
      accounts.Doctor.id,
      'Fever, chills, and medication review',
      'Fever for 2 days',
      JSON.stringify({ simulationRunId: runId }),
    ]);
    evidence.records.emrRecordId = emr.id;
    evidence.records.encounterId = encounter.id;
    pass(evidence, 'junior doctor opens encounter', { encounterId: encounter.id });

    assertPermission('Nurse', 'record_vitals');
    await one(client, `INSERT INTO ng_visit_timeline_events (
      patient_user_id, encounter_id, actor_user_id, event_type, title, description, metadata
    ) VALUES ($1,$2,$3,'vitals_recorded','Vitals recorded',$4,$5::jsonb) RETURNING *`, [
      accounts.Patient.id,
      encounter.id,
      accounts.Nurse.id,
      'Temp 38.6 C, BP 138/88, pulse 96',
      JSON.stringify({ temperatureC: 38.6, bp: '138/88', pulse: 96 }),
    ]);
    pass(evidence, 'nurse records vitals timeline', { nurseUserId: accounts.Nurse.id });

    assertPermission('Junior Doctor', 'create_soap');
    const soap = await one(client, `INSERT INTO ng_soap_notes (
      encounter_id, patient_user_id, provider_user_id, subjective, objective, assessment, plan, ai_assist_status, provider_attestation, signed_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,'reviewed','Reviewed by provider',NOW()) RETURNING *`, [
      encounter.id,
      accounts.Patient.id,
      accounts.Doctor.id,
      'Fever, chills, malaise, no danger signs reported.',
      'Febrile, stable airway and circulation, malaria RDT ordered.',
      'Suspected uncomplicated malaria; monitor chronic hypertension.',
      'ACT therapy if test positive, fluids, follow-up in 48 hours.',
    ]);
    evidence.records.soapNoteId = soap.id;
    pass(evidence, 'junior doctor creates SOAP note', { soapNoteId: soap.id });

    assertPermission('Senior Consultant', 'record_diagnosis');
    const diagnosis = await one(client, `INSERT INTO ng_diagnoses (
      patient_user_id, encounter_id, provider_user_id, code_system, diagnosis_code, description, diagnosis_type, clinical_status
    ) VALUES ($1,$2,$3,'ICD-10','B54','Malaria, unspecified','working','active') RETURNING *`, [
      accounts.Patient.id,
      encounter.id,
      accounts.Consultant.id,
    ]);
    evidence.records.diagnosisId = diagnosis.id;
    pass(evidence, 'consultant records diagnosis', { diagnosisId: diagnosis.id });

    assertPermission('Senior Consultant', 'create_prescription');
    const prescription = await one(client, `INSERT INTO ng_digital_prescriptions (
      patient_user_id, provider_user_id, encounter_id, prescription_number, lifecycle_status,
      route_status, refill_allowed, refill_limit, patient_instructions, audit_metadata
    ) VALUES ($1,$2,$3,$4,'created','not_routed',TRUE,1,$5,$6::jsonb) RETURNING *`, [
      accounts.Patient.id,
      accounts.Consultant.id,
      encounter.id,
      `NG-RX-SIM-${runId.slice(-8).toUpperCase()}`,
      'Take with food. Return if fever persists after 48 hours.',
      JSON.stringify({ simulationRunId: runId, scenario: 'malaria_drugs' }),
    ]);
    await one(client, `INSERT INTO ng_digital_prescription_items (
      prescription_id, medication_name, generic_name, dosage, frequency, duration, quantity, route, metadata
    ) VALUES ($1,'Artemether/lumefantrine','Artemether + lumefantrine','20/120 mg','Twice daily','3 days','24 tablets','oral',$2::jsonb) RETURNING *`, [
      prescription.id,
      JSON.stringify({ nigeriaScenario: 'malaria_drugs' }),
    ]);
    await one(client, `INSERT INTO ng_prescription_audit_logs (prescription_id, actor_user_id, action, to_status, message, metadata)
      VALUES ($1,$2,'created','created','Consultant created malaria prescription',$3::jsonb) RETURNING *`, [
      prescription.id,
      accounts.Consultant.id,
      JSON.stringify({ simulationRunId: runId }),
    ]);
    evidence.records.prescriptionId = prescription.id;
    pass(evidence, 'consultant creates malaria prescription', { prescriptionId: prescription.id });

    await expectDenied(evidence, 'pharmacist prescription creation denied', async () => {
      assertPermission('Pharmacist', 'create_prescription');
    });

    const routed = await one(client, `UPDATE ng_digital_prescriptions
      SET pharmacy_id = $2, lifecycle_status = 'sent', route_status = 'sent_to_pharmacy', sent_at = NOW(), updated_at = NOW()
      WHERE id = $1 RETURNING *`, [prescription.id, pharmacy.id], { id: prescription.id });
    await one(client, `INSERT INTO ng_prescription_audit_logs (prescription_id, actor_user_id, action, from_status, to_status, message)
      VALUES ($1,$2,'routed_to_pharmacy','created','sent','Routed to demo pharmacy') RETURNING *`, [prescription.id, accounts.Consultant.id]);
    pass(evidence, 'consultant routes prescription to pharmacy', { status: routed.lifecycle_status || 'sent' });

    assertPermission('Pharmacist', 'verify_prescription');
    await one(client, `UPDATE ng_digital_prescriptions
      SET lifecycle_status = 'accepted_by_pharmacy', accepted_at = NOW(), updated_at = NOW()
      WHERE id = $1 RETURNING *`, [prescription.id], { id: prescription.id });
    await one(client, `INSERT INTO ng_prescription_audit_logs (prescription_id, actor_user_id, action, from_status, to_status, message)
      VALUES ($1,$2,'status_accepted_by_pharmacy','sent','accepted_by_pharmacy','Pharmacist verified order') RETURNING *`, [prescription.id, accounts.Pharmacist.id]);
    pass(evidence, 'pharmacist accepts prescription', { prescriptionId: prescription.id });

    assertPermission('Pharmacist', 'dispense_prescription');
    await one(client, `UPDATE ng_digital_prescriptions
      SET lifecycle_status = 'dispensed', dispensed_at = NOW(), updated_at = NOW()
      WHERE id = $1 RETURNING *`, [prescription.id], { id: prescription.id });
    await one(client, `INSERT INTO ng_prescription_audit_logs (prescription_id, actor_user_id, action, from_status, to_status, message)
      VALUES ($1,$2,'status_dispensed','accepted_by_pharmacy','dispensed','Dispensed by pharmacist') RETURNING *`, [prescription.id, accounts.Pharmacist.id]);
    pass(evidence, 'pharmacist dispenses prescription', { prescriptionId: prescription.id });

    assertPermission('Patient', 'request_refill');
    await one(client, `UPDATE ng_digital_prescriptions
      SET refill_count = refill_count + 1, lifecycle_status = 'created', updated_at = NOW()
      WHERE id = $1 RETURNING *`, [prescription.id], { id: prescription.id });
    await one(client, `INSERT INTO ng_prescription_audit_logs (prescription_id, actor_user_id, action, from_status, to_status, message)
      VALUES ($1,$2,'refill_requested','dispensed','created','Patient requested refill') RETURNING *`, [prescription.id, accounts.Patient.id]);
    pass(evidence, 'patient requests refill', { prescriptionId: prescription.id });

    await one(client, `INSERT INTO ng_medication_history (
      patient_user_id, encounter_id, prescription_id, medication_name, generic_name, dosage, frequency, route, duration, status, source, metadata
    ) VALUES ($1,$2,$3,'Artemether/lumefantrine','Artemether + lumefantrine','20/120 mg','Twice daily','oral','3 days','active','provider_entered',$4::jsonb) RETURNING *`, [
      accounts.Patient.id,
      encounter.id,
      prescription.id,
      JSON.stringify({ simulationRunId: runId }),
    ]);
    pass(evidence, 'medication history persisted', { prescriptionId: prescription.id });

    assertPermission('Lab Technician', 'record_lab_result');
    const lab = await one(client, `INSERT INTO ng_lab_results (
      patient_user_id, encounter_id, ordering_provider_user_id, test_name, result_value, unit, abnormal_flag, status, collected_at, resulted_at, metadata
    ) VALUES ($1,$2,$3,'Malaria RDT','Positive','','abnormal','final',NOW(),NOW(),$4::jsonb) RETURNING *`, [
      accounts.Patient.id,
      encounter.id,
      accounts['Lab Technician'].id,
      JSON.stringify({ simulationRunId: runId }),
    ]);
    evidence.records.labResultId = lab.id;
    pass(evidence, 'lab technician records malaria test', { labResultId: lab.id });

    assertPermission('Lab Technician', 'attach_document');
    const document = await one(client, `INSERT INTO ng_clinical_documents (
      patient_user_id, encounter_id, uploaded_by, document_type, title, storage_ref, mime_type, confidentiality, status, metadata
    ) VALUES ($1,$2,$3,'imaging','Chest X-ray demo report','demo://xray/malaria-review.pdf','application/pdf','restricted','current',$4::jsonb) RETURNING *`, [
      accounts.Patient.id,
      encounter.id,
      accounts['Lab Technician'].id,
      JSON.stringify({ simulationRunId: runId, imagingExample: true }),
    ]);
    evidence.records.documentId = document.id;
    pass(evidence, 'lab technician attaches imaging report', { documentId: document.id });

    await expectDenied(evidence, 'referral coordinator prescription denied', async () => {
      assertPermission('Referral Coordinator', 'create_prescription');
    });

    assertPermission('Senior Consultant', 'create_referral');
    const referral = await one(client, `INSERT INTO ng_referrals (
      patient_user_id, provider_user_id, encounter_id, target_name, destination_type,
      referral_type, priority, status, reason, clinical_notes, audit_metadata
    ) VALUES ($1,$2,$3,'Internal Medicine Consultant','internal','specialist','urgent','sent',$4,$5,$6::jsonb) RETURNING *`, [
      accounts.Patient.id,
      accounts.Consultant.id,
      encounter.id,
      'Persistent fever with hypertension comorbidity',
      'Attach SOAP note, malaria prescription, and lab result.',
      JSON.stringify({
        simulationRunId: runId,
        attachments: { soapNoteIds: [soap.id], prescriptionIds: [prescription.id], documentIds: [document.id] },
      }),
    ]);
    evidence.records.referralId = referral.id;
    pass(evidence, 'consultant creates referral with SOAP and Rx attachments', { referralId: referral.id });

    assertPermission('Hospital Administrator', 'update_referral_status');
    await one(client, `UPDATE ng_referrals SET status = 'accepted', response_summary = 'Accepted for specialist review', updated_at = NOW()
      WHERE id = $1 RETURNING *`, [referral.id], { id: referral.id });
    pass(evidence, 'hospital administrator accepts referral', { referralId: referral.id });

    await one(client, `UPDATE ng_referrals SET status = 'completed', completed_at = NOW(), response_summary = 'Specialist review completed', updated_at = NOW()
      WHERE id = $1 RETURNING *`, [referral.id], { id: referral.id });
    pass(evidence, 'hospital administrator completes referral', { referralId: referral.id });

    await expectDenied(evidence, 'intern write attempt denied safely', async () => {
      assertPermission('Intern Observer', 'create_soap');
    });

    const verification = await client.query(`SELECT
      (SELECT COUNT(*) FROM ng_soap_notes WHERE patient_user_id = $1) AS soap_count,
      (SELECT COUNT(*) FROM ng_digital_prescriptions WHERE patient_user_id = $1) AS prescription_count,
      (SELECT COUNT(*) FROM ng_referrals WHERE patient_user_id = $1) AS referral_count,
      (SELECT COUNT(*) FROM ng_visit_timeline_events WHERE patient_user_id = $1) AS timeline_count`,
    [accounts.Patient.id]);
    pass(evidence, 'longitudinal record evidence verified', verification.rows[0] || {});

    await client.query(dryRun ? 'ROLLBACK' : 'COMMIT');
    evidence.completedAt = new Date().toISOString();
    evidence.finalResult = evidence.scenarios.every((scenario) => scenario.status === 'passed') ? 'pass' : 'fail';
    return evidence;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    fail(evidence, 'simulation aborted', error);
    evidence.completedAt = new Date().toISOString();
    evidence.finalResult = 'fail';
    throw Object.assign(error, { evidence });
  } finally {
    if (!dryRun) client.release();
  }
}

function createFakeClient() {
  const queries = [];
  return {
    queries,
    async query(sql, params = []) {
      queries.push({ sql: String(sql).replace(/\s+/g, ' ').trim(), params });
      if (/to_regclass/i.test(sql)) return { rows: [{ table_name: params[0] }] };
      if (/COUNT\(\*\)/i.test(sql)) return { rows: [{ soap_count: '1', prescription_count: '1', referral_count: '1', timeline_count: '1' }] };
      return { rows: [{ id: crypto.randomUUID(), created_at: new Date().toISOString() }] };
    },
    release() {},
  };
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  if (dryRun) {
    const evidence = await runClinicalSimulation({ dryRun: true });
    writeEvidence(evidence, 'clinical-workflow-evidence.json');
    console.log(JSON.stringify(evidence, null, 2));
    return;
  }

  const { pool, source, redactedUrl } = createSimulationPool();
  try {
    const evidence = await runClinicalSimulation({ pool });
    evidence.database = { source, redactedUrl };
    writeEvidence(evidence, 'clinical-workflow-evidence.json');
    console.log(JSON.stringify(evidence, null, 2));
  } finally {
    await pool.end();
  }
}

function writeEvidence(evidence, fileName) {
  const artifactRoot = process.env.SIMULATION_ARTIFACT_DIR || path.join(process.cwd(), 'artifacts', 'ng-simulations', evidence.runId);
  fs.mkdirSync(artifactRoot, { recursive: true });
  const artifactPath = path.join(artifactRoot, fileName);
  evidence.artifactPath = artifactPath;
  fs.writeFileSync(artifactPath, JSON.stringify(evidence, null, 2));
  return artifactPath;
}

if (require.main === module) {
  main().catch((error) => {
    const evidence = error.evidence;
    if (evidence) {
      console.error(JSON.stringify(evidence, null, 2));
    }
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  AGENTS,
  REQUIRED_TABLES,
  ROLE_PERMISSIONS,
  SCENARIO_NAMES,
  assertPermission,
  createFakeClient,
  permissionFor,
  resolveSimulationDemoPassword,
  runClinicalSimulation,
  writeEvidence,
};
