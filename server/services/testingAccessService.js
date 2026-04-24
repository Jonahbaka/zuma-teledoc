const db = require('../db');

const TESTING_TIER_ACCESS_LEVELS = {
  basic: 'basic_monthly',
  gold: 'gold_monthly',
  platinum: 'platinum_monthly',
  test: 'gold_monthly'
};

function getTestingBypassState(user = {}) {
  const expiresAt = user.testing_bypass_expires_at || user.testingBypassExpiresAt || null;
  const tier = user.testing_bypass_tier || user.testingBypassTier || null;
  const isActive =
    Boolean(user.testing_bypass_active || user.testingBypassActive) &&
    Boolean(expiresAt) &&
    new Date(expiresAt) > new Date();

  return {
    active: isActive,
    tier: isActive ? tier || 'gold' : null,
    expiresAt: isActive ? expiresAt : null,
    accessLevel: isActive
      ? TESTING_TIER_ACCESS_LEVELS[(tier || 'gold').toLowerCase()] || TESTING_TIER_ACCESS_LEVELS.gold
      : null
  };
}

function getEffectiveAccessLevel(user = {}) {
  const testingBypass = getTestingBypassState(user);
  return testingBypass.accessLevel || user.access_level || user.accessLevel || 'read_only';
}

function getTestingBypassPayload(user = {}) {
  const testingBypass = getTestingBypassState(user);
  return {
    testingBypassActive: testingBypass.active,
    testingBypassTier: testingBypass.tier,
    testingBypassExpiresAt: testingBypass.expiresAt
  };
}

async function getUserTestingAccess(userId) {
  const { rows } = await db.query(
    `SELECT testing_bypass_active, testing_bypass_expires_at, testing_bypass_tier, access_level
     FROM users
     WHERE id = $1`,
    [userId]
  );

  if (rows.length === 0) {
    return {
      accessLevel: 'read_only',
      testingBypassActive: false,
      testingBypassTier: null,
      testingBypassExpiresAt: null
    };
  }

  const user = rows[0];
  return {
    accessLevel: getEffectiveAccessLevel(user),
    ...getTestingBypassPayload(user)
  };
}

module.exports = {
  TESTING_TIER_ACCESS_LEVELS,
  getTestingBypassState,
  getEffectiveAccessLevel,
  getTestingBypassPayload,
  getUserTestingAccess
};
