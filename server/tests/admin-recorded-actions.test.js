'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const Module = require('node:module');
const express = require('express');

const administrator = { id: '00000000-0000-4000-8000-000000000001', role: 'admin' };
const contactId = '00000000-0000-4000-8000-000000000002';
const operatorId = '00000000-0000-4000-8000-000000000003';
const clinicalId = '00000000-0000-4000-8000-000000000004';
let actor; let state; let transportCalls = 0; let smtpResult;
const calls = [];
const db = {
  async query(sql, params = []) {
    calls.push({ sql, params });
    if (state.outage) throw new Error('Private database host and recipient detail');
    if (sql.includes('SELECT role,is_active FROM users') || sql.includes('SELECT id,role,is_active FROM users')) return { rows: [{ ...administrator, role: state.currentRole || 'admin', is_active: true }], rowCount: 1 };
    if (sql.includes('INSERT INTO crm_campaigns')) {
      assert.ok(sql.includes("'draft'"));
      const row = { id: crypto.randomUUID(), name: params[0], campaign_type: params[2], subject_line: params[5], email_template: params[6], daily_limit: params[8], created_by: params[9], status: 'draft' };
      state.campaigns.push(row); return { rows: [row], rowCount: 1 };
    }
    if (sql.includes('INSERT INTO crm_email_templates')) {
      if (state.templates.some(row => row.name === params[0])) throw Object.assign(new Error('Private duplicate template detail'), { code: '23505' });
      const row = { id: crypto.randomUUID(), name: params[0], category: params[1], subject: params[2], body: params[3], created_by: params[4], is_active: true };
      state.templates.push(row); return { rows: [row], rowCount: 1 };
    }
    if (sql.includes('INSERT INTO audit_logs')) {
      if (state.auditOutage) throw new Error('Private audit storage detail');
      state.audit.push({ sql, params }); return { rows: [], rowCount: 1 };
    }
    if (sql.includes('FROM crm_campaigns')) return { rows: state.campaigns, rowCount: state.campaigns.length };
    if (sql.includes('FROM crm_email_templates')) return { rows: state.templates, rowCount: state.templates.length };
    if (sql.includes('FROM crm_contacts')) return { rows: [{ id: contactId, email: 'recorded-contact@example.invalid', first_name: 'Recorded', opt_out: false }], rowCount: 1 };
    if (sql.includes('INSERT INTO crm_interactions')) {
      if (state.interactionOutage) throw new Error('Private persistence detail');
      state.interactions.push({ contactId: params[0], type: 'email_sent', messageId: params[4] }); return { rows: [], rowCount: 1 };
    }
    if (sql.includes('UPDATE crm_contacts')) return { rows: [], rowCount: 1 };
    if (sql.includes('UPDATE crm_campaigns')) { state.runningUpdates++; return { rows: [], rowCount: 1 }; }
    if (sql.includes('ai_chat_messages')) {
      assert.ok(sql.includes("recipient_type = 'operator'"), 'Every inbox read/change must retain the operator recipient scope');
      const ids = Array.isArray(params[0]) ? params[0] : typeof params[0] === 'string' ? [params[0]] : null;
      const matching = state.items.filter(row => row.recipient_type === 'operator' && (!ids || ids.includes(row.id)) &&
        (!sql.includes('read_at IS NULL') || row.read_at === null) && (!sql.includes('read_at IS NOT NULL') || row.read_at !== null));
      if (sql.includes('COUNT(*)')) return { rows: [{ count: String(matching.length) }], rowCount: 1 };
      if (sql.startsWith('UPDATE')) matching.forEach(row => { row.read_at = 'recorded-read-time'; });
      if (sql.startsWith('DELETE')) state.items = state.items.filter(row => !matching.includes(row));
      return { rows: matching, rowCount: matching.length };
    }
    throw new Error('Unexpected operation in isolated admin action test');
  },
  async transaction(work) {
    const snapshot = structuredClone(state);
    try { const result = await work({ query: db.query }); state.commits++; return result; }
    catch (error) { state = { ...snapshot, rollbacks: snapshot.rollbacks + 1 }; throw error; }
  },
};

