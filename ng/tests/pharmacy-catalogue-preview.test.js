'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { validateEnvelope, validateRows, previewCatalogue, MAX_BYTES } = require('../services/pharmacy/cataloguePreviewService');
const ids = { actor:'00000000-0000-4000-8000-000000000001', pharmacy:'00000000-0000-4000-8000-000000000002', profile:'00000000-0000-4000-8000-000000000003', drug:'00000000-0000-4000-8000-000000000004' };
const NOW = Date.parse('2026-11-02T12:00:00Z');
const drug = { id:ids.drug,name:'Synthetic Medicine',dosage_form:'tablet',strength:'10 mg',pack_size:'10 tablets',manufacturer:'Synthetic Manufacturer',is_active:true,nafdac_approved:true };
const item = () => ({ partnerItemId:'synthetic-sku-1',drugId:ids.drug,identity:{name:drug.name,dosageForm:drug.dosage_form,strength:drug.strength,packSize:drug.pack_size,manufacturer:drug.manufacturer},quantityUnit:'catalogue_pack',quantityAvailable:12,unitPriceMinor:12345,currency:'NGN',batchNumber:'synthetic-batch',expiryDate:'2027-01-01',observedAt:'2026-11-02T11:59:00Z' });
const envelope = () => ({ schemaVersion:1,profileId:ids.profile,partnerBranchReference:'synthetic-branch',generatedAt:'2026-11-02T11:59:30Z',items:[item()] });
const validate = (input=envelope(),catalogue=[drug],age=3600) => validateRows(validateEnvelope(input),catalogue,age,NOW);
test('exact identity and catalogue-pack integer kobo contract validates without live or persistence claims', () => {
  const result=validate(); assert.equal(result.valid,true); assert.equal(result.accepted,1);
  for(const key of ['persisted','liveConnection','availabilityVerified','activationAuthorized'])assert.equal(result[key],false);
  assert.equal(result.priceUnit,'kobo_per_catalogue_pack'); assert.deepEqual(result.rows,[{index:0,valid:true,reasons:[]}]);
  assert.equal(JSON.stringify(result).includes('Synthetic Medicine'),false,'Preview does not disclose stored catalogue details');
});
test('envelope bounds and unknown fields reject before catalogue queries', () => {
  for(const change of [{schemaVersion:2},{items:[]},{items:Array.from({length:501},item)},{profileId:'invalid'},{generatedAt:'yesterday'},{endpoint:'https://partner.invalid'},{patientId:ids.actor}])assert.throws(()=>validateEnvelope({...envelope(),...change}),{code:'CATALOGUE_PREVIEW_INVALID'});
  assert.throws(()=>validateEnvelope({...envelope(),extra:'x'.repeat(MAX_BYTES)}),{statusCode:413});
  const cyclic={};cyclic.items=cyclic;assert.throws(()=>validateEnvelope(cyclic),{statusCode:400});
});
test('numeric, unit, currency, shape and hidden patient/credential fields fail rows without echo', () => {
  for(const change of [{quantityAvailable:-1},{quantityAvailable:0.5},{quantityAvailable:'1'},{quantityAvailable:2147483648},{unitPriceMinor:-1},{unitPriceMinor:1.5},{unitPriceMinor:1e12},{unitPriceMinor:'100'},{currency:'USD'},{quantityUnit:'tablet'},{drugId:'name-only'},{patientId:ids.actor},{apiKey:'never-accepted'},{batchNumber:'\ninvalid'}]){
    const e=envelope(); e.items=[{...item(),...change}]; const result=validate(e); assert.equal(result.valid,false);assert.deepEqual(result.rows[0].reasons,['INVALID_ROW_SHAPE']);
  }
});
test('missing, inactive, unapproved, ambiguous or mismatched medication identity is never inferred', () => {
  for(const catalogue of [[],[{...drug,is_active:false}],[{...drug,nafdac_approved:false}]])assert.deepEqual(validate(envelope(),catalogue).rows[0].reasons,['CATALOGUE_MAPPING_UNAVAILABLE']);
  for(const field of ['name','dosageForm','strength','packSize','manufacturer']){
    const e=envelope();e.items[0].identity[field]='different';assert.ok(validate(e).rows[0].reasons.includes('CATALOGUE_IDENTITY_MISMATCH'));
  }
  assert.ok(validate(envelope(),[{...drug,strength:null}]).rows[0].reasons.includes('CATALOGUE_IDENTITY_MISMATCH'));
  const e=envelope();e.items[0].identity.name=' synthetic medicine ';assert.equal(validate(e).valid,true);
});
test('duplicate partner IDs or duplicate canonical product/batch reject every conflicting row', () => {
  const e=envelope(); e.items=[item(),{...item(),partnerItemId:'other'}];
  assert.ok(validate(e).rows.every(row=>row.reasons.includes('DUPLICATE_PRODUCT_OR_BATCH')));
  e.items=[item(),{...item(),batchNumber:'different'}];assert.ok(validate(e).rows.every(row=>row.reasons.includes('DUPLICATE_PRODUCT_OR_BATCH')));
});
test('zero stock and zero price remain explicit values, never defaults or verified availability',()=>{
  const e=envelope();e.items[0].quantityAvailable=0;e.items[0].unitPriceMinor=0;assert.equal(validate(e).valid,true);
  delete e.items[0].unitPriceMinor;assert.equal(validate(e).valid,false);
});
test('expired and impossible batch dates fail while precision is not silently normalized',()=>{
  for(const expiryDate of ['2026-11-02','2026-11-01','2027-02-30','invalid']){
    const e=envelope();e.items[0].expiryDate=expiryDate;assert.equal(validate(e).valid,false);
  }
});
test('feed and stock freshness use configured window; future and after-generation stock are rejected',()=>{
  for(const generatedAt of ['2026-11-02T10:00:00Z','2026-11-02T12:00:01Z'])assert.throws(()=>validate({...envelope(),generatedAt}),{code:'CATALOGUE_FEED_STALE'});
  for(const observedAt of ['2026-11-02T10:00:00Z','2026-11-02T12:00:01Z','2026-11-02T11:59:31Z']){
    const e=envelope();e.items[0].observedAt=observedAt;assert.ok(validate(e).rows[0].reasons.includes('STOCK_TIMESTAMP_STALE_OR_INVALID'));
  }
  for(const age of [undefined,0,59,86401,'3600'])assert.throws(()=>validateRows(envelope(),[drug],age,NOW),{code:'CATALOGUE_FRESHNESS_NOT_CONFIGURED'});
});
test('service binds real account role/ownership, profile and branch before reading any product',async()=>{
  const calls=[];const e=envelope();e.generatedAt=new Date(Date.now()-500).toISOString();e.items[0].observedAt=new Date(Date.now()-1000).toISOString();e.items[0].expiryDate='2099-01-01';
  const pool={async query(sql,args){calls.push({sql,args});if(sql.includes('FROM users actor'))return{rows:[{id:ids.profile,version:7,settings:{inventoryMaxAgeSeconds:3600}}]};return{rows:[drug]};}};
  const result=await previewCatalogue(pool,{id:ids.actor,role:'untrusted-client-role'},ids.pharmacy,e);
  assert.equal(result.valid,true);assert.equal(result.profileVersion,7);assert.equal(calls.length,2);
  assert.match(calls[0].sql,/actor\.is_active=TRUE/);assert.match(calls[0].sql,/pharmacy\.owner_user_id=actor\.id/);assert.match(calls[0].sql,/branch\.partner_branch_reference=\$4/);
  assert.deepEqual(calls[0].args,[ids.actor,ids.pharmacy,ids.profile,e.partnerBranchReference]);assert.deepEqual(calls[1].args,[[ids.drug]]);
  assert.ok(calls.every(call=>/^\s*SELECT/.test(call.sql)),'Preview may not write, import or activate');
});
test('denied scope does not query product IDs or reveal which partner or pharmacy exists',async()=>{
  const calls=[];const pool={async query(sql){calls.push(sql);return{rows:[]};}};
  await assert.rejects(previewCatalogue(pool,{id:ids.actor},ids.pharmacy,envelope()),{statusCode:403,code:'CATALOGUE_SCOPE_DENIED'});assert.equal(calls.length,1);
  await assert.rejects(previewCatalogue(pool,{},ids.pharmacy,envelope()),{statusCode:403});assert.equal(calls.length,1);
});
