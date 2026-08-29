'use strict';

const crypto = require('crypto');
const { encrypt } = require('../../../lib/encryption');
const { recordProgrammeAudit, scopeError } = require('./programmeScopeService');
const workflow = require('./phcWorkflowService');

const ADAPTER_CAPABILITIES = Object.freeze({
  manual_entry: {
    status: 'available',
    transport: 'human_entry',
    clinicalUse: true,
    description: 'Structured manual observation entry with provenance.',
  },
  mock_device_v1: {
    status: 'test_only',
    transport: 'synthetic_fixture',
    clinicalUse: false,
    description: 'Deterministic synthetic adapter for gateway and reconnection tests.',
  },
  bluetooth_low_energy: { status: 'blocked_vendor_documentation', clinicalUse: false },
  webusb: { status: 'blocked_vendor_documentation', clinicalUse: false },
  vendor_api: { status: 'blocked_vendor_documentation', clinicalUse: false },
});

const MOCK_FIXTURES = Object.freeze({
  blood_pressure: {
    observationCode: '85354-9',
    displayName: 'Blood pressure',
    valueType: 'quantity_pair',
    valueNumeric: 120,
    valueNumericSecondary: 80,
    unit: 'mmHg',
  },
  oxygen_saturation: {
    observationCode: '59408-5',
    displayName: 'Oxygen saturation',
    valueType: 'numeric',
    valueNumeric: 98,
    unit: '%',
  },
});

function serialProtection(serialNumber) {
  if (!serialNumber) return { hash: null, encrypted: null, iv: null, tag: null };
  const normalized = String(serialNumber).trim().toUpperCase();
  const protectedValue = encrypt(normalized);
  return {
    hash: crypto.createHash('sha256').update(normalized).digest('hex'),
    ...protectedValue,
  };
}

async function registerDevice(pool, req, context, {
  deviceType,
  manufacturer = null,
  model = null,
  serialNumber = null,
  calibrationStatus = 'unknown',
  adapterKey = 'manual_entry',
}) {
  if (!ADAPTER_CAPABILITIES[adapterKey]) {
    throw scopeError(400, 'Unknown clinical device adapter.', 'DEVICE_ADAPTER_UNKNOWN');
  }
  if (!context.demo_only && adapterKey === 'mock_device_v1') {
    throw scopeError(403, 'Synthetic device adapters are restricted to demo programmes.', 'MOCK_DEVICE_DEMO_ONLY');
  }
  const serial = serialProtection(serialNumber);
  const result = await pool.query(
    `INSERT INTO ng_clinical_devices
       (programme_id, facility_id, device_type, manufacturer, model,
        serial_number_hash, serial_number_encrypted, status,
        calibration_status, adapter_key, metadata_json, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'active',$8,$9,$10::JSONB,$11)
     RETURNING id, device_type, manufacturer, model, status,
               calibration_status, adapter_key, created_at`,
    [
      context.programme_id,
      context.facility_id,
      deviceType,
      manufacturer,
      model,
      serial.hash,
      serial.encrypted ? JSON.stringify({ encrypted: serial.encrypted, iv: serial.iv, tag: serial.tag }) : null,
      calibrationStatus,
      adapterKey,
      JSON.stringify({ protocolImplemented: false, adapterStatus: ADAPTER_CAPABILITIES[adapterKey].status }),
      context.userId,
    ]
  );
  await recordProgrammeAudit(pool, req, context, {
    action: 'clinical_device_registered',
    resourceType: 'clinical_device',
    resourceId: result.rows[0].id,
    purpose: 'Clinical observation capture',
    dataClass: 'operational',
    metadata: { deviceType, adapterKey, calibrationStatus },
  });
  return result.rows[0];
}

async function listDevices(pool, context) {
  const result = await pool.query(
    `SELECT id, device_type, manufacturer, model, status, calibration_status,
            calibrated_at, calibration_due_at, adapter_key, created_at
       FROM ng_clinical_devices
      WHERE programme_id=$1 AND facility_id=$2 AND status <> 'retired'
      ORDER BY device_type, created_at`,
    [context.programme_id, context.facility_id]
  );
  return result.rows;
}

async function captureMockFixture(pool, req, context, {
  deviceId,
  encounterId,
  fixtureName,
  idempotencyKey,
}) {
  if (!context.demo_only) {
    throw scopeError(403, 'Synthetic device capture is restricted to demo programmes.', 'MOCK_DEVICE_DEMO_ONLY');
  }
  const fixture = MOCK_FIXTURES[fixtureName];
  if (!fixture) throw scopeError(400, 'Unknown synthetic device fixture.', 'MOCK_DEVICE_FIXTURE_UNKNOWN');
  const deviceResult = await pool.query(
    `SELECT id FROM ng_clinical_devices
      WHERE id=$1 AND programme_id=$2 AND facility_id=$3
        AND adapter_key='mock_device_v1' AND status='active'
        AND calibration_status IN ('current','not_required')
      LIMIT 1`,
    [deviceId, context.programme_id, context.facility_id]
  );
  if (!deviceResult.rows.length) throw scopeError(409, 'Synthetic device is not ready.', 'DEVICE_NOT_READY');
  const rawPayload = {
    adapter: 'mock_device_v1',
    fixtureName,
    encounterId,
    capturedAt: new Date().toISOString(),
    observation: fixture,
  };
  const payloadHash = crypto.createHash('sha256')
    .update(JSON.stringify({ deviceId, encounterId, fixtureName, idempotencyKey }))
    .digest('hex');
  const protectedPayload = encrypt(JSON.stringify(rawPayload));
  const ingestionResult = await pool.query(
    `INSERT INTO ng_device_ingestion_events
       (device_id, programme_id, facility_id, payload_hash,
        raw_payload_encrypted, raw_payload_iv, raw_payload_tag,
        status, received_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'validated',$8)
     ON CONFLICT (device_id,payload_hash) DO UPDATE SET
       status=ng_device_ingestion_events.status
     RETURNING id, status, received_at`,
    [
      deviceId,
      context.programme_id,
      context.facility_id,
      payloadHash,
      protectedPayload.encrypted,
      protectedPayload.iv,
      protectedPayload.tag,
      context.userId,
    ]
  );
  try {
    const observation = await workflow.createObservation(pool, req, context, {
      encounterId,
      ...fixture,
      method: 'device',
      deviceId,
      ingestionEventId: ingestionResult.rows[0].id,
      observedAt: rawPayload.capturedAt,
      idempotencyKey,
      provenance: {
        adapterKey: 'mock_device_v1',
        fixtureName,
        synthetic: true,
        humanConfirmationRequired: true,
      },
    });
    await pool.query(
      `UPDATE ng_device_ingestion_events SET status='accepted' WHERE id=$1`,
      [ingestionResult.rows[0].id]
    );
    return { observation, ingestionEventId: ingestionResult.rows[0].id, synthetic: true };
  } catch (error) {
    await pool.query(
      `UPDATE ng_device_ingestion_events
          SET status='rejected', validation_errors_json=$2::JSONB
        WHERE id=$1`,
      [ingestionResult.rows[0].id, JSON.stringify([{ code: error.code || 'CAPTURE_REJECTED' }])]
    );
    throw error;
  }
}

module.exports = {
  ADAPTER_CAPABILITIES,
  MOCK_FIXTURES,
  captureMockFixture,
  listDevices,
  registerDevice,
  serialProtection,
};
