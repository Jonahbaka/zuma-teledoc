'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const service = require('../services/referral-network/referralNetworkService');
const destinationUserId = '00000000-0000-4000-8000-000000000003';
const actorId = '00000000-0000-4000-8000-000000000001';
function fixture({ role = 'provider', active = true, market = 'NG', mapped = true, providerStatus = 'verified', referral = {}, failAudit = false, listing = null, patient = null, identity = {}, dispatch = {}, destinationIdentity = {}, relationship = true } = {}) {
  const log = []; let saved;
  const client = { release() {}, async query(sql, values) {
    log.push(sql);
    if (/SELECT p.user_id, r.patient_user_id\s+FROM drn_referrals/.test(sql)) return { rows: [{ user_id: destinationUserId, patient_user_id: referral.patient_user_id || actorId }] };
    if (/SELECT p.user_id FROM drn_marketplace/.test(sql)) return { rows: [] };
    if (/SELECT id, role, is_active/.test(sql)) return { rows: [{ id: actorId, role, is_active: active, market_scope: market, provider_status: 'approved', ...identity }, ...(patient ? [patient] : []), { id: destinationUserId, role: 'provider', is_active: true, market_scope: 'NG', provider_status: 'approved', ...destinationIdentity }] };
    if (/SELECT id, user_id, status FROM ng_providers/.test(sql)) return { rows: mapped ? [{ id: 'provider', user_id: actorId, status: providerStatus }] : [] };
    if (/SELECT id, user_id, status FROM drn_agents/.test(sql)) return { rows: [{ id: 'agent', user_id: actorId, status: 'active' }] };
    if (/FROM provider_patient_relationships/.test(sql)) return { rows: patient && relationship ? [{id:'care'}] : [] };
    if (/SELECT l\.\*/.test(sql)) return { rows: listing ? [listing] : [] };
    if (/SELECT l.id, l.organization_id/.test(sql)) return { rows: [{ active: true, organization_active: true, accepts_referrals: true, provider_status: 'verified', user_id: destinationUserId, organization_id: 'org', provider_id: 'provider', specialty: 'cardiology', service_kind: 'consultation', ...dispatch }] };
    if (/FROM drn_referrals r WHERE r.id/.test(sql)) return { rows: [{ id: 'ref', status: 'received', dispatched: true, specialty: 'cardiology', service_kind: 'consultation', destination_listing: 'listing', destination_org: 'org', destination_provider: 'provider', patient_user_id: actorId, originating_agent: 'agent', ...referral }] };
    if (/INSERT INTO drn_referrals/.test(sql)) { saved = values; return { rows: [{ id: 'ref', status: 'draft' }] }; }
    if (/UPDATE drn_referrals/.test(sql)) return { rows: [{ id: 'ref', status: values[1] }] };
    if (/INSERT INTO drn_referral_events/.test(sql) && failAudit) throw new Error('audit unavailable');
    return { rows: [] };
  } };
  return { pool: { connect: async () => client }, client, log, saved: () => saved };
}
const actor = { user_id: actorId, kind: 'provider' };
test('actual transition service rejects patients, originating agents and admins recording clinical acceptance', async () => {
  for (const role of ['patient', 'agent', 'admin']) {
    const f = fixture({ role });
    await assert.rejects(service.transitionReferral('ref', 'accepted', actor, {}, f.pool), { code: 'FORBIDDEN' });
    assert.ok(!f.log.some(sql => /UPDATE drn_referrals/.test(sql)));
    assert.ok(f.log.includes('ROLLBACK'));
  }
});
test('verified receiver accepts with account/mapping locks before referral lock; audit failure rolls back', async () => {
  const f = fixture();
  assert.equal((await service.transitionReferral('ref', 'accepted', actor, {}, f.pool)).status, 'accepted');
  assert.ok(f.log.findIndex(sql => /FROM users/.test(sql)) < f.log.findIndex(sql => /FROM drn_referrals/.test(sql)));
  assert.ok(f.log.includes('COMMIT'));
  const broken = fixture({ failAudit: true });
  await assert.rejects(service.transitionReferral('ref', 'accepted', actor, {}, broken.pool), /audit unavailable/);
  assert.ok(broken.log.includes('ROLLBACK')); assert.ok(!broken.log.includes('COMMIT'));
});
test('own patient sends and early cancels, but cannot cancel care in progress', async () => {
  for (const status of ['sent', 'cancelled']) {
    const f = fixture({ role: 'patient', referral: { status: 'draft' } });
    assert.equal((await service.transitionReferral('ref', status, actor, {}, f.pool)).status, status);
  }
  const f = fixture({ role: 'patient', referral: { status: 'in_progress' } });
  await assert.rejects(service.transitionReferral('ref', 'cancelled', actor, {}, f.pool), { code: 'FORBIDDEN' });
});
test('stale actor snapshots, absent provider mapping and wrong market fail closed', async () => {
  for (const opts of [{ active: false }, { mapped: false }, { providerStatus: 'suspended' }, { market: 'US' }]) {
    const f = fixture(opts);
    await assert.rejects(service.transitionReferral('ref', 'accepted', actor, {}, f.pool), { code: 'FORBIDDEN' });
  }
});
test('actual creation derives provenance/catalogue fee and does not link a human-entered patient snapshot', async () => {
  const f = fixture({ listing: { id: 'listing', active: true, organization_active: true, organization_id: 'org', provider_id: null, specialty: 'cardiology', service_kind: 'consultation', price_max_naira: '5000' } });
  await service.createReferral({ specialty: 'cardiology', reason: 'Synthetic referral', patient_name: 'Fictional person', destination_listing: 'listing', originating_agent: 'forged', originating_org: 'forged', service_fee_naira: 99999 }, actor, f.pool);
  const v = f.saved(); assert.equal(v[2], null); assert.equal(v[7], 'provider'); assert.equal(v[8], null); assert.equal(v[9], null); assert.equal(v[19], '5000');
});
test('actual creation rejects attachments and unauthorized imaging including catalogue-derived kind', async () => {
  const previous = process.env.NG_MEDICAL_IMAGING_AUTHORIZED; delete process.env.NG_MEDICAL_IMAGING_AUTHORIZED;
  try {
    for (const extra of [{ attached_soap_id: 'foreign' }, { attached_files_json: ['file'] }, { service_kind: 'imaging' }, { service_kind: ' IMAGING ' }, { specialty: ' IMAGING_MRI ' }]) {
      const f = fixture(); await assert.rejects(service.createReferral({ specialty: 'cardiology', reason: 'Synthetic', ...extra }, actor, f.pool), { code: 'FORBIDDEN' });
      assert.equal(f.saved(), undefined);
    }
    const f = fixture({ listing: { active: true, organization_active: true, organization_id: 'org', specialty: 'cardiology', service_kind: 'imaging' } });
    await assert.rejects(service.createReferral({ specialty: 'cardiology', reason: 'Synthetic', destination_listing: 'listing' }, actor, f.pool), { code: 'FORBIDDEN' });
  } finally { if (previous === undefined) delete process.env.NG_MEDICAL_IMAGING_AUTHORIZED; else process.env.NG_MEDICAL_IMAGING_AUTHORIZED = previous; }
});
test('actual POST route rejects imaging service kind before creation', async () => {
  const router = require('../routes/referralNetwork');
  const route = router.stack.find(layer => layer.route?.path === '/referrals' && layer.route.methods.post).route;
  const handler = route.stack[route.stack.length - 1].handle;
  const res = { statusCode: 200, status(value) { this.statusCode = value; return this; }, json(value) { this.body = value; return this; } };
  const previous = process.env.NG_MEDICAL_IMAGING_AUTHORIZED; delete process.env.NG_MEDICAL_IMAGING_AUTHORIZED;
  try {
    await handler({ user: { id: actorId, role: 'patient' }, body: { specialty: 'cardiology', service_kind: 'imaging', reason: 'Synthetic' } }, res);
    assert.equal(res.statusCode, 403);
  } finally { if (previous === undefined) delete process.env.NG_MEDICAL_IMAGING_AUTHORIZED; else process.env.NG_MEDICAL_IMAGING_AUTHORIZED = previous; }
});

