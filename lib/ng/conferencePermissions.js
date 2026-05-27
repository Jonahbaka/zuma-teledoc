'use strict';

/**
 * lib/ng/conferencePermissions.js
 * Pure permission resolver — usable client and server side.
 *
 * Each role has a default permission set. A participant's
 * permissions_json (JSONB on ng_conf_participants) overrides keys
 * explicitly — `{ prescribe: true }` adds, `{ prescribe: false }` removes.
 */

// Standard permission keys. Keep this list in sync with the SQL comment
// on ng_conf_participants.permissions_json.
const PERMISSION_KEYS = [
  'speak', 'see_video', 'share_screen', 'send_chat', 'send_private_dm',
  'raise_hand', 'mute_others', 'kick_others', 'admit_others', 'end_room',
  'prescribe', 'finalize_diagnosis', 'approve_referrals',
  'update_vitals', 'upload_observations',
  'review_prescriptions', 'confirm_dispense',
  'start_recording', 'manage_breakouts',
];

const ROLE_DEFAULTS = {
  host: {
    speak: true, see_video: true, share_screen: true,
    send_chat: true, send_private_dm: true, raise_hand: true,
    mute_others: true, kick_others: true, admit_others: true, end_room: true,
    prescribe: false, finalize_diagnosis: false, approve_referrals: true,
    update_vitals: false, upload_observations: false,
    review_prescriptions: false, confirm_dispense: false,
    start_recording: true, manage_breakouts: true,
  },
  consultant: {
    speak: true, see_video: true, share_screen: true,
    send_chat: true, send_private_dm: true, raise_hand: true,
    mute_others: true, kick_others: false, admit_others: true, end_room: false,
    prescribe: true, finalize_diagnosis: true, approve_referrals: true,
    update_vitals: true, upload_observations: true,
    review_prescriptions: true, confirm_dispense: false,
    start_recording: true, manage_breakouts: true,
  },
  doctor: {
    speak: true, see_video: true, share_screen: true,
    send_chat: true, send_private_dm: true, raise_hand: true,
    mute_others: false, kick_others: false, admit_others: false, end_room: false,
    prescribe: true, finalize_diagnosis: false, approve_referrals: false,
    update_vitals: true, upload_observations: true,
    review_prescriptions: false, confirm_dispense: false,
    start_recording: false, manage_breakouts: false,
  },
  nurse: {
    speak: true, see_video: true, share_screen: true,
    send_chat: true, send_private_dm: true, raise_hand: true,
    mute_others: false, kick_others: false, admit_others: false, end_room: false,
    prescribe: false, finalize_diagnosis: false, approve_referrals: false,
    update_vitals: true, upload_observations: true,
    review_prescriptions: false, confirm_dispense: false,
    start_recording: false, manage_breakouts: false,
  },
  pharmacist: {
    speak: true, see_video: true, share_screen: false,
    send_chat: true, send_private_dm: true, raise_hand: true,
    mute_others: false, kick_others: false, admit_others: false, end_room: false,
    prescribe: false, finalize_diagnosis: false, approve_referrals: false,
    update_vitals: false, upload_observations: false,
    review_prescriptions: true, confirm_dispense: true,
    start_recording: false, manage_breakouts: false,
  },
  patient: {
    speak: true, see_video: true, share_screen: false,
    send_chat: true, send_private_dm: false, raise_hand: true,
    mute_others: false, kick_others: false, admit_others: false, end_room: false,
    prescribe: false, finalize_diagnosis: false, approve_referrals: false,
    update_vitals: false, upload_observations: false,
    review_prescriptions: false, confirm_dispense: false,
    start_recording: false, manage_breakouts: false,
  },
  family: {
    speak: true, see_video: true, share_screen: false,
    send_chat: true, send_private_dm: false, raise_hand: true,
    mute_others: false, kick_others: false, admit_others: false, end_room: false,
    prescribe: false, finalize_diagnosis: false, approve_referrals: false,
    update_vitals: false, upload_observations: false,
    review_prescriptions: false, confirm_dispense: false,
    start_recording: false, manage_breakouts: false,
  },
  observer: {
    speak: false, see_video: true, share_screen: false,
    send_chat: true, send_private_dm: false, raise_hand: true,
    mute_others: false, kick_others: false, admit_others: false, end_room: false,
    prescribe: false, finalize_diagnosis: false, approve_referrals: false,
    update_vitals: false, upload_observations: false,
    review_prescriptions: false, confirm_dispense: false,
    start_recording: false, manage_breakouts: false,
  },
};

/**
 * Compute the effective permission set for a participant.
 *   role: one of ng_conf_role
 *   overrides: arbitrary { perm: boolean } object (the JSONB column)
 */
function effectivePermissions(role, overrides = {}) {
  const base = ROLE_DEFAULTS[role] || ROLE_DEFAULTS.observer;
  const out = { ...base };
  for (const k of Object.keys(overrides || {})) {
    if (typeof overrides[k] === 'boolean') out[k] = overrides[k];
  }
  return out;
}

/**
 * Quick boolean check.
 */
function can(role, overrides, permission) {
  return Boolean(effectivePermissions(role, overrides)[permission]);
}

/**
 * Role-rank — for comparing who can act on whom.
 * A higher rank can kick / mute a lower rank.
 */
const ROLE_RANK = {
  host: 100, consultant: 80, doctor: 60, pharmacist: 50, nurse: 50,
  patient: 30, family: 25, observer: 10,
};
function canActOn(actorRole, targetRole) {
  return (ROLE_RANK[actorRole] || 0) > (ROLE_RANK[targetRole] || 0);
}

module.exports = {
  PERMISSION_KEYS,
  ROLE_DEFAULTS,
  ROLE_RANK,
  effectivePermissions,
  can,
  canActOn,
};
