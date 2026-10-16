'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const db=require('../db');
const records=require('../services/medicalRecordService');

test('medical document input and unsupported roles fail before storage or attachment claims',async()=>{
  const original=db.getPool;let storage=0;
  db.getPool=()=>{storage++;throw new Error('No storage expected');};
  const actor={id:crypto.randomUUID(),role:'provider'};
  const data={patientId:crypto.randomUUID(),recordType:'note',title:'Document',content:'Recorded document'};
  try {
    for (const role of ['admin','super_admin','pharmacy','government_analyst']) await assert.rejects(records.read({...actor,role},crypto.randomUUID()),{statusCode:403});
    await assert.rejects(records.create(actor,{...data,accessRestricted:false}),{code:'MEDICAL_RECORD_RELEASE_REASON_REQUIRED'});
    await assert.rejects(records.create(actor,{...data,fileName:'attachment.pdf'}),{code:'MEDICAL_ATTACHMENT_NOT_ACTIVATED'});
    await assert.rejects(records.list(actor,data.patientId,{limit:101}),{statusCode:400});
    await assert.rejects(records.update(actor,crypto.randomUUID(),{content:'Overwrite without version'}),{statusCode:400});
    await assert.rejects(records.withdraw(actor,crypto.randomUUID(),{}),{statusCode:400});
    assert.equal(storage,0);
  } finally {db.getPool=original;}
});

