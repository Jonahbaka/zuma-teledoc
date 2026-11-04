'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { fixtureTargetSafety } = require('../scripts/fixtureTargetSafety');
const crypto = require('crypto');
const sharp = require('sharp');
const service = require('../services/rx-engine/privatePrescriptionUploadService');

test('prescription image boundary rejects SVG, MIME spoofing, empty and oversized files', async () => {
  for (const file of [null, { buffer:Buffer.from('<svg></svg>'),mimetype:'image/svg+xml' }, { buffer:Buffer.from('not a PNG'),mimetype:'image/png' }, { buffer:Buffer.alloc(service.MAX_IMAGE_BYTES+1),mimetype:'image/png' }]) {
    await assert.rejects(service.normalizeImage(file), (error) => error.status === 400);
  }
});
test('accepted prescription photos are decoded and re-encoded as bounded PNG without metadata', async () => {
  const buffer = await sharp({ create: { width:20,height:20,channels:3,background:'#ffffff' } }).jpeg().toBuffer();
  const clean = await service.normalizeImage({ buffer,mimetype:'image/jpeg' });
  const metadata = await sharp(clean).metadata();
  assert.equal(metadata.format,'png'); assert.equal(metadata.width,20); assert.equal(metadata.exif,undefined);
  await assert.rejects(service.normalizeImage({ buffer,mimetype:'image/png' }), (error) => error.status === 400);
});
test('private submissions fail before database access without encryption or a valid retry reference', async () => {
  const previous = process.env.ENCRYPTION_KEY;
  const pool = { connect() { throw new Error('Database must not be used'); } };
  try {
    delete process.env.ENCRYPTION_KEY;
    await assert.rejects(service.saveSubmission(pool,{user:{id:crypto.randomUUID()}},{text:'test'}), (error) => error.status === 503);
    process.env.ENCRYPTION_KEY='0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
    await assert.rejects(service.saveSubmission(pool,{user:{id:crypto.randomUUID()},headers:{'idempotency-key':'invalid'}},{text:'test'}), (error) => error.status === 400);
  } finally { if (previous === undefined) delete process.env.ENCRYPTION_KEY; else process.env.ENCRYPTION_KEY=previous; }
});

test('idempotent submissions preserve the stored status and do not restart completed review', async () => {
  const previous = process.env.ENCRYPTION_KEY;
  process.env.ENCRYPTION_KEY ||= '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  const id = crypto.randomUUID();
  try {
    for (const status of ['uploaded', 'parsing', 'parsed', 'verified', 'matched', 'dispensing', 'dispensed', 'rejected', 'expired']) {
      const connection = {
        async query(sql) {
          if (sql.includes('SELECT id FROM users')) return { rows: [{ id }] };
          if (sql.includes('INSERT INTO ng_prescriptions')) return { rows: [{ id, status }] };
          return { rows: [] };
        },
        release() {},
      };
      const result = await service.saveSubmission({ connect: async () => connection }, {
        user: { id }, headers: { 'idempotency-key': crypto.randomUUID() },
      }, { text: 'Review fixture instructions' });
      assert.equal(result.status, status);
      assert.equal(result.requiresVerification, ['uploaded', 'parsing', 'parsed'].includes(status));
    }
  } finally { if (previous === undefined) delete process.env.ENCRYPTION_KEY; else process.env.ENCRYPTION_KEY = previous; }
});

