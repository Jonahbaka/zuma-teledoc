const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const test = require('node:test');
const { createCourierProvider } = require('../services/logistics/providers');
const { requestFingerprint } = require('../services/logistics/providers/uberDirectProvider');

const NOW = Date.parse('2026-10-15T15:00:00Z');
const env = () => ({
  NODE_ENV: 'test', NG_COURIER_DELIVERY_ENABLED: 'true', NG_COURIER_PROVIDER: 'uber_direct', UBER_DIRECT_ENABLED: 'true',
  UBER_DIRECT_CONTRACT_REFERENCE: 'isolated-contract-fixture-1', UBER_DIRECT_FCT_APPROVAL_REFERENCE: 'isolated-area-fixture-1',
  UBER_DIRECT_MEDICATION_APPROVAL_REFERENCE: 'isolated-category-fixture-1', UBER_DIRECT_CLIENT_ID: 'isolated-client',
  UBER_DIRECT_CLIENT_SECRET: 'isolated-secret', UBER_DIRECT_CUSTOMER_ID: 'isolated-customer', UBER_DIRECT_WEBHOOK_SIGNING_KEY: 'isolated-webhook-key',
});
const input = () => ({
  pickup: { address: { streetAddress: ['10 Pharmacy Road'], city: 'Abuja', state: 'FCT', country: 'NG' }, latitude: 9.06, longitude: 7.49, regionCode: 'NG-FCT', contactName: 'Approved Pharmacy', contactPhone: '+2348012345678' },
  dropoff: { address: { streetAddress: ['20 Recipient Road'], city: 'Abuja', state: 'FCT', country: 'NG' }, latitude: 9.07, longitude: 7.48, regionCode: 'NG-FCT', contactName: 'Authorized Recipient', contactPhone: '+2348098765432' },
  package: { category: 'sealed_ambient_medication' },
});
const quoteResponse = overrides => ({ kind: 'delivery_quote', id: 'dqt_isolated1', fee: 280000, currency: 'ngn', currency_type: 'NGN', created: new Date(NOW).toISOString(), expires: new Date(NOW + 900000).toISOString(), pickup_duration: 12, dropoff_eta: new Date(NOW + 2400000).toISOString(), ...overrides });
const deliveryResponse = overrides => ({ id: 'del_isolated1', quote_id: 'dqt_isolated1', external_id: 'local-delivery-1', fee: 280000, currency: 'ngn', live_mode: false, status: 'pending', tracking_url: 'https://www.ubereats.com/orders/isolated', ...overrides });
function harness(responses, overrideEnv = {}) {
  const calls = [];
  const options = { env: { ...env(), ...overrideEnv }, now: () => NOW, fetchImpl: async (url, options) => {
    calls.push({ url, ...options });
    if (url === 'https://auth.uber.com/oauth/v2/token') return new Response(JSON.stringify({ access_token: 'isolated-token', token_type: 'Bearer', expires_in: 3600 }), { status: 200 });
    const next = responses.shift();
    if (next instanceof Error) throw next;
    if (next instanceof Response) return next;
    return new Response(JSON.stringify(next), { status: 200 });
  } };
  return { provider: createCourierProvider(options), calls, options };
}
async function approvedQuote(provider) { return provider.getQuote(input()); }

test('courier defaults to disabled and never fabricates a quote or dispatch', async () => {
  let calls = 0;
  const provider = createCourierProvider({ env: { NODE_ENV: 'test' }, fetchImpl: async () => { calls++; } });
  assert.equal(provider.getAvailability().available, false);
  assert.ok(provider.getAvailability().reasons.includes('fct_service_unverified'));
  await assert.rejects(provider.getQuote(input()), { code: 'COURIER_UNAVAILABLE' });
  assert.equal(calls, 0);
});

