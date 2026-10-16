'use strict';

const sharp = require('sharp');
const crypto = require('crypto');
const { encrypt, decrypt } = require('../../../lib/encryption');
const { assertClinicalAccess } = require('../clinical/clinicalAccessService');
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

function fail(status, message) { return Object.assign(new Error(message), { status }); }
async function normalizeImage(file) {
  if (!file?.buffer?.length || file.buffer.length > MAX_IMAGE_BYTES) throw fail(400, 'Choose a JPEG or PNG image up to 5 MB.');
  if (!['image/jpeg', 'image/png'].includes(file.mimetype)) throw fail(400, 'Only JPEG and PNG images are accepted.');
  const signature = file.buffer;
  const png = signature.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
  const jpeg = signature[0] === 255 && signature[1] === 216 && signature[2] === 255;
  if ((!png && !jpeg) || (png && file.mimetype !== 'image/png') || (jpeg && file.mimetype !== 'image/jpeg')) throw fail(400, 'The image format does not match the selected file.');
  try {
    const clean = await sharp(signature, { limitInputPixels: 25000000, failOn: 'warning' }).rotate().resize({ width: 2800, height: 2800, fit: 'inside', withoutEnlargement: true }).png().toBuffer();
    if (clean.length > MAX_IMAGE_BYTES) throw new Error();
    return clean;
  } catch { throw fail(400, 'This image could not be read. Choose a clear JPEG or PNG image up to 5 MB.'); }
}

async function requirePatient(client, userId) {
  const { rows } = await client.query("SELECT id FROM users WHERE id=$1 AND role='patient' AND market_scope='NG' AND is_active=true", [userId]);
  if (!rows.length) throw fail(403, 'Patient access is required.');
}

async function saveSubmission(pool, req, { image, text }) {
  // Never use the encryption helper's development fallback for patient uploads.
  if (!process.env.ENCRYPTION_KEY) throw fail(503, 'Prescription submission is temporarily unavailable.');
  const key = req.get?.('Idempotency-Key') || req.headers?.['idempotency-key'];
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(key || '')) throw fail(400, 'A valid submission reference is required.');
  const normalized = image ? await normalizeImage(image) : null;
  const content = typeof text === 'string' ? text.trim() : '';
  if (!normalized && (!content || content.length > 10000)) throw fail(400, 'Enter prescription text up to 10,000 characters.');
  const digest = crypto.createHash('sha256').update(normalized || content).update(normalized ? 'image/png' : 'text').digest('hex');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await requirePatient(client, req.user.id);
    const { rows } = await client.query(
      `INSERT INTO ng_prescriptions (patient_user_id,status,image_data_encrypted,image_mime,submitted_text_encrypted,submission_key,submission_digest)
       VALUES ($1,'uploaded',$2,$3,$4,$5,$6)
       ON CONFLICT (patient_user_id,submission_key) DO UPDATE SET submission_key=EXCLUDED.submission_key
       WHERE ng_prescriptions.submission_digest=EXCLUDED.submission_digest
       RETURNING id,status,created_at`,
      [req.user.id, normalized ? JSON.stringify(encrypt(normalized.toString('base64'))) : null, normalized ? 'image/png' : null, content ? JSON.stringify(encrypt(content)) : null,key,digest]
    );
    if (!rows.length) throw fail(409, 'This submission reference was already used for different content.');
    await client.query(
      `INSERT INTO audit_logs (user_id,action,resource_type,resource_id,patient_id,phi_accessed,success,description)
       VALUES ($1,'create','prescription_submission',$2,$1,true,true,'Patient prescription submitted for review')`, [req.user.id, rows[0].id]
    );
    await client.query('COMMIT');
    return {
      prescriptionId: rows[0].id,
      status: rows[0].status,
      requiresVerification: ['uploaded', 'parsing', 'parsed'].includes(rows[0].status),
    };
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}

async function readOwnedImage(pool, req, id) {
  await requirePatient(pool, req.user.id);
  const { rows } = await pool.query('SELECT image_data_encrypted FROM ng_prescriptions WHERE id=$1 AND patient_user_id=$2', [id, req.user.id]);
  if (!rows[0]?.image_data_encrypted) throw fail(404, 'Prescription image not found.');
  const envelope = rows[0].image_data_encrypted;
  const decoded = decrypt(envelope.encrypted, envelope.iv, envelope.tag);
  if (!decoded) throw fail(503, 'This image could not be opened.');
  await pool.query(`INSERT INTO audit_logs (user_id,action,resource_type,resource_id,patient_id,phi_accessed,success,description)
    VALUES ($1,'read','prescription_submission',$2,$1,true,true,'Patient viewed submitted prescription image')`, [req.user.id, id]);
  return Buffer.from(decoded, 'base64');
}

