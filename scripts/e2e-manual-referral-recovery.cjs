'use strict';
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

// Only called from the isolated loopback main-platform harness; no production fallback.
async function checkManualReferralRecovery(page, db) {
  const target = process.env.SIMULATION_DATABASE_URL;
  assert.ok(target && ['localhost', '127.0.0.1'].includes(new URL(target).hostname) && new URL(target).pathname.endsWith('_test'), 'Use an isolated loopback *_test database');
  const provider = (await db.query("SELECT u.id,p.id AS provider_id FROM users u JOIN ng_providers p ON p.user_id=u.id WHERE u.email='doctor@demo.doctarx.com' AND u.role='provider' AND u.market_scope='NG' AND u.is_active=true AND u.provider_status='approved' AND p.status='verified'")).rows[0];
  const patient = (await db.query("SELECT id FROM users WHERE email='patient@demo.doctarx.com' AND role='patient' AND market_scope='NG' AND is_active=true")).rows[0];
  assert.ok(provider && patient, 'Use existing provisioned demo accounts');
  const appointmentId = crypto.randomUUID(), keys = [];
  const reason = 'Synthetic browser referral recovery fixture', notes = 'Synthetic recovery supporting notes';
  const endpoint = '**/api/ng/clinical/referrals';
  let writes = 0, marker;
  const observe = request => { if (new URL(request.url()).pathname === '/api/ng/clinical/referrals' && request.method() === 'POST') writes++; };
  const fill = async () => {
    await page.getByRole('button').filter({ hasText: 'patient@demo.doctarx.com' }).click();
    await page.getByLabel('Destination or specialty', { exact: true }).fill('Synthetic recovery destination');
    await page.getByLabel('Reason for referral', { exact: true }).fill(reason);
    await page.getByLabel('Supporting clinical notes', { exact: true }).fill(notes);
  };
  page.on('request', observe);
  try {
    await db.query("INSERT INTO ng_appointments(id,patient_user_id,provider_id,scheduled_at,status,consult_fee,total_amount) VALUES($1,$2,$3,'2099-06-15T12:00:00Z','confirmed',0,0)", [appointmentId, patient.id, provider.provider_id]);
    await page.goto('http://127.0.0.1:3003/ng/provider/referrals');
    await page.getByRole('heading', { level: 1, name: 'Referrals', exact: true }).waitFor();
    await fill();
    await page.route(endpoint, async route => {
      if (route.request().method() !== 'POST') return route.continue();
      keys.push(route.request().headers()['idempotency-key']);
      const saved = await route.fetch(); assert.equal(saved.status(), 201);
      const receipt = await saved.json(); assert.equal(receipt.ok, true); assert.ok(receipt.referral.id);
      await route.abort('failed'); // Lose only the real committed 201 response.
    });
    await page.getByRole('button', { name: 'Save referral draft', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: 'Referral save is unresolved.' }).waitFor();
    await page.unroute(endpoint);
    marker = await page.evaluate(() => Object.entries(sessionStorage).find(([key]) => key.startsWith('doctarx:referral-unresolved:')));
    assert.ok(marker); assert.deepEqual(JSON.parse(marker[1]), { requestId: keys[0] });
    const browserStorage = await page.evaluate(() => JSON.stringify([Object.entries(localStorage), Object.entries(sessionStorage)]));
    assert.ok(!browserStorage.includes(reason) && !browserStorage.includes(notes), 'Clinical content is never stored in browser storage');
    const recovered = page.waitForResponse(response => new URL(response.url()).pathname === '/api/ng/clinical/referrals/requests/' + keys[0]);
    await page.reload();
    const recovery = await recovered; assert.equal(recovery.status(), 200);
    const receipt = await recovery.json(); assert.equal(receipt.ok, true);
    assert.deepEqual(Object.keys(receipt.referral).sort(), ['id', 'status']);
    await page.waitForFunction(key => sessionStorage.getItem(key) === null, marker[0]);
    assert.equal(writes, 1, 'Reload recovery must not repeat the mutation');
    assert.equal((await db.query('SELECT count(*) FROM ng_referrals WHERE provider_user_id=$1 AND manual_request_key=$2', [provider.id, keys[0]])).rows[0].count, '1');

    // An explicit new intent after recovery remains a distinct saved draft.
    await fill();
    const submitted = page.waitForResponse(response => new URL(response.url()).pathname === '/api/ng/clinical/referrals' && response.request().method() === 'POST');
    await page.getByRole('button', { name: 'Save referral draft', exact: true }).click();
    const second = await submitted; keys.push(second.request().headers()['idempotency-key']);
    assert.equal(second.status(), 201); assert.notEqual(keys[0], keys[1]);
    await page.waitForFunction(key => sessionStorage.getItem(key) === null, marker[0]);
    assert.equal((await db.query('SELECT count(*) FROM ng_referrals WHERE provider_user_id=$1 AND manual_request_key=ANY($2::uuid[])', [provider.id, keys])).rows[0].count, '2');

    const missing = crypto.randomUUID();
    await page.evaluate(({ key, requestId }) => sessionStorage.setItem(key, JSON.stringify({ requestId })), { key: marker[0], requestId: missing });
    await page.reload();
    await page.getByRole('alert').filter({ hasText: 'A previous referral save is unresolved.' }).waitFor();
    await fill();
    assert.equal(await page.getByRole('button', { name: 'Save referral draft', exact: true }).isDisabled(), true);
    assert.equal(writes, 2, 'Missing receipt keeps a barrier rather than starting a replacement');
    assert.deepEqual(JSON.parse(await page.evaluate(key => sessionStorage.getItem(key), marker[0])), { requestId: missing });
    console.log('Verified: real manual referral lost-response reload recovery, metadata-only receipt, single saved row, deliberate new intent and missing-receipt barrier');
  } finally {
    page.off('request', observe); await page.unroute(endpoint);
    if (marker) await page.evaluate(key => sessionStorage.removeItem(key), marker[0]);
    if (keys.length) {
      await db.query("DELETE FROM ng_audit_lineage WHERE resource_type='manual_referral_request' AND resource_id IN (SELECT id FROM ng_referrals WHERE provider_user_id=$1 AND manual_request_key=ANY($2::uuid[]))", [provider.id, keys]);
      await db.query('DELETE FROM ng_referrals WHERE provider_user_id=$1 AND manual_request_key=ANY($2::uuid[])', [provider.id, keys]);
    }
    await db.query('DELETE FROM ng_appointments WHERE id=$1', [appointmentId]);
  }
}
module.exports = { checkManualReferralRecovery };
