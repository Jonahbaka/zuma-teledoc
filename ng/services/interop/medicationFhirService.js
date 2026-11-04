'use strict';

const crypto = require('node:crypto');
const { v5: uuidv5 } = require('uuid');
const { encrypt, decrypt } = require('../../../lib/encryption');
const compliance = require('../compliance/complianceService');
const negotiation = require('./phcFhirCapabilityService');
const NS = '74b8ded0-8a4a-4bc2-829b-728c84a448b3';
const BASE = '/api/ng/medication-fhir';
const ABSOLUTE_BASE = `https://doctarx.com${BASE}`;
const SYSTEM = 'https://doctarx.com/fhir/identifier';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TYPES = Object.freeze(['Patient','Practitioner','Organization','Medication','MedicationRequest','MedicationDispense','Provenance']);
const fail = (status,message) => Object.assign(new Error(message),{status});
const iso = value => value ? new Date(value).toISOString() : undefined;
const stable = value => uuidv5(value,NS);
function concept(drug) {
  const result = { coding:[{system:`${SYSTEM}/drug-catalogue`,code:drug.drug_id || drug.id}] };
  if (drug.drug_name || drug.name) result.text = drug.drug_name || drug.name;
  return result;
}
function medicationRequest(item,ctx) {
  const cancelled = ['cancelled','expired'].includes(ctx.rx?.lifecycle_status) || ['unavailable','cancelled'].includes(item.status) || ['cancelled','refunded'].includes(ctx.order.status);
  const resource = {
    resourceType:'MedicationRequest',id:item.id,intent:'order',
    status:cancelled?'cancelled':ctx.rx?.lifecycle_status==='completed'?'completed':'active',
    identifier:[{system:`${SYSTEM}/prescription-item`,value:item.id}],
    groupIdentifier:{system:`${SYSTEM}/prescription`,value:ctx.rx?.id || ctx.order.prescription_id},
    medicationCodeableConcept:concept(item),subject:{reference:`Patient/${ctx.order.patient_user_id}`},
    authoredOn:iso(ctx.rx?.signed_at || ctx.f.pharmacy_confirmed_at),
    ...(ctx.rx ? {} : {reportedBoolean:true}),
    ...(ctx.prescriber ? {requester:{reference:`Practitioner/${ctx.prescriber.id}`}} : {}),
    ...(item.dosage || item.frequency ? {dosageInstruction:[{text:[item.dosage,item.frequency,item.duration_days ? `${item.duration_days} days` : null].filter(Boolean).join('; ')}]} : {}),
    dispenseRequest:{quantity:{value:item.quantity},...(ctx.rx?.expires_at ? {validityPeriod:{end:iso(ctx.rx.expires_at)}} : {})},
  };
  if (ctx.rx?.signed_at && Number.isSafeInteger(item.refills_authorized) && item.refills_authorized >= 0) resource.dispenseRequest.numberOfRepeatsAllowed=item.refills_authorized;
  return resource;
}
function validateResource(resource) {
  if (!resource || !UUID.test(resource.id || '') || !TYPES.includes(resource.resourceType)) throw fail(422,'The medication resource identity could not be validated.');
  if (['MedicationRequest','MedicationDispense'].includes(resource.resourceType)) {
    if (!resource.medicationCodeableConcept?.coding?.[0]?.code || !/^Patient\/[0-9a-f-]{36}$/.test(resource.subject?.reference || '')) throw fail(422,'A medication resource needs an identified medicine and patient.');
    if (resource.resourceType==='MedicationRequest' && (!['active','cancelled','completed'].includes(resource.status) || resource.intent!=='order' || !Number.isSafeInteger(resource.dispenseRequest?.quantity?.value) || resource.dispenseRequest.quantity.value<=0)) throw fail(422,'The signed medication request quantity or status is invalid.');
    if (resource.resourceType==='MedicationDispense' && (resource.status!=='completed' || !Number.isSafeInteger(resource.quantity?.value) || resource.quantity.value<=0 || !resource.performer?.[0]?.actor?.reference || !resource.authorizingPrescription?.[0]?.reference)) throw fail(422,'Pharmacist-attributed dispensing evidence is required.');
  }
  if (resource.resourceType==='Provenance' && (!resource.target?.length || !resource.agent?.length || !resource.recorded)) throw fail(422,'Dispense provenance is incomplete.');
  return resource;
}

