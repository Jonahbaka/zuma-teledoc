'use strict';
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

// Called only by the isolated loopback *_test main-platform harness.
async function checkPrescriptionRecovery(page, db) {
  const account = (await db.query("SELECT id FROM users WHERE email='patient@demo.doctarx.com' AND role='patient' AND market_scope='NG' AND is_active=true")).rows[0];
  assert.ok(account);
  const keys = [], text = 'Synthetic prescription recovery fixture: review only, no dispensing instructions';
  const endpoint = '**/api/ng/patient/prescriptions/text';
  let writes = 0;
  const observe = request => { if (new URL(request.url()).pathname === '/api/ng/patient/prescriptions/text' && request.method() === 'POST') writes++; };
  page.on('request', observe);
  try {
    await page.goto('http://127.0.0.1:3003/ng/patient/prescriptions');
    await page.getByRole('button', { name: 'Type medication details' }).waitFor();
    await page.getByRole('button', { name: 'Type medication details' }).click();
    await page.getByRole('textbox', { name: 'Prescription text' }).fill(text);
    await page.route(endpoint, async route => {
      keys.push(route.request().headers()['idempotency-key']);
      const saved = await route.fetch(); assert.equal(saved.status(), 201);
      const receipt = await saved.json(); assert.ok(receipt.prescriptionId);
      await route.abort('failed'); // Lose the response only after a real committed write.
    }, { times: 1 });
    await page.getByRole('button', { name: 'Submit Prescription', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: 'could not be confirmed' }).waitFor();
    await page.unroute(endpoint);
    const marker = await page.evaluate(() => Object.entries(sessionStorage).find(([key]) => key.startsWith('doctarx:prescription-unresolved:')));
    assert.ok(marker); assert.deepEqual(JSON.parse(marker[1]), { requestId: keys[0] }); assert.ok(!marker[1].includes(text));
    await page.reload();
    await page.getByRole('status').filter({ hasText: 'Prescription submitted for review.' }).waitFor();
    assert.equal(writes, 1, 'Reload recovery must not retransmit a prescription');
    assert.equal(await page.evaluate(key => sessionStorage.getItem(key), marker[0]), null);
    assert.equal((await db.query('SELECT COUNT(*) AS count FROM ng_prescriptions WHERE patient_user_id=$1 AND submission_key=$2', [account.id, keys[0]])).rows[0].count, '1');

    // A fresh explicit submission remains permitted; content is not globally deduplicated.
    await page.getByRole('button', { name: 'Type medication details' }).click();
    await page.getByRole('textbox', { name: 'Prescription text' }).fill(text);
    const submitted = page.waitForResponse(response => new URL(response.url()).pathname === '/api/ng/patient/prescriptions/text' && response.request().method() === 'POST');
    await page.getByRole('button', { name: 'Submit Prescription', exact: true }).click();
    const second = await submitted; keys.push(second.request().headers()['idempotency-key']); assert.equal(second.status(), 201); assert.notEqual(keys[0], keys[1]);
    await page.getByRole('status').filter({ hasText: 'Prescription submitted for review.' }).waitFor();

    const missing = crypto.randomUUID();
    await page.evaluate(({ key, requestId }) => sessionStorage.setItem(key, JSON.stringify({ requestId })), { key: marker[0], requestId: missing });
    await page.reload();
    await page.getByRole('alert').filter({ hasText: 'previous submission is unresolved' }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Type medication details' }).isDisabled(), true);
    assert.equal(writes, 2, 'Missing receipt must preserve a barrier, not start a replacement');
    assert.equal(JSON.parse(await page.evaluate(key => sessionStorage.getItem(key), marker[0])).requestId, missing);
    await page.evaluate(key => sessionStorage.removeItem(key), marker[0]);
    console.log('Verified: real prescription lost-response reload receipt, single saved row, new intent and missing-receipt barrier');
  } finally {
    page.off('request', observe); await page.unroute(endpoint);
    if (keys.length) {
      await db.query("DELETE FROM audit_logs WHERE resource_type='prescription_submission' AND resource_id IN (SELECT id FROM ng_prescriptions WHERE patient_user_id=$1 AND submission_key=ANY($2::uuid[]))", [account.id, keys]);
      await db.query('DELETE FROM ng_prescriptions WHERE patient_user_id=$1 AND submission_key=ANY($2::uuid[])', [account.id, keys]);
    }
  }
}
module.exports = { checkPrescriptionRecovery };
