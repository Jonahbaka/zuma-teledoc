'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const db = require('../db');
const service = require('../services/telehealthConsentService');
const patientId = crypto.randomUUID(), clinicianId = crypto.randomUUID(), consentId = crypto.randomUUID();

test('consent revocation requires current patient/care/market authority and commits audit atomically', async () => {
  const original = db.transaction; let state; let calls; let failAudit; let care;
  const patient = { id:patientId, role:'patient', marketScope:'US' };
  const provider = { id:clinicianId, role:'provider', marketScope:'US' };
  const reset = () => { state={id:consentId,patient_id:patientId,is_valid:true}; calls=[]; failAudit=false; care=true; };
  db.transaction = async work => {
    const snapshot={...state};
    try { return await work({ async query(sql,params) {
      calls.push(sql);
      if(sql.includes('FROM users actor')) {
        assert.ok(sql.includes('FOR SHARE OF actor,patient'));
        const matches=params[0]===patientId && params[3]==='US' && (params[2]==='patient'&&params[1]===patientId || params[2]==='provider'&&params[1]===clinicianId);
        return {rows:matches?[{id:params[1],role:params[2]}]:[]};
      }
      if(sql.includes('FROM provider_patient_relationships')||sql.includes('FROM appointments')) {assert.ok(sql.includes('FOR SHARE'));return{rows:care?[{id:'care'}]:[]};}
      if(sql.includes('UPDATE telehealth_consents')) { if(params[1]!==consentId||params[2]!==patientId||!state.is_valid)return{rows:[]};state.is_valid=false;return{rows:[state]}; }
      if(sql.includes('INSERT INTO audit_logs')) {assert.ok(!sql.includes('revoked_reason'));if(failAudit)throw new Error('Synthetic audit unavailable');return{rows:[]};}
      throw new Error('Unexpected synthetic query');
    } }); } catch(error) {state=snapshot;throw error;}
  };
  try {
    for(const actor of [{id:crypto.randomUUID(),role:'pharmacy',marketScope:'US'},{...patient,id:crypto.randomUUID()},{...provider,marketScope:'NG'}]) {
      reset();await assert.rejects(service.revokeConsent(consentId,patientId,'Patient request',actor),{statusCode:403});assert.equal(state.is_valid,true);assert.ok(!calls.some(sql=>sql.includes('UPDATE telehealth_consents')));
    }
    reset();care=false;await assert.rejects(service.revokeConsent(consentId,patientId,'Patient request',provider),{statusCode:403});assert.equal(state.is_valid,true);
    for(const actor of [patient,provider]) {reset();const result=await service.revokeConsent(consentId,patientId,'Patient request',actor);assert.equal(result.isValid,false);assert.equal(state.is_valid,false);assert.equal(calls.filter(sql=>sql.includes('INSERT INTO audit_logs')).length,1);}
    reset();failAudit=true;await assert.rejects(service.revokeConsent(consentId,patientId,'Patient request',patient),/Synthetic audit unavailable/);assert.equal(state.is_valid,true);
    reset();await assert.rejects(service.revokeConsent('invalid',patientId,'Patient request',patient),{statusCode:400});assert.equal(calls.length,0);
  } finally {db.transaction=original;}
});

test('consent check/history/revoke routes all apply current clinical patient scope',()=>{
  const fs=require('node:fs');const source=fs.readFileSync(require.resolve('../routes/clinicalEncounters'),'utf8');
  for(const route of ["router.get('/consent/check'","router.get('/patient/:patientId/consents'","router.post('/consent/:id/revoke'"]){
    const body=source.slice(source.indexOf(route),source.indexOf('async (req, res)',source.indexOf(route)));
    assert.ok(body.includes('authenticate')&&body.includes('canAccessPatient'),route);
  }
});

const target=process.env.SIMULATION_DATABASE_URL;
test('PostgreSQL consent capture/revocation requires current care and rolls back failed audit', {skip:!target},async()=>{
  const url=new URL(target);assert.ok(['localhost','127.0.0.1'].includes(url.hostname)&&url.pathname.endsWith('_test'));
  const {Pool}=require('pg');const pool=new Pool({connectionString:target});const client=await pool.connect();const oldTransaction=db.transaction;
  let n=0,failAudit=false;
  try {
    await client.query('BEGIN');
    const p=crypto.randomUUID(),provider=crypto.randomUUID(),other=crypto.randomUUID(),pharmacy=crypto.randomUUID(),template=crypto.randomUUID();
    for(const [id,role] of [[p,'patient'],[provider,'provider'],[other,'provider'],[pharmacy,'pharmacy']])await client.query(`INSERT INTO users(id,email,password_hash,role,first_name,last_name,market_scope,region,country,is_active,is_test_account,provider_status,must_change_password)
      VALUES($1,$2,'!isolated-no-login',$3,'Synthetic','Consent','US','US','US',TRUE,TRUE,'approved',FALSE)`,[id,`consent-${id}@example.invalid`,role]);
    await client.query("INSERT INTO appointments(patient_id,provider_id,scheduled_at,status) VALUES($1,$2,NOW()+INTERVAL '1 day','confirmed')",[p,provider]);
    await client.query("INSERT INTO telehealth_consent_templates(id,version,title,content_plain,effective_date,applicable_states) VALUES($1,'synthetic-1','Synthetic consent','Synthetic testing only',CURRENT_DATE,ARRAY['CA'])",[template]);
    db.transaction=async work=>{const savepoint=`consent_${++n}`;await client.query('SAVEPOINT '+savepoint);try{
      const result=await work({query:async(sql,params)=>{if(failAudit&&sql.includes('INSERT INTO audit_logs'))throw new Error('Synthetic audit unavailable');return client.query(sql,params);}});
      await client.query('RELEASE SAVEPOINT '+savepoint);return result;
    }catch(error){await client.query('ROLLBACK TO SAVEPOINT '+savepoint);await client.query('RELEASE SAVEPOINT '+savepoint);throw error;}};
    const actor=id=>({id,role:id===p?'patient':id===pharmacy?'pharmacy':'provider',marketScope:'US'});
    const input={templateId:template,templateVersion:'synthetic-1',patientState:'CA',consentMethod:'verbal'};
    for(const id of [other,pharmacy])await assert.rejects(service.captureConsent(p,input,{user:actor(id)}),{statusCode:403});
    const consent=await service.captureConsent(p,input,{user:actor(p)});assert.equal(consent.isValid,true);
    for(const id of [other,pharmacy])await assert.rejects(service.revokeConsent(consent.id,p,'Synthetic patient request',actor(id)),{statusCode:403});
    failAudit=true;await assert.rejects(service.revokeConsent(consent.id,p,'Synthetic patient request',actor(provider)),/Synthetic audit unavailable/);failAudit=false;
    assert.equal((await client.query('SELECT is_valid FROM telehealth_consents WHERE id=$1',[consent.id])).rows[0].is_valid,true);
    assert.equal((await service.revokeConsent(consent.id,p,'Synthetic patient request',actor(provider))).isValid,false);
    const own=await service.captureConsent(p,input,{user:actor(p)});assert.equal((await service.revokeConsent(own.id,p,'Synthetic patient request',actor(p))).isValid,false);
    assert.equal((await client.query("SELECT count(*)::int AS n FROM audit_logs WHERE patient_id=$1 AND resource_type='telehealth_consent'",[p])).rows[0].n,4);
  } finally {db.transaction=oldTransaction;await client.query('ROLLBACK');client.release();await pool.end();}
});