async function context(client,orderId) {
  const order=(await client.query('SELECT * FROM ng_orders WHERE id=$1',[orderId])).rows[0];
  const f=(await client.query('SELECT * FROM ng_medication_fulfillments WHERE order_id=$1',[orderId])).rows[0];
  if (!order || !f) throw fail(404,'Medication record not found.');
  const pharmacy=(await client.query('SELECT * FROM ng_pharmacies WHERE id=$1',[order.pharmacy_id])).rows[0];
  const rx=f.digital_prescription_id ? (await client.query('SELECT * FROM ng_digital_prescriptions WHERE id=$1',[f.digital_prescription_id])).rows[0] : null;
  const items=rx ? (await client.query('SELECT * FROM ng_rx_items WHERE prescription_id=$1 ORDER BY position',[rx.id])).rows : order.items.map(item=>({...item,id:stable(`reported:${order.prescription_id}:${item.drug_id}`),drug_name:item.drug_name || item.name}));
  const prescriber=rx?.provider_id ? (await client.query('SELECT u.id,u.first_name,u.last_name FROM ng_providers p JOIN users u ON u.id=p.user_id WHERE p.id=$1',[rx.provider_id])).rows[0] : null;
  return {order,f,pharmacy,rx,items,prescriber};
}
function verified(ctx) {
  if (ctx.rx && (!ctx.rx.signed_at || ctx.rx.patient_user_id!==ctx.order.patient_user_id)) throw fail(409,'A verified signed prescription is required for FHIR exchange.');
  if (!ctx.rx && !ctx.f.pharmacy_confirmed_at) throw fail(409,'An uploaded prescription needs pharmacist confirmation before FHIR exchange.');
}
async function authorize(client,ctx,actor) {
  const user=(await client.query('SELECT id,role,is_active FROM users WHERE id=$1',[actor?.id])).rows[0];
  if (!user?.is_active) throw fail(403,'An active authorized account is required.');
  const patient=user.role==='patient' && user.id===ctx.order.patient_user_id;
  const pharmacy=user.role==='pharmacy' && user.id===ctx.pharmacy.owner_user_id;
  const prescriber=user.role==='provider' && user.id===ctx.prescriber?.id;
  if (!patient && !pharmacy && !prescriber && !['admin','super_admin'].includes(user.role)) throw fail(404,'Medication record not found.');
  if (pharmacy && (!ctx.f.pharmacy_data_consent_at && !ctx.f.fulfillment_consent_at)) throw fail(403,'Patient-authorized pharmacy data sharing is required.');
  if (pharmacy && ctx.f.commercial_snapshot) await require('../pharmacy/commercialProfileService').authorizeOrder(client,ctx.pharmacy.id,ctx.f.commercial_snapshot);
  return user;
}

