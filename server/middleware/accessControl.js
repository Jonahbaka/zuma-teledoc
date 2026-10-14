'use strict';

const membership = require('../services/consumerMembershipService');
const PAID_ACCESS_LEVELS = ['basic_monthly', 'gold_monthly', 'gold_yearly', 'platinum_monthly', 'pay_per_visit', 'insurance'];
const PRESCRIPTION_ACCESS_LEVELS = [...PAID_ACCESS_LEVELS];

const requirePaidAccess = async (req, res, next) => {
  if (!req.user?.id) return res.status(401).json({ success: false, error: 'Authentication required' });
  try {
    const authority = req.financialAccess || await membership.readAuthority(req.user.id);
    req.userAccessLevel = authority.accessLevel;
    req.testingBypass = { active: authority.testingBypassActive === true };
    // Patients may schedule an appointment before paying. Staff booking uses
    // clinical authority; patient payment is checked when the visit is accessed.
    if (req.method === 'POST' && req.path === '/' && ['patient', 'provider', 'admin', 'super_admin'].includes(req.user.role)) return next();
    const appointmentId = req.params?.appointmentId || req.body?.appointmentId;
    if (appointmentId) {
      const funding = await membership.appointmentFunding(req.user.id, appointmentId);
      if (funding.covered) { req.appointmentFunding = funding; return next(); }
      return res.status(funding.source === 'financial_verification_unavailable' ? 503 : 402).json({ success: false,
        error: 'Verified payment or current approved coverage is required for this visit', paymentRequired: true });
    }
    if (authority.paymentVerified || authority.testingBypassActive) return next();
    return res.status(authority.financialAccessAvailable ? 403 : 503).json({ success: false,
      error: 'Current membership or approved visit funding could not be verified', accessLevel: 'read_only', requiredAccess: 'verified' });
  } catch (error) { return res.status(error.statusCode || 503).json({ success: false, error: error.statusCode ? error.message : 'Visit funding could not be verified' }); }
};

// Billing must not prevent a patient from reading already-issued clinical
// records. Resource routes still enforce their existing ownership/care scope.
const requirePrescriptionAccess = (req, res, next) => {
  if (!req.user?.id) return res.status(401).json({ success: false, error: 'Authentication required' });
  return next();
};
const allowReadOnly = (req, res, next) => {
  if (!req.user?.id) return res.status(401).json({ success: false, error: 'Authentication required' });
  return next();
};
const getUserAccessLevel = async userId => (await membership.readAuthority(userId)).accessLevel;
const hasActiveSubscription = async userId => (await membership.readAuthority(userId)).hasActiveSubscription === true;

module.exports = { requirePaidAccess, requirePrescriptionAccess, allowReadOnly, getUserAccessLevel, hasActiveSubscription, PAID_ACCESS_LEVELS, PRESCRIPTION_ACCESS_LEVELS };

