'use strict';

const db = require('../db');
const { z } = require('zod');
const { encrypt, decrypt } = require('../../lib/encryption');
const { keysToCamel, getPaginationMeta } = require('../../lib/utils');
const { recordTypeSchema } = require('../../lib/validation');

const reference = z.string().uuid();
const reason = z.string().trim().min(3).max(1000);
const documentFields = {
  title: z.string().trim().min(1).max(255),
  content: z.string().min(1).max(200000),
  recordType: recordTypeSchema,
  isSensitive: z.boolean(),
  accessRestricted: z.boolean(),
};
const createSchema = z.object({
  ...documentFields,
  patientId: reference,
  appointmentId: reference.optional(),
  isSensitive: z.boolean().default(false),
  accessRestricted: z.boolean().default(true),
  reason: reason.optional(),
  fileName: z.string().optional(), fileType: z.string().optional(), fileSize: z.number().optional(),
}).strict();
const updateSchema = z.object({
  ...Object.fromEntries(Object.entries(documentFields).map(([key, value]) => [key, value.optional()])),
  expectedVersion: z.number().int().min(1), reason,
}).strict();
const listSchema = z.object({
  page: z.coerce.number().int().min(1).max(10001).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  sortOrder: z.enum(['asc','desc','ASC','DESC']).default('desc'),
}).strict();
const fail = (statusCode, code, message) => Object.assign(new Error(message), { statusCode, code });
const denied = () => fail(403,'MEDICAL_RECORD_ACCESS_DENIED','This document is not available in your current care context.');
const missing = () => fail(404,'MEDICAL_RECORD_NOT_FOUND','Medical document not found.');
function parse(schema, input) {
  const result = schema.safeParse(input);
  if (!result.success) throw fail(400,'MEDICAL_RECORD_INPUT_INVALID','Provide a valid document reference, supported fields and required revision information.');
  return result.data;
}
function market(actor) {
  const value = String(actor.market_scope || actor.region || actor.country || '').trim().toUpperCase();
  if (['US','USA','UNITED STATES','UNITED STATES OF AMERICA'].includes(value)) return 'US';
  if (['NG','NIGERIA'].includes(value)) return 'NG';
  return null;
}

