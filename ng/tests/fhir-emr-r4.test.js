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

test('laboratory FHIR preserves recorded abnormal flags verbatim without inferring codes or thresholds', () => {
  const row = { id, patient_user_id: patient, test_name: 'Synthetic laboratory test', result_value: 'Recorded result', status: 'final' };
  for (const flag of ['critical', 'HH', 'Below local reference range', ' unknown local label ']) {
    const report = clinical.toDiagnosticReport({ ...row, abnormal_flag: flag });
    assertR4(report);
    assert.deepEqual(report.contained[0].interpretation, [{ text: flag }]);
    assert.equal(report.contained[0].interpretation[0].coding, undefined);
  }
  for (const flag of [undefined, null, '', '  ']) {
    const report = clinical.toDiagnosticReport({ ...row, abnormal_flag: flag });
    assertR4(report);
    assert.equal(report.contained[0].interpretation, undefined);
  }
});

for(const tz of ['UTC','Africa/Lagos','America/New_York']) test(`FHIR MedicationRequest preserves SQL civil-date expiry and timestamp precision in ${tz}`,()=>{
  const result=require('node:child_process').spawnSync(process.execPath,['-e',`
    const assert=require('node:assert/strict');
    const medication=require(${JSON.stringify(require.resolve('../services/interop/medicationFhirService'))});
    const assertR4=require(${JSON.stringify(require.resolve('./helpers/fhir-r4-schema'))});
    const item={id:${JSON.stringify(id)},drug_id:${JSON.stringify(id)},drug_name:'Synthetic recorded medicine',quantity:2};
    const context={order:{patient_user_id:${JSON.stringify(patient)},status:'pending'},f:{},rx:{id:${JSON.stringify(id)},lifecycle_status:'sent_to_pharmacy',signed_at:'2026-11-03T12:34:56.789Z'}};
    for(const date of ['2024-02-29','2026-03-07','2026-03-08','2026-03-09','2026-10-31','2026-11-01','2026-11-02','2026-11-03','2026-12-31']){
      const resource=medication.medicationRequest(item,{...context,rx:{...context.rx,expires_at:date}});
      assertR4(resource);
      assert.equal(resource.dispenseRequest.validityPeriod.end,date);
      assert.equal(resource.authoredOn,context.rx.signed_at,'Recorded timestamp stays an instant');
      assert.equal(resource.dispenseRequest.quantity.value,2);
      assert.equal(resource.status,'active');
    }
    for(const expiry of [null,undefined]){
      const resource=medication.medicationRequest(item,{...context,rx:{...context.rx,expires_at:expiry}});
      assertR4(resource);assert.equal(resource.dispenseRequest.validityPeriod,undefined);
    }
    for(const expiry of ['', '2026-02-29','infinity','-infinity','0001-01-01 BC','10000-01-01','2026-11-03T00:00:00Z',require('pg').types.getTypeParser(1082)('2026-11-03')]){
      assert.throws(()=>medication.medicationRequest(item,{...context,rx:{...context.rx,expires_at:expiry}}),error=>error.status===422);
    }
  `],{env:{...process.env,TZ:tz},encoding:'utf8'});
  assert.equal(result.status,0,`${result.stdout}\n${result.stderr}`);
});
