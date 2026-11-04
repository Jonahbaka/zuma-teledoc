'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { Pool } = require('pg');
const delivery = require('../services/public-health/dhis2DeliveryService');

const target = process.env.SIMULATION_DATABASE_URL;
const baseUrl = 'https://dhis2-rollback-control.example.invalid';
const payload = { dataSet: 'a1234567890', orgUnit: 'b1234567890', period: '202609', dataValues: [{ dataElement: 'c1234567890', value: 0 }] };
const remoteValues = () => ({ ok: true, json: async () => ({ ...payload, dataValues: [{ dataElement: 'c1234567890', orgUnit: payload.orgUnit, period: payload.period, value: '0' }] }) });
const imported = () => ({ status: 200, json: async () => ({ status: 'SUCCESS', importCount: { imported: 1, updated: 0, ignored: 0 } }) });

async function withRetainedJob(run) {
  const url = new URL(target);
  assert.ok(['localhost', '127.0.0.1'].includes(url.hostname) && url.pathname.endsWith('_test'), 'Use an isolated loopback database ending in _test');
  const database = new Pool({ connectionString: target });
  const client = await database.connect();
  let serial = 0;
  const reportIds = [crypto.randomUUID(), crypto.randomUUID()];
  const isolated = {
    query: (sql, parameters) => client.query(sql, parameters),
    async connect() {
      const savepoint = 'dhis2_integrity_' + (++serial);
      return { async query(sql, parameters) {
        if (sql === 'BEGIN') return client.query('SAVEPOINT ' + savepoint);
        if (sql === 'COMMIT') return client.query('RELEASE SAVEPOINT ' + savepoint);
        if (sql === 'ROLLBACK') { await client.query('ROLLBACK TO SAVEPOINT ' + savepoint); return client.query('RELEASE SAVEPOINT ' + savepoint); }
        return client.query(sql, parameters);
      }, release() {} };
    },
  };
  try {
    await client.query('BEGIN');
    await client.query(fs.readFileSync(path.join(__dirname, '../migrations/028_ng_dhis2_delivery_operations.sql'), 'utf8'));
    const author = (await client.query("SELECT id FROM users WHERE email='doctor@demo.doctarx.com' AND role='provider' AND is_active=TRUE")).rows[0];
    const approver = (await client.query("SELECT id FROM users WHERE email='admin@demo.doctarx.com' AND role='super_admin' AND is_active=TRUE")).rows[0];
    assert.ok(author && approver && author.id !== approver.id, 'Reuse existing provisioned accounts without seeding or password changes');
    for (const id of reportIds) await client.query(`INSERT INTO public_health_reports(id,report_period,status,generated_by,approved_by,approved_at)
      VALUES($1,'2026-09','approved',$2,$3,NOW())`, [id, author.id, approver.id]);
    const report = (await client.query('SELECT * FROM public_health_reports WHERE id=$1', [reportIds[0]])).rows[0];
    const payloadHash = crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
    const job = await delivery.enqueueDelivery(isolated, { report, payload, payloadHash,
      destinationHash: delivery.destinationIdentity(baseUrl, null, payload), actorUserId: approver.id });
    await run({ isolated, client, job, foreignReportId: reportIds[1], author, approver });
  } finally {
    await client.query('ROLLBACK');
    const retained = await client.query('SELECT id FROM public_health_reports WHERE id=ANY($1::uuid[])', [reportIds]);
    assert.deepEqual(retained.rows, [], 'All reports, delivery jobs and sync logs must roll back');
    client.release(); await database.end();
  }
}

test('stale queued objects cannot resubmit an ambiguous import or forge destination/report/audit identity', { skip: !target }, async () => {
  await withRetainedJob(async ({ isolated, client, job, foreignReportId, author, approver }) => {
    let posts = 0; let reads = 0;
    const interrupted = await delivery.deliverOrReconcile(isolated, job, { baseUrl, apiToken: 'isolated-no-live-token', fetchImpl: async (_url, options) => {
      assert.equal(options.method, 'POST'); posts++; throw new Error('Isolated transport ambiguity');
    } });
    assert.equal(interrupted.delivery.status, 'reconciliation');
    await client.query('UPDATE ng_dhis2_delivery_jobs SET next_attempt_at=NOW() WHERE id=$1', [job.id]);
    const wrongBase = 'https://unapproved-destination.example.invalid';
    const stale = { ...job, report_id: foreignReportId, payload_hash: 'f'.repeat(64), created_by: author.id,
      payload_json: { ...payload, orgUnit: 'd1234567890' }, destination_hash: delivery.destinationIdentity(wrongBase, null, { ...payload, orgUnit: 'd1234567890' }) };
    await assert.rejects(delivery.deliverOrReconcile(isolated, stale, { baseUrl: wrongBase, apiToken: 'isolated-no-live-token', fetchImpl: async () => {
      throw new Error('Unapproved destination must not make a network call');
    } }), { code: 'DHIS2_DELIVERY_CONFLICT' });
    const recovered = await delivery.deliverOrReconcile(isolated, stale, { baseUrl, apiToken: 'isolated-no-live-token', fetchImpl: async (value, options) => {
      if (options.method === 'POST') { posts++; return imported(); }
      const read = new URL(value); assert.equal(read.searchParams.get('orgUnit'), payload.orgUnit); reads++; return remoteValues();
    } });
    assert.equal(recovered.delivery.status, 'confirmed'); assert.equal(posts, 1); assert.equal(reads, 1);
    assert.equal((await client.query('SELECT status FROM public_health_reports WHERE id=$1', [job.report_id])).rows[0].status, 'synced');
    assert.equal((await client.query('SELECT status FROM public_health_reports WHERE id=$1', [foreignReportId])).rows[0].status, 'approved');
    const logs = (await client.query('SELECT report_id,request_payload_hash,attempted_by FROM dhis2_sync_logs WHERE report_id=$1', [job.report_id])).rows;
    assert.equal(logs.length, 2); assert.ok(logs.every(row => row.report_id === job.report_id && row.request_payload_hash === job.payload_hash && row.attempted_by === approver.id));
    const terminal = await delivery.deliverOrReconcile(isolated, job, { baseUrl, apiToken: 'isolated-no-live-token', fetchImpl: async () => {
      throw new Error('An actual confirmed job must not make another network call');
    } });
    assert.equal(terminal.ok, true); assert.equal(terminal.delivery.status, 'confirmed'); assert.equal(terminal.delivery.attempts, 2);
  });
});

