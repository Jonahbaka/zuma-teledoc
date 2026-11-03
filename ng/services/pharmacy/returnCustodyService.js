'use strict';

// Proposed manual recovery protocol. Disabled unless all deployment sign-offs
// are recorded. This module never transports a parcel, dispenses, or moves funds.
const crypto = require('crypto');
const { z } = require('zod');
const { getPool } = require('../../../server/db');
const compliance = require('../compliance/complianceService');
const { isClinicalPharmacyActive, assertClinicalPharmacyActive } = require('./clinicalPharmacyAuthorization');
const NOMINATED = 'return_custody_nominated';
const REVOKED = 'return_custody_revoked';
const RECEIVED = 'alternate_return_custody_received';
const reference = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{2,119}$/);
const eventId = z.string().refine(value => /^[1-9][0-9]{0,18}$/.test(value) && BigInt(value) <= 9223372036854775807n);
const command = { version: z.number().int().positive(), idempotencyKey: z.string().regex(/^[A-Za-z0-9_-]{8,128}$/) };
const nominateSchema = z.object({ ...command, receivingPharmacyId: z.string().uuid(), patientAuthorizationReference: reference,
  transferApprovalReference: reference, receivingAcceptanceReference: reference, expiresAt: z.string().datetime(),
  authorizationVerified: z.literal(true), sealedAmbientOnly: z.literal(true) }).strict();
const receiveSchema = z.object({ ...command, nominationId: eventId, evidenceReference: reference, physicallyReceivedAndQuarantined: z.literal(true) }).strict();
const revokeSchema = z.object({ ...command, nominationId: eventId, reasonReference: reference }).strict();
const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fail = (status, message) => Object.assign(new Error(message), { status });
function parse(schema, input) { const result = schema.safeParse(input); if (!result.success) throw fail(422, 'Complete the bounded custody authorization fields. Do not include patient or clinical details.'); return result.data; }
function uuid(value) { return parse(z.string().uuid(), value); }

