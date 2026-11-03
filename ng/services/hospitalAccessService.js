'use strict';

const decisions = require('./adminVerificationService');

function actorIdFrom(req) {
  const id = req.user?.id || req.user?.userId || req.user?.sub;
  decisions.validateId(id);
  return id;
}

// Keep the actor, hospital owner and membership locked until the operation and
// its audit commit. Request roles, market headers and browser hospital IDs are
// routing hints, never authority.
async function requireHospitalAccess(client, req, hospitalId, { manage = false } = {}) {
  decisions.validateId(hospitalId);
  const actor = await decisions.requireCurrentNGActor(client, actorIdFrom(req), false);
  const hospital = (await client.query(
    'SELECT id,owner_user_id FROM ng_hospitals WHERE id=$1 FOR SHARE', [hospitalId]
  )).rows[0];
  if (!hospital) throw decisions.actionError(404, 'Hospital not found.');
  await decisions.requireNGRecordOwner(client, hospital.owner_user_id, 'Hospital');
  const canManage = ['admin', 'super_admin'].includes(actor.role) || hospital.owner_user_id === actor.id;
  if (!canManage) {
    if (manage) throw decisions.actionError(404, 'Hospital not found.');
    const member = (await client.query(
      "SELECT id FROM ng_hospital_staff WHERE hospital_id=$1 AND user_id=$2 AND status='active' ORDER BY id LIMIT 1 FOR SHARE",
      [hospitalId, actor.id]
    )).rows[0];
    if (!member) throw decisions.actionError(404, 'Hospital not found.');
  }
  return { actor, hospital, canManage };
}

module.exports = { actorIdFrom, requireHospitalAccess };
