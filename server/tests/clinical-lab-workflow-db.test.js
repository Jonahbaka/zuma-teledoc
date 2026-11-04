'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const labs = require('../services/clinicalLabService');
const target = process.env.SIMULATION_DATABASE_URL;
const denied = status => error => error.statusCode === status;

test('PostgreSQL manual lab lifecycle preserves ownership, specimen history, critical handoff and audit atomicity', { skip: !target }, async t => {
  const url = new URL(target); assert.ok(['127.0.0.1','localhost'].includes(url.hostname) && url.pathname.endsWith('_test'));
  const { Pool } = require('pg'); const pool = new Pool({ connectionString: target });
  const [provider, patient, other, encounter] = Array.from({ length: 4 }, () => crypto.randomUUID());
  const actor = { id: provider, role: 'provider' };
  const oldKey = process.env.ENCRYPTION_KEY; process.env.ENCRYPTION_KEY = 'c'.repeat(64);
  let order;
  const request = () => crypto.randomUUID();
  try {
    for (const id of [provider, patient, other]) await pool.query(`INSERT INTO users(id,email,password_hash,role,first_name,last_name,market_scope,is_active,is_test_account,provider_status,account_status)
      VALUES($1,$2,'!fictional-no-login',$3,'Fictional','Lab','US',TRUE,TRUE,'approved','active')`, [id,id+'@example.invalid',id === patient ? 'patient' : 'provider']);
    await pool.query(`INSERT INTO clinical_encounters(id,patient_id,provider_id,encounter_type,encounter_start_time,status)
      VALUES($1,$2,$3,'in_person',NOW(),'in_progress')`, [encounter,patient,provider]);
    const input = { requestKey: request(), testCode: 'FICTIONAL-ONLY', testName: 'Fictional test', reason: 'Synthetic lab scenario' };
    await t.test('order retries are one durable intent and conflicting content cannot replace it', async () => {
      const results = await Promise.all([labs.create(pool,actor,encounter,input),labs.create(pool,actor,encounter,input)]);
      order = results[0]; assert.equal(order.id, results[1].id); assert.equal(order.transmission,'not_transmitted');
      await assert.rejects(labs.create(pool,actor,encounter,{...input,testName:'Conflicting test'}), denied(409));
      await assert.rejects(labs.create(pool,{id:other,role:'provider'},encounter,{...input,requestKey:request()}), denied(403));
      await assert.rejects(labs.list(pool,{id:patient,role:'patient'},encounter), denied(403));
    });
    await t.test('real accounts and revoked current provider authority cannot enter the fictional workflow', async () => {
      await pool.query('UPDATE users SET is_test_account=FALSE WHERE id=$1',[patient]);
      await assert.rejects(labs.list(pool,actor,encounter), denied(403));
      await pool.query('UPDATE users SET is_test_account=TRUE WHERE id=$1',[patient]);
      await pool.query("UPDATE users SET provider_status='suspended' WHERE id=$1",[provider]);
      await assert.rejects(labs.list(pool,actor,encounter), denied(403));
      await pool.query("UPDATE users SET provider_status='approved' WHERE id=$1",[provider]);
    });
    const apply = async content => { order = await labs.append(pool,actor,encounter,order.id,{requestKey:request(),expectedRevision:order.revision,...content}); return order; };
    const result = { kind:'result', sourceLaboratory:'Fictional laboratory', sourceReportId:'FICT-1', value:'Synthetic result', unit:'fictional units', referenceRange:'Source-supplied synthetic range', critical:true, reviewedSourceReport:true };
    await t.test('results need specimen collection and explicit critical ownership', async () => {
      await assert.rejects(apply(result), denied(409));
      await assert.rejects(apply({kind:'collect',specimenReference:'FICT-A',collectedAt:new Date(Date.now()+60000).toISOString(),notes:'Fictional collection'}), denied(400));
      await apply({kind:'collect',specimenReference:'FICT-A',collectedAt:new Date().toISOString(),notes:'Fictional collection'});
      await apply({kind:'reject',reason:'Fictional damaged specimen'});
      await assert.rejects(apply(result), denied(409));
      await apply({kind:'collect',specimenReference:'FICT-B',collectedAt:new Date().toISOString(),notes:'Fictional recollection'});
      await assert.rejects(apply(result), denied(400));
      await apply({...result, criticalDueAt:new Date(Date.now()+600000).toISOString(),handoffPlan:'Ordering clinician to contact fictional patient and document action'});
      assert.equal(order.requiresAcknowledgment,true);
      await assert.rejects(apply({...result,kind:'amend',critical:false,correctionReason:'Cannot clear an unacknowledged critical handoff'}), denied(409));
      await assert.rejects(apply({kind:'cancel',reason:'Cannot cancel a recorded result'}), denied(409));
    });
    await t.test('acknowledgment is distinct from result entry and amendments reset the current receipt', async () => {
      const firstResult = order.resultRevision;
      await assert.rejects(apply({kind:'acknowledge',resultRevision:firstResult-1,actionTaken:'Fictional review',contactOutcome:'Fictional contact'}), denied(409));
      await apply({kind:'acknowledge',resultRevision:firstResult,actionTaken:'Fictional clinician action recorded',contactOutcome:'Fictional patient contacted'});
      assert.equal(order.requiresAcknowledgment,false);
      await apply({...result,kind:'amend',correctionReason:'Corrected source report',sourceReportId:'FICT-2',criticalDueAt:new Date(Date.now()+600000).toISOString(),handoffPlan:'Recontact fictional patient with corrected report'});
      assert.equal(order.requiresAcknowledgment,true);
      await assert.rejects(apply({kind:'acknowledge',resultRevision:firstResult,actionTaken:'Old report',contactOutcome:'Old contact'}), denied(409));
    });
    await t.test('duplicate event receipt survives a lost response while stale concurrent edits conflict', async () => {
      const event = {requestKey:request(),expectedRevision:order.revision,kind:'acknowledge',resultRevision:order.resultRevision,actionTaken:'Fictional corrected review',contactOutcome:'Fictional corrected contact'};
      const receipts = await Promise.all([labs.append(pool,actor,encounter,order.id,event),labs.append(pool,actor,encounter,order.id,event)]);
      order=receipts[0]; assert.equal(order.revision,receipts[1].revision);
      await assert.rejects(labs.append(pool,actor,encounter,order.id,{...event,requestKey:request()}), denied(409));
    });
    await t.test('content is encrypted, identity-bound, append-only and successful reads require audit', async () => {
      const rows = await labs.list(pool,actor,encounter);
      assert.equal(rows.length,1); assert.equal(rows[0].events.length,order.revision);
      assert.equal(rows[0].events.filter(event=>event.kind==='result').length,1);
      const storage = (await pool.query('SELECT protected_order FROM clinical_lab_orders WHERE id=$1',[order.id])).rows[0];
      assert.ok(!JSON.stringify(storage).includes('Synthetic lab scenario'));
      const failAudit = {async connect(){ const client=await pool.connect(); return { release:()=>client.release(),query(sql,values){if(sql.includes('INSERT INTO audit_logs'))throw new Error('Synthetic audit outage');return client.query(sql,values);} }; }};
      await assert.rejects(labs.list(failAudit,actor,encounter), /audit outage/);
      await assert.rejects(labs.create(failAudit,actor,encounter,{...input,requestKey:request()}), /audit outage/);
      assert.equal((await pool.query('SELECT count(*)::int n FROM clinical_lab_orders WHERE encounter_id=$1',[encounter])).rows[0].n,1);
      const corrupt = {...storage.protected_order,tag:'0'.repeat(32)};
      await pool.query('UPDATE clinical_lab_orders SET protected_order=$2 WHERE id=$1',[order.id,corrupt]);
      await assert.rejects(labs.list(pool,actor,encounter), denied(503));
      await pool.query('UPDATE clinical_lab_orders SET protected_order=$2 WHERE id=$1',[order.id,storage.protected_order]);
    });
  } finally {
    await pool.query('DELETE FROM clinical_lab_events WHERE order_id IN (SELECT id FROM clinical_lab_orders WHERE encounter_id=$1)',[encounter]);
    await pool.query('DELETE FROM clinical_lab_orders WHERE encounter_id=$1',[encounter]);
    await pool.query('DELETE FROM audit_logs WHERE user_id=ANY($1::uuid[])',[[provider,patient,other]]);
    await pool.query('DELETE FROM clinical_encounters WHERE id=$1',[encounter]);
    await pool.query('DELETE FROM users WHERE id=ANY($1::uuid[])',[[provider,patient,other]]);
    await pool.end(); if(oldKey===undefined)delete process.env.ENCRYPTION_KEY;else process.env.ENCRYPTION_KEY=oldKey;
  }
});
