'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const service = require('../services/pharmacy/pharmacistRxService');
const ids = Object.fromEntries(['user', 'pharmacy', 'rx', 'item', 'other'].map((name, i) => [name, `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`]));
const actor = { id: ids.user, role: 'pharmacy' };
const denied = status => error => error.status === status;
function fixture() {
  const state = { user: { ...actor, is_active: true, account_status: 'active', market_scope: 'NG' },
    p: { id: ids.pharmacy, owner_user_id: ids.user, status: 'approved', account_status: 'active', verified_at: '2026-01-01', pcn_license_expiry: '2099-01-01', pcn_license_number: 'TEST-PCN', superintendent_pcn_number: 'TEST-SUPERVISOR' },
    rx: { id: ids.rx, routed_pharmacy_id: ids.pharmacy, preferred_pharmacy_id: ids.other, signed_at: '2026-01-01', lifecycle_status: 'sent_to_pharmacy', expires_at: '2099-01-01' },
    items: [{ id: ids.item, prescription_id: ids.rx, quantity: 2, status: 'available', drug_name: 'Private medicine' }], calls: [], events: [], audits: [], auditFails: false };
  let before;
  const client = { release() {}, async query(sql, params = []) {
    state.calls.push({ sql, params });
    if (sql === 'BEGIN') { before = structuredClone({ rx: state.rx, items: state.items, events: state.events, audits: state.audits }); return { rows: [] }; }
    if (sql === 'ROLLBACK') { Object.assign(state, before); return { rows: [] }; }
    if (sql === 'COMMIT') return { rows: [] };
    if (sql.includes('FROM users WHERE id=')) { assert.match(sql, /account_status='active' AND market_scope='NG' FOR SHARE/); const u=state.user; return { rows: u.id===params[0] && u.is_active && u.role==='pharmacy' && u.account_status==='active' && u.market_scope==='NG' ? [u] : [] }; }
    if (sql.includes('FROM ng_pharmacies p')) {
      assert.match(sql, /FOR SHARE OF p/); assert.doesNotMatch(sql, /p\.\*|bank_|phone|email/);
      const matches = sql.includes('JOIN ng_digital_prescriptions') ? params[0]===state.rx.id && state.rx.routed_pharmacy_id===state.p.id && state.p.owner_user_id===params[1] : state.p.owner_user_id===params[0] && (!params[1] || params[1]===state.p.id);
      return { rows: matches ? [state.p] : [] };
    }
    if (sql.startsWith('SELECT id,expires_at FROM ng_digital_prescriptions')) {
      assert.match(sql, /routed_pharmacy_id=\$2 AND signed_at IS NOT NULL/); assert.match(sql, /FOR (UPDATE|SHARE)/);
      return { rows: state.rx.id===params[0] && state.rx.routed_pharmacy_id===params[1] && state.rx.signed_at && ['sent_to_pharmacy','received','partially_dispensed','fully_dispensed','completed'].includes(state.rx.lifecycle_status) ? [{ id: state.rx.id, expires_at: state.rx.expires_at }] : [] };
    }
    if (sql.startsWith('SELECT rx.*')) {
      assert.match(sql, /rx.routed_pharmacy_id=\$1 AND rx.signed_at IS NOT NULL/); assert.match(sql, /FOR SHARE OF rx/); assert.doesNotMatch(sql, /preferred_pharmacy_id/);
      return { rows: state.rx.routed_pharmacy_id===params[0] && state.rx.signed_at && ['sent_to_pharmacy','received','partially_dispensed','fully_dispensed','completed'].includes(state.rx.lifecycle_status) && (!params[1] || state.rx.lifecycle_status===params[1]) ? [structuredClone(state.rx)] : [] };
    }
    if (sql.startsWith('SELECT * FROM ng_digital_prescriptions')) return { rows: [structuredClone(state.rx)] };
    if (sql.startsWith('SELECT * FROM ng_rx_items')) return { rows: structuredClone(state.items) };
    if (sql.includes('COUNT(*)::int AS total')) return { rows: [{ total: state.items.length, dispensed: state.items.filter(i=>i.status==='dispensed').length, finalized: state.items.filter(i=>['dispensed','cancelled','unavailable'].includes(i.status)).length }] };
    if (sql.includes('UPDATE ng_digital_prescriptions')) { const explicit = sql.match(/lifecycle_status = '(\w+)'/); state.rx.lifecycle_status=explicit ? explicit[1] : params[1]; return { rows: [structuredClone(state.rx)] }; }
    if (sql.includes('UPDATE ng_rx_items')) { const item = state.items.find(row=>row.id===params[0]); item.status=sql.includes("status = 'dispensed'") ? 'dispensed' : 'unavailable'; return { rows: [{ id: item.id }] }; }
    if (sql.includes('INSERT INTO ng_rx_events')) { state.events.push({ sql, params }); return { rows: [] }; }
    if (sql.includes('SELECT * FROM ng_rx_events')) return { rows: structuredClone(state.events) };
    if (sql.includes('INSERT INTO ng_compliance_audit_log')) { if (state.auditFails) throw new Error('Private clinical database failure'); state.audits.push(params); return { rows: [] }; }
    throw new Error(`Unexpected pharmacist Rx query: ${sql}`);
  } };
  return { state, client, pool: { connect: async () => client } };
}

