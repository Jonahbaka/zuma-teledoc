'use strict';

const workflow = require('../phc/phcWorkflowService');
const FHIRMapper = require('../../../server/services/fhir-bridge/mappers');
const safety = require('../clinical/patientSafetyService');
const { decrypt } = require('../../../lib/encryption');

const iso = (value) => value ? new Date(value).toISOString() : undefined;
const absent = { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/data-absent-reason', code: 'unknown' }] };
const ucum = { mmHg: 'mm[Hg]', 'mm[Hg]': 'mm[Hg]', '°C': 'Cel', Cel: 'Cel', 'beats/min': '/min', '/min': '/min', '%': '%', kg: 'kg', cm: 'cm' };

function quantity(value, unit) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return null;
  return { value: Number(value), ...(unit ? { unit } : {}), ...(ucum[unit] ? { system: 'http://unitsofmeasure.org', code: ucum[unit] } : {}) };
}

function toObservation(row) {
  const resource = {
    resourceType: 'Observation', id: row.id,
    status: row.status === 'entered_in_error' ? 'entered-in-error' : row.status,
    code: { coding: [{ system: row.code_system, code: row.observation_code, display: row.display_name }] },
    subject: { reference: `Patient/${row.patient_user_id}` },
    encounter: { reference: `Encounter/${row.encounter_id}` },
    effectiveDateTime: iso(row.observed_at),
    performer: [{ reference: `Practitioner/${row.entered_by}` }],
  };
  if (row.value_type === 'quantity_pair' && row.observation_code === '85354-9') {
    resource.component = [['8480-6', 'Systolic blood pressure', row.value_numeric], ['8462-4', 'Diastolic blood pressure', row.value_numeric_secondary]].map(([code, display, value]) => {
      const measured = quantity(value, row.unit);
      return { code: { coding: [{ system: 'http://loinc.org', code, display }] }, ...(measured ? { valueQuantity: measured } : { dataAbsentReason: absent }) };
    });
  } else if (row.value_type === 'numeric') {
    const measured = quantity(row.value_numeric, row.unit);
    if (measured) resource.valueQuantity = measured;
    else resource.dataAbsentReason = absent;
  } else if (row.value_type === 'text' && row.value_text !== null && row.value_text !== undefined) {
    resource.valueString = row.value_text;
  } else if (row.value_type === 'coded' && row.value_code) {
    // The stored value has no declared terminology system; preserve it as text.
    resource.valueCodeableConcept = { text: row.value_code };
  } else if (row.value_type === 'boolean' && ['true', 'false'].includes(String(row.value_code))) {
    resource.valueBoolean = String(row.value_code) === 'true';
  } else resource.dataAbsentReason = absent;
  if (row.method) resource.method = { text: row.method };
  if (row.reference_range_text) resource.referenceRange = [{ text: row.reference_range_text }];
  if (row.interpretation) resource.interpretation = [{ text: row.interpretation }];
  return resource;
}

function toEncounter(row) {
  const status = row.status === 'cancelled' ? 'cancelled' : row.ended_at ? 'finished' : row.suspended_at && !row.resumed_at ? 'onleave' : 'in-progress';
  const resource = {
    resourceType: 'Encounter', id: row.id,
    meta: { versionId: String(row.record_version || 1), lastUpdated: iso(row.updated_at) },
    status,
    class: { system: 'http://terminology.hl7.org/CodeSystem/v3-ActCode', code: 'AMB' },
    subject: { reference: `Patient/${row.patient_user_id}` },
    serviceProvider: { reference: `Organization/${row.facility_id}` },
    period: { start: iso(row.started_at || row.created_at), ...(row.ended_at ? { end: iso(row.ended_at) } : {}) },
  };
  if (row.provider_user_id) resource.participant = [{ individual: { reference: `Practitioner/${row.provider_user_id}` } }];
  if (row.reason_for_visit || row.chief_complaint) resource.reasonCode = [{ text: row.reason_for_visit || row.chief_complaint }];
  return resource;
}

async function patient(pool, context, patientId) {
  await workflow.requireEnrollment(pool, context, patientId);
  return new FHIRMapper(pool).toPatient(patientId);
}
async function encounter(pool, context, encounterId) {
  const row = await workflow.getEncounter(pool, context, encounterId);
  await workflow.requireEnrollment(pool, context, row.patient_user_id);
  return toEncounter(row);
}
async function observations(pool, context, encounterId) {
  const result = await workflow.listObservations(pool, context, encounterId);
  await workflow.requireEnrollment(pool, context, result.encounter.patient_user_id);
  return result.observations.map(toObservation);
}

