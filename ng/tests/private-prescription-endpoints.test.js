'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const express = require('express');
const sharp = require('sharp');

process.env.ENCRYPTION_KEY ||= '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const { encrypt } = require('../../lib/encryption');
const providerId = '00000000-0000-4000-8000-000000000001';
const patientId = '00000000-0000-4000-8000-000000000002';
const otherPatientId = '00000000-0000-4000-8000-000000000003';
const submissionId = '00000000-0000-4000-8000-000000000004';
const profileId = '00000000-0000-4000-8000-000000000005';
let activePool;
let authenticatedUser;

// Test the HTTP document boundary with a trusted authenticated actor. JWT
// verification is covered separately; fresh database authorization is real
// service code here, not a mocked authorization function.
const db = { query: (...args) => activePool.query(...args), getPool: () => activePool };
const auth = {
  authenticate(req, res, next) {
    if (!authenticatedUser) return res.status(401).json({ error: 'Authentication required' });
    req.user = authenticatedUser;
    return next();
  },
  requireRole: (...roles) => (req, res, next) => roles.includes(req.user?.role) || req.user?.role === 'super_admin'
    ? next() : res.status(403).json({ error: 'Access denied' }),
  canAccessPatient() { throw new Error('Submission access must use native NG relationships'); },
};
const noopMiddleware = () => (_req, _res, next) => next();
const clinicalRouteFile = require.resolve('../../server/routes/clinicalEncounters');
const patientRouteFile = require.resolve('../routes/patient');
const originalLoad = Module._load;
let clinicalRoutes;
let patientRoutes;
try {
  Module._load = function loadForEndpointTest(request, parent) {
    if (parent?.filename === clinicalRouteFile) {
      if (request === '../db') return db;
      if (request === '../middleware/auth') return auth;
      if (request === '../middleware/audit') return { auditMiddleware: noopMiddleware, auditPhiAccess: noopMiddleware };
      if (request === '../middleware/logger') return { error() {}, audit() {} };
      if (request.startsWith('../services/')) return {};
    }
    if (parent?.filename === patientRouteFile) {
      if (request === '../../server/db') return db;
      if (request === '../../server/middleware/auth') return auth;
      if (request.startsWith('../services/') && !request.endsWith('/privatePrescriptionUploadService')) return {};
    }
    return originalLoad.apply(this, arguments);
  };
  delete require.cache[clinicalRouteFile];
  delete require.cache[patientRouteFile];
  clinicalRoutes = require(clinicalRouteFile);
  patientRoutes = require(patientRouteFile);
} finally { Module._load = originalLoad; }

function documentPool(options = {}) {
  const state = {
    freshAccess: true,
    profile: true,
    relationship: true,
    completedShared: false,
    document: { id: submissionId, patient_user_id: patientId, status: 'uploaded', image_data_encrypted: null, submitted_text_encrypted: encrypt('Instructions for professional review') },
    ...options,
  };
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });
      if (sql.includes('FROM users actor')) {
        // These predicates must actually be in the SQL given to PostgreSQL.
        for (const predicate of ["actor.role = 'provider'", "actor.market_scope = 'NG'", 'actor.is_active = TRUE', "actor.provider_status = 'approved'", "provider.status = 'verified'", "patient.role = 'patient'", "patient.market_scope = 'NG'"]) assert.ok(sql.includes(predicate), predicate);
        return { rows: state.freshAccess ? [{ id: providerId, role: 'provider', provider_id: profileId }] : [] };
      }
      if (sql.includes('SELECT id FROM ng_providers')) return { rows: state.profile ? [{ id: profileId }] : [] };
      if (sql.includes('FROM ng_appointments')) {
        assert.ok(sql.includes('provider_patient_relationships'));
        assert.deepEqual(params, [patientId, profileId, providerId]);
        return { rows: state.relationship ? [{ id: profileId }] : [] };
      }
      if (/\bFROM appointments\b/.test(sql)) {
        assert.ok(sql.includes("status = 'completed'"));
        assert.deepEqual(params, [providerId, patientId]);
        return { rows: state.completedShared ? [{ id: profileId }] : [] };
      }
      if (sql.includes('SELECT id FROM users')) return { rows: [{ id: params[0] }] };
      if (sql.includes('SELECT image_data_encrypted FROM ng_prescriptions')) {
        return { rows: state.document?.id === params[0] && state.document.patient_user_id === params[1] ? [state.document] : [] };
      }
      if (sql.includes('FROM ng_prescriptions') && sql.includes('ORDER BY created_at DESC')) {
        const row = state.document;
        return { rows: row && row.patient_user_id === params[0] && (row.image_data_encrypted || row.submitted_text_encrypted)
          ? [{ id: row.id, status: row.status, has_image: Boolean(row.image_data_encrypted), has_text: Boolean(row.submitted_text_encrypted) }] : [] };
      }
      if (sql.includes('FROM ng_prescriptions')) return { rows: state.document?.id === params[0] && state.document.patient_user_id === params[1] ? [state.document] : [] };
      if (sql.includes('INSERT INTO audit_logs')) {
        if (state.failAudit) throw new Error('Audit storage unavailable');
        return { rows: [] };
      }
      throw new Error('Unexpected database call in document endpoint test');
    },
  };
}

