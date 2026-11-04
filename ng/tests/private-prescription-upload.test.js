'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
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
  const url = new URL(target);
  assert.ok(['localhost','127.0.0.1'].includes(url.hostname) && url.pathname.endsWith('_test'), 'Only isolated loopback test databases are accepted');
  const { Pool } = require('pg');
  const pool = new Pool({ connectionString:target });
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
    const providerPool = { query: (sql, params) => { providerQueries.push(sql); return client.query(sql, params); } };
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