test('activation requires each approval reference and all credentials', () => {
  for (const key of Object.keys(env()).filter(key => key !== 'NODE_ENV')) {
    const { provider } = harness([], { [key]: '' });
    assert.equal(provider.getAvailability().available, false, key);
  }
  assert.throws(() => createCourierProvider({ env: { NODE_ENV: 'test', NG_COURIER_PROVIDER: 'bolt_send' } }), { code: 'COURIER_PROVIDER_UNSUPPORTED' });
  assert.throws(() => createCourierProvider({ env: { NODE_ENV: 'production' }, fetchImpl: async () => {} }), { code: 'COURIER_TEST_TRANSPORT_FORBIDDEN' });
});

test('quote uses official fixed HTTPS endpoint, precise NGN minor units, and no clinical details or contacts', async () => {
  const { provider, calls } = harness([quoteResponse()]);
  const request = { ...input(), diagnosis: 'DO_NOT_SEND', medications: ['DO_NOT_SEND'], prescriptionId: 'DO_NOT_SEND' };
  const quote = await provider.getQuote(request);
  assert.equal(quote.feeMinor, 280000);
  assert.equal(quote.currency, 'NGN');
  assert.equal(quote.providerQuoteId, 'dqt_isolated1');
  assert.equal(quote.expiresAt, '2026-10-15T15:15:00.000Z');
  assert.equal(quote.pickupEta, '2026-10-15T15:12:00.000Z');
  assert.equal(quote.requestFingerprint, requestFingerprint(request));
  assert.equal(calls[1].url, 'https://api.uber.com/v1/customers/isolated-customer/delivery_quotes');
  assert.equal(calls[1].redirect, 'error');
  assert.equal(calls[1].headers.Authorization, 'Bearer isolated-token');
  assert.doesNotMatch(calls[1].body, /DO_NOT_SEND|contactPhone|contactName|Authorized Recipient/);
  assert.equal(JSON.parse(JSON.parse(calls[1].body).pickup_address).country, 'NG');
  assert.match(calls[0].body, /scope=eats.deliveries/);
  assert.ok(calls[1].signal instanceof AbortSignal);
});

test('OAuth credentials are cached and concurrent authentication is coalesced', async () => {
  const { provider, calls } = harness([quoteResponse(), quoteResponse()]);
  await Promise.all([provider.getQuote(input()), provider.getQuote(input())]);
  assert.equal(calls.filter(call => call.url.includes('/oauth/')).length, 1);
});

test('provider rejects unsafe medicine categories, out of scope addresses and invalid coordinates before HTTP', async () => {
  for (const change of [
    value => { value.package.category = 'controlled'; },
    value => { value.package.coldChain = true; },
    value => { value.package.controlled = 'true'; },
    value => { value.package.sensitive = true; },
    value => { value.dropoff.regionCode = 'NG-LA'; },
    value => { value.pickup.latitude = '9.06'; },
    value => { value.dropoff.longitude = 190; },
    value => { value.dropoff.address.country = 'US'; },
  ]) {
    const { provider, calls } = harness([]);
    const value = input(); change(value);
    await assert.rejects(provider.getQuote(value));
    assert.equal(calls.length, 0);
  }
});

test('invalid fare, currency, expiry, or provider quote identifier is never displayed as authoritative', async () => {
  for (const override of [
    { fee: 2800.5 }, { fee: '280000' }, { fee: -1 }, { fee: Number.MAX_SAFE_INTEGER + 1 },
    { currency: 'usd', currency_type: 'USD' }, { currency: 'usd', currency_type: 'NGN' },
    { expires: new Date(NOW - 1).toISOString() }, { expires: new Date(NOW + 30000).toISOString() },
    { expires: new Date(NOW + 3600000).toISOString() }, { expires: 'next Tuesday' },
    { id: 'invalid' }, { pickup_duration: -1 }, { dropoff_eta: null },
  ]) {
    const { provider } = harness([quoteResponse(override)]);
    await assert.rejects(provider.getQuote(input()));
  }
});

