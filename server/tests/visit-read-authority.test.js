'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const express = require('express');
const db = require('../db');
const { encrypt } = require('../../lib/encryption');
const service = require('../services/visitReadService');

const ids = Object.fromEntries(['patient', 'otherPatient', 'provider', 'otherProvider', 'pharmacy', 'admin', 'appointment', 'visit'].map(key => [key, crypto.randomUUID()]));
const actors = Object.fromEntries(['patient', 'otherPatient', 'provider', 'otherProvider', 'pharmacy', 'admin'].map(key => [key, {
  id: ids[key], role: key.toLowerCase().includes('provider') ? 'provider' : key.toLowerCase().includes('patient') ? 'patient' : key,
  is_active: true, market_scope: 'US', provider_status: 'approved',
}]));
const oldEncryption = process.env.ENCRYPTION_KEY;
process.env.ENCRYPTION_KEY = '1234567890abcdef'.repeat(4);
const protectedField = (name, value) => {
  const data = encrypt(value);
  return { [name + '_encrypted']: data.encrypted, [name + '_iv']: data.iv, [name + '_tag']: data.tag };
};
const originalVisit = {
  id: ids.visit, appointment_id: ids.appointment, patient_id: ids.patient, provider_id: ids.provider,
  ...protectedField('subjective', 'Synthetic protected subjective narrative'), ...protectedField('objective', 'Recorded objective findings'),
  ...protectedField('assessment', 'Recorded assessment'), ...protectedField('plan', 'Recorded plan'), ...protectedField('vitals', '{"heartRate":72}'),
  is_signed: false, is_locked: false, follow_up_required: false, follow_up_notes: 'Recorded follow-up', icd_codes: [], cpt_codes: [],
};
let state;
function reset() {
  state = { actors: structuredClone(actors), visit: structuredClone(originalVisit), relationship: false,
    currentAppointment: false, verified: true, failAudit: false, queries: [], committed: false, rolledBack: false, released: false,
    attemptAudits: [], patientActive: true, patientMarket: 'US', authorMarket: 'US', appointmentProvider: ids.provider,
  };
}
async function query(sql, values = []) {
  state.queries.push({ sql, values });
  if (sql === 'BEGIN') return { rows: [] };
  if (sql === 'COMMIT') { state.committed = true; return { rows: [] }; }
  if (sql === 'ROLLBACK') { state.rolledBack = true; return { rows: [] }; }
  if (sql.includes('FROM users WHERE id=$1')) {
    assert.match(sql, /FOR SHARE/);
    return { rows: Object.values(state.actors).filter(actor => actor.id === values[0]) };
  }
  if (sql.includes('FROM ng_providers')) { assert.match(sql, /status='verified' FOR SHARE/); return { rows: state.verified ? [{ id: 'verified' }] : [] }; }
  if (sql.includes('FROM provider_patient_relationships')) { assert.match(sql, /is_active=TRUE FOR SHARE/); return { rows: state.relationship ? [{ id: 'active' }] : [] }; }
  if (sql.includes("status IN ('scheduled','confirmed','in_progress')")) { assert.match(sql, /FOR SHARE/); return { rows: state.currentAppointment ? [{ id: 'current' }] : [] }; }
  if (sql.includes('FROM appointments a')) {
    assert.match(sql, /p\.market_scope=\$2/); assert.match(sql, /pr\.market_scope=\$2/); assert.match(sql, /p\.is_active=TRUE/); assert.match(sql, /FOR SHARE OF a,p,pr/);
    return { rows: values[0] === ids.appointment && state.patientActive && state.patientMarket === values[1] && state.authorMarket === values[1]
      ? [{ id: ids.appointment, patient_id: ids.patient, provider_id: state.appointmentProvider }] : [] };
  }
  if (sql.includes('FROM visits v')) {
    assert.match(sql, /a\.patient_id=v\.patient_id AND a\.provider_id=v\.provider_id/);
    assert.match(sql, /p\.market_scope=\$2/); assert.match(sql, /pr\.market_scope=\$2/); assert.match(sql, /p\.is_active=TRUE/); assert.match(sql, /FOR SHARE OF v,a,p,pr/);
    const row = state.visit;
    const key = sql.includes('WHERE v.appointment_id=$1') ? 'appointment_id' : 'id';
    return { rows: row && row[key] === values[0] && row.patient_id === ids.patient && row.provider_id === state.appointmentProvider && state.patientActive
      && state.patientMarket === values[1] && state.authorMarket === values[1] ? [row] : [] };
  }
  if (sql.includes('SELECT id FROM visits WHERE appointment_id=$1')) return { rows: state.visit?.appointment_id === values[0] ? [{ id: state.visit.id }] : [] };
  if (sql.includes('INSERT INTO audit_logs')) {
    if (state.failAudit) throw new Error('Synthetic confidential audit failure');
    assert.equal(values[2], ids.patient);
    assert.ok(!JSON.stringify(values).includes('Synthetic protected'));
    return { rows: [] };
  }
  throw new Error('Unexpected synthetic SQL: ' + sql);
}
const oldPool = db.getPool;
db.getPool = () => ({ connect: async () => ({ query, release() { state.released = true; } }) });
function stub(modulePath, exports) {
  const id = require.resolve(modulePath); require.cache[id] = { id, filename: id, loaded: true, exports };
}
stub('../middleware/auth', {
  authenticate(req, res, next) { req.user = state.actors[req.headers['x-test-actor']]; return req.user ? next() : res.sendStatus(401); },
  requireRole: () => (_req, _res, next) => next(), canAccessPatient: (_req, _res, next) => next(),
});
stub('../middleware/audit', {
  auditMiddleware: () => (_req, _res, next) => next(), auditPhiAccess: () => (_req, _res, next) => next(),
  async logAuditEvent(data) {
    if (state.queries.length) assert.equal(state.queries.at(-1).sql, 'ROLLBACK', 'A failed read audit must run after rollback');
    state.attemptAudits.push(data);
    return true;
  },
});
stub('../../ng/services/providers/providerAccessService', { requireActiveProviderToolAccess: (_req, _res, next) => next(), recordProviderUsage: async () => {} });
const app = express(); app.use('/api/visits', require('../routes/visits'));
let server, base;
test.before(async () => { server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve)); base = `http://127.0.0.1:${server.address().port}/api/visits`; });
test.beforeEach(reset);
test.after(async () => {
  await new Promise(resolve => server.close(resolve)); db.getPool = oldPool;
  if (oldEncryption === undefined) delete process.env.ENCRYPTION_KEY; else process.env.ENCRYPTION_KEY = oldEncryption;
});
async function request(actor, path) {
  const response = await fetch(base + path, { headers: { 'x-test-actor': actor } });
  return { status: response.status, body: await response.json(), cache: response.headers.get('cache-control') };
}

