'use strict';

const crypto = require('crypto');
const { z } = require('zod');

const uid = z.string().regex(/^[A-Za-z][A-Za-z0-9]{10}$/);
const numericValue = z.union([z.number().finite().nonnegative(), z.string().regex(/^\d+(?:\.\d+)?$/).refine((value) => Number.isFinite(Number(value)))]);
const aggregatePayload = z.object({
  dataSet: uid, orgUnit: uid, period: z.string().regex(/^\d{4}(?:0[1-9]|1[0-2])$/),
  completeDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  attributeOptionCombo: uid.optional(),
  dataValues: z.array(z.object({ dataElement: uid, categoryOptionCombo: uid.optional(), value: numericValue }).strict()).min(1).max(10000),
}).strict();

function assertAggregatePayload(payload) {
  if (!aggregatePayload.safeParse(payload).success) throw deliveryError('DHIS2 delivery requires approved identifiers and numeric aggregate values only.', 'DHIS2_PAYLOAD_INVALID');
  const cells = payload.dataValues.map((value) => `${value.dataElement}:${value.categoryOptionCombo || ''}`);
  if (new Set(cells).size !== cells.length) throw deliveryError('Duplicate DHIS2 aggregate cells require review.', 'DHIS2_PAYLOAD_INVALID');
}

function deliveryError(message, code = 'DHIS2_DELIVERY_CONFLICT') {
  return Object.assign(new Error(message), { status: 409, code });
}

function importOutcome(httpStatus, body, expectedCount) {
  const summary = body?.response?.importSummary || body?.response || body?.importSummary || body;
  if (httpStatus < 200 || httpStatus >= 300) return { state: 'rejected', code: 'HTTP_REJECTED' };
  const counts = summary?.importCount;
  if (httpStatus === 202 || !counts) return { state: 'reconciliation', code: 'IMPORT_NOT_CONFIRMED', remoteJobId: summary?.id || body?.id || null };
  const ignored = Number(counts.ignored);
  const imported = Number(counts.imported);
  const updated = Number(counts.updated);
  if (!Number.isFinite(ignored) || !Number.isFinite(imported) || !Number.isFinite(updated)) return { state: 'reconciliation', code: 'IMPORT_SUMMARY_INVALID' };
  if (ignored > 0 || (summary.conflicts || []).length || ['ERROR', 'WARNING'].includes(summary.status)) return { state: 'rejected', code: 'IMPORT_PARTIAL_OR_REJECTED', counts: { imported, updated, ignored } };
  if (imported + updated !== expectedCount) return { state: 'reconciliation', code: 'IMPORT_COUNT_MISMATCH', counts: { imported, updated, ignored } };
  return { state: 'reconciliation', code: 'REMOTE_VALUES_REQUIRED', counts: { imported, updated, ignored } };
}

function valuesMatch(expected, remote) {
  if (!Array.isArray(remote?.dataValues) || !expected.dataValues?.length) return false;
  return expected.dataValues.every((value) => {
    const candidates = remote.dataValues.filter((candidate) => candidate.dataElement === value.dataElement &&
      (!value.categoryOptionCombo || candidate.categoryOptionCombo === value.categoryOptionCombo) &&
      (!expected.attributeOptionCombo || candidate.attributeOptionCombo === expected.attributeOptionCombo));
    return candidates.length === 1 && String(candidates[0].value) === String(value.value);
  });
}

function destinationIdentity(baseUrl, username, payload) {
  return crypto.createHash('sha256').update(JSON.stringify({ baseUrl, username: username || null, dataSet: payload.dataSet, orgUnit: payload.orgUnit })).digest('hex');
}

async function enqueueDelivery(pool, { report, payload, payloadHash, destinationHash, actorUserId }) {
  assertAggregatePayload(payload);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const current = await client.query('SELECT * FROM public_health_reports WHERE id = $1 FOR UPDATE', [report.id]);
    const row = current.rows[0];
    if (!row || row.approved_by !== report.approved_by || String(row.approved_at) !== String(report.approved_at)) throw deliveryError('The report approval changed. Review the current report.');
    const previous = await client.query('SELECT * FROM ng_dhis2_delivery_jobs WHERE report_id = $1 ORDER BY created_at LIMIT 1', [report.id]);
    if (previous.rows[0]) {
      if (previous.rows[0].payload_hash !== payloadHash || previous.rows[0].destination_hash !== destinationHash) throw deliveryError('A changed report or destination requires a separately approved report revision.', 'REPORT_REVISION_REQUIRED');
      await client.query('COMMIT');
      return previous.rows[0];
    }
    if (row.status !== 'approved' || !row.approved_by || !row.approved_at || row.approved_by === row.generated_by) throw deliveryError('Independent report approval is required.');
    const inserted = await client.query(
      `INSERT INTO ng_dhis2_delivery_jobs
        (report_id,payload_hash,destination_hash,approved_by,approved_at,payload_json,created_by)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7) RETURNING *`,
      [row.id, payloadHash, destinationHash, row.approved_by, row.approved_at, JSON.stringify(payload), actorUserId]
    );
    await client.query("UPDATE public_health_reports SET status = 'sync_pending', updated_at = NOW() WHERE id = $1", [row.id]);
    await client.query('COMMIT');
    return inserted.rows[0];
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}

