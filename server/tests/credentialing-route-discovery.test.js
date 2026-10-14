'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const express = require('express');

const providerId = '00000000-0000-4000-8000-000000000001';
let actor;
let queries = [];
const filename = require.resolve('../routes/credentialing');
const originalLoad = Module._load;
let routes;
try {
  Module._load = function credentialingTestDependencies(request, parent) {
    if (parent?.filename === filename) {
      if (request === '../db') return {
        async query(sql, params) {
          queries.push({ sql, params });
          if (sql.includes('GROUP BY status')) return { rows: [{ status: 'documents_under_review', count: '2' }, { status: 'committee_review', count: '1' }, { status: 'approved', count: '4' }] };
          if (sql.includes('SELECT pc.*')) return { rows: [{ id: providerId, provider_id: params[0], status: 'approved' }] };
          return { rows: [] };
        },
      };
      if (request === '../middleware/auth') return {
        authenticate(req, res, next) { if (!actor) return res.status(401).json({ success: false }); req.user = actor; next(); },
        requireRole(...roles) { return (req, res, next) => roles.flat().includes(req.user?.role) ? next() : res.status(403).json({ success: false }); },
      };
      if (request === '../middleware/logger') return { error() {} };
    }
    return originalLoad.apply(this, arguments);
  };
  delete require.cache[filename];
  routes = require(filename);
} finally { Module._load = originalLoad; }

async function requestWith(user, url) {
  actor = user; queries = [];
  const app = express(); app.use('/api/credentialing', routes);
  const server = await new Promise(resolve => { const listener = app.listen(0, '127.0.0.1', () => resolve(listener)); });
  try {
    const response = await fetch('http://127.0.0.1:' + server.address().port + url);
    return { status: response.status, body: response.headers.get('content-type')?.includes('json') ? await response.json() : null, queries: [...queries] };
  } finally { await new Promise(resolve => server.close(resolve)); actor = null; }
}

test('credentialing statistics resolve the aggregate endpoint instead of the provider UUID query', async () => {
  const response = await requestWith({ id: 'admin-1', role: 'admin' }, '/api/credentialing/admin/stats');
  assert.equal(response.status, 200);
  assert.equal(response.body.success, true);
  assert.equal(response.body.stats.total, 7);
  assert.equal(response.body.stats.underReview, 3);
  assert.equal(response.body.stats.approved, 4);
  assert.equal(response.queries.length, 1);
  assert.ok(response.queries[0].sql.includes('GROUP BY status'));
});

test('credentialing aggregate access preserves sign-in and administrator role requirements', async () => {
  assert.equal((await requestWith(null, '/api/credentialing/admin/stats')).status, 401);
  const patient = await requestWith({ id: providerId, role: 'patient' }, '/api/credentialing/admin/stats');
  assert.equal(patient.status, 403);
  assert.equal(patient.queries.length, 0);
  assert.equal((await requestWith({ id: 'admin-1', role: 'super_admin' }, '/api/credentialing/admin/stats')).status, 200);
});

test('malformed provider identifiers never reach a database UUID cast', async () => {
  for (const id of ['not-a-provider-id', '------------------------------------', '00000000-0000-4000-8000-00000000000G']) {
    const response = await requestWith({ id: 'admin-1', role: 'admin' }, '/api/credentialing/admin/' + id);
    assert.equal(response.status, 404);
    assert.equal(response.queries.length, 0);
  }
});

test('the individual credentialing application remains available only to administrative roles', async () => {
  const response = await requestWith({ id: 'admin-1', role: 'admin' }, '/api/credentialing/admin/' + providerId);
  assert.equal(response.status, 200);
  assert.equal(response.body.credentialing.providerId, providerId);
  assert.deepEqual(response.queries[0].params, [providerId]);
  const provider = await requestWith({ id: providerId, role: 'provider' }, '/api/credentialing/admin/' + providerId);
  assert.equal(provider.status, 403);
  assert.equal(provider.queries.length, 0);
});