async function withEndpoints(pool, user, run) {
  activePool = pool;
  authenticatedUser = user;
  const app = express();
  app.use(express.json());
  app.use('/api/clinical-encounters', clinicalRoutes);
  app.use('/api/ng/patient', auth.authenticate, patientRoutes);
  const server = await new Promise((resolve) => { const listener = app.listen(0, '127.0.0.1', () => resolve(listener)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  try { await run((url) => fetch(base + url)); }
  finally { await new Promise((resolve) => server.close(resolve)); activePool = null; authenticatedUser = null; }
}

const listUrl = `/api/clinical-encounters/patient/${patientId}/prescription-submissions`;
const readUrl = `${listUrl}/${submissionId}`;
const provider = { id: providerId, role: 'provider', marketScope: 'NG' };

test('submission endpoints allow native NG care relationships and audit decrypted reads', async () => {
  const pool = documentPool();
  await withEndpoints(pool, provider, async (get) => {
    const list = await get(listUrl);
    assert.equal(list.status, 200);
    assert.equal(list.headers.get('cache-control'), 'private, no-store');
    assert.deepEqual((await list.json()).submissions, [{ id: submissionId, status: 'uploaded', has_image: false, has_text: true }]);
    const read = await get(readUrl);
    assert.equal(read.status, 200);
    assert.equal(read.headers.get('cache-control'), 'private, no-store');
    assert.equal((await read.json()).submission.text, 'Instructions for professional review');
  });
  const audits = pool.calls.filter((call) => call.sql.includes('INSERT INTO audit_logs'));
  assert.equal(audits.length, 2);
  assert.deepEqual(audits[1].params.slice(0, 3), [providerId, submissionId, patientId]);
  assert.equal(pool.calls.some((call) => /\bFROM appointments\b/.test(call.sql)), false);
});

test('submission endpoints reject stale permissions or missing native care relationships before PHI retrieval', async () => {
  for (const options of [{ freshAccess: false }, { profile: false }, { relationship: false }]) {
    const pool = documentPool(options);
    await withEndpoints(pool, provider, async (get) => {
      assert.equal((await get(listUrl)).status, 403);
      assert.equal((await get(readUrl)).status, 403);
    });
    assert.equal(pool.calls.some((call) => call.sql.includes('FROM ng_prescriptions')), false);
    assert.equal(pool.calls.some((call) => call.sql.includes('INSERT INTO audit_logs')), false);
  }
});

test('completed shared NG care remains readable after fresh account and native access checks', async () => {
  const pool = documentPool({ relationship: false, completedShared: true });
  await withEndpoints(pool, provider, async (get) => {
    assert.equal((await get(listUrl)).status, 200);
    const response = await get(readUrl); assert.equal(response.status, 200);
    assert.equal((await response.json()).submission.text, 'Instructions for professional review');
  });
  assert.equal(pool.calls.filter((call) => /\bFROM appointments\b/.test(call.sql)).length, 2);
  const denied = documentPool({ freshAccess: false, relationship: false, completedShared: true });
  await withEndpoints(denied, provider, async (get) => { assert.equal((await get(readUrl)).status, 403); });
  assert.equal(denied.calls.some((call) => /\bFROM appointments\b/.test(call.sql)), false);
});

test('patient and platform administrator sessions do not bypass the clinical document boundary', async () => {
  for (const user of [{ id: patientId, role: 'patient' }, { id: providerId, role: 'super_admin' }]) {
    const pool = documentPool({ freshAccess: false });
    await withEndpoints(pool, user, async (get) => { assert.equal((await get(readUrl)).status, 403); });
    assert.equal(pool.calls.some((call) => call.sql.includes('FROM ng_prescriptions')), false);
  }
});

test('malformed patient and submission UUIDs are rejected before database access', async () => {
  const pool = documentPool();
  await withEndpoints(pool, provider, async (get) => {
    assert.equal((await get('/api/clinical-encounters/patient/' + '-'.repeat(36) + '/prescription-submissions')).status, 400);
    assert.equal((await get(listUrl + '/' + '-'.repeat(36))).status, 400);
  });
  await withEndpoints(pool, { id: patientId, role: 'patient' }, async (get) => {
    assert.equal((await get('/api/ng/patient/prescriptions/' + '-'.repeat(36) + '/image')).status, 400);
  });
  assert.equal(pool.calls.length, 0);
});

test('a submission identifier from another patient returns 404 without decrypting or auditing a read', async () => {
  const pool = documentPool({ document: { id: submissionId, patient_user_id: otherPatientId, submitted_text_encrypted: encrypt('Other patient instructions') } });
  await withEndpoints(pool, provider, async (get) => {
    const response = await get(readUrl);
    assert.equal(response.status, 404);
    assert.equal(JSON.stringify(await response.json()).includes('Other patient instructions'), false);
  });
  assert.equal(pool.calls.some((call) => call.sql.includes('INSERT INTO audit_logs')), false);
});

test('missing and decryption-failed submission contents never produce a successful document response', async () => {
  for (const [document, status] of [
    [{ id: submissionId, patient_user_id: patientId, status: 'uploaded', image_data_encrypted: null, submitted_text_encrypted: null }, 404],
    [{ id: submissionId, patient_user_id: patientId, status: 'uploaded', submitted_text_encrypted: { encrypted: 'broken', iv: '00'.repeat(12), tag: '00'.repeat(16) } }, 503],
    [{ id: submissionId, patient_user_id: patientId, status: 'uploaded', image_data_encrypted: {} }, 503],
  ]) {
    const pool = documentPool({ document });
    await withEndpoints(pool, provider, async (get) => {
      const response = await get(readUrl);
      assert.equal(response.status, status);
      assert.equal((await response.json()).submission, undefined);
    });
    assert.equal(pool.calls.some((call) => call.sql.includes('INSERT INTO audit_logs')), false);
  }
});

test('provider document responses fail closed when durable PHI audit storage fails', async () => {
  await withEndpoints(documentPool({ failAudit: true }), provider, async (get) => {
    for (const url of [listUrl, readUrl]) {
      const response = await get(url);
      assert.equal(response.status, 503);
      const body = await response.json();
      assert.equal(body.submission, undefined); assert.equal(body.submissions, undefined);
      assert.equal(JSON.stringify(body).includes('Instructions for professional review'), false);
    }
  });
});

test('patient image responses enforce ownership and preserve private PNG response headers', async () => {
  const image = await sharp({ create: { width: 20, height: 20, channels: 3, background: '#ffffff' } }).png().toBuffer();
  const document = { id: submissionId, patient_user_id: patientId, image_data_encrypted: encrypt(image.toString('base64')) };
  const pool = documentPool({ document });
  const imageUrl = `/api/ng/patient/prescriptions/${submissionId}/image`;
  await withEndpoints(pool, { id: otherPatientId, role: 'patient' }, async (get) => { assert.equal((await get(imageUrl)).status, 404); });
  await withEndpoints(pool, { id: patientId, role: 'patient' }, async (get) => {
    const response = await get(imageUrl);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'image/png');
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), image);
  });
  assert.equal(pool.calls.filter((call) => call.sql.includes('INSERT INTO audit_logs')).length, 1);
});