async function deliverOrReconcile(pool, job, { baseUrl, username, apiToken, fetchImpl = fetch }) {
  const base = new URL(baseUrl);
  if (base.protocol !== 'https:' && !(process.env.NODE_ENV !== 'production' && ['localhost', '127.0.0.1'].includes(base.hostname))) throw deliveryError('DHIS2 requires an approved HTTPS endpoint.', 'DHIS2_ENDPOINT_INVALID');
  if (base.username || base.password || base.search || base.hash) throw deliveryError('DHIS2 endpoint must not contain embedded credentials or query parameters.');
  const identity = destinationIdentity(baseUrl, username, job.payload_json);
  if (identity !== job.destination_hash) throw deliveryError('The delivery destination changed. Reconciliation must use the approved destination.');
  if (['confirmed', 'rejected', 'failed'].includes(job.status)) return { ok: job.status === 'confirmed', delivery: publicJob(job) };

  const token = crypto.randomUUID();
  const leased = await pool.query(
    `UPDATE ng_dhis2_delivery_jobs SET lease_token = $2, lease_until = NOW() + interval '90 seconds',
       status = CASE WHEN status = 'queued' THEN 'submitting' ELSE 'reconciliation' END,
       attempts = attempts + 1, updated_at = NOW()
     WHERE id = $1 AND (lease_until IS NULL OR lease_until < NOW())
       AND status IN ('queued','submitting','reconciliation','failed') RETURNING *`, [job.id, token]
  );
  if (!leased.rows[0]) return { ok: false, delivery: publicJob(job), pending: true };
  const current = leased.rows[0];
  const payload = current.payload_json;
  assertAggregatePayload(payload);
  let outcome = { state: 'reconciliation', code: 'DELIVERY_AMBIGUOUS' };
  const endpoint = `${baseUrl.replace(/\/+$/, '')}/api/dataValueSets`;
  const headers = { Authorization: username ? `Basic ${Buffer.from(`${username}:${apiToken}`).toString('base64')}` : `ApiToken ${apiToken}` };
  let httpStatus = null;
  try {
    // Only a never-attempted queued job is POSTed. A stale lease or network
    // timeout is reconciled by reading absolute remote values, never re-POSTed.
    if (job.status === 'queued') {
      const response = await fetchImpl(endpoint, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(20000), redirect: 'error' });
      httpStatus = response.status;
      let body;
      try { body = await response.json(); } catch { body = null; }
      outcome = importOutcome(response.status, body, payload.dataValues.length);
    }
    if (outcome.state !== 'rejected') {
      const readUrl = new URL(endpoint);
      for (const [key, value] of Object.entries({ dataSet: payload.dataSet, period: payload.period, orgUnit: payload.orgUnit })) readUrl.searchParams.set(key, value);
      const response = await fetchImpl(readUrl.toString(), { headers, signal: AbortSignal.timeout(20000), redirect: 'error' });
      const remote = response.ok ? await response.json() : null;
      if (valuesMatch(payload, remote)) outcome = { ...outcome, state: 'confirmed', code: 'REMOTE_VALUES_MATCH' };
    }
  } catch {
    // Avoid copying third-party response bodies, credentials or narratives into
    // logs. The durable job retains enough identity to reconcile safely.
    outcome = { state: 'reconciliation', code: 'DELIVERY_AMBIGUOUS' };
  }
  if (outcome.state === 'reconciliation' && current.attempts >= 8) outcome = { state: 'failed', code: 'RECONCILIATION_REQUIRES_OPERATOR_REVIEW' };
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const updated = await client.query(
      `UPDATE ng_dhis2_delivery_jobs SET status = $3, result_summary_json = $4::jsonb,
         last_error_code = $5, remote_job_id = COALESCE($6,remote_job_id), lease_token = NULL, lease_until = NULL, updated_at = NOW()
       WHERE id = $1 AND lease_token = $2 RETURNING *`,
      [job.id, token, outcome.state, JSON.stringify({ code: outcome.code, counts: outcome.counts || null, httpStatus }), outcome.state === 'confirmed' ? null : outcome.code, outcome.remoteJobId || null]
    );
    if (!updated.rows[0]) throw deliveryError('The delivery lease changed. Reconcile the retained job.');
    await client.query(
      'UPDATE public_health_reports SET status = $2, updated_at = NOW() WHERE id = $1',
      [job.report_id, outcome.state === 'confirmed' ? 'synced' : ['rejected', 'failed'].includes(outcome.state) ? 'sync_failed' : 'sync_pending']
    );
    await client.query(
      `INSERT INTO dhis2_sync_logs (report_id,status,request_payload_hash,response_status,response_body_summary,attempted_by)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [job.report_id, outcome.state, job.payload_hash, String(httpStatus || 'reconciliation'), outcome.code, job.created_by]
    );
    await client.query('COMMIT');
    return { ok: outcome.state === 'confirmed', status: httpStatus, delivery: publicJob(updated.rows[0]), pending: outcome.state === 'reconciliation' };
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}

function publicJob(job) {
  return { id: job.id, reportId: job.report_id, status: job.status, attempts: job.attempts, result: job.result_summary_json || null, updatedAt: job.updated_at };
}

module.exports = { importOutcome, valuesMatch, destinationIdentity, enqueueDelivery, deliverOrReconcile, publicJob, assertAggregatePayload };