const target=process.env.SIMULATION_DATABASE_URL;
test('medical documents enforce actual HTTP care and market scope, explicit release, retained revisions, stale-write conflicts and atomic audit rollback',{skip:!target},async()=>{
  const url=new URL(target);
  assert.ok(['localhost','127.0.0.1'].includes(url.hostname)&&url.pathname.endsWith('_test'));
  const {Pool}=require('pg');const pool=new Pool({connectionString:target});const client=await pool.connect();
  const oldQuery=db.query,oldPool=db.getPool;
  const oldSecret=process.env.JWT_ACCESS_SECRET;const oldEncryption=process.env.ENCRYPTION_KEY;
  process.env.JWT_ACCESS_SECRET='doctarx-medical-record-rollback-http-secret-32';
  process.env.ENCRYPTION_KEY||='0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  let serial=0,failAudit=false,server;
  const ids=Object.fromEntries(['patient','otherPatient','provider','otherProvider','admin','pharmacy','appointment','otherAppointment'].map(key=>[key,crypto.randomUUID()]));
  const isolated={query:(sql,parameters)=>client.query(sql,parameters),async connect(){
    const point='medical_record_'+(++serial);
    return {async query(sql,parameters){
      if(sql==='BEGIN')return client.query('SAVEPOINT '+point);
      if(sql==='COMMIT')return client.query('RELEASE SAVEPOINT '+point);
      if(sql==='ROLLBACK'){await client.query('ROLLBACK TO SAVEPOINT '+point);return client.query('RELEASE SAVEPOINT '+point);}
      if(failAudit&&sql.includes('INSERT INTO audit_logs'))throw new Error('Isolated document audit outage');
      return client.query(sql,parameters);
    },release(){}};
  }};
  const session=(key,role)=>({id:ids[key],role});
  const provider=session('provider','provider'),patient=session('patient','patient');
  try {
    await client.query('BEGIN');db.query=isolated.query;db.getPool=()=>isolated;
    for(const [key,role]of[['patient','patient'],['otherPatient','patient'],['provider','provider'],['otherProvider','provider'],['admin','admin'],['pharmacy','pharmacy']])await client.query(`INSERT INTO users
      (id,email,password_hash,role,first_name,last_name,market_scope,region,country,is_active,is_test_account,provider_status,must_change_password)
      VALUES($1,$2,'ISOLATED_CONTROL_NO_PASSWORD_LOGIN',$3,'Isolated','Document control','US','US','US',TRUE,TRUE,'approved',FALSE)`,[ids[key],'medical-'+ids[key]+'@example.invalid',role]);
    await client.query("INSERT INTO appointments(id,patient_id,provider_id,scheduled_at,status) VALUES($1,$2,$3,NOW()+INTERVAL '1 day','confirmed'),($4,$5,$3,NOW()+INTERVAL '2 days','confirmed')",[ids.appointment,ids.patient,ids.provider,ids.otherAppointment,ids.otherPatient]);
    const input={patientId:ids.patient,appointmentId:ids.appointment,recordType:'note',title:'Recorded care document',content:'Private original document'};
    const count=async()=>(await client.query('SELECT count(*)::int AS count FROM medical_records WHERE created_by=$1',[ids.provider])).rows[0].count;
    await assert.rejects(records.create(session('otherProvider','provider'),input),{statusCode:403});
    await assert.rejects(records.create(provider,{...input,appointmentId:ids.otherAppointment}),{statusCode:403});
    await assert.rejects(records.create(provider,{...input,patientId:ids.otherPatient}),{statusCode:403});
    failAudit=true;await assert.rejects(records.create(provider,input),/Isolated document audit outage/);failAudit=false;assert.equal(await count(),0);
    const created=await records.create(provider,input);
    assert.equal(created.accessRestricted,true);assert.equal(created.recordVersion,1);
    assert.equal((await records.read(provider,created.id)).content,input.content);
    await assert.rejects(records.read(patient,created.id),{statusCode:404});
    assert.equal((await records.list(patient,ids.patient)).records.length,0);
    assert.equal((await records.exportRecords(patient,ids.patient)).recordCount,0);
    const released=await records.update(provider,created.id,{expectedVersion:1,accessRestricted:false,reason:'Reviewed and released to the patient'});
    assert.equal(released.recordVersion,2);
    assert.equal((await records.read(patient,created.id)).content,input.content);
    assert.equal((await records.list(patient,ids.patient)).pagination.total,1);
    assert.equal((await records.exportRecords(patient,ids.patient)).records[0].content,input.content);
    for(const actor of [session('otherPatient','patient'),session('otherProvider','provider'),session('admin','admin'),session('pharmacy','pharmacy')])await assert.rejects(records.read(actor,created.id),{statusCode:403});
    await client.query('UPDATE medical_records SET appointment_id=$2 WHERE id=$1',[created.id,ids.otherAppointment]);
    await assert.rejects(records.read(patient,created.id),{statusCode:403});
    assert.equal((await records.list(patient,ids.patient)).pagination.total,0);
    assert.equal((await records.exportRecords(patient,ids.patient)).recordCount,0);
    await assert.rejects(records.update(provider,created.id,{expectedVersion:2,title:'Foreign consultation',reason:'Must not persist'}),{statusCode:403});
    await client.query('UPDATE medical_records SET appointment_id=$2 WHERE id=$1',[created.id,ids.appointment]);
    await client.query("INSERT INTO appointments(patient_id,provider_id,scheduled_at,status) VALUES($1,$2,NOW()+INTERVAL '4 days','confirmed')",[ids.patient,ids.otherProvider]);
    assert.equal((await records.read(session('otherProvider','provider'),created.id)).content,input.content);
    await assert.rejects(records.update(session('otherProvider','provider'),created.id,{expectedVersion:2,title:'Another author',reason:'Must not overwrite'}),{statusCode:403});
    for(const patch of ["market_scope='NG'",'is_active=FALSE',"role='admin'","provider_status='pending'"]) {
      await client.query('UPDATE users SET '+patch+' WHERE id=$1',[ids.provider]);
      await assert.rejects(records.read(provider,created.id),{statusCode:403});
      await assert.rejects(records.update(provider,created.id,{expectedVersion:2,title:'Must not persist',reason:'Denied revision'}),{statusCode:403});
      await client.query("UPDATE users SET market_scope='US',is_active=TRUE,role='provider',provider_status='approved' WHERE id=$1",[ids.provider]);
    }
    await client.query("UPDATE users SET market_scope='NG' WHERE id=ANY($1::uuid[])",[[ids.patient,ids.provider]]);
    await assert.rejects(records.read(provider,created.id),{statusCode:403}); // No verified NG clinician profile.
    await client.query("UPDATE users SET market_scope='US' WHERE id=ANY($1::uuid[])",[[ids.patient,ids.provider]]);
    await client.query('UPDATE users SET is_active=FALSE WHERE id=$1',[ids.patient]);
    await assert.rejects(records.read(patient,created.id),{statusCode:403});
    await assert.rejects(records.read(provider,created.id),{statusCode:403});
    await client.query('UPDATE users SET is_active=TRUE WHERE id=$1',[ids.patient]);
    const before=(await client.query('SELECT record_version,title,content_encrypted FROM medical_records WHERE id=$1',[created.id])).rows[0];
    failAudit=true;
    await assert.rejects(records.read(patient,created.id),/Isolated document audit outage/);
    await assert.rejects(records.update(provider,created.id,{expectedVersion:2,content:'Must roll back',reason:'Audit failure check'}),/Isolated document audit outage/);
    await assert.rejects(records.withdraw(provider,created.id,{expectedVersion:2,reason:'Audit failure check'}),/Isolated document audit outage/);
    failAudit=false;
    assert.deepEqual((await client.query('SELECT record_version,title,content_encrypted FROM medical_records WHERE id=$1',[created.id])).rows[0],before);
    const revised=await records.update(provider,created.id,{expectedVersion:2,content:'Reviewed corrected document',reason:'Correction after clinical review'});
    assert.equal(revised.recordVersion,3);
    await assert.rejects(records.update(provider,created.id,{expectedVersion:2,content:'Stale overwrite',reason:'Must not win'}),{statusCode:409});
    const history=await records.history(provider,created.id);
    assert.deepEqual(history.map(row=>row.version),[1,2,3]);
    assert.equal(history[0].record.content,input.content);assert.equal(history[2].record.content,'Reviewed corrected document');
    await assert.rejects(records.history(patient,created.id),{statusCode:403});
    const auditRows=(await client.query("SELECT new_values FROM audit_logs WHERE resource_type='medical_record' AND resource_id=$1",[created.id])).rows;
    assert.ok(auditRows.length>=4);assert.ok(!JSON.stringify(auditRows).includes(input.content));assert.ok(!JSON.stringify(auditRows).includes('Correction after clinical review'));
    await client.query('SAVEPOINT immutable_revision_check');
    await assert.rejects(client.query('UPDATE medical_record_revisions SET snapshot_json=$2::jsonb WHERE record_id=$1',[created.id,'{}']),/append-only/);
    await client.query('ROLLBACK TO SAVEPOINT immutable_revision_check');await client.query('RELEASE SAVEPOINT immutable_revision_check');
    const express=require('express'),jwt=require('jsonwebtoken');const app=express();app.use(express.json());app.use('/api/medical-records',require('../routes/medicalRecords'));
    server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
    const request=async(key,path,method='GET',body)=>{
      const response=await fetch('http://127.0.0.1:'+server.address().port+'/api/medical-records'+path,{method,headers:{'Content-Type':'application/json',...(key?{Authorization:'Bearer '+jwt.sign({userId:ids[key],role:'admin'},process.env.JWT_ACCESS_SECRET,{expiresIn:600})}:{})},...(body?{body:JSON.stringify(body)}:{})});
      return {status:response.status,body:await response.json(),cache:response.headers.get('cache-control')};
    };
    assert.equal((await request(null,'/'+created.id)).status,401);
    assert.equal((await request('admin','/'+created.id)).status,403);
    assert.equal((await request('pharmacy','/'+created.id)).status,403);
    const actual=await request('patient','/'+created.id);
    assert.equal(actual.status,200);assert.equal(actual.body.record.content,'Reviewed corrected document');assert.equal(actual.cache,'private, no-store');
    const protectedRow=(await client.query('SELECT content_encrypted FROM medical_records WHERE id=$1',[created.id])).rows[0];
    await client.query("UPDATE medical_records SET content_encrypted='corrupted ciphertext' WHERE id=$1",[created.id]);
    await assert.rejects(records.read(patient,created.id),{code:'MEDICAL_RECORD_DECRYPTION_UNAVAILABLE'});
    await assert.rejects(records.exportRecords(patient,ids.patient),{code:'MEDICAL_RECORD_DECRYPTION_UNAVAILABLE'});
    const corrupted=await request('patient','/'+created.id);assert.equal(corrupted.status,503);assert.equal(corrupted.body.record,undefined);
    await client.query('UPDATE medical_records SET content_encrypted=$2 WHERE id=$1',[created.id,protectedRow.content_encrypted]);
    assert.equal((await request('provider','/'+created.id,'PUT',{content:'Missing revision'})).status,400);
    assert.equal((await request('patient','/'+created.id,'DELETE',{expectedVersion:3,reason:'No authority'})).status,403);
    failAudit=true;const outage=await request('patient','/'+created.id);failAudit=false;
    assert.equal(outage.status,503);assert.ok(!JSON.stringify(outage.body).includes('Reviewed corrected'));assert.ok(!JSON.stringify(outage.body).includes('audit outage'));
    const withdrawn=await request('provider','/'+created.id,'DELETE',{expectedVersion:3,reason:'Duplicate document withdrawn after review'});
    assert.equal(withdrawn.status,200);assert.equal(withdrawn.body.record.isVoided,true);assert.equal(withdrawn.body.record.recordVersion,4);
    assert.equal((await request('patient','/'+created.id)).status,404);
    assert.equal((await records.list(patient,ids.patient)).records.length,0);
    assert.equal((await records.exportRecords(patient,ids.patient)).recordCount,0);
    assert.equal((await records.history(provider,created.id)).length,4);
  } finally {
    if(server)await new Promise(resolve=>server.close(resolve));
    db.query=oldQuery;db.getPool=oldPool;
    await client.query('ROLLBACK');
    assert.equal((await client.query('SELECT count(*)::int AS count FROM users WHERE id=ANY($1::uuid[])',[Object.values(ids)])).rows[0].count,0);
    client.release();await pool.end();
    if(oldSecret===undefined)delete process.env.JWT_ACCESS_SECRET;else process.env.JWT_ACCESS_SECRET=oldSecret;
    if(oldEncryption===undefined)delete process.env.ENCRYPTION_KEY;else process.env.ENCRYPTION_KEY=oldEncryption;
  }
});