async function assertProviderSubmissionAccess(pool, req, patientUserId) {
  if (!req.user?.id) throw fail(401, 'Authentication required.');
  // Reload both markets and the provider's approval instead of trusting cached
  // browser/session role data. These documents belong to the NG clinical chart.
  const { rows } = await pool.query(
    `SELECT actor.id, actor.role, provider.id AS provider_id
       FROM users actor
       JOIN ng_providers provider ON provider.user_id = actor.id
       JOIN users patient ON patient.id = $2
      WHERE actor.id = $1 AND actor.role = 'provider'
        AND actor.market_scope = 'NG' AND actor.is_active = TRUE
        AND actor.provider_status = 'approved' AND provider.status = 'verified'
        AND patient.role = 'patient' AND patient.market_scope = 'NG'`,
    [req.user.id, patientUserId]
  );
  if (!rows.length) throw fail(403, 'Clinical record access denied.');
  try {
    return await assertClinicalAccess({ ...req, user: { ...req.user, ...rows[0] } }, {
      pool,
      patientUserId,
      mode: 'read',
    });
  } catch (error) {
    if (error.statusCode !== 403 || error.code !== 'CLINICAL_ACCESS_DENIED') throw error;
    // Main-platform charts can already contain completed shared appointments
    // for NG accounts. The fresh checks above still bind both parties to NG.
    const shared = await pool.query(
      `SELECT id FROM appointments
        WHERE provider_id = $1 AND patient_id = $2 AND status = 'completed'
        LIMIT 1`,
      [req.user.id, patientUserId]
    );
    if (!shared.rows.length) throw error;
    return { userId: req.user.id, role: rows[0].role, patientUserId, providerId: rows[0].provider_id, providerUserId: req.user.id };
  }
}

async function auditProviderRead(pool, req, patientUserId, resourceId, description) {
  // Do not release decrypted documents if the durable PHI access audit fails.
  await pool.query(
    `INSERT INTO audit_logs
       (user_id,action,resource_type,resource_id,patient_id,phi_accessed,success,description,ip_address,user_agent)
     VALUES ($1,'read','prescription_submission',$2,$3,true,true,$4,$5,$6)`,
    [req.user.id, resourceId, patientUserId, description, req.ip || null, req.get?.('user-agent') || null]
  );
}

async function listProviderSubmissions(pool, req, patientUserId) {
  await assertProviderSubmissionAccess(pool, req, patientUserId);
  const { rows } = await pool.query(
    `SELECT id, status, created_at,
            (image_data_encrypted IS NOT NULL) AS has_image,
            (submitted_text_encrypted IS NOT NULL) AS has_text
       FROM ng_prescriptions
      WHERE patient_user_id = $1
        AND (image_data_encrypted IS NOT NULL OR submitted_text_encrypted IS NOT NULL)
      ORDER BY created_at DESC LIMIT 50`,
    [patientUserId]
  );
  await auditProviderRead(pool, req, patientUserId, patientUserId, 'Provider viewed patient prescription submission list');
  return rows;
}

async function readProviderSubmission(pool, req, patientUserId, id) {
  await assertProviderSubmissionAccess(pool, req, patientUserId);
  const { rows } = await pool.query(
    `SELECT id, status, image_data_encrypted, submitted_text_encrypted
       FROM ng_prescriptions WHERE id = $1 AND patient_user_id = $2`,
    [id, patientUserId]
  );
  const row = rows[0];
  if (!row || (!row.image_data_encrypted && !row.submitted_text_encrypted)) throw fail(404, 'Submission not found.');
  const open = (envelope) => {
    if (!envelope) return null;
    const plaintext = decrypt(envelope.encrypted, envelope.iv, envelope.tag);
    if (!plaintext) throw fail(503, 'This submission could not be opened.');
    return plaintext;
  };
  const submission = {
    id: row.id,
    status: row.status,
    imageBase64: open(row.image_data_encrypted),
    text: open(row.submitted_text_encrypted),
  };
  await auditProviderRead(pool, req, patientUserId, id, 'Provider viewed patient-submitted prescription');
  return submission;
}

module.exports = {
  MAX_IMAGE_BYTES,
  normalizeImage,
  saveSubmission,
  readOwnedImage,
  assertProviderSubmissionAccess,
  listProviderSubmissions,
  readProviderSubmission,
};
