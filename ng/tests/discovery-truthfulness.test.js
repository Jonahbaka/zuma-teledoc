'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const express = require('express');
let pool;
const serviceFile = require.resolve('../services/discovery/providerDiscoveryService');
const originalLoad = Module._load;
let discovery;
try {
  Module._load = function directoryDependencies(request, parent) {
    if (parent?.filename === serviceFile && request === '../../../server/db') return { getPool: () => pool };
    if (parent?.filename === serviceFile && request === './seedFallbackData') throw new Error('Production discovery must never load generated fallback rows');
    return originalLoad.apply(this, arguments);
  };
  delete require.cache[serviceFile];
  discovery = require(serviceFile);
} finally { Module._load = originalLoad; }

function fixturePool({ groups = [], pharmacies = [], unavailable = false } = {}) {
  const calls = [];
  return {
    calls,
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (unavailable) throw new Error('Private integration/database detail must not reach the browser');
      if (sql.includes('FROM ng_provider_match_groups')) return { rows: groups };
      if (sql.includes('FROM ng_pharmacies p')) {
        assert.ok(sql.includes("p.status = 'approved'") && sql.includes("p.account_status = 'active'") && sql.includes('p.pcn_license_expiry >= CURRENT_DATE'));
        if (!sql.includes('JOIN LATERAL')) assert.ok(sql.includes('NULL::json AS medicine_stock_hint') && !sql.includes('stock.medicine_stock_hint'));
        return { rows: pharmacies };
      }
      return { rows: [] };
    },
  };
}

test('confirmed empty provider, pharmacy, medicine and payer directories remain genuinely empty', async () => {
  pool = fixturePool();
  const pharmacies = await discovery.searchProviders({ mode: 'pharmacy', providerType: 'pharmacy', city: 'No-recorded-area' });
  assert.deepEqual(pharmacies.providers, []); assert.equal(pharmacies.total, 0);
  assert.deepEqual((await discovery.searchProviders({ city: 'No-recorded-area' })).providers, []);
  assert.deepEqual((await discovery.searchMedicines({ query: 'No-recorded-medication' })).medicines, []);
  assert.deepEqual(await discovery.getFeaturedMedicines(), []);
  assert.deepEqual(await discovery.getFeaturedMedicineCategories(), []);
  assert.deepEqual(await discovery.getPayers(), { hmos: [], stateSchemes: [] });
});

test('directory failures surface safe unavailable states instead of invented seed records or success', async () => {
  pool = fixturePool({ unavailable: true });
  for (const operation of [
    () => discovery.searchProviders({ mode: 'pharmacy', providerType: 'pharmacy', city: 'Recorded area' }),
    () => discovery.searchMedicines({ query: 'Recorded medicine' }),
    () => discovery.getFeaturedMedicines(), () => discovery.getFeaturedMedicineCategories(), () => discovery.getPayers(),
  ]) await assert.rejects(operation(), error => error.statusCode === 503 && error.code === 'DIRECTORY_UNAVAILABLE' && !error.message.includes('Private'));
});

test('device results preserve zero coordinates, rank actual nearby coordinates and omit centroid/unknown distance or guessed ETA', async () => {
  const row = (id, name, latitude, longitude, geocode_quality = 'street') => ({ id, canonical_name: name, provider_type: 'pharmacy', city: 'Recorded area', state: 'Recorded region', latitude, longitude, geocode_quality, pharmacy_relevant: true });
  pool = fixturePool({ groups: [
    row('far', 'Recorded far directory', 0, 0.5), row('near', 'Recorded near directory', 0, 0.001),
    row('centroid', 'Recorded approximate area', 0, 0.0001, 'city_only'), row('zero', 'Recorded exact point', 0, 0),
  ] });
  const data = await discovery.searchProviders({ mode: 'pharmacy', providerType: 'pharmacy', latitude: 0, longitude: 0, radius: 20000 });
  assert.deepEqual(data.providers.map(row => row.id), ['zero', 'near']);
  assert.equal(data.providers[0].distanceKm, 0); assert.equal(data.locationSource, 'gps');
  assert.ok(data.providers.every(row => row.etaMinutes === null));
  const analytics = pool.calls.find(call => call.sql.includes('INSERT INTO ng_provider_search_logs'));
  assert.equal(analytics.params[1], null); assert.equal(analytics.params[2], null, 'Exact device coordinates are excluded from analytics');
});

test('manual pharmacy name searches do not require medication inventory joins or retain GPS coordinates', async () => {
  pool = fixturePool({ pharmacies: [{ id: 'registered-pharmacy', name: 'Recorded care pharmacy', city: 'Recorded area', state: 'Recorded region', latitude: 6, longitude: 3 }] });
  const result = await discovery.searchProviders({ city: 'Recorded area', mode: 'pharmacy', providerType: 'pharmacy', query: 'care pharmacy' });
  assert.equal(result.providers[0].rawId, 'registered-pharmacy'); assert.equal(result.providers[0].distanceKm, null);
  const lookup = pool.calls.find(call => call.sql.includes('FROM ng_pharmacies p'));
  assert.ok(lookup.sql.includes('LOWER(p.name) LIKE')); assert.ok(!lookup.sql.includes('JOIN LATERAL'));
  assert.deepEqual(lookup.params, ['Recorded area', '%care pharmacy%']);
});

test('postal-only, mixed GPS/manual and invalid radius do not broaden a Nigeria search', async () => {
  pool = fixturePool();
  for (const params of [{ postalCode: '100001' }, { latitude: 6, longitude: 3, city: 'Old city' }, { latitude: 0 }, { latitude: 6, longitude: 3, radius: 20001 }]) {
    await assert.rejects(discovery.searchProviders(params), error => error.statusCode === 400);
  }
  assert.deepEqual(await discovery.searchProviders({}), { providers: [], total: 0, locationSource: 'unresolved' });
  assert.equal(pool.calls.length, 0);
});

test('public NG directory HTTP distinguishes unsupported input, confirmed empty and unavailable safely', async () => {
  const app = express(); app.use('/directory', require('../routes/discovery'));
  const server = await new Promise(resolve => { const listener = app.listen(0, '127.0.0.1', () => resolve(listener)); });
  try {
    const get = async query => {
      const response = await fetch('http://127.0.0.1:' + server.address().port + '/directory/providers?' + query);
      return { status: response.status, body: await response.json() };
    };
    pool = fixturePool();
    const postal = await get('postalCode=100001&mode=pharmacy&providerType=pharmacy');
    assert.equal(postal.status, 400); assert.equal(postal.body.code, 'POSTAL_AREA_UNSUPPORTED'); assert.equal(pool.calls.length, 0);
    assert.equal((await get('latitude=invalid&longitude=invalid')).status, 400);
    assert.equal((await get('city=Recorded&limit=999')).status, 400);
    const empty = await get('city=Recorded&mode=pharmacy&providerType=pharmacy');
    assert.equal(empty.status, 200); assert.deepEqual(empty.body.providers, []);
    pool = fixturePool({ unavailable: true });
    const unavailable = await get('city=Recorded&mode=pharmacy&providerType=pharmacy');
    assert.equal(unavailable.status, 503); assert.equal(unavailable.body.code, 'DIRECTORY_UNAVAILABLE');
    assert.ok(!JSON.stringify(unavailable.body).includes('Private'));
  } finally { await new Promise(resolve => server.close(resolve)); pool = null; }
});
