'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { saveAuthorizedMessage, markReturnedMessagesRead } = require('../services/messageIntegrity');
const { fixtureTargetSafety } = require('../../ng/scripts/fixtureTargetSafety');
const senderId = crypto.randomUUID(), recipientId = crypto.randomUUID(), otherId = crypto.randomUUID();
const key = crypto.randomBytes(32);
const encrypt = text => { const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv('aes-256-gcm', key, iv); return { encrypted: Buffer.concat([cipher.update(text), cipher.final()]).toString('base64'), iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64') }; };
const decrypt = (text, iv, tag) => { const cipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64')); cipher.setAuthTag(Buffer.from(tag, 'base64')); return Buffer.concat([cipher.update(Buffer.from(text, 'base64')), cipher.final()]).toString(); };
const intent = () => ({ recipientId, content: 'Synthetic clinical message', isUrgent: false, clientMessageId: crypto.randomUUID() });
function fixture() {
  const state = { rows: [], queries: [], committed: false, race: null, active: true };
  const client = { async query(sql, values = []) {
    state.queries.push(sql);
    if (sql.includes('FROM users')) return { rows: [senderId, recipientId, otherId].map(id => ({ id, role: id === senderId ? 'provider' : 'patient', is_active: state.active, market_scope: 'NG' })) };
    if (sql.includes('FROM appointments')) return { rows: [] };
    if (sql.includes('FROM provider_patient_relationships')) return { rows: [{ id: 'synthetic-relationship' }] };
    if (sql.startsWith('SELECT * FROM messages')) return { rows: state.rows.filter(row => row.sender_id === values[0] && row.client_message_id === values[1]) };
    if (sql.startsWith('INSERT INTO messages')) {
      if (state.race) { state.rows.push(state.race); state.race = null; throw Object.assign(new Error('synthetic unique collision'), { code: '23505' }); }
      const fields = ['conversation_id','sender_id','recipient_id','content_encrypted','content_iv','content_tag','is_urgent','has_attachment','attachment_name','attachment_type','client_message_id'];
      const row = { id: crypto.randomUUID(), status: 'sent', created_at: new Date().toISOString() };
      fields.forEach((name,index) => { row[name] = values[index]; }); state.rows.push(row); return { rows: [row] };
    }
    if (/^(SAVEPOINT|RELEASE SAVEPOINT|ROLLBACK TO SAVEPOINT)/.test(sql)) return { rows: [] };
    throw new Error('Unexpected synthetic query: ' + sql);
  } };
  const db = { transaction: async work => { const result = await work(client); state.committed = true; return result; } };
  return { state, db, save: input => saveAuthorizedMessage({ db, senderId, input, encrypt, decrypt }) };
}
test('exact encrypted-stored retries return the same canonical public message; changed intent conflicts', async () => {
  const f = fixture(), input = intent(); const first = await f.save(input);
  assert.equal(first.deduplicated, false); assert.equal(first.message.content, input.content);
  assert.notEqual(f.state.rows[0].content_encrypted, input.content);
  assert.equal((await f.save({ ...input, content: '  ' + input.content + '\0  ' })).message.id, first.message.id);
  for (const change of [{ recipientId: otherId }, { content: 'Changed instruction' }, { isUrgent: true }, { attachmentName: 'scan.pdf' }, { attachmentType: 'application/pdf' }]) {
    await assert.rejects(f.save({ ...input, ...change }), { status: 409 });
  }
  assert.equal(f.state.rows.length, 1);
  assert.doesNotMatch(JSON.stringify(first.message), /content_encrypted|content_iv|content_tag|client_message_id/);
  assert.ok(f.state.queries.some(sql => /FROM users/.test(sql) && /ORDER BY id FOR SHARE/.test(sql)));
  assert.ok(f.state.queries.some(sql => /provider_patient_relationships/.test(sql) && /FOR SHARE/.test(sql)));
});
test('23505 recovery restores savepoint before comparing the winner and never silently accepts mismatch', async () => {
  for (const mismatch of [false, true]) {
    const seed = fixture(), input = intent(); await seed.save(input);
    const f = fixture(); f.state.race = seed.state.rows[0];
    if (mismatch) await assert.rejects(f.save({ ...input, content: 'Different intent' }), { status: 409 });
    else assert.equal((await f.save(input)).deduplicated, true);
    const rollback = f.state.queries.indexOf('ROLLBACK TO SAVEPOINT message_insert');
    assert.ok(rollback > 0); assert.match(f.state.queries[rollback + 2], /SELECT \* FROM messages/);
  }
});
test('inactive account fails before encryption/persistence', async () => {
  const f = fixture(); f.state.active = false;
  await assert.rejects(f.save(intent()), { status: 403 });
  assert.equal(f.state.rows.length, 0);
});
function routeHandlers(stubs) {
  const filename = require.resolve('../routes/messages');
  const actualRequire = createRequire(filename), handlers = new Map();
  const router = {}; for (const method of ['post','get','put','delete']) router[method] = (path, ...chain) => handlers.set(method + ' ' + path, chain.at(-1));
  const dependencies = { express: { Router: () => router }, 'express-rate-limit': () => (_req,_res,next) => next(),
    '../middleware/auth': { authenticate() {} }, '../middleware/audit': { auditMiddleware: () => () => {} },
    '../middleware/logger': { info() {}, warn() {}, error() {} }, ...stubs };
  const routeModule = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), { require: name => dependencies[name] || actualRequire(name), module: routeModule, exports: routeModule.exports, console });
  return handlers;
}
function response() { return { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } }; }
test('actual POST handler returns saved201 despite notification failure and does not repeat dispatch on retry', async () => {
  const f = fixture(); let notifications = 0, emits = 0;
  const routes = routeHandlers({ '../db': f.db, '../../lib/encryption': { encrypt, decrypt },
    '../services/notifications': { sendMessageNotification: async () => { notifications++; assert.equal(f.state.committed, true); throw new Error('Synthetic outage'); } },
    '../services/socketService': { emitNewMessage: () => { emits++; assert.equal(f.state.committed, true); } } });
  const req = { body: intent(), user: { id: senderId, firstName: 'Synthetic' } };
  const first = response(); await routes.get('post /')(req, first);
  assert.equal(first.statusCode, 201); assert.equal(first.body.dispatch.notification, 'failed'); assert.equal(first.body.dispatch.realtime, 'scheduled');
  const retry = response(); await routes.get('post /')(req, retry);
  assert.equal(retry.statusCode, 200); assert.equal(retry.body.data.id, first.body.data.id); assert.equal(notifications, 1); assert.equal(emits, 1);
  const conflict = response(); await routes.get('post /')({ ...req, body: { ...req.body, content: 'Changed' } }, conflict); assert.equal(conflict.statusCode, 409);
});
test('saved response does not await an idle socket refresh and late rejection is contained', async () => {
  const f=fixture(); let rejectDelivery;
  const routes=routeHandlers({ '../db':f.db, '../../lib/encryption':{encrypt,decrypt},
    '../services/notifications':{sendMessageNotification:async()=>({id:'notification'})},
    '../services/socketService':{emitNewMessage:()=>new Promise((_resolve,reject)=>{rejectDelivery=reject;})} });
  const res=response(); await routes.get('post /')({body:intent(),user:{id:senderId}},res);
  assert.equal(res.statusCode,201);assert.equal(res.body.dispatch.realtime,'scheduled');
  rejectDelivery(new Error('Synthetic expired receiver timeout'));await new Promise(resolve=>setImmediate(resolve));
  assert.equal(f.state.rows.length,1);
});
test('actual paginated GET marks only decrypted returned messages, not unseen or unreadable rows', async () => {
  const good = crypto.randomUUID(), unreadable = crypto.randomUUID(); let marked;
  const rows = [{ id: good, content_encrypted: 'valid', recipient_id: recipientId, sender_id: senderId, status: 'sent' }, { id: unreadable, content_encrypted: 'broken', recipient_id: recipientId, sender_id: senderId, status: 'sent' }];
  const db = { async query(sql, values) {
    if (sql.includes('COUNT(*)')) return { rows: [{ count: 70 }] };
    if (sql.includes('SELECT m.*')) return { rows };
    if (sql.startsWith('UPDATE messages')) { marked = values[0]; assert.match(sql, /COALESCE\(read_at,NOW\(\)\)/); assert.equal(values[1], recipientId); return { rows: [{ id: good, status: 'read', read_at: 'first-read' }] }; }
    throw Error(sql);
  } };
  const handlers = routeHandlers({ '../db': db, '../services/notifications': {}, '../services/socketService': {},
    '../services/messageAuthorization': { assertMessagingRelationship: async () => ({ conversationId: crypto.randomUUID() }) },
    '../../lib/encryption': { encrypt, decrypt: content => { if (content === 'broken') throw Error('Synthetic unreadable'); return 'Readable'; } } });
  const res = response(); await handlers.get('get /conversation/:recipientId')({ params: { recipientId: senderId }, query: { page: '1', limit: '2' }, user: { id: recipientId } }, res);
  assert.equal(res.statusCode, 200); assert.deepEqual(Array.from(marked), [good]); assert.equal(res.body.messages.find(row => row.id === good).readAt, 'first-read');
  assert.equal(res.body.messages.find(row => row.id === unreadable).status, 'sent');
});

