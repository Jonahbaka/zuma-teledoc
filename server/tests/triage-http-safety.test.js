'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
// Synthetic actors and database only. Never load real authentication or connect a DB.
function stub(modulePath, exports) {
  const id = require.resolve(modulePath);
  require.cache[id] = { id, filename: id, loaded: true, exports };
}
const actors = { patient: { id: 'p1', role: 'patient' }, other: { id: 'p2', role: 'patient' }, provider: { id: 'd1', role: 'provider' }, unassigned: { id: 'd2', role: 'provider' } };
stub('../middleware/auth', {
  authenticate(req, res, next) { req.user = actors[req.headers['x-test-actor']]; if (!req.user) return res.sendStatus(401); next(); },
  requireRole: roles => (req, res, next) => roles.includes(req.user.role) ? next() : res.sendStatus(403),
});
stub('../middleware/audit', { auditMiddleware: () => (_req, _res, next) => next() });
let connects = 0;
stub('../db', { pool: {
  connect: async () => { connects++; throw new Error('No real database is available in this test'); },
  query: async (sql, args) => {
    if (sql.includes('information_schema')) return { rows: [{}] };
    assert.match(sql, /patient_id = \$2/);
    assert.match(sql, /provider_id = \$2/);
    return { rows: args[0] === 'a1' && ((args[2] === 'patient' && args[1] === 'p1') || (args[2] === 'provider' && args[1] === 'd1')) ? [{ triage_data: { symptoms: 'synthetic' } }] : [] };
  },
} });
const app = express();
app.use(express.json());
app.use('/triage', require('../routes/triage'));
app.use('/queue', require('../routes/triageQueue'));
let server;
let base;
test.before(async () => { server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve)); base = `http://127.0.0.1:${server.address().port}`; });
test.after(() => new Promise(resolve => server.close(resolve)));
test('HTTP triage read hides another patient and unassigned provider data', async () => {
  for (const [actor, expected] of [['patient', 200], ['provider', 200], ['other', 404], ['unassigned', 404]]) {
    const response = await fetch(`${base}/triage/appointment/a1`, { headers: { 'x-test-actor': actor } });
    assert.equal(response.status, expected);
    const body = await response.json();
    assert.equal(Boolean(body.triage), expected === 200);
  }
});
test('HTTP unassessed session returns actionable 422 without queue persistence', async () => {
  const response = await fetch(`${base}/queue/session`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-test-actor': 'patient' }, body: JSON.stringify({ chiefComplaint: 'xyzzy', symptoms: 'unknown' }) });
  assert.equal(response.status, 422);
  const body = await response.json();
  assert.equal(body.code, 'TRIAGE_REQUIRES_CLINICAL_REVIEW');
  assert.equal(body.analysis.assessmentStatus, 'unassessed');
  assert.equal(body.manualBookingRequired, true);
  assert.equal(body.analysis.confidenceScore, null);
  assert.equal(body.session, undefined);
  assert.equal(connects, 0);
});
test('HTTP preview retains abstention flags, never a low urgency fallback', async () => {
  const response = await fetch(`${base}/queue/analyze`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-test-actor': 'patient' }, body: JSON.stringify({ symptoms: 'xyzzy' }) });
  assert.equal(response.status, 200);
  const { analysis } = await response.json();
  assert.equal(analysis.assessmentStatus, 'unassessed');
  assert.equal(analysis.requiresClinicalReview, true);
  assert.equal(analysis.triageLevel, 'UNASSESSED');
  assert.equal(analysis.confidenceScore, null);
});
