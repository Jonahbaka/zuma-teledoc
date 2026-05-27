'use client';

/**
 * components/ng/referral-network/drnApi.js
 * Thin fetch wrapper for /api/ng/referral-network/*.
 */

const BASE = '/api/ng/referral-network';

async function call(path, opts = {}) {
  const res = await fetch(`${BASE}${path}`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    ...opts,
  });
  let body = null;
  try { body = await res.json(); } catch { /* ignore */ }
  if (!res.ok) {
    const msg = body?.error || `${res.status} ${res.statusText}`;
    const err = new Error(msg);
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return body;
}

export const drn = {
  organizations: (q = {}) => call('/organizations?' + new URLSearchParams(prune(q))),
  listings:      (q = {}) => call('/listings?' + new URLSearchParams(prune(q))),
  match:         (body)   => call('/match', { method: 'POST', body: JSON.stringify(body) }),

  createReferral:  (body) => call('/referrals', { method: 'POST', body: JSON.stringify(body) }),
  listReferrals:   (q={}) => call('/referrals?' + new URLSearchParams(prune(q))),
  getReferral:     (id)   => call(`/referrals/${id}`),
  getByCode:       (code) => call(`/referrals/code/${code}`),
  transition:      (id, body) => call(`/referrals/${id}/transition`, { method: 'POST', body: JSON.stringify(body) }),
  mintQr:          (id, body={}) => call(`/referrals/${id}/qr`, { method: 'POST', body: JSON.stringify(body) }),
  events:          (id)   => call(`/referrals/${id}/events`),

  kpis:        (q = {}) => call('/kpis?' + new URLSearchParams(prune(q))),
  commissions: (q = {}) => call('/commissions?' + new URLSearchParams(prune(q))),
  heatmap:     (q = {}) => call('/heatmap?' + new URLSearchParams(prune(q))),
  refreshHeatmap: () => call('/heatmap/refresh', { method: 'POST', body: '{}' }),

  registerAgent: (body) => call('/agents', { method: 'POST', body: JSON.stringify(body) }),
  listAgents:    (q={}) => call('/agents?' + new URLSearchParams(prune(q))),
};

function prune(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined && v !== null && v !== '') out[k] = v;
  }
  return out;
}

export function fmtNaira(n) {
  if (n == null) return '—';
  return '₦' + Number(n).toLocaleString('en-NG', { maximumFractionDigits: 0 });
}

export function statusBadge(status) {
  const map = {
    draft:       'bg-slate-100 text-slate-700',
    sent:        'bg-blue-100 text-blue-800',
    received:    'bg-indigo-100 text-indigo-800',
    accepted:    'bg-emerald-100 text-emerald-800',
    scheduled:   'bg-cyan-100 text-cyan-800',
    in_progress: 'bg-amber-100 text-amber-800',
    completed:   'bg-green-100 text-green-800',
    cancelled:   'bg-rose-100 text-rose-700',
    no_show:     'bg-orange-100 text-orange-700',
    declined:    'bg-rose-100 text-rose-700',
    expired:     'bg-slate-200 text-slate-600',
  };
  return map[status] || 'bg-slate-100 text-slate-700';
}

export function urgencyBadge(u) {
  return u === 'emergency' ? 'bg-rose-600 text-white'
       : u === 'urgent'    ? 'bg-amber-500 text-white'
       :                     'bg-slate-200 text-slate-700';
}
