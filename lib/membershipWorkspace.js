const planTiers = { basic: 'basic', gold: 'gold', goldYearly: 'gold', platinum: 'platinum', test: 'gold' };
const futureDate = (value, now) => typeof value === 'string' && Number.isFinite(Date.parse(value)) && Date.parse(value) > now;
const owned = (record, user) => user?.id && record && typeof record.id === 'string' && record.id.length > 0 && String(record.user_id) === String(user.id);

export function membershipMarket(user) {
  return String(user?.marketScope || user?.market_scope || '').toUpperCase();
}

export function verifiedMembership(subscription, user, now = Date.now()) {
  return Boolean(user?.id && user.role === 'patient' && membershipMarket(user) === 'US' && owned(subscription, user)
    && subscription.status === 'active' && subscription.paymentVerified === true
    && subscription.verificationSource === 'stripe_verified_invoice'
    && ['live', 'test'].includes(subscription.paymentEnvironment)
    && planTiers[subscription.plan_key] && subscription.tier === planTiers[subscription.plan_key]
    && futureDate(subscription.current_period_end, now));
}

// Cached access, historical active rows, and return flags are not receipts.
export function readMembershipState(data, user, now = Date.now()) {
  const capabilities = data?.capabilities;
  if (data?.success !== true || typeof data.hasActiveSubscription !== 'boolean' || typeof data.paymentVerified !== 'boolean'
    || !capabilities || capabilities.market !== membershipMarket(user)
    || typeof capabilities.checkoutAvailable !== 'boolean' || typeof capabilities.billingPortalAvailable !== 'boolean'
    || !Array.isArray(data.plans) || (data.recordedSubscription != null && (!owned(data.recordedSubscription, user)
      || data.recordedSubscription.tier != null && typeof data.recordedSubscription.tier !== 'string'
      || data.recordedSubscription.status != null && typeof data.recordedSubscription.status !== 'string'))) {
    throw new Error('Membership records could not be confirmed. Please try again.');
  }
  const active = data.hasActiveSubscription && data.paymentVerified && data.verificationSource === 'stripe_verified_invoice'
    && data.paymentEnvironment === data.subscription?.paymentEnvironment
    && verifiedMembership(data.subscription, user, now);
  if ((data.hasActiveSubscription || data.paymentVerified || data.subscription != null || data.paymentEnvironment != null) && !active) {
    throw new Error('Membership payment verification could not be confirmed. Please try again.');
  }
  const plans = data.plans.map(plan => {
    if (!['basic', 'gold', 'goldYearly', 'platinum'].includes(plan?.id) || typeof plan.name !== 'string' || !plan.name.trim()
      || !Number.isSafeInteger(plan.amount) || plan.amount <= 0 || plan.price !== plan.amount / 100
      || plan.currency !== 'usd' || !['month', 'year'].includes(plan.interval)
      || typeof plan.checkoutAvailable !== 'boolean' || !Array.isArray(plan.features) || plan.features.some(feature => typeof feature !== 'string')) {
      throw new Error('Configured membership plans could not be confirmed. Please try again.');
    }
    return { ...plan, name: plan.name.replace(/^Docta\b/, 'DoctaRx') };
  });
  if (new Set(plans.map(plan => plan.id)).size !== plans.length || (membershipMarket(user) !== 'US' && plans.length)) {
    throw new Error('Configured membership plans could not be confirmed. Please try again.');
  }
  return { ...data, plans, subscription: active ? data.subscription : null, hasActiveSubscription: Boolean(active),
    testingBypassActive: data.testingBypassActive === true && futureDate(data.testingBypassExpiresAt, now) };
}

export function canStartMembershipCheckout(state, user, planKey) {
  return Boolean(user?.id && user.role === 'patient' && membershipMarket(user) === 'US'
    && state?.capabilities.market === 'US' && state.capabilities.checkoutAvailable === true && !state.hasActiveSubscription
    && state.plans?.some(plan => plan.id === planKey && plan.checkoutAvailable === true));
}

export function hostedMembershipUrl(data, kind) {
  const raw = kind === 'checkout' ? data?.checkout?.url : data?.url;
  let url;
  try { url = new URL(raw); } catch { throw new Error('A valid Stripe link was not returned. Refresh membership before trying again.'); }
  const hostname = kind === 'checkout' ? 'checkout.stripe.com' : 'billing.stripe.com';
  if (!['checkout', 'portal'].includes(kind) || data?.success !== true || url.protocol !== 'https:' || url.hostname !== hostname || url.port || url.username || url.password) {
    throw new Error('A valid Stripe link was not returned. Refresh membership before trying again.');
  }
  return url.href;
}

export function membershipDate(value) {
  if (!value || !Number.isFinite(Date.parse(value))) return 'Not recorded';
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(new Date(value));
}

export function membershipPrice(plan) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: plan.currency.toUpperCase() }).format(plan.amount / 100);
}
