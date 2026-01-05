/**
 * Membership Service
 * Issues and revokes Docta Gold/Platinum membership cards based on subscription state.
 */

const db = require('../db');
const logger = require('../middleware/logger');

function generateCardNumber(prefix, userId) {
  // Deterministic-ish, not a PAN: DG-XXXXXXXX-YYYY
  const compact = String(userId).replace(/-/g, '').toUpperCase();
  const a = compact.slice(0, 8);
  const b = compact.slice(-4);
  return `${prefix}-${a}-${b}`;
}

async function upsertActiveCard({ userId, tier, stripeSubscriptionId, currentPeriodEnd }) {
  if (!userId) return null;
  if (!['gold', 'platinum'].includes(tier)) return null; // only issue cards for Gold/Platinum

  const prefix = tier === 'gold' ? 'DG' : 'DP';
  const cardNumber = generateCardNumber(prefix, userId);

  const { rows } = await db.query(
    `
      INSERT INTO membership_cards (
        user_id, tier, status, card_number, stripe_subscription_id, current_period_end
      )
      VALUES ($1, $2, 'active', $3, $4, $5)
      ON CONFLICT (card_number)
      DO UPDATE SET
        tier = EXCLUDED.tier,
        status = 'active',
        stripe_subscription_id = EXCLUDED.stripe_subscription_id,
        current_period_end = EXCLUDED.current_period_end,
        suspended_at = NULL,
        revoked_at = NULL,
        updated_at = CURRENT_TIMESTAMP
      RETURNING *
    `,
    [userId, tier, cardNumber, stripeSubscriptionId || null, currentPeriodEnd || null]
  );

  const card = rows[0] || null;
  if (card) {
    logger.info('Membership card active', { userId, tier, cardNumber });
  }
  return card;
}

async function suspendCardsForUser({ userId, reason = 'payment_failed' }) {
  if (!userId) return;
  await db.query(
    `
      UPDATE membership_cards
      SET status = 'suspended', suspended_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
      WHERE user_id = $1 AND status = 'active'
    `,
    [userId]
  );
  logger.warn('Membership card suspended', { userId, reason });
}

async function revokeCardsForUser({ userId, reason = 'subscription_cancelled' }) {
  if (!userId) return;
  await db.query(
    `
      UPDATE membership_cards
      SET status = 'revoked', revoked_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
      WHERE user_id = $1 AND status <> 'revoked'
    `,
    [userId]
  );
  logger.warn('Membership card revoked', { userId, reason });
}

async function getMyCard(userId) {
  const { rows } = await db.query(
    `
      SELECT *
      FROM membership_cards
      WHERE user_id = $1
      ORDER BY created_at DESC
      LIMIT 1
    `,
    [userId]
  );
  return rows[0] || null;
}

module.exports = {
  upsertActiveCard,
  suspendCardsForUser,
  revokeCardsForUser,
  getMyCard
};


