'use strict';

const decisions = require('./adminVerificationService');
const { toMinorUnits } = require('./payments/paymentIntegrity');
const crypto = require('crypto');

function validateManualActivation(body = {}) {
  const { subjectType, userId, organizationId, planKey, amountNgn, paymentReference, periodStart, periodEnd } = body;
  const paymentMethod = body.paymentMethod || 'bank_transfer';
  if (!['provider', 'organization'].includes(subjectType) ||
      typeof planKey !== 'string' || !/^[A-Za-z0-9_-]{1,50}$/.test(planKey) ||
      (subjectType === 'provider' ? (!userId || organizationId) : (!organizationId || userId))) {
    throw decisions.actionError(400, 'Select one provider or organization and its plan.');
  }
  decisions.validateId(subjectType === 'provider' ? userId : organizationId);
  if (typeof paymentReference !== 'string' || !paymentReference.trim() || paymentReference.trim().length > 120 ||
      !['bank_transfer', 'cash', 'pos', 'cheque', 'other'].includes(paymentMethod)) {
    throw decisions.actionError(400, 'A recorded payment reference and supported payment method are required.');
  }
  let amountMinor;
  try { amountMinor = toMinorUnits(amountNgn); } catch (_) { throw decisions.actionError(400, 'Specify the actual NGN amount with at most two decimal places.'); }
  if (amountMinor > 999999999999) throw decisions.actionError(400, 'Amount exceeds the supported billing range.');
  const start = periodStart ? new Date(periodStart) : new Date();
  const end = new Date(periodEnd);
  const maximumPeriod = 366 * 86400000;
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start || end.getTime() <= Date.now() || start.getTime() > Date.now() ||
      end.getTime() - start.getTime() > maximumPeriod || Date.now() - start.getTime() > maximumPeriod) {
    throw decisions.actionError(400, 'Specify a valid current access period of no more than 366 days.');
  }
  if (body.idempotencyKey !== undefined) decisions.validateId(body.idempotencyKey);
  return {
    subjectType, userId: userId || null, organizationId: organizationId || null, planKey,
    amountNgn: amountMinor / 100, paymentMethod, paymentReference: paymentReference.trim(), start, end,
    notes: decisions.validateReason(body.notes), requestedStart: periodStart ? start.toISOString() : null,
    idempotencyKey: body.idempotencyKey || 'reference:' + paymentReference.trim(),
  };
}

