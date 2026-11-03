'use strict';
const { assertClinicalAccess, canonicalRole, userIdOf } = require('./clinicalAccessService');
const { writeIntegrityAudit } = require('./clinicalRecordIntegrityService');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const clinicians = new Set(['provider', 'doctor', 'consultant', 'physician', 'specialist']);
const admins = new Set(['admin', 'super_admin', 'administrator', 'platform_admin']);
const fields = ['encounter_id','patient_user_id','target_organization_id','target_hospital_id','referral_type','priority','destination_type','reason','clinical_notes','target_name'];
function fail(statusCode, message) { return Object.assign(new Error(message), { statusCode }); }
function requestKey(value) {
  if (!UUID.test(value || '')) throw fail(400, 'A valid referral request reference is required.');
  return value.toLowerCase();
}
function canonicalInput(body = {}) {
  const result = {};
  for (const field of fields) {
    let value = body[field];
    if (field.endsWith('_id')) {
      if (value != null && value !== '' && !UUID.test(value)) throw fail(400, 'Invalid referral record reference.');
      result[field] = value ? value.toLowerCase() : null;
    } else {
      const defaults = { referral_type:'specialist', priority:'routine', destination_type:'internal' };
      if (value == null || value === '') value = defaults[field] || null;
      if (value != null && typeof value !== 'string') throw fail(400, 'Invalid referral details.');
      result[field] = value?.trim() || defaults[field] || null;
      const max = field === 'reason' ? 6000 : field === 'clinical_notes' ? 10000 : 255;
      if (result[field]?.length > max) throw fail(400, 'Referral details exceed the allowed length.');
    }
  }
  if (!result.patient_user_id || !result.reason || !['routine','urgent','emergency'].includes(result.priority)) throw fail(400, 'A patient, referral reason and valid priority are required.');
  return result;
}
async function authorize(client, req, input, mode) {
  const id = userIdOf(req.user);
  if (!UUID.test(id || '')) throw fail(401, 'Authentication required.');
  const { rows } = await client.query('SELECT id, role, is_active, market_scope, provider_status FROM users WHERE id=ANY($1::uuid[]) ORDER BY id FOR SHARE', [[...new Set([id,input.patient_user_id])].sort()]);
  const actor = rows.find(row => row.id === id);
  const patient = rows.find(row => row.id === input.patient_user_id);
  if (!actor?.is_active || actor.market_scope !== 'NG' || !patient?.is_active || patient.market_scope !== 'NG' || patient.role !== 'patient') throw fail(403, 'Active Nigeria clinical accounts are required.');
  if (!clinicians.has(actor.role) && !admins.has(actor.role)) throw fail(403, 'Clinical record access denied.');
  if (canonicalRole(req.user.role || req.user.ng_role) !== actor.role) throw fail(403, 'Please refresh your authenticated session.');
  let providerId = null;
  if (clinicians.has(actor.role)) {
    const mapping = (await client.query('SELECT id,status FROM ng_providers WHERE user_id=$1 ORDER BY id FOR SHARE', [id])).rows[0];
    providerId = mapping?.id;
    if (actor.provider_status !== 'approved' || mapping?.status !== 'verified') throw fail(403, 'A currently approved Nigeria clinician is required.');
  }
  if (input.encounter_id) {
    const encounter = (await client.query('SELECT id,patient_user_id,provider_user_id FROM ng_clinical_encounters WHERE id=$1 FOR SHARE', [input.encounter_id])).rows[0];
    if (!encounter || encounter.patient_user_id !== input.patient_user_id || (!admins.has(actor.role) && encounter.provider_user_id !== id)) throw fail(403, 'The encounter does not match this clinical referral.');
  }
  await assertClinicalAccess(req, { pool:client, patientUserId:input.patient_user_id, encounterId:input.encounter_id, mode });
  if (providerId) {
    // Preserve the existing relationship alternatives, while retaining the
    // selected authority row until commit so revocation cannot race the write.
    let relation = (await client.query('SELECT id FROM ng_appointments WHERE patient_user_id=$1 AND provider_id=$2 ORDER BY id LIMIT 1 FOR SHARE',[input.patient_user_id,providerId])).rows[0];
    if (!relation) relation = (await client.query('SELECT id FROM ng_clinical_encounters WHERE patient_user_id=$1 AND provider_user_id=$2 ORDER BY id LIMIT 1 FOR SHARE',[input.patient_user_id,id])).rows[0];
    if (!relation) relation = (await client.query('SELECT id FROM provider_patient_relationships WHERE patient_id=$1 AND provider_id=$2 AND is_active=TRUE ORDER BY id LIMIT 1 FOR SHARE',[input.patient_user_id,id])).rows[0];
    if (!relation) throw fail(403,'Clinical record access denied.');
  }
  return id;
}
async function transaction(pool, work) {
  const client = await pool.connect();
  try { await client.query('BEGIN'); const value = await work(client); await client.query('COMMIT'); return value; }
  catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
  finally { client.release(); }
}
async function save(pool, req) {
  let key, input;
  try { key = requestKey(req.get?.('Idempotency-Key') || req.headers?.['idempotency-key']); input = canonicalInput(req.body); }
  catch (error) { if (error.statusCode === 400) error.submissionNotStarted = true; throw error; }
  return transaction(pool, async client => {
    const actorId = await authorize(client,req,input,'write');
    const columns = fields.join(',');
    // The canonical create columns are never changed by status transitions. A
    // conflicting request cannot reset a completed record or create another row.
    const same = fields.map(field => `ng_referrals.${field} IS NOT DISTINCT FROM EXCLUDED.${field}`).join(' AND ');
    const row = (await client.query(`INSERT INTO ng_referrals (${columns},provider_user_id,manual_request_key,status)
      VALUES (${fields.map((_,i)=>'$'+(i+1)).join(',')},$11,$12,'draft')
      ON CONFLICT (provider_user_id,manual_request_key) WHERE manual_request_key IS NOT NULL
      DO UPDATE SET manual_request_key=EXCLUDED.manual_request_key WHERE ${same}
      RETURNING id,status`, [...fields.map(field=>input[field]),actorId,key])).rows[0];
    if (!row) throw fail(409,'This referral reference was already used for different details.');
    await writeIntegrityAudit(client,{actorUserId:actorId,action:'submit',resourceType:'manual_referral_request',resourceId:row.id,request:req,metadata:{requestId:key}});
    return row;
  });
}
async function receipt(pool, req, reference) {
  const key = requestKey(reference), actorId = userIdOf(req.user);
  if (!UUID.test(actorId || '')) throw fail(401,'Authentication required.');
  return transaction(pool, async client => {
    // Discover only actor-owned scope, then use the same account-before-record
    // locking order as save. No clinical narrative is selected or returned.
    const scoped = (await client.query('SELECT id,patient_user_id,encounter_id FROM ng_referrals WHERE provider_user_id=$1 AND manual_request_key=$2',[actorId,key])).rows[0];
    if (!scoped) throw fail(404,'No saved referral is currently available for this reference.');
    await authorize(client,req,scoped,'read');
    const row = (await client.query('SELECT id,status FROM ng_referrals WHERE id=$1 AND provider_user_id=$2 AND manual_request_key=$3 AND patient_user_id=$4 FOR SHARE',[scoped.id,actorId,key,scoped.patient_user_id])).rows[0];
    if (!row) throw fail(404,'No saved referral is currently available for this reference.');
    await writeIntegrityAudit(client,{actorUserId:actorId,action:'view',resourceType:'manual_referral_request',resourceId:row.id,request:req,metadata:{requestId:key}});
    return row;
  });
}
module.exports = { save, receipt, canonicalInput, requestKey };
