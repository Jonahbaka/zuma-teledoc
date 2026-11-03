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

  await assert.rejects(joinRoom(room.id,
    { user_id: 'new-user', role: 'provider', display_name: 'New User' },
    { display_name: 'New User', role: 'host' }, pool), error => error.code === 'FORBIDDEN');

});

function joinPool(existing, count = 1, roomOverride = room) {
  return {
    async query(sql, params) {
      if (sql.includes('SELECT * FROM ng_conf_rooms')) return { rows: [roomOverride] };
      if (sql.includes('WHERE room_id=$1 AND user_id=$2')) return { rows: existing ? [existing] : [] };
      if (sql.includes('COUNT(*)::int')) return { rows: [{ n: count }] };
      if (sql.includes('INSERT INTO ng_conf_participants')) {
        return { rows: [{ id: existing?.id || 'participant-new', role: params[3], status: params[4] }] };
      }
      if (sql.includes('INSERT INTO ng_conf_events')) return { rows: [] };
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
}

test('a provider host joins as an admitted doctor without waiting-room self-admission', async () => {
  const participant = await joinRoom(
    room.id,
    { user_id: room.host_user_id, role: 'provider' },
    { display_name: 'Clinical host', role: 'doctor' },
    joinPool({ id: 'host-participant', role: 'doctor', status: 'admitted' }, room.max_participants)
  );
  assert.equal(participant.role, 'doctor');
  assert.equal(participant.status, 'admitted');
});

test('an admitted clinical participant retains admission when retrying a full room', async () => {
  const participant = await joinRoom(
    room.id,
    { user_id: 'consultant-1', role: 'provider' },
    { display_name: 'Consultant', role: 'host' },
    joinPool({ id: 'consultant-participant', role: 'consultant', status: 'admitted' }, room.max_participants)
  );
  assert.equal(participant.role, 'consultant');
  assert.equal(participant.status, 'admitted');
});

test('a waiting clinical participant cannot bypass capacity or gain admission on retry', async () => {
  const existing = { id: 'waiting-participant', role: 'doctor', status: 'waiting' };
  const participant = await joinRoom(
    room.id, { user_id: 'waiting-1', role: 'provider' }, { role: 'host' }, joinPool(existing)
  );
  assert.equal(participant.role, 'doctor');
  assert.equal(participant.status, 'waiting');
  await assert.rejects(
    joinRoom(room.id, { user_id: 'waiting-1', role: 'provider' }, {}, joinPool(existing, room.max_participants)),
    (error) => error.code === 'ROOM_FULL'
  );
});

test('disabled waiting room never admits strangers or resurrects removed/denied accounts', async () => {
  const direct = { ...room, requires_waiting_room:false };
  for (const existing of [null, {id:'p',role:'patient',status:'removed'}, {id:'p',role:'consultant',status:'denied'}]) {
    await assert.rejects(joinRoom(room.id,{user_id:'stranger',role:'patient'},{role:'host'},joinPool(existing,1,direct)),error=>error.code==='FORBIDDEN');
  }
  const patient=await joinRoom(room.id,{user_id:room.patient_user_id,role:'patient'},{role:'host'},joinPool(null,1,direct));
  assert.equal(patient.role,'patient'); assert.equal(patient.status,'admitted');
  const family=await joinRoom(room.id,{user_id:'family-user',role:'patient'},{role:'host'},joinPool({id:'family',role:'family',status:'invited'},1,direct));
  assert.equal(family.role,'family');
});

test('removed moderators cannot admit, deny, mute, raise hands or end another membership', async () => {
  const svc=require('../services/conferencing/conferenceService');
  let writes=0;
  const pool={async query(sql){
    if(sql.includes('SELECT * FROM ng_conf_rooms'))return{rows:[{...room,status:'live'}]};
    if(sql.includes('WHERE room_id=$1 AND user_id=$2'))return{rows:[{id:'former',role:'consultant',status:'removed'}]};
    if(sql.includes('WHERE id=$1 AND room_id=$2')) { if(sql.trim().startsWith('UPDATE'))writes++; return{rows:[{id:'target',role:'patient',status:'waiting'}]}; }
    throw new Error('Unexpected synthetic query');
  }};
  const actor={user_id:'former-user',role:'provider'};
  for(const operation of [()=>svc.admitParticipant(room.id,'target',actor,pool),()=>svc.denyParticipant(room.id,'target',actor,pool),()=>svc.leaveRoom(room.id,'target',actor,pool),()=>svc.setMute(room.id,'target',{audio:true},actor,pool),()=>svc.raiseHand(room.id,'target',true,actor,pool)])await assert.rejects(operation,error=>error.code==='FORBIDDEN');
  assert.equal(writes,0);
});

function invitationPool({ failAudit=false, expiredOnConsume=false }={}) {
  let state={used:false,participant:null};let before;const calls=[];
  const client={async query(sql,params=[]){calls.push(sql);
    if(sql==='BEGIN'){before=structuredClone(state);return{rows:[]};}
    if(sql==='ROLLBACK'){state=before;return{rows:[]};}
    if(sql==='COMMIT')return{rows:[]};
    if(sql.includes('SELECT * FROM ng_conf_invites'))return{rows:state.used?[]:[{id:'invite',room_id:room.id,role:'family',display_name:'Invited family'}]};
    if(sql.includes('SELECT * FROM ng_conf_rooms'))return{rows:[{...room,status:'live',requires_waiting_room:false}]};
    if(sql.includes('INSERT INTO ng_conf_participants')){
      if(params.length===4)state.participant={id:'member',user_id:params[1],role:params[3],status:'invited'};
      else state.participant.status=params[4];
      return{rows:[{...state.participant}]};
    }
    if(sql.includes('WHERE room_id=$1 AND user_id=$2'))return{rows:state.participant?[{...state.participant}]:[]};
    if(sql.includes('COUNT(*)::int'))return{rows:[{n:1}]};
    if(sql.includes('INSERT INTO ng_conf_events')){if(failAudit)throw new Error('Synthetic audit outage');return{rows:[]};}
    if(sql.includes('UPDATE ng_conf_invites')){if(expiredOnConsume)return{rows:[]};state.used=true;return{rows:[{id:'invite'}]};}
    throw new Error('Unexpected synthetic invitation query');
  },release(){calls.push('RELEASE');}};
  return{connect:async()=>client,calls,get state(){return state;}};
}

test('authenticated invite redemption preserves invited role and consumes only with committed membership', async()=>{
  const svc=require('../services/conferencing/conferenceService');const pool=invitationPool();
  await assert.rejects(svc.redeemInvite('synthetic-token',{user_id:null},pool),error=>error.code==='FORBIDDEN');assert.equal(pool.calls.length,0);
  const member=await svc.redeemInvite('synthetic-token',{user_id:'family-user',role:'patient'},pool);
  assert.equal(member.role,'family');assert.equal(member.status,'admitted');assert.equal(pool.state.used,true);
  assert.equal(await svc.redeemInvite('synthetic-token',{user_id:'other-user',role:'patient'},pool),null);
  assert.ok(pool.calls.some(sql=>sql.includes('ng_conf_invites')&&sql.includes('FOR UPDATE')));
  assert.equal(pool.calls.at(-1),'RELEASE');
});

test('failed or expired invitation redemption rolls participant and token changes back together',async()=>{
  const svc=require('../services/conferencing/conferenceService');
  for(const options of [{failAudit:true},{expiredOnConsume:true}]){
    const pool=invitationPool(options);
    await assert.rejects(svc.redeemInvite('synthetic-token',{user_id:'family-user',role:'patient'},pool));
    assert.equal(pool.state.used,false);assert.equal(pool.state.participant,null);assert.ok(pool.calls.includes('ROLLBACK'));
  }
});
