'use strict';

// External prescriber boundary only. Trusted pharmacy/courier reconciliation
// continues to use the lower-level workflow, never an HTTP-selectable bypass.
const { z } = require('zod');
const workflow = require('./prescriptionWorkflowService');
const { assertProviderPrescriptionContext } = require('./providerPrescriptionGuardService');
const uuid = z.string().uuid();
const note = z.string().trim().max(4000).refine(value => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value));
const requiredNote = z.string().trim().min(1).max(4000).refine(value => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value));
const optionalNote = note.nullable().optional();
const bodies = {
  sign: z.object({ sig_text: optionalNote }).strict(),
  send: z.object({ pharmacy_id: uuid }).strict(),
  cancel: z.object({ reason: optionalNote }).strict(),
  complete: z.object({}).strict(),
  refill: z.object({ item_id: uuid.nullable().optional(), quantity: z.number().int().positive().max(2147483647).nullable().optional(), notes: optionalNote }).strict(),
  approve_refill: z.object({}).strict(),
  deny_refill: z.object({ reason: optionalNote }).strict(),
};
const optionalReference = z.union([uuid,z.literal('')]).nullable().optional().transform(value => value || null);
const draft = z.object({
  provider_id: z.string().max(100).optional(), patient_user_id: uuid, appointment_id: optionalReference,
  preferred_pharmacy_id: optionalReference, diagnosis: z.string().trim().max(255).nullable().optional(), notes: optionalNote,
  is_controlled: z.boolean().optional(), aiSourceSuggestionId: optionalReference, phcEncounterId: optionalReference,
  items: z.array(z.object({ drug_id: optionalReference, drug_name: requiredNote, generic_name: optionalNote,
    brand_name: optionalNote, dosage: requiredNote, frequency: requiredNote, notes: optionalNote,
    duration_days: z.number().int().positive().max(2147483647).nullable().optional(),
    quantity: z.number().int().positive().max(2147483647).nullable().optional(),
    refills_authorized: z.number().int().nonnegative().max(2147483647).optional(),
  }).strict()).min(1).max(20),
}).strict();
const filters = z.object({ provider_id: uuid.optional(), patient_user_id: uuid.optional(), pharmacy_id: uuid.optional(),
  status: z.enum(Object.keys(workflow.TRANSITIONS)).optional(), since: z.string().datetime({ offset: true }).optional(),
  limit: z.string().regex(/^[1-9]\d{0,2}$/).transform(Number).refine(value => value <= 500).optional() }).strict();
