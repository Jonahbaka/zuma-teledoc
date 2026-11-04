'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { createPublicDirectoryRouter } = require('../routes/publicDirectory');

async function serve(options, run) {
  const app = express();
  app.use('/api/directory', createPublicDirectoryRouter(options));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const url = 'http://127.0.0.1:' + server.address().port + '/api/directory/pharmacies';
  const post = async (body) => { const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); return { response, body: await response.json() }; };
  try { await run(post, url); } finally { await new Promise((resolve) => server.close(resolve)); }
}

test('anonymous device lookup uses zero coordinates, actual nearest distances and public business fields only', async () => {
  let called = false;
  await serve({ lookup: { async findNearbyPharmacies(latitude, longitude, radius, { signal }) {
    assert.equal(latitude, 0); assert.equal(longitude, 0); assert.equal(radius, 20000); assert.ok(signal instanceof AbortSignal); called = true;
    return [
      { id: 'further', name: 'Directory entry B', latitude: 0.05, longitude: 0, source: 'openstreetmap', isOpen: true, inventory: ['private'], owner_user_id: 'private', patientId: 'private' },
      { id: 'nearest', name: 'Directory entry A', latitude: 0, longitude: 0, source: 'network', isPreferred: true, isInNetwork: true, deaNumber: 'private', metadata: 'private' },
      { id: 'outside', name: 'Outside radius', latitude: 1, longitude: 0, source: 'network' },
      { id: 'invented', name: 'Rejected fallback', latitude: 0, longitude: 0, source: 'fallback' },
    ];
  } } }, async (post) => {
    const { response, body } = await post({ market: 'US', latitude: 0, longitude: 0, radius: 20000 });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
    assert.equal(body.success, true); assert.equal(body.locationMode, 'device'); assert.equal(called, true);
    assert.deepEqual(body.pharmacies.map((row) => row.id), ['nearest', 'further']);
    assert.equal(body.pharmacies[0].distanceKm, 0);
    assert.equal(body.pharmacies[0].distanceMiles, 0);
    assert.equal(body.pharmacies[0].isOpen, null); assert.equal(body.pharmacies[0].isPreferred, null);
    for (const row of body.pharmacies) for (const field of ['patientId', 'inventory', 'owner_user_id', 'deaNumber', 'isInNetwork', 'metadata']) assert.equal(row[field], undefined);
  });
});

test('anonymous manual search applies real area and country filters with parameterized SQL and no geocoding', async () => {
  let queried = false;
  await serve({ database: { async query(sql, parameters) {
    assert.match(sql, /UPPER\(TRIM\(country\)\)/); assert.match(sql, /LOWER\(TRIM\(city\)\)/); assert.match(sql, /LOWER\(TRIM\(state\)\)/); assert.match(sql, /zip_code = \$3/);
    assert.match(sql, /ORDER BY name,id LIMIT \$5/);
    assert.doesNotMatch(sql, /SELECT \*|patient|inventory|owner|DROP TABLE/);
    assert.deepEqual(parameters, ['Area fixture', 'CA', '90000', "x'; DROP TABLE patients;--", 2]);
    queried = true;
    return { rows: [{ id: 'registry', name: 'Registry entry', city: 'Area fixture', state: 'CA', zip_code: '90000', latitude: '0', longitude: '0', owner_user_id: 'private', is_in_network: true }] };
  } }, lookup: { findNearbyPharmacies() { throw new Error('Manual search must not call a geocoder or external lookup'); } } }, async (post) => {
    const { response, body } = await post({ market: 'US', mode: 'manual', city: 'Area fixture', state: 'CA', postalCode: '90000', q: "x'; DROP TABLE patients;--", limit: 2 });
    assert.equal(response.status, 200); assert.equal(queried, true); assert.equal(body.locationMode, 'manual');
    assert.equal(body.pharmacies[0].distanceKm, null); assert.equal(body.pharmacies[0].distanceMiles, null);
    assert.equal(body.pharmacies[0].latitude, 0); assert.equal(body.pharmacies[0].source, 'network');
    assert.equal(body.pharmacies[0].owner_user_id, undefined);
  });
});

test('invalid, mixed, unsupported market, and unbounded public lookup requests fail before providers are called', async () => {
  let calls = 0;
  await serve({ database: { query() { calls++; } }, lookup: { findNearbyPharmacies() { calls++; } } }, async (post) => {
    for (const body of [{}, { market: 'NG', city: 'Area' }, { market: 'US' }, { market: 'US', latitude: 0 }, { market: 'US', latitude: 91, longitude: 0 }, { market: 'US', latitude: 0, longitude: 0, city: 'Area' }, { market: 'US', mode: 'manual', latitude: 0, longitude: 0 }, { market: 'US', mode: 'device', city: 'Area' }, { market: 'US', city: 'Area', radius: 1 }, { market: 'US', latitude: 0, longitude: 0, radius: 20001 }, { market: 'US', city: 'Area', limit: 21 }, { market: 'US', city: 'Area', patientId: 'private' }]) {
      assert.equal((await post(body)).response.status, 400);
    }
    assert.equal(calls, 0);
  });
});

test('genuine empty directory results differ from sanitized upstream unavailability', async () => {
  await serve({ lookup: { async findNearbyPharmacies() { return []; } } }, async (post) => {
    const result = await post({ market: 'US', latitude: 0, longitude: 0 });
    assert.equal(result.response.status, 200); assert.deepEqual(result.body.pharmacies, []);
  });
  await serve({ lookup: { async findNearbyPharmacies() { throw new Error('secret credential and private address must not escape'); } } }, async (post) => {
    const result = await post({ market: 'US', latitude: 0, longitude: 0 });
    assert.equal(result.response.status, 503); assert.equal(result.body.success, false);
    assert.doesNotMatch(JSON.stringify(result.body), /secret credential|private address/);
  });
});

test('directory timeout aborts its provider signal and returns bounded unavailability', async () => {
  let cancelled = false;
  await serve({ timeoutMs: 20, lookup: { findNearbyPharmacies(_latitude, _longitude, _radius, { signal }) { return new Promise((_, reject) => signal.addEventListener('abort', () => { cancelled = true; reject(new Error('cancelled')); }, { once: true })); } } }, async (post) => {
    const result = await post({ market: 'US', latitude: 0, longitude: 0 });
    assert.equal(result.response.status, 503); assert.equal(cancelled, true);
  });
});

test('disconnecting an anonymous lookup cancels the upstream request', async () => {
  let started;
  const requestStarted = new Promise((resolve) => { started = resolve; });
  let stopped;
  const requestStopped = new Promise((resolve) => { stopped = resolve; });
  await serve({ lookup: { findNearbyPharmacies(_latitude, _longitude, _radius, { signal }) {
    started();
    return new Promise((_, reject) => signal.addEventListener('abort', () => { stopped(); reject(new Error('client disconnected')); }, { once: true }));
  } } }, async (_post, url) => {
    const controller = new AbortController();
    const response = fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ market: 'US', latitude: 0, longitude: 0 }), signal: controller.signal });
    await requestStarted;
    controller.abort();
    await assert.rejects(response, { name: 'AbortError' });
    await requestStopped;
  });
});

test('public directory requests have a dedicated rate limit', async () => {
  await serve({ maxRequests: 2, lookup: { async findNearbyPharmacies() { return []; } } }, async (post) => {
    for (let index = 0; index < 2; index++) assert.equal((await post({ market: 'US', latitude: 0, longitude: 0 })).response.status, 200);
    const blocked = await post({ market: 'US', latitude: 0, longitude: 0 });
    assert.equal(blocked.response.status, 429);
  });
});
