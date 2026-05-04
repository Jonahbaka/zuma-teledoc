const fs = require('fs');
const path = require('path');
const db = require('../../db');

const REPO_ROOT = path.resolve(__dirname, '../../..');

async function safeQuery(text, params = []) {
  try {
    const result = await db.query(text, params);
    return { ok: true, rows: result.rows, rowCount: result.rowCount };
  } catch (error) {
    return { ok: false, rows: [], rowCount: 0, error: error.message };
  }
}

function collectRoutes(dir, prefix = '') {
  const abs = path.join(REPO_ROOT, dir);
  if (!fs.existsSync(abs)) return [];

  const routes = [];
  const walk = (currentAbs, currentPrefix) => {
    const entries = fs.readdirSync(currentAbs, { withFileTypes: true });
    const hasPage = entries.some((entry) => entry.isFile() && /^page\.(js|jsx|ts|tsx)$/.test(entry.name));
    if (hasPage) {
      routes.push(currentPrefix || '/');
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith('_')) continue;
      const nextSegment = entry.name.startsWith('(') && entry.name.endsWith(')') ? '' : `/${entry.name}`;
      walk(path.join(currentAbs, entry.name), `${currentPrefix}${nextSegment}`);
    }
  };

  walk(abs, prefix);
  return routes.sort();
}

async function scanRoutes(input = {}) {
  const scope = input.scope || 'ng';
  const routes = scope === 'admin'
    ? collectRoutes('app/(dashboard)/admin', '/admin')
    : collectRoutes('app/ng', '/ng');

  const critical = [
    '/ng/pharmacy',
    '/ng/pharmacy/login',
    '/ng/pharmacy/register',
    '/ng/pharmacy/dashboard',
    '/ng/patient/register',
    '/ng/provider/register',
    '/ng/organization/register',
    '/ng/pricing',
  ];

  return {
    scope,
    routeCount: routes.length,
    sample: routes.slice(0, 40),
    criticalMissing: critical.filter((route) => !routes.includes(route)),
  };
}

async function checkMissingLoginRoutes() {
  const routes = collectRoutes('app/ng', '/ng');
  const expected = [
    '/ng/patient/login',
    '/ng/provider/login',
    '/ng/pharmacy/login',
    '/ng/auth/login',
  ];

  return {
    expected,
    missing: expected.filter((route) => !routes.includes(route)),
    present: expected.filter((route) => routes.includes(route)),
  };
}

async function verifyTestAccountVisibility(input = {}) {
  const roleFilter = input.role ? 'AND role = $1' : '';
  const roleParams = input.role ? [input.role] : [];
  const counts = await safeQuery(
    `SELECT role,
            COALESCE(market_scope, CASE WHEN country IN ('NG', 'Nigeria') THEN 'NG' ELSE 'US' END) AS market_scope,
            COUNT(*)::int AS count,
            COUNT(*) FILTER (WHERE must_change_password IS TRUE)::int AS password_change_required
       FROM users
      WHERE COALESCE(is_test_account, FALSE) IS TRUE
      ${roleFilter}
      GROUP BY role, COALESCE(market_scope, CASE WHEN country IN ('NG', 'Nigeria') THEN 'NG' ELSE 'US' END)
      ORDER BY role, market_scope`,
    roleParams
  );
  const latest = await safeQuery(
    `SELECT id, email, role, first_name, last_name, country, market_scope,
            is_active, account_status, must_change_password, created_at
       FROM users
      WHERE COALESCE(is_test_account, FALSE) IS TRUE
      ORDER BY created_at DESC
      LIMIT 12`
  );

  return {
    status: counts.ok && latest.ok ? 'ok' : 'degraded',
    counts: counts.rows,
    latest: latest.rows,
    errors: [counts.error, latest.error].filter(Boolean),
    finding: latest.rows.length === 0
      ? 'No test accounts are visible through the users table.'
      : 'Test accounts are visible when the API queries is_test_account=true.',
  };
}

async function getPendingPharmacyOnboardings() {
  const result = await safeQuery(
    `SELECT id, name, email, phone, whatsapp_business_number,
            pcn_license_number, city, state, account_status, onboarding_status,
            preferred_prescription_receiving_method, created_at
       FROM ng_pharmacies
      WHERE COALESCE(onboarding_status, '') NOT IN ('approved', 'completed')
         OR COALESCE(account_status, '') NOT IN ('active')
      ORDER BY created_at DESC
      LIMIT 25`
  );

  const rows = result.rows.map((row) => {
    const missingFields = [];
    if (!row.email) missingFields.push('email');
    if (!row.phone) missingFields.push('phone');
    if (!row.whatsapp_business_number) missingFields.push('whatsapp business number');
    if (!row.pcn_license_number) missingFields.push('PCN/license number');
    if (!row.city || !row.state) missingFields.push('location');

    return { ...row, missingFields };
  });

  return {
    status: result.ok ? 'ok' : 'degraded',
    pendingCount: rows.length,
    pharmacies: rows,
    error: result.error,
  };
}

