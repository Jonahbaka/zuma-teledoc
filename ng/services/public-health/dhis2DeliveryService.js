'use strict';

const crypto = require('crypto');
const { z } = require('zod');
const { retryDelayMs } = require('./dhis2ExportService');

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
  if ([408,425,429,500,502,503,504].includes(httpStatus)) return { state: 'reconciliation', code: 'HTTP_TRANSIENT' };
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
  // DHIS2 2.43 returns both the requested set scope and each value's
  // organisation/period. Matching numbers alone cannot prove this report was
  // accepted: a proxy/cache or an incorrect query can return another set.
  if (!expected.dataSet || !expected.orgUnit || !expected.period ||
    remote?.dataSet !== expected.dataSet || remote.orgUnit !== expected.orgUnit || remote.period !== expected.period ||
    (remote.attributeOptionCombo && remote.attributeOptionCombo !== expected.attributeOptionCombo) ||
    !Array.isArray(remote.dataValues) || !expected.dataValues?.length) return false;
  return expected.dataValues.every((value) => {
    const candidates = remote.dataValues.filter((candidate) => candidate.dataElement === value.dataElement &&
      (!value.categoryOptionCombo || candidate.categoryOptionCombo === value.categoryOptionCombo) &&
      (!expected.attributeOptionCombo || candidate.attributeOptionCombo === expected.attributeOptionCombo));
    const candidate = candidates[0];
    return candidates.length === 1 && candidate.orgUnit === expected.orgUnit && candidate.period === expected.period &&
      (!candidate.dataSet || candidate.dataSet === expected.dataSet) && candidate.deleted !== true && String(candidate.value) === String(value.value);
  });
}

function destinationIdentity(baseUrl, username, payload) {
  return crypto.createHash('sha256').update(JSON.stringify({ baseUrl, username: username || null, dataSet: payload.dataSet, orgUnit: payload.orgUnit })).digest('hex');
}

