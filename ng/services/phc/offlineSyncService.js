'use strict';

const crypto = require('crypto');
const workflow = require('./phcWorkflowService');
const { recordProgrammeAudit, scopeError } = require('./programmeScopeService');

const ALLOWED_OPERATION_TYPES = new Set(['encounter_draft', 'observation', 'queue_entry']);

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function payloadHash(value) {
  return crypto.createHash('sha256').update(canonicalJson(value)).digest('hex');
}

async function getProgrammeCapabilities(pool, context) {
  const result = await pool.query(
    `SELECT p.settings_json,
            COALESCE(MAX(CASE WHEN f.feature_key = 'offline_clinical_sync' AND f.enabled THEN 1 ELSE 0 END), 0) AS offline_flag,
            COALESCE(MAX(CASE WHEN f.feature_key = 'clinical_ai' AND f.enabled THEN 1 ELSE 0 END), 0) AS ai_flag
       FROM public_health_programmes p
       LEFT JOIN ng_programme_feature_flags f ON f.programme_id = p.id
      WHERE p.id = $1
      GROUP BY p.id, p.settings_json`,
    [context.programme_id]
  );
  const row = result.rows[0] || {};
  const settings = row.settings_json || {};
  return {
    offlineClinicalSyncEnabled: Number(row.offline_flag) === 1 || settings.offlineClinicalSyncEnabled === true,
    clinicalAiEnabled: Number(row.ai_flag) === 1 || settings.clinicalAiEnabled === true,
  };
}

async function assertOfflineSyncEnabled(pool, context) {
  const capabilities = await getProgrammeCapabilities(pool, context);
  if (!capabilities.offlineClinicalSyncEnabled) {
    throw scopeError(403, 'Offline clinical synchronization is not enabled for this programme.', 'OFFLINE_SYNC_DISABLED');
  }
  return capabilities;
}

async function registerDevice(pool, req, context, {
  devicePublicId,
  displayName = null,
  publicKeyJwk = null,
  metadata = {},
}) {
  await assertOfflineSyncEnabled(pool, context);
  const result = await pool.query(
    `INSERT INTO ng_phc_client_devices
       (user_id, programme_id, facility_id, device_public_id, display_name,
        public_key_jwk, status, last_seen_at, metadata_json)
     VALUES ($1,$2,$3,$4,$5,$6::JSONB,'active',NOW(),$7::JSONB)
     ON CONFLICT (user_id, programme_id, device_public_id) DO UPDATE SET
       facility_id = EXCLUDED.facility_id,
       display_name = EXCLUDED.display_name,
       public_key_jwk = COALESCE(EXCLUDED.public_key_jwk, ng_phc_client_devices.public_key_jwk),
       last_seen_at = NOW(),
       metadata_json = ng_phc_client_devices.metadata_json || EXCLUDED.metadata_json
     WHERE ng_phc_client_devices.status = 'active'
     RETURNING id, device_public_id, display_name, status, registered_at, last_seen_at`,
    [
      context.userId,
      context.programme_id,
      context.facility_id,
      devicePublicId,
      displayName,
      publicKeyJwk ? JSON.stringify(publicKeyJwk) : null,
      JSON.stringify(metadata || {}),
    ]
  );
  if (!result.rows.length) {
    throw scopeError(403, 'This device registration is not active.', 'DEVICE_NOT_ACTIVE');
  }
  await recordProgrammeAudit(pool, req, context, {
    action: 'offline_device_registered',
    resourceType: 'phc_client_device',
    resourceId: result.rows[0].id,
    purpose: 'Protected offline clinical workflow',
    dataClass: 'operational',
    metadata: { devicePublicId },
  });
  return result.rows[0];
}

async function loadActiveDevice(pool, context, devicePublicId) {
  const result = await pool.query(
    `SELECT id, device_public_id, status
       FROM ng_phc_client_devices
      WHERE user_id = $1 AND programme_id = $2 AND facility_id = $3
        AND device_public_id = $4 AND status = 'active'
      LIMIT 1`,
    [context.userId, context.programme_id, context.facility_id, devicePublicId]
  );
  if (!result.rows.length) {
    throw scopeError(403, 'Active registered device required.', 'REGISTERED_DEVICE_REQUIRED');
  }
  return result.rows[0];
}

async function recordOperation(pool, context, device, operation, hash) {
  const insert = await pool.query(
    `INSERT INTO ng_phc_sync_operations
       (id, device_id, user_id, programme_id, facility_id, entity_type,
        entity_id, operation_type, client_record_version, payload_hash, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'create',$8,$9,'received')
     ON CONFLICT (id) DO NOTHING
     RETURNING *`,
    [
      operation.operationId,
      device.id,
      context.userId,
      context.programme_id,
      context.facility_id,
      operation.entityType,
      operation.entityId || null,
      operation.clientRecordVersion || null,
      hash,
    ]
  );
  if (insert.rows.length) return { row: insert.rows[0], replay: false };

  const existing = await pool.query(
    `SELECT * FROM ng_phc_sync_operations
      WHERE id = $1 AND device_id = $2 AND user_id = $3
      LIMIT 1`,
    [operation.operationId, device.id, context.userId]
  );
  const row = existing.rows[0];
  if (!row || row.payload_hash !== hash) {
    throw scopeError(409, 'Operation identifier was already used for different content.', 'SYNC_IDEMPOTENCY_CONFLICT');
  }
  return { row, replay: ['applied', 'rejected', 'conflict'].includes(row.status) };
}

