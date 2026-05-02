const { getPool } = require('../../../server/db');

const TRIAL_DAYS = 30;

const ACTIVE_PROVIDER_STATUSES = new Set(['verified', 'approved']);
const SUBSCRIBED_STATUSES = new Set(['active', 'trialing']);

function isNigeriaUser(user = {}) {
  const country = String(user.country || user.region || user.market_scope || '').toLowerCase();
  return country === 'ng' || country === 'nigeria';
}

function daysRemaining(until) {
  if (!until) return 0;
  const ms = new Date(until).getTime() - Date.now();
  if (ms <= 0) return 0;
  return Math.ceil(ms / (24 * 60 * 60 * 1000));
}

function classifyAccess(provider) {
  if (!provider) {
    return {
      accessStatus: 'provider_profile_missing',
      allowed: false,
      blockReason: 'Provider profile is not completed.',
      daysRemaining: 0,
    };
  }

  const now = Date.now();
  const status = String(provider.status || '').toLowerCase();
  const trialStart = provider.trial_start_at;
  const trialEnd = provider.trial_end_at;
  const subscriptionEnd = provider.subscription_end_at;
  const subscriptionStatus = String(provider.subscription_status || '').toLowerCase();

  if (status === 'suspended') {
    return {
      accessStatus: 'suspended',
      allowed: false,
      blockReason: 'Provider account is suspended.',
      daysRemaining: 0,
    };
  }

  if (status === 'rejected') {
    return {
      accessStatus: 'rejected',
      allowed: false,
      blockReason: 'Provider account was not approved.',
      daysRemaining: 0,
    };
  }

  if (!ACTIVE_PROVIDER_STATUSES.has(status)) {
    return {
      accessStatus: 'pending_approval',
      allowed: false,
      blockReason: 'Provider onboarding is still pending.',
      daysRemaining: 0,
    };
  }

  if (SUBSCRIBED_STATUSES.has(subscriptionStatus) && (!subscriptionEnd || new Date(subscriptionEnd).getTime() > now)) {
    return {
      accessStatus: 'subscribed',
      allowed: true,
      blockReason: null,
      daysRemaining: daysRemaining(subscriptionEnd),
    };
  }

  if (trialStart && trialEnd && new Date(trialEnd).getTime() > now) {
    return {
      accessStatus: 'trial_access',
      allowed: true,
      blockReason: null,
      daysRemaining: daysRemaining(trialEnd),
    };
  }

  if (trialStart && trialEnd && new Date(trialEnd).getTime() <= now) {
    return {
      accessStatus: 'trial_expired',
      allowed: false,
      blockReason: 'Provider free trial has ended. Subscription is required to use provider tools.',
      daysRemaining: 0,
    };
  }

  return {
    accessStatus: 'trial_not_started',
    allowed: true,
    blockReason: null,
    daysRemaining: TRIAL_DAYS,
  };
}

async function getProviderByUserId(client, userId) {
  const result = await client.query(
    `SELECT p.*
       FROM ng_providers p
      WHERE p.user_id = $1
      LIMIT 1`,
    [userId]
  );
  return result.rows[0] || null;
}

async function getLatestSubscription(client, userId) {
  const result = await client.query(
    `SELECT s.*
       FROM ng_subscriptions s
      WHERE s.subscriber_user_id = $1
        AND s.status IN ('trial', 'active')
      ORDER BY s.current_period_end DESC NULLS LAST, s.created_at DESC
      LIMIT 1`,
    [userId]
  );
  return result.rows[0] || null;
}