async function withActor(session, work) {
  parse(reference,session?.id);
  if (!['patient','provider'].includes(session.role)) throw denied();
  const client = await db.getPool().connect();
  try {
    await client.query('BEGIN');
    const actor = (await client.query('SELECT id,role,is_active,provider_status,market_scope,region,country FROM users WHERE id=$1 FOR SHARE',[session.id])).rows[0];
    if (!actor?.is_active || actor.role !== session.role || !market(actor) ||
      actor.role === 'provider' && actor.provider_status !== 'approved') throw denied();
    if (actor.role === 'provider' && market(actor) === 'NG' && !(await client.query("SELECT id FROM ng_providers WHERE user_id=$1 AND status='verified' FOR SHARE",[actor.id])).rows.length) throw denied();
    const result = await work(client,actor);
    await client.query('COMMIT');
    return result;
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}

async function authorizePatient(client,actor,patientId) {
  parse(reference,patientId);
  const patient = (await client.query("SELECT id,role,is_active,market_scope,region,country FROM users WHERE id=$1 AND role='patient' FOR SHARE",[patientId])).rows[0];
  if (!patient?.is_active || market(patient) !== market(actor)) throw denied();
  if (actor.role === 'patient') { if (actor.id !== patientId) throw denied(); return; }
  const care = await client.query("SELECT id FROM appointments WHERE patient_id=$1 AND provider_id=$2 AND status NOT IN ('cancelled','no_show') ORDER BY id LIMIT 1 FOR SHARE",[patientId,actor.id]);
  if (!care.rows.length) throw denied();
}

async function audit(client,actor,action,recordId,patientId,details={}) {
  await client.query(`INSERT INTO audit_logs (user_id,action,resource_type,resource_id,patient_id,description,new_values,phi_accessed,success)
    VALUES($1,$2,'medical_record',$3,$4,'Medical document access or revision confirmed',$5::jsonb,TRUE,TRUE)`,
  [actor.id,action,recordId || null,patientId,JSON.stringify(details)]);
}
async function revision(client,record,actor,action,revisionReason) {
  await client.query(`INSERT INTO medical_record_revisions(record_id,version,action,actor_user_id,reason_protected,snapshot_json)
    VALUES($1,$2,$3,$4,$5::jsonb,$6::jsonb) ON CONFLICT(record_id,version) DO NOTHING`,
  [record.id,record.record_version,action,actor.id,revisionReason ? JSON.stringify(encrypt(revisionReason)) : null,JSON.stringify(record)]);
}
function visible(record,actor) { return actor.role !== 'patient' || record.access_restricted === false && record.is_voided === false; }
function format(record,includeContent=false) {
  const result = keysToCamel(Object.fromEntries(Object.entries(record).filter(([key]) => !['content_encrypted','content_iv','content_tag'].includes(key))));
  if (includeContent) {
    result.content = decrypt(record.content_encrypted,record.content_iv,record.content_tag);
    if (typeof result.content !== 'string' || !result.content.length) throw fail(503,'MEDICAL_RECORD_DECRYPTION_UNAVAILABLE','The protected document could not be opened. Its contents are unavailable.');
    result.createdBy = {id:record.created_by,firstName:record.created_by_first_name,lastName:record.created_by_last_name};
  }
  return result;
}
async function ownedRecord(client,actor,id,{write=false}={}) {
  parse(reference,id);
  const record = (await client.query(`SELECT mr.*,u.first_name AS created_by_first_name,u.last_name AS created_by_last_name
    FROM medical_records mr JOIN users u ON u.id=mr.created_by WHERE mr.id=$1 FOR ${write?'UPDATE':'SHARE'} OF mr`,[id])).rows[0];
  if (!record) throw missing();
  await authorizePatient(client,actor,record.patient_id);
  if (!visible(record,actor)) throw missing();
  if (write && (actor.role !== 'provider' || record.created_by !== actor.id)) throw denied();
  if (record.appointment_id) {
    const appointment = await client.query(`SELECT id FROM appointments WHERE id=$1 AND patient_id=$2
      AND ($3::boolean=FALSE OR provider_id=$4 AND status NOT IN ('cancelled','no_show')) FOR SHARE`,[record.appointment_id,record.patient_id,write,actor.id]);
    if (!appointment.rows.length) throw denied();
  }
  return record;
}

async function create(session,input) {
  const data = parse(createSchema,input);
  if (data.fileName || data.fileType || data.fileSize) throw fail(503,'MEDICAL_ATTACHMENT_NOT_ACTIVATED','Use the protected document submission workflow. A file has not been uploaded here.');
  if (data.accessRestricted === false && !data.reason) throw fail(400,'MEDICAL_RECORD_RELEASE_REASON_REQUIRED','Record a reason when explicitly releasing a document to its patient.');
  return withActor(session,async(client,actor)=>{
    if (actor.role !== 'provider') throw denied();
    await authorizePatient(client,actor,data.patientId);
    if (data.appointmentId && !(await client.query("SELECT id FROM appointments WHERE id=$1 AND patient_id=$2 AND provider_id=$3 AND status NOT IN ('cancelled','no_show') FOR SHARE",[data.appointmentId,data.patientId,actor.id])).rows.length) throw denied();
    const protectedContent = encrypt(data.content);
    const record = (await client.query(`INSERT INTO medical_records(patient_id,created_by,appointment_id,record_type,title,content_encrypted,content_iv,content_tag,is_sensitive,access_restricted)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,[data.patientId,actor.id,data.appointmentId || null,data.recordType,data.title,
    protectedContent.encrypted,protectedContent.iv,protectedContent.tag,data.isSensitive,data.accessRestricted])).rows[0];
    await revision(client,record,actor,'recorded',data.reason);
    await audit(client,actor,'create',record.id,record.patient_id,{version:record.record_version,patientReleased:!record.access_restricted});
    return format(record);
  });
}
async function list(session,patientId,input={}) {
  const filters = parse(listSchema,input); parse(reference,patientId);
  return withActor(session,async(client,actor)=>{
    await authorizePatient(client,actor,patientId);
    const where="mr.patient_id=$1 AND ($2::text<>'patient' OR mr.access_restricted=FALSE AND mr.is_voided=FALSE) AND (mr.appointment_id IS NULL OR EXISTS (SELECT 1 FROM appointments bound WHERE bound.id=mr.appointment_id AND bound.patient_id=mr.patient_id))";
    const params=[patientId,actor.role];
    const total=Number((await client.query(`SELECT count(*) FROM medical_records mr WHERE ${where}`,params)).rows[0].count);
    const {rows}=await client.query(`SELECT mr.*,u.first_name AS created_by_first_name,u.last_name AS created_by_last_name FROM medical_records mr
      JOIN users u ON u.id=mr.created_by WHERE ${where} ORDER BY mr.recorded_at ${filters.sortOrder.toUpperCase()},mr.id LIMIT $3 OFFSET $4 FOR SHARE OF mr`,
    [...params,filters.limit,(filters.page-1)*filters.limit]);
    await audit(client,actor,'read',null,patientId,{recordCount:rows.length});
    return {records:rows.map(record=>format(record)),pagination:getPaginationMeta(total,filters.page,filters.limit)};
  });
}
async function read(session,id) {
  return withActor(session,async(client,actor)=>{
    const record=await ownedRecord(client,actor,id);
    const result=format(record,true);
    await audit(client,actor,'read',record.id,record.patient_id,{version:record.record_version});
    return result;
  });
}
async function update(session,id,input) {
  const data=parse(updateSchema,input);
  const changes=Object.keys(documentFields).filter(key=>data[key]!==undefined);
  if (!changes.length) throw fail(400,'MEDICAL_RECORD_INPUT_INVALID','Choose at least one supported document change.');
  return withActor(session,async(client,actor)=>{
    const current=await ownedRecord(client,actor,id,{write:true});
    if (current.is_voided || current.record_version!==data.expectedVersion) throw fail(409,'MEDICAL_RECORD_REVISION_CONFLICT','The document changed or was withdrawn. Review its current revision.');
    await revision(client,current,actor,'baseline');
    const values=[];const updates=[];
    const add=(key,value)=>{values.push(value);updates.push(`${key}=$${values.length}`);};
    for (const key of changes) {
      if (key==='content') {
        const protectedContent=encrypt(data.content);
        add('content_encrypted',protectedContent.encrypted);add('content_iv',protectedContent.iv);add('content_tag',protectedContent.tag);
      } else add(key.replace(/[A-Z]/g,letter=>'_'+letter.toLowerCase()),data[key]);
    }
    values.push(id,data.expectedVersion);
    const record=(await client.query(`UPDATE medical_records SET ${updates.join(',')},record_version=record_version+1,updated_at=NOW()
      WHERE id=$${values.length-1} AND record_version=$${values.length} RETURNING *`,values)).rows[0];
    if (!record) throw fail(409,'MEDICAL_RECORD_REVISION_CONFLICT','The document changed. Review its current revision.');
    await revision(client,record,actor,'corrected',data.reason);
    await audit(client,actor,'update',id,record.patient_id,{version:record.record_version,changedFields:changes,patientReleased:!record.access_restricted});
    return format(record);
  });
}
async function withdraw(session,id,input) {
  const data=parse(z.object({expectedVersion:z.number().int().min(1),reason}).strict(),input);
  return withActor(session,async(client,actor)=>{
    const current=await ownedRecord(client,actor,id,{write:true});
    if (current.is_voided || current.record_version!==data.expectedVersion) throw fail(409,'MEDICAL_RECORD_REVISION_CONFLICT','The document changed or was already withdrawn. Review its current revision.');
    await revision(client,current,actor,'baseline');
    const record=(await client.query('UPDATE medical_records SET is_voided=TRUE,access_restricted=TRUE,record_version=record_version+1,updated_at=NOW() WHERE id=$1 RETURNING *',[id])).rows[0];
    await revision(client,record,actor,'voided',data.reason);
    await audit(client,actor,'update',id,record.patient_id,{version:record.record_version,withdrawn:true});
    return format(record);
  });
}
async function exportRecords(session,patientId) {
  return withActor(session,async(client,actor)=>{
    if (actor.role!=='patient' || actor.id!==patientId) throw denied();
    await authorizePatient(client,actor,patientId);
    const {rows}=await client.query(`SELECT mr.* FROM medical_records mr WHERE mr.patient_id=$1 AND mr.access_restricted=FALSE AND mr.is_voided=FALSE
      AND (mr.appointment_id IS NULL OR EXISTS (SELECT 1 FROM appointments bound WHERE bound.id=mr.appointment_id AND bound.patient_id=mr.patient_id))
      ORDER BY mr.recorded_at DESC,mr.id LIMIT 1001 FOR SHARE OF mr`,[patientId]);
    if (rows.length>1000) throw fail(409,'MEDICAL_RECORD_EXPORT_REVIEW_REQUIRED','This export needs a reviewed bulk-record request.');
    const records=rows.map(record=>format(record,true));
    await audit(client,actor,'export',null,patientId,{recordCount:records.length});
    return {exportDate:new Date().toISOString(),patientId,recordCount:records.length,records};
  });
}
async function history(session,id) {
  return withActor(session,async(client,actor)=>{
    if (actor.role!=='provider') throw denied();
    const record=await ownedRecord(client,actor,id);
    const {rows}=await client.query('SELECT version,action,reason_protected,snapshot_json,created_at FROM medical_record_revisions WHERE record_id=$1 ORDER BY version LIMIT 1000',[id]);
    const revisions=rows.map(row=>{
      const revisionReason=row.reason_protected?decrypt(row.reason_protected.encrypted,row.reason_protected.iv,row.reason_protected.tag):null;
      if(row.reason_protected && typeof revisionReason!=='string') throw fail(503,'MEDICAL_RECORD_DECRYPTION_UNAVAILABLE','The protected document revision could not be opened.');
      return {version:row.version,action:row.action,createdAt:row.created_at,reason:revisionReason,record:format(row.snapshot_json,true)};
    });
    await audit(client,actor,'read',id,record.patient_id,{revisionCount:rows.length});
    return revisions;
  });
}
module.exports={create,list,read,update,withdraw,exportRecords,history};