async function getProviderUsage() {
  const summary = await safeQuery(
    `SELECT
       COUNT(*)::int AS total_providers,
       COUNT(*) FILTER (WHERE trial_status = 'active')::int AS active_trials,
       COUNT(*) FILTER (WHERE trial_end_at <= NOW() AND subscription_status <> 'active')::int AS expired_without_subscription,
       COUNT(*) FILTER (WHERE subscription_status = 'active')::int AS active_subscriptions,
       COALESCE(SUM(consultations_count), 0)::int AS consultations,
       COALESCE(SUM(appointments_count), 0)::int AS appointments,
       COALESCE(SUM(prescriptions_count), 0)::int AS prescriptions,
       COALESCE(SUM(video_calls_count), 0)::int AS video_calls,
       COALESCE(SUM(messages_count), 0)::int AS messages
     FROM ng_providers`
  );
  const recent = await safeQuery(
    `SELECT full_name, email, status, trial_status, trial_start_at, trial_end_at,
            subscription_status, access_status, consultations_count, appointments_count,
            prescriptions_count, video_calls_count, messages_count, last_active_at
       FROM ng_providers
      ORDER BY updated_at DESC NULLS LAST
      LIMIT 12`
  );

  return {
    status: summary.ok && recent.ok ? 'ok' : 'degraded',
    summary: summary.rows[0] || {},
    recentProviders: recent.rows,
    errors: [summary.error, recent.error].filter(Boolean),
  };
}

async function getExpiredProviderTrials() {
  const result = await safeQuery(
    `SELECT id, user_id, full_name, email, trial_end_at, subscription_status, access_status
       FROM ng_providers
      WHERE trial_end_at <= NOW()
        AND COALESCE(subscription_status, 'inactive') <> 'active'
      ORDER BY trial_end_at ASC
      LIMIT 50`
  );

  return {
    status: result.ok ? 'ok' : 'degraded',
    expiredCount: result.rows.length,
    providers: result.rows,
    error: result.error,
  };
}

async function getWhatsAppNotificationStatus() {
  const configured = Boolean(
    process.env.WHATSAPP_BUSINESS_ACCESS_TOKEN ||
    process.env.WHATSAPP_ACCESS_TOKEN ||
    process.env.META_WHATSAPP_TOKEN
  );
  const phoneConfigured = Boolean(process.env.WHATSAPP_PHONE_NUMBER_ID || process.env.META_WHATSAPP_PHONE_NUMBER_ID);
  const logs = await safeQuery(
    `SELECT status, COUNT(*)::int AS count
       FROM ng_pharmacy_whatsapp_notifications
      GROUP BY status
      ORDER BY status`
  );

  return {
    automatedApiConfigured: configured && phoneConfigured,
    tokenConfigured: configured,
    phoneNumberIdConfigured: phoneConfigured,
    manualFallbackRequired: !(configured && phoneConfigured),
    logStatus: logs.ok ? 'ok' : 'unavailable',
    logs: logs.rows,
    error: logs.error,
  };
}

async function prepareWhatsAppMessage(input = {}) {
  const dashboardUrl = input.dashboardUrl || 'https://doctarx.com/ng/pharmacy/prescriptions';
  return {
    message:
      `DoctaRx prescription notification: You have a new prescription request. Please log in to your pharmacy dashboard to review details: ${dashboardUrl}`,
    privacyNotes: [
      'No diagnosis or full prescription details are included in the WhatsApp text.',
      'Full details stay behind authenticated pharmacy dashboard access.',
    ],
    requiresApprovalBeforeSending: true,
  };
}

async function draftPartnershipMessage(input = {}) {
  const audience = input.audience || 'organisation';
  return {
    audience,
    subject: 'Partner with DoctaRx Nigeria for easier healthcare access',
    body:
      `Hello,\n\nDoctaRx Nigeria helps ${audience}s connect people to online consultations, prescription follow-through, and pharmacy coordination without forcing patients through a monthly subscription. We would like to discuss a practical partnership model for your team, members, or community.\n\nRegards,\nDoctaRx Nigeria`,
    requiresApprovalBeforeSending: true,
  };
}

const TOOLS = {
  scanRoutes,
  checkMissingLoginRoutes,
  verifyTestAccountVisibility,
  getPendingPharmacyOnboardings,
  getProviderUsage,
  getExpiredProviderTrials,
  getWhatsAppNotificationStatus,
  prepareWhatsAppMessage,
  draftPartnershipMessage,
};

function getTool(name) {
  return TOOLS[name] || null;
}

function listTools() {
  return Object.keys(TOOLS).map((name) => ({ name }));
}

module.exports = {
  getTool,
  listTools,
};
