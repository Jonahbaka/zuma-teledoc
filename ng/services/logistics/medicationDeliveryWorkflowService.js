'use strict';

const crypto = require('crypto');
const { getPool } = require('../../../server/db');
const { encrypt, decrypt } = require('../../../lib/encryption');
const { createCourierProvider } = require('./providers');
const { assertMinor, decimalToMinor, minorToDecimalString, buildPricing, stageAmounts } = require('./deliveryPricing');
const paystack = require('../payments/paystackService');
const compliance = require('../compliance/complianceService');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const dayEnd = value => { const date = new Date(value); return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1); };
function fail(status, message, code = 'MEDICATION_WORKFLOW_REJECTED') { return Object.assign(new Error(message), { status, code }); }
function id(value) { if (!UUID.test(value || '')) throw fail(400, 'A valid record identifier is required.'); return value; }
function key(value) { if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/.test(value)) throw fail(400, 'A stable idempotency key is required.'); return value; }
function checkedSum(values) { return assertMinor(values.reduce((sum, value) => sum + BigInt(assertMinor(value)), 0n).toString()); }
function address(input) {
  if (!input || typeof input !== 'object') throw fail(422, 'A complete delivery address is required.');
  const clean = {};
  for (const field of ['addressLine1', 'city', 'state', 'recipientName', 'recipientPhone']) {
    if (typeof input[field] !== 'string' || !input[field].trim() || input[field].length > 240) throw fail(422, 'Address and authorized recipient contact details are required.');
    clean[field] = input[field].trim();
  }
  if (!/^\+[1-9]\d{7,14}$/.test(clean.recipientPhone)) throw fail(422, 'Use an international recipient phone number.');
  for (const [field, limit] of [['latitude', 90], ['longitude', 180]]) {
    if (typeof input[field] !== 'number' || !Number.isFinite(input[field]) || Math.abs(input[field]) > limit) throw fail(422, 'Confirm a valid delivery location on the map.');
    clean[field] = input[field];
  }
  if (!/^(?:FCT|Abuja|Federal Capital Territory)$/i.test(clean.state)) throw fail(422, 'Courier activation currently requires an approved Abuja/FCT delivery address.');
  clean.postalCode = typeof input.postalCode === 'string' ? input.postalCode.trim().slice(0, 20) : '';
  return clean;
}
function openAddress(envelope) {
  if (!envelope) return null;
  const plain = decrypt(envelope.encrypted, envelope.iv, envelope.tag);
  if (!plain) throw fail(503, 'Delivery address could not be securely opened.');
  return JSON.parse(plain);
}

