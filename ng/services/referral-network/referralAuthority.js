'use strict';

const providers = new Set(['provider', 'doctor', 'consultant', 'physician', 'specialist']);
const agents = new Set(['agent', 'referral_agent', 'referral_coordinator']);
const admins = new Set(['admin', 'super_admin']);
const fail = (message) => { throw Object.assign(new Error(message), { code: 'FORBIDDEN' }); };
function ngAccount(user) {
  const market = String(user?.market_scope || '').toUpperCase();
  return user?.is_active === true && (market ? market === 'NG' : ['NG', 'NIGERIA'].includes(String(user.country || '').toUpperCase()));
}

// Lock accounts in deterministic order before mappings and referral rows. Actor
// role is always read from the database, never from a bearer-token snapshot.
async function actorScope(client, actor, patientId = null, destinationUserId = null) {
  if (!actor?.user_id) fail('A current authenticated referral actor is required');
  const ids = [...new Set([actor.user_id, patientId, destinationUserId].filter(Boolean))].sort();
  const users = (await client.query('SELECT id, role, is_active, market_scope, country, provider_status, first_name, last_name, phone, date_of_birth FROM users WHERE id = ANY($1::uuid[]) ORDER BY id FOR SHARE', [ids])).rows;
  const user = users.find(row => row.id === actor.user_id);
  if (!ngAccount(user)) fail('An active Nigeria account is required');
  if (patientId && (!ngAccount(users.find(row => row.id === patientId)) || users.find(row => row.id === patientId)?.role !== 'patient')) fail('An active Nigeria patient account is required');
  if (destinationUserId && (!ngAccount(users.find(row => row.id === destinationUserId)) || !providers.has(users.find(row => row.id === destinationUserId)?.role) || users.find(row => row.id === destinationUserId)?.provider_status !== 'approved')) fail('An active destination clinician account is required');
  const scope = { destinationUserId, userId: user.id, role: user.role, kind: user.role === 'patient' ? 'patient' : 'facility' };
  if (providers.has(user.role)) {
    if (user.provider_status !== 'approved') fail('Current global provider approval is required');
    const row = (await client.query('SELECT id, user_id, status FROM ng_providers WHERE user_id=$1 ORDER BY id FOR SHARE', [user.id])).rows[0];
    if (!row || row.status !== 'verified') fail('A verified provider mapping is required');
    scope.providerId = row.id; scope.kind = 'provider';
  } else if (agents.has(user.role)) {
    const row = (await client.query('SELECT id, user_id, status FROM drn_agents WHERE user_id=$1 ORDER BY id FOR SHARE', [user.id])).rows[0];
    if (!row || row.status !== 'active') fail('An active referral agent mapping is required');
    scope.agentId = row.id; scope.kind = 'agent';
  } else if (user.role !== 'patient' && !admins.has(user.role)) fail('Referral actor role is not supported');
  scope.patientRecord = users.find(row => row.id === (patientId || (user.role === 'patient' ? user.id : null))) || null;
  scope.admin = admins.has(user.role);
  return scope;
}

