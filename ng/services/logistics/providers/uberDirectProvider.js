const crypto = require('crypto');

// Endpoints and field contracts: https://github.com/uber/uber-direct-sdk
// No fallback dispatch, distance pricing, alternate host, or automatic POST retry.
const TOKEN_URL = 'https://auth.uber.com/oauth/v2/token';
const API_URL = 'https://api.uber.com/v1';
const CATEGORY = 'sealed_ambient_medication';
const STATUSES = Object.freeze({
  pending: 'booked', pickup: 'courier_assigned', pickup_complete: 'picked_up',
  dropoff: 'in_transit', delivered: 'delivered', canceled: 'cancelled', returned: 'returned',
});

class CourierProviderError extends Error {
  constructor(code, message, { status = 503, ambiguous = false, providerCode = null } = {}) {
    super(message);
    this.name = 'CourierProviderError';
    this.code = code;
    this.status = status;
    this.statusCode = status;
    this.ambiguous = ambiguous;
    this.providerCode = providerCode;
  }
}

function fail(code, message, options) { throw new CourierProviderError(code, message, options); }
function text(value, max = 200) {
  return typeof value === 'string' && value.trim().length <= max && !/[\u0000-\u001f]/.test(value)
    ? value.trim() : '';
}
function requiredText(value, field, max = 200) {
  const clean = text(value, max);
  if (!clean) fail('COURIER_INPUT_INVALID', `${field} is required`, { status: 422 });
  return clean;
}
function minor(value) {
  if (!Number.isSafeInteger(value) || value < 0) fail('COURIER_RESPONSE_INVALID', 'Courier returned an invalid monetary amount');
  return value;
}
function timestamp(value, required = false) {
  if (value == null && !required) return null;
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(value) || !Number.isFinite(Date.parse(value))) {
    fail('COURIER_RESPONSE_INVALID', 'Courier returned an invalid timestamp');
  }
  return new Date(value).toISOString();
}
function httpsUrl(value, domains) {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || !domains.some(domain => url.hostname === domain || url.hostname.endsWith(`.${domain}`))) return null;
    return url.href;
  } catch { return null; }
}
function coordinate(value, bound) {
  if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > bound) {
    fail('COURIER_INPUT_INVALID', 'Validated pickup and destination coordinates are required', { status: 422 });
  }
  return value;
}
function waypoint(input, withContact = false) {
  const address = input?.address;
  if (input?.regionCode !== 'NG-FCT' || address?.country !== 'NG' || !Array.isArray(address.streetAddress) || address.streetAddress.length < 1 || address.streetAddress.length > 3) {
    fail('COURIER_SERVICE_AREA_UNAPPROVED', 'Delivery requires an approved FCT pickup and destination', { status: 422 });
  }
  const result = {
    address: {
      street_address: address.streetAddress.map(line => requiredText(line, 'Address', 180)),
      city: requiredText(address.city, 'City', 100),
      state: requiredText(address.state, 'State', 100),
      ...(address.postalCode ? { zip_code: requiredText(address.postalCode, 'Postal code', 20) } : {}),
      country: 'NG',
    },
    latitude: coordinate(input.latitude, 90), longitude: coordinate(input.longitude, 180),
  };
  if (withContact) {
    result.contactName = requiredText(input.contactName, 'Authorized contact name', 100);
    result.contactPhone = requiredText(input.contactPhone, 'Authorized contact phone', 20);
    if (!/^\+234\d{10}$/.test(result.contactPhone)) fail('COURIER_INPUT_INVALID', 'An authorized Nigerian contact phone is required', { status: 422 });
  }
  return result;
}
function packageCategory(input) {
  if (input?.category !== CATEGORY || ['controlled', 'coldChain', 'sensitive'].some(key => input[key] != null && input[key] !== false)) {
    fail('COURIER_MEDICATION_UNAPPROVED', 'This medication category is not approved for courier delivery', { status: 422 });
  }
  return CATEGORY;
}
function requestShape({ pickup, dropoff, package: parcel }) {
  return { pickup: waypoint(pickup), dropoff: waypoint(dropoff), category: packageCategory(parcel) };
}
function requestFingerprint(input) {
  return crypto.createHash('sha256').update(JSON.stringify(requestShape(input))).digest('hex');
}
function quoteBody(input) {
  const shape = requestShape(input);
  return {
    pickup_address: JSON.stringify(shape.pickup.address), dropoff_address: JSON.stringify(shape.dropoff.address),
    pickup_latitude: shape.pickup.latitude, pickup_longitude: shape.pickup.longitude,
    dropoff_latitude: shape.dropoff.latitude, dropoff_longitude: shape.dropoff.longitude,
  };
}
function verification(input) {
  if (!input || typeof input !== 'object') return null;
  const result = {};
  const pictureUrl = httpsUrl(input.picture?.image_url, ['uber.com']);
  const signatureUrl = httpsUrl(input.signature?.image_url, ['uber.com']);
  if (pictureUrl) result.pictureUrl = pictureUrl;
  if (signatureUrl) result.signatureUrl = signatureUrl;
  // Retain verification outcome, never the secret PIN or arbitrary webhook fields.
  if (typeof input.pin_code?.entered === 'string' && input.pin_code.entered.length > 0) result.pinVerified = true;
  if (Array.isArray(input.barcodes)) {
    result.barcodeVerified = input.barcodes.some(item => item?.scan_result?.outcome === 'SUCCESS');
  }
  return Object.keys(result).length ? result : null;
}
function normalizeDelivery(data) {
  if (!data || !/^(?:del|ret)_[A-Za-z0-9_-]{1,120}$/.test(data.id || '') || !STATUSES[data.status] || String(data.currency_type || data.currency || '').toUpperCase() !== 'NGN' || (data.currency && data.currency_type && data.currency.toUpperCase() !== data.currency_type.toUpperCase())) {
    fail('COURIER_RESPONSE_INVALID', 'Courier returned an invalid delivery record');
  }
  return {
    provider: 'uber_direct', providerDeliveryId: data.id, providerStatus: data.status, status: STATUSES[data.status],
    providerQuoteId: /^dqt_[A-Za-z0-9_-]{1,120}$/.test(data.quote_id || '') ? data.quote_id : null,
    feeMinor: minor(data.fee), currency: 'NGN', externalId: text(data.external_id, 128) || null,
    liveMode: data.live_mode === true,
    trackingUrl: httpsUrl(data.tracking_url, ['uber.com', 'ubereats.com']),
    pickupEta: timestamp(data.pickup_eta), dropoffEta: timestamp(data.dropoff_eta),
    updatedAt: timestamp(data.updated),
    pickup: { completedAt: data.pickup?.status === 'completed' ? timestamp(data.pickup.status_timestamp) : null, verification: verification(data.pickup?.verification) },
    dropoff: { completedAt: data.dropoff?.status === 'completed' ? timestamp(data.dropoff.status_timestamp) : null, verification: verification(data.dropoff?.verification) },
    relatedDeliveries: Array.isArray(data.related_deliveries)
      ? data.related_deliveries.filter(item => /^ret_[A-Za-z0-9_-]+$/.test(item?.id || '') && item.relationship === 'returned').map(item => ({ id: item.id, relationship: 'returned' })) : [],
  };
}