// Invoked in the SAME stock/Rx transaction after verified pharmacy handover.
// Reading a paid order or receiving a courier booking cannot create a dispense.
async function recordFulfillmentDispenses(client,orderId) {
  const ctx=await context(client,orderId);
  verified(ctx);
  if (!ctx.f.pharmacy_ready_at || !ctx.f.inventory_released_at || !ctx.f.pharmacist_user_id || !ctx.f.pharmacist_registration) throw fail(409,'Verified pharmacy handover evidence is required.');
  for (const item of ctx.order.items) {
    const source=ctx.items.find(row=>row.drug_id===item.drug_id);
    if (!source || !Number.isSafeInteger(item.quantity) || item.quantity<=0 || item.quantity!==source.quantity) throw fail(409,'The dispensed item requires signed-prescription reconciliation.');
    const resource={resourceType:'MedicationDispense',id:stable(`dispense:${orderId}:${item.drug_id}`),status:'completed',
      identifier:[{system:`${SYSTEM}/fulfillment-dispense`,value:`${orderId}:${item.drug_id}`}],
      medicationCodeableConcept:concept(source),subject:{reference:`Patient/${ctx.order.patient_user_id}`},
      performer:[{actor:{reference:`Practitioner/${ctx.f.pharmacist_user_id}`}}],
      authorizingPrescription:[{reference:`MedicationRequest/${source.id}`}],quantity:{value:item.quantity},whenPrepared:iso(ctx.f.pharmacy_ready_at),
      ...(source.dosage || source.frequency ? {dosageInstruction:[{text:[source.dosage,source.frequency].filter(Boolean).join('; ')}]} : {}),
    };
    validateResource(resource);
    await client.query(`INSERT INTO ng_fhir_medication_dispenses(id,order_id,drug_id,pharmacy_id,pharmacist_user_id,resource_encrypted) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(order_id,drug_id) DO NOTHING`,[resource.id,orderId,item.drug_id,ctx.pharmacy.id,ctx.f.pharmacist_user_id,JSON.stringify(encrypt(JSON.stringify(resource)))]);
  }
}