const target = process.env.SIMULATION_DATABASE_URL;
test('PostgreSQL private submission preserves encryption, pending review, retry identity and ownership', { skip: !target }, async () => {
  const safety = fixtureTargetSafety({ source: 'SIMULATION_DATABASE_URL' });
  assert.equal(safety.skipped, false, safety.reason);
  const { Pool } = require('pg');
  const pool = new Pool({ connectionString:target });
  const poolSafety = fixtureTargetSafety({ source: 'SIMULATION_DATABASE_URL', pool });
  assert.equal(poolSafety.skipped, false, poolSafety.reason);
  const client = await pool.connect();
  const previous = process.env.ENCRYPTION_KEY;
  process.env.ENCRYPTION_KEY ||= '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  try {
    await client.query('BEGIN');
    // All test writes are rolled back; reuse existing accounts without seeding.
    const account = (await client.query("SELECT id FROM users WHERE email='patient@demo.doctarx.com' AND role='patient' AND market_scope='NG'")).rows[0];
    const other = (await client.query("SELECT id FROM users WHERE email='government@demo.doctarx.com' AND role='patient' AND market_scope='NG'")).rows[0];
    const provider = (await client.query("SELECT u.id, p.id AS provider_id FROM users u JOIN ng_providers p ON p.user_id=u.id WHERE u.email='doctor@demo.doctarx.com' AND u.role='provider' AND u.market_scope='NG' AND u.provider_status='approved' AND p.status='verified'")).rows[0];
    assert.ok(account && other && provider, 'Provision the existing DoctaRx demo accounts before this database test');
    const connection = { query: (sql,params) => ['BEGIN','COMMIT','ROLLBACK'].includes(sql) ? Promise.resolve({rows:[]}) : client.query(sql,params), release() {} };
    const transactionalPool = { connect:async () => connection, query:connection.query };
    const key = crypto.randomUUID();
    const req = { user:{id:account.id},headers:{'idempotency-key':key} };
    const buffer = await sharp({ create:{width:20,height:20,channels:3,background:'#ffffff'} }).png().toBuffer();
    const first = await service.saveSubmission(transactionalPool,req,{image:{buffer,mimetype:'image/png'}});
    const repeat = await service.saveSubmission(transactionalPool,req,{image:{buffer,mimetype:'image/png'}});
    assert.equal(first.prescriptionId,repeat.prescriptionId); assert.equal(first.status,'uploaded'); assert.equal(first.requiresVerification,true);
    const stored = (await client.query('SELECT * FROM ng_prescriptions WHERE id=$1',[first.prescriptionId])).rows[0];
    assert.ok(stored.image_data_encrypted.encrypted); assert.notEqual(stored.image_data_encrypted.encrypted,buffer.toString('base64')); assert.equal(stored.image_url,null); assert.equal(stored.verified_at,null); assert.deepEqual(stored.items,[]);
    assert.equal((await client.query('SELECT COUNT(*) FROM ng_prescriptions WHERE patient_user_id=$1 AND submission_key=$2',[account.id,key])).rows[0].count,'1');
    assert.ok((await service.readOwnedImage(transactionalPool,req,first.prescriptionId)).length);
    await assert.rejects(service.readOwnedImage(transactionalPool,{user:{id:other.id}},first.prescriptionId),(error) => error.status === 404);
    await assert.rejects(service.saveSubmission(transactionalPool,req,{text:'Different retry content'}),(error) => error.status === 409);
    // This appointment and every submission/audit below are rolled back. No
    // account, password, provider approval, or existing care record is changed.
    await client.query(
      `INSERT INTO ng_appointments (patient_user_id,provider_id,scheduled_at,status,consult_fee,total_amount)
       VALUES ($1,$2,'2099-06-15T12:00:00Z','confirmed',0,0)`, [account.id, provider.provider_id]
    );
    const providerReq = { user: { id: provider.id, role: 'provider' }, headers: {} };
    const providerQueries = [];
    const providerConnection = { query: (sql, params) => { providerQueries.push(sql); return connection.query(sql, params); }, release() {} };
    const providerPool = { connect: async () => providerConnection, query: providerConnection.query };
    const listed = await service.listProviderSubmissions(providerPool, providerReq, account.id);
    assert.ok(listed.some((row) => row.id === first.prescriptionId && row.has_image));
    const opened = await service.readProviderSubmission(providerPool, providerReq, account.id, first.prescriptionId);
    assert.equal(opened.imageBase64, (await service.normalizeImage({ buffer, mimetype: 'image/png' })).toString('base64'));
    assert.equal(providerQueries.some((sql) => /\bFROM appointments\b/i.test(sql)), false, 'Native NG access must not use legacy appointment IDs');
    await assert.rejects(service.readProviderSubmission(providerPool, { user: { id: other.id, role: 'provider' } }, account.id, first.prescriptionId), (error) => error.status === 403);
    const another = await service.saveSubmission(transactionalPool, { user: { id: other.id }, headers: { 'idempotency-key': crypto.randomUUID() } }, { text: 'Other patient review fixture' });
    await assert.rejects(service.readProviderSubmission(providerPool, providerReq, account.id, another.prescriptionId), (error) => error.status === 404);
    for (const status of ['verified', 'rejected']) {
      await client.query('UPDATE ng_prescriptions SET status=$1 WHERE id=$2', [status, first.prescriptionId]);
      const retry = await service.saveSubmission(transactionalPool, req, { image: { buffer, mimetype: 'image/png' } });
      assert.equal(retry.prescriptionId, first.prescriptionId); assert.equal(retry.status, status); assert.equal(retry.requiresVerification, false);
    }
    const readsBefore = (await client.query("SELECT COUNT(*) FROM audit_logs WHERE resource_id=$1 AND action='read'", [first.prescriptionId])).rows[0].count;
    await client.query("UPDATE ng_prescriptions SET image_data_encrypted=jsonb_set(image_data_encrypted,'{tag}','\"00000000000000000000000000000000\"') WHERE id=$1", [first.prescriptionId]);
    await assert.rejects(service.readProviderSubmission(providerPool, providerReq, account.id, first.prescriptionId), (error) => error.status === 503);
    await assert.rejects(service.readOwnedImage(transactionalPool, req, first.prescriptionId), (error) => error.status === 503);
    assert.equal((await client.query("SELECT COUNT(*) FROM audit_logs WHERE resource_id=$1 AND action='read'", [first.prescriptionId])).rows[0].count, readsBefore, 'Failed decryption must not report a successful read');
    await client.query('UPDATE ng_prescriptions SET image_data_encrypted=NULL, submitted_text_encrypted=NULL WHERE id=$1', [first.prescriptionId]);
    await assert.rejects(service.readProviderSubmission(providerPool, providerReq, account.id, first.prescriptionId), (error) => error.status === 404);
  } finally { await client.query('ROLLBACK'); client.release(); await pool.end(); if(previous===undefined) delete process.env.ENCRYPTION_KEY; else process.env.ENCRYPTION_KEY=previous; }
});

