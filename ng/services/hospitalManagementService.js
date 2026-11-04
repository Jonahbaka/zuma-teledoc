'use strict';

const { z } = require('zod');
const { v4: uuidv4 } = require('uuid');
const decisions = require('./adminVerificationService');
const { actorIdFrom, requireHospitalAccess } = require('./hospitalAccessService');
const { writeIntegrityAudit } = require('./clinical/clinicalRecordIntegrityService');

const requiredText = max => z.string().trim().min(1).max(max);
const optionalText = max => z.string().trim().max(max).nullish().transform(value => value || null);
const email = z.string().trim().email().max(255);
const optionalEmail = z.union([email, z.literal(''), z.null()]).optional().transform(value => value || null);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
});
const registrationSchema = z.object({
  name: requiredText(255), facility_type: requiredText(50),
  contact_name: requiredText(255), contact_email: email, contact_phone: requiredText(20), contact_title: optionalText(100),
  address_line1: requiredText(255), address_line2: optionalText(255), city: requiredText(100), state: requiredText(50), lga: optionalText(100),
  phone: optionalText(20), email: optionalEmail, website: optionalText(255),
  nhis_code: optionalText(50), cac_number: optionalText(50), facility_license_number: optionalText(50),
  license_expiry: z.union([date, z.literal(''), z.null()]).optional().transform(value => value || null),
  departments: z.array(requiredText(100)).max(100).optional().default([]),
  bed_count: z.number().int().min(0).max(1000000).nullish().transform(value => value ?? null),
  has_pharmacy: z.boolean().optional().default(false), has_lab: z.boolean().optional().default(false), description: optionalText(10000),
});
const staffSchema = z.object({
  full_name: requiredText(255), email: optionalEmail, phone: optionalText(20),
  role: z.enum(['doctor', 'nurse', 'pharmacist', 'lab_technician', 'receptionist', 'admin', 'other']),
  department: optionalText(100), designation: optionalText(100), mdcn_or_license: optionalText(50),
});
const HOSPITAL_FIELDS = `h.id,h.name,h.slug,h.facility_type,h.status,
  h.contact_name,h.contact_email,h.contact_phone,h.contact_title,
  h.address_line1,h.address_line2,h.city,h.state,h.lga,h.phone,h.email,h.website,
  h.nhis_code,h.cac_number,h.facility_license_number,h.license_expiry,
  h.departments,h.bed_count,h.has_pharmacy,h.has_lab,h.description,h.logo_url,
  h.verified_at,h.created_at,h.updated_at`;
const STAFF_FIELDS = 'id,full_name,email,phone,role,department,designation,mdcn_or_license,status,joined_at,created_at';

function validated(schema, body) {
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw decisions.actionError(400, 'Please provide valid hospital or staff details.');
  return parsed.data;
}

async function registerHospital(pool, req) {
  // A public application cannot assign a different account as its owner. Even
  // signed-in callers must use their server-verified current identity.
  if (['user_id', 'owner_user_id', 'userId', 'ownerUserId'].some(key => Object.prototype.hasOwnProperty.call(req.body || {}, key))) {
    throw decisions.actionError(400, 'Hospital ownership is determined by the signed-in account.');
  }
  const data = validated(registrationSchema, req.body);
  return decisions.withActionTransaction(pool, async client => {
    const actor = req.user ? await decisions.requireCurrentNGActor(client, actorIdFrom(req), false) : null;
    const slug = `${data.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 240) || 'hospital'}-${uuidv4().split('-')[0]}`;
    const result = await client.query(`INSERT INTO ng_hospitals (
      name,slug,facility_type,contact_name,contact_email,contact_phone,contact_title,
      address_line1,address_line2,city,state,lga,phone,email,website,
      nhis_code,cac_number,facility_license_number,license_expiry,
      departments,bed_count,has_pharmacy,has_lab,description,owner_user_id,status
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,'pending_review')
      RETURNING id,slug,status`, [
      data.name,slug,data.facility_type,data.contact_name,data.contact_email,data.contact_phone,data.contact_title,
      data.address_line1,data.address_line2,data.city,data.state,data.lga,data.phone,data.email,data.website,
      data.nhis_code,data.cac_number,data.facility_license_number,data.license_expiry,
      JSON.stringify(data.departments),data.bed_count,data.has_pharmacy,data.has_lab,data.description,actor?.id || null,
    ]);
    const hospital = result.rows[0];
    await writeIntegrityAudit(client, { actorUserId: actor?.id || null, action: 'submit', resourceType: 'hospital_registration',
      resourceId: hospital.id, request: req, metadata: { authenticated: Boolean(actor), status: hospital.status } });
    return { hospital, ownerLinked: Boolean(actor) };
  });
}