async function resources(client,ctx) {
  const patient=(await client.query('SELECT id,first_name,last_name FROM users WHERE id=$1',[ctx.order.patient_user_id])).rows[0];
  const resources=[{resourceType:'Patient',id:patient.id,identifier:[{system:`${SYSTEM}/patient`,value:patient.id}],name:[{family:patient.last_name,given:[patient.first_name].filter(Boolean)}]},
    {resourceType:'Organization',id:ctx.pharmacy.id,name:ctx.pharmacy.name,identifier:[{system:`${SYSTEM}/pcn-pharmacy-registration`,value:ctx.pharmacy.pcn_license_number}]},
    ...ctx.items.filter(item=>ctx.order.items.some(line=>line.drug_id===item.drug_id)).map(item=>medicationRequest(item,ctx))];
  const practitionerIds=[...new Set([ctx.prescriber?.id,ctx.f.pharmacist_user_id].filter(Boolean))];
  const practitioners=(await client.query('SELECT id,first_name,last_name FROM users WHERE id=ANY($1::uuid[])',[practitionerIds])).rows;
  for(const row of practitioners) resources.push({resourceType:'Practitioner',id:row.id,name:[{family:row.last_name,given:[row.first_name].filter(Boolean)}]});
  const catalog=(await client.query('SELECT id,name,dosage_form,strength,pack_size FROM ng_drug_catalog WHERE id=ANY($1::uuid[])',[ctx.order.items.map(item=>item.drug_id)])).rows;
  for(const drug of catalog)resources.push({resourceType:'Medication',id:drug.id,code:concept(drug),...(drug.dosage_form?{form:{text:drug.dosage_form}}:{})});
  const dispenses=(await client.query('SELECT * FROM ng_fhir_medication_dispenses WHERE order_id=$1 ORDER BY recorded_at,id',[ctx.order.id])).rows;
  for(const row of dispenses) {
    const envelope=row.resource_encrypted;const text=decrypt(envelope.encrypted,envelope.iv,envelope.tag);
    if (!text) throw fail(503,'Recorded medication evidence could not be securely read.');
    const resource=JSON.parse(text);
    if (resource.id!==row.id || resource.subject?.reference!==`Patient/${ctx.order.patient_user_id}` || !ctx.order.items.some(item=>item.drug_id===row.drug_id)) throw fail(503,'The recorded medication identity requires clinical review.');
    // A completed dispense does not assert patient delivery. Only the recorded
    // patient collection or proven last-mile completion supplies handover time.
    if(ctx.order.status==='delivered' && ctx.order.delivered_at)resource.whenHandedOver=iso(ctx.order.delivered_at);
    resources.push(resource,{resourceType:'Provenance',id:stable(`provenance:${row.id}`),target:[{reference:`MedicationDispense/${row.id}`}],recorded:iso(row.recorded_at),agent:[{who:{reference:`Practitioner/${row.pharmacist_user_id}`},onBehalfOf:{reference:`Organization/${row.pharmacy_id}`}}],entity:[{role:'source',what:{reference:resource.authorizingPrescription[0].reference}}]});
  }
  return resources.map(validateResource).map(resource=>({...resource,meta:{versionId:crypto.createHash('sha256').update(JSON.stringify(resource)).digest('hex').slice(0,32)}}));
}
async function read(pool,actor,orderId,{type='Bundle',id=null}={}) {
  if(!UUID.test(orderId || '') || id && !UUID.test(id))throw fail(400,'Use a valid order and resource identifier.');
  if(type!=='Bundle' && !TYPES.includes(type))throw fail(404,'Medication resource not found.');
  const client=await pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
    const ctx=await context(client,orderId);const user=await authorize(client,ctx,actor);verified(ctx);const rows=await resources(client,ctx);
    let resource;
    if(type==='Bundle') resource={resourceType:'Bundle',id:orderId,type:'collection',entry:rows.map(row=>({fullUrl:`${ABSOLUTE_BASE}/${row.resourceType}/${row.id}`,resource:row}))};
    else if(id) {resource=rows.find(row=>row.resourceType===type && row.id===id);if(!resource)throw fail(404,'Medication resource not found.');}
    else {const matches=rows.filter(row=>row.resourceType===type);resource={resourceType:'Bundle',type:'searchset',total:matches.length,entry:matches.map(row=>({fullUrl:`${ABSOLUTE_BASE}/${row.resourceType}/${row.id}`,resource:row,search:{mode:'match'}}))};}
    await compliance.logAction({actorUserId:user.id,actorType:user.role,action:'medication_fhir_read',resourceType:type,resourceId:orderId,pharmacyId:ctx.pharmacy.id,details:{representation:'FHIR R4 JSON',resourceCount:type==='Bundle'?rows.length:undefined}},client);
    await client.query('COMMIT');return resource;
  } catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
}
function capability() {
  return {resourceType:'CapabilityStatement',id:'doctarx-medication-r4',status:'active',date:'2026-10-18',kind:'instance',publisher:'DoctaRx',fhirVersion:'4.0.1',format:['application/fhir+json'],implementation:{description:`DoctaRx order-scoped medication exchange at ${BASE}`},
    description:'FHIR R4 JSON read subset for actual prescriptions and verified pharmacy dispensing. No SMART/OAuth server, external partner connection, generic writes, transaction or history interaction is declared. Catalogue identifiers are DoctaRx local identifiers; external product/unit crosswalks require partner validation.',
    rest:[{mode:'server',security:{description:'Current DoctaRx Bearer JWT or accessToken cookie required. Reads require a patient-owned order, managing pharmacist with patient data-sharing consent, the prescription author or an authorized administrator; all resource reads are audited.'},resource:[{type:'Bundle',interaction:[{code:'read'}],documentation:'GET Bundle/{order UUID}; collection Bundle includes only this order medication exchange records.'},...TYPES.map(type=>({type,interaction:[{code:'read'},{code:'search-type'}],searchParam:[{name:'order',type:'string',documentation:'Required DoctaRx medication order UUID. This local scope parameter is also mandatory for individual reads.'}],documentation:'No unrestricted patient or bulk search. Read is GET {type}/{id}?order={uuid}; search is GET {type}?order={uuid}. Legacy records without verified dispense snapshots do not manufacture MedicationDispense entries.'}))]}]};
}
module.exports={read,recordFulfillmentDispenses,medicationRequest,validateResource,capability,supportsJson:negotiation.supportsMetadataJson,TYPES};
