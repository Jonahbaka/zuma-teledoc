'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const target = process.env.SIMULATION_DATABASE_URL;

test('CRM drafts and operator inbox decisions use actual migration schemas with atomic PostgreSQL audit rollback', { skip: !target }, async () => {
  const url = new URL(target);
  assert.ok(['localhost', '127.0.0.1'].includes(url.hostname) && url.pathname.endsWith('_test'));
  const { Pool } = require('pg'); const pool = new Pool({ connectionString: target }); const client = await pool.connect();
  const previousDatabase = process.env.DATABASE_URL; const previousSecret = process.env.JWT_ACCESS_SECRET;
  process.env.DATABASE_URL = target; process.env.JWT_ACCESS_SECRET = 'doctarx-isolated-crm-inbox-db-test-secret-32-chars';
  const db = require('../db'); const originalQuery = db.query; const originalTransaction = db.transaction;
  let failAudit = false; let serial = 0; let server;
  const diagnostics = [];
  try {
    await client.query('BEGIN');
    // TEMP tables use the real migration definitions and shadow persistent
    // tables only on this connection. No runtime defaults/seeds are executed.
    for (const [file, names] of [['300_crm_schema.sql', ['crm_campaigns', 'crm_email_templates']], ['500_agent_chat_credentials_schema.sql', ['ai_chat_messages']]]) {
      const source = fs.readFileSync(path.join(__dirname, '../db/migrations', file), 'utf8');
      for (const name of names) {
        const definition = source.match(new RegExp('CREATE TABLE IF NOT EXISTS ' + name + '\\s*\\([\\s\\S]*?\\n\\);'))?.[0];
        assert.ok(definition, 'Use the actual shipped ' + name + ' definition');
        await client.query(definition.replace('CREATE TABLE IF NOT EXISTS', 'CREATE TEMP TABLE'));
      }
    }
    await client.query('CREATE UNIQUE INDEX isolated_crm_template_name ON crm_email_templates(name)');
    const admin = (await client.query("SELECT id FROM users WHERE role='admin' AND is_active=TRUE ORDER BY id LIMIT 1")).rows[0];
    assert.ok(admin, 'Reuse a provisioned administrator account without changing it');
    const operatorId = crypto.randomUUID(); const otherRecipientId = crypto.randomUUID();
    await client.query(`INSERT INTO ai_chat_messages (id,sender_type,sender_id,sender_name,recipient_type,content)
      VALUES ($1,'agent','isolated-control','Recorded operator fixture','operator','Recorded test message'),
        ($2,'operator','isolated-control','Recorded other-recipient fixture','agent','Other recipient message')`, [operatorId, otherRecipientId]);
    db.query = (sql, params) => client.query(sql, params);
    db.transaction = async work => {
      const savepoint = 'recorded_action_' + (++serial); await client.query('SAVEPOINT ' + savepoint);
      try {
        const result = await work({ async query(sql, params) {
          if (failAudit && sql.includes('INSERT INTO audit_logs')) throw new Error('Isolated injected audit failure');
          try { return await client.query(sql, params); }
          catch (error) { diagnostics.push({ code: error.code, message: error.message }); throw error; }
        } });
        await client.query('RELEASE SAVEPOINT ' + savepoint); return result;
      } catch (error) {
        await client.query('ROLLBACK TO SAVEPOINT ' + savepoint); await client.query('RELEASE SAVEPOINT ' + savepoint); throw error;
      }
    };
    const express = require('express'); const jwt = require('jsonwebtoken'); const app = express(); app.use(express.json());
    const routeFile = require.resolve('../routes/crm'); const load = Module._load;
    try {
      Module._load = function isolatedCRMRouter(request, parent) {
        if (parent?.filename === routeFile && request === '../services/agent-orchestrator') return null;
        return load.apply(this, arguments);
      };
      app.use('/crm', require(routeFile));
    } finally { Module._load = load; }
    app.use('/inbox', require('../routes/inbox'));
    server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
    const token = jwt.sign({ userId: admin.id, role: 'patient' }, process.env.JWT_ACCESS_SECRET, { expiresIn: 600 });
    const request = async (endpoint, method = 'GET', body) => {
      const response = await fetch('http://127.0.0.1:' + server.address().port + endpoint, { method,
        headers: { authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
      return { status: response.status, body: await response.json() };
    };
    const campaign = { name: 'Authored isolated draft', subject_line: 'Authored subject', email_template: 'Authored body', campaign_type: 'newsletter', created_by: 'forged', status: 'approved' };
    const saved = await request('/crm/campaigns', 'POST', campaign);
    assert.equal(saved.status, 200, JSON.stringify(diagnostics)); assert.equal(saved.body.data.status, 'draft'); assert.equal(saved.body.data.created_by, admin.id);
    const audit = await client.query("SELECT action FROM audit_logs WHERE resource_id=$1 AND resource_type='crm_campaign'", [saved.body.data.id]);
    assert.equal(audit.rows[0].action, 'create');
    const template = { name: 'Authored isolated template', category: 'provider_invite', subject: 'Authored subject', body: 'Authored body' };
    assert.equal((await request('/crm/templates', 'POST', template)).status, 200);
    assert.equal((await request('/crm/templates', 'POST', template)).status, 409);
    failAudit = true;
    assert.equal((await request('/crm/campaigns', 'POST', { ...campaign, name: 'Failed isolated draft' })).status, 503);
    failAudit = false;
    assert.equal((await client.query('SELECT COUNT(*)::int AS count FROM crm_campaigns')).rows[0].count, 1, 'Draft/audit rollback does not retain an unaudited draft');
    assert.equal((await request('/crm/campaigns/' + crypto.randomUUID() + '/approve', 'POST', {})).status, 404);
    failAudit = true;
    assert.equal((await request('/crm/campaigns/' + saved.body.data.id + '/approve', 'POST', {})).status, 503);
    failAudit = false;
    assert.equal((await client.query('SELECT status FROM crm_campaigns WHERE id=$1', [saved.body.data.id])).rows[0].status, 'draft');
    const approved = await request('/crm/campaigns/' + saved.body.data.id + '/approve', 'POST', {});
    assert.equal(approved.status, 200); assert.equal(approved.body.data.status, 'approved');
    assert.equal((await request('/crm/campaigns/' + saved.body.data.id + '/approve', 'POST', {})).status, 409);
    const inbox = await request('/inbox'); assert.equal(inbox.status, 200); assert.deepEqual(inbox.body.data.items.map(row => row.id), [operatorId]);
    assert.equal((await request('/inbox/mark-read', 'POST', { ids: [operatorId, otherRecipientId] })).status, 404);
    assert.equal((await client.query('SELECT read_at FROM ai_chat_messages WHERE id=$1', [operatorId])).rows[0].read_at, null);
    assert.equal((await request('/inbox/' + otherRecipientId, 'DELETE')).status, 404);
    failAudit = true;
    assert.equal((await request('/inbox/' + operatorId, 'DELETE')).status, 503);
    failAudit = false;
    assert.equal((await client.query('SELECT COUNT(*)::int AS count FROM ai_chat_messages WHERE id=$1', [operatorId])).rows[0].count, 1);
    const marked = await request('/inbox/mark-read', 'POST', { ids: 'all' }); assert.equal(marked.body.data.marked, 1);
    assert.equal((await client.query('SELECT read_at FROM ai_chat_messages WHERE id=$1', [otherRecipientId])).rows[0].read_at, null);
    const deleted = await request('/inbox/delete-bulk', 'POST', { mode: 'all' }); assert.equal(deleted.body.data.deleted, 1);
    assert.deepEqual((await client.query('SELECT id FROM ai_chat_messages')).rows.map(row => row.id), [otherRecipientId]);
  } finally {
    if (server) await new Promise(resolve => server.close(resolve)); db.query = originalQuery; db.transaction = originalTransaction;
    await client.query('ROLLBACK'); client.release(); await pool.end();
    if (previousDatabase === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = previousDatabase;
    if (previousSecret === undefined) delete process.env.JWT_ACCESS_SECRET; else process.env.JWT_ACCESS_SECRET = previousSecret;
  }
});
