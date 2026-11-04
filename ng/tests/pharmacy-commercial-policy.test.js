'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { validateProfile, pricingSnapshot, authorizeOrder, APPROVALS } = require('../services/pharmacy/commercialProfileService');
const { buildPricing, stageAmounts, ledgerAllocations } = require('../services/logistics/deliveryPricing');

const approved = () => ({ code:'approved-test-pharmacy',displayName:'Isolated commercial policy',status:'active',fees:{currency:'NGN',orderServiceMinor:100000,deliverySupportMinor:50000},approvals:Object.fromEntries(APPROVALS.map(key=>[key,`isolated-evidence:${key}`])),settings:{mode:'pharmacist_portal',quoteValiditySeconds:1800,inventoryMaxAgeSeconds:3600} });
const record = () => {const p=approved();return {...p,id:'00000000-0000-4000-8000-000000000031',version:1,display_name:p.displayName};};
const snapshot = () => pricingSnapshot(record());
const quote={currency:'NGN',feeMinor:250000,expiresAt:'2099-01-01T00:00:00Z'};

test('a draft can record proposal pricing, but no missing agreement or unvalidated transport can activate',()=>{
  const draft=approved();draft.status='draft';draft.approvals={};draft.settings={};
  assert.equal(validateProfile(draft).status,'draft');
  for(const key of APPROVALS){const p=approved();delete p.approvals[key];assert.throws(()=>validateProfile(p),/approval before activation/);}
  for(const mode of ['approved_api','restricted_file'])assert.throws(()=>validateProfile({...approved(),settings:{...approved().settings,mode}}),/adapter must be validated/);
  for(const flag of ['insuranceEnabled','savingsEnabled','membershipEnabled'])assert.throws(()=>validateProfile({...approved(),settings:{...approved().settings,[flag]:true}}),/separate validated activation/);
  assert.throws(()=>pricingSnapshot({...record(),status:'draft'}),/awaiting authorized activation/);
});
test('fees reject currency confusion, fractional kobo and invalid quote or stock validity',()=>{
  for(const fees of [{currency:'USD'},{orderServiceMinor:100000.5},{deliverySupportMinor:-1}])assert.throws(()=>validateProfile({...approved(),fees}),{status:422});
  for(const value of [0,59,86401,1.5])assert.throws(()=>validateProfile({...approved(),settings:{...approved().settings,quoteValiditySeconds:value}}),{status:422});
});
test('partner pickup and delivery match the agreed itemization without changing general pricing',()=>{
  const pickup=buildPricing({medicinesMinor:2000000,deliveryType:'pickup',commercialSnapshot:snapshot()});
  assert.equal(pickup.patientTotalMinor,2100000);assert.equal(pickup.managementMinor,0);assert.equal(pickup.courierMinor,0);
  const delivery=buildPricing({medicinesMinor:2000000,deliveryType:'delivery',quote,commercialSnapshot:snapshot()});
  assert.equal(delivery.patientTotalMinor,2400000);assert.equal(delivery.managementMinor,50000);assert.equal(delivery.coordinationMinor,100000);
  assert.equal(stageAmounts(delivery,'medicines').patientMinor,2100000);assert.equal(stageAmounts(delivery,'delivery').patientMinor,300000);
  const general=buildPricing({medicinesMinor:900000,deliveryType:'delivery',quote:{...quote,feeMinor:280000}});
  assert.equal(general.patientTotalMinor,1255000);assert.equal(general.managementMinor,75000);assert.equal(general.coordinationMinor,0);
});
test('a commercial profile cannot silently add general coordination fees or claim unactivated insurance',()=>{
  const input={medicinesMinor:2000000,deliveryType:'pickup',commercialSnapshot:snapshot()};
  assert.throws(()=>buildPricing({...input,coordination:{authorized:true,billable:true,payer:'patient',authorizationReference:'isolated'}}),/second coordination charge/);
  assert.throws(()=>buildPricing({...input,coverage:{verified:true,authorizationReference:'isolated',allocations:{medicinesMinor:1}}}),/self-paying orders only/);
});
test('the accepted partner order-service fee remains a liability until fulfillment and balances exactly',()=>{
  const price=buildPricing({medicinesMinor:2000000,deliveryType:'delivery',quote,commercialSnapshot:snapshot()});
  const before=ledgerAllocations(price,{patientCollectedMinor:2400000,processingCostMinor:1000});
  assert.equal(before.coordinationRevenueMinor,0);assert.equal(before.coordinationUnearnedMinor,100000);assert.equal(before.managementUnearnedMinor,50000);assert.equal(before.pharmacyPayableMinor,2000000);assert.equal(before.courierPayableMinor,250000);assert.equal(before.balanced,true);
  const after=ledgerAllocations(price,{patientCollectedMinor:2400000,deliveryCompleted:true});
  assert.equal(after.coordinationRevenueMinor,100000);assert.equal(after.managementRevenueMinor,50000);assert.equal(after.coordinationUnearnedMinor,0);assert.equal(after.balanced,true);
});
test('existing commercial orders retain agreed fees while suspension and changed branch assignment block new charges',async()=>{
  const frozen=snapshot();
  const client={async query(){return{rows:[{...record(),version:2,fees:{...approved().fees,orderServiceMinor:200000}}]};}};
  await authorizeOrder(client,'isolated-pharmacy',frozen);assert.equal(frozen.orderServiceMinor,100000);
  await assert.rejects(authorizeOrder({async query(){return{rows:[{...record(),status:'suspended'}]};}},'isolated',frozen),{status:409});
  await assert.rejects(authorizeOrder({async query(){return{rows:[]};}},'isolated',frozen),{status:409});
});
