'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const service = require('../services/referral-network/referralNetworkService');
const actorId = '00000000-0000-4000-8000-000000000001';
function fixture({ role = 'provider', active = true, market = 'NG', mapped = true, providerStatus = 'verified', referral = {}, failAudit = false, listing = null, patient = null, identity = {} } = {}) {
  const log = []; let saved;
  const client = { release() {}, async query(sql, values) {
    log.push(sql);
    if (/SELECT p.user_id FROM drn_marketplace/.test(sql)) return { rows: [] };
    if (/SELECT id, role, is_active/.test(sql)) return { rows: [{ id: actorId, role, is_active: active, market_scope: market, provider_status: 'approved', ...identity }, ...(patient ? [patient] : [])] };
    if (/SELECT id, user_id, status FROM ng_providers/.test(sql)) return { rows: mapped ? [{ id: 'provider', user_id: actorId, status: providerStatus }] : [] };
    if (/SELECT id, user_id, status FROM drn_agents/.test(sql)) return { rows: [{ id: 'agent', user_id: actorId, status: 'active' }] };
    if (/FROM provider_patient_relationships/.test(sql)) return { rows: patient ? [{id:'care'}] : [] };
    if (/SELECT l\.\*/.test(sql)) return { rows: listing ? [listing] : [] };
    if (/SELECT \* FROM drn_referrals/.test(sql)) return { rows: [{ id: 'ref', status: 'received', destination_provider: 'provider', patient_user_id: actorId, originating_agent: 'agent', ...referral }] };
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
    const results = await Promise.allSettled([service.transitionReferral(row.id, 'sent', realActor, {}, pool), service.transitionReferral(row.id, 'sent', realActor, {}, pool)]);
    assert.equal(results.filter(value => value.status === 'fulfilled').length, 1);
    assert.equal(results.find(value => value.status === 'rejected').reason.code, 'INVALID_TRANSITION');
    const failingPool = { connect: async () => {
      const client = await pool.connect();
      return { release: () => client.release(), query: (sql, values) => /INSERT INTO drn_referral_events/.test(sql) ? Promise.reject(new Error('Synthetic audit outage')) : client.query(sql, values) };
    } };
    await assert.rejects(service.createReferral(input, realActor, failingPool), /Synthetic audit outage/);
    assert.equal(Number((await pool.query('SELECT count(*) FROM drn_referrals WHERE patient_user_id=$1', [userId])).rows[0].count), 1);
    const blocker = await pool.connect();
    try {
      await blocker.query('BEGIN'); await blocker.query('UPDATE users SET is_active=FALSE WHERE id=$1', [userId]);
      const pid = (await blocker.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
      const pending = assert.rejects(service.transitionReferral(row.id, 'cancelled', realActor, {}, pool), { code: 'FORBIDDEN' });
      pending.catch(() => {});
      let waiting = false; const deadline = Date.now() + 5000;
      while (Date.now() < deadline) {
        waiting = (await pool.query("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND $1=ANY(pg_blocking_pids(pid))) AS waiting", [pid])).rows[0].waiting;
        if (waiting) break;
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      assert.equal(waiting, true, 'Transition must actually wait on account revocation');
      await blocker.query('COMMIT'); await pending;
      assert.equal((await pool.query('SELECT status FROM drn_referrals WHERE id=$1', [row.id])).rows[0].status, 'sent');
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
 const referral={status:'received',patient_user_id:actorId,destination_provider:'receiver'};
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
