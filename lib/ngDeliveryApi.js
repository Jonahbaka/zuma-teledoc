import api from '@/lib/api';

// Never round a pharmacy-entered price or silently treat a missing price as zero.
export function nairaInputToKobo(value) {
  const text = String(value ?? '').trim();
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(text)) throw new Error('Enter a non-negative NGN amount with up to two decimal places.');
  const [whole, fraction = ''] = text.split('.');
  const kobo = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(kobo)) throw new Error('This amount is too large.');
  return kobo;
}

export function validKobo(value) {
  return (typeof value === 'number' || typeof value === 'string' && /^(?:0|[1-9]\d*)$/.test(value))
    && Number.isSafeInteger(Number(value)) && Number(value) >= 0;
}

export function formatKobo(value) {
  if (!validKobo(value)) return 'Awaiting confirmation';
  const amount = Number(value);
  const whole = Math.floor(amount / 100).toLocaleString('en-NG');
  return `NGN ${whole}.${String(amount % 100).padStart(2, '0')}`;
}

export function koboInput(value) {
  if (!validKobo(value)) return '';
  return `${Math.floor(Number(value) / 100)}.${String(Number(value) % 100).padStart(2, '0')}`;
}

export function orderItems(value) {
  try {
    const items = typeof value === 'string' ? JSON.parse(value) : value;
    return Array.isArray(items) ? items.filter(item => item && typeof item === 'object') : [];
  } catch { return []; }
}