test('unsupported visit reader roles fail before opening storage, including super administrators', async () => {
  for (const role of ['pharmacy', 'admin', 'super_admin', 'government_analyst', undefined]) {
    await assert.rejects(service.read({ id: ids.pharmacy, role }, { id: ids.visit }), { statusCode: 403 });
  }
  await assert.rejects(service.read(actors.provider, { id: 'invalid' }), { statusCode: 400 });
  assert.equal(state.queries.length, 0);
});

test('both HTTP detail paths reject pharmacy and administrator access instead of falling through', async () => {
  for (const actor of ['pharmacy', 'admin']) for (const path of ['/' + ids.visit, '/appointment/' + ids.appointment]) {
    const result = await request(actor, path);
    assert.equal(result.status, 403); assert.equal(result.body.visit, undefined); assert.equal(result.cache, 'private, no-store');
  }
  assert.equal(state.queries.length, 0);
  assert.equal(state.attemptAudits.length, 4);
  for (const audit of state.attemptAudits) {
    assert.equal(audit.success, false); assert.equal(audit.errorMessage, 'Request failed with status 403');
    assert.ok([ids.pharmacy, ids.admin].includes(audit.userId));
  }
});

test('both HTTP detail paths return identical readable SOAP to the author, not encryption envelopes', async () => {
  const byId = await request('provider', '/' + ids.visit);
  const byAppointment = await request('provider', '/appointment/' + ids.appointment);
  assert.equal(byId.status, 200); assert.equal(byAppointment.status, 200);
  assert.deepEqual(byId.body.visit, byAppointment.body.visit);
  assert.equal(byAppointment.body.visit.subjective, 'Synthetic protected subjective narrative');
  assert.deepEqual(byAppointment.body.visit.vitals, { heartRate: 72 });
  assert.equal(byAppointment.body.visit.followUpNotes, 'Recorded follow-up');
  assert.ok(!JSON.stringify(byAppointment.body).includes('Encrypted'));
  assert.equal(byAppointment.cache, 'private, no-store'); assert.equal(state.committed, true); assert.equal(state.released, true);
  const audits = state.queries.filter(row => row.sql.includes('INSERT INTO audit_logs'));
  assert.equal(audits.length, 2);
  assert.equal(state.attemptAudits.length, 0);
  assert.equal(audits[0].values[3], '127.0.0.1');
  assert.ok(audits[0].values[4]);
});

