'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createMedicationDeliveryWorkflowService } = require('../services/logistics/medicationDeliveryWorkflowService');
const ids = Object.fromEntries(['order','patient','pharmacy','rx','item','drug','quote','owner'].map((key,i)=>[key,`00000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`]));
function fixture(stage, conflict, existing = false) {
  const actor={id:ids.patient,role:'patient',is_active:true,market_scope:'NG',account_status:'active',email:'isolated@example.invalid'};
  const state={calls:[],external:0,hold:conflict==='hold',items:[{id:ids.item,drug_id:ids.drug,quantity:conflict==='quantity'?2:1,dispensed_quantity:0,status:'available',fulfillment_order_id:ids.order}]};
  if(conflict==='duplicate')state.items.push({...state.items[0],id:'separate-signed-item'});
  const order={id:ids.order,patient_user_id:ids.patient,pharmacy_id:ids.pharmacy,status:'ready_for_pickup',delivery_type:stage==='delivery'?'delivery':'pickup',items:[{drug_id:ids.drug,quantity:conflict==='duplicate'?2:1}]};
  const f={order_id:ids.order,digital_prescription_id:ids.rx,version:1,pharmacy_confirmed_at:'2026-01-01',pharmacy_ready_at:'2026-01-01',current_quote_id:ids.quote,medicines_approval:{patientMinor:100,insurerMinor:0},delivery_approval:{patientMinor:100,insurerMinor:0,quoteId:ids.quote},coverage:{},coordination:{}};
  const attempt={id:'old-attempt',provider_reference:'existing-synthetic-reference',stage,status:'pending',authorization_url:'https://checkout.paystack.com/isolated-existing'};
  const client={release(){},async query(sql,params=[]){
    state.calls.push({sql,params});
    if(['BEGIN','COMMIT','ROLLBACK'].includes(sql))return{rows:[]};
    if(sql.includes('FROM ng_orders'))return{rows:[order]};
    if(sql.includes('FROM ng_medication_fulfillments'))return{rows:[f]};
    if(sql.includes('FROM ng_pharmacies'))return{rows:[{id:ids.pharmacy,owner_user_id:ids.owner,status:'approved',account_status:'active',verified_at:'2026-01-01',pcn_license_expiry:'2099-01-01',pcn_license_number:'ISOLATED-PCN',superintendent_pcn_number:'ISOLATED-SUPER'}]};
    if(sql.includes('FROM users'))return{rows:[actor]};
    if(sql.includes('FROM ng_medication_operations'))return{rows:[]};
    if(sql.includes('FROM ng_medication_quotes'))return{rows:[{id:ids.quote,expires_at:'2099-01-01T00:00:00Z'}]};
    if(sql.includes('FROM ng_medication_payment_attempts'))return{rows:sql.includes('SUM(')?[{amount:stage==='delivery'&&params[1]==='medicines'?'100':'0'}]:existing&&sql.includes('approval_digest=$3')?[attempt]:[]};
    if(sql.includes('FROM ng_digital_prescriptions')){assert.match(sql,/FOR UPDATE/);return{rows:[{id:ids.rx,patient_user_id:ids.patient,routed_pharmacy_id:ids.pharmacy,lifecycle_status:'sent_to_pharmacy',signed_at:'2026-01-01',expires_at:'2099-01-01'}]};}
    if(sql.includes('FROM ng_rx_items')){assert.match(sql,/FOR SHARE/);return{rows:state.items};}
    if(sql.startsWith('SELECT EXISTS(SELECT 1 FROM ng_medication_events'))return{rows:[{required:state.hold}]};
    throw new Error(`Unexpected query; no approval, attempt or financial writes allowed: ${sql}`);
  }};
  const pool={connect:async()=>client};
  const forbidden=()=>{state.external++;throw new Error('No new provider or finance operation allowed');};
  const service=createMedicationDeliveryWorkflowService({pool,env:{NODE_ENV:'test',NG_MEDICATION_CHECKOUT_ENABLED:'true',PAYSTACK_SECRET_KEY:'sk_test_isolated'},provider:{getAvailability:()=>({available:false})},gateway:{initializeTransaction:forbidden},finance:{postCoverage:forbidden}});
  return{state,service,actor,input:{stage,version:1,idempotencyKey:'isolated-quantity-payment',consent:true,quoteId:ids.quote},attempt};
}

test('new medicine and delivery approvals and payment attempts reject changed quantities, duplicate sources and unresolved holds before writes',async()=>{
  for(const stage of ['medicines','delivery'])for(const conflict of ['quantity','duplicate','hold'])for(const method of ['approve','initiatePayment']){
    const f=fixture(stage,conflict);await assert.rejects(f.service[method](ids.order,f.actor,f.input),error=>error.status===409&&/prescription items changed/.test(error.message));
    assert.equal(f.state.calls.some(({sql})=>/^(INSERT|UPDATE)/.test(sql)),false,`${method}:${stage}:${conflict}`);
    assert.equal(f.state.external,0);assert.equal(f.state.calls.at(-1).sql,'ROLLBACK');
  }
});

test('an already issued collectible reference resumes unchanged without new Rx authorization or provider initialization',async()=>{
  for(const stage of ['medicines','delivery'])for(const conflict of ['quantity','duplicate','hold']){
    const f=fixture(stage,conflict,true);const result=await f.service.initiatePayment(ids.order,f.actor,f.input);
    assert.equal(result.reference,f.attempt.provider_reference);assert.equal(result.authorizationUrl,f.attempt.authorization_url);
    assert.equal(f.state.calls.some(({sql})=>sql.includes('FROM ng_digital_prescriptions')),false);
    assert.equal(f.state.calls.some(({sql})=>/^(INSERT|UPDATE)/.test(sql)),false);assert.equal(f.state.external,0);assert.equal(f.state.calls.at(-1).sql,'COMMIT');
  }
});
