'use strict';
const decisions = require('./adminVerificationService');
const { writeIntegrityAudit } = require('./clinical/clinicalRecordIntegrityService');
const LAB_UNAVAILABLE = 'Lab order transmission, result ingestion, specimen tracking and automatic critical-result alerts are not implemented. Existing recorded-result reads do not establish a live laboratory connection.';
function integrationMetadata(row) {
  const lab = row.integration_type === 'lab_systems';
  // Do not copy endpoints, authentication configuration, raw errors, notes or
  // arbitrary provider capability JSON into a routine status response.
  return { id:row.id, integration_type:row.integration_type,
    status:lab ? 'unavailable' : row.status,
    last_test_at:row.last_test_at || null,
    last_sync_at:lab ? null : row.last_sync_at || null,
    ...(lab ? { unavailable_reason:LAB_UNAVAILABLE } : {}) };
}
function featureMetadata(row) {
  return row.feature_key === 'ng_lab_orders' ? { ...row,status:'unavailable',unavailable_reason:LAB_UNAVAILABLE } : row;
}
async function readIntegrations(pool, req, hospitalId) {
  decisions.validateId(hospitalId);
  const actorId = req.user?.id || req.user?.userId || req.user?.sub;
  decisions.validateId(actorId);
  return decisions.withActionTransaction(pool,async client=>{
    const actor = await decisions.requireCurrentNGActor(client,actorId,false);
    const hospital = (await client.query('SELECT id,owner_user_id FROM ng_hospitals WHERE id=$1 FOR SHARE',[hospitalId])).rows[0];
    if (!hospital) throw decisions.actionError(404,'Hospital not found.');
    await decisions.requireNGRecordOwner(client,hospital.owner_user_id,'Hospital');
    if (!['admin','super_admin'].includes(actor.role) && hospital.owner_user_id !== actor.id) {
      const staff = (await client.query("SELECT id FROM ng_hospital_staff WHERE hospital_id=$1 AND user_id=$2 AND status='active' ORDER BY id LIMIT 1 FOR SHARE",[hospitalId,actor.id])).rows[0];
      if (!staff) throw decisions.actionError(404,'Hospital not found.');
    }
    const rows = (await client.query('SELECT id,integration_type,status,last_test_at,last_sync_at FROM ng_hospital_integrations WHERE hospital_id=$1 ORDER BY integration_type,id',[hospitalId])).rows;
    await writeIntegrityAudit(client,{actorUserId:actor.id,action:'view',resourceType:'hospital_integration_status',resourceId:hospitalId,request:req,metadata:{recordCount:rows.length}});
    return rows.map(integrationMetadata);
  });
}
async function updateStaff(pool, req, hospitalId, staffId) {
  decisions.validateId(hospitalId); decisions.validateId(staffId);
  const actorId=req.user?.id || req.user?.userId || req.user?.sub;
  decisions.validateId(actorId);
  return decisions.withActionTransaction(pool,async client=>{
    const actor=await decisions.requireCurrentNGActor(client,actorId,false);
    const hospital=(await client.query('SELECT id,owner_user_id FROM ng_hospitals WHERE id=$1 FOR SHARE',[hospitalId])).rows[0];
    if (!hospital) throw decisions.actionError(404,'Hospital not found.');
    await decisions.requireNGRecordOwner(client,hospital.owner_user_id,'Hospital');
    // Membership cannot grant the ability to reinstate itself or change roles.
    if (!['admin','super_admin'].includes(actor.role) && hospital.owner_user_id!==actor.id) throw decisions.actionError(404,'Hospital not found.');
    const {status,department,designation,role}=req.body || {};
    const row=(await client.query(`UPDATE ng_hospital_staff SET
      status=COALESCE($1,status),department=COALESCE($2,department),
      designation=COALESCE($3,designation),role=COALESCE($4,role)
      WHERE id=$5 AND hospital_id=$6 RETURNING id`,[status,department,designation,role,staffId,hospitalId])).rows[0];
    if (!row) throw decisions.actionError(404,'Staff record not found.');
    await writeIntegrityAudit(client,{actorUserId:actor.id,action:'modify',resourceType:'hospital_staff',resourceId:row.id,request:req,metadata:{changedFields:['status','department','designation','role'].filter(key=>req.body?.[key]!=null)}});
    return row;
  });
}
module.exports={readIntegrations,updateStaff,integrationMetadata,featureMetadata,LAB_UNAVAILABLE};