test('booking binds exact quote/locations/category, includes persistent idempotency and minimal generic manifest', async () => {
  const { provider, calls } = harness([quoteResponse(), deliveryResponse()]);
  const quote = await approvedQuote(provider);
  const delivery = { id: 'local-delivery-1', ...input(), medicationNames: ['DO_NOT_SEND'], diagnosis: 'DO_NOT_SEND' };
  const booked = await provider.book({ quote, delivery, idempotencyKey: 'durable-booking-key' });
  const body = JSON.parse(calls[2].body);
  assert.equal(booked.status, 'booked');
  assert.equal(body.idempotency_key, 'durable-booking-key');
  assert.equal(body.external_id, 'local-delivery-1');
  assert.equal(body.quote_id, quote.providerQuoteId);
  assert.deepEqual(body.manifest_items, [{ name: 'Sealed pharmacy parcel', quantity: 1, size: 'small' }]);
  assert.equal(body.dropoff_phone_number, input().dropoff.contactPhone);
  assert.deepEqual(body.pickup_verification, { picture: true });
  assert.deepEqual(body.dropoff_verification, { signature: true });
  assert.equal(body.undeliverable_action, 'return');
  assert.doesNotMatch(calls[2].body, /DO_NOT_SEND|medicationNames|diagnosis|test_specifications/);
  assert.equal(JSON.parse(body.pickup_address).street_address[0], '10 Pharmacy Road');
});

test('expired quotes and changed delivery addresses cannot book', async () => {
  const { provider, calls } = harness([quoteResponse()]);
  const quote = await approvedQuote(provider);
  const delivery = { id: 'local-delivery-1', ...input() };
  await assert.rejects(provider.book({ quote: { ...quote, expiresAt: new Date(NOW - 1).toISOString() }, delivery, idempotencyKey: 'durable-booking-key' }), { code: 'COURIER_QUOTE_EXPIRED' });
  delivery.dropoff.address.streetAddress = ['Another destination'];
  await assert.rejects(provider.book({ quote, delivery, idempotencyKey: 'durable-booking-key' }), { code: 'COURIER_QUOTE_MISMATCH' });
  assert.equal(calls.length, 2);
});

test('ambiguous booking failures are flagged, sanitized and never automatically retried', async () => {
  for (const failure of [new Error('secret-token private-address'), new Response('not-json', { status: 200 }), new Response(JSON.stringify({ code: 'internal_server_error', message: 'secret-token private-address' }), { status: 500 }), new Response(JSON.stringify({ code: 'duplicate_delivery' }), { status: 400 }), deliveryResponse({ fee: 290000 }), deliveryResponse({ quote_id: 'dqt_other' })]) {
    const { provider, calls } = harness([quoteResponse(), failure]);
    const quote = await approvedQuote(provider);
    await assert.rejects(provider.book({ quote, delivery: { id: 'local-delivery-1', ...input() }, idempotencyKey: 'durable-booking-key' }), error => {
      assert.equal(error.ambiguous, true);
      assert.doesNotMatch(error.message, /secret-token|private-address/);
      return true;
    });
    assert.equal(calls.filter(call => call.url.endsWith('/deliveries')).length, 1);
  }
});

test('official get/cancel paths preserve proof without secret PIN or arbitrary clinical fields', async () => {
  const completed = deliveryResponse({ status: 'delivered', dropoff: { status: 'completed', status_timestamp: '2026-10-15T15:35:00Z', verification: { pin_code: { entered: '1234' }, signature: { image_url: 'https://tb-static.uber.com/proof.png', signer_name: 'DO_NOT_EXPOSE' }, diagnosis: 'DO_NOT_EXPOSE' } } });
  const { provider, calls } = harness([completed, deliveryResponse({ status: 'canceled' })]);
  const result = await provider.getStatus('del_isolated1');
  assert.equal(result.dropoff.completedAt, '2026-10-15T15:35:00.000Z');
  assert.deepEqual(result.dropoff.verification, { signatureUrl: 'https://tb-static.uber.com/proof.png', pinVerified: true });
  assert.doesNotMatch(JSON.stringify(result), /1234|DO_NOT_EXPOSE/);
  assert.equal((await provider.cancel('del_isolated1')).status, 'cancelled');
  assert.equal(calls[1].url, 'https://api.uber.com/v1/customers/isolated-customer/deliveries/del_isolated1');
  assert.equal(calls[1].method, 'GET');
  assert.equal(calls[2].url, 'https://api.uber.com/v1/customers/isolated-customer/deliveries/del_isolated1/cancel');
  assert.equal(calls[2].method, 'POST');
  await assert.rejects(provider.getStatus('../another-customer'), { code: 'COURIER_INPUT_INVALID' });
});

