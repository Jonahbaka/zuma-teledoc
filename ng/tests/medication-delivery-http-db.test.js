'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const express = require('express');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');
const { createBrowserFixture } = require('./helpers/medication-delivery-fixture');

const target = process.env.SIMULATION_DATABASE_URL;
test('real medication HTTP routes enforce current JWT account roles, pharmacy scope and verified benefit authority', { skip: !target }, async t => {
  const url = new URL(target);
  assert.ok(['127.0.0.1', 'localhost'].includes(url.hostname) && url.pathname.endsWith('_test'));
  const previous = Object.fromEntries(['NODE_ENV', 'DATABASE_URL', 'ENCRYPTION_KEY', 'JWT_ACCESS_SECRET'].map(name => [name, process.env[name]]));
  const secret = crypto.randomBytes(48).toString('hex');
  Object.assign(process.env, { NODE_ENV: 'test', DATABASE_URL: target, ENCRYPTION_KEY: 'c'.repeat(64), JWT_ACCESS_SECRET: secret });
  const pool = new Pool({ connectionString: target, max: 6 });
  const db = require('../../server/db'); const oldPool = db.getPool; const oldQuery = db.query;
  db.getPool = () => pool; db.query = (sql, params) => pool.query(sql, params);
  const workflowPath = require.resolve('../services/logistics/medicationDeliveryWorkflowService');
  const originalWorkflow = require(workflowPath); let active;
  const delegate = { ...originalWorkflow };
  for (const [name, value] of Object.entries(originalWorkflow)) if (name !== 'createMedicationDeliveryWorkflowService' && typeof value === 'function') delegate[name] = (...args) => active.service[name](...args);
  require.cache[workflowPath].exports = delegate;
  let server;
  try {
    const { authenticate } = require('../../server/middleware/auth');
    const app = express(); app.use(express.json({ limit: '100kb' }));
    app.use('/api/ng/patient', authenticate, require('../routes/patient'));
    app.use('/api/ng/pharmacy', authenticate, require('../routes/pharmacy'));
    app.use('/api/ng/prescriptions', authenticate, require('../routes/prescriptions'));
    app.use('/api/ng/admin/medication-delivery', authenticate, require('../routes/medicationDeliveryAdmin'));
    app.use('/api/ng/admin/pharmacy-integrations', authenticate, require('../routes/pharmacyIntegrationsAdmin'));
    app.use('/api/ng/medication-fhir', authenticate, require('../routes/medicationFhir'));
    server = await new Promise(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
    const origin = `http://127.0.0.1:${server.address().port}`;
    const token = (actor, extra = {}) => jwt.sign({ userId: actor.id, role: actor.role, ...extra }, secret, { algorithm: 'HS256', expiresIn: '15m' });
    async function http(path, { actor, bearer = actor ? token(actor) : null, method = 'GET', body } = {}) {
      const response = await fetch(origin + path, { method, headers: { ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
      return { status: response.status, body: await response.json(), headers: response.headers };
    }
    async function fixture() { active = await createBrowserFixture({ pool }); return active; }
    const patientBase = orderId => `/api/ng/patient/orders/${orderId}`;
    const pharmacyBase = (f, orderId) => `/api/ng/pharmacy/${f.pharmacyId}/orders/${orderId}`;
    async function mutate(base, actor, action, body = {}) {
      const checkout = await http(`${base}/checkout`, { actor }); assert.equal(checkout.status, 200, JSON.stringify(checkout.body));
      return http(`${base}/${action}`, { actor, method: 'POST', body: { version: checkout.body.version, idempotencyKey: crypto.randomUUID(), ...body } });
    }
    async function make(f) {
      const created = await http('/api/ng/patient/orders', { actor: f.patient, method: 'POST', body: { ...f.input, patientUserId: f.otherPatient.id } });
      assert.equal(created.status, 201, JSON.stringify(created.body)); return created.body.order.id;
    }
    async function confirmPrice(f, orderId) {
      const response = await mutate(pharmacyBase(f, orderId), f.pharmacist, 'price', { items: [{ drugId: f.drugId, unitPriceMinor: f.unitPriceMinor }], pharmacistRegistrationNumber: f.registration, attest: true, packageCategory: 'sealed_ambient_medication' });
      assert.equal(response.status, 200, JSON.stringify(response.body)); return response.body;
    }
    async function partner(f, status = 'live') {
      const programmeId = crypto.randomUUID(); const partnerId = crypto.randomUUID();
      await pool.query('INSERT INTO public_health_programmes(id,name,created_by) VALUES($1,$2,$3)', [programmeId, `Isolated medication programme ${programmeId}`, f.admin.id]);
      await pool.query(`INSERT INTO ng_insurance_partners(id,programme_id,partner_key,display_name,onboarding_status,contract_reference,activation_evidence_reference,capabilities_json,created_by,updated_by)
        VALUES($1,$2,$3,'Isolated approved insurer',$4,'Isolated contracted service','Isolated activation evidence',$5,$6,$6)`, [partnerId, programmeId, `test-${partnerId}`, status, JSON.stringify({ medication_orders: true, medication_delivery: true, coordination_fee: true }), f.admin.id]);
      return partnerId;
    }
    async function coverage(f, orderId, partnerId, extra = {}) {
      return mutate(`/api/ng/admin/medication-delivery/${orderId}`, f.admin, 'coverage', { partnerId, authorizationReference: 'Isolated patient benefit authorization', evidenceReference: 'Isolated approval receipt', expiresAt: new Date(f.state.now + 3600000).toISOString(), allocations: { medicinesMinor: 900000 }, ...extra });
    }

    await t.test('commercial administration requires a current super administrator and cannot activate unsigned proposals or assign draft branches',async()=>{
      const f=await fixture();const base='/api/ng/admin/pharmacy-integrations';
      const profile={code:`isolated-${crypto.randomUUID()}`,displayName:'Isolated draft agreement',status:'draft',fees:{currency:'NGN',orderServiceMinor:100000,deliverySupportMinor:50000},approvals:{},settings:{mode:'pharmacist_portal'}};
      assert.equal((await http(base,{actor:f.patient})).status,403);
      assert.equal((await http(base,{actor:f.admin,method:'POST',body:profile})).status,403);
      const saved=await http(base,{actor:f.superAdmin,method:'POST',body:profile});assert.equal(saved.status,200,JSON.stringify(saved.body));
      const row=saved.body.profile;
      const register=await http(base,{actor:f.admin});assert.equal(register.status,200);assert.match(register.headers.get('cache-control'),/private.*no-store/);assert.ok(register.body.profiles.some(p=>p.id===row.id));
      assert.equal((await http(`${base}/${row.id}`,{actor:f.superAdmin,method:'PATCH',body:{...profile,status:'active',version:1}})).status,422);
      assert.equal((await http(`${base}/${row.id}/branches`,{actor:f.superAdmin,method:'POST',body:{pharmacyId:f.pharmacyId,branchReference:'isolated',approvalReference:'isolated'}})).status,409);
      const changed=await http(`${base}/${row.id}`,{actor:f.superAdmin,method:'PATCH',body:{...profile,displayName:'Revised isolated draft',version:1}});assert.equal(changed.status,200);assert.equal(changed.body.profile.version,2);
      assert.equal((await http(`${base}/${row.id}`,{actor:f.superAdmin,method:'PATCH',body:{...profile,version:1}})).status,409);
      const bearer=token(f.superAdmin);await pool.query("UPDATE users SET role='patient' WHERE id=$1",[f.superAdmin.id]);
      assert.equal((await http(base,{bearer,method:'POST',body:{...profile,code:`isolated-${crypto.randomUUID()}`}})).status,403);
      const audit=(await pool.query("SELECT count(*)::int AS count FROM ng_compliance_audit_log WHERE action='pharmacy_commercial_profile_saved' AND resource_id=$1",[row.id])).rows[0];
      // complianceService writes its canonical action trail; verify the actual
      // profile remains draft even after attempted role and version escalation.
      assert.equal((await pool.query('SELECT status FROM ng_pharmacy_commercial_profiles WHERE id=$1',[row.id])).rows[0].status,'draft');
      assert.equal(audit.count,2);
    });

    await t.test('FHIR medication exchange validates actual records against official R4, preserves dispense evidence and rejects cross-patient reads and writes',async()=>{
      const assertR4=require('./helpers/fhir-r4-schema');
      const f=await fixture();const orderId=await make(f);await confirmPrice(f,orderId);
      const base='/api/ng/medication-fhir';const path=`${base}/Bundle/${orderId}`;
      assert.equal((await http(path)).status,401);
      assert.equal((await http(path,{actor:f.otherPatient})).status,404);
      assert.equal((await http(path,{actor:f.otherPharmacist})).status,404);
      assert.equal((await http(path,{actor:f.pharmacist})).status,403);
      assert.equal((await http(path,{actor:f.patient,method:'POST',body:{resourceType:'MedicationDispense'}})).status,405);
      const metadata=await http(`${base}/metadata`,{actor:f.patient});assert.equal(metadata.status,200);assertR4(metadata.body);
      assert.equal((await http(`${base}/MedicationRequest`,{actor:f.patient})).status,400);
      assert.equal((await http(`${base}/MedicationRequest?order=${orderId}&patient=${f.otherPatient.id}`,{actor:f.patient})).status,400);
      const initial=await http(path,{actor:f.patient});assert.equal(initial.status,200,JSON.stringify(initial.body));assertR4(initial.body);
      assert.equal(initial.body.entry.filter(e=>e.resource.resourceType==='MedicationDispense').length,0);
      const request=initial.body.entry.find(e=>e.resource.resourceType==='MedicationRequest').resource;
      assert.equal(request.dispenseRequest.quantity.value,1);assert.equal(request.subject.reference,`Patient/${f.patient.id}`);
      const individual=await http(`${base}/MedicationRequest/${request.id}?order=${orderId}`,{actor:f.patient});assert.equal(individual.status,200);assertR4(individual.body);
      await mutate(patientBase(orderId),f.patient,'fulfillment',{deliveryType:'pickup',consent:true});
      assert.equal((await http(path,{actor:f.pharmacist})).status,200);
      await mutate(patientBase(orderId),f.patient,'approve',{stage:'medicines',consent:true});
      const payment=await mutate(patientBase(orderId),f.patient,'pay',{stage:'medicines'});
      assert.equal((await http(`${patientBase(orderId)}/payments/${payment.body.reference}/verify`,{actor:f.patient,method:'POST',body:{}})).status,200);
      await mutate(pharmacyBase(f,orderId),f.pharmacist,'confirm');await mutate(pharmacyBase(f,orderId),f.pharmacist,'ready',{attest:true});
      const before=await http(`${base}/MedicationDispense?order=${orderId}`,{actor:f.patient});assert.equal(before.body.total,0);
      await mutate(pharmacyBase(f,orderId),f.pharmacist,'collect',{attest:true});
      const complete=await http(path,{actor:f.patient});assert.equal(complete.status,200,JSON.stringify(complete.body));assertR4(complete.body);
      const dispense=complete.body.entry.find(e=>e.resource.resourceType==='MedicationDispense').resource;
      assert.equal(dispense.status,'completed');assert.equal(dispense.quantity.value,1);assert.equal(dispense.performer[0].actor.reference,`Practitioner/${f.pharmacist.id}`);assert.ok(dispense.whenHandedOver);assertR4(dispense);
      assert.equal(dispense.authorizingPrescription[0].reference,`MedicationRequest/${request.id}`);
      assert.equal(complete.body.entry.filter(e=>e.resource.resourceType==='Provenance').length,1);
      for(const entry of complete.body.entry)assertR4(entry.resource);
      const repeat=await http(path,{actor:f.patient});assert.equal(repeat.body.entry.find(e=>e.resource.resourceType==='MedicationDispense').resource.id,dispense.id);
      const stored=(await pool.query('SELECT resource_encrypted FROM ng_fhir_medication_dispenses WHERE order_id=$1',[orderId])).rows[0];assert.ok(stored.resource_encrypted.encrypted);assert.ok(!JSON.stringify(stored).includes('MedicationDispense'));
      await assert.rejects(pool.query('UPDATE ng_fhir_medication_dispenses SET drug_id=drug_id WHERE order_id=$1',[orderId]),/append-only/);
      assert.equal((await http(`${base}/MedicationDispense/${dispense.id}?order=${orderId}`,{actor:f.otherPatient})).status,404);
      await pool.query("UPDATE users SET is_active=false WHERE id=$1",[f.patient.id]);
      assert.notEqual((await http(path,{actor:f.patient})).status,200);
    });

    await t.test('unauthenticated checkout is rejected and signed token role claims cannot grant admin access', async () => {
      const f = await fixture(); const orderId = await make(f);
      assert.equal((await http(`${patientBase(orderId)}/checkout`)).status, 401);
      assert.equal((await http('/api/ng/admin/medication-delivery', { bearer: token(f.patient, { role: 'admin' }) })).status, 403);
      const owned = await http(`${patientBase(orderId)}/checkout`, { actor: f.patient });
      assert.equal(owned.status, 200); assert.match(owned.headers.get('cache-control'), /private.*no-store/);
      assert.equal((await pool.query('SELECT patient_user_id FROM ng_orders WHERE id=$1', [orderId])).rows[0].patient_user_id, f.patient.id);
    });

    await t.test('a stale admin JWT immediately loses report and benefit access after database role revocation', async () => {
      const f = await fixture(); const bearer = token(f.admin);
      assert.equal((await http('/api/ng/admin/medication-delivery', { bearer })).status, 200);
      await pool.query('UPDATE users SET role=\'patient\' WHERE id=$1', [f.admin.id]);
      assert.equal((await http('/api/ng/admin/medication-delivery', { bearer })).status, 403);
      assert.equal((await http('/api/ng/admin/medication-delivery/insurance-partners', { bearer })).status, 403);
    });

    await t.test('foreign patient checkout and same-owner wrong pharmacy path cannot cross order boundaries', async () => {
      const f = await fixture(); const orderId = await make(f);
      assert.equal((await http(`${patientBase(orderId)}/checkout`, { actor: f.otherPatient })).status, 404);
      assert.equal((await http(`${pharmacyBase(f, orderId)}/checkout`, { actor: f.otherPharmacist })).status, 403);
      const second = await createBrowserFixture({ pool });
      await pool.query('UPDATE ng_pharmacies SET owner_user_id=$1 WHERE id=$2', [f.pharmacist.id, second.pharmacyId]);
      const wrongBase = `/api/ng/pharmacy/${second.pharmacyId}/orders/${orderId}`;
      assert.equal((await http(`${wrongBase}/checkout`, { actor: f.pharmacist })).status, 404);
      assert.equal((await http(`${wrongBase}/ready`, { actor: f.pharmacist, method: 'POST', body: { version: 1, attest: true, idempotencyKey: crypto.randomUUID() } })).status, 404);
    });

    await t.test('pharmacy final prices, patient collection consent and payment verification pass actual HTTP routes', async () => {
      const f = await fixture(); const orderId = await make(f); await confirmPrice(f, orderId);
      assert.equal((await mutate(patientBase(orderId), f.patient, 'fulfillment', { deliveryType: 'pickup', consent: true })).status, 200);
      assert.equal((await mutate(patientBase(orderId), f.patient, 'approve', { stage: 'medicines', consent: true })).status, 200);
      const payment = await mutate(patientBase(orderId), f.patient, 'pay', { stage: 'medicines' }); assert.equal(payment.status, 200);
      const paid = await http(`${patientBase(orderId)}/payments/${payment.body.reference}/verify`, { actor: f.patient, method: 'POST', body: {} }); assert.equal(paid.status, 200, JSON.stringify(paid.body));
      assert.equal((await mutate(pharmacyBase(f, orderId), f.pharmacist, 'confirm')).status, 200);
      assert.equal((await mutate(pharmacyBase(f, orderId), f.pharmacist, 'ready', { attest: true })).status, 200);
      const collected = await mutate(pharmacyBase(f, orderId), f.pharmacist, 'collect', { attest: true });
      assert.equal(collected.status, 200); assert.equal(collected.body.status, 'delivered'); assert.equal(collected.body.pricing.managementMinor, 0); assert.equal(f.state.bookCalls, 0);
    });

    await t.test('review-only insurer onboarding and invalid or overallocated benefit evidence are rejected', async () => {
      const f = await fixture(); const orderId = await make(f); await confirmPrice(f, orderId);
      const pending = await partner(f, 'review'); assert.equal((await coverage(f, orderId, pending)).status, 409);
      const approved = await partner(f);
      assert.equal((await coverage(f, orderId, approved, { expiresAt: new Date(f.state.now - 1000).toISOString() })).status, 422);
      assert.ok((await coverage(f, orderId, approved, { allocations: { medicinesMinor: 900001 } })).status >= 400);
      assert.equal((await http(`/api/ng/admin/medication-delivery/${orderId}/coverage`, { actor: f.patient, method: 'POST', body: { partnerId: approved } })).status, 403);
    });

    await t.test('legacy prescription dispense cannot bypass an unpaid order reservation even with its order ID in the body', async () => {
      const f = await fixture(); const orderId = await make(f);
      const received = await http(`/api/ng/prescriptions/${f.prescriptionId}/receive`, { actor: f.pharmacist, method: 'POST', body: {} }); assert.equal(received.status, 200, JSON.stringify(received.body));
      const item = (await pool.query('SELECT id FROM ng_rx_items WHERE prescription_id=$1', [f.prescriptionId])).rows[0];
      const attempted = await http(`/api/ng/prescriptions/${f.prescriptionId}/items/${item.id}/dispense`, { actor: f.pharmacist, method: 'POST', body: { quantity: 1, fulfillment_order_id: orderId } });
      assert.equal(attempted.status, 409, JSON.stringify(attempted.body));
      assert.equal((await pool.query('SELECT status FROM ng_rx_items WHERE id=$1', [item.id])).rows[0].status, 'available');
      assert.equal((await pool.query('SELECT COUNT(*)::int AS count FROM ng_medication_payment_attempts WHERE order_id=$1', [orderId])).rows[0].count, 0);
    });

    await t.test('valid HMO benefit is a verified insurer receivable and expires before pharmacy preparation', async () => {
      const f = await fixture(); const orderId = await make(f); await confirmPrice(f, orderId); const partnerId = await partner(f);
      const covered = await coverage(f, orderId, partnerId); assert.equal(covered.status, 200, JSON.stringify(covered.body));
      const approved = await mutate(patientBase(orderId), f.patient, 'approve', { stage: 'medicines', consent: true }); assert.equal(approved.status, 200, JSON.stringify(approved.body));
      assert.equal(approved.body.pricing.patientTotalMinor, 0); assert.equal(approved.body.pricing.insurerTotalMinor, 900000); assert.equal(approved.body.payment.medicines.status, 'covered');
      f.advance(3600001);
      const attempted = await mutate(pharmacyBase(f, orderId), f.pharmacist, 'confirm'); assert.equal(attempted.status, 409);
      assert.equal(f.state.initializeCalls, 0);
    });

    await t.test('insurer suspension after authorization blocks preparation against the now-unapproved benefit', async () => {
      const f = await fixture(); const orderId = await make(f); await confirmPrice(f, orderId); const partnerId = await partner(f);
      assert.equal((await coverage(f, orderId, partnerId)).status, 200);
      assert.equal((await mutate(patientBase(orderId), f.patient, 'approve', { stage: 'medicines', consent: true })).status, 200);
      await pool.query('UPDATE ng_insurance_partners SET onboarding_status=\'suspended\' WHERE id=$1', [partnerId]);
      const attempted = await mutate(pharmacyBase(f, orderId), f.pharmacist, 'confirm'); assert.equal(attempted.status, 409);
    });

    await t.test('deactivated or changed-role accounts lose medication writes despite an unexpired JWT', async () => {
      const f = await fixture(); const orderId = await make(f); const bearer = token(f.patient);
      await pool.query('UPDATE users SET is_active=FALSE WHERE id=$1', [f.patient.id]);
      assert.equal((await http(`${patientBase(orderId)}/checkout`, { bearer })).status, 403);
      const pharmacistToken = token(f.pharmacist);
      await pool.query('UPDATE users SET role=\'patient\' WHERE id=$1', [f.pharmacist.id]);
      assert.equal((await http(`${pharmacyBase(f, orderId)}/checkout`, { bearer: pharmacistToken })).status, 403);
    });
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    require.cache[workflowPath].exports = originalWorkflow; db.getPool = oldPool; db.query = oldQuery;
    await pool.end();
    for (const [name, value] of Object.entries(previous)) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
  }
});
