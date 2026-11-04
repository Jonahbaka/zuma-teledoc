'use strict';

const crypto = require('crypto');
const net = require('net');
const { z } = require('zod');
const { ALGORITHM, IV_LENGTH, TAG_LENGTH } = require('../../lib/encryption');

const uuid = /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i;
const field = (maximum, minimum = 0) => z.string().trim().min(minimum).max(maximum)
  .refine((value) => !/[\u0000-\u001f\u007f]/.test(value));
const manualInput = z.object({
  payerName: field(255, 2), memberId: field(100, 1),
  groupNumber: field(100).optional().default(''), planName: field(255).optional().default(''),
}).strict();

function failure(status, code, message) { return Object.assign(new Error(message), { status, statusCode: status, code }); }
function encryptionKey() {
  const configured = process.env.ENCRYPTION_KEY;
  if (typeof configured !== 'string' || !configured.trim() || Buffer.byteLength(configured) < 32) {
    throw failure(503, 'INSURANCE_ENCRYPTION_UNAVAILABLE', 'Secure insurance storage is unavailable. Try again later.');
  }
  return /^[a-f\d]{64}$/i.test(configured) ? Buffer.from(configured, 'hex') : crypto.createHash('sha256').update(configured).digest();
}
function market(value) {
  const normalized = String(value || '').trim().toUpperCase();
  if (['US', 'USA', 'UNITED STATES', 'UNITED STATES OF AMERICA'].includes(normalized)) return 'US';
  if (['NG', 'NIGERIA'].includes(normalized)) return 'NG';
  return null;
}
function validateInput(input) {
  const parsed = manualInput.safeParse(input);
  if (!parsed.success) throw failure(400, 'INSURANCE_DETAILS_INVALID', 'Enter valid insurance details within the field limits.');
  return parsed.data;
}
function encryptionContext(userId, submissionKey) {
  if (!uuid.test(String(userId || '')) || !uuid.test(String(submissionKey || ''))) throw new Error('Invalid encryption context');
  return 'doctarx.manual-insurance.v1:' + String(userId).toLowerCase() + ':' + String(submissionKey).toLowerCase();
}
function encryptIdentity(identity, key, userId, submissionKey) {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const aad = encryptionContext(userId, submissionKey);
  cipher.setAAD(Buffer.from(aad, 'utf8'));
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(identity), 'utf8'), cipher.final()]).toString('base64');
  return { encrypted, iv: iv.toString('hex'), tag: cipher.getAuthTag().toString('hex'), algorithm: ALGORITHM, version: 1, aad };
}
function decryptIdentity(envelope, { userId, submissionKey } = {}) {
  try {
    const key = encryptionKey();
    const data = typeof envelope === 'string' ? JSON.parse(envelope) : envelope;
    const aad = encryptionContext(userId, submissionKey);
    if (!data || data.aad !== aad || data.algorithm !== ALGORITHM || data.version !== 1 || typeof data.encrypted !== 'string'
      || !data.encrypted || !/^[a-f\d]{24}$/i.test(data.iv) || !/^[a-f\d]{32}$/i.test(data.tag)) throw new Error();
    const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(data.iv, 'hex'));
    const tag = Buffer.from(data.tag, 'hex');
    if (tag.length !== TAG_LENGTH) throw new Error();
    decipher.setAuthTag(tag);
    decipher.setAAD(Buffer.from(aad, 'utf8'));
    const plaintext = Buffer.concat([decipher.update(data.encrypted, 'base64'), decipher.final()]).toString('utf8');
    return validateInput(JSON.parse(plaintext));
  } catch {
    throw failure(503, 'INSURANCE_IDENTITY_UNAVAILABLE', 'Stored insurance details could not be read securely. Try again later.');
  }
}
function mask(value) {
  if (!value) return null;
  return value.length > 4 ? '••••' + value.slice(-4) : '••••';
}