const target = process.env.SIMULATION_DATABASE_URL;
test('isolated PostgreSQL serializes account revocation and concurrent transition; audit failure rolls back creation', { skip: !target, timeout: 45000 }, async () => {
  const { fixtureTargetSafety } = require('../scripts/fixtureTargetSafety');
  const safety = fixtureTargetSafety({ env: { ...process.env, DATABASE_URL: target } });
  assert.equal(safety.skipped, false, safety.reason);
  const { Pool } = require('pg'); const crypto = require('node:crypto');
  const pool = new Pool({ connectionString: target, max: 6, statement_timeout: 10000 });
  const userId = crypto.randomUUID(); const realActor = { user_id: userId };
  try {
    await pool.query("INSERT INTO users(id,email,password_hash,role,first_name,last_name,is_active,is_test_account,market_scope) VALUES($1,$2,'!synthetic','patient','Synthetic','Referral',TRUE,TRUE,'NG')", [userId, `referral-${userId}@example.invalid`]);
    const input = { specialty: 'cardiology', reason: 'Synthetic fixture, not clinical care' };
    const row = await service.createReferral(input, realActor, pool);
    const results = await Promise.allSettled([service.transitionReferral(row.id, 'cancelled', realActor, {}, pool), service.transitionReferral(row.id, 'cancelled', realActor, {}, pool)]);
    assert.equal(results.filter(value => value.status === 'fulfilled').length, 1);
    assert.equal(results.find(value => value.status === 'rejected').reason.code, 'INVALID_TRANSITION');
    const failingPool = { connect: async () => {
      const client = await pool.connect();
      return { release: () => client.release(), query: (sql, values) => /INSERT INTO drn_referral_events/.test(sql) ? Promise.reject(new Error('Synthetic audit outage')) : client.query(sql, values) };
    } };
    await assert.rejects(service.createReferral(input, realActor, failingPool), /Synthetic audit outage/);
    assert.equal(Number((await pool.query('SELECT count(*) FROM drn_referrals WHERE patient_user_id=$1', [userId])).rows[0].count), 1);
    const pendingRow = await service.createReferral(input, realActor, pool);
    const blocker = await pool.connect();
    try {
      await blocker.query('BEGIN'); await blocker.query('UPDATE users SET is_active=FALSE WHERE id=$1', [userId]);
      const pid = (await blocker.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
      const pending = assert.rejects(service.transitionReferral(pendingRow.id, 'cancelled', realActor, {}, pool), { code: 'FORBIDDEN' });
      pending.catch(() => {});
      let waiting = false; const deadline = Date.now() + 5000;
      while (Date.now() < deadline) {
        waiting = (await pool.query("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND $1=ANY(pg_blocking_pids(pid))) AS waiting", [pid])).rows[0].waiting;
        if (waiting) break;
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      assert.equal(waiting, true, 'Transition must actually wait on account revocation');
      await blocker.query('COMMIT'); await pending;
      assert.equal((await pool.query('SELECT status FROM drn_referrals WHERE id=$1', [pendingRow.id])).rows[0].status, 'draft');
    } finally { await blocker.query('ROLLBACK'); blocker.release(); }
  } finally {
    await pool.query('DELETE FROM drn_referrals WHERE patient_user_id=$1', [userId]);
    await pool.query('DELETE FROM users WHERE id=$1', [userId]);
    await pool.end();
  }
});
test('patient creation clears forged clinical origin and derives only own patient identity', async () => {
  const f = fixture({ role: 'patient' });
  await service.createReferral({ specialty: 'cardiology', reason: 'Synthetic', originating_provider: 'forged', originating_agent: 'forged', originating_org: 'forged' }, actor, f.pool);
  const v = f.saved(); assert.equal(v[2], actorId); assert.equal(v[7], null); assert.equal(v[8], null); assert.equal(v[9], null);
});
test('creation rejects missing mapping, inactive catalogue and mismatched destination without inserting', async () => {
  const cases = [
    [fixture({ mapped: false }), {}],
    [fixture({ listing: { active: false, organization_active: true } }), { destination_listing: 'listing' }],
    [fixture({ listing: { active: true, organization_active: true, organization_id: 'org', specialty: 'cardiology', service_kind: 'consultation' } }), { destination_listing: 'listing', destination_org: 'other' }],
    [fixture(), { patient_user_id: '00000000-0000-4000-8000-000000000002' }],
  ];
  for (const [f, extra] of cases) {
    await assert.rejects(service.createReferral({ specialty: 'cardiology', reason: 'Synthetic', ...extra }, actor, f.pool), { code: 'FORBIDDEN' });
    assert.equal(f.saved(), undefined);
  }
});
test('admin may operationally cancel but is not a clinical destination actor', async () => {
  const f = fixture({ role: 'admin', referral: { status: 'in_progress' } });
  assert.equal((await service.transitionReferral('ref', 'cancelled', actor, {}, f.pool)).status, 'cancelled');
  const denied = fixture({ role: 'admin', referral: { status: 'in_progress' } });
  await assert.rejects(service.transitionReferral('ref', 'completed', actor, {}, denied.pool), { code: 'FORBIDDEN' });
});


test('linked patient identity comes from the locked account, never submitted snapshot claims', async () => {
  const supplied = { specialty:'cardiology', reason:'Synthetic', patient_name:'Forged name',patient_phone:'forged',patient_age:99,patient_sex:'unverified' };
  const self=fixture({role:'patient',identity:{first_name:'Recorded',last_name:'Patient',phone:'synthetic-contact',date_of_birth:'2000-01-01'}});
  await service.createReferral(supplied,actor,self.pool);
  assert.equal(self.saved()[2],actorId);assert.equal(self.saved()[3],'Recorded Patient');assert.equal(self.saved()[4],'synthetic-contact');assert.notEqual(self.saved()[5],99);assert.equal(self.saved()[6],null);
  const missing=fixture({role:'patient'});await service.createReferral(supplied,actor,missing.pool);
  assert.deepEqual(missing.saved().slice(3,7),[null,null,null,null]);
  const patient={id:'00000000-0000-4000-8000-000000000002',role:'patient',is_active:true,market_scope:'NG',first_name:'Linked',last_name:'Record'};
  const provider=fixture({patient});await service.createReferral({...supplied,patient_user_id:patient.id},actor,provider.pool);
  assert.equal(provider.saved()[2],patient.id);assert.equal(provider.saved()[3],'Linked Record');assert.equal(provider.saved()[4],null);
  const unlinked=fixture();await service.createReferral(supplied,actor,unlinked.pool);
  assert.equal(unlinked.saved()[2],null);assert.equal(unlinked.saved()[3],supplied.patient_name);
});


test('server action hints intersect current actor authority with the actual state graph', () => {
 const referral={status:'received',dispatched:true,patient_user_id:actorId,destination_provider:'receiver'};
 assert.deepEqual(service.allowedTransitions({role:'patient',userId:actorId},referral),['cancelled']);
 assert.deepEqual(service.allowedTransitions({role:'provider',providerId:'receiver'},referral),['accepted','declined','cancelled']);
 assert.deepEqual(service.allowedTransitions(null,referral),[]);
 assert.deepEqual(service.allowedTransitions({role:'provider',providerId:'receiver'},{...referral,status:'completed'}),[]);
});


test('verified NG profile never overrides pending, rejected or suspended global clinician approval', async () => {
 for(const provider_status of ['pending','rejected','suspended']) {
  const f=fixture({identity:{provider_status}});
  await assert.rejects(service.transitionReferral('ref','accepted',actor,{},f.pool),{code:'FORBIDDEN'});
  assert.ok(!f.log.some(sql=>/UPDATE drn_referrals/.test(sql)));
  const create=fixture({identity:{provider_status}});
  await assert.rejects(service.createReferral({specialty:'cardiology',reason:'Synthetic'},actor,create.pool),{code:'FORBIDDEN'});
 }
});

test('destination clinician approval is checked under account lock even with a verified NG mapping', async () => {
 const {actorScope}=require('../services/referral-network/referralAuthority');
 const destination='00000000-0000-4000-8000-000000000003';
 for(const provider_status of ['pending','rejected','suspended']) {
  const client={async query(sql){assert.match(sql,/ORDER BY id FOR SHARE/);return{rows:[{id:actorId,role:'patient',is_active:true,market_scope:'NG'},{id:destination,role:'provider',is_active:true,market_scope:'NG',provider_status}]};}};
  await assert.rejects(actorScope(client,{user_id:actorId},null,destination),{code:'FORBIDDEN'});
 }
});


test('catalogue and read visibility cannot bypass imaging gate with case or whitespace', async () => {
 const old=process.env.NG_MEDICAL_IMAGING_AUTHORIZED;delete process.env.NG_MEDICAL_IMAGING_AUTHORIZED;
 try {
  const helpers=require('../routes/referralNetwork')._test;
  for(const entry of [{specialty:'cardiology',service_kind:' Imaging '},{specialty:' IMAGING_MRI ',service_kind:'consultation'}]) {
   assert.equal(helpers.isMedicalImaging(entry),true);assert.equal(helpers.imagingVisible(entry),false);
   const f=fixture({listing:{active:true,organization_active:true,organization_id:'org',...entry}});
   await assert.rejects(service.createReferral({specialty:entry.specialty.trim().toLowerCase(),reason:'Synthetic',destination_listing:'listing'},actor,f.pool),{code:'FORBIDDEN'});
   assert.equal(f.saved(),undefined);
  }
 } finally {if(old===undefined)delete process.env.NG_MEDICAL_IMAGING_AUTHORIZED;else process.env.NG_MEDICAL_IMAGING_AUTHORIZED=old;}
});

test('sending requires an actual current inbox destination and preserves the draft on failure', async () => {
  for (const field of ['destination_listing', 'destination_org', 'destination_provider']) {
    const f = fixture({ role: 'patient', referral: { status: 'draft', [field]: null } });
    await assert.rejects(service.transitionReferral('ref', 'sent', actor, {}, f.pool), { code: 'DESTINATION_UNAVAILABLE' });
    assert.ok(!f.log.some(sql => /UPDATE drn_referrals/.test(sql)));
    assert.ok(f.log.includes('ROLLBACK'));
  }
  for (const dispatch of [{ active: false }, { organization_active: false }, { accepts_referrals: false },
    { provider_status: 'suspended' }, { user_id: 'changed-account' }, { provider_id: 'changed-provider' },
    { organization_id: 'changed-org' }, { specialty: 'neurology' }, { service_kind: 'lab' }]) {
    const f = fixture({ role: 'patient', referral: { status: 'draft' }, dispatch });
    await assert.rejects(service.transitionReferral('ref', 'sent', actor, {}, f.pool), { code: 'DESTINATION_UNAVAILABLE' });
    assert.ok(!f.log.some(sql => /UPDATE drn_referrals/.test(sql)));
    assert.ok(f.log.includes('ROLLBACK'));
  }
  for (const destinationIdentity of [{ is_active: false }, { provider_status: 'suspended' }, { market_scope: 'US' }, { role: 'patient' }]) {
    const f = fixture({ role: 'patient', referral: { status: 'draft' }, destinationIdentity });
    await assert.rejects(service.transitionReferral('ref', 'sent', actor, {}, f.pool), { code: 'FORBIDDEN' });
    assert.ok(!f.log.some(sql => /UPDATE drn_referrals/.test(sql)));
  }
});

test('dispatch checks lock receiver accounts and catalogue before status and audit writes', async () => {
  const f = fixture({ role: 'patient', referral: { status: 'draft', dispatched: false } });
  const row = await service.transitionReferral('ref', 'sent', actor, {}, f.pool);
  assert.equal(row.dispatched, true);
  const account = f.log.findIndex(sql => /FROM users/.test(sql));
  const destination = f.log.findIndex(sql => /FOR SHARE OF l,o,p/.test(sql));
  const update = f.log.findIndex(sql => /UPDATE drn_referrals/.test(sql));
  const audit = f.log.findIndex(sql => /INSERT INTO drn_referral_events/.test(sql));
  assert.ok(account >= 0 && account < destination && destination < update && update < audit);
  const broken = fixture({ role: 'patient', referral: { status: 'draft', dispatched: false }, failAudit: true });
  await assert.rejects(service.transitionReferral('ref', 'sent', actor, {}, broken.pool), /audit unavailable/);
  assert.ok(broken.log.includes('ROLLBACK'));
  assert.ok(!broken.log.includes('COMMIT'));
});

test('receiver cannot read drafts or cancelled drafts without dispatch evidence', async () => {
  const { canReadReferral } = require('../services/referral-network/referralAuthority');
  const receiver = { role: 'provider', providerId: 'receiver' };
  const row = { destination_provider: 'receiver', originating_provider: 'origin', patient_user_id: actorId };
  for (const status of ['draft', 'cancelled', 'sent', 'completed']) {
    assert.equal(canReadReferral(receiver, { ...row, status, dispatched: false }), false);
    assert.equal(canReadReferral(receiver, { ...row, status }), false);
  }
  assert.equal(canReadReferral(receiver, { ...row, status: 'cancelled', dispatched: true }), true);
  assert.equal(canReadReferral({ role: 'provider', providerId: 'origin' }, { ...row, status: 'draft' }), true);
  assert.equal(canReadReferral({ role: 'patient', userId: actorId }, { ...row, status: 'draft' }), true);
  assert.equal(canReadReferral({ admin: true }, { ...row, status: 'draft' }), true);
  const receiverBeforeSend = fixture({ referral: { status: 'sent', dispatched: false } });
  await assert.rejects(service.transitionReferral('ref', 'received', actor, {}, receiverBeforeSend.pool), { code: 'FORBIDDEN' });
});

test('unroutable drafts expose no send action and stale read roles cannot restore clinical access', async () => {
  const scope = { role: 'patient', userId: actorId };
  assert.deepEqual(service.allowedTransitions(scope, { status: 'draft', patient_user_id: actorId }), ['cancelled']);
  const route = require('../routes/referralNetwork')._test;
  for (const stale of [{ active: false }, { providerStatus: 'suspended' }, { identity: { provider_status: 'pending' } }]) {
    const f = fixture(stale);
    await assert.rejects(route.referralActorScope({ user: { id: actorId, role: 'admin' } }, f.client), { code: 'FORBIDDEN' });
  }
  const patient = fixture({ role: 'patient' });
  const fresh = await route.referralActorScope({ user: { id: actorId, role: 'admin' } }, patient.client);
  assert.equal(fresh.role, 'patient'); assert.equal(fresh.admin, false);
});

test('isolated PostgreSQL dispatch evidence protects drafts, survives cancellation and rolls back atomically', { skip: !target, timeout: 45000 }, async () => {
  const { fixtureTargetSafety } = require('../scripts/fixtureTargetSafety');
  const safety = fixtureTargetSafety({ env: { ...process.env, DATABASE_URL: target } });
  assert.equal(safety.skipped, false, safety.reason);
  const { Pool } = require('pg'); const { randomUUID } = require('node:crypto');
  const pool = new Pool({ connectionString: target, max: 6, statement_timeout: 10000 });
  const patientId = randomUUID(), receiverId = randomUUID(), providerId = randomUUID(), orgId = randomUUID(), listingId = randomUUID(), directoryId = randomUUID();
  const origin = { user_id: patientId }, receiver = { user: { id: receiverId, role: 'provider' } };
  const helpers = require('../routes/referralNetwork')._test;
  try {
    for (const [id, role] of [[patientId, 'patient'], [receiverId, 'provider']]) {
      await pool.query(`INSERT INTO users(id,email,password_hash,role,first_name,last_name,is_active,is_test_account,market_scope,provider_status)
        VALUES($1,$2,'!synthetic',$3,'Synthetic','Dispatch',TRUE,TRUE,'NG','approved')`, [id, `dispatch-${id}@example.invalid`, role]);
    }
    await pool.query(`INSERT INTO ng_providers(id,user_id,full_name,email,phone,status)
      VALUES($1,$2,'Synthetic Receiver',$3,'0000000000','verified')`, [providerId, receiverId, `dispatch-${receiverId}@example.invalid`]);
    await pool.query("INSERT INTO drn_organizations(id,org_type,name,active,accepts_referrals) VALUES($1,'clinic','Synthetic Dispatch Clinic',TRUE,TRUE)", [orgId]);
    for (const [id, provider] of [[listingId, providerId], [directoryId, null]]) {
      await pool.query(`INSERT INTO drn_marketplace_listings(id,organization_id,provider_id,specialty,service_kind,title,active)
        VALUES($1,$2,$3,'cardiology','consultation','Synthetic dispatch listing',TRUE)`, [id, orgId, provider]);
    }
    await pool.query('UPDATE drn_organizations SET state=$2 WHERE id=$1', [orgId, orgId]);
    await pool.query('UPDATE drn_marketplace_listings SET featured=TRUE WHERE id=$1', [directoryId]);
    assert.equal((await service.listListings({ state: orgId, limit: 1 }, pool))[0].id, listingId);
    const listings = await service.listListings({ state: orgId }, pool);
    assert.equal(listings.find(row => row.id === listingId).dispatch_ready, true);
    assert.equal(listings.find(row => row.id === directoryId).dispatch_ready, false);
    const input = { specialty: 'cardiology', reason: 'Synthetic test only, not clinical care', destination_listing: listingId };
    const draft = await service.createReferral(input, origin, pool);
    assert.equal((await service.getReferral(draft.id, pool)).dispatched, false);
    assert.equal((await service.listReferrals({ provider_id: providerId }, pool)).some(row => row.id === draft.id), false);
    await assert.rejects(helpers.getScopedReferral(receiver, draft.id, pool), { code: 'FORBIDDEN' });
    await assert.rejects(helpers.getScopedReferralByCode(receiver, draft.ref_code, pool), { code: 'FORBIDDEN' });
    const privateCancelled = await service.createReferral(input, origin, pool);
    await service.transitionReferral(privateCancelled.id, 'cancelled', origin, {}, pool);
    await assert.rejects(helpers.getScopedReferral(receiver, privateCancelled.id, pool), { code: 'FORBIDDEN' });
    const brokenPool = { connect: async () => {
      const client = await pool.connect();
      return { release: () => client.release(), query: (sql, values) => /INSERT INTO drn_referral_events/.test(sql) ? Promise.reject(new Error('Synthetic dispatch audit failure')) : client.query(sql, values) };
    } };
    await assert.rejects(service.transitionReferral(draft.id, 'sent', origin, {}, brokenPool), /Synthetic dispatch audit failure/);
    assert.equal((await service.getReferral(draft.id, pool)).status, 'draft');
    assert.equal((await service.getReferral(draft.id, pool)).dispatched, false);
    const sends = await Promise.allSettled([service.transitionReferral(draft.id, 'sent', origin, {}, pool), service.transitionReferral(draft.id, 'sent', origin, {}, pool)]);
    assert.equal(sends.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal(sends.find(result => result.status === 'rejected').reason.code, 'INVALID_TRANSITION');
    assert.equal(Number((await pool.query("SELECT COUNT(*) FROM drn_referral_events WHERE referral_id=$1 AND event_kind='sent'", [draft.id])).rows[0].count), 1);
    assert.equal((await helpers.getScopedReferral(receiver, draft.id, pool)).dispatched, true);
    assert.equal((await service.listReferrals({ provider_id: providerId }, pool)).some(row => row.id === draft.id), true);
    await service.transitionReferral(draft.id, 'cancelled', origin, {}, pool);
    assert.equal((await helpers.getScopedReferral(receiver, draft.id, pool)).status, 'cancelled');
    const directoryDraft = await service.createReferral({ ...input, destination_listing: directoryId }, origin, pool);
    await assert.rejects(service.transitionReferral(directoryDraft.id, 'sent', origin, {}, pool), { code: 'DESTINATION_UNAVAILABLE' });
    assert.equal((await service.getReferral(directoryDraft.id, pool)).status, 'draft');
    const raceDraft = await service.createReferral(input, origin, pool);
    const blocker = await pool.connect();
    try {
      await blocker.query('BEGIN');
      await blocker.query('UPDATE drn_marketplace_listings SET active=FALSE WHERE id=$1', [listingId]);
      const pid = (await blocker.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
      const pending = assert.rejects(service.transitionReferral(raceDraft.id, 'sent', origin, {}, pool), { code: 'DESTINATION_UNAVAILABLE' });
      pending.catch(() => {});
      let waiting = false; const deadline = Date.now() + 5000;
      while (Date.now() < deadline) {
        waiting = (await pool.query("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND $1=ANY(pg_blocking_pids(pid))) AS waiting", [pid])).rows[0].waiting;
        if (waiting) break;
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      assert.equal(waiting, true, 'Send must actually wait on destination withdrawal');
      await blocker.query('COMMIT'); await pending;
      const unchanged = await service.getReferral(raceDraft.id, pool);
      assert.equal(unchanged.status, 'draft'); assert.equal(unchanged.dispatched, false);
    } finally { await blocker.query('ROLLBACK'); blocker.release(); }
  } finally {
    await pool.query('DELETE FROM drn_referrals WHERE patient_user_id=$1', [patientId]);
    await pool.query('DELETE FROM drn_marketplace_listings WHERE organization_id=$1', [orgId]);
    await pool.query('DELETE FROM drn_organizations WHERE id=$1', [orgId]);
    await pool.query('DELETE FROM users WHERE id=ANY($1::uuid[])', [[patientId, receiverId]]);
    await pool.end();
  }
});


test('sending rechecks linked patient eligibility and the current treating relationship', async () => {
  const patient = { id: '00000000-0000-4000-8000-000000000004', role: 'patient', is_active: true, market_scope: 'NG' };
  const referral = { status: 'draft', originating_provider: 'provider', patient_user_id: patient.id };
  const allowed = fixture({ patient, referral });
  assert.equal((await service.transitionReferral('ref', 'sent', actor, {}, allowed.pool)).status, 'sent');
  for (const options of [{ relationship: false }, { patient: { ...patient, is_active: false } }]) {
    const denied = fixture({ patient, referral, ...options });
    await assert.rejects(service.transitionReferral('ref', 'sent', actor, {}, denied.pool), { code: 'FORBIDDEN' });
    assert.ok(!denied.log.some(sql => /UPDATE drn_referrals/.test(sql)));
  }
});

test('actual HTTP read/event/QR endpoints keep an unsent draft private and never trust a stale admin role', { timeout: 10000 }, async () => {
  const Module = require('node:module');
  const express = require('express');
  const routeFile = require.resolve('../routes/referralNetwork');
  const savedModule = require.cache[routeFile], originalLoad = Module._load;
  const calls = [];
  let role = 'provider', sent = false;
  const pool = { async query(sql, values) {
    calls.push({ sql, values });
    if (/SELECT id, role, is_active/.test(sql)) return { rows: [{ id: actorId, role, is_active: true, market_scope: 'NG', provider_status: 'approved' }] };
    if (/SELECT id, user_id, status FROM ng_providers/.test(sql)) return { rows: [{ id: 'receiver', user_id: actorId, status: 'verified' }] };
    if (/FROM drn_referrals r WHERE r\.(id|ref_code)/.test(sql)) return { rows: [{ id: 'ref', ref_code: 'DRN-SYNTHETIC', status: sent ? 'sent' : 'draft', dispatched: sent,
      destination_provider: 'receiver', patient_user_id: 'another-patient', reason: 'Private synthetic clinical context' }] };
    if (/SELECT r\.\*,[\s\S]*o_dest.name/.test(sql)) {
      if (role === 'patient') { assert.match(sql, /patient_user_id = \$1/); assert.equal(values[0], actorId); }
      else assert.match(sql, /destination_provider = \$1 AND EXISTS/);
      return { rows: [] };
    }
    throw new Error(`Unexpected test query: ${sql}`);
  } };
  let router;
  try {
    Module._load = function (request, parent) {
      if (parent?.filename === routeFile && request === '../../server/db') return { getPool: () => pool };
      return originalLoad.apply(this, arguments);
    };
    delete require.cache[routeFile]; router = require(routeFile);
  } finally { Module._load = originalLoad; require.cache[routeFile] = savedModule; }
  const app = express(); app.use(express.json());
  app.use((req, _res, next) => { req.user = { id: actorId, role: 'admin' }; next(); });
  app.use(router);
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    for (const [path, method] of [['/referrals/ref','GET'],['/referrals/code/DRN-SYNTHETIC','GET'],['/referrals/ref/events','GET'],['/referrals/ref/qr','POST'],['/referrals/ref/transition','POST']]) {
      const response = await fetch(base + path, { method, ...(method === 'POST' ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ to_status: 'received' }) } : {}) });
      assert.equal(response.status, 403, path);
      assert.equal(response.headers.get('cache-control'), 'private, no-store');
      assert.equal((await response.text()).includes('Private synthetic clinical context'), false);
    }
    assert.equal(calls.some(({ sql }) => /INSERT|UPDATE/.test(sql)), false);
    assert.equal((await fetch(base + '/referrals')).status, 200);
    role = 'patient'; // Token still says admin. Database role controls filters.
    assert.equal((await fetch(base + '/referrals')).status, 200);
    role = 'provider'; sent = true;
    const confirmed = await fetch(base + '/referrals/ref');
    assert.equal(confirmed.status, 200);
    assert.equal((await confirmed.json()).referral.reason, 'Private synthetic clinical context');
  } finally { await new Promise(resolve => server.close(resolve)); }
});


test('sendable matches outrank higher-scoring directory listings before candidate and response limits', async () => {
  const baseline = { specialty: 'cardiology', org_state: 'FCT', acceptance_rate: 99, avg_wait_minutes: 15, completed_referrals: 100 };
  const directory = Array.from({ length: 12 }, (_, index) => ({ ...baseline, id: `directory-${index}`, dispatch_ready: false }));
  const readyLow = { ...baseline, id: 'ready-low', dispatch_ready: true, acceptance_rate: 0, avg_wait_minutes: 300, completed_referrals: 0 };
  const readyHigh = { ...readyLow, id: 'ready-high', avg_wait_minutes: 15 };
  const unknown = { ...baseline, id: 'unknown', dispatch_ready: undefined };
  const pool = { async query(sql, params) {
    assert.match(sql, /ORDER BY dispatch_ready DESC, l.featured DESC/);
    assert.ok(sql.indexOf('ORDER BY dispatch_ready DESC') < sql.indexOf('LIMIT $'));
    assert.equal(params[params.length - 1], 100);
    return { rows: [...directory, unknown, readyLow, readyHigh] };
  } };
  const request = { specialty: 'cardiology', prefer_state: 'FCT' };
  const matches = await service.matchSpecialists(request, { limit: 3 }, pool);
  assert.deepEqual(matches.map(row => row.id), ['ready-high', 'ready-low', 'directory-0']);
  assert.ok(matches[2].score > matches[0].score, 'Readiness is separate from clinical matching score');
  assert.equal((await service.matchSpecialists(request, { limit: 1 }, pool))[0].id, 'ready-high');
});