test('patient access stays self-only and another provider needs current care authority', async () => {
  assert.equal((await request('patient', '/' + ids.visit)).status, 200);
  for (const actor of ['otherPatient', 'otherProvider']) for (const path of ['/' + ids.visit, '/appointment/' + ids.appointment]) {
    assert.equal((await request(actor, path)).status, 403);
  }
  state.relationship = true;
  assert.equal((await request('otherProvider', '/' + ids.visit)).status, 200);
  assert.equal((await request('otherProvider', '/appointment/' + ids.appointment)).status, 403);
  state.relationship = false; state.currentAppointment = true;
  assert.equal((await request('otherProvider', '/' + ids.visit)).status, 200);
  state.currentAppointment = false;
  assert.equal((await request('otherProvider', '/' + ids.visit)).status, 403);
});

test('current account, patient, market, and Nigeria verification changes revoke visit authority', async () => {
  for (const patch of [{ is_active: false }, { provider_status: 'pending' }, { market_scope: 'NG' }, { market_scope: null }, { role: 'pharmacy' }]) {
    reset(); Object.assign(state.actors.provider, patch);
    await assert.rejects(service.read(actors.provider, { id: ids.visit }), error => [403, 404].includes(error.statusCode));
    assert.equal(state.committed, false); assert.equal(state.rolledBack, true);
  }
  for (const patch of [{ patientActive: false }, { patientMarket: 'NG' }, { authorMarket: 'NG' }, { appointmentProvider: ids.otherProvider }]) {
    reset(); Object.assign(state, patch);
    await assert.rejects(service.read(actors.provider, { id: ids.visit }), { statusCode: 404 });
  }
  reset(); state.actors.provider.market_scope = state.patientMarket = state.authorMarket = 'NG'; state.verified = false;
  await assert.rejects(service.read(actors.provider, { id: ids.visit }), { statusCode: 403 });
  state.verified = true; assert.equal((await service.read(actors.provider, { id: ids.visit })).id, ids.visit);
});

test('only an authorized appointment with no visit returns null; hidden or inconsistent visits do not', async () => {
  state.visit = null;
  const authorized = await request('provider', '/appointment/' + ids.appointment);
  assert.equal(authorized.status, 200); assert.equal(authorized.body.visit, null);
  assert.equal((await request('otherProvider', '/appointment/' + ids.appointment)).status, 403);
  assert.equal((await request('otherPatient', '/appointment/' + ids.appointment)).status, 403);
  assert.equal((await request('provider', '/appointment/' + crypto.randomUUID())).status, 403);
  reset(); state.visit.patient_id = ids.otherPatient;
  assert.equal((await request('provider', '/appointment/' + ids.appointment)).status, 403);
});

test('corrupt encrypted SOAP, incomplete envelopes and malformed vitals never masquerade as empty fields', async () => {
  for (const field of ['subjective', 'objective', 'assessment', 'plan', 'vitals']) {
    reset(); state.visit[field + '_tag'] = '0'.repeat(32);
    const result = await request('provider', '/appointment/' + ids.appointment);
    assert.equal(result.status, 503); assert.equal(result.body.visit, undefined); assert.equal(state.committed, false); assert.equal(state.rolledBack, true);
  }
  reset(); state.visit.subjective_iv = null;
  await assert.rejects(service.read(actors.provider, { id: ids.visit }), { code: 'CLINICAL_DECRYPTION_UNAVAILABLE' });
  for (const value of ['not-json', '42', '[]']) {
    reset(); Object.assign(state.visit, protectedField('vitals', value));
    await assert.rejects(service.read(actors.provider, { id: ids.visit }), { code: 'CLINICAL_DECRYPTION_UNAVAILABLE' });
  }
});

test('an audit outage withholds all plaintext and returns a fixed private HTTP error', async () => {
  state.failAudit = true;
  const result = await request('provider', '/' + ids.visit);
  assert.equal(result.status, 503); assert.equal(result.body.visit, undefined); assert.equal(result.cache, 'private, no-store');
  assert.ok(!JSON.stringify(result.body).includes('confidential')); assert.ok(!JSON.stringify(result.body).includes('Synthetic protected'));
  assert.equal(state.committed, false); assert.equal(state.rolledBack, true); assert.equal(state.released, true);
  assert.equal(state.attemptAudits.length, 1);
  assert.equal(state.attemptAudits[0].errorMessage, 'Request failed with status 503');
  assert.ok(!JSON.stringify(state.attemptAudits).includes('confidential'));
  assert.ok(!JSON.stringify(state.attemptAudits).includes('Synthetic protected'));
});


test('failed malformed lookups audit safe references without copying attacker-controlled input', async () => {
  const result = await request('provider', '/not-a-uuid-with-private-content');
  assert.equal(result.status, 400); assert.equal(state.queries.length, 0);
  assert.equal(state.attemptAudits.length, 1); assert.equal(state.attemptAudits[0].resourceId, null);
  assert.ok(!JSON.stringify(state.attemptAudits).includes('private-content'));
});
