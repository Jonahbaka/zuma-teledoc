'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const target = process.env.SIMULATION_DATABASE_URL;

test('NG directory uses migrated PostgreSQL rows, valid no-inventory SQL and accurate recorded coordinate scope', { skip: !target }, async () => {
  const url = new URL(target);
  assert.ok(['localhost', '127.0.0.1'].includes(url.hostname) && url.pathname.endsWith('_test'));
  const { Pool } = require('pg'); const pool = new Pool({ connectionString: target }); const client = await pool.connect();
  const originalDatabase = process.env.DATABASE_URL; process.env.DATABASE_URL = target;
  const db = require('../../server/db'); const originalPool = db.getPool;
  const databaseFailures = [];
  try {
    await client.query('BEGIN');
    db.getPool = () => ({ async query(sql, params) {
      try { return await client.query(sql, params); }
      catch (error) { databaseFailures.push({ code: error.code, message: error.message }); throw error; }
    } });
    const discovery = require('../services/discovery/providerDiscoveryService');
    const city = 'Recorded area ' + crypto.randomUUID();
    const pharmacyId = crypto.randomUUID();
    // Temporary directory rows live only inside this isolated rollback. No
    // product/demo accounts, real business records or vendor calls are changed.
    await client.query(`INSERT INTO ng_pharmacies (id,name,slug,pcn_license_number,pcn_license_expiry,
      superintendent_name,superintendent_pcn_number,superintendent_phone,address_line1,city,state,
      phone,email,status,account_status,latitude,longitude)
      VALUES ($1,'Recorded dispensing centre',$2,$3,CURRENT_DATE+30,'Recorded pharmacist',$4,'0000000000',
        'Recorded address',$5,'Recorded region','0000000000','directory@example.invalid','approved','active',0,0)`,
    [pharmacyId, pharmacyId, pharmacyId, pharmacyId, city]);
    const found = await discovery.searchProviders({ mode: 'pharmacy', providerType: 'pharmacy', city, query: 'dispensing' });
    assert.deepEqual(found.providers.map(row => row.rawId), [pharmacyId]);
    assert.equal(found.providers[0].distanceKm, null); assert.equal(found.providers[0].medicineStockHint, null);
    const device = await discovery.searchProviders({ mode: 'pharmacy', providerType: 'pharmacy', latitude: 0, longitude: 0, query: 'dispensing' });
    assert.equal(device.providers.find(row => row.rawId === pharmacyId)?.distanceKm, 0);
    const groupIds = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
    for (const [index, longitude, precision] of [[0, 0.01, 'street'], [1, 0.001, 'street'], [2, 0.0001, 'city_only']]) {
      await client.query(`INSERT INTO ng_provider_match_groups (id,match_key,slug,canonical_name,normalized_name,
        provider_type,city,state,latitude,longitude,geocode_quality,pharmacy_relevant)
        VALUES ($1,$2,$3,$4,$5,'pharmacy',$6,'Recorded region',0,$7,$8,TRUE)`,
      [groupIds[index], groupIds[index], groupIds[index], 'Recorded directory ' + index, 'recorded directory ' + index, city, longitude, precision]);
    }
    const nearby = await discovery.searchProviders({ mode: 'pharmacy', providerType: 'pharmacy', latitude: 0, longitude: 0, query: 'recorded directory' });
    assert.deepEqual(nearby.providers.map(row => row.id), [groupIds[1], groupIds[0]]);
    const analytics = await client.query("SELECT lat,lng FROM ng_provider_search_logs WHERE query='recorded directory' ORDER BY created_at DESC LIMIT 1");
    assert.equal(analytics.rows[0].lat, null); assert.equal(analytics.rows[0].lng, null);
    // Far, high-ranked rows exceed both historic caps. The low-ranked near
    // rows must survive filtering/order in SQL, before LIMIT 200 / LIMIT 100.
    await client.query(`INSERT INTO ng_provider_match_groups (match_key,slug,canonical_name,normalized_name,
      provider_type,city,state,latitude,longitude,geocode_quality,pharmacy_relevant,trust_score)
      SELECT gen_random_uuid()::text,gen_random_uuid()::text,'Spatial recorded far '||n,'spatial recorded far '||n,
        'pharmacy',$1,'Recorded region',0,0.1,'street',TRUE,1 FROM generate_series(1,250) n`, [city]);
    const nearGroupId = crypto.randomUUID(); const nearPharmacyId = crypto.randomUUID();
    await client.query(`INSERT INTO ng_provider_match_groups (id,match_key,slug,canonical_name,normalized_name,
      provider_type,city,state,latitude,longitude,geocode_quality,pharmacy_relevant,trust_score)
      VALUES ($1,$2,$3,'Spatial recorded nearby centre','spatial recorded nearby centre',
        'pharmacy',$4,'Recorded region',0,0.001,'street',TRUE,0.01)`, [nearGroupId, nearGroupId, nearGroupId, city]);
    await client.query(`INSERT INTO ng_pharmacies (name,slug,pcn_license_number,pcn_license_expiry,
      superintendent_name,superintendent_pcn_number,superintendent_phone,address_line1,city,state,
      phone,email,status,account_status,latitude,longitude,rating,verified_at)
      SELECT 'Spatial recorded far dispensing '||n,gen_random_uuid()::text,gen_random_uuid()::text,CURRENT_DATE+30,
        'Recorded pharmacist',gen_random_uuid()::text,'0000000000','Recorded far address '||n,$1,'Recorded region',
        '0000000000','recorded-directory@example.invalid','approved','active',0,0.1,5,NOW() FROM generate_series(1,150) n`, [city]);
    await client.query(`INSERT INTO ng_pharmacies (id,name,slug,pcn_license_number,pcn_license_expiry,
      superintendent_name,superintendent_pcn_number,superintendent_phone,address_line1,city,state,
      phone,email,status,account_status,latitude,longitude,rating)
      VALUES ($1,'Spatial recorded nearby dispensing',$2,$3,CURRENT_DATE+30,'Recorded pharmacist',$4,'0000000000',
        'Recorded nearby address',$5,'Recorded region','0000000000','recorded-directory@example.invalid','approved','active',0,0.002,0)`,
    [nearPharmacyId, nearPharmacyId, nearPharmacyId, nearPharmacyId, city]);
    const narrow = await discovery.searchProviders({ mode: 'pharmacy', providerType: 'pharmacy', latitude: 0, longitude: 0, radius: 5000, query: 'spatial' });
    assert.deepEqual(narrow.providers.map(row => row.rawId || row.id), [nearGroupId, nearPharmacyId]);
    const wide = await discovery.searchProviders({ mode: 'pharmacy', providerType: 'pharmacy', latitude: 0, longitude: 0, radius: 20000, query: 'spatial' });
    assert.deepEqual(wide.providers.slice(0, 2).map(row => row.rawId || row.id), [nearGroupId, nearPharmacyId]);
    assert.equal(wide.providers.length, 12);
    assert.ok(wide.providers.every(row => row.distanceKm <= 20));
    await client.query(`INSERT INTO ng_provider_match_groups (match_key,slug,canonical_name,normalized_name,provider_type,
      latitude,longitude,geocode_quality,pharmacy_relevant)
      VALUES (gen_random_uuid()::text,gen_random_uuid()::text,'Spatial invalid coordinate','spatial invalid coordinate','pharmacy',
        'Infinity'::double precision,0,'street',TRUE)`);
    assert.ok((await discovery.searchProviders({ mode: 'pharmacy', providerType: 'pharmacy', latitude: 0, longitude: 0, query: 'spatial' })).providers.every(row => row.canonicalName !== 'Spatial invalid coordinate'));
    const absent = await discovery.searchProviders({ city: 'No recorded area ' + crypto.randomUUID() });
    assert.deepEqual(absent.providers, []);
    const catalog = await discovery.searchMedicines({ query: 'No recorded medicine ' + crypto.randomUUID() });
    assert.deepEqual(catalog.medicines, []);
    const home = await discovery.getDiscoveryHome();
    assert.ok(Array.isArray(home.featuredCategories) && Array.isArray(home.featuredMedicines));
    assert.deepEqual(home.nearestProviders, []);
    assert.ok(Array.isArray(home.payers.hmos) && Array.isArray(home.payers.stateSchemes));
  } catch (error) {
    error.message += ' Isolated database diagnostics: ' + JSON.stringify(databaseFailures);
    throw error;
  } finally {
    db.getPool = originalPool; await client.query('ROLLBACK'); client.release(); await pool.end();
    if (originalDatabase === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = originalDatabase;
  }
});