const target = process.env.SIMULATION_DATABASE_URL;
test('PostgreSQL same-key races, authority revocation and read-page isolation', { skip: !target, timeout: 45000 }, async () => {
  const safety = fixtureTargetSafety({ env: { ...process.env, DATABASE_URL: target } });
  assert.equal(safety.skipped, false, safety.reason);
  const { Pool } = require('pg'); const pool = new Pool({ connectionString: target, max: 6, statement_timeout: 10000 });
  const ids = [crypto.randomUUID(), crypto.randomUUID()]; let relationship;
  const db = { transaction: async work => { const client = await pool.connect(); try { await client.query('BEGIN'); const result = await work(client); await client.query('COMMIT'); return result; } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); } } };
  const input = { ...intent(), recipientId: ids[1] };
  const save = value => saveAuthorizedMessage({ db, senderId: ids[0], input: value, encrypt, decrypt });
  try {
    for (const [index,id] of ids.entries()) await pool.query("INSERT INTO users(id,email,password_hash,role,first_name,last_name,is_active,is_test_account,market_scope) VALUES($1,$2,'!synthetic', $3,'Synthetic','Message',TRUE,TRUE,'NG')", [id, `message-${id}@example.invalid`, index ? 'patient' : 'provider']);
    relationship = (await pool.query('INSERT INTO provider_patient_relationships(patient_id,provider_id,is_active) VALUES($1,$2,TRUE) RETURNING id', [ids[1],ids[0]])).rows[0].id;
    const exact = await Promise.all([save(input), save(input)]); assert.equal(exact[0].message.id, exact[1].message.id); assert.equal(exact.filter(value => !value.deduplicated).length, 1);
    const collision = { ...input, clientMessageId: crypto.randomUUID() };
    const conflicts = await Promise.allSettled([save(collision), save({ ...collision, content: 'Different clinical intent' })]);
    assert.equal(conflicts.filter(result => result.status === 'fulfilled').length, 1); assert.equal(conflicts.find(result => result.status === 'rejected').reason.status, 409);
    const blocker = await pool.connect();
    try {
      await blocker.query('BEGIN'); await blocker.query('UPDATE provider_patient_relationships SET is_active=FALSE WHERE id=$1', [relationship]);
      const blockerPid = (await blocker.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
      const pending = save({ ...input, clientMessageId: crypto.randomUUID() });
      const rejected = assert.rejects(pending, { status: 403 });
      rejected.catch(() => {}); // Keep teardown errors from becoming unhandled if the lock assertion fails.
      let waiting = false; const deadline = Date.now()+5000;
      while(Date.now()<deadline) {
        waiting = (await pool.query(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity
          WHERE datname=current_database() AND wait_event_type='Lock'
            AND $1=ANY(pg_blocking_pids(pid))) AS waiting`, [blockerPid])).rows[0].waiting;
        if(waiting) break;
        await new Promise(resolve=>setTimeout(resolve,20));
      }
      assert.equal(waiting,true,'Save must actually wait on the uncommitted care revocation');
      await blocker.query('COMMIT'); await rejected;
    } finally { await blocker.query('ROLLBACK'); blocker.release(); }
    const visibleId = exact[0].message.id;
    await markReturnedMessagesRead(pool, ids[1], [visibleId]);
    const first = (await pool.query('SELECT read_at FROM messages WHERE id=$1', [visibleId])).rows[0].read_at;
    await markReturnedMessagesRead(pool, ids[1], [visibleId]);
    assert.equal((await pool.query('SELECT read_at FROM messages WHERE id=$1', [visibleId])).rows[0].read_at.getTime(), first.getTime());
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM messages WHERE sender_id=$1 AND status!='read'", [ids[0]])).rows[0].n, 1);
  } finally {
    await pool.query('DELETE FROM messages WHERE sender_id=ANY($1::uuid[])', [ids]);
    await pool.query('DELETE FROM provider_patient_relationships WHERE provider_id=$1', [ids[0]]);
    await pool.query('DELETE FROM users WHERE id=ANY($1::uuid[])', [ids]); await pool.end();
  }
});