function coded(text,code,system) {
  const canonical = system === 'ICD-10' ? 'http://hl7.org/fhir/sid/icd-10' : system;
  return { ...(text ? { text } : {}), ...(code && /^https?:\/\//.test(canonical || '') ? {coding:[{system:canonical,code}]} : {}) };
}
function toAllergy(row) {
  const inError=row.clinical_status==='entered-in-error' || row.verification_status==='entered-in-error';
  const resource={resourceType:'AllergyIntolerance',id:row.id,
    ...(inError?{}:{clinicalStatus:{coding:[{system:'http://terminology.hl7.org/CodeSystem/allergyintolerance-clinical',code:row.clinical_status}]}}),
    verificationStatus:{coding:[{system:'http://terminology.hl7.org/CodeSystem/allergyintolerance-verification',code:inError?'entered-in-error':row.verification_status}]},
    code:coded(row.substance_text,row.substance_code,row.code_system),patient:{reference:`Patient/${row.patient_user_id}`},criticality:row.criticality,
    recordedDate:iso(row.recorded_at),...(row.category?{category:[row.category]}:{}),...(row.onset_date?{onsetDateTime:row.onset_date instanceof Date?row.onset_date.toISOString().slice(0,10):String(row.onset_date).slice(0,10)}:{}),
  };
  if(row.recorded_by_user_id)resource.recorder={reference:`${row.recorded_by_role==='patient'?'Patient':'Practitioner'}/${row.recorded_by_user_id}`};
  if(row.reaction_text || row.reaction_code)resource.reaction=[{manifestation:[{text:row.reaction_text || row.reaction_code}]}];
  return resource;
}
function toCondition(row) {
  const inError=row.clinical_status==='entered-in-error' || row.verification_status==='entered-in-error';
  const resource={resourceType:'Condition',id:row.id,
    ...(inError?{}:{clinicalStatus:{coding:[{system:'http://terminology.hl7.org/CodeSystem/condition-clinical',code:row.clinical_status}]}}),
    verificationStatus:{coding:[{system:'http://terminology.hl7.org/CodeSystem/condition-ver-status',code:inError?'entered-in-error':row.verification_status}]},
    category:[{coding:[{system:'http://terminology.hl7.org/CodeSystem/condition-category',code:'problem-list-item'}]}],
    code:coded(row.problem_text,row.problem_code,row.code_system),subject:{reference:`Patient/${row.patient_user_id}`},recordedDate:iso(row.recorded_at),
  };
  if(row.encounter_id)resource.encounter={reference:`Encounter/${row.encounter_id}`};
  if(row.onset_date)resource.onsetDateTime=row.onset_date instanceof Date?row.onset_date.toISOString().slice(0,10):String(row.onset_date).slice(0,10);
  if(row.resolved_date)resource.abatementDateTime=row.resolved_date instanceof Date?row.resolved_date.toISOString().slice(0,10):String(row.resolved_date).slice(0,10);
  if(row.severity)resource.severity={text:row.severity};
  return resource;
}
function toDiagnosticReport(row) {
  const code=coded(row.test_name,row.loinc_code,'http://loinc.org');
  const result=row.result_value_encrypted?decrypt(row.result_value_encrypted,row.result_value_iv,row.result_value_tag):row.result_value;
  if(row.result_value_encrypted && result===null)throw Object.assign(new Error('The laboratory result could not be securely read.'),{statusCode:503});
  const observation={resourceType:'Observation',id:'laboratory-result',status:row.status==='partial'?'preliminary':row.status,code,subject:{reference:`Patient/${row.patient_user_id}`},...(row.collected_at?{effectiveDateTime:iso(row.collected_at)}:{})};
  if(result!==null && result!==undefined && String(result).length)observation.valueString=String(result);
  else observation.dataAbsentReason=absent;
  if(row.reference_range)observation.referenceRange=[{text:row.reference_range}];
  // Preserve the laboratory's recorded interpretation without inferring a code
  // or reclassifying results against an invented clinical threshold.
  if (typeof row.abnormal_flag === 'string' && row.abnormal_flag.trim()) observation.interpretation = [{ text: row.abnormal_flag }];
  if(row.unit && observation.valueString)observation.note=[{text:`Recorded result unit: ${row.unit}`}];
  return {resourceType:'DiagnosticReport',id:row.id,status:row.status,code,subject:{reference:`Patient/${row.patient_user_id}`},
    ...(row.encounter_id?{encounter:{reference:`Encounter/${row.encounter_id}`}}:{}),...(row.resulted_at?{issued:iso(row.resulted_at)}:{}),
    ...(row.collected_at?{effectiveDateTime:iso(row.collected_at)}:{}),contained:[observation],result:[{reference:'#laboratory-result'}]};
}
async function authorizedEncounter(pool,context,encounterId) {
  const encounter=await workflow.getEncounter(pool,context,encounterId);
  await workflow.requireEnrollment(pool,context,encounter.patient_user_id);
  return encounter;
}
async function allergies(pool,context,encounterId) {
  const encounter=await authorizedEncounter(pool,context,encounterId);
  return (await safety.listAllergies(pool,encounter.patient_user_id,{includeInactive:true})).map(toAllergy);
}
async function conditions(pool,context,encounterId) {
  const encounter=await authorizedEncounter(pool,context,encounterId);
  return (await safety.listProblems(pool,encounter.patient_user_id,{includeInactive:true})).map(toCondition);
}
async function diagnosticReports(pool,context,encounterId) {
  const encounter=await authorizedEncounter(pool,context,encounterId);
  const rows=(await pool.query('SELECT * FROM ng_lab_results WHERE encounter_id=$1 AND patient_user_id=$2 ORDER BY created_at,id',[encounter.id,encounter.patient_user_id])).rows;
  return rows.map(toDiagnosticReport);
}
// This is a metadata-only representation of clinician-authored PHC referrals,
// not authorization or transport for an external partner.
function toServiceRequest(row) {
  const statuses = { draft: 'draft', sent: 'active', accepted: 'active', completed: 'completed', cancelled: 'revoked' };
  const priorities = { routine: 'routine', urgent: 'urgent', emergency: 'stat' };
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const date = new Date(row.created_at);
  // Receiver rejection does not prove that the originating order was revoked.
  // Do not invent a FHIR status or silently omit an unrepresentable referral.
  if (!Object.hasOwn(statuses, row.status) || !Object.hasOwn(priorities, row.priority) ||
      ![row.id, row.patient_user_id, row.encounter_id, row.provider_user_id].every(value => typeof value === 'string' && uuid.test(value)) ||
      !row.created_at || !Number.isFinite(date.getTime())) {
    const error = new Error('Referral metadata cannot be represented by this FHIR subset.');
    error.statusCode = 503; throw error;
  }
  return {
    resourceType: 'ServiceRequest', id: row.id, status: statuses[row.status], intent: 'order',
    priority: priorities[row.priority],
    subject: { type: 'Patient', identifier: { system: 'urn:doctarx:patient-user', value: row.patient_user_id } },
    encounter: { type: 'Encounter', identifier: { system: 'urn:doctarx:clinical-encounter', value: row.encounter_id } },
    requester: { type: 'Practitioner', identifier: { system: 'urn:doctarx:practitioner-user', value: row.provider_user_id } }, authoredOn: date.toISOString(),
  };
}
async function serviceRequests(pool, context, encounterId, { count = 50, offset = 0 } = {}) {
  // Intersection of existing referral worklist roles and internal FHIR roles.
  if (context.programmeRole !== 'remote_clinician') {
    const error = new Error('Clinical referral read role required.'); error.statusCode = 403; throw error;
  }
  if (!Number.isSafeInteger(count) || count < 1 || count > 200 || !Number.isSafeInteger(offset) || offset < 0 || offset > 1000000) {
    const error = new Error('Invalid referral pagination.'); error.statusCode = 400; throw error;
  }
  const encounter = await authorizedEncounter(pool, context, encounterId);
  const rows = (await pool.query(
    `SELECT id, patient_user_id, encounter_id, provider_user_id, status, priority, created_at
       FROM ng_referrals
      WHERE programme_id=$1 AND facility_id=$2 AND encounter_id=$3 AND patient_user_id=$4
      ORDER BY created_at,id LIMIT $5 OFFSET $6`,
    [context.programme_id, context.facility_id, encounter.id, encounter.patient_user_id, count + 1, offset]
  )).rows;
  // Validate the lookahead too; never imply a successful partial page when an
  // unsupported source state is already known in this result set.
  const resources = rows.map(toServiceRequest);
  return { resources: resources.slice(0, count), hasNext: resources.length > count };
}
module.exports = { serviceRequests, toServiceRequest, patient, encounter, observations, allergies, conditions, diagnosticReports, toObservation, toEncounter, toAllergy, toCondition, toDiagnosticReport };