async function creationInput(client, supplied, scope) {
  if (typeof supplied.specialty !== 'string' || typeof supplied.reason !== 'string' || supplied.specialty.length > 100 || supplied.reason.length > 4000 || (supplied.service_kind != null && typeof supplied.service_kind !== 'string')) fail('Bounded specialty, service kind and referral reason are required');
  supplied = { ...supplied, specialty: supplied.specialty.trim().toLowerCase(), service_kind: supplied.service_kind?.trim().toLowerCase() || null };
  if (supplied.attached_soap_id || (supplied.attached_files_json != null && (!Array.isArray(supplied.attached_files_json) || supplied.attached_files_json.length))) {
    fail('Clinical attachments require a verified attachment-sharing workflow');
  }
  let patientId = supplied.patient_user_id || null;
  if (scope.role === 'patient') {
    if (patientId && patientId !== scope.userId) fail('Patient identity does not match the actor');
    patientId = scope.userId;
  } else if (patientId) {
    if (!scope.providerId) fail('Linked patient referrals require a treating provider');
    const link = (await client.query('SELECT id FROM provider_patient_relationships WHERE provider_id=$1 AND patient_id=$2 AND is_active=true ORDER BY id LIMIT 1 FOR SHARE', [scope.userId, patientId])).rows[0];
    if (!link) fail('An active patient care relationship is required');
  }
  const input = { ...supplied, patient_user_id: patientId, originating_provider: scope.providerId || null,
    originating_agent: scope.agentId || null, originating_org: null, attached_soap_id: null, attached_files_json: [],
    destination_org: null, destination_provider: null, service_fee_naira: null, match_score: null, match_reasoning_json: {} };
  if (patientId) {
    const patient = scope.patientRecord;
    if (!patient || patient.id !== patientId) fail('Linked patient identity is unavailable');
    const name = [patient.first_name, patient.last_name].filter(Boolean).join(' ').trim();
    const birth = patient.date_of_birth ? new Date(patient.date_of_birth) : null;
    const now = new Date();
    let age = null;
    if (birth && Number.isFinite(birth.getTime()) && birth <= now) {
      age = now.getUTCFullYear() - birth.getUTCFullYear();
      if (now.getUTCMonth() < birth.getUTCMonth() || (now.getUTCMonth() === birth.getUTCMonth() && now.getUTCDate() < birth.getUTCDate())) age--;
    }
    // A linked clinical ID must not be paired with client-forged demographics.
    // Gender is not silently reinterpreted as clinical sex.
    Object.assign(input, { patient_name: name || null, patient_phone: patient.phone || null,
      patient_age: age, patient_sex: null });
  }
  if (supplied.destination_listing) {
    const listing = (await client.query(`SELECT l.*, o.active AS organization_active FROM drn_marketplace_listings l
      JOIN drn_organizations o ON o.id=l.organization_id WHERE l.id=$1 FOR SHARE OF l,o`, [supplied.destination_listing])).rows[0];
    if (!listing?.active || !listing.organization_active) fail('An active destination listing and organization are required');
    listing.specialty = String(listing.specialty || '').trim().toLowerCase();
    listing.service_kind = String(listing.service_kind || '').trim().toLowerCase();
    if (!listing.specialty || !listing.service_kind) fail('The destination listing is incomplete');
    if ((supplied.destination_org && supplied.destination_org !== listing.organization_id) ||
        (supplied.destination_provider && supplied.destination_provider !== listing.provider_id) ||
        (supplied.specialty && supplied.specialty !== listing.specialty) ||
        (supplied.service_kind && supplied.service_kind !== listing.service_kind)) fail('Destination does not match the selected listing');
    if (listing.provider_id) {
      const provider = (await client.query('SELECT id, user_id, status FROM ng_providers WHERE id=$1 FOR SHARE', [listing.provider_id])).rows[0];
      if (!provider || provider.status !== 'verified' || provider.user_id !== scope.destinationUserId) fail('A verified destination provider is required');
    }
    Object.assign(input, { destination_org: listing.organization_id, destination_provider: listing.provider_id,
      specialty: listing.specialty, service_kind: listing.service_kind,
      service_fee_naira: listing.price_max_naira ?? listing.price_min_naira ?? null });
  } else if (supplied.destination_org || supplied.destination_provider) fail('Select a verified destination listing');
  if (process.env.NG_MEDICAL_IMAGING_AUTHORIZED !== 'true' &&
      (input.service_kind === 'imaging' || input.specialty === 'imaging' || String(input.specialty).startsWith('imaging_'))) fail('Medical imaging is not authorized in the Nigeria portal');
  if (!String(input.specialty || '').trim() || !String(input.reason || '').trim()) fail('Specialty and referral reason are required');
  return input;
}

function assertTransition(scope, referral, toStatus) {
  const origin = (scope.role === 'patient' && referral.patient_user_id === scope.userId) ||
    (scope.providerId && referral.originating_provider === scope.providerId) ||
    (scope.agentId && referral.originating_agent === scope.agentId);
  const receiver = scope.providerId && referral.destination_provider === scope.providerId;
  const early = ['draft', 'sent', 'received'].includes(referral.status);
  if (scope.admin && ['cancelled', 'expired'].includes(toStatus)) return;
  if (origin && ((toStatus === 'sent' && referral.status === 'draft') || (toStatus === 'cancelled' && early))) return;
  if (receiver && ['received', 'accepted', 'declined', 'scheduled', 'in_progress', 'completed', 'no_show', 'cancelled'].includes(toStatus)) return;
  fail('This transition requires the verified destination provider or an authorized originating actor');
}
module.exports = { actorScope, creationInput, assertTransition };
