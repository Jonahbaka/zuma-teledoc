export function numericValue(value) {
  if (typeof value !== 'number' && (typeof value !== 'string' || !/^\d+(?:\.\d+)?$/.test(value))) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

export function countValue(value) {
  const parsed = numericValue(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

export function formatCount(value) {
  const parsed = countValue(value);
  return parsed === null ? '—' : parsed.toLocaleString('en-US');
}

export function formatMoney(value) {
  const parsed = numericValue(value);
  return parsed === null ? '—' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'NGN', maximumFractionDigits: 2 }).format(parsed);
}

export function formatDate(value) {
  if (!value) return 'Not recorded';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? 'Date unavailable' : parsed.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' });
}

export function requireRows(data, key) {
  if (data?.success === false || data?.error) throw new Error('The requested records are unavailable.');
  const rows = key ? data?.[key] : data;
  if (!Array.isArray(rows)) throw new Error('The records response could not be verified.');
  return rows;
}

export function requireSuccess(data) {
  if (data?.success !== true || data?.error) throw new Error(data?.error || 'The server did not confirm this action.');
  return data;
}

export function createRequestGate() {
  let revision = 0;
  let currentKey = null;
  return {
    begin(key) { currentKey = key; revision += 1; return { key, revision }; },
    current(ticket) { return ticket?.key === currentKey && ticket?.revision === revision; },
    cancel() { currentKey = null; revision += 1; },
  };
}

export function currentResource(state, key) {
  return state.key === key ? state : { key, data: null, loading: true, error: null };
}