test('PostgreSQL submission contention and receipt lookup preserve exact intent without content deduplication', { skip: !target }, async () => {
  const safety = fixtureTargetSafety({ source: 'SIMULATION_DATABASE_URL' });
  assert.equal(safety.skipped, false, safety.reason);
  const { Pool } = require('pg'); const pool = new Pool({ connectionString: target, statement_timeout: 15000 });
  const poolSafety = fixtureTargetSafety({ source: 'SIMULATION_DATABASE_URL', pool });
  assert.equal(poolSafety.skipped, false, poolSafety.reason);
  const first = await pool.connect(), second = await pool.connect();
  const key = crypto.randomUUID(), newKey = crypto.randomUUID(); let patient, secondPromise;
  const previous = process.env.ENCRYPTION_KEY;
  process.env.ENCRYPTION_KEY ||= '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  try {
    patient = (await pool.query("SELECT id FROM users WHERE email='patient@demo.doctarx.com' AND role='patient' AND market_scope='NG' AND is_active=true")).rows[0]; assert.ok(patient);
    const req = { user: { id: patient.id }, headers: { 'idempotency-key': key } };
    await first.query('BEGIN');
    const held = { query: (sql, params) => ['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql) ? Promise.resolve({ rows: [] }) : first.query(sql, params), release() {} };
    const saved = await service.saveSubmission({ connect: async () => held }, req, { text: 'Synthetic concurrency prescription instructions' });
    await assert.rejects(service.readSubmissionReceipt(pool, req, key), error => error.status === 404);
    const pid = (await second.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    const competing = { query: (sql, params) => second.query(sql, params), release() {} };
    secondPromise = service.saveSubmission({ connect: async () => competing }, req, { text: 'Synthetic concurrency prescription instructions' });
    // Observe a real blocked unique-index lock before releasing the first writer.
    let blocked = false; const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      const lock = await pool.query('SELECT 1 FROM pg_locks WHERE pid=$1 AND NOT granted', [pid]);
      if (lock.rows.length) { blocked = true; break; }
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    assert.equal(blocked, true, 'same-key writer must contend on the in-flight insert');
    await first.query('COMMIT');
    const repeat = await secondPromise; secondPromise = null;
    assert.equal(repeat.prescriptionId, saved.prescriptionId);
    assert.equal((await service.readSubmissionReceipt(pool, req, key)).prescriptionId, saved.prescriptionId);
    await assert.rejects(service.saveSubmission(pool, req, { text: 'Changed synthetic intent' }), error => error.status === 409);
    const distinct = await service.saveSubmission(pool, { ...req, headers: { 'idempotency-key': newKey } }, { text: 'Synthetic concurrency prescription instructions' });
    assert.notEqual(distinct.prescriptionId, saved.prescriptionId, 'a genuinely new key is not global content deduplication');
  } finally {
    await first.query('ROLLBACK');
    if (secondPromise) await secondPromise.catch(() => {});
    if (patient) {
      await pool.query("DELETE FROM audit_logs WHERE resource_type='prescription_submission' AND resource_id IN (SELECT id FROM ng_prescriptions WHERE patient_user_id=$1 AND submission_key=ANY($2::uuid[]))", [patient.id, [key, newKey]]);
      await pool.query('DELETE FROM ng_prescriptions WHERE patient_user_id=$1 AND submission_key=ANY($2::uuid[])', [patient.id, [key, newKey]]);
    }
    first.release(); second.release(); await pool.end();
    if (previous === undefined) delete process.env.ENCRYPTION_KEY; else process.env.ENCRYPTION_KEY = previous;
  }
});
test('only validation failures before database mutation certify an unstarted submission', async () => {
  const previous = process.env.ENCRYPTION_KEY; process.env.ENCRYPTION_KEY ||= '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  try {
    let connects = 0; const pool = { connect() { connects++; throw new Error('Database unavailable'); } };
    const req = { user: { id: crypto.randomUUID() }, headers: { 'idempotency-key': crypto.randomUUID() } };
    for (const payload of [{ image: { buffer: Buffer.from('invalid'), mimetype: 'image/png' } }, { text: ' ' }]) {
      await assert.rejects(service.saveSubmission(pool, req, payload), error => error.status === 400 && error.submissionNotStarted === true);
    }
    assert.equal(connects, 0);
    await assert.rejects(service.saveSubmission(pool, req, { text: 'Synthetic valid input' }), error => error.submissionNotStarted === undefined);
  } finally { if (previous === undefined) delete process.env.ENCRYPTION_KEY; else process.env.ENCRYPTION_KEY = previous; }
});
