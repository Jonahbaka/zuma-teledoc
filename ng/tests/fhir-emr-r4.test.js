'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const assertR4=require('./helpers/fhir-r4-schema');
const clinical=require('../services/interop/clinicalFhirService');
const medication=require('../services/interop/medicationFhirService');
const capability=require('../services/interop/phcFhirCapabilityService');
const id='00000000-0000-4000-8000-000000000001';
const patient='00000000-0000-4000-8000-000000000002';

test('both advertised EMR interfaces conform to the official R4 CapabilityStatement JSON schema',()=>{
  assertR4(capability.getCapabilityStatement());assertR4(medication.capability());
  assert.ok(!medication.capability().rest[0].resource.some(row=>row.interaction.some(i=>['create','update','delete'].includes(i.code))));
});
test('allergy and condition exports preserve attribution, longitudinal status and entered-in-error semantics',()=>{
  const allergy={id,patient_user_id:patient,substance_text:'Recorded test substance',substance_code:'123456',code_system:'http://snomed.info/sct',criticality:'high',clinical_status:'active',verification_status:'confirmed',recorded_at:new Date(),onset_date:new Date('2026-10-01'),recorded_by_user_id:id,recorded_by_role:'provider',reaction_text:'Recorded reaction'};
  const active=clinical.toAllergy(allergy);assertR4(active);assert.equal(active.patient.reference,`Patient/${patient}`);assert.equal(active.onsetDateTime,'2026-10-01');assert.equal(active.reaction[0].manifestation[0].text,'Recorded reaction');
  const corrected=clinical.toAllergy({...allergy,clinical_status:'entered-in-error'});assertR4(corrected);assert.equal(corrected.clinicalStatus,undefined);assert.equal(corrected.verificationStatus.coding[0].code,'entered-in-error');
  const problem={id,patient_user_id:patient,problem_text:'Recorded problem',problem_code:'I10',code_system:'ICD-10',clinical_status:'active',verification_status:'confirmed',recorded_at:new Date(),onset_date:'2026-09-01'};
  const condition=clinical.toCondition(problem);assertR4(condition);assert.equal(condition.code.coding[0].system,'http://hl7.org/fhir/sid/icd-10');
  assertR4(clinical.toCondition({...problem,clinical_status:'entered-in-error'}));
});
test('laboratory FHIR preserves recorded results and units without inventing numeric values or exposing report storage links',()=>{
  const row={id,patient_user_id:patient,encounter_id:id,test_name:'Recorded laboratory test',result_value:'Not detected',unit:'Recorded unit',status:'final',collected_at:new Date(),resulted_at:new Date(),report_url:'https://private.invalid/storage-sensitive'};
  const report=clinical.toDiagnosticReport(row);assertR4(report);assert.equal(report.contained[0].valueString,'Not detected');assert.equal(report.contained[0].valueQuantity,undefined);assert.ok(!JSON.stringify(report).includes('storage-sensitive'));
  const absent=clinical.toDiagnosticReport({...row,result_value:null,status:'registered'});assertR4(absent);assert.ok(absent.contained[0].dataAbsentReason);
});
test('FHIR rejects an invalid dispense, and reports uploaded prescriptions without claiming a DoctaRx prescriber signature',()=>{
  assert.throws(()=>medication.validateResource({resourceType:'MedicationDispense',id,status:'completed'}),/identified medicine and patient/);
  const ctx={order:{patient_user_id:patient,prescription_id:id,status:'pending'},f:{pharmacy_confirmed_at:new Date()},rx:null};
  const resource=medication.medicationRequest({id,drug_id:id,drug_name:'Recorded reviewed medicine',quantity:1},ctx);
  assertR4(resource);assert.equal(resource.reportedBoolean,true);assert.equal(resource.requester,undefined);
});
