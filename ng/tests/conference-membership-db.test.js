'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const svc = require('../services/conferencing/conferenceService');
const target = process.env.SIMULATION_DATABASE_URL;

test('PostgreSQL conference invitations, membership, capacity and end use atomic checked-out transactions', {skip:!target,timeout:45000}, async()=>{
  const url=new URL(target);assert.ok(['localhost','127.0.0.1'].includes(url.hostname)&&url.pathname.endsWith('_test'));
  const {Pool}=require('pg');const pool=new Pool({connectionString:target,max:6,statement_timeout:10000});
  const users=Array.from({length:4},()=>crypto.randomUUID());let room;
  try {
    for(const [i,id] of users.entries())await pool.query(`INSERT INTO users(id,email,password_hash,role,first_name,last_name,is_active,is_test_account,market_scope,country)
      VALUES($1,$2,'!isolated-no-login',$3,'Synthetic','Conference',TRUE,TRUE,'NG','NG')`,[id,`conference-${id}@example.invalid`,i===0?'provider':'patient']);
    const host={user_id:users[0],role:'provider'};
    room=await svc.createRoom({title:'Synthetic membership regression',patient_user_id:users[1],requires_waiting_room:false,max_participants:3,media_server:'peer_mesh'},host,pool);
    await assert.rejects(svc.joinRoom(room.id,{user_id:users[2],role:'patient'},{role:'host'},pool),{code:'FORBIDDEN'});
    const invite=await svc.createInvite(room.id,host,{role:'family'},pool);
    await assert.rejects(svc.redeemInvite(invite.token,{user_id:null},pool),{code:'FORBIDDEN'});
    assert.equal((await pool.query('SELECT used_at FROM ng_conf_invites WHERE token_hash=$1',[svc.hashToken(invite.token)])).rows[0].used_at,null);
    const concurrent=await Promise.all([svc.redeemInvite(invite.token,{user_id:users[1],role:'patient'},pool),svc.redeemInvite(invite.token,{user_id:users[2],role:'patient'},pool)]);
    assert.equal(concurrent.filter(Boolean).length,1);const member=concurrent.find(Boolean);assert.equal(member.role,'family');assert.equal(member.status,'admitted');
    const winner=member.user_id;
    await svc.removeParticipant(room.id,member.id,host,{},pool);
    await assert.rejects(svc.joinRoom(room.id,{user_id:winner,role:'patient'},{},pool),{code:'FORBIDDEN'});
    const reinvite=await svc.createInvite(room.id,host,{role:'family'},pool);
    assert.equal((await svc.redeemInvite(reinvite.token,{user_id:winner,role:'patient'},pool)).status,'admitted');
    // Re-invitation to a lower role must discard former moderator overrides.
    await pool.query(`UPDATE ng_conf_participants SET permissions_json='{"admit_others":true,"end_room":true}'::jsonb WHERE id=$1`,[member.id]);
    await svc.leaveRoom(room.id,member.id,{user_id:winner,role:'patient'},pool);
    const lower=await svc.createInvite(room.id,host,{role:'observer'},pool);
    const downgraded=await svc.redeemInvite(lower.token,{user_id:winner,role:'patient'},pool);
    assert.equal(downgraded.role,'observer');assert.deepEqual(downgraded.permissions_json,{});
    await assert.rejects(svc.createInvite(room.id,{user_id:winner,role:'patient'},{role:'family'},pool),{code:'FORBIDDEN'});
    const other=users.slice(1).find(id=>id!==winner);
    const second=await svc.createInvite(room.id,host,{role:'observer'},pool);
    const third=await svc.createInvite(room.id,host,{role:'observer'},pool);
    const finalUser=users.slice(1).find(id=>id!==winner&&id!==other);
    const capacity=await Promise.allSettled([svc.redeemInvite(second.token,{user_id:other,role:'patient'},pool),svc.redeemInvite(third.token,{user_id:finalUser,role:'patient'},pool)]);
    assert.equal(capacity.filter(result=>result.status==='fulfilled').length,1);
    assert.equal(capacity.find(result=>result.status==='rejected').reason.code,'ROOM_FULL');
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM ng_conf_participants WHERE room_id=$1 AND status='admitted'",[room.id])).rows[0].n,3);
    const failedToken=capacity[0].status==='rejected'?second.token:third.token;
    assert.equal((await pool.query('SELECT used_at FROM ng_conf_invites WHERE token_hash=$1',[svc.hashToken(failedToken)])).rows[0].used_at,null);
    // Uses a real pool with connect(): catches accidental fallback to a second
    // session that would deadlock behind the wrapper's FOR UPDATE room lock.
    await svc.startRoom(room.id,host,pool);
    assert.equal((await svc.endRoom(room.id,host,pool)).status,'ended');
    assert.equal((await svc.endRoom(room.id,host,pool)).status,'ended');
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM ng_conf_participants WHERE room_id=$1 AND status='admitted'",[room.id])).rows[0].n,0);
  } finally {
    if(room)await pool.query('DELETE FROM ng_conf_rooms WHERE id=$1',[room.id]);
    await pool.query('DELETE FROM users WHERE id=ANY($1::uuid[])',[users]);await pool.end();
  }
});