function createReturnCustodyService(options = {}) {
  const env = options.env || process.env;
  if (Object.keys(options).some(key => key !== 'env') && (process.env.NODE_ENV === 'production' || !['test', 'development'].includes(env.NODE_ENV))) throw fail(500, 'Test dependencies are not allowed in production.');
  const now = options.now || Date.now;
  function activation() {
    const approvals = {
      clinician: env.NG_RETURN_CUSTODY_CLINICIAN_APPROVAL,
      privacy: env.NG_RETURN_CUSTODY_PRIVACY_APPROVAL,
      operations: env.NG_RETURN_CUSTODY_OPERATIONS_APPROVAL,
    };
    if (env.NG_RETURN_CUSTODY_ENABLED !== 'true' || Object.values(approvals).some(value => !reference.safeParse(value).success)) throw fail(503, 'Manual return custody recovery is unavailable pending clinician, privacy and operational sign-off.');
    return { approvals, protocolDigest: hash(approvals) };
  }
  function availability() { try { activation(); return { enabled: true }; } catch { return { enabled: false }; } }
  async function tx(fn) {
    const gate = activation(); // No database access, even reads, while disabled.
    const client = await (options.pool || getPool()).connect();
    try { await client.query('BEGIN'); const result = await fn(client, gate); await client.query('COMMIT'); return result; }
    catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  }
  async function account(client, actor, role) {
    const row = (await client.query('SELECT id,role,is_active,market_scope,account_status FROM users WHERE id=$1 FOR SHARE', [uuid(actor?.id)])).rows[0];
    if (!row?.is_active || row.market_scope !== 'NG' || row.account_status !== 'active' || row.role !== role) throw fail(403, 'Current authorized Nigeria account access is required.');
    return row;
  }
  async function pharmacy(client, pharmacyId) {
    const row = (await client.query('SELECT * FROM ng_pharmacies WHERE id=$1 FOR SHARE', [uuid(pharmacyId)])).rows[0];
    if (!row) throw fail(404, 'Custody pharmacy not found.');
    return row;
  }
  async function load(client, orderId, lock = 'UPDATE') {
    const order = (await client.query(`SELECT id,order_number,pharmacy_id,status FROM ng_orders WHERE id=$1 FOR ${lock}`, [uuid(orderId)])).rows[0];
    if (!order) throw fail(404, 'Return not found.');
    const f = (await client.query(`SELECT order_id,version,package_category,inventory_released_at,return_received_at,return_evidence_reference,return_refund_approval_reference,collected_at FROM ng_medication_fulfillments WHERE order_id=$1 FOR ${lock}`, [order.id])).rows[0];
    if (!f) throw fail(409, 'A supported medication return is required.');
    const booking = (await client.query('SELECT status FROM ng_medication_bookings WHERE order_id=$1 FOR SHARE', [order.id])).rows[0];
    const original = await pharmacy(client, order.pharmacy_id);
    return { order, f, booking, original };
  }
  async function latest(client, orderId) {
    return (await client.query('SELECT id::text,action,details,created_at FROM ng_medication_events WHERE order_id=$1 AND action IN ($2,$3) ORDER BY id DESC LIMIT 1', [orderId, NOMINATED, REVOKED])).rows[0];
  }
  function eligible(ctx) {
    if (['cancelled', 'refunded', 'delivered'].includes(ctx.order.status) || ctx.f.collected_at || ctx.f.return_refund_approval_reference
      || !['returned', 'return_pending'].includes(ctx.booking?.status) || !ctx.f.inventory_released_at || ctx.f.package_category !== 'sealed_ambient_medication') throw fail(409, 'This return requires a different supervised recovery process.');
  }
  async function originalUnavailable(client, ctx) {
    if (!isClinicalPharmacyActive(ctx.original, now())) return;
    const owner = (await client.query('SELECT id,role,is_active,market_scope,account_status FROM users WHERE id=$1 FOR SHARE', [ctx.original.owner_user_id])).rows[0];
    if (owner?.is_active && owner.role === 'pharmacy' && owner.market_scope === 'NG' && owner.account_status === 'active') throw fail(409, 'Use the original authorized pharmacy return process.');
  }
  function currentNomination(event, gate) {
    if (!event || event.action !== NOMINATED || event.details.protocolDigest !== gate.protocolDigest || Date.parse(event.details.expiresAt) <= now() || !Number.isFinite(Date.parse(event.details.expiresAt))) throw fail(409, 'A current documented custody nomination is required.');
    return event;
  }
  async function receiver(client, pharmacyId, actor, nomination) {
    const p = await pharmacy(client, pharmacyId);
    assertClinicalPharmacyActive(p, now());
    const a = await account(client, actor, 'pharmacy');
    if (p.owner_user_id !== a.id || (nomination && (nomination.details.receivingPharmacyId !== p.id || nomination.details.receivingOwnerUserId !== a.id))) throw fail(403, 'Only the currently nominated receiving pharmacy owner may access this return.');
    return { p, a };
  }
  async function audit(client, ctx, actor, action, details, pharmacyId = ctx.order.pharmacy_id) {
    await compliance.logAction({ actorUserId: actor.id, actorType: actor.role, action: `medication_${action}`, resourceType: 'ng_order', resourceId: ctx.order.id, pharmacyId, details }, client);
  }
  async function event(client, ctx, actor, action, details) {
    return (await client.query('INSERT INTO ng_medication_events(order_id,actor_user_id,action,details) VALUES($1,$2,$3,$4) RETURNING id::text,action,details,created_at', [ctx.order.id, actor.id, action, JSON.stringify(details)])).rows[0];
  }
  async function prior(client, ctx, actor, input, action) {
    const digest = hash({ actorId: actor.id, action, input });
    const row = (await client.query('SELECT action,digest FROM ng_medication_operations WHERE order_id=$1 AND operation_key=$2', [ctx.order.id, input.idempotencyKey])).rows[0];
    if (row && (row.action !== action || row.digest !== digest)) throw fail(409, 'This request key belongs to a different custody operation.');
    return { row, digest };
  }
  function version(ctx, input) { if (input.version !== ctx.f.version) throw fail(409, 'The return changed. Refresh before confirming.'); }
  async function recordOperation(client, ctx, input, action, digest) {
    await client.query('UPDATE ng_medication_fulfillments SET version=version+1,updated_at=now() WHERE order_id=$1', [ctx.order.id]);
    ctx.f.version++;
    await client.query('INSERT INTO ng_medication_operations(order_id,operation_key,action,digest) VALUES($1,$2,$3,$4)', [ctx.order.id, input.idempotencyKey, action, digest]);
  }
  function parcel(ctx, nomination) {
    return { orderId: ctx.order.id, orderNumber: ctx.order.order_number, version: ctx.f.version, nominationId: nomination.id,
      handlingCategory: ctx.f.package_category, nominatedAt: nomination.created_at, expiresAt: nomination.details.expiresAt,
      receivedAt: ctx.f.return_received_at || null, disposition: ctx.f.return_received_at ? 'quarantined' : null };
  }
  async function nominate(orderId, actor, raw) {
    activation(); const input = parse(nominateSchema, raw);
    return tx(async (client, gate) => {
      const ctx = await load(client, orderId); const a = await account(client, actor, 'super_admin');
      eligible(ctx); await originalUnavailable(client, ctx);
      if (ctx.f.return_received_at) throw fail(409, 'Physical custody is already recorded.');
      if (input.receivingPharmacyId === ctx.order.pharmacy_id) throw fail(422, 'Nominate a different authorized receiving pharmacy.');
      const p = await pharmacy(client, input.receivingPharmacyId); assertClinicalPharmacyActive(p, now());
      const owner = await account(client, { id: p.owner_user_id }, 'pharmacy');
      const existing = await latest(client, orderId); const previous = await prior(client, ctx, a, input, NOMINATED);
      if (previous.row) {
        const nomination = currentNomination(existing, gate);
        if (nomination.details.operationDigest !== previous.digest || nomination.details.receivingOwnerUserId !== owner.id) throw fail(409, 'That custody nomination is no longer current.');
        return parcel(ctx, nomination);
      }
      version(ctx, input);
      const expires = Date.parse(input.expiresAt);
      if (expires <= now() || expires > now() + 86400000) throw fail(422, 'Custody authorization must expire within the next 24 hours.');
      const nomination = await event(client, ctx, a, NOMINATED, {
        receivingPharmacyId: p.id, receivingOwnerUserId: owner.id, sourcePharmacyId: ctx.order.pharmacy_id,
        patientAuthorizationReference: input.patientAuthorizationReference, transferApprovalReference: input.transferApprovalReference,
        receivingAcceptanceReference: input.receivingAcceptanceReference, expiresAt: input.expiresAt,
        authorizationVerified: true, sealedAmbientOnly: true, ...gate, operationDigest: previous.digest,
      });
      await recordOperation(client, ctx, input, NOMINATED, previous.digest);
      await audit(client, ctx, a, NOMINATED, { nominationId: nomination.id, receivingPharmacyId: p.id, receivingOwnerUserId: owner.id });
      return parcel(ctx, nomination);
    });
  }
  async function revoke(orderId, actor, raw) {
    activation(); const input = parse(revokeSchema, raw);
    return tx(async client => {
      const ctx = await load(client, orderId); const a = await account(client, actor, 'super_admin');
      const nomination = await latest(client, orderId); const previous = await prior(client, ctx, a, input, REVOKED);
      if (previous.row) {
        if (nomination?.action !== REVOKED || nomination.details.operationDigest !== previous.digest) throw fail(409, 'The custody authorization changed.');
        return { revoked: true, version: ctx.f.version };
      }
      version(ctx, input);
      if (ctx.f.return_received_at || nomination?.action !== NOMINATED || nomination.id !== input.nominationId) throw fail(409, 'Only an unreceived current nomination can be revoked.');
      await event(client, ctx, a, REVOKED, { nominationId: nomination.id, reasonReference: input.reasonReference, operationDigest: previous.digest });
      await recordOperation(client, ctx, input, REVOKED, previous.digest);
      await audit(client, ctx, a, REVOKED, { nominationId: nomination.id });
      return { revoked: true, version: ctx.f.version };
    });
  }
  async function receive(orderId, pharmacyId, actor, raw) {
    activation(); const input = parse(receiveSchema, raw);
    return tx(async (client, gate) => {
      const ctx = await load(client, orderId);
      const nomination = currentNomination(await latest(client, orderId), gate);
      if (nomination.id !== input.nominationId) throw fail(409, 'This custody nomination was superseded.');
      const { p, a } = await receiver(client, pharmacyId, actor, nomination);
      eligible(ctx); await originalUnavailable(client, ctx);
      const previous = await prior(client, ctx, a, input, RECEIVED);
      if (previous.row) return parcel(ctx, nomination);
      version(ctx, input);
      if (ctx.f.return_received_at) throw fail(409, 'Physical custody is already recorded.');
      const provenance = `alternate-custody:${nomination.id}:${input.evidenceReference}`;
      const received = (await client.query('UPDATE ng_medication_fulfillments SET return_received_at=now(),return_evidence_reference=$1 WHERE order_id=$2 RETURNING return_received_at', [provenance, orderId])).rows[0];
      ctx.f.return_received_at = received.return_received_at;
      await event(client, ctx, a, RECEIVED, { nominationId: nomination.id, sourcePharmacyId: ctx.order.pharmacy_id, receivingPharmacyId: p.id, receivingOwnerUserId: a.id, evidenceReference: input.evidenceReference, disposition: 'quarantined', noDispensingOrRestock: true });
      await recordOperation(client, ctx, input, RECEIVED, previous.digest);
      await audit(client, ctx, a, RECEIVED, { nominationId: nomination.id, receivingPharmacyId: p.id, disposition: 'quarantined' }, p.id);
      return parcel(ctx, nomination);
    });
  }
  async function list(pharmacyId, actor, query = {}) {
    activation();
    const { after } = parse(z.object({ after: z.union([z.literal('0'), eventId]).default('0') }).strict(), query);
    return tx(async (client, gate) => {
      const { a } = await receiver(client, pharmacyId, actor);
      // Candidate IDs are not authority. Lock each order before re-reading its
      // latest event so a superseded nomination cannot disclose parcel details.
      const candidates = (await client.query(`SELECT e.order_id,e.id::text FROM ng_medication_events e
        WHERE e.action=$1 AND e.details->>'receivingPharmacyId'=$2 AND e.details->>'receivingOwnerUserId'=$3 AND e.id>$4::bigint
          AND NOT EXISTS(SELECT 1 FROM ng_medication_events newer WHERE newer.order_id=e.order_id AND newer.action IN ($1,$5) AND newer.id>e.id)
        ORDER BY e.id LIMIT 51`, [NOMINATED, pharmacyId, a.id, after, REVOKED])).rows;
      const returns = [];
      for (const candidate of candidates.slice(0, 50)) {
        const ctx = await load(client, candidate.order_id, 'SHARE');
        const nomination = await latest(client, candidate.order_id);
        // Closed/expired/reassigned entries are not disclosed; pagination still advances.
        try {
          currentNomination(nomination, gate);
          if (nomination.id !== candidate.id) continue;
          await receiver(client, pharmacyId, actor, nomination); eligible(ctx); await originalUnavailable(client, ctx);
          if (ctx.f.return_received_at) continue;
        } catch (error) { if ([403, 409].includes(error.status)) continue; throw error; }
        await audit(client, ctx, a, 'return_custody_parcel_read', { nominationId: nomination.id }, pharmacyId);
        returns.push(parcel(ctx, nomination));
      }
      return { returns, nextCursor: candidates.length > 50 ? candidates[49].id : null };
    });
  }
  return { availability, nominate, revoke, receive, list };
}
let singleton;
const exported = { createReturnCustodyService };
for (const method of ['availability', 'nominate', 'revoke', 'receive', 'list']) exported[method] = (...args) => (singleton ||= createReturnCustodyService())[method](...args);
module.exports = exported;
