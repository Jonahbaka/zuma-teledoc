'use strict';

const decisions = require('./adminVerificationService');

async function cancelSubscription(pool, { actorId, subscriptionId, admin = false, reason }) {
  decisions.validateId(subscriptionId);
  const recordedReason = decisions.validateReason(reason, admin);
  return decisions.withActionTransaction(pool, async (client) => {
    await decisions.requireCurrentNGActor(client, actorId, admin);
    const current = await client.query(
      `SELECT id, status, subscriber_user_id, subscriber_org_id
         FROM ng_subscriptions WHERE id = $1
           AND ($2::boolean OR subscriber_user_id = $3) FOR UPDATE`,
      [subscriptionId, admin, actorId]
    );
    if (!current.rowCount) throw decisions.actionError(404, 'Subscription not found in this market.');
    const before = current.rows[0];
    if (!before.subscriber_user_id && !before.subscriber_org_id) throw decisions.actionError(404, 'Subscription not found in this market.');
    await decisions.requireNGRecordOwner(client, before.subscriber_user_id, 'Subscription');
    if (before.subscriber_org_id) {
      const org = await client.query(
        `SELECT owner_user_id FROM ng_organizations WHERE id = $1
          AND LOWER(COALESCE(country, 'Nigeria')) IN ('ng', 'nigeria') FOR SHARE`, [before.subscriber_org_id]
      );
      if (!org.rowCount) throw decisions.actionError(404, 'Subscription not found in this market.');
      await decisions.requireNGRecordOwner(client, org.rows[0].owner_user_id, 'Subscription');
    }
    if (before.status === 'expired') throw decisions.actionError(409, 'This subscription has already expired.');
    const updated = await client.query(
      `UPDATE ng_subscriptions SET status = 'canceled', canceled_at = COALESCE(canceled_at, NOW()),
        admin_overridden_by = CASE WHEN $2::boolean THEN $3 ELSE admin_overridden_by END,
        updated_at = NOW() WHERE id = $1
        RETURNING id, status, canceled_at, current_period_end`, [subscriptionId, admin, actorId]
    );
    if (updated.rowCount !== 1) throw decisions.actionError(404, 'Subscription not found in this market.');
    // Provider access keeps a cached paid entitlement. Clear that cache only
    // when this subscriber has no other live plan; preserve the existing trial.
    if (before.subscriber_user_id) {
      await client.query(
        `UPDATE ng_providers p SET subscription_status = 'canceled', subscription_end_at = NOW(),
          access_status = CASE
            WHEN p.status = 'suspended' THEN 'suspended'
            WHEN p.status = 'rejected' THEN 'rejected'
            WHEN p.status <> 'verified' THEN 'pending_approval'
            WHEN p.trial_start_at IS NOT NULL AND p.trial_end_at > NOW() THEN 'trial_access'
            WHEN p.trial_start_at IS NOT NULL AND p.trial_end_at <= NOW() THEN 'trial_expired'
            ELSE 'trial_not_started' END,
          updated_at = NOW()
         WHERE p.user_id = $1 AND NOT EXISTS (
          SELECT 1 FROM ng_subscriptions s WHERE s.subscriber_user_id = p.user_id
            AND s.status IN ('trial','active') AND (s.current_period_end IS NULL OR s.current_period_end > NOW()))`,
        [before.subscriber_user_id]
      );
    }
    await decisions.auditDecision(client, {
      actorId, resourceType: 'ng_subscription', resourceId: subscriptionId,
      action: admin ? 'admin_cancel' : 'owner_cancel', reason: recordedReason,
      before: { status: before.status }, after: { status: updated.rows[0].status },
    });
    return updated.rows[0];
  });
}

module.exports = { cancelSubscription };