async function readHospital(pool, req, hospitalId) {
  decisions.validateId(hospitalId); actorIdFrom(req);
  return decisions.withActionTransaction(pool, async client => {
    const { actor, canManage } = await requireHospitalAccess(client, req, hospitalId);
    const hospital = (await client.query(`SELECT ${HOSPITAL_FIELDS},
      (SELECT COUNT(*)::integer FROM ng_hospital_staff s WHERE s.hospital_id=h.id) AS staff_count
      FROM ng_hospitals h WHERE h.id=$1`, [hospitalId])).rows[0];
    if (!hospital) throw decisions.actionError(404, 'Hospital not found.');
    await writeIntegrityAudit(client, { actorUserId: actor.id, action: 'view', resourceType: 'hospital_profile',
      resourceId: hospitalId, request: req });
    return { hospital, can_manage_staff: canManage };
  });
}

async function readStaff(pool, req, hospitalId) {
  decisions.validateId(hospitalId); actorIdFrom(req);
  return decisions.withActionTransaction(pool, async client => {
    const { actor, canManage } = await requireHospitalAccess(client, req, hospitalId);
    const staff = (await client.query(`SELECT ${STAFF_FIELDS} FROM ng_hospital_staff
      WHERE hospital_id=$1 ORDER BY role,full_name,id`, [hospitalId])).rows;
    await writeIntegrityAudit(client, { actorUserId: actor.id, action: 'view', resourceType: 'hospital_staff_list',
      resourceId: hospitalId, request: req, metadata: { recordCount: staff.length } });
    return { staff, can_manage_staff: canManage };
  });
}

async function createStaff(pool, req, hospitalId) {
  decisions.validateId(hospitalId); actorIdFrom(req);
  const data = validated(staffSchema, req.body);
  return decisions.withActionTransaction(pool, async client => {
    const { actor } = await requireHospitalAccess(client, req, hospitalId, { manage: true });
    // A roster entry is not an account invitation or a grant of membership.
    // Client-supplied user_id/provider_id/status never create linked authority.
    const staff = (await client.query(`INSERT INTO ng_hospital_staff
      (hospital_id,full_name,email,phone,role,department,designation,mdcn_or_license)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING ${STAFF_FIELDS}`,
    [hospitalId,data.full_name,data.email,data.phone,data.role,data.department,data.designation,data.mdcn_or_license])).rows[0];
    await writeIntegrityAudit(client, { actorUserId: actor.id, action: 'modify', resourceType: 'hospital_staff',
      resourceId: staff.id, request: req, metadata: { operation: 'create', hospitalId } });
    return staff;
  });
}

async function listHospitals(pool, req) {
  const query = req.query || {};
  const parsed = z.object({
    status: z.enum(['pending_review', 'documents_submitted', 'verified', 'active', 'suspended', 'rejected']).optional(),
    state: requiredText(50).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional().default(50),
    offset: z.coerce.number().int().min(0).max(1000000).optional().default(0),
  }).safeParse(query);
  if (!parsed.success) throw decisions.actionError(400, 'Please provide valid hospital list filters.');
  const { status, state, limit, offset } = parsed.data;
  return decisions.withActionTransaction(pool, async client => {
    const actor = await decisions.requireCurrentNGActor(client, actorIdFrom(req));
    const where = ["(h.owner_user_id IS NULL OR EXISTS (SELECT 1 FROM users u WHERE u.id=h.owner_user_id AND u.market_scope='NG'))"];
    const params = [];
    if (status) { params.push(status); where.push(`h.status=$${params.length}`); }
    if (state) { params.push(state); where.push(`h.state=$${params.length}`); }
    const scope = where.join(' AND ');
    const hospitals = (await client.query(`SELECT ${HOSPITAL_FIELDS} FROM ng_hospitals h WHERE ${scope}
      ORDER BY h.created_at DESC,h.id LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, limit, offset])).rows;
    const total = Number((await client.query(`SELECT COUNT(*) FROM ng_hospitals h WHERE ${scope}`, params)).rows[0].count);
    await writeIntegrityAudit(client, { actorUserId: actor.id, action: 'view', resourceType: 'hospital_admin_list',
      resourceId: null, request: req, metadata: { recordCount: hospitals.length } });
    return { hospitals, total };
  });
}

module.exports = { registerHospital, readHospital, readStaff, createStaff, listHospitals };