function createMedicationDeliveryWorkflowService(options = {}) {
  const env = options.env || process.env;
  if (Object.keys(options).some(k => k !== 'env') && (process.env.NODE_ENV === 'production' || !['test', 'development'].includes(env.NODE_ENV))) throw fail(500, 'Test dependencies are not allowed in production.');
  const pool = options.pool || getPool();
  const provider = options.provider || createCourierProvider({ env });
  const gateway = options.gateway || paystack;
  const now = options.now || Date.now;
  const finance = () => options.finance || require('./medicationFinanceService').createMedicationFinanceService({ pool, gateway, env, now });
  async function tx(fn) {
    const client = await pool.connect();
    try { await client.query('BEGIN'); const result = await fn(client); await client.query('COMMIT'); return result; }
    catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }
  async function user(client, actor) {
    id(actor?.id);
    const row = (await client.query('SELECT id,role,email,is_active FROM users WHERE id=$1', [actor.id])).rows[0];
    if (!row?.is_active) throw fail(403, 'An active account is required.');
    return row;
  }
  async function audit(client, order, actor, action, details = {}) {
    await client.query('INSERT INTO ng_medication_events(order_id,actor_user_id,action,details) VALUES($1,$2,$3,$4)', [order.id, actor?.id || null, action, JSON.stringify(details)]);
    await compliance.logAction({ actorUserId: actor?.id || null, actorType: actor?.role || 'system', action: `medication_${action}`, resourceType: 'ng_order', resourceId: order.id, pharmacyId: order.pharmacy_id, details }, client);
  }
  async function load(client, orderId, actor, { lock = false, pharmacy = false, patient = false, system = false } = {}) {
    id(orderId);
    const order = (await client.query(`SELECT o.* FROM ng_orders o WHERE o.id=$1 ${lock ? 'FOR UPDATE' : ''}`, [orderId])).rows[0];
    if (!order) throw fail(404, 'Order not found.');
    const f = (await client.query(`SELECT * FROM ng_medication_fulfillments WHERE order_id=$1 ${lock ? 'FOR UPDATE' : ''}`, [orderId])).rows[0];
    if (!f) throw fail(409, 'This earlier order requires pharmacy support before using medication checkout.');
    const p = (await client.query('SELECT * FROM ng_pharmacies WHERE id=$1', [order.pharmacy_id])).rows[0];
    let actorUser = null;
    if (!system) {
      actorUser = await user(client, actor);
      const admin = ['admin', 'super_admin'].includes(actorUser.role);
      const owns = actorUser.id === order.patient_user_id;
      const manages = p.owner_user_id === actorUser.id && actorUser.role === 'pharmacy';
      if ((patient && !owns) || (pharmacy && !manages) || (!patient && !pharmacy && !owns && !manages && !admin)) throw fail(404, 'Order not found.');
    }
    return { order, f, p, actor: actorUser };
  }
  function pharmacyValid(p) {
    if (p.status !== 'approved' || !p.verified_at || !p.pcn_license_number || !p.superintendent_pcn_number || !p.pcn_license_expiry || dayEnd(p.pcn_license_expiry) <= now()) throw fail(403, 'An approved pharmacy with current professional authorization is required.');
  }
  async function rxValid(client, ctx) {
    const { order, f } = ctx;
    if (f.digital_prescription_id) {
      const rx = (await client.query('SELECT * FROM ng_digital_prescriptions WHERE id=$1 FOR UPDATE', [f.digital_prescription_id])).rows[0];
      if (!rx?.signed_at || !['sent_to_pharmacy', 'received', 'partially_dispensed', 'fully_dispensed'].includes(rx.lifecycle_status) || rx.patient_user_id !== order.patient_user_id || rx.routed_pharmacy_id !== order.pharmacy_id || dayEnd(rx.expires_at) <= now()) throw fail(409, 'A current signed prescription routed to this pharmacy is required.');
      const claimed = await client.query("SELECT 1 FROM ng_rx_items WHERE fulfillment_order_id=$1 AND status NOT IN ('pending','available') LIMIT 1", [order.id]);
      if (claimed.rows.length) throw fail(409, 'The prescription items changed after reservation. Pharmacy review is required.');
      return rx;
    }
    const rx = (await client.query('SELECT * FROM ng_prescriptions WHERE id=$1', [order.prescription_id])).rows[0];
    if (!rx || rx.patient_user_id !== order.patient_user_id || !rx.verified_by_pharmacist || !rx.verified_at || !['verified', 'matched', 'dispensing'].includes(rx.status) || new Date(rx.expires_at).getTime() <= now()) throw fail(409, 'Pharmacist verification of this prescription is required.');
    return rx;
  }
  async function quoteRow(client, f) { return f.current_quote_id ? (await client.query('SELECT * FROM ng_medication_quotes WHERE id=$1 AND order_id=$2', [f.current_quote_id, f.order_id])).rows[0] : null; }
  function pricing(ctx, q, historical = false) {
    return buildPricing({ medicinesMinor: ctx.f.medicines_minor, deliveryType: ctx.order.delivery_type,
      quote: q ? q.normalized : null, coordination: ctx.f.coordination, coverage: ctx.f.coverage,
      now: historical && q ? Math.min(now(), new Date(q.expires_at).getTime() - 1) : now() });
  }
  async function paid(client, ctx, stage) {
    const approval = ctx.f[`${stage}_approval`];
    if (!approval) return false;
    if (approval.insurerMinor > 0) {
      if (!ctx.f.coverage.verified || !Number.isFinite(Date.parse(ctx.f.coverage.expiresAt)) || Date.parse(ctx.f.coverage.expiresAt) <= now() || !ctx.f.coverage.partnerId) return false;
      const partner = (await client.query('SELECT * FROM ng_insurance_partners WHERE id=$1', [ctx.f.coverage.partnerId])).rows[0];
      if (!partner || partner.onboarding_status !== 'live' || !partner.contract_reference || !partner.activation_evidence_reference || partner.capabilities_json?.medication_orders !== true || (stage === 'delivery' && partner.capabilities_json?.medication_delivery !== true)) return false;
    }
    if (approval.patientMinor === 0) return true;
    const row = (await client.query("SELECT COALESCE(SUM(amount_minor),0)::text AS amount FROM ng_medication_payment_attempts WHERE order_id=$1 AND stage=$2 AND status='verified'", [ctx.order.id, stage])).rows[0];
    return assertMinor(row.amount) === approval.patientMinor;
  }
  async function dto(client, ctx) {
    const { order, f, p } = ctx;
    const q = await quoteRow(client, f);
    const price = pricing(ctx, q, true);
    const expired = !!q && new Date(q.expires_at).getTime() <= now() + 30000;
    const medicinesPaid = await paid(client, ctx, 'medicines');
    const deliveryPaid = await paid(client, ctx, 'delivery');
    const booking = (await client.query('SELECT * FROM ng_medication_bookings WHERE order_id=$1', [order.id])).rows[0];
    const attempts = (await client.query('SELECT stage,status,provider_reference,amount_minor,authorization_url,approval_digest FROM ng_medication_payment_attempts WHERE order_id=$1 ORDER BY created_at DESC', [order.id])).rows;
    const pending = attempts.some(a => ['initializing', 'pending', 'reconciliation_required', 'refund_pending'].includes(a.status));
    let coverageStatus = 'unverified';
    if (f.coverage.verified === true) {
      coverageStatus = Date.parse(f.coverage.expiresAt) > now() ? 'unavailable' : 'expired';
      if (coverageStatus === 'unavailable' && f.coverage.partnerId) {
        const insurer = (await client.query('SELECT onboarding_status,contract_reference,activation_evidence_reference,capabilities_json FROM ng_insurance_partners WHERE id=$1', [f.coverage.partnerId])).rows[0];
        if (insurer?.onboarding_status === 'live' && insurer.contract_reference && insurer.activation_evidence_reference && insurer.capabilities_json?.medication_orders === true) coverageStatus = 'verified';
      }
    }
    const closed = ['cancelled', 'refunded', 'delivered'].includes(order.status) || !!f.collected_at;
    const ended = closed || !!f.cancellation_requested_at;
    const approved = !!f.pharmacy_confirmed_at;
    const checkoutEnabled = env.NG_MEDICATION_CHECKOUT_ENABLED === 'true';
    const canResume = stage => attempts.some(a => a.stage === stage && a.status === 'pending' && a.authorization_url && f[`${stage}_approval`] && a.approval_digest === hash(f[`${stage}_approval`]));
    const canQuote = !ended && !booking && order.delivery_type === 'delivery' && !!f.pharmacy_ready_at && medicinesPaid && !!f.address_encrypted && !!f.contact_consent_at && f.package_category === 'sealed_ambient_medication' && provider.getAvailability().available;
    const payment = stage => {
      const a = attempts.find(a => a.stage === stage);
      const verified = stage === 'medicines' ? medicinesPaid : deliveryPaid;
      return { status: verified ? (ctx.f[`${stage}_approval`]?.patientMinor === 0 ? 'covered' : 'verified') : a?.status || 'unpaid', amountMinor: stageAmounts(price, stage).patientMinor, recordedAmountMinor: a ? assertMinor(a.amount_minor) : null, reference: a?.provider_reference || null };
    };
    return { orderId: order.id, orderNumber: order.order_number, version: f.version, status: order.status, cancellationPending: !!f.cancellation_requested_at && !closed, deliveryType: order.delivery_type,
      pharmacy: { id: p.id, name: p.name, phone: p.phone, address: [p.address_line1, p.city, p.state].filter(Boolean).join(', ') },
      items: order.items.map(it => ({ drugId: it.drug_id, name: it.name, quantity: it.quantity, unitPriceMinor: it.unitPriceMinor, lineTotalMinor: it.lineTotalMinor })), pricing: price,
      pharmacyConfirmedAt: f.pharmacy_confirmed_at, pharmacyReadyAt: f.pharmacy_ready_at,
      address: openAddress(f.address_encrypted),
      quote: q ? { id: q.id, provider: q.provider, providerName: 'Uber Direct', fareMinor: assertMinor(q.fare_minor), expiresAt: q.expires_at, pickupEta: q.normalized.pickupEta, dropoffEta: q.normalized.dropoffEta, expired } : null,
      payment: { medicines: payment('medicines'), delivery: payment('delivery') },
      delivery: booking ? { trackingId: booking.id, status: booking.status, provider: booking.provider, providerName: 'Uber Direct', estimatedDeliveryAt: booking.normalized?.dropoffEta || null, updatedAt: booking.updated_at, trackingUrl: booking.normalized?.trackingUrl || null, pickupProof: booking.pickup_proof, deliveryProof: booking.delivery_proof } : null,
      actions: { canChoose: !ended && !booking && !pending && !f.delivery_approval,
        canSetCoverage: !ended && !booking && !pending && !f.delivery_approval,
        canRefreshRefund: attempts.some(a => a.status === 'refund_pending'),
        canReceiveReturn: ['returned','return_pending'].includes(booking?.status) && !f.return_received_at,
        canApproveReturnRefund: !!f.return_received_at && !f.return_refund_approval_reference,
        canPrice: !ended && !approved && !pending, canConfirm: !ended && order.status === 'pending' && medicinesPaid,
        canReady: !ended && order.status === 'preparing' && medicinesPaid,
        canApproveMedicines: !ended && approved && !medicinesPaid && !pending,
        canPayMedicines: checkoutEnabled && !ended && !!f.medicines_approval && !medicinesPaid && (!pending || canResume('medicines')),
        canRequestQuote: canQuote && !pending, canApproveQuote: canQuote && !!q && !expired && !deliveryPaid && !pending && !f.delivery_repricing_refund_required,
        canPayDelivery: checkoutEnabled && canQuote && !!f.delivery_approval && !expired && !deliveryPaid && (!pending || canResume('delivery')) && !f.delivery_repricing_refund_required,
        canDispatch: canQuote && !!q && !expired && deliveryPaid && !!f.delivery_approval && !f.delivery_repricing_refund_required,
        canCancel: !closed && (!booking || ['booked', 'courier_assigned'].includes(booking.status) || booking.status === 'booking_failed' && !booking.provider_delivery_id),
        canMarkCollected: !ended && order.delivery_type === 'pickup' && !!f.pharmacy_ready_at && medicinesPaid,
        canRefresh: !!booking && !ended }, couriers: provider.getAvailability(),
      coordination: { authorized: f.coordination.authorized === true, payer: f.coordination.payer || null, reference: f.coordination.authorizationReference || null, includedElsewhere: f.coordination.includedElsewhere === true },
      checkout: { enabled: checkoutEnabled },
      coverage: { status: coverageStatus },
      returns: { receivedAt: f.return_received_at, evidenceReference: f.return_evidence_reference, refundApprovalReference: f.return_refund_approval_reference, disposition: f.return_received_at ? 'quarantined' : null } };
  }
  async function operation(orderId, actor, input, action, scope, fn) {
    return tx(async client => {
      const ctx = await load(client, orderId, actor, { lock: true, ...scope });
      const operationKey = key(input.idempotencyKey);
      const digest = hash({ action, input });
      const previous = (await client.query('SELECT * FROM ng_medication_operations WHERE order_id=$1 AND operation_key=$2', [orderId, operationKey])).rows[0];
      if (previous) { if (previous.action !== action || previous.digest !== digest) throw fail(409, 'This request key was used for a different operation.'); return dto(client, ctx); }
      if (!Number.isInteger(input.version) || input.version !== ctx.f.version) throw fail(409, 'The order changed. Refresh it before confirming.');
      if (['cancelled', 'refunded', 'delivered'].includes(ctx.order.status)) throw fail(409, 'This order is closed.');
      if (ctx.f.cancellation_requested_at && action !== 'return_received_quarantined') throw fail(409, 'This order is awaiting cancellation reconciliation.');
      await fn(client, ctx);
      await client.query('UPDATE ng_medication_fulfillments SET version=version+1,updated_at=now() WHERE order_id=$1', [orderId]);
      await client.query('INSERT INTO ng_medication_operations(order_id,operation_key,action,digest) VALUES($1,$2,$3,$4)', [orderId, operationKey, action, digest]);
      await audit(client, ctx.order, ctx.actor, action);
      return dto(client, await load(client, orderId, actor, scope));
    });
  }
  async function pendingPayments(client, orderId) {
    const r = await client.query("SELECT 1 FROM ng_medication_payment_attempts WHERE order_id=$1 AND status IN ('initializing','pending','reconciliation_required','refund_pending') LIMIT 1", [orderId]);
    if (r.rows.length) throw fail(409, 'Verify or reconcile the existing payment before changing this order.');
  }
  async function hasBooking(client, orderId) { return (await client.query('SELECT * FROM ng_medication_bookings WHERE order_id=$1', [orderId])).rows[0]; }
  async function categoryValid(client, ctx) {
    if (ctx.f.package_category !== 'sealed_ambient_medication') throw fail(422, 'This medication category is not approved for this courier.');
    const drugs = ctx.order.items.map(it => it.drug_id);
    const invalid = await client.query("SELECT 1 FROM ng_drug_catalog WHERE id=ANY($1::uuid[]) AND (category='controlled' OR schedule IS NOT NULL OR delivery_restriction IN ('cold_chain','restricted','prohibited') OR is_active IS NOT TRUE) LIMIT 1", [drugs]);
    if (invalid.rows.length) throw fail(422, 'A medicine in this order requires a different supervised handling process.');
  }
  async function stockValid(client, orderId) {
    const result = await client.query('SELECT 1 FROM ng_medication_reservations r JOIN ng_pharmacy_inventory i ON i.id=r.inventory_id WHERE r.order_id=$1 AND (i.expiry_date IS NULL OR i.expiry_date<=CURRENT_DATE OR i.quantity_reserved<r.quantity) LIMIT 1', [orderId]);
    if (result.rows.length) throw fail(409, 'The reserved medicines must be reverified by pharmacy support.');
  }
  function providerInput(ctx) {
    const p = ctx.p;
    const destination = openAddress(ctx.f.address_encrypted);
    if (!destination || !ctx.f.contact_consent_at) throw fail(409, 'Delivery address and contact consent are required.');
    if (ctx.f.package_category !== 'sealed_ambient_medication') throw fail(422, 'This medication category is not authorized for this courier.');
    if (!p.delivery_enabled || !/^(?:FCT|Abuja|Federal Capital Territory)$/i.test(p.state || '')) throw fail(422, 'This pharmacy is not approved for courier pickup in Abuja/FCT.');
    if (p.latitude === null || p.longitude === null || !Number.isFinite(Number(p.latitude)) || !Number.isFinite(Number(p.longitude))) throw fail(422, 'The pharmacy pickup location must be verified.');
    const phone = String(p.phone || '').replace(/[\s()-]/g, '');
    return { pickup: { address: { streetAddress: [p.address_line1, p.address_line2].filter(Boolean), city: p.city, state: p.state, country: 'NG', postalCode: p.postal_code || '' }, latitude: Number(p.latitude), longitude: Number(p.longitude), contactName: p.name, contactPhone: phone, regionCode: 'NG-FCT' },
      dropoff: { address: { streetAddress: [destination.addressLine1], city: destination.city, state: destination.state, country: 'NG', postalCode: destination.postalCode }, latitude: destination.latitude, longitude: destination.longitude, contactName: destination.recipientName, contactPhone: destination.recipientPhone, regionCode: 'NG-FCT' }, package: { category: ctx.f.package_category, quantity: 1, size: 'small' } };
  }
  async function createOrder(input, actor) {
    return tx(async client => {
      const patient = await user(client, actor);
      if (patient.role !== 'patient') throw fail(403, 'Patient access is required.');
      const createKey = `${patient.id}:${key(input.idempotencyKey)}`;
      const digest = hash(input);
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [createKey]);
      const old = (await client.query('SELECT order_id,create_digest FROM ng_medication_fulfillments WHERE create_key=$1', [createKey])).rows[0];
      if (old) { if (old.create_digest !== digest) throw fail(409, 'This checkout key already belongs to a different order.'); const ctx = await load(client, old.order_id, actor); return { order: ctx.order, checkout: await dto(client, ctx) }; }
      const p = (await client.query('SELECT * FROM ng_pharmacies WHERE id=$1', [id(input.pharmacyId)])).rows[0];
      if (!p) throw fail(404, 'Pharmacy not found.');
      pharmacyValid(p);
      if (input.deliveryType && input.deliveryType !== 'pickup') throw fail(422, 'Start with collection; choose delivery after the pharmacy confirms the medicines.');
      if (!!input.digitalPrescriptionId === !!input.prescriptionId) throw fail(422, 'Select one verified prescription.');
      let rxItems;
      if (input.digitalPrescriptionId) {
        const rx = (await client.query('SELECT * FROM ng_digital_prescriptions WHERE id=$1 FOR UPDATE', [id(input.digitalPrescriptionId)])).rows[0];
        if (!rx || rx.patient_user_id !== patient.id || !rx.signed_at || !['sent_to_pharmacy', 'received'].includes(rx.lifecycle_status) || rx.routed_pharmacy_id !== p.id || dayEnd(rx.expires_at) <= now()) throw fail(409, 'Choose a current signed prescription routed to this pharmacy.');
        if (rx.is_controlled) throw fail(422, 'Controlled medicines require the existing supervised dispensing process.');
        if ((await client.query('SELECT 1 FROM ng_medication_fulfillments WHERE digital_prescription_id=$1 AND prescription_claim_active=true', [rx.id])).rows.length) throw fail(409, 'This prescription already has an active medication order.');
        rxItems = (await client.query("SELECT drug_id,quantity FROM ng_rx_items WHERE prescription_id=$1 AND status IN ('pending','available') AND fulfillment_order_id IS NULL FOR UPDATE", [rx.id])).rows;
      } else {
        const rx = (await client.query('SELECT * FROM ng_prescriptions WHERE id=$1 FOR UPDATE', [id(input.prescriptionId)])).rows[0];
        if (!rx || rx.patient_user_id !== patient.id || !rx.verified_by_pharmacist || !rx.verified_at || !['verified', 'matched'].includes(rx.status) || new Date(rx.expires_at).getTime() <= now() || rx.is_controlled_substance) throw fail(409, 'A current pharmacist-verified prescription is required.');
        if ((await client.query("SELECT 1 FROM ng_orders WHERE prescription_id=$1 AND status NOT IN ('cancelled','refunded')", [rx.id])).rows.length) throw fail(409, 'This prescription already has an order.');
        if (rx.verified_by_pharmacist !== p.owner_user_id) throw fail(409, 'Use the pharmacy that verified the uploaded prescription.');
        rxItems = Array.isArray(rx.items) ? rx.items.map(it => ({ drug_id: it.drug_id || it.drugId, quantity: it.quantity })) : [];
      }
      if (!Array.isArray(input.items) || !input.items.length || input.items.length > 30) throw fail(422, 'Choose prescription items.');
      if (input.items.length !== new Set(rxItems.map(it => it.drug_id)).size) throw fail(422, 'Include every verified prescription item in this checkout. Partial dispensing requires pharmacy review.');
      const wanted = [...input.items].sort((a, b) => String(a.drugId).localeCompare(String(b.drugId)));
      if (new Set(wanted.map(it => it.drugId)).size !== wanted.length) throw fail(422, 'Duplicate medicine items are not allowed.');
      const items = []; const reservations = [];
      for (const it of wanted) {
        id(it.drugId);
        const prescribed = rxItems.filter(r => r.drug_id === it.drugId).reduce((n, r) => n + Number(r.quantity || 0), 0);
        if (!Number.isInteger(it.quantity) || it.quantity < 1 || it.quantity > 10000 || it.quantity !== prescribed) throw fail(422, 'Medicine quantities must match the verified prescription.');
        const drug = (await client.query('SELECT * FROM ng_drug_catalog WHERE id=$1 AND is_active=true', [it.drugId])).rows[0];
        if (!drug || drug.category === 'controlled' || drug.schedule) throw fail(422, 'This medicine requires supervised dispensing outside courier checkout.');
        const stock = (await client.query("SELECT * FROM ng_pharmacy_inventory WHERE pharmacy_id=$1 AND drug_id=$2 AND is_available=true AND availability_verification_status='verified' AND availability_verified_at IS NOT NULL AND expiry_date>CURRENT_DATE AND quantity_available>0 ORDER BY expiry_date,id FOR UPDATE", [p.id, it.drugId])).rows;
        let remaining = it.quantity;
        for (const batch of stock) { const take = Math.min(remaining, batch.quantity_available); if (take) { reservations.push({ inventoryId: batch.id, quantity: take }); remaining -= take; } if (!remaining) break; }
        if (remaining) throw fail(409, 'The pharmacy must verify sufficient unexpired stock before checkout.');
        const unit = decimalToMinor(stock[0].selling_price);
        items.push({ drug_id: it.drugId, name: drug.name, quantity: it.quantity, unitPriceMinor: unit, lineTotalMinor: assertMinor((BigInt(it.quantity) * BigInt(unit)).toString()) });
      }
      const medicines = checkedSum(items.map(it => it.lineTotalMinor));
      const orderId = crypto.randomUUID();
      const order = (await client.query(`INSERT INTO ng_orders(id,order_number,patient_user_id,pharmacy_id,prescription_id,items,subtotal,platform_fee,delivery_fee,vat_amount,total_amount,delivery_type,status,payment_status,pharmacy_payout_amount)
        VALUES($1,$2,$3,$4,$5,$6,$7,0,0,0,$7,'pickup','pending','pending',$7) RETURNING *`, [orderId, `DRX-${crypto.randomBytes(8).toString('hex')}`, patient.id, p.id, input.prescriptionId || null, JSON.stringify(items), minorToDecimalString(medicines)])).rows[0];
      await client.query('INSERT INTO ng_medication_fulfillments(order_id,create_key,create_digest,digital_prescription_id,medicines_minor) VALUES($1,$2,$3,$4,$5)', [orderId, createKey, digest, input.digitalPrescriptionId || null, medicines]);
      if (input.digitalPrescriptionId) await client.query("UPDATE ng_rx_items SET fulfillment_order_id=$1 WHERE prescription_id=$2 AND drug_id=ANY($3::uuid[]) AND status IN ('pending','available') AND fulfillment_order_id IS NULL", [orderId, input.digitalPrescriptionId, items.map(it => it.drug_id)]);
      for (const r of reservations) {
        await client.query('UPDATE ng_pharmacy_inventory SET quantity_available=quantity_available-$1,quantity_reserved=COALESCE(quantity_reserved,0)+$1,updated_at=now() WHERE id=$2', [r.quantity, r.inventoryId]);
        await client.query('INSERT INTO ng_medication_reservations(order_id,inventory_id,quantity) VALUES($1,$2,$3)', [orderId, r.inventoryId, r.quantity]);
      }
      await audit(client, order, patient, 'created');
      return { order, checkout: await dto(client, await load(client, orderId, actor)) };
    });
  }
  async function getCheckout(orderId, actor) { return tx(async client => { const ctx = await load(client, orderId, actor); await audit(client, ctx.order, ctx.actor, 'checkout_viewed'); return dto(client, ctx); }); }
  async function setFulfillment(orderId, actor, input) {
    return operation(orderId, actor, input, 'fulfillment_selected', { patient: true }, async (client, ctx) => {
      await pendingPayments(client, orderId);
      if (await hasBooking(client, orderId) || ctx.f.delivery_approval) throw fail(409, 'Reconcile the approved delivery before changing fulfilment.');
      if (!['pickup', 'delivery'].includes(input.deliveryType) || input.consent !== true) throw fail(422, 'Confirm the fulfilment choice.');
      let envelope = null;
      if (input.deliveryType === 'delivery') {
        if (!provider.getAvailability().available) throw fail(503, 'Medicine delivery is awaiting approved courier activation. Collection is available.');
        if (!env.ENCRYPTION_KEY || !process.env.ENCRYPTION_KEY) throw fail(503, 'Secure delivery address storage is not configured.');
        if (input.contactConsent !== true) throw fail(422, 'Authorize sharing your delivery contact with the courier.');
        if (ctx.f.package_category && ctx.f.package_category !== 'sealed_ambient_medication') throw fail(422, 'This medication category is available for collection only.');
        envelope = encrypt(JSON.stringify(address(input.address)));
      }
      await client.query('UPDATE ng_orders SET delivery_type=$1,delivery_address=NULL,delivery_fee=0,updated_at=now() WHERE id=$2', [input.deliveryType, orderId]);
      await client.query('UPDATE ng_medication_fulfillments SET address_encrypted=$1,fulfillment_consent_at=now(),contact_consent_at=CASE WHEN $2 THEN now() ELSE NULL END,current_quote_id=NULL,delivery_approval=NULL WHERE order_id=$3', [envelope ? JSON.stringify(envelope) : null, input.deliveryType === 'delivery', orderId]);
    });
  }
  async function confirmPrice(orderId, actor, input) {
    return operation(orderId, actor, input, 'pharmacy_price_confirmed', { pharmacy: true }, async (client, ctx) => {
      pharmacyValid(ctx.p); await rxValid(client, ctx); await pendingPayments(client, orderId);
      if (ctx.f.pharmacy_confirmed_at || ctx.f.medicines_approval) throw fail(409, 'The confirmed medication price is locked.');
      if (input.attest !== true || input.pharmacistRegistrationNumber !== ctx.p.superintendent_pcn_number) throw fail(403, 'The registered superintendent pharmacist must verify these medicines.');
      if (!['sealed_ambient_medication', 'cold_chain', 'restricted'].includes(input.packageCategory)) throw fail(422, 'Classify the medication handling requirements.');
      if (input.packageCategory === 'sealed_ambient_medication') await categoryValid(client, { ...ctx, f: { ...ctx.f, package_category: input.packageCategory } });
      if (ctx.order.delivery_type === 'delivery' && input.packageCategory !== 'sealed_ambient_medication') throw fail(422, 'These medicines require collection or a separately approved specialist courier.');
      if (!Array.isArray(input.items) || input.items.length !== ctx.order.items.length || new Set(input.items.map(it => it.drugId)).size !== input.items.length) throw fail(422, 'Confirm the price of every ordered medicine exactly once.');
      const items = ctx.order.items.map(it => {
        const match = input.items.find(row => row.drugId === it.drug_id);
        if (!match) throw fail(422, 'The confirmed medicine list does not match this order.');
        const unit = assertMinor(match.unitPriceMinor);
        return { ...it, unitPriceMinor: unit, lineTotalMinor: assertMinor((BigInt(unit) * BigInt(it.quantity)).toString()) };
      });
      const total = checkedSum(items.map(it => it.lineTotalMinor));
      if (total < 1) throw fail(422, 'A positive final medicine price is required.');
      await client.query('UPDATE ng_orders SET items=$1,subtotal=$2,total_amount=$2,pharmacy_payout_amount=$2,updated_at=now() WHERE id=$3', [JSON.stringify(items), minorToDecimalString(total), orderId]);
      await client.query('UPDATE ng_medication_fulfillments SET medicines_minor=$1,pharmacy_confirmed_at=now(),pharmacist_user_id=$2,pharmacist_registration=$3,package_category=$4 WHERE order_id=$5', [total, ctx.actor.id, input.pharmacistRegistrationNumber, input.packageCategory, orderId]);
    });
  }
  async function approve(orderId, actor, input) {
    return operation(orderId, actor, input, `approved_${input.stage}`, { patient: true }, async (client, ctx) => {
      if (input.consent !== true || !['medicines', 'delivery'].includes(input.stage)) throw fail(422, 'Explicit approval of the itemized charges is required.');
      if (!ctx.f.pharmacy_confirmed_at) throw fail(409, 'The pharmacy must confirm the final medicine prices first.');
      await pendingPayments(client, orderId);
      const q = await quoteRow(client, ctx.f);
      if (input.stage === 'delivery') {
        if (ctx.f.delivery_repricing_refund_required) throw fail(409, 'Confirm the earlier delivery payment refund before approving a fresh quote.');
        if (!ctx.f.pharmacy_ready_at || !(await paid(client, ctx, 'medicines')) || !q || q.id !== input.quoteId || new Date(q.expires_at).getTime() <= now() + 30000) throw fail(409, 'Approve a fresh quote after medicines are ready and paid.');
      }
      const price = pricing(ctx, input.stage === 'medicines' && q && new Date(q.expires_at).getTime() <= now() ? null : q);
      const amount = stageAmounts(price, input.stage);
      if (amount.insurerMinor > 0) {
        const insurer = ctx.f.coverage.partnerId && (await client.query('SELECT * FROM ng_insurance_partners WHERE id=$1', [ctx.f.coverage.partnerId])).rows[0];
        if (!insurer || insurer.onboarding_status !== 'live' || !insurer.contract_reference || !insurer.activation_evidence_reference || insurer.capabilities_json?.medication_orders !== true || !(Date.parse(ctx.f.coverage.expiresAt) > now()) || (input.stage === 'delivery' && insurer.capabilities_json?.medication_delivery !== true)) throw fail(409, 'Current insurer benefit authorization is required before approving this payer allocation.');
      }
      const approval = { ...amount, coverageAuthorizationReference: price.coverageAuthorizationReference, quoteId: input.stage === 'delivery' ? q.id : null, approvedAt: new Date(now()).toISOString() };
      await client.query(`UPDATE ng_medication_fulfillments SET ${input.stage === 'medicines' ? 'medicines_approval' : 'delivery_approval'}=$1 WHERE order_id=$2`, [JSON.stringify(approval), orderId]);
      await finance().postCoverage(client, { orderId, stage: input.stage, approval });
    });
  }
  async function confirmPharmacy(orderId, actor, input) {
    return operation(orderId, actor, input, 'preparation_started', { pharmacy: true }, async (client, ctx) => {
      pharmacyValid(ctx.p); await rxValid(client, ctx);
      if (!ctx.f.pharmacy_confirmed_at || ctx.order.status !== 'pending' || !(await paid(client, ctx, 'medicines'))) throw fail(409, 'Verify the medicine payment or authorized coverage before preparation.');
      await client.query("UPDATE ng_orders SET status='preparing',updated_at=now() WHERE id=$1", [orderId]);
    });
  }
  async function markReady(orderId, actor, input) {
    return operation(orderId, actor, input, 'pharmacy_ready', { pharmacy: true }, async (client, ctx) => {
      pharmacyValid(ctx.p); await rxValid(client, ctx);
      if (ctx.order.status !== 'preparing' || input.attest !== true || !(await paid(client, ctx, 'medicines'))) throw fail(409, 'A pharmacist must verify the prepared, paid medicines.');
      await stockValid(client, orderId);
      await client.query('UPDATE ng_medication_fulfillments SET pharmacy_ready_at=now() WHERE order_id=$1', [orderId]);
      await client.query("UPDATE ng_orders SET status='ready_for_pickup',updated_at=now() WHERE id=$1", [orderId]);
    });
  }
  async function requestQuote(orderId, actor, input) {
    // The quote request stays under the order lock. It has a bounded timeout and
    // cannot dispatch or collect money. This binds it to this exact address/version.
    let refundDelivery = false;
    const result = await operation(orderId, actor, input, 'courier_quoted', { patient: true }, async (client, ctx) => {
      pharmacyValid(ctx.p); await rxValid(client, ctx); await categoryValid(client, ctx); await pendingPayments(client, orderId);
      await stockValid(client, orderId);
      if (ctx.order.delivery_type !== 'delivery' || !ctx.f.pharmacy_ready_at || !(await paid(client, ctx, 'medicines')) || await hasBooking(client, orderId)) throw fail(409, 'The pharmacy must have the paid medicines ready before a courier quote.');
      const q = await provider.getQuote(providerInput(ctx));
      const previousPaid = assertMinor((await client.query("SELECT COALESCE(sum(amount_minor),0)::text AS amount FROM ng_medication_payment_attempts WHERE order_id=$1 AND stage='delivery' AND status='verified'", [orderId])).rows[0].amount);
      const newPatientMinor = stageAmounts(pricing(ctx, { normalized: q }), 'delivery').patientMinor;
      refundDelivery = previousPaid > newPatientMinor;
      const result = await client.query(`INSERT INTO ng_medication_quotes(order_id,provider,provider_quote_id,fare_minor,currency,expires_at,request_fingerprint,normalized)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`, [orderId, q.provider, q.providerQuoteId, assertMinor(q.feeMinor), q.currency, q.expiresAt, q.requestFingerprint, JSON.stringify(q)]);
      await client.query('UPDATE ng_medication_fulfillments SET current_quote_id=$1,delivery_approval=NULL,delivery_repricing_refund_required=$2 WHERE order_id=$3', [result.rows[0].id, refundDelivery, orderId]);
    });
    if (refundDelivery) { await finance().refundDeliveryStage(orderId, 'delivery_quote_repriced'); return getCheckout(orderId, actor); }
    return result;
  }
  function expectedEnvironment() { const secret = env.PAYSTACK_SECRET_KEY || ''; if (!/^sk_(?:test|live)_/.test(secret)) throw fail(503, 'Verified payment processing is not configured.'); if (secret.startsWith('sk_live_') && env.NG_PAYSTACK_LIVE_APPROVED !== 'true') throw fail(503, 'The medication payment merchant must be approved for activation.'); if (env.NODE_ENV === 'production' && !secret.startsWith('sk_live_')) throw fail(503, 'Live payment processing must be configured for production.'); return secret.startsWith('sk_live_') ? 'live' : 'test'; }
  async function initiatePayment(orderId, actor, input) {
    if (env.NG_MEDICATION_CHECKOUT_ENABLED !== 'true') throw fail(503, 'Medication payment checkout is awaiting merchant activation.');
    key(input.idempotencyKey);
    const environment = expectedEnvironment();
    const reserved = await tx(async client => {
      const ctx = await load(client, orderId, actor, { lock: true, patient: true });
      const stage = input.stage;
      if (!['medicines', 'delivery'].includes(stage) || !ctx.f[`${stage}_approval`] || ctx.f.cancellation_requested_at || ['cancelled', 'refunded', 'delivered'].includes(ctx.order.status)) throw fail(409, 'Approve the current itemized charges before payment.');
      const approval = ctx.f[`${stage}_approval`];
      if (stage === 'delivery' && ctx.f.delivery_repricing_refund_required) throw fail(409, 'The previous delivery payment must be refunded before checkout.');
      if (stage === 'delivery') { const q = await quoteRow(client, ctx.f); if (!q || q.id !== approval.quoteId || new Date(q.expires_at).getTime() <= now() + 60000 || !ctx.f.pharmacy_ready_at || !(await paid(client, ctx, 'medicines'))) throw fail(409, 'The courier quote expired. Request and approve a fresh quote.'); }
      if (await paid(client, ctx, stage)) throw fail(409, 'This payment stage is already covered.');
      const approvalDigest = hash(approval);
      const old = (await client.query('SELECT * FROM ng_medication_payment_attempts WHERE order_id=$1 AND stage=$2 AND approval_digest=$3', [orderId, stage, approvalDigest])).rows[0];
      if (old) return { attempt: old, existing: true };
      await pendingPayments(client, orderId);
      const already = assertMinor((await client.query("SELECT COALESCE(sum(amount_minor),0)::text AS amount FROM ng_medication_payment_attempts WHERE order_id=$1 AND stage=$2 AND status='verified'", [orderId, stage])).rows[0].amount);
      const amount = approval.patientMinor - already;
      if (!Number.isSafeInteger(amount) || amount <= 0) throw fail(409, 'The payment difference requires refund reconciliation.');
      const reference = `DRX-MED-${crypto.randomUUID()}`;
      const attempt = (await client.query("INSERT INTO ng_medication_payment_attempts(order_id,stage,approval_digest,provider_reference,amount_minor,status) VALUES($1,$2,$3,$4,$5,'initializing') RETURNING *", [orderId, stage, approvalDigest, reference, amount])).rows[0];
      await audit(client, ctx.order, ctx.actor, 'payment_reserved', { stage, reference, amountMinor: amount, environment });
      return { attempt, email: ctx.actor.email, existing: false };
    });
    const a = reserved.attempt;
    if (reserved.existing) {
      if (a.status === 'pending' && a.authorization_url) return { provider: 'paystack', reference: a.provider_reference, authorizationUrl: a.authorization_url, stage: a.stage };
      throw fail(409, 'This payment attempt needs verification or reconciliation before another payment.');
    }
    try {
      const appUrl = new URL(env.NEXT_PUBLIC_APP_URL);
      if (env.NODE_ENV === 'production' && appUrl.protocol !== 'https:') throw fail(503, 'A secure payment return URL is required.');
      const result = await gateway.initializeTransaction({ email: reserved.email, amount: assertMinor(a.amount_minor), reference: a.provider_reference, callbackUrl: `${appUrl.origin}/ng/patient/orders?ref=${encodeURIComponent(a.provider_reference)}&order=${orderId}`, metadata: { medication_order_id: orderId, stage: a.stage } });
      const url = new URL(result.data?.authorization_url);
      if (url.protocol !== 'https:' || url.hostname !== 'checkout.paystack.com' || result.data.reference !== a.provider_reference) throw fail(502, 'The payment checkout could not be verified.');
      await pool.query("UPDATE ng_medication_payment_attempts SET status='pending',authorization_url=$1,updated_at=now() WHERE id=$2 AND status='initializing'", [url.href, a.id]);
      const current = (await pool.query('SELECT o.status,f.cancellation_requested_at FROM ng_orders o JOIN ng_medication_fulfillments f ON f.order_id=o.id WHERE o.id=$1', [orderId])).rows[0];
      if (current.cancellation_requested_at || ['cancelled', 'refunded'].includes(current.status)) throw fail(409, 'This checkout was cancelled before payment initialization completed.');
      return { provider: 'paystack', reference: a.provider_reference, authorizationUrl: url.href, stage: a.stage };
    } catch (error) { await pool.query("UPDATE ng_medication_payment_attempts SET status='reconciliation_required',updated_at=now() WHERE id=$1 AND status='initializing'", [a.id]); throw fail(error.status || 503, 'Payment initialization could not be confirmed. Verify this reference before trying again.'); }
  }
  async function confirmPaymentReference(reference) {
    if (typeof reference !== 'string' || !/^DRX-MED-[0-9a-f-]{36}$/.test(reference)) throw fail(400, 'Invalid medication payment reference.');
    const result = await gateway.verifyTransaction(reference);
    const data = result.data;
    const environment = expectedEnvironment();
    const outcome = await tx(async client => {
      const initial = (await client.query('SELECT order_id FROM ng_medication_payment_attempts WHERE provider_reference=$1', [reference])).rows[0];
      if (!initial) throw fail(404, 'Payment not found.');
      const ctx = await load(client, initial.order_id, null, { lock: true, system: true });
      const attempt = (await client.query('SELECT * FROM ng_medication_payment_attempts WHERE provider_reference=$1 FOR UPDATE', [reference])).rows[0];
      if (['refund_pending', 'refunded'].includes(attempt.status)) return { orderId: attempt.order_id, status: attempt.status };
      const externalHold = (await client.query("SELECT 1 FROM ng_medication_events WHERE order_id=$1 AND action='external_refund_reconciliation_required' AND details->>'paymentReference'=$2 LIMIT 1", [attempt.order_id, reference])).rows.length;
      if (externalHold || (attempt.status === 'reconciliation_required' && attempt.verified_at)) return { orderId: attempt.order_id, status: 'reconciliation_required' };
      const transactionIdValid = data && (typeof data.id === 'number' && Number.isSafeInteger(data.id) && data.id > 0 || typeof data.id === 'string' && /^[1-9]\d{0,19}$/.test(data.id));
      const evidenceMatches = result.status === true && transactionIdValid && data.reference === reference && data.currency === 'NGN' && data.domain === environment && Number.isSafeInteger(data.amount) && data.amount === assertMinor(attempt.amount_minor);
      if (!evidenceMatches || (attempt.status === 'verified' && data.status !== 'success')) {
        if (attempt.status === 'verified') {
          await client.query("UPDATE ng_medication_payment_attempts SET status='reconciliation_required',updated_at=now() WHERE id=$1", [attempt.id]);
          await client.query("UPDATE ng_orders SET payment_status='reconciliation',updated_at=now() WHERE id=$1", [attempt.order_id]);
          await audit(client, ctx.order, null, 'payment_evidence_changed', { reference, stage: attempt.stage });
          return { orderId: attempt.order_id, status: 'reconciliation_required' };
        }
        throw fail(409, 'Payment evidence does not match this order, amount or environment.');
      }
      if (attempt.status === 'verified') return { orderId: attempt.order_id, status: attempt.status };
      if (data.status !== 'success') {
        // A declined or abandoned hosted checkout may still be retried by its
        // owner. Resume that reference; never issue a second collectible URL.
        if (['failed', 'abandoned'].includes(data.status)) await client.query("UPDATE ng_medication_payment_attempts SET status=CASE WHEN authorization_url IS NOT NULL THEN 'pending' ELSE 'reconciliation_required' END,updated_at=now() WHERE id=$1", [attempt.id]);
        else if (data.status === 'reversed') await client.query("UPDATE ng_medication_payment_attempts SET status='reconciliation_required',updated_at=now() WHERE id=$1", [attempt.id]);
        return { orderId: attempt.order_id, status: data.status };
      }
      const approval = ctx.f[`${attempt.stage}_approval`];
      if (!approval || hash(approval) !== attempt.approval_digest || !data.id || !Number.isSafeInteger(data.fees) || data.fees < 0 || data.fees > data.amount) throw fail(409, 'Payment requires financial reconciliation.');
      await client.query("UPDATE ng_medication_payment_attempts SET status='verified',provider_transaction_id=$1,processing_cost_minor=$2,verified_at=now(),updated_at=now() WHERE id=$3", [String(data.id), data.fees, attempt.id]);
      await finance().postPayment(client, { orderId: attempt.order_id, payment: attempt, approval, verification: { verified: true, reference: data.reference, currency: data.currency, amountMinor: data.amount, environment: data.domain, processingCostMinor: data.fees, transactionId: String(data.id), raw: data } });
      if (attempt.stage === 'medicines') await client.query("UPDATE ng_orders SET payment_status='completed',payment_provider='paystack',payment_reference=$1,paid_at=now(),updated_at=now() WHERE id=$2", [reference, attempt.order_id]);
      await client.query('UPDATE ng_medication_fulfillments SET version=version+1,updated_at=now() WHERE order_id=$1', [attempt.order_id]);
      await audit(client, ctx.order, null, 'payment_verified', { reference, stage: attempt.stage, amountMinor: data.amount, processingCostMinor: data.fees });
      return { orderId: attempt.order_id, status: 'verified' };
    });
    if ((await pool.query('SELECT status FROM ng_orders WHERE id=$1', [outcome.orderId])).rows[0]?.status === 'cancelled' && outcome.status === 'verified') await finance().refundOrder(outcome.orderId, 'order_cancelled');
    return outcome;
  }
  async function verifyPayment(orderId, actor, reference) {
    await tx(async client => { await load(client, orderId, actor, { patient: true }); if (!(await client.query('SELECT 1 FROM ng_medication_payment_attempts WHERE order_id=$1 AND provider_reference=$2', [orderId, reference])).rows.length) throw fail(404, 'Payment not found.'); });
    await confirmPaymentReference(reference);
    // A late payment for a cancelled order must be refunded, never dispatched.
    const state = (await pool.query('SELECT status FROM ng_orders WHERE id=$1', [orderId])).rows[0];
    if (state.status === 'cancelled') await finance().refundOrder(orderId, 'order_cancelled');
    return getCheckout(orderId, actor);
  }
  async function persistStatus(client, ctx, booking, result) {
    if (result.currency !== 'NGN' || (booking.provider_delivery_id && booking.provider_delivery_id !== result.providerDeliveryId)) throw fail(409, 'Courier evidence does not match this delivery.');
    const q = (await client.query('SELECT * FROM ng_medication_quotes WHERE id=$1', [booking.quote_id])).rows[0];
    if (result.providerQuoteId !== q.provider_quote_id || (result.externalId && result.externalId !== booking.id)) throw fail(409, 'Courier evidence is not bound to this approved quote and booking.');
    if (result.feeMinor !== assertMinor(q.fare_minor)) throw fail(409, 'The courier charge requires reconciliation against the approved quote.');
    const providerAt = result.updatedAt || result.occurredAt;
    if (booking.last_provider_at && providerAt && new Date(providerAt) < new Date(booking.last_provider_at)) return;
    if (['delivered', 'returned', 'cancelled'].includes(booking.status) && booking.status !== result.status) return;
    const progression = { booking: -1, reconciliation_required: -1, booking_failed: -1, booked: 0, courier_assigned: 1, picked_up: 2, in_transit: 3, proof_pending: 4, delivered: 5 };
    if (progression[result.status] !== undefined && progression[booking.status] !== undefined && progression[result.status] < progression[booking.status]) return;
    const pickupProof = result.pickup?.completedAt && result.pickup?.verification ? { recordedAt: result.pickup.completedAt, type: 'provider_verification', reference: result.providerDeliveryId } : null;
    const deliveryProof = result.dropoff?.completedAt && result.dropoff?.verification ? { recordedAt: result.dropoff.completedAt, type: 'provider_signature', reference: result.providerDeliveryId } : null;
    const handoverOccurred = !!result.pickup?.completedAt || !!booking.pickup_proof;
    const status = result.status === 'cancelled' && handoverOccurred ? 'return_pending' : result.status === 'delivered' && !deliveryProof ? 'proof_pending' : result.status;
    await client.query('UPDATE ng_medication_bookings SET provider_delivery_id=$1,status=$2,normalized=$3,pickup_proof=COALESCE($4,pickup_proof),delivery_proof=COALESCE($5,delivery_proof),last_provider_at=COALESCE($6,last_provider_at),updated_at=now() WHERE id=$7', [result.providerDeliveryId, status, JSON.stringify(result), pickupProof ? JSON.stringify(pickupProof) : null, deliveryProof ? JSON.stringify(deliveryProof) : null, providerAt || null, booking.id]);
    const orderStatus = status === 'delivered' ? 'delivered' : ['picked_up', 'in_transit', 'proof_pending','return_pending','returned'].includes(status) ? 'in_transit' : ['booked', 'courier_assigned'].includes(status) ? 'dispatched' : null;
    if (orderStatus) await client.query('UPDATE ng_orders SET status=$1::text::ng_order_status,delivery_tracking_id=$2,delivery_partner=$3,delivered_at=CASE WHEN $1::text=\'delivered\' THEN now() ELSE delivered_at END,updated_at=now() WHERE id=$4', [orderStatus, booking.id, 'uber_direct', ctx.order.id]);
    if (['picked_up', 'in_transit', 'proof_pending', 'delivered', 'returned','return_pending'].includes(status)) await consumeInventory(client, ctx.order.id);
    if (status === 'delivered' && deliveryProof) { await completePrescription(client, ctx.order.id); await finance().recognizeDelivery(client, { orderId: ctx.order.id, reference: result.providerDeliveryId }); }
    await client.query('UPDATE ng_medication_fulfillments SET version=version+1,updated_at=now() WHERE order_id=$1', [ctx.order.id]);
    await audit(client, ctx.order, null, 'courier_status_verified', { status, reference: result.providerDeliveryId });
  }
  async function dispatch(orderId, actor, input) {
    const intent = await tx(async client => {
      const ctx = await load(client, orderId, actor, { lock: true, pharmacy: true });
      key(input.idempotencyKey);
      const old = await hasBooking(client, orderId);
      if (old) return { old: true };
      if (ctx.f.cancellation_requested_at) throw fail(409, 'Cancellation is in progress; dispatch is blocked.');
      if (input.version !== ctx.f.version) throw fail(409, 'The order changed. Refresh before booking.');
      pharmacyValid(ctx.p); await rxValid(client, ctx); await categoryValid(client, ctx);
      await stockValid(client, orderId);
      const q = await quoteRow(client, ctx.f);
      if (ctx.order.status !== 'ready_for_pickup' || ctx.order.delivery_type !== 'delivery' || ctx.f.delivery_repricing_refund_required || !ctx.f.pharmacy_ready_at || !q || new Date(q.expires_at).getTime() <= now() + 30000 || ctx.f.delivery_approval?.quoteId !== q.id || !(await paid(client, ctx, 'medicines')) || !(await paid(client, ctx, 'delivery'))) throw fail(409, 'Ready medicines, a fresh approved quote and verified payment are required before dispatch.');
      const booking = (await client.query("INSERT INTO ng_medication_bookings(order_id,quote_id,idempotency_key,status) VALUES($1,$2,$3,'booking') RETURNING *", [orderId, q.id, `DRX-${crypto.randomUUID()}`])).rows[0];
      await audit(client, ctx.order, ctx.actor, 'dispatch_reserved', { bookingId: booking.id, quoteId: q.id });
      return { booking, quote: q.normalized, delivery: { id: booking.id, ...providerInput(ctx) } };
    });
    if (intent.old) return getCheckout(orderId, actor);
    try {
      const result = await provider.book({ quote: intent.quote, delivery: intent.delivery, idempotencyKey: intent.booking.idempotency_key });
      await tx(async client => { const ctx = await load(client, orderId, null, { lock: true, system: true }); await persistStatus(client, ctx, await hasBooking(client, orderId), result); });
    } catch (error) {
      // The persisted intent is never automatically rebooked, including after a
      // process crash or provider idempotency-window expiry.
      await pool.query("UPDATE ng_medication_bookings SET status=$1,updated_at=now() WHERE id=$2 AND provider_delivery_id IS NULL", [error.ambiguous === false ? 'booking_failed' : 'reconciliation_required', intent.booking.id]);
      throw fail(error.ambiguous === false ? 409 : 503, error.ambiguous === false
        ? 'The courier declined this booking. You can cancel the order to request a verified refund.'
        : 'Courier booking could not be confirmed. This booking is held for reconciliation; no second courier will be booked.');
    }
    return getCheckout(orderId, actor);
  }
  async function refresh(orderId, actor) {
    const booking = await tx(async client => { await load(client, orderId, actor); return hasBooking(client, orderId); });
    if (!booking?.provider_delivery_id) throw fail(409, 'The courier booking requires reconciliation before status refresh.');
    const result = await provider.getStatus(booking.provider_delivery_id);
    await tx(async client => { const ctx = await load(client, orderId, actor, { lock: true }); await persistStatus(client, ctx, await hasBooking(client, orderId), result); });
    return getCheckout(orderId, actor);
  }
  async function consumeInventory(client, orderId) {
    const f = (await client.query('SELECT inventory_released_at FROM ng_medication_fulfillments WHERE order_id=$1', [orderId])).rows[0];
    if (f.inventory_released_at) return;
    await client.query('UPDATE ng_pharmacy_inventory i SET quantity_reserved=quantity_reserved-r.quantity,updated_at=now() FROM ng_medication_reservations r WHERE r.order_id=$1 AND i.id=r.inventory_id', [orderId]);
    await client.query('UPDATE ng_medication_fulfillments SET inventory_released_at=now() WHERE order_id=$1', [orderId]);
    await finalizePrescription(client, orderId);
  }
  async function finalizePrescription(client, orderId) {
    const f = (await client.query('SELECT * FROM ng_medication_fulfillments WHERE order_id=$1', [orderId])).rows[0];
    const order = (await client.query('SELECT * FROM ng_orders WHERE id=$1', [orderId])).rows[0];
    const rxWorkflow = require('../rx-engine/prescriptionWorkflowService');
    if (f.digital_prescription_id) {
      const rx = (await client.query('SELECT * FROM ng_digital_prescriptions WHERE id=$1 FOR UPDATE', [f.digital_prescription_id])).rows[0];
      const actor = { kind: 'pharmacist', user_id: f.pharmacist_user_id };
      if (['cancelled', 'expired'].includes(rx.lifecycle_status)) { await audit(client, order, null, 'handover_requires_clinical_review', { prescriptionId: rx.id }); return; }
      if (rx.lifecycle_status === 'sent_to_pharmacy') await rxWorkflow.acknowledgeReceipt(rx.id, actor, client);
      const rows = (await client.query('SELECT * FROM ng_rx_items WHERE prescription_id=$1 AND fulfillment_order_id=$2 ORDER BY position FOR UPDATE', [rx.id, orderId])).rows;
      for (const item of rows) {
        if (item.status === 'dispensed') continue;
        const requested = order.items.find(it => it.drug_id === item.drug_id);
        if (!requested) throw fail(409, 'Prescription handover requires reconciliation.');
        await rxWorkflow.dispenseItem(rx.id, item.id, actor, { quantity: Math.min(requested.quantity, item.quantity), pharmacy_id: order.pharmacy_id, fulfillment_order_id: orderId }, client);
      }
    } else if (order.prescription_id) await client.query("UPDATE ng_prescriptions SET status='dispensed',updated_at=now() WHERE id=$1", [order.prescription_id]);
  }
  async function completePrescription(client, orderId) {
    const f = (await client.query('SELECT digital_prescription_id,pharmacist_user_id FROM ng_medication_fulfillments WHERE order_id=$1', [orderId])).rows[0];
    if (!f.digital_prescription_id) return;
    const rx = (await client.query('SELECT lifecycle_status FROM ng_digital_prescriptions WHERE id=$1 FOR UPDATE', [f.digital_prescription_id])).rows[0];
    if (rx.lifecycle_status === 'fully_dispensed') await require('../rx-engine/prescriptionWorkflowService').complete(f.digital_prescription_id, { kind: 'pharmacist', user_id: f.pharmacist_user_id }, client);
  }
  async function collect(orderId, actor, input) {
    return operation(orderId, actor, input, 'collected', { pharmacy: true }, async (client, ctx) => {
      pharmacyValid(ctx.p); await rxValid(client, ctx);
      await stockValid(client, orderId);
      if (ctx.order.delivery_type !== 'pickup' || !ctx.f.pharmacy_ready_at || !(await paid(client, ctx, 'medicines')) || input.attest !== true) throw fail(409, 'Confirm handover of the verified, paid medicines to the patient.');
      await consumeInventory(client, orderId);
      await completePrescription(client, orderId);
      await client.query('UPDATE ng_medication_fulfillments SET collected_at=now() WHERE order_id=$1', [orderId]);
      await client.query("UPDATE ng_orders SET status='delivered',delivered_at=now(),updated_at=now() WHERE id=$1", [orderId]);
    });
  }
  async function cancel(orderId, actor, input) {
    key(input.idempotencyKey);
    const booking = await tx(async client => { const ctx = await load(client, orderId, actor, { lock: true }); if (ctx.order.status === 'cancelled') return null; if (['delivered', 'refunded', 'in_transit'].includes(ctx.order.status)) throw fail(409, 'This order requires a pharmacy return review.'); const b = await hasBooking(client, orderId); if (b && !['booked', 'courier_assigned', 'cancelled'].includes(b.status) && !(b.status === 'booking_failed' && !b.provider_delivery_id)) throw fail(409, 'Resolve the courier booking before cancellation.'); await client.query('UPDATE ng_medication_fulfillments SET cancellation_requested_at=COALESCE(cancellation_requested_at,now()) WHERE order_id=$1', [orderId]); if (!ctx.f.cancellation_requested_at) await audit(client, ctx.order, ctx.actor, 'cancellation_requested'); if (b?.provider_delivery_id && b.status !== 'cancelled') await client.query('UPDATE ng_medication_bookings SET cancellation_requested_at=now() WHERE id=$1', [b.id]); return b; });
    if (booking?.provider_delivery_id && booking.status !== 'cancelled') {
      const result = await provider.cancel(booking.provider_delivery_id);
      if (result.status !== 'cancelled') throw fail(409, 'Courier cancellation is not confirmed. No refund has been marked complete.');
      await tx(async client => { const ctx = await load(client, orderId, actor, { lock: true }); await persistStatus(client, ctx, await hasBooking(client, orderId), result); });
    }
    await tx(async client => {
      const ctx = await load(client, orderId, actor, { lock: true });
      if (ctx.order.status === 'cancelled') return;
      const currentBooking = await hasBooking(client, orderId);
      if (currentBooking && currentBooking.status !== 'cancelled' && !(currentBooking.status === 'booking_failed' && !currentBooking.provider_delivery_id)) throw fail(409, 'A courier booking or pickup must be resolved before cancellation.');
      if (['in_transit', 'delivered', 'refunded'].includes(ctx.order.status)) throw fail(409, 'Courier pickup requires a return review.');
      if (!ctx.f.inventory_released_at) {
        await client.query('UPDATE ng_pharmacy_inventory i SET quantity_available=quantity_available+r.quantity,quantity_reserved=quantity_reserved-r.quantity,updated_at=now() FROM ng_medication_reservations r WHERE r.order_id=$1 AND i.id=r.inventory_id', [orderId]);
        await client.query('UPDATE ng_medication_fulfillments SET inventory_released_at=now(),prescription_claim_active=false WHERE order_id=$1', [orderId]);
        await client.query('UPDATE ng_rx_items SET fulfillment_order_id=NULL WHERE fulfillment_order_id=$1 AND status NOT IN (\'dispensed\',\'cancelled\')', [orderId]);
      }
      await client.query("UPDATE ng_orders SET status='cancelled',cancellation_reason=$1,updated_at=now() WHERE id=$2", [String(input.reason || 'Cancellation requested').slice(0, 500), orderId]);
      await client.query('UPDATE ng_medication_fulfillments SET version=version+1,updated_at=now() WHERE order_id=$1', [orderId]);
      await audit(client, ctx.order, ctx.actor, 'cancelled');
    });
    await finance().refundOrder(orderId, 'order_cancelled');
    return getCheckout(orderId, actor);
  }
  async function getTracking(trackingId, actor) {
    return tx(async client => {
      const b = (await client.query('SELECT * FROM ng_medication_bookings WHERE id=$1', [id(trackingId)])).rows[0];
      if (!b) throw fail(404, 'Delivery not found.');
      const ctx = await load(client, b.order_id, actor, { patient: true });
      await audit(client, ctx.order, ctx.actor, 'tracking_viewed');
      const checkout = await dto(client, ctx);
      const events = (await client.query("SELECT action,created_at,details->>'status' AS status FROM ng_medication_events WHERE order_id=$1 AND action IN ('courier_status_verified','pharmacy_ready','cancelled') ORDER BY id", [b.order_id])).rows;
      return { ...checkout.delivery, orderId: b.order_id, orderNumber: ctx.order.order_number, events, pricing: checkout.pricing, payment: checkout.payment };
    });
  }
  async function acceptCourierWebhook(raw, headers) {
    const event = provider.verifyWebhook(raw, headers);
    return tx(async client => {
      const receipt = (await client.query('INSERT INTO ng_courier_webhook_receipts(provider,event_id,digest) VALUES($1,$2,$3) ON CONFLICT DO NOTHING RETURNING *', ['uber_direct', event.eventId, event.payloadDigest])).rows[0];
      if (!receipt) { const old = (await client.query('SELECT digest,status FROM ng_courier_webhook_receipts WHERE provider=$1 AND event_id=$2', ['uber_direct', event.eventId])).rows[0]; if (old.digest !== event.payloadDigest) throw fail(409, 'Courier event content does not match its receipt.'); if (old.status === 'processed') return { duplicate: true }; }
      const b = (await client.query('SELECT * FROM ng_medication_bookings WHERE provider_delivery_id=$1 OR id::text=$2', [event.providerDeliveryId, event.externalId || ''])).rows[0];
      if (!b) { await client.query("UPDATE ng_courier_webhook_receipts SET status='unmatched' WHERE provider=$1 AND event_id=$2", ['uber_direct', event.eventId]); return { accepted: true, matched: false }; }
      const ctx = await load(client, b.order_id, null, { lock: true, system: true });
      await persistStatus(client, ctx, await hasBooking(client, b.order_id), event);
      await client.query("UPDATE ng_courier_webhook_receipts SET status='processed' WHERE provider=$1 AND event_id=$2", ['uber_direct', event.eventId]);
      return { accepted: true, matched: true };
    });
  }
  async function getOrderOptions(actor) {
    return tx(async client => {
      const patient = await user(client, actor);
      const rows = (await client.query(`SELECT r.id,r.routed_pharmacy_id AS pharmacy_id,p.name AS pharmacy_name,
        jsonb_agg(jsonb_build_object('drugId',i.drug_id,'name',i.drug_name,'quantity',i.quantity) ORDER BY i.position) AS items
        FROM ng_digital_prescriptions r JOIN ng_pharmacies p ON p.id=r.routed_pharmacy_id JOIN ng_rx_items i ON i.prescription_id=r.id
        WHERE r.patient_user_id=$1 AND r.signed_at IS NOT NULL AND r.lifecycle_status IN ('sent_to_pharmacy','received') AND r.expires_at>=CURRENT_DATE
        AND p.status='approved' AND p.pcn_license_expiry>=CURRENT_DATE AND p.verified_at IS NOT NULL AND NOT r.is_controlled
        AND i.drug_id IS NOT NULL AND i.quantity>0 AND i.status IN ('pending','available')
        AND NOT EXISTS(SELECT 1 FROM ng_medication_fulfillments f WHERE f.digital_prescription_id=r.id AND f.prescription_claim_active=true)
        GROUP BY r.id,p.id ORDER BY r.created_at DESC LIMIT 30`, [patient.id])).rows;
      const uploaded = (await client.query(`SELECT r.id,r.items,p.id AS pharmacy_id,p.name AS pharmacy_name FROM ng_prescriptions r
        JOIN ng_pharmacies p ON p.owner_user_id=r.verified_by_pharmacist
        WHERE r.patient_user_id=$1 AND r.verified_at IS NOT NULL AND r.status IN ('verified','matched') AND r.expires_at>now()
        AND NOT r.is_controlled_substance AND p.status='approved' AND p.pcn_license_expiry>=CURRENT_DATE AND p.verified_at IS NOT NULL
        AND NOT EXISTS(SELECT 1 FROM ng_orders o WHERE o.prescription_id=r.id AND o.status NOT IN ('cancelled','refunded')) ORDER BY r.created_at DESC LIMIT 30`, [patient.id])).rows;
      return { prescriptions: [...rows.map(r => ({ id: r.id, kind: 'digital', pharmacyId: r.pharmacy_id, pharmacyName: r.pharmacy_name, items: r.items })),
        ...uploaded.map(r => ({ id: r.id, kind: 'uploaded', pharmacyId: r.pharmacy_id, pharmacyName: r.pharmacy_name, items: Array.isArray(r.items) ? r.items.filter(it => UUID.test(it.drug_id || it.drugId || '') && Number.isInteger(it.quantity) && it.quantity > 0).map(it => ({ drugId: it.drug_id || it.drugId, name: it.name || it.drug_name || 'Verified medicine', quantity: it.quantity })) : [] })).filter(r => r.items.length)] };
    });
  }
  async function admin(client, actor) { const account = await user(client, actor); if (!['admin', 'super_admin'].includes(account.role)) throw fail(403, 'Medication financial operations require platform administrator access.'); return account; }
  async function setCoverage(orderId, actor, input) {
    await tx(client => admin(client, actor));
    return operation(orderId, actor, input, 'coverage_authorized', {}, async (client, ctx) => {
      await admin(client, actor); await pendingPayments(client, orderId);
      if (await hasBooking(client, orderId) || ctx.f.delivery_approval) throw fail(409, 'Coverage is locked after delivery approval or booking.');
      const ref = value => { if (typeof value !== 'string' || !/^[A-Za-z0-9._:/ -]{3,250}$/.test(value)) throw fail(422, 'A documented authorization and evidence reference are required.'); return value; };
      const partner = (await client.query('SELECT * FROM ng_insurance_partners WHERE id=$1', [id(input.partnerId)])).rows[0];
      if (!partner || partner.onboarding_status !== 'live' || !partner.contract_reference || !partner.activation_evidence_reference || partner.capabilities_json?.medication_orders !== true) throw fail(409, 'This insurer is not contracted and activated for medication orders.');
      const expires = Date.parse(input.expiresAt);
      if (!Number.isFinite(expires) || expires <= now()) throw fail(422, 'A current benefit authorization expiry is required.');
      const coverage = { verified: true, partnerId: partner.id, authorizationReference: ref(input.authorizationReference), evidenceReference: ref(input.evidenceReference), expiresAt: new Date(expires).toISOString(), verifiedBy: ctx.actor.id, allocations: input.allocations || {} };
      if ((Number(coverage.allocations.courierMinor || 0) || Number(coverage.allocations.managementMinor || 0)) && partner.capabilities_json?.medication_delivery !== true) throw fail(409, 'Delivery coverage is not included in this insurer agreement.');
      const coordination = input.coordination || ctx.f.coordination;
      if (coordination.authorized === true && coordination.billable === true && coordination.includedElsewhere !== true && partner.capabilities_json?.coordination_fee !== true) throw fail(409, 'Separate coordination billing is not authorized by this agreement.');
      const q = await quoteRow(client, ctx.f);
      const price = buildPricing({ medicinesMinor: ctx.f.medicines_minor, deliveryType: ctx.order.delivery_type, quote: q?.normalized, coordination, coverage, now: now() });
      if (ctx.f.medicines_approval) {
        const current = stageAmounts(price, 'medicines');
        const old = ctx.f.medicines_approval;
        if (hash(current.allocations) !== hash(old.allocations) || (old.insurerMinor > 0 && old.coverageAuthorizationReference !== coverage.authorizationReference)) throw fail(409, 'The approved medicine payer allocation requires financial reconciliation before changing.');
      }
      await client.query('UPDATE ng_medication_fulfillments SET coverage=$1,coordination=$2 WHERE order_id=$3', [JSON.stringify(coverage), JSON.stringify(coordination), orderId]);
      await audit(client, ctx.order, ctx.actor, 'benefit_evidence_recorded', { partnerId: partner.id, authorizationReference: coverage.authorizationReference, evidenceReference: coverage.evidenceReference });
    });
  }
  async function listInsurancePartners(actor) {
    return tx(async client => { await admin(client, actor); const rows = (await client.query("SELECT id,display_name FROM ng_insurance_partners WHERE onboarding_status='live' AND contract_reference IS NOT NULL AND activation_evidence_reference IS NOT NULL AND capabilities_json->>'medication_orders'='true' ORDER BY display_name")).rows; return { partners: rows.map(r => ({ id: r.id, displayName: r.display_name })) }; });
  }
  async function adminReport(actor) {
    await tx(client => admin(client, actor));
    const rows = (await pool.query(`SELECT o.id AS "orderId",o.order_number AS "orderNumber",o.status,o.delivery_type AS "deliveryType",p.name AS "pharmacyName",f.version,
      f.pharmacy_confirmed_at AS "pharmacyConfirmedAt",f.pharmacy_ready_at AS "pharmacyReadyAt",b.status AS "deliveryStatus",
      CASE WHEN EXISTS(SELECT 1 FROM ng_medication_payment_attempts a WHERE a.order_id=o.id AND a.status='refund_pending') THEN 'refund_pending'
        WHEN EXISTS(SELECT 1 FROM ng_medication_payment_attempts a WHERE a.order_id=o.id AND a.status='refunded') THEN 'refunded' ELSE NULL END AS "refundStatus"
      FROM ng_orders o JOIN ng_medication_fulfillments f ON f.order_id=o.id JOIN ng_pharmacies p ON p.id=o.pharmacy_id LEFT JOIN ng_medication_bookings b ON b.order_id=o.id ORDER BY o.created_at DESC LIMIT 100`)).rows;
    return { orders: rows, couriers: provider.getAvailability(), report: { ...await finance().report(), settlementEnabled: env.NG_MEDICATION_SETTLEMENTS_ENABLED === 'true' } };
  }
  async function refreshRefunds(orderId, actor) { await tx(async client => { await admin(client, actor); await load(client, orderId, actor); }); await finance().refreshRefunds(orderId); return getCheckout(orderId, actor); }
  async function receiveReturn(orderId, actor, input) {
    return operation(orderId, actor, input, 'return_received_quarantined', { pharmacy: true }, async (client, ctx) => {
      pharmacyValid(ctx.p);
      const b = await hasBooking(client, orderId);
      if (!['returned','return_pending'].includes(b?.status) || ctx.f.return_received_at || input.attest !== true || typeof input.evidenceReference !== 'string' || !/^[A-Za-z0-9._:/ -]{3,250}$/.test(input.evidenceReference)) throw fail(409, 'Confirm physical pharmacy receipt of the returned parcel with a documented evidence reference.');
      await consumeInventory(client, orderId);
      // Returned medicines are quarantined. They never become saleable inventory.
      await client.query('UPDATE ng_medication_fulfillments SET return_received_at=now(),return_evidence_reference=$1 WHERE order_id=$2', [input.evidenceReference, orderId]);
      await audit(client, ctx.order, ctx.actor, 'return_evidence_recorded', { evidenceReference: input.evidenceReference, disposition: 'quarantined' });
    });
  }
  async function refundReturn(orderId, actor, input) {
    await tx(async client => {
      const account = await admin(client, actor);
      if (account.role !== 'super_admin') throw fail(403, 'A super administrator must approve merchant-funded return refunds.');
      const ctx = await load(client, orderId, actor, { lock: true });
      const reference = input.approvalReference;
      if (typeof reference !== 'string' || !/^[A-Za-z0-9._:/ -]{3,250}$/.test(reference) || input.attest !== true) throw fail(422, 'Record explicit approval that DoctaRx funds the return refund and retains the actual courier liability.');
      if (!ctx.f.return_received_at || !['returned','return_pending'].includes((await hasBooking(client, orderId))?.status)) throw fail(409, 'The pharmacy must physically receive and quarantine the returned medicines first.');
      if (ctx.f.return_refund_approval_reference && ctx.f.return_refund_approval_reference !== reference) throw fail(409, 'This returned order already has a different refund approval.');
      await client.query('UPDATE ng_medication_fulfillments SET return_refund_approval_reference=$1,version=version+1,updated_at=now() WHERE order_id=$2', [reference, orderId]);
      await client.query("UPDATE ng_orders SET status='cancelled',cancellation_reason='Returned parcel; merchant-funded refund approved',updated_at=now() WHERE id=$1", [orderId]);
      await audit(client, ctx.order, account, 'return_refund_approved', { approvalReference: reference, courierLiabilityRetained: true });
    });
    await finance().refundReturnedOrder(orderId, input.approvalReference);
    return getCheckout(orderId, actor);
  }
  async function initiateSettlement(orderId, actor, input) {
    const account = await tx(client => admin(client, actor));
    if (account.role !== 'super_admin') throw fail(403, 'Super administrator approval is required for settlement.');
    if (input.attest !== true) throw fail(422, 'Explicitly approve the documented medication settlement.');
    await finance().initiateSettlement(id(orderId), input.payee, account.id, { approvalReference: input.approvalReference });
    return getCheckout(orderId, actor);
  }
  async function refreshSettlements(orderId, actor) { await tx(async client => { await admin(client, actor); await load(client, orderId, actor); }); await finance().refreshSettlements(orderId); return getCheckout(orderId, actor); }
  return { createOrder, getCheckout, setFulfillment, confirmPrice, approve, confirmPharmacy, markReady, requestQuote, initiatePayment, confirmPaymentReference, verifyPayment, dispatch, refresh, cancel, collect, getTracking, acceptCourierWebhook, getOrderOptions,
    setCoverage, listInsurancePartners, adminReport, refreshRefunds, receiveReturn, refundReturn, initiateSettlement, refreshSettlements,
    handleRefundWebhook: (...args) => finance().handleRefundWebhook(...args),
    _test: env.NODE_ENV === 'test' ? { load, dto, pricing, tx, address } : undefined };
}

let singleton;
const exported = { createMedicationDeliveryWorkflowService };
for (const method of ['createOrder','getCheckout','setFulfillment','confirmPrice','approve','confirmPharmacy','markReady','requestQuote','initiatePayment','confirmPaymentReference','verifyPayment','dispatch','refresh','cancel','collect','getTracking','acceptCourierWebhook','getOrderOptions','handleRefundWebhook','setCoverage','listInsurancePartners','adminReport','refreshRefunds','receiveReturn','refundReturn','initiateSettlement','refreshSettlements']) exported[method] = (...args) => (singleton ||= createMedicationDeliveryWorkflowService())[method](...args);
module.exports = exported;
