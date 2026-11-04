'use strict';
const crypto = require('node:crypto');
const { z } = require('zod');
const { encrypt, decryptCurrentKey } = require('../../lib/encryption');
const encounters = require('./clinicalEncounterService');
const text = z.string().trim().min(1).max(4000);
const orderSchema = z.object({ requestKey: z.string().uuid(), testName: text.max(180), testCode: text.max(80), reason: text }).strict();
const common = { requestKey: z.string().uuid(), expectedRevision: z.number().int().nonnegative() };
const result = { sourceLaboratory: text.max(180), sourceReportId: text.max(180), value: text, unit: z.string().trim().max(80), referenceRange: z.string().trim().max(400), critical: z.boolean(), reviewedSourceReport: z.literal(true), criticalDueAt: z.string().datetime().optional(), handoffPlan: text.optional() };
const eventSchema = z.discriminatedUnion('kind', [
  z.object({ ...common, kind: z.literal('collect'), specimenReference: text.max(180), collectedAt: z.string().datetime(), notes: text }).strict(),
  z.object({ ...common, kind: z.literal('reject'), reason: text }).strict(),
  z.object({ ...common, kind: z.literal('cancel'), reason: text }).strict(),
  z.object({ ...common, ...result, kind: z.literal('result') }).strict(),
  z.object({ ...common, ...result, kind: z.literal('amend'), correctionReason: text }).strict(),
  z.object({ ...common, kind: z.literal('acknowledge'), resultRevision: z.number().int().positive(), actionTaken: text, contactOutcome: text }).strict(),
]);
const fail = (statusCode, code) => Object.assign(new Error('The lab operation is unavailable in this context.'), { statusCode, code });
const digest = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
function parse(schema, value) { const parsed = schema.safeParse(value); if (!parsed.success) throw fail(400, 'LAB_INPUT_INVALID'); return parsed.data; }
function protect(id, content) {
  if (!/^[a-f\d]{64}$/i.test(process.env.ENCRYPTION_KEY || '')) throw fail(503, 'LAB_ENCRYPTION_UNAVAILABLE');
  return encrypt(JSON.stringify({ version: 1, id, content }));
}
function unprotect(id, envelope) {
  try {
    const value = JSON.parse(decryptCurrentKey(envelope.encrypted, envelope.iv, envelope.tag));
    if (value?.version !== 1 || value.id !== id || !value.content) throw new Error();
    return value.content;
  } catch { throw fail(503, 'LAB_CONTENT_UNAVAILABLE'); }
}
async function context(client, actor, encounterId, writable = false) {
  if (process.env.NODE_ENV === 'production') throw fail(503, 'LAB_CLINICAL_ACTIVATION_PENDING');
  if (actor?.role !== 'provider') throw fail(403, 'LAB_ACCESS_DENIED');
  const encounter = await encounters._lockEncounter(client, encounterId, actor.id, { allowCompleted: !writable });
  const accounts = (await client.query("SELECT id,is_test_account FROM users WHERE id=ANY($1::uuid[]) AND account_status='active' FOR SHARE", [[actor.id, encounter.patient_id]])).rows;
  if (accounts.length !== 2 || accounts.some(row => row.is_test_account !== true)) throw fail(403, 'LAB_FICTIONAL_ACCOUNTS_REQUIRED');
  return encounter;
}
async function audit(client, actor, row, action) {
  await client.query(`INSERT INTO audit_logs(user_id,action,resource_type,resource_id,patient_id,phi_accessed,success,description)
    VALUES($1,$2,'clinical_lab_order',$3,$4,TRUE,TRUE,'Authorized manual laboratory workflow')`, [actor.id, action, row.id, row.patient_id]);
}
async function transaction(pool, action) {
  const client = await pool.connect();
  try { await client.query('BEGIN'); const value = await action(client); await client.query('COMMIT'); return value; }
  catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
}
function summary(row) {
  return { id: row.id, encounterId: row.encounter_id, status: row.status, revision: row.revision,
    resultRevision: row.result_revision, critical: row.critical, criticalDueAt: row.critical_due_at,
    acknowledgedResultRevision: row.acknowledged_result_revision,
    requiresAcknowledgment: row.critical && row.acknowledged_result_revision !== row.result_revision,
    ...unprotect(row.id, row.protected_order), transmission: 'not_transmitted' };
}
async function create(pool, actor, encounterId, input) {
  const data = parse(orderSchema, input);
  return transaction(pool, async client => {
    const encounter = await context(client, actor, encounterId, true);
    // Serializes duplicate keys across different encounters as well.
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [actor.id + ':' + data.requestKey]);
    const fingerprint = digest({ encounterId, ...data });
    const existing = (await client.query('SELECT * FROM clinical_lab_orders WHERE provider_id=$1 AND request_key=$2', [actor.id, data.requestKey])).rows[0];
    if (existing) {
      if (existing.request_digest.trim() !== fingerprint) throw fail(409, 'LAB_INTENT_CONFLICT');
      await audit(client, actor, existing, 'read'); return summary(existing);
    }
    const id = crypto.randomUUID();
    const { requestKey: _key, ...content } = data;
    const row = (await client.query(`INSERT INTO clinical_lab_orders(id,encounter_id,patient_id,provider_id,request_key,request_digest,protected_order,status)
      VALUES($1,$2,$3,$4,$5,$6,$7,'recorded') RETURNING *`, [id, encounterId, encounter.patient_id, actor.id, data.requestKey, fingerprint, protect(id, content)])).rows[0];
    await audit(client, actor, row, 'create'); return summary(row);
  });
}
async function list(pool, actor, encounterId) {
  return transaction(pool, async client => {
    await context(client, actor, encounterId);
    const rows = (await client.query('SELECT * FROM clinical_lab_orders WHERE encounter_id=$1 AND provider_id=$2 ORDER BY created_at,id', [encounterId, actor.id])).rows;
    const output = [];
    for (const row of rows) {
      const events = (await client.query('SELECT * FROM clinical_lab_events WHERE order_id=$1 ORDER BY revision', [row.id])).rows;
      output.push({ ...summary(row), events: events.map(event => ({ id: event.id, kind: event.kind, revision: event.revision, createdAt: event.created_at, ...unprotect(event.id, event.protected_event) })) });
      await audit(client, actor, row, 'read');
    }
    return output;
  });
}
async function append(pool, actor, encounterId, orderId, input) {
  if (!z.string().uuid().safeParse(orderId).success) throw fail(400, 'LAB_INPUT_INVALID');
  const data = parse(eventSchema, input);
  return transaction(pool, async client => {
    await context(client, actor, encounterId);
    const row = (await client.query('SELECT * FROM clinical_lab_orders WHERE id=$1 AND encounter_id=$2 AND provider_id=$3 FOR UPDATE', [orderId, encounterId, actor.id])).rows[0];
    if (!row) throw fail(403, 'LAB_ACCESS_DENIED');
    const fingerprint = digest(data);
    const replay = (await client.query('SELECT request_digest FROM clinical_lab_events WHERE order_id=$1 AND request_key=$2', [orderId, data.requestKey])).rows[0];
    if (replay) {
      if (replay.request_digest.trim() !== fingerprint) throw fail(409, 'LAB_INTENT_CONFLICT');
      await audit(client, actor, row, 'read'); return summary(row);
    }
    if (row.revision !== data.expectedRevision) throw fail(409, 'LAB_REVISION_CONFLICT');
    const allowed = { collect: ['recorded','rejected'], reject: ['collected'], cancel: ['recorded','rejected','collected'], result: ['collected'], amend: ['resulted'], acknowledge: ['resulted'] };
    if (!allowed[data.kind].includes(row.status)) throw fail(409, 'LAB_TRANSITION_INVALID');
    if (data.kind === 'amend' && row.critical && row.acknowledged_result_revision !== row.result_revision && !data.critical) throw fail(409, 'LAB_CRITICAL_ACK_REQUIRED');
    if (data.kind === 'collect' && Date.parse(data.collectedAt) > Date.now()) throw fail(400, 'LAB_COLLECTION_TIME_INVALID');
    if (['result','amend'].includes(data.kind) && data.critical && (!data.handoffPlan || !data.criticalDueAt || Date.parse(data.criticalDueAt) <= Date.now())) throw fail(400, 'LAB_CRITICAL_OWNERSHIP_REQUIRED');
    if (data.kind === 'acknowledge' && (!row.critical || data.resultRevision !== row.result_revision || row.acknowledged_result_revision === row.result_revision)) throw fail(409, 'LAB_ACKNOWLEDGMENT_INVALID');
    const id = crypto.randomUUID(), revision = row.revision + 1;
    const { requestKey: _key, expectedRevision: _revision, ...content } = data;
    await client.query(`INSERT INTO clinical_lab_events(id,order_id,actor_id,request_key,request_digest,revision,kind,protected_event)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8)`, [id, orderId, actor.id, data.requestKey, fingerprint, revision, data.kind, protect(id, content)]);
    const isResult = ['result','amend'].includes(data.kind);
    const status = { collect: 'collected', reject: 'rejected', cancel: 'cancelled', result: 'resulted', amend: 'resulted', acknowledge: 'resulted' }[data.kind];
    const updated = (await client.query(`UPDATE clinical_lab_orders SET status=$2,revision=$3,result_revision=$4,critical=$5,
      critical_due_at=$6,acknowledged_result_revision=$7,updated_at=NOW() WHERE id=$1 RETURNING *`,
    [orderId, status, revision, isResult ? revision : row.result_revision, isResult ? data.critical : row.critical,
      isResult ? data.critical ? data.criticalDueAt : null : row.critical_due_at,
      data.kind === 'acknowledge' ? row.result_revision : isResult ? null : row.acknowledged_result_revision])).rows[0];
    await audit(client, actor, row, 'update'); return summary(updated);
  });
}
module.exports = { create, list, append };