const serviceFile = require.resolve('../services/crmService');
const crmFile = require.resolve('../routes/crm');
const inboxFile = require.resolve('../routes/inbox');
const originalLoad = Module._load;
let crmService; let crmRouter; let inboxRouter;
try {
  Module._load = function isolatedDependencies(request, parent) {
    if ([serviceFile, crmFile, inboxFile].includes(parent?.filename)) {
      if (request === '../db') return db;
      if (request === 'nodemailer') return { createTransport: () => ({ async sendMail() { transportCalls++; return smtpResult; } }) };
      if (request === '../middleware/logger') return { error() {}, warn() {} };
      if (request === '../services/agent-orchestrator') return null;
      if (request === '../middleware/auth') return {
        authenticate(req, res, next) { if (!actor) return res.status(401).json({ success: false }); req.user = actor; next(); },
        requireRole: (...roles) => (req, res, next) => roles.flat().includes(req.user.role) ? next() : res.status(403).json({ success: false }),
      };
    }
    return originalLoad.apply(this, arguments);
  };
  delete require.cache[serviceFile]; delete require.cache[crmFile]; delete require.cache[inboxFile];
  crmService = require(serviceFile); crmRouter = require(crmFile); inboxRouter = require(inboxFile);
} finally { Module._load = originalLoad; }

function reset() {
  actor = administrator; calls.length = 0; transportCalls = 0;
  state = { campaigns: [], templates: [], interactions: [], audit: [], commits: 0, rollbacks: 0, runningUpdates: 0,
    items: [{ id: operatorId, recipient_type: 'operator', read_at: null }, { id: clinicalId, recipient_type: 'agent', read_at: null }] };
}

