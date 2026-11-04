'use strict';

const crypto = require('crypto');
const { z } = require('zod');
const programme = require('./publicHealthProgrammeService');
const { canAccessReport } = require('../../middleware/reportScope');
const delivery = require('./dhis2DeliveryService');

const uuid = z.string().uuid();
const commandSchema = z.object({ action: z.enum(['reconcile','close']), expectedVersion: z.number().int().min(1).max(2147483647), reason: z.string().trim().min(3).max(500).refine(value => !/[\u0000-\u001f]/.test(value)) }).strict();
function operationError(status, code, message) { return Object.assign(new Error(message), { status, code }); }
function canonicalPayload(value) {
  if (Array.isArray(value)) return value.map(canonicalPayload);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalPayload(value[key])]));
  return value;
}
function assertProfile(config, env = process.env) {
  const settings = config.settings || {};
  if (!/^[a-f\d]{64}$/i.test(env.ENCRYPTION_KEY || '')) throw operationError(503, 'DHIS2_ENCRYPTION_KEY_REQUIRED', 'Configured delivery encryption is required.');
  if (env.DHIS2_ALLOW_LIVE_SYNC !== 'true' || !settings.enabled || settings.dryRunOnly || !['sandbox','production'].includes(settings.environment) ||
    settings.governmentApprovalStatus !== 'approved' || settings.apiCredentialsStatus !== 'configured' || settings.dataSharingAgreementStatus !== 'approved' || settings.ndprReviewStatus !== 'approved')
    throw operationError(409, 'DHIS2_ACTIVATION_REQUIRED', 'DHIS2 delivery is disabled or its required approvals are incomplete.');
  if (settings.apiVersion !== '2.43' || typeof settings.profileApprovalReference !== 'string' || !settings.profileApprovalReference.trim() || settings.profileApprovalReference.length > 200)
    throw operationError(409, 'DHIS2_PROFILE_APPROVAL_REQUIRED', 'An explicitly approved DHIS2 2.43 integration profile is required.');
  if (!config.baseUrl || !config.apiToken) throw operationError(503, 'DHIS2_CREDENTIALS_UNAVAILABLE', 'Approved DHIS2 connection details are unavailable.');
  if (settings.asyncImportEnabled === true && (typeof config.username !== 'string' || !config.username.trim() || config.username.length > 200))
    throw operationError(409, 'DHIS2_TASK_PRINCIPAL_REQUIRED', 'Asynchronous polling requires an approved named DHIS2 principal.');
  return { apiVersion: settings.apiVersion, approvalReference: settings.profileApprovalReference, asyncImportEnabled: settings.asyncImportEnabled === true };
}

async function assertReportAuthority(pool, job, actorId, { requireApprover = true } = {}) {
  const actors = (await pool.query('SELECT id,role,is_active,market_scope,mfa_enabled FROM users WHERE id=ANY($1::uuid[])', [[actorId, job.approved_by]])).rows;
  const actor = actors.find(row => row.id === actorId); const approver = actors.find(row => row.id === job.approved_by);
  if (!actor?.is_active || actor.market_scope !== 'NG' || actor.mfa_enabled !== true || (requireApprover && (!approver?.is_active || approver.market_scope !== 'NG' || approver.mfa_enabled !== true)))
    throw operationError(403, 'DHIS2_AUTHORITY_REVOKED', 'Current reporting authority is required.');
  if (!await canAccessReport(actor, job.report_id, 'approve') || !await canAccessReport(actor, job.report_id, 'export') || (requireApprover && !await canAccessReport(approver, job.report_id, 'approve')))
    throw operationError(404, 'DHIS2_REPORT_NOT_FOUND', 'The delivery report is unavailable in the current reporting scope.');
  return actor;
}

async function retainedContext(pool, job, { env = process.env, actorId = job.authorized_by || job.created_by, allowLegacyProfile = false } = {}) {
  await assertReportAuthority(pool, job, actorId);
  const [bundle, preview, config] = await Promise.all([programme.getReport(job.report_id), programme.buildDhis2Preview(job.report_id), programme.getDeliveryConfiguration()]);
  const profile = assertProfile(config, env);
  const blockers = programme.validateDhis2Sync(bundle, config.settings, preview);
  if (blockers.length) throw operationError(409, 'DHIS2_REPORT_REVIEW_REQUIRED', 'The retained report no longer meets delivery approval requirements.');
  const report = bundle.report;
  if (report.approved_by !== job.approved_by || new Date(report.approved_at).getTime() !== new Date(job.approved_at).getTime() || report.generated_by === report.approved_by || preview.payloadHash !== job.payload_hash ||
    JSON.stringify(canonicalPayload(preview.payload)) !== JSON.stringify(canonicalPayload(job.payload_json)))
    throw operationError(409, 'REPORT_REVISION_REQUIRED', 'Changed report data or approval requires a separately approved report revision.');
  if (delivery.destinationIdentity(config.baseUrl, config.username, job.payload_json) !== job.destination_hash)
    throw operationError(409, 'DHIS2_DESTINATION_CHANGED', 'The approved delivery destination or principal changed. Restore it or approve a separate report revision.');
  if (!(allowLegacyProfile && !job.api_version) && (job.api_version !== profile.apiVersion || job.profile_approval_reference !== profile.approvalReference || job.async_import_enabled !== profile.asyncImportEnabled))
    throw operationError(409, 'DHIS2_PROFILE_CHANGED', 'The retained integration profile requires operator review.');
  return { ...config, profile };
}