async function enqueueDelivery(pool, { report, payload, payloadHash, destinationHash, actorUserId, transportProfile = null }) {
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
        (report_id,payload_hash,destination_hash,approved_by,approved_at,payload_json,created_by,authorized_by,api_version,profile_approval_reference,async_import_enabled)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$7,$8,$9,$10) RETURNING *`,
      [row.id, payloadHash, destinationHash, row.approved_by, row.approved_at, JSON.stringify(payload), actorUserId,
        transportProfile?.apiVersion || null, transportProfile?.approvalReference || null, transportProfile?.asyncImportEnabled === true]
    );
    await client.query("UPDATE public_health_reports SET status = 'sync_pending', updated_at = NOW() WHERE id = $1", [row.id]);
    await client.query('COMMIT');
    return inserted.rows[0];
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}

function retryAfterMs(response, now = Date.now()) {
  const raw = response.headers?.get?.('retry-after');
  if (!raw) return 0;
  const delay = /^\d+$/.test(raw) ? Number(raw) * 1000 : Date.parse(raw) - now;
  return Number.isFinite(delay) ? Math.min(300000, Math.max(0, delay)) : 0;
}
function scheduledDelay(attempt, retryAfter = 0, random = Math.random) {
  return Math.min(300000, Math.max(retryAfter, retryDelayMs(attempt)) + Math.floor(Math.max(0, Math.min(1, random())) * 1000));
}
function asyncTask(body) {
  const value = body?.response || body;
  if (!value?.jobType && !value?.relativeNotifierEndpoint) return null;
  if (value.jobType !== 'DATAVALUE_IMPORT' || !/^[A-Za-z][A-Za-z\d]{10}$/.test(value.id || '')) throw deliveryError('The asynchronous import task could not be verified.', 'DHIS2_TASK_INVALID');
  return { id: value.id, type: 'DATAVALUE_IMPORT' };
}
async function safeJson(response) {
  if (Number(response.headers?.get?.('content-length') || 0) > 2000000) throw new Error('Oversized import response');
  if (response.body?.getReader) {
    const reader = response.body.getReader(); const chunks = []; let bytes = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read(); if (done) break;
        bytes += value.byteLength;
        if (bytes > 2000000) { await reader.cancel(); throw new Error('Oversized import response'); }
        chunks.push(Buffer.from(value));
      }
      return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } finally { reader.releaseLock(); }
  }
  const body = await response.json();
  if (JSON.stringify(body).length > 2000000) throw new Error('Oversized import response');
  return body;
}

async function deliverOrReconcile(pool, job, { baseUrl, username, apiToken, fetchImpl = fetch, authorizeAttempt, random = Math.random }) {
  const base = new URL(baseUrl);
  if (base.protocol !== 'https:' && !(process.env.NODE_ENV !== 'production' && ['localhost', '127.0.0.1'].includes(base.hostname))) throw deliveryError('DHIS2 requires an approved HTTPS endpoint.', 'DHIS2_ENDPOINT_INVALID');
  if (base.username || base.password || base.search || base.hash) throw deliveryError('DHIS2 endpoint must not contain embedded credentials or query parameters.');
  // Callers may retain the original queued object across a network failure or
  // another worker's attempt. Only its ID locates the authoritative job.
  const stored = (await pool.query('SELECT * FROM ng_dhis2_delivery_jobs WHERE id = $1', [job.id])).rows[0];
  if (!stored) throw deliveryError('The retained delivery job is unavailable.', 'DHIS2_DELIVERY_NOT_FOUND');
  assertAggregatePayload(stored.payload_json);
  if (destinationIdentity(baseUrl, username, stored.payload_json) !== stored.destination_hash) throw deliveryError('The delivery destination changed. Reconciliation must use the approved destination.');
  if (stored.status === 'confirmed' || (['rejected', 'failed'].includes(stored.status) && stored.operator_retry_budget === 0)) return { ok: stored.status === 'confirmed', delivery: publicJob(stored) };

  const token = crypto.randomUUID();
  const leased = await pool.query(
    `WITH eligible AS (
       SELECT * FROM ng_dhis2_delivery_jobs WHERE id=$1 AND (lease_until IS NULL OR lease_until<NOW())
         AND (next_attempt_at IS NULL OR next_attempt_at<=NOW()) AND resolution_code IS DISTINCT FROM 'closed_unresolved'
         AND ((status IN ('queued','submitting','reconciliation') AND attempts<8) OR (status IN ('failed','rejected','reconciliation') AND operator_retry_budget=1))
         AND payload_hash=$3 AND destination_hash=$4 FOR UPDATE SKIP LOCKED
     ) UPDATE ng_dhis2_delivery_jobs j SET lease_token=$2,lease_until=NOW()+interval '90 seconds',
       status=CASE WHEN e.status='queued' AND e.attempts=0 AND e.operator_retry_budget=0 THEN 'submitting' ELSE 'reconciliation' END,
       attempts=e.attempts+1,operator_retry_budget=0,version=j.version+1,first_attempt_at=COALESCE(j.first_attempt_at,NOW()),
       poll_deadline_at=CASE WHEN e.operator_retry_budget=1 THEN NOW()+interval '30 minutes' ELSE COALESCE(j.poll_deadline_at,NOW()+interval '30 minutes') END,updated_at=NOW()
     FROM eligible e WHERE j.id=e.id RETURNING j.*,e.operator_retry_budget=1 AS operator_attempt`, [stored.id, token, stored.payload_hash, stored.destination_hash]
  );
  if (!leased.rows[0]) {
    const latest = (await pool.query('SELECT * FROM ng_dhis2_delivery_jobs WHERE id = $1', [stored.id])).rows[0];
    if (!latest) throw deliveryError('The retained delivery job is unavailable.', 'DHIS2_DELIVERY_NOT_FOUND');
    return { ok: latest.status === 'confirmed', delivery: publicJob(latest), pending: latest.operator_retry_budget > 0 || !['confirmed', 'rejected', 'failed'].includes(latest.status) };
  }
  const current = leased.rows[0];
  const payload = current.payload_json;
  assertAggregatePayload(payload);
  if (destinationIdentity(baseUrl, username, payload) !== current.destination_hash) throw deliveryError('The delivery destination changed. Reconciliation must use the approved destination.');
  let outcome = { state: 'reconciliation', code: 'DELIVERY_AMBIGUOUS' };
  const endpoint = `${baseUrl.replace(/\/+$/, '')}/api/dataValueSets`;
  const headers = { Authorization: username ? `Basic ${Buffer.from(`${username}:${apiToken}`).toString('base64')}` : `ApiToken ${apiToken}`, Accept: 'application/json' };
  let httpStatus = null;
  let retryAfter = 0;
  const authorizedFetch = async (url, options = {}) => {
    if (authorizeAttempt) await authorizeAttempt(current);
    // Authority checks may await storage while another worker reclaims an
    // expired lease. Recheck and renew only a still-owned, unexpired lease
    // immediately before each bounded external request.
    const owned = (await pool.query(`UPDATE ng_dhis2_delivery_jobs SET lease_until=NOW()+interval '90 seconds'
      WHERE id=$1 AND lease_token=$2 AND lease_until>NOW() AND status IN ('submitting','reconciliation')
        AND resolution_code IS DISTINCT FROM 'closed_unresolved' RETURNING lease_until`, [current.id, token])).rows[0];
    if (!owned || new Date(owned.lease_until).getTime() <= Date.now()) throw deliveryError('The delivery lease is no longer owned by this attempt.', 'DHIS2_DELIVERY_LEASE_LOST');
    return fetchImpl(url, { ...options, headers: { ...headers, ...options.headers }, signal: AbortSignal.timeout(20000), redirect: 'error' });
  };
  try {
    if (new Date(current.poll_deadline_at).getTime() <= Date.now()) throw deliveryError('The polling window expired.', 'DHIS2_POLL_DEADLINE');
    // Only a never-attempted queued job is POSTed. A stale lease or network
    // timeout is reconciled by reading absolute remote values, never re-POSTed.
    if (current.status === 'submitting' && current.attempts === 1 && !current.operator_attempt) {
      const postUrl = new URL(endpoint);
      if (current.async_import_enabled) {
        if (current.api_version !== '2.43' || !current.profile_approval_reference) throw deliveryError('The asynchronous integration profile is unavailable.', 'DHIS2_PROFILE_APPROVAL_REQUIRED');
        postUrl.searchParams.set('async', 'true');
      }
      const response = await authorizedFetch(postUrl.toString(), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      httpStatus = response.status;
      retryAfter = retryAfterMs(response);
      let body;
      try { body = await safeJson(response); } catch { body = null; }
      outcome = importOutcome(response.status, body, payload.dataValues.length);
      const task = response.status >= 200 && response.status < 300 ? asyncTask(body) : null;
      if (current.async_import_enabled && response.status >= 200 && response.status < 300 && !task) throw deliveryError('The asynchronous import task could not be confirmed.', 'DHIS2_TASK_NOT_CONFIRMED');
      if (task) {
        if (current.api_version !== '2.43' || !current.profile_approval_reference || !current.async_import_enabled) throw deliveryError('The asynchronous integration profile is unavailable.', 'DHIS2_PROFILE_APPROVAL_REQUIRED');
        const saved = await pool.query('UPDATE ng_dhis2_delivery_jobs SET remote_job_id=$3,remote_job_type=$4,version=version+1 WHERE id=$1 AND lease_token=$2 RETURNING *', [current.id, token, task.id, task.type]);
        if (!saved.rows[0]) throw deliveryError('The delivery lease changed.');
        current.remote_job_id = task.id; current.remote_job_type = task.type;
      }
    }
    let taskConfirmed = !current.remote_job_id;
    if (current.remote_job_id && outcome.state !== 'rejected') {
      if (current.api_version !== '2.43' || current.remote_job_type !== 'DATAVALUE_IMPORT' || !/^[A-Za-z][A-Za-z\d]{10}$/.test(current.remote_job_id) || !current.profile_approval_reference)
        throw deliveryError('The asynchronous integration profile is unavailable.', 'DHIS2_PROFILE_APPROVAL_REQUIRED');
      // Construct the path from a validated identifier on the approved origin.
      // Never follow remote notifier/Location URLs, including redirects.
      const response = await authorizedFetch(`${baseUrl.replace(/\/+$/, '')}/api/system/taskSummaries/DATAVALUE_IMPORT/${current.remote_job_id}`);
      retryAfter = Math.max(retryAfter, retryAfterMs(response));
      if (response.ok) {
        let summary; try { summary = await safeJson(response); } catch { summary = null; }
        outcome = importOutcome(response.status, summary, payload.dataValues.length);
        taskConfirmed = outcome.state === 'reconciliation' && outcome.code === 'REMOTE_VALUES_REQUIRED';
      } else if ([401,403].includes(response.status)) outcome = { state: 'rejected', code: 'TASK_ACCESS_REJECTED' };
      else outcome = { state: 'reconciliation', code: 'ASYNC_TASK_PENDING' };
    }
    if (outcome.state !== 'rejected' && taskConfirmed) {
      const readUrl = new URL(endpoint);
      for (const [key, value] of Object.entries({ dataSet: payload.dataSet, period: payload.period, orgUnit: payload.orgUnit,
        ...(payload.attributeOptionCombo ? { attributeOptionCombo: payload.attributeOptionCombo } : {}) })) readUrl.searchParams.set(key, value);
      const response = await authorizedFetch(readUrl.toString());
      retryAfter = Math.max(retryAfter, retryAfterMs(response));
      const remote = response.ok ? await safeJson(response) : null;
      if (valuesMatch(payload, remote)) outcome = { ...outcome, state: 'confirmed', code: 'REMOTE_VALUES_MATCH' };
    }
  } catch (error) {
    // Avoid copying third-party response bodies, credentials or narratives into
    // logs. The durable job retains enough identity to reconcile safely.
    outcome = /^(DHIS2_(?!DELIVERY_CONFLICT)|REPORT_REVISION_REQUIRED)/.test(error.code || '') ? { state: 'failed', code: error.code } : { state: 'reconciliation', code: 'DELIVERY_AMBIGUOUS' };
  }
  if (outcome.state === 'reconciliation' && (current.attempts >= 8 || current.operator_attempt)) outcome = { ...outcome, state: 'failed', code: 'RECONCILIATION_REQUIRES_OPERATOR_REVIEW' };
  const nextAttemptAt = outcome.state === 'reconciliation' ? new Date(Date.now() + scheduledDelay(current.attempts, retryAfter, random)) : null;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const updated = await client.query(
      `UPDATE ng_dhis2_delivery_jobs SET status = $3, result_summary_json = $4::jsonb,
         last_error_code = $5, remote_job_id = COALESCE($6,remote_job_id), next_attempt_at=$7,version=version+1,lease_token = NULL, lease_until = NULL, updated_at = NOW()
       WHERE id = $1 AND lease_token = $2 RETURNING *`,
      [current.id, token, outcome.state, JSON.stringify({ code: outcome.code, counts: outcome.counts || null, httpStatus }), outcome.state === 'confirmed' ? null : outcome.code, current.remote_job_id || null, nextAttemptAt]
    );
    if (!updated.rows[0]) throw deliveryError('The delivery lease changed. Reconcile the retained job.');
    await client.query(
      'UPDATE public_health_reports SET status = $2, updated_at = NOW() WHERE id = $1',
      [current.report_id, outcome.state === 'confirmed' ? 'synced' : ['rejected', 'failed'].includes(outcome.state) ? 'sync_failed' : 'sync_pending']
    );
    await client.query(
      `INSERT INTO dhis2_sync_logs (report_id,status,request_payload_hash,response_status,response_body_summary,attempted_by)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [current.report_id, outcome.state, current.payload_hash, String(httpStatus || 'reconciliation'), outcome.code, current.authorized_by || current.created_by]
    );
    await client.query('COMMIT');
    return { ok: outcome.state === 'confirmed', status: httpStatus, delivery: publicJob(updated.rows[0]), pending: outcome.state === 'reconciliation' };
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}

function publicJob(job) {
  return { id: job.id, reportId: job.report_id, status: job.status, attempts: job.attempts, result: job.result_summary_json || null, updatedAt: job.updated_at,
    version: job.version, nextAttemptAt: job.next_attempt_at || null, lastErrorCode: job.last_error_code || null, operatorRetryBudget: job.operator_retry_budget || 0,
    remoteTask: job.remote_job_id ? { id: job.remote_job_id, type: job.remote_job_type, apiVersion: job.api_version } : null,
    resolution: job.resolution_code ? { code: job.resolution_code, reason: job.resolution_reason, actorUserId: job.resolved_by, resolvedAt: job.resolved_at } : null };
}

module.exports = { importOutcome, valuesMatch, destinationIdentity, enqueueDelivery, deliverOrReconcile, publicJob, assertAggregatePayload, retryAfterMs, scheduledDelay, asyncTask };
