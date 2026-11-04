'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { encrypt, decrypt } = require('../../lib/encryption');
const { runtimePath, ensureRuntimeDirectory } = require('../utils/runtimeStatePolicy');
const uuid = /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i;
const fail = (status, message) => Object.assign(new Error(message), { status });
const types = new Set(['medical_license', 'dea_certificate', 'npi_certificate', 'board_certification', 'malpractice_insurance', 'photo_id', 'cv_resume', 'medical_degree', 'proof_of_address', 'background_check_consent', 'reference_letter', 'immunization_records', 'cpr_certification', 'hipaa_training', 'state_license', 'work_history', 'other']);

function publicDocument(row) {
  const { file_url: _url, ...document } = row;
  return { ...document, file_url: `/api/credentialing/documents/${row.id}/content` };
}
async function currentOwner(client, actor) {
  const row = (await client.query(`SELECT pc.id FROM provider_credentialing pc JOIN users u ON u.id=pc.provider_id
    WHERE pc.provider_id=$1 AND u.is_active=TRUE AND u.account_status='active' AND u.role='provider' FOR SHARE OF pc,u`, [actor.id])).rows[0];
  if (!row || actor.role !== 'provider') throw fail(403, 'Provider credentialing access is required.');
  return row.id;
}
function validateFile(file) {
  if (!file?.buffer?.length || file.buffer.length > 10 * 1024 * 1024) throw fail(400, 'Choose a PDF, JPEG or PNG up to 10 MB.');
  const b = file.buffer;
  const valid = file.mimetype === 'application/pdf' && b.subarray(0,5).toString() === '%PDF-' ||
    ['image/jpeg', 'image/jpg'].includes(file.mimetype) && b[0] === 255 && b[1] === 216 && b[2] === 255 ||
    file.mimetype === 'image/png' && b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
  if (!valid) throw fail(400, 'The document format does not match its file type.');
}
async function audit(client, row, actor, action) {
  await client.query(`INSERT INTO credentialing_audit_log (credentialing_id,action,action_by,action_by_role,details)
    VALUES ($1,$2,$3,$4,$5)`, [row.credentialing_id, action, actor.id, actor.role, JSON.stringify({ documentId: row.id })]);
}
async function save(pool, actor, file, body) {
  validateFile(file);
  if (!types.has(body.documentType) || body.expiryDate && !/^\d{4}-\d{2}-\d{2}$/.test(body.expiryDate)) throw fail(400, 'A valid document type and expiry date are required.');
  if (!/^[a-f\d]{64}$/i.test(process.env.ENCRYPTION_KEY || '')) throw fail(503, 'Private document storage is not configured.');
  const id = crypto.randomUUID();
  const filename = path.join(runtimePath('credentialDocuments'), id + '.json');
  const client = await pool.connect();
  let stored = false;
  try {
    await client.query('BEGIN');
    const credentialingId = await currentOwner(client, actor);
    const payload = encrypt(JSON.stringify({ id, data: file.buffer.toString('base64') }));
    ensureRuntimeDirectory('credentialDocuments');
    await fs.writeFile(filename, JSON.stringify(payload), { flag: 'wx', mode: 0o600 });
    stored = true;
    const row = (await client.query(`INSERT INTO credentialing_documents
      (id,credentialing_id,document_type,document_name,file_url,file_size,mime_type,expiry_date)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [id, credentialingId, body.documentType, String(file.originalname || 'Document').replace(/[\x00-\x1f\x7f]/g, '').slice(0,255),
      'private:' + id, file.buffer.length, file.mimetype, body.expiryDate || null])).rows[0];
    await audit(client, row, actor, 'document_uploaded');
    await client.query('COMMIT');
    return publicDocument(row);
  } catch (error) {
    await client.query('ROLLBACK');
    if (stored) await fs.unlink(filename).catch(() => {});
    throw error;
  } finally { client.release(); }
}
async function read(pool, actor, id) {
  if (!uuid.test(id)) throw fail(404, 'Document unavailable.');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const row = (await client.query(`SELECT d.* FROM credentialing_documents d
      JOIN provider_credentialing pc ON pc.id=d.credentialing_id
      JOIN users owner ON owner.id=pc.provider_id
      JOIN users actor ON actor.id=$2 AND actor.role=$3 AND actor.is_active=TRUE AND actor.account_status='active'
      WHERE d.id=$1 AND owner.is_active=TRUE AND owner.role='provider'
        AND (actor.id=owner.id AND actor.role='provider' OR actor.role IN ('admin','super_admin') AND actor.market_scope=owner.market_scope)
      FOR SHARE OF d,pc,owner,actor`, [id, actor.id, actor.role])).rows[0];
    if (!row) throw fail(404, 'Document unavailable.');
    let bytes;
    if (row.file_url === 'private:' + id) {
      const root = await fs.realpath(runtimePath('credentialDocuments'));
      if (root !== runtimePath('credentialDocuments')) throw fail(503, 'Private document storage is unavailable.');
      const filename = await fs.realpath(path.join(root, id + '.json'));
      if (path.dirname(filename) !== root) throw fail(404, 'Document unavailable.');
      const payload = JSON.parse(await fs.readFile(filename, 'utf8'));
      const value = JSON.parse(decrypt(payload.encrypted, payload.iv, payload.tag));
      if (value?.id !== id || typeof value.data !== 'string') throw fail(503, 'Document could not be opened.');
      bytes = Buffer.from(value.data, 'base64');
    } else {
      // Existing documents remain accessible only through this authorization gate.
      const name = String(row.file_url).match(/^\/uploads\/credentialing\/([a-zA-Z0-9_.-]+)$/)?.[1];
      if (!name) throw fail(404, 'Document unavailable.');
      const actualRoot = await fs.realpath(path.join(runtimePath('publicUploads'), 'credentialing'));
      const actual = await fs.realpath(path.join(actualRoot, name));
      if (path.dirname(actual) !== actualRoot) throw fail(404, 'Document unavailable.');
      bytes = await fs.readFile(actual);
    }
    if (bytes.length > 10 * 1024 * 1024) throw fail(503, 'Document could not be opened.');
    await audit(client, row, actor, 'document_downloaded');
    await client.query('COMMIT');
    return { bytes };
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}
module.exports = { save, read, publicDocument, validateFile };
