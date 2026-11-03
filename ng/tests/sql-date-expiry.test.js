'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { sqlDateEndUtc } = require('../services/shared/sqlDate');
const { createMedicationDeliveryWorkflowService } = require('../services/logistics/medicationDeliveryWorkflowService');

test('SQL DATE cutoff preserves valid civil dates and rejects missing, impossible or timestamp inputs', () => {
  for (const [date, end] of [['2026-11-03','2026-11-04'],['2024-02-29','2024-03-01'],['2000-02-29','2000-03-01'],['2026-12-31','2027-01-01'],['0099-12-31','0100-01-01']]) {
    assert.equal(sqlDateEndUtc(date), Date.parse(`${end}T00:00:00.000Z`));
  }
  for (const value of [null, undefined, 0, '', 'infinity', '0000-01-01', '2026-02-29', '1900-02-29', '2026-04-31', '2026-13-01', '2026-00-01', '2026-01-00', '2026-01-32', '2026-1-01', '2026-11-03T00:00:00Z', new Date('2026-11-03')]) {
    assert.equal(Number.isNaN(sqlDateEndUtc(value)), true, String(value));
  }
});

for (const tz of ['UTC', 'Africa/Lagos', 'America/New_York']) test(`civil-date authorization remains identical across DST and calendar boundaries in ${tz}`, () => {
  const result = spawnSync(process.execPath, ['-e', `
    const assert = require('node:assert/strict');
    const pg = require('pg'); const parser = pg.types.getTypeParser(1082);
    const { sqlDateEndUtc } = require(${JSON.stringify(require.resolve('../services/shared/sqlDate'))});
    const { isClinicalPharmacyActive } = require(${JSON.stringify(require.resolve('../services/pharmacy/clinicalPharmacyAuthorization'))});
    const pharmacy = { status:'approved',account_status:'active',verified_at:'2026-01-01',pcn_license_number:'ISOLATED',superintendent_pcn_number:'ISOLATED' };
    for (const date of ['2024-02-29','2026-03-07','2026-03-08','2026-03-09','2026-10-31','2026-11-01','2026-11-02','2026-11-03','2026-12-31']) {
      const end = Date.parse(date+'T00:00:00Z')+86400000;
      assert.equal(sqlDateEndUtc(date),end);
      assert.equal(isClinicalPharmacyActive({...pharmacy,pcn_license_expiry:date},end-1),true);
      assert.equal(isClinicalPharmacyActive({...pharmacy,pcn_license_expiry:date},end),false);
      const raw = parser(date); assert.ok(raw instanceof Date);
      assert.equal(Number.isNaN(sqlDateEndUtc(raw)),true,'Ambiguous parsed Date must not be guessed');
    }
    if(process.env.TZ==='Africa/Lagos')assert.equal(parser('2026-11-03').toISOString(),'2026-11-02T23:00:00.000Z');
    assert.equal(pg.types.getTypeParser(1082),parser,'No global parser override');
  `], { env: { ...process.env, TZ: tz }, encoding: 'utf8' });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});

const ids = Object.fromEntries(['patient','pharmacy','rx','order','owner'].map((key,i)=>[key,`00000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`]));
function rejectedExpiryFixture(expiresAt) {
  const calls=[];
  const actor={id:ids.patient,role:'patient',is_active:true,market_scope:'NG',account_status:'active'};
  const client={release(){},async query(sql){
    calls.push(sql);
    if(['BEGIN','COMMIT','ROLLBACK'].includes(sql)||sql.startsWith('SELECT pg_advisory_xact_lock'))return{rows:[]};
    if(sql.includes('FROM users'))return{rows:[actor]};
    if(sql.includes('FROM ng_pharmacies'))return{rows:[{id:ids.pharmacy,owner_user_id:ids.owner,status:'approved',account_status:'active',verified_at:'2026-01-01',pcn_license_expiry:'2099-01-01',pcn_license_number:'ISOLATED',superintendent_pcn_number:'ISOLATED'}]};
    if(sql.includes('FROM ng_pharmacy_commercial_profiles')||sql.includes('FROM ng_medication_operations')||sql.includes('WHERE create_key='))return{rows:[]};
    if(sql.includes('FROM ng_orders'))return{rows:[{id:ids.order,patient_user_id:ids.patient,pharmacy_id:ids.pharmacy,status:'pending'}]};
    if(sql.includes('FROM ng_medication_fulfillments'))return{rows:[{order_id:ids.order,digital_prescription_id:ids.rx,version:1,pharmacy_confirmed_at:'2026-01-01'}]};
    if(sql.includes('FROM ng_digital_prescriptions'))return{rows:[{id:ids.rx,patient_user_id:ids.patient,routed_pharmacy_id:ids.pharmacy,signed_at:'2026-01-01',lifecycle_status:'sent_to_pharmacy',expires_at:expiresAt}]};
    throw new Error(`Expiry must fail before this query: ${sql}`);
  }};
  const service=createMedicationDeliveryWorkflowService({pool:{connect:async()=>client},env:{NODE_ENV:'test'},now:()=>Date.parse('2026-11-03T12:00:00Z')});
  return{calls,actor,service};
}

test('both digital Rx creation and subsequent approval fail closed on NULL, invalid, ambiguous and expired DATE values without writes',async()=>{
  for(const expiry of [null,undefined,'infinity','2026-02-29','2026-11-02',new Date('2099-01-01')])for(const operation of ['createOrder','approve']){
    const f=rejectedExpiryFixture(expiry);
    await assert.rejects(operation==='createOrder'
      ?f.service.createOrder({pharmacyId:ids.pharmacy,digitalPrescriptionId:ids.rx,idempotencyKey:'isolated-date-test'},f.actor)
      :f.service.approve(ids.order,f.actor,{version:1,idempotencyKey:'isolated-date-test',stage:'medicines',consent:true}),error=>error.status===409&&/current signed prescription/.test(error.message));
    assert.equal(f.calls.some(sql=>/^(INSERT|UPDATE|DELETE)/.test(sql)),false);
    assert.equal(f.calls.at(-1),'ROLLBACK');
  }
});
