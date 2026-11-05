'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const patients = { [uuid(1)]: 'US', [uuid(2)]: 'NG' };
const actors = {
  owner: { id: uuid(10), role: 'provider', marketScope: 'US' },
  stranger: { id: uuid(11), role: 'provider', marketScope: 'US' },
  ng: { id: uuid(12), role: 'provider', marketScope: 'NG' },
  revoked: { id: uuid(13), role: 'provider', marketScope: 'US' },
  admin: { id: uuid(14), role: 'admin', marketScope: 'US' },
};
const stub = (path, exports) => { const id = require.resolve(path); require.cache[id] = { id, filename: id, loaded: true, exports }; };
let predictions = 0;
let mutations = 0;
let failAudit = false;
let transactionEvents = [];
const database = {
  async getClient() { return { query: database.query, release() {} }; },
  async query(sql, params = []) {
    if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql)) { transactionEvents.push(sql); return { rows: [] }; }
    if (sql.includes('INSERT INTO audit_logs')) {
      transactionEvents.push('AUDIT');
      assert.equal(params[0], actors.owner.id === params[0] ? actors.owner.id : actors.ng.id);
      assert.ok(['read', 'update'].includes(params[1]));
      assert.match(params[4], /^Predictive [a-z_]+$/);
      if (failAudit) throw new Error('Simulated unavailable audit storage');
      return { rows: [] };
    }
    if (sql.includes('SELECT actor.id')) {
      assert.match(sql, /patient.market_scope=actor.market_scope/);
      assert.match(sql, /actor.is_active=TRUE/);
      assert.match(sql, /actor.provider_status='approved'/);
      assert.match(sql, /FOR SHARE OF actor,patient/);
      const actor = Object.values(actors).find(a => a.id === params[1]);
      return { rows: actor && actor !== actors.revoked && actor.role === params[2] && actor.marketScope === params[3] && patients[params[0]] === actor.marketScope ? [actor] : [] };
    }
    if (sql.includes('FROM ng_providers')) return { rows: [{ id: uuid(22) }] };
    if (sql.includes('FROM provider_patient_relationships')) return { rows: params[0] === actors.owner.id && params[1] === uuid(1) || params[0] === actors.ng.id && params[1] === uuid(2) ? [{ id: uuid(23) }] : [] };
    if (sql.includes('FROM appointments')) return { rows: [] };
    if (sql.includes('FROM ml_alerts')) {
      assert.match(sql, /p.patient_hash=\$[12]/);
      assert.match(sql, /a.target_user_id=\$[23]/);
      return { rows: [] };
    }
    if (sql.includes('FROM ml_predictions')) { assert.match(sql, /p.patient_hash=\$/); return { rows: [] }; }
    if (sql.startsWith('UPDATE')) { mutations++; return { rows: [] }; }
    throw new Error(`Unexpected fixture query: ${sql}`);
  },
};
stub('../db', database);
stub('../middleware/auth', {
  authenticate(req, res, next) { req.user = actors[req.headers['x-test-actor']]; return req.user ? next() : res.sendStatus(401); },
  requireRole: (...roles) => (req, res, next) => roles.includes(req.user.role) ? next() : res.sendStatus(403),
});
stub('../middleware/audit', { auditMiddleware: () => (_req, _res, next) => next() });
stub('../services/predictive-engine', {
  async getPatientRiskProfile() { predictions++; return { assessmentStatus: 'unassessed' }; },
  async predict(id, type, context) { predictions++; assert.equal(context.market, 'US'); assert.equal(context.forceRefresh, undefined); return { assessmentStatus: 'unassessed' }; },
  async explainPrediction() { predictions++; return { assessmentStatus: 'unassessed' }; },
  getHealthStatus: () => ({}),
});
const app = express(); app.use(express.json()); app.use(require('../routes/predictive'));
let server, base;
test.before(async () => { server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve)); base = `http://127.0.0.1:${server.address().port}`; });
test.after(() => new Promise(resolve => server.close(resolve)));
async function request(path, actor, body) {
  return fetch(base + path, { method: body ? 'POST' : 'GET', headers: { 'x-test-actor': actor, 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
}
test('patient reads deny unrelated, revoked, administrative and cross-market actors before inference', async () => {
  for (const route of ['risk-profile', 'history', 'features', 'explain/no_show']) {
    for (const actor of ['stranger', 'revoked', 'admin', 'ng']) {
      const before = predictions;
      const response = await request(`/patient/${uuid(1)}/${route}`, actor);
      assert.equal(response.status, 403);
      assert.equal(predictions, before);
    }
  }
});
test('authorized US and NG relationships can read scoped history without exposing another patient', async () => {
  for (const [actor, id] of [['owner', uuid(1)], ['ng', uuid(2)]]) {
    const response = await request(`/patient/${id}/history`, actor);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('cache-control'), /no-store/);
    assert.deepEqual((await response.json()).data, []);
  }
});
test('request context cannot override authenticated market or model input provenance', async () => {
  const response = await request(`/patient/${uuid(1)}/predict`, 'owner', { predictionType: 'no_show', context: { market: 'NG', forceRefresh: true, actor: actors.ng } });
  assert.equal(response.status, 200);
});
test('alert lists require patient scope; legacy unlinked alerts are not returned', async () => {
  assert.equal((await request('/alerts?role=admin', 'owner')).status, 400);
  const response = await request(`/alerts?patientId=${uuid(1)}&role=admin`, 'owner');
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).data, []);
});
test('arbitrary alert/outcome mutations cannot alter a foreign or unlinked record', async () => {
  const before = mutations;
  for (const actor of ['owner', 'stranger', 'ng']) {
    const acknowledge = await request(`/alerts/${uuid(50)}/acknowledge`, actor, { patientId: uuid(1), action: 'Reviewed fictional fixture' });
    assert.equal(acknowledge.status, actor === 'owner' ? 404 : 403);
    const outcome = await request(`/predictions/${uuid(51)}/outcome`, actor, { patientId: uuid(1), outcome: 'positive' });
    assert.equal(outcome.status, actor === 'owner' ? 404 : 403);
  }
  assert.equal(mutations, before);
});
test('no global population query is granted by an administrator role', async () => {
  assert.equal((await request('/population/stratify/sepsis_warning', 'admin')).status, 503);
});

test('durable audit failure rolls back the transaction and suppresses an authorized read response', async () => {
  transactionEvents = [];
  failAudit = true;
  try {
    const response = await request(`/patient/${uuid(1)}/history`, 'owner');
    assert.equal(response.status, 503);
    assert.equal((await response.json()).data, undefined);
    assert.deepEqual(transactionEvents, ['BEGIN', 'AUDIT', 'ROLLBACK']);
  } finally { failAudit = false; }
  transactionEvents = [];
  assert.equal((await request(`/patient/${uuid(1)}/history`, 'owner')).status, 200);
  assert.deepEqual(transactionEvents, ['BEGIN', 'AUDIT', 'COMMIT']);
});