async function withHTTP(run) {
  const app = express(); app.use(express.json()); app.use('/crm', crmRouter); app.use('/inbox', inboxRouter);
  const server = await new Promise(resolve => { const listener = app.listen(0, '127.0.0.1', () => resolve(listener)); });
  try {
    await run(async (path, method = 'GET', body) => {
      const response = await fetch('http://127.0.0.1:' + server.address().port + path, { method, headers: { 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
      return { status: response.status, body: await response.json() };
    });
  } finally { await new Promise(resolve => server.close(resolve)); }
}

const campaign = { name: 'Authored campaign draft', campaignType: 'newsletter', subjectLine: 'Authored subject', emailTemplate: 'Authored message', dailyLimit: 20 };
const template = { name: 'Authored template', category: 'provider_invite', subject: 'Authored subject', body: 'Authored message' };

test('CRM and operator inbox require administrator authentication before any record change', async () => {
  reset();
  await withHTTP(async request => {
    actor = null; assert.equal((await request('/crm/campaigns', 'POST', campaign)).status, 401);
    actor = { ...administrator, role: 'patient' }; assert.equal((await request('/crm/templates', 'POST', template)).status, 403);
    assert.equal((await request('/inbox/' + operatorId, 'DELETE')).status, 403);
  });
  assert.equal(calls.length, 0); assert.equal(state.audit.length, 0);
});

test('camelCase and legacy snake_case campaigns save server-attributed audited drafts without sending', async () => {
  reset();
  await withHTTP(async request => {
    const first = await request('/crm/campaigns', 'POST', { ...campaign, createdBy: 'forged-creator', status: 'approved', auditActorId: 'forged' });
    assert.equal(first.status, 200); assert.equal(first.body.data.status, 'draft'); assert.equal(first.body.data.created_by, administrator.id);
    const legacy = await request('/crm/campaigns', 'POST', { name: 'Legacy authored draft', campaign_type: 'cold_email', target_contact_type: 'provider', subject_line: 'Recorded subject', email_template: 'Recorded message', daily_limit: '30', created_by: 'forged' });
    assert.equal(legacy.status, 200); assert.equal(legacy.body.data.campaign_type, 'cold_email'); assert.equal(legacy.body.data.daily_limit, 30);
    assert.equal((await request('/crm/templates', 'POST', template)).status, 200);
  });
  assert.equal(state.campaigns.length, 2); assert.equal(state.audit.length, 3); assert.equal(transportCalls, 0); assert.equal(state.runningUpdates, 0);
});

test('CRM validates content bounds and conflicting aliases before writing and preserves real duplicate errors', async () => {
  reset();
  await withHTTP(async request => {
    for (const change of [{ name: ' ' }, { subjectLine: 'x'.repeat(501) }, { emailTemplate: 'x'.repeat(20001) }, { dailyLimit: 201 }, { dailyLimit: true }, { campaign_type: 'partnership' }]) {
      assert.equal((await request('/crm/campaigns', 'POST', { ...campaign, ...change })).status, 400);
    }
    assert.equal(state.campaigns.length, 0);
    assert.equal((await request('/crm/templates', 'POST', template)).status, 200);
    const duplicate = await request('/crm/templates', 'POST', template);
    assert.equal(duplicate.status, 409); assert.equal(duplicate.body.success, false);
  });
  assert.equal(state.templates.length, 1);
});

test('CRM outages never appear as empty success and audit failure rolls back the saved draft', async () => {
  reset();
  await withHTTP(async request => {
    state.outage = true;
    for (const path of ['/crm/campaigns', '/crm/templates']) { const result = await request(path); assert.equal(result.status, 503); assert.equal(result.body.success, false); assert.ok(!result.body.error.includes('Private')); }
    state.outage = false; state.auditOutage = true;
    assert.equal((await request('/crm/campaigns', 'POST', campaign)).status, 503);
    assert.equal((await request('/crm/templates', 'POST', template)).status, 503);
    assert.equal(state.campaigns.length, 0); assert.equal(state.templates.length, 0); assert.equal(state.commits, 0);
    state.auditOutage = false; state.currentRole = 'patient';
    assert.equal((await request('/crm/campaigns', 'POST', campaign)).status, 403);
  });
  assert.equal(state.campaigns.length, 0);
});

test('unconnected mail returns unavailable without inventing sent/bounced interactions or a running campaign', async () => {
  reset(); const previousHost = process.env.SMTP_HOST; const previousUser = process.env.SMTP_USER;
  delete process.env.SMTP_HOST; delete process.env.SMTP_USER;
  try {
    await withHTTP(async request => {
      const direct = await request('/crm/contacts/' + contactId + '/email', 'POST', { subject: 'Authored subject', body: 'Authored body' });
      assert.equal(direct.status, 503); assert.equal(direct.body.success, false); assert.equal(direct.body.code, 'EMAIL_TRANSPORT_NOT_CONNECTED');
      const batch = await request('/crm/campaigns/' + contactId + '/send', 'POST', { limit: 10 });
      assert.equal(batch.status, 503); assert.equal(batch.body.success, false);
    });
    assert.equal(transportCalls, 0); assert.equal(state.interactions.length, 0); assert.equal(state.runningUpdates, 0);
  } finally {
    if (previousHost === undefined) delete process.env.SMTP_HOST; else process.env.SMTP_HOST = previousHost;
    if (previousUser === undefined) delete process.env.SMTP_USER; else process.env.SMTP_USER = previousUser;
  }
});

test('operator read/delete actions exclude clinical/agent rows and reject unknown IDs without partial changes', async () => {
  reset();
  await withHTTP(async request => {
    assert.equal((await request('/inbox/mark-read', 'POST', { ids: [operatorId, clinicalId] })).status, 404);
    assert.equal(state.items.find(row => row.id === operatorId).read_at, null);
    assert.equal((await request('/inbox/' + clinicalId, 'DELETE')).status, 404);
    assert.equal((await request('/inbox/' + crypto.randomUUID(), 'DELETE')).status, 404);
    assert.equal((await request('/inbox/delete-bulk', 'POST', { ids: [operatorId, clinicalId], mode: 'selected' })).status, 404);
    const read = await request('/inbox/mark-read', 'POST', { ids: [operatorId] }); assert.equal(read.status, 200); assert.equal(read.body.data.marked, 1);
    const retry = await request('/inbox/mark-read', 'POST', { ids: [operatorId] }); assert.equal(retry.body.data.marked, 0);
    const removed = await request('/inbox/delete-bulk', 'POST', { mode: 'all' }); assert.equal(removed.body.data.deleted, 1);
  });
  assert.deepEqual(state.items.map(row => row.id), [clinicalId]); assert.equal(state.audit.length, 3);
});

test('inbox rejects malformed/oversized input and stale roles; audit outages roll back mutations and use safe errors', async () => {
  reset();
  await withHTTP(async request => {
    for (const body of [{ ids: ['invalid'] }, { ids: Array.from({ length: 101 }, () => operatorId) }, { ids: [], mode: 'selected' }, { mode: 'all', ids: [operatorId] }]) {
      const route = body.mode ? '/inbox/delete-bulk' : '/inbox/mark-read'; assert.equal((await request(route, 'POST', body)).status, 400);
    }
    assert.equal((await request('/inbox?limit=999')).status, 400);
    state.currentRole = 'patient'; assert.equal((await request('/inbox/mark-read', 'POST', { ids: 'all' })).status, 403);
    state.currentRole = 'admin'; state.auditOutage = true;
    const failed = await request('/inbox/' + operatorId, 'DELETE'); assert.equal(failed.status, 503); assert.ok(!failed.body.error.includes('Private'));
    assert.ok(state.items.find(row => row.id === operatorId));
    state.auditOutage = false; state.outage = true;
    const list = await request('/inbox'); assert.equal(list.status, 503); assert.equal(list.body.success, false); assert.ok(!list.body.error.includes('Private'));
  });
});

test('offline SMTP receipt fixtures require actual recipient acceptance and record persistence before confirming send', async () => {
  reset(); const previousHost = process.env.SMTP_HOST; const previousUser = process.env.SMTP_USER;
  process.env.SMTP_HOST = 'isolated-mail-fixture.invalid'; process.env.SMTP_USER = 'isolated-fixture';
  try {
    smtpResult = { messageId: 'offline-receipt', accepted: [] };
    const rejected = await crmService.sendEmail(contactId, 'Authored subject', 'Authored body', 'operator');
    assert.equal(rejected.success, false); assert.equal(rejected.code, 'EMAIL_ACCEPTANCE_UNCONFIRMED'); assert.equal(state.interactions.length, 0);
    smtpResult = { messageId: 'offline-receipt', accepted: ['recorded-contact@example.invalid'] };
    state.interactionOutage = true;
    const uncertain = await crmService.sendEmail(contactId, 'Authored subject', 'Authored body', 'operator');
    assert.equal(uncertain.success, false); assert.equal(uncertain.status, 'reconciliation_required'); assert.equal(state.interactions.length, 0);
    state.interactionOutage = false;
    const recorded = await crmService.sendEmail(contactId, 'Authored subject', 'Authored body', 'operator');
    assert.equal(recorded.success, true); assert.equal(recorded.status, 'accepted'); assert.equal(state.interactions.length, 1);
    assert.ok(!calls.some(call => call.sql.includes('email_bounced')));
  } finally {
    if (previousHost === undefined) delete process.env.SMTP_HOST; else process.env.SMTP_HOST = previousHost;
    if (previousUser === undefined) delete process.env.SMTP_USER; else process.env.SMTP_USER = previousUser;
  }
});

test('CRM runtime readiness never replays migrations, imports default templates or changes stored templates', async () => {
  reset();
  state.templates = [{ id: crypto.randomUUID(), name: 'Existing operator-authored template', body: 'Preserved existing content', is_active: true }];
  const before = structuredClone(state.templates);
  assert.equal(await crmService.initialize(), true);
  assert.deepEqual(await crmService._seedDefaults(), { templatesInserted: 0, sourcesInserted: 0 });
  assert.deepEqual(state.templates, before);
  assert.ok(calls.every(call => /^\s*SELECT\b/.test(call.sql)), 'Runtime initialization only reads schema readiness and observed lead sources');
  assert.equal(transportCalls, 0);
  state.outage = true;
  assert.equal(await crmService.initialize(), false); assert.equal(crmService.initialized, false);
});