async function activateManualSubscription(pool, actorId, body) {
  const input = validateManualActivation(body);
  const fingerprint = crypto.createHash('sha256').update(JSON.stringify({
    subjectType: input.subjectType, subjectId: input.userId || input.organizationId, planKey: input.planKey,
    amountNgn: input.amountNgn, paymentMethod: input.paymentMethod, paymentReference: input.paymentReference,
    periodStart: input.requestedStart, periodEnd: input.end.toISOString(), notes: input.notes,
  })).digest('hex');
  return decisions.withActionTransaction(pool, async (client) => {
    await decisions.requireCurrentNGActor(client, actorId);
    // References are staff-entered evidence, not gateway receipts. Serialize
    // their use across different subjects so one confirmation cannot be reused.
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', ['doctarx.ng.manual-payment:' + input.paymentReference]);
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', ['doctarx.ng.manual-idempotency:' + input.idempotencyKey]);
    const plan = (await client.query(
      `SELECT id, plan_key FROM ng_subscription_plans
        WHERE plan_key = $1 AND is_active = TRUE AND target_role = $2 AND currency = 'NGN' FOR SHARE`,
      [input.planKey, input.subjectType]
    )).rows[0];
    if (!plan) throw decisions.actionError(404, 'An active NGN plan for this subject was not found.');
    if (input.subjectType === 'provider') {
      const provider = await client.query(
        `SELECT p.id FROM ng_providers p JOIN users u ON u.id = p.user_id
          WHERE u.id = $1 AND u.role = 'provider' AND u.market_scope = 'NG' AND u.is_active = TRUE
            AND u.provider_status = 'approved' AND p.status = 'verified' FOR UPDATE OF p, u`, [input.userId]
      );
      if (!provider.rowCount) throw decisions.actionError(404, 'A verified provider in this market was not found.');
    } else {
      const org = await client.query(
        `SELECT id, owner_user_id FROM ng_organizations WHERE id = $1 AND status = 'active'
          AND LOWER(COALESCE(country, 'Nigeria')) IN ('ng', 'nigeria') FOR UPDATE`, [input.organizationId]
      );
      if (!org.rowCount) throw decisions.actionError(404, 'An active organization in this market was not found.');
      await decisions.requireNGRecordOwner(client, org.rows[0].owner_user_id, 'Organization');
    }
    const replay = await client.query(
      `SELECT s.id, s.subscriber_user_id, s.subscriber_org_id, s.plan_key, s.status, s.amount_per_period,
        s.currency, s.current_period_start, s.current_period_end, s.payment_provider, s.admin_overridden_by,
        a.user_id AS confirmation_actor_id, a.new_values
       FROM audit_logs a JOIN ng_subscriptions s ON s.id = a.resource_id
       WHERE a.resource_type = 'ng_subscription' AND a.new_values->>'action' = 'manual_activation'
         AND (a.new_values->>'idempotencyKey' = $1 OR a.new_values->>'paymentReference' = $2)
       LIMIT 1 FOR UPDATE OF s`, [input.idempotencyKey, input.paymentReference]
    );
    if (replay.rowCount) {
      const previous = replay.rows[0];
      if (previous.confirmation_actor_id !== actorId || previous.new_values.requestFingerprint !== fingerprint) {
        throw decisions.actionError(409, 'This request key or payment reference already confirms different content.');
      }
      if (previous.status !== 'active') throw decisions.actionError(409, 'The previously confirmed subscription has changed. Review its current status.');
      const { confirmation_actor_id: _actor, new_values: _audit, ...subscription } = previous;
      return { ...subscription, replayed: true };
    }
    const historicalReference = await client.query('SELECT id FROM ng_manual_payment_confirmations WHERE payment_reference = $1 LIMIT 1 FOR UPDATE', [input.paymentReference]);
    if (historicalReference.rowCount) throw decisions.actionError(409, 'This payment reference already has a manual confirmation. Review the existing record.');
    const existingAccess = await client.query(
      `SELECT id FROM ng_subscriptions WHERE
        (subscriber_user_id = $1 OR subscriber_org_id = $2)
        AND status IN ('trial','active','past_due') AND (current_period_end IS NULL OR current_period_end > NOW())
        LIMIT 1 FOR UPDATE`, [input.userId, input.organizationId]
    );
    if (existingAccess.rowCount) throw decisions.actionError(409, 'A current subscription already exists. Review it before recording another activation.');
    const { rows } = await client.query(
      `INSERT INTO ng_subscriptions (subscriber_user_id, subscriber_org_id, plan_id, plan_key,
        status, billing_cycle, amount_per_period, currency, current_period_start, current_period_end,
        payment_provider, last_payment_reference, last_payment_at, admin_notes, admin_overridden_by)
       VALUES ($1,$2,$3,$4,'active','monthly',$5,'NGN',$6,$7,'manual_admin',$8,NOW(),$9,$10)
       RETURNING id, subscriber_user_id, subscriber_org_id, plan_key, status, amount_per_period,
         currency, current_period_start, current_period_end, payment_provider, admin_overridden_by`,
      [input.userId, input.organizationId, plan.id, input.planKey, input.amountNgn,
        input.start, input.end, input.paymentReference, input.notes, actorId]
    );
    const subscription = rows[0];
    if (!subscription) throw new Error('Subscription insert did not return a record');
    await client.query(
      `INSERT INTO ng_manual_payment_confirmations (subject_type, subject_user_id, organization_id,
        plan_key, amount_ngn, payment_method, payment_reference, status, period_start, period_end,
        notes, confirmed_by, confirmed_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'confirmed',$8,$9,$10,$11,NOW())`,
      [input.subjectType, input.userId, input.organizationId, input.planKey, input.amountNgn,
        input.paymentMethod, input.paymentReference, input.start, input.end, input.notes, actorId]
    );
    const linked = input.subjectType === 'provider'
      ? await client.query(
        `UPDATE ng_providers SET subscription_id = $1, subscription_status = 'active', subscription_start_at = $2,
          subscription_end_at = $3, access_status = 'subscribed', updated_at = NOW()
          WHERE user_id = $4 AND status = 'verified' RETURNING id`, [subscription.id, input.start, input.end, input.userId])
      : await client.query('UPDATE ng_organizations SET subscription_id = $1, updated_at = NOW() WHERE id = $2 AND status = \'active\' RETURNING id', [subscription.id, input.organizationId]);
    if (linked.rowCount !== 1) throw decisions.actionError(404, 'The approved subscription subject was not found.');
    await decisions.auditDecision(client, {
      actorId, resourceType: 'ng_subscription', resourceId: subscription.id, action: 'manual_activation', reason: input.notes,
      before: { subscription: null }, after: { status: subscription.status, subjectType: input.subjectType,
        subjectId: input.userId || input.organizationId, planKey: input.planKey, amountNgn: input.amountNgn,
        currency: 'NGN', evidence: 'manual_admin_confirmation', paymentMethod: input.paymentMethod,
        paymentReference: input.paymentReference, periodStart: input.start, periodEnd: input.end,
        idempotencyKey: input.idempotencyKey, requestFingerprint: fingerprint },
    });
    return subscription;
  });
}

module.exports = { validateManualActivation, activateManualSubscription };