function createUberDirectProvider({ env = process.env, fetchImpl = globalThis.fetch, now = Date.now } = {}) {
  if (fetchImpl !== globalThis.fetch && !['test', 'development'].includes(env.NODE_ENV)) {
    fail('COURIER_TEST_TRANSPORT_FORBIDDEN', 'Test courier transports are restricted to isolated test or development environments');
  }
  let cachedToken = null;
  let tokenExpiresAt = 0;
  let tokenRequest = null;
  const timeoutMs = 12000;

  function getAvailability() {
    const reasons = [];
    if (env.NG_COURIER_DELIVERY_ENABLED !== 'true' || env.NG_COURIER_PROVIDER !== 'uber_direct' || env.UBER_DIRECT_ENABLED !== 'true') reasons.push('provider_disabled');
    for (const [key, reason] of [
      ['UBER_DIRECT_CONTRACT_REFERENCE', 'contract_unverified'],
      ['UBER_DIRECT_FCT_APPROVAL_REFERENCE', 'fct_service_unverified'],
      ['UBER_DIRECT_MEDICATION_APPROVAL_REFERENCE', 'medication_permission_unverified'],
    ]) {
      if (!text(env[key], 500) || /^(test|demo|example|placeholder|changeme|todo)$/i.test(env[key].trim())) reasons.push(reason);
    }
    if (!text(env.UBER_DIRECT_CLIENT_ID) || !text(env.UBER_DIRECT_CLIENT_SECRET, 2000) || !/^[A-Za-z0-9_-]{5,128}$/.test(env.UBER_DIRECT_CUSTOMER_ID || '') || !text(env.UBER_DIRECT_WEBHOOK_SIGNING_KEY, 2000)) reasons.push('credentials_incomplete');
    if (typeof fetchImpl !== 'function') reasons.push('transport_unavailable');
    return { provider: 'uber_direct', available: reasons.length === 0, configured: reasons.length === 0, reasons, supportedRegions: ['NG-FCT'], supportedCategories: [CATEGORY], liveAvailabilityRequiresQuote: true };
  }
  function assertEnabled() {
    if (!getAvailability().available) fail('COURIER_UNAVAILABLE', 'Medication delivery is not activated for this provider');
  }
  async function transport(url, options, { booking = false } = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(url, { ...options, signal: controller.signal, redirect: 'error' });
      const raw = await response.text();
      if (raw.length > 1024 * 1024) fail('COURIER_RESPONSE_INVALID', 'Courier response exceeded the supported size', { ambiguous: booking });
      let data;
      try { data = raw ? JSON.parse(raw) : {}; } catch { fail('COURIER_RESPONSE_INVALID', 'Courier returned an invalid response', { ambiguous: booking }); }
      if (!response.ok) {
        const providerCode = /^[a-z0-9_]{1,80}$/.test(data?.code || '') ? data.code : null;
        // A duplicate or server failure may represent a booked courier. Never blindly rebook.
        fail('COURIER_API_REJECTED', 'Courier could not complete this request', {
          status: response.status === 400 || response.status === 422 ? 422 : 503,
          ambiguous: booking && (response.status >= 500 || response.status === 409 || providerCode === 'duplicate_delivery'), providerCode,
        });
      }
      return data;
    } catch (error) {
      if (error instanceof CourierProviderError) throw error;
      fail('COURIER_NETWORK_UNAVAILABLE', 'Courier request could not be confirmed', { ambiguous: booking });
    } finally { clearTimeout(timeout); }
  }
  async function accessToken() {
    if (cachedToken && tokenExpiresAt > now() + 60000) return cachedToken;
    if (!tokenRequest) {
      tokenRequest = (async () => {
        const body = new URLSearchParams({ grant_type: 'client_credentials', scope: 'eats.deliveries', client_id: env.UBER_DIRECT_CLIENT_ID, client_secret: env.UBER_DIRECT_CLIENT_SECRET });
        const data = await transport(TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString() });
        if (!text(data.access_token, 8000) || data.token_type?.toLowerCase() !== 'bearer' || !Number.isSafeInteger(data.expires_in) || data.expires_in < 120) fail('COURIER_AUTH_INVALID', 'Courier authentication could not be verified');
        cachedToken = data.access_token;
        tokenExpiresAt = now() + data.expires_in * 1000;
        return cachedToken;
      })().finally(() => { tokenRequest = null; });
    }
    return tokenRequest;
  }
  async function api(method, suffix, body, options) {
    assertEnabled();
    const token = await accessToken();
    return transport(`${API_URL}/customers/${encodeURIComponent(env.UBER_DIRECT_CUSTOMER_ID)}${suffix}`, {
      method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    }, options);
  }
  function deliveryPath(id) {
    if (!/^(?:del|ret)_[A-Za-z0-9_-]{1,120}$/.test(id || '')) fail('COURIER_INPUT_INVALID', 'A valid courier delivery identifier is required', { status: 422 });
    return `/deliveries/${encodeURIComponent(id)}`;
  }
  function confirmedDelivery(data, expectedId, ambiguous = false) {
    const result = normalizeDelivery(data);
    if ((expectedId && result.providerDeliveryId !== expectedId) || (env.NODE_ENV === 'production' && !result.liveMode)) {
      fail('COURIER_RESPONSE_INVALID', 'Courier response could not be verified for this live delivery', { ambiguous });
    }
    return result;
  }
  return {
    id: 'uber_direct', getAvailability,
    async getQuote(input) {
      assertEnabled();
      const fingerprint = requestFingerprint(input);
      const data = await api('POST', '/delivery_quotes', quoteBody(input));
      const createdAt = timestamp(data.created, true);
      const expiresAt = timestamp(data.expires, true);
      if (data.kind !== 'delivery_quote' || !/^dqt_[A-Za-z0-9_-]{1,120}$/.test(data.id || '') || String(data.currency_type || data.currency || '').toUpperCase() !== 'NGN' || (data.currency && data.currency_type && data.currency.toUpperCase() !== data.currency_type.toUpperCase())) fail('COURIER_RESPONSE_INVALID', 'Courier returned an invalid NGN quote');
      if (Date.parse(createdAt) > now() + 60000 || Date.parse(expiresAt) <= now() + 30000 || Date.parse(expiresAt) - Date.parse(createdAt) > 16 * 60000 || Date.parse(expiresAt) <= Date.parse(createdAt)) fail('COURIER_QUOTE_EXPIRED', 'Courier quote is expired or has an invalid validity period', { status: 409 });
      const pickupDuration = data.pickup_duration;
      if (!Number.isSafeInteger(pickupDuration) || pickupDuration < 0 || pickupDuration > 1440) fail('COURIER_RESPONSE_INVALID', 'Courier returned an invalid pickup estimate');
      return { provider: 'uber_direct', providerQuoteId: data.id, feeMinor: minor(data.fee), currency: 'NGN', createdAt, expiresAt, pickupEta: new Date(Date.parse(createdAt) + pickupDuration * 60000).toISOString(), dropoffEta: timestamp(data.dropoff_eta, true), requestFingerprint: fingerprint };
    },
    async book({ quote, delivery, idempotencyKey }) {
      assertEnabled();
      if (!/^[A-Za-z0-9_-]{8,128}$/.test(idempotencyKey || '') || !/^[A-Za-z0-9_-]{1,128}$/.test(delivery?.id || '')) fail('COURIER_INPUT_INVALID', 'A durable booking reference is required', { status: 422 });
      if (quote?.provider !== 'uber_direct' || quote.currency !== 'NGN' || !/^dqt_[A-Za-z0-9_-]{1,120}$/.test(quote.providerQuoteId || '') || !Number.isFinite(Date.parse(quote.expiresAt)) || Date.parse(quote.expiresAt) <= now() + 30000) fail('COURIER_QUOTE_EXPIRED', 'A fresh approved courier quote is required', { status: 409 });
      minor(quote.feeMinor);
      if (quote.requestFingerprint !== requestFingerprint(delivery)) fail('COURIER_QUOTE_MISMATCH', 'Courier quote does not match the approved pickup and destination', { status: 409 });
      const pickup = waypoint(delivery.pickup, true);
      const dropoff = waypoint(delivery.dropoff, true);
      const data = await api('POST', '/deliveries', {
        ...quoteBody(delivery), pickup_name: pickup.contactName, pickup_phone_number: pickup.contactPhone,
        dropoff_name: dropoff.contactName, dropoff_phone_number: dropoff.contactPhone,
        quote_id: quote.providerQuoteId, idempotency_key: idempotencyKey,
        manifest_reference: delivery.id, external_id: delivery.id,
        manifest_items: [{ name: 'Sealed pharmacy parcel', quantity: 1, size: 'small' }],
        pickup_verification: { picture: true }, dropoff_verification: { signature: true },
        deliverable_action: 'deliverable_action_meet_at_door', undeliverable_action: 'return',
      }, { booking: true });
      try {
        const result = confirmedDelivery(data, null, true);
        if (result.feeMinor !== quote.feeMinor || data.quote_id !== quote.providerQuoteId || result.externalId !== delivery.id) fail('COURIER_BOOKING_MISMATCH', 'Courier booking requires reconciliation against its approved quote', { ambiguous: true });
        return result;
      } catch (error) { error.ambiguous = true; throw error; }
    },
    async getStatus(id) { return confirmedDelivery(await api('GET', deliveryPath(id)), id); },
    async cancel(id) {
      const data = await api('POST', `${deliveryPath(id)}/cancel`, {}, { booking: true });
      try { return confirmedDelivery(data, id, true); } catch (error) { error.ambiguous = true; throw error; }
    },
    verifyWebhook(rawBody, headers = {}) {
      assertEnabled();
      if (!Buffer.isBuffer(rawBody) || rawBody.length > 1024 * 1024) fail('COURIER_WEBHOOK_INVALID', 'Original webhook body is required', { status: 401 });
      const signature = headers['x-uber-signature'];
      if (typeof signature !== 'string' || !/^[a-fA-F0-9]{64}$/.test(signature)) fail('COURIER_WEBHOOK_INVALID', 'Courier webhook signature is invalid', { status: 401 });
      const expected = crypto.createHmac('sha256', env.UBER_DIRECT_WEBHOOK_SIGNING_KEY).update(rawBody).digest();
      if (!crypto.timingSafeEqual(expected, Buffer.from(signature, 'hex'))) fail('COURIER_WEBHOOK_INVALID', 'Courier webhook signature is invalid', { status: 401 });
      let event;
      try { event = JSON.parse(rawBody.toString('utf8')); } catch { fail('COURIER_WEBHOOK_INVALID', 'Courier webhook payload is invalid', { status: 422 }); }
      if (!/^evt_[A-Za-z0-9_-]{1,128}$/.test(event.id || '') || event.customer_id !== env.UBER_DIRECT_CUSTOMER_ID || event.kind !== 'event.delivery_status' || event.delivery_id !== event.data?.id || event.status !== event.data?.status) fail('COURIER_WEBHOOK_INVALID', 'Courier webhook does not match this account or delivery', { status: 422 });
      if (env.NODE_ENV === 'production' && (event.live_mode !== true || event.data.live_mode !== true)) fail('COURIER_TEST_RESULT_FORBIDDEN', 'Test courier events are not accepted in production', { status: 422 });
      return { ...normalizeDelivery(event.data), eventId: event.id, eventType: event.kind, occurredAt: timestamp(event.created, true), payloadDigest: crypto.createHash('sha256').update(rawBody).digest('hex'), verified: true };
    },
  };
}

module.exports = { createUberDirectProvider, CourierProviderError, requestFingerprint, CATEGORY };
