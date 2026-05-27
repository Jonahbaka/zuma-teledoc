'use client';

/**
 * components/ng/prescriptions/rxApi.js
 * Thin wrapper for /api/ng/prescriptions/*.
 */

const BASE = '/api/ng/prescriptions';

async function call(path, opts = {}) {
  const res = await fetch(`${BASE}${path}`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    ...opts,
  });
  let body = null;
  try { body = await res.json(); } catch { /* */ }
  if (!res.ok) {
    const msg = body?.error || `${res.status} ${res.statusText}`;
    const err = new Error(msg);
    err.status = res.status; err.body = body;
    throw err;
  }
  return body;
}

export const rx = {
  list:    (q = {}) => call('?' + new URLSearchParams(prune(q))),
  create:  (body)   => call('', { method: 'POST', body: JSON.stringify(body) }),
  get:     (id)     => call(`/${id}`),
  events:  (id)     => call(`/${id}/events`),
  sign:    (id, body = {}) => call(`/${id}/sign`,    { method: 'POST', body: JSON.stringify(body) }),
  send:    (id, body)      => call(`/${id}/send`,    { method: 'POST', body: JSON.stringify(body) }),
  receive: (id)            => call(`/${id}/receive`, { method: 'POST', body: '{}' }),
  cancel:  (id, body = {}) => call(`/${id}/cancel`,  { method: 'POST', body: JSON.stringify(body) }),
  complete:(id)            => call(`/${id}/complete`,{ method: 'POST', body: '{}' }),

  dispense:    (id, itemId, body = {}) => call(`/${id}/items/${itemId}/dispense`,    { method: 'POST', body: JSON.stringify(body) }),
  unavailable: (id, itemId, body = {}) => call(`/${id}/items/${itemId}/unavailable`, { method: 'POST', body: JSON.stringify(body) }),
  requestRefill: (id, body = {})       => call(`/${id}/refill`,                      { method: 'POST', body: JSON.stringify(body) }),
  approveRefill: (refillId)            => call(`/refills/${refillId}/approve`,       { method: 'POST', body: '{}' }),
  denyRefill:    (refillId, body = {}) => call(`/refills/${refillId}/deny`,          { method: 'POST', body: JSON.stringify(body) }),
};

function prune(o) {
  const out = {};
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null && v !== '') out[k] = v;
  return out;
}

export const STATUS_LABELS = {
  drafted:             'Draft',
  signed:              'Signed',
  sent_to_pharmacy:    'Sent',
  received:            'Acknowledged',
  partially_dispensed: 'Partial',
  fully_dispensed:     'Dispensed',
  completed:           'Completed',
  cancelled:           'Cancelled',
  expired:             'Expired',
};

export function statusBadge(s) {
  const map = {
    drafted:             'bg-slate-100 text-slate-700',
    signed:              'bg-indigo-100 text-indigo-800',
    sent_to_pharmacy:    'bg-blue-100 text-blue-800',
    received:            'bg-cyan-100 text-cyan-800',
    partially_dispensed: 'bg-amber-100 text-amber-800',
    fully_dispensed:     'bg-emerald-100 text-emerald-800',
    completed:           'bg-green-100 text-green-800',
    cancelled:           'bg-rose-100 text-rose-700',
    expired:             'bg-slate-200 text-slate-600',
  };
  return map[s] || 'bg-slate-100 text-slate-700';
}

export function fmtDate(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('en-NG', {
      day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
    });
  } catch { return iso; }
}
