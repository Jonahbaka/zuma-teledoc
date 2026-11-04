'use strict';

const { getPool } = require('../../../server/db');
const { assertMinor } = require('../logistics/deliveryPricing');
const compliance = require('../compliance/complianceService');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const APPROVALS = Object.freeze(['nda', 'commercialAgreement', 'dataSharing', 'catalogueRights', 'paymentArrangement', 'feeSchedule', 'operationalAcceptance']);
function fail(message, status = 422) { return Object.assign(new Error(message), { status, code: 'PHARMACY_COMMERCIAL_POLICY_REJECTED' }); }
function reference(value, label) {
  if (typeof value !== 'string' || !value.trim() || value.length > 500 || /[\u0000-\u001f]/.test(value)) throw fail(`${label} requires a recorded evidence reference.`);
  return value.trim();
}
function validateProfile(input) {
  if (!input || typeof input !== 'object' || !/^[a-z0-9][a-z0-9_-]{2,79}$/.test(input.code || '')) throw fail('Use a stable pharmacy integration code.');
  const status = input.status || 'draft';
  if (!['draft', 'testing', 'active', 'suspended'].includes(status)) throw fail('Choose a valid integration status.');
  if (input.fees?.currency && input.fees.currency !== 'NGN') throw fail('Pharmacy commercial fees must be in NGN.');
  let fees;
  try { fees = { currency: 'NGN', orderServiceMinor: assertMinor(input.fees?.orderServiceMinor ?? 0), deliverySupportMinor: assertMinor(input.fees?.deliverySupportMinor ?? 0) }; }
  catch { throw fail('Enter agreed non-negative integer kobo amounts.'); }
  const approvals = {};
  for (const field of APPROVALS) if (input.approvals?.[field]) approvals[field] = reference(input.approvals[field], field);
  if (input.approvals?.publicity) approvals.publicity = reference(input.approvals.publicity, 'Publicity permission');
  const settings = {
    mode: input.settings?.mode || 'pharmacist_portal',
    quoteValiditySeconds: input.settings?.quoteValiditySeconds ?? null,
    inventoryMaxAgeSeconds: input.settings?.inventoryMaxAgeSeconds ?? null,
    insuranceEnabled: false,
    savingsEnabled: false,
    membershipEnabled: false,
  };
  if (!['pharmacist_portal', 'restricted_file', 'approved_api'].includes(settings.mode)) throw fail('Choose the agreed integration mode.');
  for (const field of ['quoteValiditySeconds', 'inventoryMaxAgeSeconds']) {
    if (settings[field] !== null && (!Number.isInteger(settings[field]) || settings[field] < 60 || settings[field] > 86400)) throw fail('Agreed quote and stock validity must be between 60 seconds and one day.');
  }
  // These require separate benefit/redemption implementations and agreements.
  if (input.settings?.insuranceEnabled || input.settings?.savingsEnabled || input.settings?.membershipEnabled) throw fail('Insurer funding, savings redemption and memberships require separate validated activation.');
  if (status === 'active') {
    for (const field of APPROVALS) if (!approvals[field]) throw fail(`Record ${field} approval before activation.`);
    if (!settings.quoteValiditySeconds || !settings.inventoryMaxAgeSeconds) throw fail('Record the agreed pharmacy quote and stock validity periods before activation.');
    if (settings.mode !== 'pharmacist_portal') throw fail('An external catalogue adapter must be validated before API or file activation.');
  }
  return { code: input.code, displayName: reference(input.displayName, 'Integration display name'), status, fees, approvals, settings };
}
function pricingSnapshot(profile) {
  const valid = validateProfile({ code: profile.code, displayName: profile.display_name, status: profile.status, fees: profile.fees, approvals: profile.approvals, settings: profile.settings });
  if (valid.status !== 'active') throw fail('This pharmacy integration is awaiting authorized activation.', 409);
  return { profileId: profile.id, profileVersion: profile.version, code: valid.code, currency: 'NGN', orderServiceMinor: valid.fees.orderServiceMinor, deliverySupportMinor: valid.fees.deliverySupportMinor, feeScheduleReference: valid.approvals.feeSchedule, quoteValiditySeconds: valid.settings.quoteValiditySeconds, inventoryMaxAgeSeconds: valid.settings.inventoryMaxAgeSeconds, coordinationEarnedOnFulfillment: true };
}
async function forPharmacy(client, pharmacyId) {
  const result = await client.query(`SELECT p.* FROM ng_pharmacy_commercial_profiles p JOIN ng_pharmacy_commercial_branches b ON b.profile_id=p.id WHERE b.pharmacy_id=$1 FOR SHARE OF p,b`, [pharmacyId]);
  return result.rows.length ? pricingSnapshot(result.rows[0]) : null;
}
async function authorizeOrder(client, pharmacyId, snapshot) {
  if (!snapshot) return;
  const current = await forPharmacy(client, pharmacyId);
  if (!current || current.profileId !== snapshot.profileId) throw fail('This pharmacy commercial assignment requires review before proceeding.',409);
  // Accepted orders retain their original version and fee schedule. Current
  // approval is still required; suspension immediately blocks new charges.
}
async function administrator(client, actor, write = false) {
  if (!UUID.test(actor?.id || '')) throw fail('Administrator access is required.', 403);
  const user = (await client.query('SELECT id,role,is_active FROM users WHERE id=$1', [actor.id])).rows[0];
  if (!user?.is_active || !(write ? ['super_admin'] : ['admin','super_admin']).includes(user.role)) throw fail('Authorized pharmacy integration administration is required.', 403);
  return user;
}
async function list(actor) {
  const pool = getPool(); await administrator(pool, actor);
  const profiles = (await pool.query(`SELECT p.*, COALESCE((SELECT jsonb_agg(jsonb_build_object('pharmacyId',b.pharmacy_id,'pharmacyName',ph.name,'branchReference',b.partner_branch_reference,'approvalReference',b.approval_reference)) FROM ng_pharmacy_commercial_branches b JOIN ng_pharmacies ph ON ph.id=b.pharmacy_id WHERE b.profile_id=p.id),'[]'::jsonb) AS branches FROM ng_pharmacy_commercial_profiles p ORDER BY p.created_at DESC`)).rows;
  const pharmacies = (await pool.query("SELECT id,name,city,state FROM ng_pharmacies WHERE status='approved' AND verified_at IS NOT NULL AND pcn_license_expiry>=CURRENT_DATE ORDER BY name,city")).rows;
  return { profiles, pharmacies };
}
async function save(actor, input, profileId = null) {
  const valid = validateProfile(input); const client = await getPool().connect();
  try {
    await client.query('BEGIN'); const user = await administrator(client, actor, true);
    let row;
    if (profileId) {
      if (!UUID.test(profileId)) throw fail('Select a valid integration.');
      if (!Number.isSafeInteger(input.version) || input.version<1) throw fail('Supply the current integration version.');
      row = (await client.query(`UPDATE ng_pharmacy_commercial_profiles SET display_name=$1,status=$2,fees=$3,approvals=$4,settings=$5,version=version+1,updated_by=$6,updated_at=now() WHERE id=$7 AND version=$8 AND code=$9 RETURNING *`, [valid.displayName,valid.status,JSON.stringify(valid.fees),JSON.stringify(valid.approvals),JSON.stringify(valid.settings),user.id,profileId,input.version,valid.code])).rows[0];
      if (!row) throw fail('The integration changed. Refresh before saving.', 409);
    } else row = (await client.query(`INSERT INTO ng_pharmacy_commercial_profiles(code,display_name,status,fees,approvals,settings,created_by,updated_by) VALUES($1,$2,$3,$4,$5,$6,$7,$7) RETURNING *`, [valid.code,valid.displayName,valid.status,JSON.stringify(valid.fees),JSON.stringify(valid.approvals),JSON.stringify(valid.settings),user.id])).rows[0];
    await compliance.logAction({ actorUserId:user.id,actorType:user.role,action:'pharmacy_commercial_profile_saved',resourceType:'pharmacy_commercial_profile',resourceId:row.id,details:{status:row.status,version:row.version,approvalTypes:Object.keys(valid.approvals)} },client);
    await client.query('COMMIT'); return { profile: row };
  } catch (error) { await client.query('ROLLBACK'); if (error.code === '23505') throw fail('This integration code already exists.',409); throw error; } finally { client.release(); }
}
async function bindBranch(actor, profileId, input) {
  if (!UUID.test(profileId || '') || !UUID.test(input.pharmacyId || '')) throw fail('Select a recorded integration and pharmacy.');
  const branch = reference(input.branchReference,'Partner branch'); const approval = reference(input.approvalReference,'Branch authorization');
  const client = await getPool().connect();
  try {
    await client.query('BEGIN'); const user = await administrator(client,actor,true);
    const profile = (await client.query('SELECT * FROM ng_pharmacy_commercial_profiles WHERE id=$1 FOR UPDATE',[profileId])).rows[0];
    const pharmacy = (await client.query("SELECT id FROM ng_pharmacies WHERE id=$1 AND status='approved' AND verified_at IS NOT NULL AND pcn_license_expiry>=CURRENT_DATE FOR UPDATE",[input.pharmacyId])).rows[0];
    if (!profile || !pharmacy) throw fail('A recorded integration and currently approved pharmacy are required.',409);
    pricingSnapshot(profile);
    const row = (await client.query(`INSERT INTO ng_pharmacy_commercial_branches(pharmacy_id,profile_id,partner_branch_reference,approval_reference,approved_by) VALUES($1,$2,$3,$4,$5) ON CONFLICT(pharmacy_id) DO NOTHING RETURNING *`,[pharmacy.id,profileId,branch,approval,user.id])).rows[0];
    if (!row) throw fail('This pharmacy already has a commercial profile; preserve existing orders and review the assignment.',409);
    await compliance.logAction({actorUserId:user.id,actorType:user.role,action:'pharmacy_commercial_branch_bound',resourceType:'pharmacy',resourceId:pharmacy.id,pharmacyId:pharmacy.id,details:{profileId,branchReference:branch}},client);
    await client.query('COMMIT'); return { branch: row };
  } catch(error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
}
module.exports = { validateProfile, pricingSnapshot, forPharmacy, authorizeOrder, list, save, bindBranch, APPROVALS };