function signedEvent(override = {}) {
  const event = { id: 'evt_isolated1', customer_id: env().UBER_DIRECT_CUSTOMER_ID, kind: 'event.delivery_status', delivery_id: 'del_isolated1', status: 'delivered', live_mode: false, created: '2026-10-15T15:35:00Z', data: deliveryResponse({ status: 'delivered', updated: '2026-10-15T15:35:00Z' }), ...override };
  const raw = Buffer.from(JSON.stringify(event).replace('isolated1', 'isolated\\u0031'));
  return { raw, headers: { 'x-uber-signature': crypto.createHmac('sha256', env().UBER_DIRECT_WEBHOOK_SIGNING_KEY).update(raw).digest('hex') } };
}

test('webhook requires original bytes, HMAC, correct customer and matching delivery/status', () => {
  const { provider } = harness([]);
  const { raw, headers } = signedEvent();
  const result = provider.verifyWebhook(raw, headers);
  assert.equal(result.eventId, 'evt_isolated1');
  assert.equal(result.providerDeliveryId, 'del_isolated1');
  assert.equal(result.verified, true);
  assert.equal(result.status, 'delivered');
  assert.equal(result.payloadDigest.length, 64);
  assert.throws(() => provider.verifyWebhook(JSON.parse(raw), headers), { code: 'COURIER_WEBHOOK_INVALID' });
  assert.throws(() => provider.verifyWebhook(Buffer.from(JSON.stringify(JSON.parse(raw))), headers), { code: 'COURIER_WEBHOOK_INVALID' });
  assert.throws(() => provider.verifyWebhook(raw, { 'x-uber-signature': 'a'.repeat(64) }), { code: 'COURIER_WEBHOOK_INVALID' });
  for (const override of [{ customer_id: 'another-account' }, { delivery_id: 'del_another' }, { status: 'pending' }, { kind: 'event.refund' }, { id: 'invalid' }]) {
    const value = signedEvent(override);
    assert.throws(() => provider.verifyWebhook(value.raw, value.headers), { code: 'COURIER_WEBHOOK_INVALID' });
  }
});

test('tracking/proof URLs reject untrusted or insecure hosts', async () => {
  const { provider } = harness([deliveryResponse({ tracking_url: 'https://ubereats.com.attacker.example/track', pickup: { verification: { picture: { image_url: 'http://tb-static.uber.com/proof.png' } } } })]);
  const result = await provider.getStatus('del_isolated1');
  assert.equal(result.trackingUrl, null);
  assert.equal(result.pickup.verification, null);
});

test('production rejects correctly signed test webhooks and accepts verified live status only', () => {
  // Webhook-only test: the default HTTP transport is never called.
  const provider = createCourierProvider({ env: { ...env(), NODE_ENV: 'production' }, now: () => NOW });
  const fixture = signedEvent();
  assert.throws(() => provider.verifyWebhook(fixture.raw, fixture.headers), { code: 'COURIER_TEST_RESULT_FORBIDDEN' });
  const live = signedEvent({ live_mode: true, data: deliveryResponse({ status: 'delivered', live_mode: true }) });
  assert.equal(provider.verifyWebhook(live.raw, live.headers).liveMode, true);
});

test('status retrieval and cancellation reject provider responses belonging to another delivery', async () => {
  const { provider } = harness([deliveryResponse({ id: 'del_another' }), deliveryResponse({ id: 'del_another', status: 'canceled' })]);
  await assert.rejects(provider.getStatus('del_isolated1'), { code: 'COURIER_RESPONSE_INVALID' });
  await assert.rejects(provider.cancel('del_isolated1'), error => error.code === 'COURIER_RESPONSE_INVALID' && error.ambiguous === true);
});
