const assert = require('node:assert/strict');
const test = require('node:test');

const {
  assertRoomAccess,
  joinRoom,
} = require('../services/conferencing/conferenceService');

const room = {
  id: 'room-1',
  host_user_id: 'host-1',
  patient_user_id: 'patient-1',
  status: 'scheduled',
  requires_waiting_room: true,
  max_participants: 10,
};

function accessPool(accessRow) {
  return {
    async query(sql) {
      if (sql.includes('LEFT JOIN ng_conf_participants')) {
        return { rows: accessRow ? [{ ...room, ...accessRow }] : [{ ...room }] };
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
}

test('conference metadata rejects an authenticated non-participant', async () => {
  await assert.rejects(
    assertRoomAccess('room-1', { user_id: 'intruder-1', role: 'patient' }, {}, accessPool(null)),
    (error) => error.code === 'FORBIDDEN'
  );
});

test('admitted participants can access their room and waiting accounts cannot request media', async () => {
  const admitted = await assertRoomAccess(
    'room-1',
    { user_id: 'patient-1', role: 'patient' },
    { admittedOnly: true, allowAdmin: false },
    accessPool({
      actor_participant_id: 'participant-1',
      actor_participant_role: 'patient',
      actor_participant_status: 'admitted',
      actor_permissions: {},
    })
  );
  assert.equal(admitted.actor_participant_id, 'participant-1');

  await assert.rejects(
    assertRoomAccess(
      'room-1',
      { user_id: 'waiting-1', role: 'provider' },
      { admittedOnly: true, allowAdmin: false },
      accessPool({
        actor_participant_id: 'participant-2',
        actor_participant_role: 'observer',
        actor_participant_status: 'waiting',
        actor_permissions: {},
      })
    ),
    (error) => error.code === 'FORBIDDEN'
  );
});

test('joining cannot elevate a new account with a client-supplied host role', async () => {
  const pool = {
    async query(sql, params) {
      if (sql.includes('SELECT * FROM ng_conf_rooms')) return { rows: [room] };
      if (sql.includes('WHERE room_id=$1 AND user_id=$2')) return { rows: [] };
      if (sql.includes('COUNT(*)::int')) return { rows: [{ n: 1 }] };
      if (sql.includes('INSERT INTO ng_conf_participants')) {
        return {
          rows: [{
            id: 'participant-new',
            room_id: params[0],
            user_id: params[1],
            display_name: params[2],
            role: params[3],
            status: params[4],
          }],
        };
      }
      if (sql.includes('INSERT INTO ng_conf_events')) return { rows: [] };
      throw new Error(`Unexpected query: ${sql}`);
    },
  };

  const participant = await joinRoom(
    room.id,
    { user_id: 'new-user', role: 'provider', display_name: 'New User' },
    { display_name: 'New User', role: 'host' },
    pool
  );
  assert.equal(participant.role, 'observer');
  assert.equal(participant.status, 'waiting');
});