async function ensureProviderAccessForUser(userId, { startTrialIfEligible = true } = {}) {
  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const provider = await getProviderByUserId(client, userId);
    if (!provider) {
      await client.query('ROLLBACK');
      return {
        provider: null,
        usage: {},
        access: classifyAccess(null),
      };
    }

    const subscription = await getLatestSubscription(client, userId);
    let updatedProvider = provider;
    const hasActiveSubscription =
      subscription &&
      ['trial', 'active'].includes(String(subscription.status || '').toLowerCase()) &&
      (!subscription.current_period_end || new Date(subscription.current_period_end).getTime() > Date.now());

    if (hasActiveSubscription) {
      const result = await client.query(
        `UPDATE ng_providers
            SET subscription_status = 'active',
                subscription_start_at = COALESCE(subscription_start_at, $2),
                subscription_end_at = $3,
                access_status = 'subscribed',
                updated_at = NOW()
          WHERE id = $1
          RETURNING *`,
        [provider.id, subscription.current_period_start || new Date(), subscription.current_period_end || subscription.expires_at || null]
      );
      updatedProvider = result.rows[0];
    } else if (
      startTrialIfEligible &&
      ACTIVE_PROVIDER_STATUSES.has(String(provider.status || '').toLowerCase()) &&
      !provider.trial_start_at &&
      !provider.trial_end_at
    ) {
      const result = await client.query(
        `UPDATE ng_providers
            SET trial_start_at = NOW(),
                trial_end_at = NOW() + INTERVAL '${TRIAL_DAYS} days',
                trial_status = 'active',
                access_status = 'trial_access',
                updated_at = NOW()
          WHERE id = $1
          RETURNING *`,
        [provider.id]
      );
      updatedProvider = result.rows[0];
    } else {
      const access = classifyAccess(provider);
      const result = await client.query(
        `UPDATE ng_providers
            SET trial_status = CASE
                  WHEN trial_start_at IS NOT NULL AND trial_end_at <= NOW() THEN 'expired'
                  WHEN trial_start_at IS NOT NULL AND trial_end_at > NOW() THEN 'active'
                  ELSE trial_status
                END,
                access_status = $2,
                updated_at = NOW()
          WHERE id = $1
          RETURNING *`,
        [provider.id, access.accessStatus]
      );
      updatedProvider = result.rows[0];
    }

    const usage = {
      consultationsCount: Number(updatedProvider.consultations_count || updatedProvider.total_consultations || 0),
      appointmentsCount: Number(updatedProvider.appointments_count || 0),
      prescriptionsCount: Number(updatedProvider.prescriptions_count || 0),
      videoCallsCount: Number(updatedProvider.video_calls_count || 0),
      messagesCount: Number(updatedProvider.messages_count || 0),
      daysActiveCount: Number(updatedProvider.days_active_count || 0),
      lastActiveAt: updatedProvider.last_active_at || null,
    };

    const access = classifyAccess(updatedProvider);
    await client.query('COMMIT');

    return {
      provider: updatedProvider,
      usage,
      access,
      trial: {
        trialStartAt: updatedProvider.trial_start_at,
        trialEndAt: updatedProvider.trial_end_at,
        trialStatus: updatedProvider.trial_status,
        daysRemaining: access.accessStatus === 'trial_access' ? access.daysRemaining : 0,
      },
      subscription: {
        status: updatedProvider.subscription_status,
        subscriptionStartAt: updatedProvider.subscription_start_at,
        subscriptionEndAt: updatedProvider.subscription_end_at,
      },
    };
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (_) {
      // no-op
    }
    throw error;
  } finally {
    client.release();
  }
}

async function recordProviderUsage(userId, eventType, { count = 1, metadata = {} } = {}) {
  const pool = getPool();
  const providerResult = await pool.query('SELECT id FROM ng_providers WHERE user_id = $1 LIMIT 1', [userId]);
  const providerId = providerResult.rows[0]?.id || null;

  await pool.query(
    `INSERT INTO ng_provider_usage_events
       (provider_user_id, provider_id, event_type, event_count, metadata, created_at)
     VALUES ($1, $2, $3, $4, $5, NOW())`,
    [userId, providerId, eventType, count, JSON.stringify(metadata || {})]
  );

  if (!providerId) return;

  const increment = Number.isFinite(Number(count)) ? Number(count) : 1;
  const fieldByEvent = {
    appointment_created: 'appointments_count',
    appointment_completed: 'appointments_count',
    consultation_completed: 'consultations_count',
    prescription_issued: 'prescriptions_count',
    video_call_started: 'video_calls_count',
    message_sent: 'messages_count',
  };
  const field = fieldByEvent[eventType];

  if (field) {
    await pool.query(
      `UPDATE ng_providers
          SET ${field} = COALESCE(${field}, 0) + $2,
              last_active_at = NOW(),
              days_active_count = GREATEST(COALESCE(days_active_count, 0), 1),
              updated_at = NOW()
        WHERE id = $1`,
      [providerId, increment]
    );
  } else {
    await pool.query(
      `UPDATE ng_providers
          SET last_active_at = NOW(),
              days_active_count = GREATEST(COALESCE(days_active_count, 0), 1),
              updated_at = NOW()
        WHERE id = $1`,
      [providerId]
    );
  }
}

async function requireActiveProviderToolAccess(req, res, next) {
  try {
    if (String(req.user?.role || '').toLowerCase() !== 'provider') {
      return next();
    }

    const pool = getPool();
    const userResult = await pool.query(
      `SELECT id, role, country, region, market_scope
         FROM users
        WHERE id = $1
        LIMIT 1`,
      [req.user.id]
    );
    const user = userResult.rows[0] || {};

    if (!isNigeriaUser(user)) {
      return next();
    }

    const accessState = await ensureProviderAccessForUser(req.user.id, { startTrialIfEligible: true });
    if (accessState.access.allowed) {
      req.ngProviderAccess = accessState;
      return next();
    }

    const status = accessState.access.accessStatus === 'trial_expired' ? 402 : 403;
    return res.status(status).json({
      success: false,
      error: accessState.access.blockReason,
      code: status === 402 ? 'PROVIDER_SUBSCRIPTION_REQUIRED' : 'PROVIDER_ACCESS_BLOCKED',
      providerAccess: accessState,
    });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  TRIAL_DAYS,
  ensureProviderAccessForUser,
  recordProviderUsage,
  requireActiveProviderToolAccess,
};