test('every pharmacist operation checks current account and workspace before PHI or mutation', async () => {
  const ops = [f=>service.list(f.pool,actor), f=>service.read(f.pool,actor,ids.rx), f=>service.read(f.pool,actor,ids.rx,true), ...['receive','dispense','unavailable','complete'].map(action=>f=>service.mutate(f.pool,actor,ids.rx,action,{},ids.item))];
  for (const patch of [{ account_status:'suspended' },{ market_scope:'US' },{ is_active:false },{ role:'admin' }]) for (const op of ops) {
    const f=fixture(); Object.assign(f.state.user,patch); await assert.rejects(op(f),denied(403)); assert.equal(f.state.calls.some(({sql})=>/FROM ng_pharmacies|FROM ng_digital_prescriptions|FROM ng_rx_items|INSERT|UPDATE ng_/.test(sql)),false);
  }
  for (const patch of [{ account_status:'suspended' },{ verified_at:null },{ pcn_license_expiry:'2000-01-01' }]) for (const op of ops) {
    const f=fixture(); Object.assign(f.state.p,patch); await assert.rejects(op(f),denied(403)); assert.equal(f.state.calls.some(({sql})=>sql.startsWith('SELECT * FROM ng_digital_prescriptions') || sql.startsWith('UPDATE')),false);
  }
  for (const op of ops) {
    const f=fixture(); f.state.p.owner_user_id=ids.other;
    await assert.rejects(op(f),error=>[403,404].includes(error.status));
    assert.equal(f.state.calls.some(({sql})=>sql.startsWith('SELECT * FROM ng_digital_prescriptions') || sql.startsWith('UPDATE')),false);
  }
});

test('unsigned and merely preferred prescriptions never enter pharmacist lists, detail or history', async () => {
  for (const patch of [{ signed_at:null,lifecycle_status:'drafted' },{ routed_pharmacy_id:ids.other,preferred_pharmacy_id:ids.pharmacy }]) {
    const f=fixture(); Object.assign(f.state.rx,patch); assert.deepEqual(await service.list(f.pool,actor),[]);
    await assert.rejects(service.read(f.pool,actor,ids.rx),denied(404)); await assert.rejects(service.read(f.pool,actor,ids.rx,true),denied(404));
    assert.equal(f.state.calls.some(({sql})=>sql.startsWith('SELECT * FROM ng_digital_prescriptions')),false);
  }
  const f=fixture(); assert.equal((await service.list(f.pool,actor,{ status:'drafted' })).length,0);
  const result=await service.read(f.pool,actor,ids.rx); assert.equal(result.items[0].id,ids.item); assert.equal(f.state.calls.at(-1).sql,'COMMIT');
});

test('public input cannot choose internal reconciliation or another pharmacy and rejects invalid identifiers', async () => {
  for (const body of [{ fulfillment_order_id:ids.other },{ system:true },{ pharmacy_id:ids.other },{ trusted:true },{ quantity:0 },{ quantity:1.5 },{ notes:'x'.repeat(4001) }]) {
    const f=fixture(); await assert.rejects(service.mutate(f.pool,actor,ids.rx,'dispense',body,ids.item),denied(400)); assert.equal(f.state.calls.length,0);
  }
  for (const query of [{ limit:'501' },{ limit:'-1' },{ pharmacy_id:'bad' },{ patient_user_id:ids.other },{ since:'not-a-date' }]) { const f=fixture(); await assert.rejects(service.list(f.pool,actor,query),denied(400)); }
});

test('new dispensing requires current prescription expiry while historical completion remains available', async () => {
  for (const expires_at of [null,'2000-01-01','bad-date']) {
    const f=fixture(); f.state.rx.lifecycle_status='received'; f.state.rx.expires_at=expires_at;
    await assert.rejects(service.mutate(f.pool,actor,ids.rx,'dispense',{},ids.item),denied(409)); assert.equal(f.state.events.length,0);
  }
  const f=fixture(); f.state.rx.lifecycle_status='fully_dispensed'; f.state.rx.expires_at='2000-01-01';
  assert.equal((await service.mutate(f.pool,actor,ids.rx,'complete')).lifecycle_status,'completed');
});