export function deliveryDate(value) {
  if (!value || !Number.isFinite(Date.parse(value))) return 'Not yet confirmed';
  return new Intl.DateTimeFormat('en-NG', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Lagos' }).format(new Date(value));
}

export function statusLabel(value) {
  return String(value || 'Awaiting confirmation').replace(/_/g, ' ').replace(/^./, letter => letter.toUpperCase());
}

// A returned payment URL is navigation, never evidence that payment succeeded.
export function hostedMedicationPaymentUrl(data) {
  const raw = data?.authorizationUrl;
  let url;
  try { url = new URL(raw); } catch { throw new Error('A verified payment checkout link was not returned. Refresh the order before trying again.'); }
  const allowed = { paystack: ['checkout.paystack.com'], flutterwave: ['checkout.flutterwave.com'] };
  if (!allowed[data?.provider]?.includes(url.hostname) || url.protocol !== 'https:' || url.port || url.username || url.password) {
    throw new Error('A verified payment checkout link was not returned. Refresh the order before trying again.');
  }
  return url.href;
}

export function deliveryError(error, fallback = 'This request could not be completed. Refresh the order and try again.') {
  return error?.response?.data?.error || error?.message || fallback;
}

export function requestKey() {
  if (typeof crypto === 'undefined' || typeof crypto.randomUUID !== 'function') throw new Error('Secure checkout requires a browser with secure random identifiers.');
  return crypto.randomUUID();
}

export async function getPatientMedicationOrders(params, signal) {
  const response = await api.get('/ng/patient/orders', { params, signal });
  if (!Array.isArray(response.data)) throw new Error('Order records could not be confirmed.');
  return response.data;
}

export function readMedicationCheckout(data, expectedOrderId) {
  const amountNames = ['medicinesMinor', 'courierMinor', 'managementMinor', 'coordinationMinor', 'taxMinor', 'patientTotalMinor', 'insurerTotalMinor', 'totalMinor'];
  const actionNames = ['canChoose', 'canApproveMedicines', 'canPayMedicines', 'canRequestQuote', 'canApproveQuote', 'canPayDelivery', 'canDispatch', 'canCancel', 'canMarkCollected'];
  const unknownDelivery = data?.deliveryType === 'delivery' && !data.quote && data.pricing?.courierMinor === null && data.pricing?.patientTotalMinor === null && data.pricing?.totalMinor === null;
  if (!data || data.orderId !== expectedOrderId || !Number.isSafeInteger(data.version) || data.version < 0
    || !data.pharmacy?.id || !Array.isArray(data.items) || data.pricing?.currency !== 'NGN' || typeof data.checkout?.enabled !== 'boolean'
    || amountNames.some(name => !(unknownDelivery && ['courierMinor', 'patientTotalMinor', 'totalMinor'].includes(name)) && (typeof data.pricing[name] !== 'number' || !validKobo(data.pricing[name])))
    || actionNames.some(name => typeof data.actions?.[name] !== 'boolean')
    || data.items.some(item => !item?.drugId || typeof item.name !== 'string' || !Number.isSafeInteger(item.quantity) || item.quantity <= 0 || !validKobo(item.unitPriceMinor) || !validKobo(item.lineTotalMinor))) {
    throw new Error('The pharmacy checkout could not be confirmed. Refresh this order.');
  }
  const pricing = data.pricing;
  if (!unknownDelivery && (pricing.totalMinor !== pricing.patientTotalMinor + pricing.insurerTotalMinor
    || pricing.totalMinor !== pricing.medicinesMinor + pricing.courierMinor + pricing.managementMinor + pricing.coordinationMinor + pricing.taxMinor)
    || data.checkout.enabled === false && (data.actions.canPayMedicines || data.actions.canPayDelivery)
    || data.deliveryType === 'pickup' && (pricing.courierMinor !== 0 || pricing.managementMinor !== 0)
    || data.quote && (typeof data.quote.fareMinor !== 'number' || !validKobo(data.quote.fareMinor) || !data.quote.id || !data.quote.provider || !Number.isFinite(Date.parse(data.quote.expiresAt)))) {
    throw new Error('The itemized checkout amounts could not be confirmed. Refresh this order.');
  }
  return data;
}

export function quoteIsCurrent(quote, now = Date.now()) {
  return Boolean(quote?.id && quote.expired !== true && Number.isFinite(Date.parse(quote.expiresAt)) && Date.parse(quote.expiresAt) > now);
}

export function readMedicationTracking(data, trackingId) {
  if (!data || data.trackingId !== trackingId || typeof data.orderId !== 'string' || typeof data.status !== 'string'
    || !Array.isArray(data.events)) throw new Error('Private delivery tracking could not be confirmed.');
  return data;
}

export function readMedicationFinanceReport(report) {
  if (!report || report.currency !== 'NGN' || !Array.isArray(report.accounts) || !Array.isArray(report.refunds) || !Array.isArray(report.settlements)
    || !validKobo(report.totalDebitsMinor) || !validKobo(report.totalCreditsMinor) || typeof report.balanced !== 'boolean'
    || report.accounts.some(row => typeof row.account !== 'string' || !validKobo(row.debitMinor) || !validKobo(row.creditMinor))
    || report.refunds.some(row => typeof row.status !== 'string' || !Number.isSafeInteger(row.count) || row.count < 0 || !validKobo(row.amountMinor))
    || report.settlements.some(row => typeof row.payee !== 'string' || typeof row.status !== 'string' || !Number.isSafeInteger(row.count) || row.count < 0 || !validKobo(row.amountMinor))) {
    throw new Error('The medication financial report could not be confirmed.');
  }
  const debits = report.accounts.reduce((sum, row) => sum + BigInt(row.debitMinor), 0n);
  const credits = report.accounts.reduce((sum, row) => sum + BigInt(row.creditMinor), 0n);
  if (debits !== BigInt(report.totalDebitsMinor) || credits !== BigInt(report.totalCreditsMinor) || report.balanced !== (debits === credits)
    || new Set(report.accounts.map(row => row.account)).size !== report.accounts.length) throw new Error('The medication ledger totals do not match the recorded entries.');
  return report;
}

export function readMedicationPharmacyStatement(statement) {
  if (!statement || statement.currency !== 'NGN' || typeof statement.outstandingMinor !== 'number' || !validKobo(statement.outstandingMinor)
    || typeof statement.settledMinor !== 'number' || !validKobo(statement.settledMinor) || !Number.isSafeInteger(statement.orderCount) || statement.orderCount < 0
    || statement.processingCostsBorneBy !== 'DoctaRx') throw new Error('The medication settlement statement could not be confirmed.');
  return statement;
}

export function legacyWalletAmount(value) {
  if (value === null || value === undefined) return 'Awaiting confirmation';
  try { return formatKobo(nairaInputToKobo(value)); } catch { return 'Awaiting confirmation'; }
}

export function canApproveMedicationSettlement(checkout, role, enabled) {
  return enabled === true && role === 'super_admin' && checkout?.status === 'delivered' && !checkout.cancellationPending && !checkout.returns?.receivedAt;
}

export function checkoutBase(orderId, pharmacyId) {
  return pharmacyId ? `/ng/pharmacy/${encodeURIComponent(pharmacyId)}/orders/${encodeURIComponent(orderId)}` : `/ng/patient/orders/${encodeURIComponent(orderId)}`;
}

export async function getMedicationCheckout(orderId, pharmacyId, signal) {
  const response = await api.get(`${checkoutBase(orderId, pharmacyId)}/checkout`, { signal });
  return readMedicationCheckout(response.data, orderId);
}

export async function mutateMedicationCheckout(orderId, pharmacyId, action, body, signal) {
  const response = await api.post(`${checkoutBase(orderId, pharmacyId)}/${action}`, body, { signal });
  return action === 'pay' ? response.data : readMedicationCheckout(response.data, orderId);
}
