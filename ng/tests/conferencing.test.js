'use strict';

/**
 * ng/tests/conferencing.test.js
 * Pure-function tests for the conferencing layer — state machine,
 * permission resolver, role hierarchy. No DB required.
 * Run: node --test ng/tests/conferencing.test.js
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  effectivePermissions, can, canActOn, ROLE_RANK, PERMISSION_KEYS,
  ROLE_DEFAULTS,
} = require('../../lib/ng/conferencePermissions');

// Mirror state machine
const ROOM_TRANSITIONS = {
  scheduled: ['live', 'cancelled'],
  live:      ['ended'],
  ended:     [],
  cancelled: [],
};
function isValidRoomTransition(from, to) {
  return (ROOM_TRANSITIONS[from] || []).includes(to);
}

const PEER_MESH_LIMIT = 3;
function suggestMediaServer(maxParticipants) {
  if (!maxParticipants || maxParticipants <= PEER_MESH_LIMIT) return 'peer_mesh';
  return process.env.NG_CONF_DEFAULT_MEDIA_SERVER || 'livekit';
}

// ─── Permissions ─────────────────────────────────────────────────────────────

describe('conferencePermissions — role defaults', () => {
  it('host has full operational controls', () => {
    const p = ROLE_DEFAULTS.host;
    for (const k of ['mute_others', 'kick_others', 'admit_others', 'end_room', 'start_recording', 'manage_breakouts']) {
      assert.equal(p[k], true, `host should have ${k}`);
    }
  });

  it('observers are read-only and cannot prescribe', () => {
    const p = ROLE_DEFAULTS.observer;
    assert.equal(p.speak, false);
    assert.equal(p.prescribe, false);
    assert.equal(p.finalize_diagnosis, false);
    assert.equal(p.send_chat, true, 'observers may still chat');
    assert.equal(p.see_video, true);
  });

  it('only consultant has finalize_diagnosis', () => {
    for (const role of Object.keys(ROLE_DEFAULTS)) {
      const expected = (role === 'consultant');
      assert.equal(!!ROLE_DEFAULTS[role].finalize_diagnosis, expected, `${role}.finalize_diagnosis should be ${expected}`);
    }
  });

  it('only clinicians (doctor, nurse, consultant) can update_vitals', () => {
    const allowed = ['doctor', 'nurse', 'consultant'];
    for (const role of Object.keys(ROLE_DEFAULTS)) {
      const expected = allowed.includes(role);
      assert.equal(!!ROLE_DEFAULTS[role].update_vitals, expected, `${role}.update_vitals should be ${expected}`);
    }
  });

  it('only pharmacist + consultant can review_prescriptions', () => {
    const allowed = ['pharmacist', 'consultant'];
    for (const role of Object.keys(ROLE_DEFAULTS)) {
      const expected = allowed.includes(role);
      assert.equal(!!ROLE_DEFAULTS[role].review_prescriptions, expected);
    }
  });

  it('patient cannot DM (privacy) and cannot share screen', () => {
    const p = ROLE_DEFAULTS.patient;
    assert.equal(p.send_private_dm, false);
    assert.equal(p.share_screen, false);
    assert.equal(p.speak, true);
  });
});

describe('effectivePermissions — overrides', () => {
  it('JSONB overrides patch the role default per key', () => {
    const e = effectivePermissions('observer', { prescribe: true });
    assert.equal(e.prescribe, true);
    assert.equal(e.speak, false); // untouched
  });

  it('overrides can REMOVE a default permission', () => {
    const e = effectivePermissions('host', { kick_others: false });
    assert.equal(e.kick_others, false);
    assert.equal(e.mute_others, true);
  });

  it('non-boolean overrides are ignored', () => {
    const e = effectivePermissions('nurse', { update_vitals: 'yes' });
    assert.equal(e.update_vitals, true); // default preserved
  });

  it('unknown role falls back to observer baseline', () => {
    const e = effectivePermissions('martian_emperor');
    assert.deepEqual(e, ROLE_DEFAULTS.observer);
  });

  it('can() shortcut returns boolean', () => {
    assert.equal(can('host',     {}, 'kick_others'), true);
    assert.equal(can('observer', {}, 'prescribe'),   false);
    assert.equal(can('observer', { prescribe: true }, 'prescribe'), true);
  });
});

describe('canActOn — role hierarchy', () => {
  it('host outranks everyone', () => {
    for (const target of Object.keys(ROLE_RANK).filter(r => r !== 'host')) {
      assert.equal(canActOn('host', target), true, `host should outrank ${target}`);
    }
  });
  it('consultant outranks doctor / nurse / observer but not host', () => {
    assert.equal(canActOn('consultant', 'doctor'),   true);
    assert.equal(canActOn('consultant', 'nurse'),    true);
    assert.equal(canActOn('consultant', 'observer'), true);
    assert.equal(canActOn('consultant', 'host'),     false);
  });
  it('observer can never act on anyone', () => {
    for (const t of Object.keys(ROLE_RANK).filter(r => r !== 'observer')) {
      assert.equal(canActOn('observer', t), false);
    }
  });
  it('same-rank cannot act on each other (e.g. doctor vs doctor)', () => {
    assert.equal(canActOn('doctor', 'doctor'), false);
    assert.equal(canActOn('nurse',  'pharmacist'), false); // same rank
  });
});

// ─── Room state machine ─────────────────────────────────────────────────────

describe('Room state machine', () => {
  it('scheduled → live → ended is the happy path', () => {
    assert.equal(isValidRoomTransition('scheduled', 'live'),  true);
    assert.equal(isValidRoomTransition('live',      'ended'), true);
  });
  it('cannot revive ended or cancelled rooms', () => {
    assert.equal(isValidRoomTransition('ended',     'live'), false);
    assert.equal(isValidRoomTransition('cancelled', 'live'), false);
    assert.equal(isValidRoomTransition('ended',     'scheduled'), false);
  });
  it('cancellation only from scheduled (live rooms must be ended)', () => {
    assert.equal(isValidRoomTransition('scheduled', 'cancelled'), true);
    assert.equal(isValidRoomTransition('live',      'cancelled'), false);
  });
});

// ─── Media-server suggestion ────────────────────────────────────────────────

describe('suggestMediaServer (peer-mesh ≤3 / SFU above)', () => {
  it('returns peer_mesh for 2 and 3', () => {
    assert.equal(suggestMediaServer(2), 'peer_mesh');
    assert.equal(suggestMediaServer(3), 'peer_mesh');
  });
  it('returns SFU (default livekit) for 4+', () => {
    delete process.env.NG_CONF_DEFAULT_MEDIA_SERVER;
    assert.equal(suggestMediaServer(4),  'livekit');
    assert.equal(suggestMediaServer(10), 'livekit');
    assert.equal(suggestMediaServer(50), 'livekit');
  });
  it('respects NG_CONF_DEFAULT_MEDIA_SERVER override', () => {
    process.env.NG_CONF_DEFAULT_MEDIA_SERVER = 'mediasoup';
    assert.equal(suggestMediaServer(5), 'mediasoup');
    delete process.env.NG_CONF_DEFAULT_MEDIA_SERVER;
  });
});

// ─── Permission-key surface area ────────────────────────────────────────────

describe('PERMISSION_KEYS coverage', () => {
  it('every key appears in every role default', () => {
    for (const role of Object.keys(ROLE_DEFAULTS)) {
      for (const key of PERMISSION_KEYS) {
        assert.ok(key in ROLE_DEFAULTS[role], `${role} missing key ${key}`);
      }
    }
  });
});