async function applyCommand(pool, session, jobId, commandKey, input, { env = process.env } = {}) {
  const parsed = commandSchema.safeParse(input);
  if (!uuid.safeParse(jobId).success || !uuid.safeParse(commandKey).success || !parsed.success)
    throw operationError(400, 'DHIS2_COMMAND_INVALID', 'Provide a valid delivery, retry key, version, action and operational reason.');
  const body = parsed.data; const hash = crypto.createHash('sha256').update(JSON.stringify(body)).digest('hex');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const job = (await client.query('SELECT * FROM ng_dhis2_delivery_jobs WHERE id=$1 FOR UPDATE', [jobId])).rows[0];
    if (!job) throw operationError(404, 'DHIS2_DELIVERY_NOT_FOUND', 'Delivery not found.');
    const actorId = session?.id || session?.userId;
    const actor = await assertReportAuthority(client, job, actorId, { requireApprover: false });
    if (actor.role !== session.role || !['NG','NIGERIA'].includes(String(session.marketScope || '').toUpperCase())) throw operationError(403, 'DHIS2_AUTHORITY_REVOKED', 'Current reporting authority is required.');
    const previous = (await client.query('SELECT * FROM ng_dhis2_delivery_commands WHERE job_id=$1 AND command_key=$2', [jobId, commandKey])).rows[0];
    if (previous) {
      if (previous.body_hash !== hash || previous.actor_user_id !== actorId) throw operationError(409, 'DHIS2_COMMAND_CONFLICT', 'This retry key belongs to a different delivery command.');
      await client.query('COMMIT'); return { success: true, delivery: delivery.publicJob(job), replayed: true };
    }
    if (job.version !== body.expectedVersion) throw operationError(409, 'DHIS2_VERSION_CONFLICT', 'Delivery changed. Reload its current evidence before another command.');
    if (job.lease_until && new Date(job.lease_until).getTime() > Date.now()) throw operationError(409, 'DHIS2_ATTEMPT_IN_PROGRESS', 'A delivery attempt is already in progress.');
    if (job.status === 'confirmed' || job.status === 'submitting' || job.operator_retry_budget > 0 || job.resolution_code === 'closed_unresolved')
      throw operationError(409, 'DHIS2_COMMAND_NOT_AVAILABLE', 'This delivery cannot accept the requested command. Reload its current evidence.');
    let config;
    if (body.action === 'reconcile') {
      if (!['failed','rejected','reconciliation'].includes(job.status)) throw operationError(409, 'DHIS2_COMMAND_NOT_AVAILABLE', 'Only retained unsuccessful delivery can be explicitly reconciled.');
      config = await retainedContext(client, job, { env, actorId, allowLegacyProfile: true });
    }
    const result = await client.query(`UPDATE ng_dhis2_delivery_jobs SET version=version+1,authorized_by=$2,
      operator_retry_budget=$3,next_attempt_at=CASE WHEN $3=1 THEN NOW() ELSE NULL END,lease_token=NULL,lease_until=NULL,
      status=CASE WHEN $3=0 THEN 'failed' ELSE status END,
      api_version=COALESCE(api_version,$4),profile_approval_reference=COALESCE(profile_approval_reference,$5),
      async_import_enabled=CASE WHEN api_version IS NULL AND $3=1 THEN $6 ELSE async_import_enabled END,
      resolution_code=$7,resolution_reason=$8,resolved_by=$2,resolved_at=NOW(),updated_at=NOW()
      WHERE id=$1 RETURNING *`, [job.id, actorId, body.action === 'reconcile' ? 1 : 0, config?.profile.apiVersion || null,
    config?.profile.approvalReference || null, config?.profile.asyncImportEnabled || false, body.action === 'reconcile' ? 'reconciliation_authorized' : 'closed_unresolved', body.reason]);
    await client.query(`INSERT INTO ng_dhis2_delivery_commands(job_id,actor_user_id,command_key,body_hash,action,expected_version,reason)
      VALUES($1,$2,$3,$4,$5,$6,$7)`, [job.id, actorId, commandKey, hash, body.action, body.expectedVersion, body.reason]);
    await client.query(`INSERT INTO audit_logs(user_id,action,resource_type,resource_id,description,new_values,phi_accessed,success)
      VALUES($1,'update','dhis2_delivery',$2,'Explicit DHIS2 operator decision',$3::jsonb,FALSE,TRUE)`, [actorId, job.id, JSON.stringify({ action: body.action, version: result.rows[0].version, reason: body.reason })]);
    if (body.action === 'close') await client.query("UPDATE public_health_reports SET status='sync_failed',updated_at=NOW() WHERE id=$1", [job.report_id]);
    await client.query('COMMIT'); return { success: true, delivery: delivery.publicJob(result.rows[0]), replayed: false };
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}

module.exports = { assertProfile, assertReportAuthority, retainedContext, applyCommand, operationError };