function presentInsurance(record, { revealMemberId = false } = {}) {
  const identity = record.manual_identity_encrypted ? decryptIdentity(record.manual_identity_encrypted, { userId: record.user_id, submissionKey: record.manual_submission_key }) : {
    payerName: record.insurance_provider || null, memberId: record.member_id || null,
    groupNumber: record.group_number || null, planName: record.plan_name || null,
  };
  const memberId = revealMemberId ? identity.memberId : mask(identity.memberId);
  const groupNumber = revealMemberId ? identity.groupNumber : mask(identity.groupNumber);
  const eligibilityStatus = ['active', 'inactive', 'pending', 'expired', 'unknown'].includes(record.eligibility_status) ? record.eligibility_status : 'unknown';
  return {
    id: record.id, user_id: record.user_id, patient_id: record.user_id,
    payerName: identity.payerName, memberId, groupNumber, planName: identity.planName || null,
    insurance_provider: identity.payerName, member_id: memberId, policy_number: memberId, policyNumber: memberId,
    group_number: groupNumber, plan_name: identity.planName || null,
    is_primary: record.is_primary === true, is_verified: record.is_verified === true,
    eligibility_status: eligibilityStatus, eligibilityStatus,
    eligibility_last_checked: record.eligibility_last_checked || null, verified_at: record.verified_at || null,
    effective_date: record.effective_date || null, termination_date: record.termination_date || null,
    expiration_date: record.termination_date || null,
    ocr_provider: record.ocr_provider || null, ocr_confidence_score: record.ocr_confidence_score ?? null,
    verificationSource: record.manual_identity_encrypted ? 'patient_entry' : record.eligibility_response?.verificationSource || 'unavailable',
    created_at: record.created_at, updated_at: record.updated_at,
  };
}

async function saveManualInsurance(pool, req, input) {
  if (req.user?.role !== 'patient') throw failure(403, 'INSURANCE_PATIENT_REQUIRED', 'Only patients can add their insurance details.');
  const identity = validateInput(input);
  const submissionKey = String(req.headers?.['idempotency-key'] || '').toLowerCase();
  if (!uuid.test(String(req.user.id || '')) || !uuid.test(String(submissionKey || ''))) throw failure(400, 'INSURANCE_RETRY_REFERENCE_INVALID', 'A valid insurance retry reference is required.');
  const expectedMarket = market(req.user.marketScope || req.user.region || req.user.country);
  if (!expectedMarket) throw failure(403, 'INSURANCE_CONTEXT_INVALID', 'Insurance account access could not be confirmed.');
  const key = encryptionKey();
  const digest = crypto.createHmac('sha256', key).update('doctarx.manual-insurance.v1\0' + req.user.id + '\0' + JSON.stringify(identity)).digest('hex');
  const encrypted = encryptIdentity(identity, key, req.user.id, submissionKey);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const actor = await client.query(
      "SELECT id,market_scope,region,country FROM users WHERE id=$1 AND role='patient' AND is_active=TRUE FOR SHARE", [req.user.id]
    );
    const fresh = actor.rows[0];
    if (!fresh || market(fresh.market_scope || fresh.region || fresh.country) !== expectedMarket) throw failure(403, 'INSURANCE_CONTEXT_INVALID', 'Insurance account access could not be confirmed.');
    const inserted = await client.query(
      `INSERT INTO patient_insurance (user_id,insurance_provider,member_id,group_number,plan_name,
         manual_identity_encrypted,manual_submission_key,manual_submission_digest,ocr_provider,
         is_primary,is_active,is_verified,eligibility_status)
       VALUES ($1,NULL,NULL,NULL,NULL,$2::jsonb,$3,$4,'manual',FALSE,TRUE,FALSE,'pending')
       ON CONFLICT (user_id,manual_submission_key) WHERE manual_submission_key IS NOT NULL DO NOTHING
       RETURNING *`, [req.user.id, JSON.stringify(encrypted), submissionKey, digest]
    );
    let record = inserted.rows[0];
    const created = Boolean(record);
    if (!record) {
      const existing = await client.query('SELECT * FROM patient_insurance WHERE user_id=$1 AND manual_submission_key=$2 FOR SHARE', [req.user.id, submissionKey]);
      record = existing.rows[0];
      if (!record || record.manual_submission_digest !== digest) throw failure(409, 'INSURANCE_RETRY_CONTENT_MISMATCH', 'This retry reference was used for different insurance details. Start a new submission.');
    }
    const insurance = presentInsurance(record);
    const ipAddress = net.isIP(String(req.ip || '')) ? req.ip : null;
    await client.query(
      `INSERT INTO audit_logs (user_id,action,resource_type,resource_id,patient_id,description,
         phi_accessed,success,ip_address,user_agent,new_values)
       VALUES ($1,$2,'insurance',$3,$1,$4,TRUE,TRUE,$5,$6,$7::jsonb)`,
      [req.user.id, created ? 'create' : 'read', record.id,
        created ? 'Patient entered insurance details; coverage unverified' : 'Patient retried manual insurance entry',
        ipAddress, String(req.get?.('user-agent') || '').slice(0, 512) || null,
        JSON.stringify({ entryMethod: 'manual', verified: insurance.is_verified, eligibilityStatus: insurance.eligibility_status })]
    );
    await client.query('COMMIT');
    return { insurance, created };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}

module.exports = { validateInput, decryptIdentity, presentInsurance, saveManualInsurance };
