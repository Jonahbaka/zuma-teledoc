'use strict';

const { retainedContext } = require('./dhis2DeliveryOperationsService');
const { deliverOrReconcile } = require('./dhis2DeliveryService');

async function recordBlocked(pool, job, code) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const saved = await client.query(`UPDATE ng_dhis2_delivery_jobs SET status='failed',last_error_code=$3,next_attempt_at=NULL,
      operator_retry_budget=0,lease_token=NULL,lease_until=NULL,version=version+1,result_summary_json=jsonb_build_object('code',$3::text),updated_at=NOW()
      WHERE id=$1 AND version=$2 AND (lease_until IS NULL OR lease_until<NOW()) AND status<>'confirmed' RETURNING *`, [job.id, job.version, code]);
    if (saved.rows[0]) {
      await client.query("UPDATE public_health_reports SET status='sync_failed',updated_at=NOW() WHERE id=$1", [saved.rows[0].report_id]);
      await client.query(`INSERT INTO dhis2_sync_logs(report_id,status,request_payload_hash,response_status,response_body_summary,attempted_by)
        VALUES($1,'failed',$2,'not_submitted',$3,$4)`, [saved.rows[0].report_id, saved.rows[0].payload_hash, code, saved.rows[0].authorized_by || saved.rows[0].created_by]);
    }
    await client.query('COMMIT'); return Boolean(saved.rows[0]);
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}

async function processDueJobs(pool, { env = process.env, fetchImpl = fetch, limit = 10, random = Math.random, signal } = {}) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new Error('Delivery worker limit must be an integer from 1 to 50.');
  const summary = { enabled: env.DHIS2_DELIVERY_WORKER_ENABLED === 'true', examined: 0, confirmed: 0, pending: 0, failed: 0, contended: 0 };
  if (!summary.enabled || signal?.aborted) return summary;
  const rows = (await pool.query(`SELECT * FROM ng_dhis2_delivery_jobs WHERE next_attempt_at<=NOW()
    AND (lease_until IS NULL OR lease_until<NOW()) AND resolution_code IS DISTINCT FROM 'closed_unresolved'
    AND ((status IN ('queued','submitting','reconciliation') AND attempts<8) OR (status IN ('failed','rejected','reconciliation') AND operator_retry_budget=1)
      OR (status IN ('submitting','reconciliation') AND attempts>=8 AND lease_token IS NOT NULL AND lease_until<NOW()))
    ORDER BY next_attempt_at,created_at,id LIMIT $1`, [limit])).rows;
  for (const job of rows) {
    if (signal?.aborted) break;
    summary.examined++;
    try {
      if (job.attempts >= 8 && job.operator_retry_budget === 0) {
        if (await recordBlocked(pool, job, 'RECONCILIATION_REQUIRES_OPERATOR_REVIEW')) summary.failed++; else summary.contended++;
        continue;
      }
      const config = await retainedContext(pool, job, { env });
      const result = await deliverOrReconcile(pool, job, { baseUrl: config.baseUrl, username: config.username, apiToken: config.apiToken, fetchImpl, random,
        authorizeAttempt: current => retainedContext(pool, current, { env }) });
      if (result.ok) summary.confirmed++;
      else if (['failed','rejected'].includes(result.delivery.status)) summary.failed++;
      else if (result.delivery.attempts === job.attempts) summary.contended++;
      else summary.pending++;
    } catch (error) {
      const code = /^(DHIS2_|REPORT_REVISION_REQUIRED)/.test(error.code || '') ? error.code : 'DHIS2_WORKER_UNAVAILABLE';
      if (await recordBlocked(pool, job, code)) summary.failed++; else summary.contended++;
    }
  }
  return summary;
}

module.exports = { processDueJobs };
