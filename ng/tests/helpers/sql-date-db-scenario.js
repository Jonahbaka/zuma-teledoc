'use strict';
// Synthetic fixtures only, invoked in separate processes for each host timezone.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { Pool } = require('pg');
const { sqlDateEndUtc } = require('../../services/shared/sqlDate');
const { createBrowserFixture } = require('./medication-delivery-fixture');
const gateway = require('../../services/pharmacy/pharmacistRxService');
const inbox = require('../../services/pharmacy/clinicalInboxService');
const fhir = require('../../services/interop/medicationFhirService');
const request = (checkout, body = {}) => ({ version: checkout.version, idempotencyKey: crypto.randomUUID(), ...body });
async function run() {
  const target = new URL(process.env.SIMULATION_DATABASE_URL);
  assert.ok(['localhost','127.0.0.1'].includes(target.hostname) && target.pathname.endsWith('_test'), 'Only an explicitly disposable loopback database is supported.');
  assert.equal(process.env.NODE_ENV, 'test');
  const pool = new Pool({ connectionString: target.href, max: 4, options: '-c timezone=UTC' });
  try {
    const client = await pool.connect();
    try {
      for (const style of ['ISO, YMD','SQL, DMY']) {
        await client.query(`SET DateStyle TO '${style}'`);
        for (const date of ['2024-02-29','2026-03-08','2026-11-01','2026-11-03','2026-12-31']) {
          const row = (await client.query("SELECT $1::date AS raw_date,to_char($1::date,'YYYY-MM-DD') AS civil_date", [date])).rows[0];
          assert.equal(row.civil_date,date);
          assert.equal(sqlDateEndUtc(row.civil_date),Date.parse(`${date}T00:00:00Z`)+86400000);
          if (style==='ISO, YMD') assert.ok(row.raw_date instanceof Date);
        }
      }
    } finally { await client.query("SET DateStyle TO 'ISO, YMD'"); client.release(); }

    // Exercise both create and post-reservation workflow gates on the inclusive
    // civil day, independently of the machine clock or its DST offset.
    const f = await createBrowserFixture({ pool });
    const date='2026-11-03'; const end=sqlDateEndUtc(date); f.state.now=end-1;
    await pool.query('UPDATE ng_pharmacies SET pcn_license_expiry=$1::date WHERE id=$2',[date,f.pharmacyId]);
    await pool.query('UPDATE ng_digital_prescriptions SET expires_at=$1::date WHERE id=$2',[date,f.prescriptionId]);
    const made=await f.service.createOrder(f.input,f.patient); const orderId=made.order.id;
    assert.equal(made.checkout.pharmacy.active,true);
    let checkout=await f.service.getCheckout(orderId,f.pharmacist);
    await f.service.confirmPrice(orderId,f.pharmacist,request(checkout,{items:[{drugId:f.drugId,unitPriceMinor:900000}],pharmacistRegistrationNumber:f.registration,attest:true,packageCategory:'sealed_ambient_medication'}));
    f.state.now=end;
    await assert.rejects(f.service.getCheckout(orderId,f.pharmacist),error=>error.status===403);
    assert.equal((await f.service.getCheckout(orderId,f.patient)).pharmacy.active,false);
    f.state.now=end-1;
    // Isolate Rx expiry from the separately tested pharmacy expiry boundary.
    await pool.query("UPDATE ng_pharmacies SET pcn_license_expiry='2099-01-01' WHERE id=$1",[f.pharmacyId]);
    checkout=await f.service.getCheckout(orderId,f.patient);
    await f.service.approve(orderId,f.patient,request(checkout,{stage:'medicines',consent:true}));
    const unchanged=async()=>({
      fulfillment:(await pool.query('SELECT version,medicines_approval FROM ng_medication_fulfillments WHERE order_id=$1',[orderId])).rows[0],
      stock:(await pool.query('SELECT quantity_available,quantity_reserved FROM ng_pharmacy_inventory WHERE id=$1',[f.inventoryId])).rows[0],
      operations:(await pool.query('SELECT operation_key FROM ng_medication_operations WHERE order_id=$1 ORDER BY operation_key',[orderId])).rows,
      ledger:(await pool.query('SELECT count(*)::int AS count FROM ng_medication_ledger WHERE order_id=$1',[orderId])).rows[0],
    });
    const before=await unchanged();
    for(const expiry of [date,null]) {
      await pool.query('UPDATE ng_digital_prescriptions SET expires_at=$1::date WHERE id=$2',[expiry,f.prescriptionId]);
      f.state.now=expiry===null?end-1:end;
      checkout=await f.service.getCheckout(orderId,f.patient);
      await assert.rejects(f.service.approve(orderId,f.patient,request(checkout,{stage:'medicines',consent:true})),error=>error.status===409&&/current signed prescription/.test(error.message));
      assert.deepEqual(await unchanged(),before);
    }
    assert.equal(f.state.initializeCalls,0); assert.equal(f.state.bookCalls,0); assert.equal(f.state.refundCalls,0);
    // A NULL DATE must fail before creating an order or reserving inventory.
    const absent=await createBrowserFixture({pool});
    await pool.query('UPDATE ng_digital_prescriptions SET expires_at=NULL WHERE id=$1',[absent.prescriptionId]);
    await assert.rejects(absent.service.createOrder(absent.input,absent.patient),error=>error.status===409);
    assert.equal((await pool.query('SELECT quantity_reserved FROM ng_pharmacy_inventory WHERE id=$1',[absent.inventoryId])).rows[0].quantity_reserved,0);
    assert.equal((await pool.query('SELECT count(*)::int AS count FROM ng_orders WHERE pharmacy_id=$1',[absent.pharmacyId])).rows[0].count,0);

    // Exercise real metadata-only gateway and clinical/FHIR authority queries.
    const g=await createBrowserFixture({pool});
    const currentDay=new Date().toISOString().slice(0,10);
    await pool.query('UPDATE ng_pharmacies SET pcn_license_expiry=$1::date WHERE id=$2',[currentDay,g.pharmacyId]);
    await pool.query('UPDATE ng_digital_prescriptions SET expires_at=$1::date WHERE id=$2',[currentDay,g.prescriptionId]);
    assert.equal((await gateway.list(pool,g.pharmacist)).some(rx=>rx.id===g.prescriptionId),true);
    assert.equal((await gateway.read(pool,g.pharmacist,g.prescriptionId)).id,g.prescriptionId);
    assert.equal((await inbox.listPrescriptions(pool,g.pharmacist,g.pharmacyId)).some(rx=>rx.id===g.prescriptionId),true);
    await gateway.mutate(pool,g.pharmacist,g.prescriptionId,'receive');
    const item=(await pool.query('SELECT id FROM ng_rx_items WHERE prescription_id=$1',[g.prescriptionId])).rows[0];
    assert.equal((await gateway.mutate(pool,g.pharmacist,g.prescriptionId,'dispense',{},item.id)).lifecycle_status,'fully_dispensed');
    const h=await createBrowserFixture({pool});
    await pool.query('UPDATE ng_pharmacies SET pcn_license_expiry=$1::date WHERE id=$2',[new Date().toISOString().slice(0,10),h.pharmacyId]);
    const order=await h.service.createOrder(h.input,h.patient);
    const view=await h.service.getCheckout(order.order.id,h.patient);
    await h.service.setFulfillment(order.order.id,h.patient,request(view,{deliveryType:'pickup',consent:true}));
    const expectedDate=(await pool.query("SELECT to_char(expires_at,'YYYY-MM-DD') AS expires_at FROM ng_digital_prescriptions WHERE id=$1",[h.prescriptionId])).rows[0].expires_at;
    const bundle=await fhir.read(pool,h.pharmacist,order.order.id);
    assert.equal(bundle.resourceType,'Bundle');
    const requests=bundle.entry.map(entry=>entry.resource).filter(resource=>resource.resourceType==='MedicationRequest');
    assert.equal(requests.length,1);
    for(const resource of requests){
      require('./fhir-r4-schema')(resource);
      assert.equal(resource.dispenseRequest.validityPeriod.end,expectedDate);
    }
    const readAudits=async()=>Number((await pool.query("SELECT count(*)::int AS count FROM ng_compliance_audit_log WHERE resource_id=$1 AND action='medication_fhir_read'",[order.order.id])).rows[0].count);
    const successfulReads=await readAudits();
    for(const unsupported of ['infinity','-infinity','0001-01-01 BC','10000-01-01']){
      await pool.query('UPDATE ng_digital_prescriptions SET expires_at=$1::date WHERE id=$2',[unsupported,h.prescriptionId]);
      await assert.rejects(fhir.read(pool,h.pharmacist,order.order.id),error=>error.status===422);
      assert.equal(await readAudits(),successfulReads,'Invalid date export must not record a successful clinical read');
    }
    await pool.query('UPDATE ng_digital_prescriptions SET expires_at=NULL WHERE id=$1',[h.prescriptionId]);
    const missing=await fhir.read(pool,h.pharmacist,order.order.id);
    assert.equal(missing.entry.find(entry=>entry.resource.resourceType==='MedicationRequest').resource.dispenseRequest.validityPeriod,undefined);
    await pool.query('UPDATE ng_digital_prescriptions SET expires_at=$1::date WHERE id=$2',[expectedDate,h.prescriptionId]);

    // Uploaded prescriptions are TIMESTAMPTZ, not a civil DATE. Preserve the
    // original instant cutoff even when it falls in the middle of a UTC day.
    const uploaded=await createBrowserFixture({pool,uploaded:true});
    const instant='2026-11-03T12:34:56.000Z'; uploaded.state.now=Date.parse(instant)-1;
    await pool.query('UPDATE ng_prescriptions SET expires_at=$1::timestamptz WHERE id=$2',[instant,uploaded.prescriptionId]);
    const upload=await uploaded.service.createOrder(uploaded.input,uploaded.patient);
    const uploadCheckout=await uploaded.service.getCheckout(upload.order.id,uploaded.pharmacist);
    await uploaded.service.confirmPrice(upload.order.id,uploaded.pharmacist,request(uploadCheckout,{items:[{drugId:uploaded.drugId,unitPriceMinor:900000}],pharmacistRegistrationNumber:uploaded.registration,attest:true,packageCategory:'sealed_ambient_medication'}));
    uploaded.state.now=Date.parse(instant);
    const expired=await uploaded.service.getCheckout(upload.order.id,uploaded.patient);
    await assert.rejects(uploaded.service.approve(upload.order.id,uploaded.patient,request(expired,{stage:'medicines',consent:true})),error=>error.status===409&&/verification/.test(error.message));
    assert.equal(uploaded.state.initializeCalls,0);
  } finally { await pool.end(); }
}
module.exports={run};
