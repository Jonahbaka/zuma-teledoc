const test = require('node:test');
const assert = require('node:assert/strict');
const { getPublicShare } = require('../../lib/growth/public-share.cjs');
const { estimateAdministrativeTime } = require('../../lib/growth/workflow-planner.cjs');

test('sharing only admits fixed public destinations with no query, token or fragment', () => {
  const routes = { providers: '/for-providers', partners: '/partners', international: '/international', internationalEs: '/international/es', internationalFr: '/international/fr', internationalPt: '/international/pt', internationalAr: '/international/ar', company: '/company', press: '/press' };
  for (const [key, path] of Object.entries(routes)) {
    const share = getPublicShare(key);
    assert.equal(share.url, 'https://doctarx.com' + path);
    const url = new URL(share.url);
    assert.equal(url.search, '');
    assert.equal(url.hash, '');
    assert.equal(new URL(share.linkedin).searchParams.get('url'), share.url);
    assert.equal(new URL(share.whatsapp).searchParams.get('text'), share.text + ' ' + share.url);
  }
});

test('private paths, external URLs, prototype names and string-coercible objects cannot be shared', () => {
  for (const input of ['/patient/records', '/for-providers?token=private', 'https://evil.example', '//evil.example', '__proto__', 'constructor', 'toString', null, undefined, 1, ['providers'], { toString: () => 'providers' }]) {
    assert.equal(getPublicShare(input), null);
  }
});

test('caller data cannot replace public sharing text or destinations', () => {
  const entry = getPublicShare('providers');
  assert.ok(Object.isFrozen(entry));
  assert.equal(Reflect.set(entry, 'url', 'https://example.com/private'), false);
  assert.equal(getPublicShare('providers').url, 'https://doctarx.com/for-providers');
  assert.deepEqual(getPublicShare('providers', { text: 'patient data', url: 'https://example.com/private' }), entry);
});

test('planner calculates an explicitly chosen target against baseline staff hours', () => {
  assert.deepEqual(estimateAdministrativeTime({ enquiries: 100, minutes: 6, targetPercent: 20 }), { baselineHours: 10, targetHours: 2 });
  assert.deepEqual(estimateAdministrativeTime({ enquiries: 120, minutes: 2.5, targetPercent: 10 }), { baselineHours: 5, targetHours: 0.5 });
});

test('planner accepts zero volume and zero target without inventing savings', () => {
  assert.deepEqual(estimateAdministrativeTime({ enquiries: 0, minutes: 10, targetPercent: 50 }), { baselineHours: 0, targetHours: 0 });
  assert.deepEqual(estimateAdministrativeTime({ enquiries: 100, minutes: 6, targetPercent: 0 }), { baselineHours: 10, targetHours: 0 });
});

test('planner rejects nonfinite values, invalid ranges and fractional enquiry counts', () => {
  const valid = { enquiries: 100, minutes: 6, targetPercent: 20 };
  for (const key of Object.keys(valid)) {
    for (const invalid of [NaN, Infinity, -Infinity, null, undefined, '', '10', {}, -1]) {
      assert.equal(estimateAdministrativeTime({ ...valid, [key]: invalid }), null);
    }
  }
  for (const patch of [{ enquiries: 10001 }, { enquiries: 0.5 }, { minutes: 121 }, { targetPercent: 101 }]) assert.equal(estimateAdministrativeTime({ ...valid, ...patch }), null);
});
