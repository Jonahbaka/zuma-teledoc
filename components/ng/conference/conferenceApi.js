'use client';

/**
 * components/ng/conference/conferenceApi.js
 * Thin fetch wrapper for /api/ng/conference/*.
 */

const BASE = '/api/ng/conference';

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

export const conf = {
  // Rooms
  listRooms:   (q = {}) => call('/rooms?' + new URLSearchParams(prune(q))),
  createRoom:  (body)   => call('/rooms', { method: 'POST', body: JSON.stringify(body) }),
  getRoom:     (id)     => call(`/rooms/${id}`),
  getByCode:   (code)   => call(`/rooms/code/${code}`),
  startRoom:   (id)     => call(`/rooms/${id}/start`, { method: 'POST', body: '{}' }),
  endRoom:     (id)     => call(`/rooms/${id}/end`,   { method: 'POST', body: '{}' }),
  cancelRoom:  (id, body = {}) => call(`/rooms/${id}/cancel`, { method: 'POST', body: JSON.stringify(body) }),

  // Participants
  listParticipants: (id) => call(`/rooms/${id}/participants`),
  join:    (id, body = {}) => call(`/rooms/${id}/join`,                  { method: 'POST', body: JSON.stringify(body) }),
  admit:   (id, pid)       => call(`/rooms/${id}/participants/${pid}/admit`,  { method: 'POST', body: '{}' }),
  deny:    (id, pid)       => call(`/rooms/${id}/participants/${pid}/deny`,   { method: 'POST', body: '{}' }),
  leave:   (id, pid)       => call(`/rooms/${id}/participants/${pid}/leave`,  { method: 'POST', body: '{}' }),
  remove:  (id, pid, body = {}) => call(`/rooms/${id}/participants/${pid}/remove`, { method: 'POST', body: JSON.stringify(body) }),
  promote: (id, pid, body = {}) => call(`/rooms/${id}/participants/${pid}/promote`, { method: 'POST', body: JSON.stringify(body) }),
  hand:    (id, pid, raised) => call(`/rooms/${id}/participants/${pid}/hand`, { method: 'POST', body: JSON.stringify({ raised }) }),
  mute:    (id, pid, body)   => call(`/rooms/${id}/participants/${pid}/mute`, { method: 'POST', body: JSON.stringify(body) }),

  // Invites
  createInvite: (id, body = {}) => call(`/rooms/${id}/invites`, { method: 'POST', body: JSON.stringify(body) }),

  // Chat
  listChat: (id, q = {}) => call(`/rooms/${id}/chat?` + new URLSearchParams(prune(q))),
  sendChat: (id, body)   => call(`/rooms/${id}/chat`, { method: 'POST', body: JSON.stringify(body) }),

  // Events
  events:   (id) => call(`/rooms/${id}/events`),

  // LiveKit SFU token (returns { token, livekitUrl } or 409 when not configured)
  getLiveKitToken: (id, display_name) =>
    call(`/rooms/${id}/token`, { method: 'POST', body: JSON.stringify({ display_name }) }),

  // Per-room readiness (TURN + SFU status)
  getMediaStatus: (id) => call(`/rooms/${id}/media-status`),
};

function prune(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined && v !== null && v !== '') out[k] = v;
  }
  return out;
}

export const ROLE_OPTIONS = [
  { value: 'host',       label: 'Host'        },
  { value: 'consultant', label: 'Consultant'  },
  { value: 'doctor',     label: 'Doctor'      },
  { value: 'nurse',      label: 'Nurse'       },
  { value: 'pharmacist', label: 'Pharmacist'  },
  { value: 'patient',    label: 'Patient'     },
  { value: 'family',     label: 'Family rep'  },
  { value: 'observer',   label: 'Observer'    },
];

export const KIND_OPTIONS = [
  { value: 'consultation',         label: '1:1 / Small consultation' },
  { value: 'case_conference',      label: 'Hospital case conference' },
  { value: 'teaching_round',       label: 'Teaching round'           },
  { value: 'board_review',         label: 'Board review'             },
  { value: 'emergency',            label: 'Emergency coordination'   },
  { value: 'multidisciplinary',    label: 'Multidisciplinary'        },
];

export function roleBadge(role) {
  const map = {
    host:       'bg-purple-100 text-purple-800',
    consultant: 'bg-indigo-100 text-indigo-800',
    doctor:     'bg-blue-100 text-blue-800',
    nurse:      'bg-cyan-100 text-cyan-800',
    pharmacist: 'bg-emerald-100 text-emerald-800',
    patient:    'bg-amber-100 text-amber-800',
    family:     'bg-orange-100 text-orange-800',
    observer:   'bg-slate-100 text-slate-700',
  };
  return map[role] || 'bg-slate-100 text-slate-700';
}

export function statusBadge(status) {
  const map = {
    scheduled: 'bg-slate-100 text-slate-700',
    live:      'bg-emerald-100 text-emerald-800',
    ended:     'bg-slate-200 text-slate-600',
    cancelled: 'bg-rose-100 text-rose-700',
    waiting:   'bg-amber-100 text-amber-800',
    invited:   'bg-blue-100 text-blue-800',
    admitted:  'bg-emerald-100 text-emerald-800',
    denied:    'bg-rose-100 text-rose-700',
    left:      'bg-slate-200 text-slate-600',
    removed:   'bg-rose-100 text-rose-700',
  };
  return map[status] || 'bg-slate-100 text-slate-700';
}

export function fmtDateTime(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('en-NG', {
      day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
    });
  } catch { return iso; }
}