test('a reclaimed expired lease reconciles without another POST and rejects the superseded lease result', { skip: !target }, async () => {
  await withRetainedJob(async ({ isolated, client, job }) => {
    let releasePost; let startedPost; let posts = 0;
    const pendingPost = new Promise(resolve => { releasePost = resolve; });
    const started = new Promise(resolve => { startedPost = resolve; });
    const first = delivery.deliverOrReconcile(isolated, job, { baseUrl, apiToken: 'isolated-no-live-token', fetchImpl: async (_url, options) => {
      if (options.method === 'POST') { posts++; startedPost(); await pendingPost; return imported(); }
      return remoteValues();
    } });
    first.catch(() => undefined);
    let timer;
    try {
      await Promise.race([started, new Promise((_resolve, reject) => { timer = setTimeout(() => reject(new Error('The isolated first POST did not start')), 5000); })]);
      const held = await delivery.deliverOrReconcile(isolated, job, { baseUrl, apiToken: 'isolated-no-live-token', fetchImpl: async () => {
        throw new Error('An unexpired lease must not make a second network call');
      } });
      assert.equal(held.pending, true); assert.equal(held.delivery.status, 'submitting'); assert.equal(held.delivery.attempts, 1);
      await client.query("UPDATE ng_dhis2_delivery_jobs SET lease_until=NOW()-interval '1 second' WHERE id=$1", [job.id]);
      const recovered = await delivery.deliverOrReconcile(isolated, job, { baseUrl, apiToken: 'isolated-no-live-token', fetchImpl: async (_url, options) => {
        if (options.method === 'POST') { posts++; return imported(); }
        return remoteValues();
      } });
      assert.equal(recovered.delivery.status, 'confirmed'); assert.equal(posts, 1);
      releasePost();
      await assert.rejects(first, { code: 'DHIS2_DELIVERY_CONFLICT' });
      const retained = (await client.query('SELECT status,attempts,lease_token FROM ng_dhis2_delivery_jobs WHERE id=$1', [job.id])).rows[0];
      assert.deepEqual(retained, { status: 'confirmed', attempts: 2, lease_token: null });
      assert.equal((await client.query('SELECT COUNT(*)::int AS count FROM dhis2_sync_logs WHERE report_id=$1', [job.report_id])).rows[0].count, 1);
    } finally { clearTimeout(timer); releasePost(); await Promise.allSettled([first]); }
  });
});

test('lease replacement or operator closure during authority checks prevents every stale external request', { skip: !target }, async () => {
  for (const action of ['replaced','closed']) await withRetainedJob(async ({ isolated, client, job }) => {
    let requests = 0;
    await assert.rejects(delivery.deliverOrReconcile(isolated, job, { baseUrl, apiToken: 'isolated-no-live-token',
      authorizeAttempt: async () => {
        if (action === 'closed') await client.query("UPDATE ng_dhis2_delivery_jobs SET status='failed',resolution_code='closed_unresolved',lease_token=NULL,lease_until=NULL WHERE id=$1", [job.id]);
        else await client.query("UPDATE ng_dhis2_delivery_jobs SET status='reconciliation',lease_token=$2,lease_until=NOW()+interval '90 seconds' WHERE id=$1", [job.id,crypto.randomUUID()]);
      }, fetchImpl: async () => { requests++; return remoteValues(); },
    }), { code: 'DHIS2_DELIVERY_CONFLICT' });
    assert.equal(requests,0,'A stale lease cannot make a POST or GET even though its authority check completed');
    const retained=(await client.query('SELECT status,resolution_code FROM ng_dhis2_delivery_jobs WHERE id=$1',[job.id])).rows[0];
    assert.equal(retained.status,action==='closed'?'failed':'reconciliation');
    assert.equal(retained.resolution_code,action==='closed'?'closed_unresolved':null);
    assert.equal((await client.query('SELECT COUNT(*)::int AS count FROM dhis2_sync_logs WHERE report_id=$1',[job.report_id])).rows[0].count,0);
  });
});