async function applyClinicalOperation(pool, req, context, operation) {
  const data = operation.payload;
  if (operation.entityType === 'encounter_draft') {
    return workflow.createEncounter(pool, req, context, {
      ...data,
      clientEncounterId: operation.entityId,
      idempotencyKey: operation.operationId,
    });
  }
  if (operation.entityType === 'observation') {
    return workflow.createObservation(pool, req, context, {
      ...data,
      idempotencyKey: operation.operationId,
    });
  }
  if (operation.entityType === 'queue_entry') {
    return workflow.enqueueEncounter(pool, req, context, {
      ...data,
      idempotencyKey: operation.operationId,
    });
  }
  throw scopeError(400, 'Unsupported offline operation.', 'SYNC_OPERATION_UNSUPPORTED');
}

async function updateOperationResult(pool, operationId, status, {
  entityId = null,
  serverRecordVersion = null,
  errorCode = null,
  errorSummary = null,
} = {}) {
  await pool.query(
    `UPDATE ng_phc_sync_operations
        SET status = $2,
            entity_id = COALESCE(entity_id, $3),
            server_record_version = $4,
            error_code = $5,
            error_summary = $6,
            applied_at = CASE WHEN $2 = 'applied' THEN NOW() ELSE applied_at END
      WHERE id = $1`,
    [operationId, status, entityId, serverRecordVersion, errorCode, errorSummary]
  );
}

async function synchronizeBatch(pool, req, context, { devicePublicId, operations }) {
  await assertOfflineSyncEnabled(pool, context);
  const device = await loadActiveDevice(pool, context, devicePublicId);
  await pool.query('UPDATE ng_phc_client_devices SET last_seen_at = NOW() WHERE id = $1', [device.id]);
  const results = [];

  for (const operation of operations) {
    if (!ALLOWED_OPERATION_TYPES.has(operation.entityType)) {
      results.push({ operationId: operation.operationId, status: 'rejected', code: 'SYNC_OPERATION_UNSUPPORTED' });
      continue;
    }
    const hash = payloadHash({
      entityType: operation.entityType,
      entityId: operation.entityId || null,
      clientRecordVersion: operation.clientRecordVersion || null,
      payload: operation.payload,
    });
    let tracked = null;
    try {
      tracked = await recordOperation(pool, context, device, operation, hash);
      if (tracked.replay) {
        results.push({
          operationId: operation.operationId,
          entityId: tracked.row.entity_id,
          status: tracked.row.status,
          code: tracked.row.error_code,
          replay: true,
        });
        continue;
      }
      const entity = await applyClinicalOperation(pool, req, context, operation);
      await updateOperationResult(pool, operation.operationId, 'applied', {
        entityId: entity.id,
        serverRecordVersion: entity.record_version || 1,
      });
      results.push({
        operationId: operation.operationId,
        entityId: entity.id,
        status: 'applied',
        serverRecordVersion: entity.record_version || 1,
      });
    } catch (error) {
      const status = error.statusCode === 409 ? 'conflict' : error.statusCode && error.statusCode < 500 ? 'rejected' : 'failed';
      if (tracked?.row) {
        await updateOperationResult(pool, operation.operationId, status, {
          errorCode: error.code || 'SYNC_OPERATION_FAILED',
          errorSummary: error.statusCode && error.statusCode < 500 ? error.message : 'Operation could not be applied.',
        });
      }
      results.push({ operationId: operation.operationId, status, code: error.code || 'SYNC_OPERATION_FAILED' });
    }
  }

  await recordProgrammeAudit(pool, req, context, {
    action: 'offline_sync_batch_processed',
    resourceType: 'phc_client_device',
    resourceId: device.id,
    purpose: 'Protected offline clinical workflow',
    dataClass: 'sensitive',
    metadata: {
      operationCount: operations.length,
      appliedCount: results.filter((item) => item.status === 'applied').length,
      conflictCount: results.filter((item) => item.status === 'conflict').length,
      rejectedCount: results.filter((item) => item.status === 'rejected').length,
    },
  });
  return { deviceId: device.id, results };
}

module.exports = {
  ALLOWED_OPERATION_TYPES,
  assertOfflineSyncEnabled,
  canonicalJson,
  getProgrammeCapabilities,
  payloadHash,
  registerDevice,
  synchronizeBatch,
};