function fail(status, message) { return Object.assign(new Error(message), { status, code: 'PRESCRIBER_RX_REJECTED' }); }
function parse(schema, input) { const result = schema.safeParse(input); if (!result.success) throw fail(400, 'Supply valid prescription references and bounded clinical fields.'); return result.data; }
async function tx(pool, action) {
  const client = await pool.connect();
  try { await client.query('BEGIN'); const result = await action(client); await client.query('COMMIT'); return result; }
  catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
}
async function account(client, actor) {
  if (actor?.role !== 'provider' || !uuid.safeParse(actor?.id).success) throw fail(403, 'Current Nigeria prescriber authority is required.');
  const user = (await client.query("SELECT id FROM users WHERE id=$1 AND role='provider' AND is_active=TRUE AND account_status='active' AND market_scope='NG' AND provider_status='approved' FOR SHARE", [actor.id])).rows[0];
  if (!user) throw fail(403, 'Current Nigeria prescriber authority is required.');
  const profile = (await client.query("SELECT id FROM ng_providers WHERE user_id=$1 AND status='verified' FOR SHARE", [user.id])).rows[0];
  if (!profile) throw fail(403, 'Current Nigeria prescriber authority is required.');
  return { userId: user.id, providerId: profile.id };
}
async function scoped(client, authority, prescriptionId, mutation) {
  const row = (await client.query(`SELECT id,patient_user_id FROM ng_digital_prescriptions
    WHERE id=$1 AND provider_id=$2 FOR ${mutation ? 'UPDATE' : 'SHARE'}`, [prescriptionId,authority.providerId])).rows[0];
  if (!row) throw fail(404, 'Prescription not found for this clinician.');
  return row;
}
async function audit(client, authority, action, prescription = null) {
  await client.query(`INSERT INTO audit_logs(user_id,action,resource_type,resource_id,patient_id,phi_accessed,success,description)
    VALUES($1,$2,'digital_prescription',$3,$4,true,true,$5)`,
  [authority.userId, ['list','read','events'].includes(action) ? 'read' : action==='create' ? 'create' : 'update', prescription?.id || null, prescription?.patient_user_id || null, `Prescriber prescription ${action}`]);
}
async function list(pool, actor, query = {}) {
  const data = parse(filters,query);
  return tx(pool,async client => {
    const authority = await account(client,actor);
    // Compatibility filters never change the current clinician's ownership scope.
    const rows = (await client.query(`SELECT rx.*,
      (SELECT COUNT(*) FROM ng_rx_items i WHERE i.prescription_id=rx.id) AS item_count,
      (SELECT COUNT(*) FROM ng_rx_items i WHERE i.prescription_id=rx.id AND i.status='dispensed') AS dispensed_count
      FROM ng_digital_prescriptions rx WHERE rx.provider_id=$1
        AND ($2::ng_rx_status IS NULL OR rx.lifecycle_status=$2::ng_rx_status)
        AND ($3::timestamptz IS NULL OR rx.created_at>=$3)
      ORDER BY rx.created_at DESC,rx.id LIMIT $4 FOR SHARE OF rx`, [authority.providerId,data.status || null,data.since || null,data.limit || 50])).rows;
    await audit(client,authority,'list'); return rows;
  });
}
async function read(pool, actor, prescriptionId, events = false) {
  parse(uuid,prescriptionId);
  return tx(pool,async client => {
    const authority = await account(client,actor), rx = await scoped(client,authority,prescriptionId,false);
    const result = events ? await workflow.listEvents(rx.id,client) : await workflow.getPrescription(rx.id,client);
    await audit(client,authority,events ? 'events' : 'read',rx); return result;
  });
}
async function mutate(pool, actor, reference, action, raw = {}) {
  parse(uuid,reference);
  if (!bodies[action]) throw fail(400,'Unsupported prescriber action.');
  const data = parse(bodies[action],raw);
  return tx(pool,async client => {
    const authority = await account(client,actor);
    const isRefillDecision = ['approve_refill','deny_refill'].includes(action);
    let prescriptionId = reference;
    if (isRefillDecision) {
      const metadata = (await client.query('SELECT prescription_id FROM ng_rx_refills WHERE id=$1',[reference])).rows[0];
      if (!metadata) throw fail(404,'Refill not found for this clinician.');
      prescriptionId = metadata.prescription_id;
    }
    const rx = await scoped(client,authority,prescriptionId,true);
    if (isRefillDecision && !(await client.query('SELECT id FROM ng_rx_refills WHERE id=$1 AND prescription_id=$2 FOR UPDATE',[reference,rx.id])).rows.length) throw fail(404,'Refill not found for this clinician.');
    const professional = { user_id: authority.userId, kind: 'prescriber' };
    let result;
    if (action==='sign') result = await workflow.sign(rx.id,professional,data,client);
    if (action==='send') result = await workflow.sendToPharmacy(rx.id,data.pharmacy_id,professional,client);
    if (action==='cancel') result = await workflow.cancel(rx.id,professional,data,client);
    if (action==='complete') result = await workflow.complete(rx.id,professional,client);
    if (action==='refill') result = await workflow.requestRefill(rx.id,data.item_id,professional,data,client);
    if (action==='approve_refill') result = await workflow.approveRefill(reference,professional,client);
    if (action==='deny_refill') result = await workflow.denyRefill(reference,professional,data,client);
    await audit(client,authority,action,rx); return result;
  });
}
async function create(pool, actor, raw = {}) {
  const data = parse(draft,raw);
  if ((data.aiSourceSuggestionId == null) !== (data.phcEncounterId == null)) throw fail(400,'Choose both the approved AI review and its PHC encounter, or neither.');
  return tx(pool,async client => {
    const authority = await account(client,actor);
    try {
      // Reuse the existing main-provider care guard. A saved source suggestion
      // never substitutes for the clinician's own authority or patient context.
      await assertProviderPrescriptionContext(client,{ user:{ id:authority.userId,role:'provider' } },{
        patientUserId:data.patient_user_id,appointmentId:data.appointment_id,
        preferredPharmacyId:data.preferred_pharmacy_id,fulfillmentPreference:'pickup_or_delivery',
      });
    } catch (error) {
      const status = error.status || error.statusCode;
      if ([400,403,409].includes(status)) throw fail(status,'The current patient and care context does not permit prescription creation.');
      throw error;
    }
    const result = await workflow.createDraft({
      ...data,provider_id:authority.providerId,
      clinical_ai_source_suggestion_id:data.aiSourceSuggestionId,
      clinical_ai_source_encounter_id:data.phcEncounterId,
    },client);
    await audit(client,authority,'create',result); return result;
  });
}
function sendError(res,error) {
  const own = error.code === 'PRESCRIBER_RX_REJECTED';
  const workflowStatus = { NOT_FOUND:404,FORBIDDEN:403,INVALID_STATE:409,INVALID_TRANSITION:409 }[error.code];
  const ai = /^CLINICAL_AI_RX_|^CLINICAL_AI_CARE_ACTION_|^CLINICAL_AI_ENCOUNTER_MISMATCH$|^ASSIGNED_CLINICIAN_REQUIRED$/.test(error.code || '');
  const status = own && [400,403,404,409].includes(error.status) ? error.status : workflowStatus || (ai && [400,403,409].includes(error.statusCode) ? error.statusCode : ai ? 409 : 503);
  return res.status(status).json({ ok:false,error:own ? error.message : workflowStatus ? 'The current prescription state does not permit this action.' : 'Prescription access is temporarily unavailable. No action was confirmed.' });
}
module.exports = { list,read,mutate,create,sendError };