test('actual workflow mutations and clinician-entered notes use the same client and roll back with audit failure', async () => {
  const f=fixture(); await service.mutate(f.pool,actor,ids.rx,'receive');
  assert.equal(f.state.rx.lifecycle_status,'received'); const events=f.state.events.length;
  f.state.auditFails=true;
  await assert.rejects(service.mutate(f.pool,actor,ids.rx,'dispense',{ quantity:2,notes:'Private witnessed dispense note' },ids.item),/Private clinical database/);
  assert.equal(f.state.items[0].status,'available'); assert.equal(f.state.rx.lifecycle_status,'received'); assert.equal(f.state.events.length,events);
  f.state.auditFails=false;
  const result=await service.mutate(f.pool,actor,ids.rx,'dispense',{ quantity:2,substitute_drug_id:null,substitute_reason:null,notes:'Private witnessed dispense note' },ids.item);
  assert.equal(result.lifecycle_status,'fully_dispensed'); assert.equal(f.state.events.filter(row=>row.sql.includes('dispense_note_recorded')).length,1);
  assert.doesNotMatch(JSON.stringify(f.state.audits),/Private witnessed dispense note/);
  assert.equal(f.state.calls.at(-1).sql,'COMMIT');
});

test('a reserved medicine cannot be dispensed through the external pharmacist API',async()=>{
  const f=fixture(); f.state.rx.lifecycle_status='received'; f.state.items[0].fulfillment_order_id=ids.other;
  await assert.rejects(service.mutate(f.pool,actor,ids.rx,'dispense',{ quantity:2 },ids.item),error=>error.code==='INVALID_STATE');
  assert.equal(f.state.items[0].status,'available'); assert.equal(f.state.events.length,0);
});

test('read audit failures deny the response and unexpected errors never disclose SQL or clinical values',async()=>{
  for(const op of [f=>service.list(f.pool,actor),f=>service.read(f.pool,actor,ids.rx),f=>service.read(f.pool,actor,ids.rx,true)]){const f=fixture();f.state.auditFails=true;await assert.rejects(op(f),/Private clinical database/);assert.equal(f.state.calls.at(-1).sql,'ROLLBACK');}
  const r={};service.sendError({status(status){r.status=status;return this;},json(body){r.body=body;}},new Error('Private clinical database failure'));assert.equal(r.status,503);assert.doesNotMatch(JSON.stringify(r.body),/database failure/);
});

module.exports={fixture,ids,actor};

test('all seven external pharmacist lifecycle endpoints use the gateway and cannot select trusted reconciliation',async()=>{
  const express=require('express');const db=require('../../server/db');const prior=db.getPool;let active=fixture();db.getPool=()=>active.pool;
  const routePath=require.resolve('../routes/prescriptions');delete require.cache[routePath];
  const app=express();app.use(express.json());app.use((req,_res,next)=>{req.user=actor;next();});app.use('/rx',require(routePath));
  const server=await new Promise(resolve=>{const instance=app.listen(0,'127.0.0.1',()=>resolve(instance));});
  const endpoints=[['GET','/',null,'sent_to_pharmacy'],['GET',`/${ids.rx}`,null,'sent_to_pharmacy'],['GET',`/${ids.rx}/events`,null,'sent_to_pharmacy'],['POST',`/${ids.rx}/receive`,{},'sent_to_pharmacy'],['POST',`/${ids.rx}/complete`,{},'fully_dispensed'],['POST',`/${ids.rx}/items/${ids.item}/dispense`,{quantity:2,notes:null},'received'],['POST',`/${ids.rx}/items/${ids.item}/unavailable`,{notes:'Isolated unavailable'},'sent_to_pharmacy']];
  const http=async(method,path,body)=>{const res=await fetch(`http://127.0.0.1:${server.address().port}/rx${path}`,{method,headers:{'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});return{status:res.status,body:await res.json(),cache:res.headers.get('cache-control')};};
  try{
    for(const [method,path,body,state] of endpoints){active=fixture();active.state.rx.lifecycle_status=state;const ok=await http(method,path,body);assert.equal(ok.status,200,JSON.stringify(ok.body));assert.equal(ok.cache,'private, no-store');active=fixture();active.state.user.account_status='suspended';assert.equal((await http(method,path,body)).status,403,path);}
    for(const suffix of ['sign','send','cancel','refill']){active=fixture();assert.equal((await http('POST',`/${ids.rx}/${suffix}`,{})).status,403);assert.equal(active.state.calls.length,0);}
    active=fixture();active.state.rx.lifecycle_status='received';assert.equal((await http('POST',`/${ids.rx}/items/${ids.item}/dispense`,{quantity:2,fulfillment_order_id:ids.other,system:true})).status,400);assert.equal(active.state.calls.length,0);
    active=fixture();active.state.auditFails=true;const failure=await http('GET',`/${ids.rx}`);assert.equal(failure.status,503);assert.doesNotMatch(JSON.stringify(failure.body),/Private clinical database/);
  }finally{await new Promise(resolve=>server.close(resolve));db.getPool=prior;delete require.cache[routePath];}
});
