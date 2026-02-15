const express = require('express');
const crypto = require('crypto');
const db = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');

const router = express.Router();

let schemaReady = false;
const fallbackEvents = [];
let lastGrowthActionAt = 0;
let lastGrowthAction = null;
let gaTokenCache = { token: null, expiresAt: 0 };

async function ensureSchema() {
  if (schemaReady) return;
  await db.query(`
    CREATE TABLE IF NOT EXISTS realtime_analytics_events (
      id BIGSERIAL PRIMARY KEY,
      session_id TEXT NOT NULL,
      event_type TEXT NOT NULL DEFAULT 'page_view',
      page_path TEXT,
      page_title TEXT,
      source TEXT,
      referrer TEXT,
      device_type TEXT,
      country TEXT,
      city TEXT,
      user_agent TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_realtime_analytics_events_created_at
      ON realtime_analytics_events(created_at DESC)
  `);
  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_realtime_analytics_events_session
      ON realtime_analytics_events(session_id, created_at DESC)
  `);
  schemaReady = true;
}

function base64Url(input) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function getGaConfig() {
  const propertyId = process.env.GA4_PROPERTY_ID || process.env.GA_PROPERTY_ID || '';
  const clientEmail = process.env.GA4_CLIENT_EMAIL || '';
  const privateKeyRaw = process.env.GA4_PRIVATE_KEY || '';
  const privateKey = privateKeyRaw.replace(/\\n/g, '\n');
  return { propertyId, clientEmail, privateKey };
}

function hasGaConfig() {
  const cfg = getGaConfig();
  return Boolean(cfg.propertyId && cfg.clientEmail && cfg.privateKey);
}

async function getGaAccessToken() {
  const now = Date.now();
  if (gaTokenCache.token && gaTokenCache.expiresAt > now + 30_000) {
    return gaTokenCache.token;
  }

  const { clientEmail, privateKey } = getGaConfig();
  const iat = Math.floor(now / 1000);
  const exp = iat + 3600;
  const header = { alg: 'RS256', typ: 'JWT' };
  const claimSet = {
    iss: clientEmail,
    scope: 'https://www.googleapis.com/auth/analytics.readonly',
    aud: 'https://oauth2.googleapis.com/token',
    iat,
    exp
  };
  const unsigned = `${base64Url(JSON.stringify(header))}.${base64Url(JSON.stringify(claimSet))}`;
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(unsigned);
  signer.end();
  const signature = signer.sign(privateKey).toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
  const assertion = `${unsigned}.${signature}`;

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion
    })
  });
  if (!tokenRes.ok) {
    throw new Error(`GA token request failed (${tokenRes.status})`);
  }
  const tokenJson = await tokenRes.json();
  gaTokenCache = {
    token: tokenJson.access_token,
    expiresAt: now + ((tokenJson.expires_in || 3600) * 1000)
  };
  return gaTokenCache.token;
}

async function runGaRealtimeReport(body) {
  const token = await getGaAccessToken();
  const { propertyId } = getGaConfig();
  const url = `https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runRealtimeReport`;
  const reportRes = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify(body)
  });
  if (!reportRes.ok) {
    const msg = await reportRes.text();
    throw new Error(`GA realtime report failed (${reportRes.status}): ${msg}`);
  }
  return reportRes.json();
}

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

const COUNTRY_BY_CODE = {
  US: 'United States',
  CA: 'Canada',
  GB: 'United Kingdom',
  UK: 'United Kingdom',
  AU: 'Australia',
  IN: 'India',
  DE: 'Germany',
  FR: 'France',
  ES: 'Spain',
  IT: 'Italy',
  BR: 'Brazil',
  MX: 'Mexico',
  ZA: 'South Africa',
  NG: 'Nigeria',
  JP: 'Japan'
};

const TZ_TO_COUNTRY = {
  'America/New_York': 'United States',
  'America/Chicago': 'United States',
  'America/Denver': 'United States',
  'America/Los_Angeles': 'United States',
  'America/Toronto': 'Canada',
  'Europe/London': 'United Kingdom',
  'Europe/Berlin': 'Germany',
  'Europe/Paris': 'France',
  'Asia/Kolkata': 'India',
  'Asia/Tokyo': 'Japan',
  'Australia/Sydney': 'Australia'
};

function normalizeCountry(raw) {
  const value = String(raw || '').trim();
  if (!value) return 'Unknown';
  const lower = value.toLowerCase();
  if (lower === '(not set)' || lower === 'not set' || lower === 'unknown' || lower === 'undefined' || lower === 'null') {
    return 'Unknown';
  }
  if (value.length === 2) {
    return COUNTRY_BY_CODE[value.toUpperCase()] || value.toUpperCase();
  }
  return value;
}

function inferCountryFromLocale(locale) {
  const token = String(locale || '').trim();
  if (!token.includes('-')) return 'Unknown';
  const code = token.split('-').pop();
  return normalizeCountry(code);
}

function inferCountry({
  headerCountry,
  bodyCountry,
  locale,
  timeZone
}) {
  const first = normalizeCountry(headerCountry);
  if (first !== 'Unknown') return first;

  const provided = normalizeCountry(bodyCountry);
  if (provided !== 'Unknown') return provided;

  const byLocale = inferCountryFromLocale(locale);
  if (byLocale !== 'Unknown') return byLocale;

  const tz = String(timeZone || '').trim();
  if (tz && TZ_TO_COUNTRY[tz]) return TZ_TO_COUNTRY[tz];

  return 'Unknown';
}

async function getGaOverview() {
  const [summary, byMinute, bySource, byCountry, byPage] = await Promise.all([
    runGaRealtimeReport({ metrics: [{ name: 'activeUsers' }] }),
    runGaRealtimeReport({
      dimensions: [{ name: 'minutesAgo' }],
      metrics: [{ name: 'activeUsers' }],
      limit: 30,
      orderBys: [{ dimension: { dimensionName: 'minutesAgo', orderType: 'NUMERIC' } }]
    }),
    runGaRealtimeReport({
      dimensions: [{ name: 'firstUserSource' }],
      metrics: [{ name: 'activeUsers' }],
      limit: 5
    }),
    runGaRealtimeReport({
      dimensions: [{ name: 'country' }],
      metrics: [{ name: 'activeUsers' }],
      limit: 10
    }),
    runGaRealtimeReport({
      dimensions: [{ name: 'unifiedPagePathScreen' }],
      metrics: [{ name: 'screenPageViews' }],
      limit: 5
    }).catch(() => ({
      rows: [],
      totals: [],
      rowCount: 0
    }))
  ]);

  const activeUsers30m = toNumber(summary?.totals?.[0]?.metricValues?.[0]?.value || 0);
  const minuteRows = byMinute?.rows || [];
  const minuteMap = new Map(minuteRows.map((row) => [
    toNumber(row.dimensionValues?.[0]?.value),
    toNumber(row.metricValues?.[0]?.value)
  ]));
  const trafficSeries = Array.from({ length: 30 }, (_v, idx) => {
    const minuteOffset = 29 - idx;
    return {
      minuteOffset,
      activeUsers: minuteMap.get(minuteOffset) || 0
    };
  });
  const activeUsers5m = trafficSeries.slice(-5).reduce((sum, p) => sum + p.activeUsers, 0);
  const activeUsersPerMinute = Math.round((activeUsers30m / 30) * 10) / 10;

  const sources = (bySource?.rows || []).map((row) => ({
    source: row.dimensionValues?.[0]?.value || '(direct)',
    activeUsers: toNumber(row.metricValues?.[0]?.value)
  }));
  const sourceTotal = sources.reduce((sum, s) => sum + s.activeUsers, 0) || 1;
  const normalizedSources = sources.map((s) => ({
    ...s,
    share: Math.round((s.activeUsers / sourceTotal) * 1000) / 10
  }));

  const pages = (byPage?.rows || []).map((row) => {
    const path = row.dimensionValues?.[0]?.value || '/';
    return {
      title: path === '/' ? 'DoctaRx | Telehealth & E-Prescribing Platform' : path,
      path,
      views: toNumber(row.metricValues?.[0]?.value)
    };
  });
  const totalViews = pages.reduce((sum, p) => sum + p.views, 0) || 1;
  const normalizedPages = pages.map((p) => ({
    ...p,
    share: Math.round((p.views / totalViews) * 1000) / 10
  }));

  const topCountries = (byCountry?.rows || []).map((row) => ({
    country: normalizeCountry(row.dimensionValues?.[0]?.value),
    activeUsers: toNumber(row.metricValues?.[0]?.value)
  }));

  return {
    provider: 'ga4',
    activeUsers30m,
    activeUsers5m,
    activeUsersPerMinute,
    trafficSeries,
    sources: normalizedSources,
    audiences: [{ name: 'All Users', activeUsers: activeUsers30m, share: 100 }],
    pages: normalizedPages,
    topCountries,
    growthBot: {
      status: activeUsers30m < 5
        ? 'Traffic low. Recommend growth mission.'
        : activeUsers30m > 40
          ? 'Traffic strong. Optimize conversion.'
          : 'Traffic stable. Monitoring.',
      lastAction: lastGrowthAction
    }
  };
}

function deriveSource(source, referrer) {
  if (source && String(source).trim()) return String(source).trim();
  if (!referrer) return '(direct)';
  try {
    const host = new URL(referrer).hostname;
    if (!host) return '(direct)';
    if (host.includes('google')) return 'google / organic';
    if (host.includes('facebook')) return 'facebook / social';
    if (host.includes('linkedin')) return 'linkedin / social';
    if (host.includes('twitter') || host.includes('x.com')) return 'x / social';
    return `${host} / referral`;
  } catch {
    return '(direct)';
  }
}

function deriveDeviceType(userAgent = '') {
  const ua = String(userAgent).toLowerCase();
  if (ua.includes('mobile')) return 'mobile';
  if (ua.includes('tablet') || ua.includes('ipad')) return 'tablet';
  return 'desktop';
}

function pushFallbackEvent(event) {
  fallbackEvents.push(event);
  const cutoff = Date.now() - (30 * 60 * 1000);
  while (fallbackEvents.length > 0 && new Date(fallbackEvents[0].created_at).getTime() < cutoff) {
    fallbackEvents.shift();
  }
}

// Public tracking endpoint (no auth) for page views.
router.post('/track', async (req, res) => {
  const body = req.body || {};
  const nowIso = new Date().toISOString();
  const incomingSession = body.sessionId || req.cookies?.drx_rt_sid;
  const sessionId = incomingSession || `sid_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const userAgent = req.get('user-agent') || '';

  const event = {
    session_id: sessionId,
    event_type: body.eventType || 'page_view',
    page_path: body.path || '/',
    page_title: body.title || '',
    source: deriveSource(body.source, body.referrer || req.get('referer')),
    referrer: body.referrer || req.get('referer') || '',
    device_type: body.deviceType || deriveDeviceType(userAgent),
    country: inferCountry({
      headerCountry: req.get('x-vercel-ip-country') || req.get('cf-ipcountry') || req.get('x-country-code'),
      bodyCountry: body.country,
      locale: body.locale,
      timeZone: body.timeZone
    }),
    city: req.get('x-vercel-ip-city') || 'Unknown',
    user_agent: userAgent,
    created_at: nowIso
  };

  if (!incomingSession) {
    res.cookie('drx_rt_sid', sessionId, {
      httpOnly: false,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 1000 * 60 * 60 * 24 * 30
    });
  }

  try {
    await ensureSchema();
    await db.query(`
      INSERT INTO realtime_analytics_events (
        session_id, event_type, page_path, page_title, source, referrer,
        device_type, country, city, user_agent
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
    `, [
      event.session_id,
      event.event_type,
      event.page_path,
      event.page_title,
      event.source,
      event.referrer,
      event.device_type,
      event.country,
      event.city,
      event.user_agent
    ]);
  } catch {
    pushFallbackEvent(event);
  }

  return res.json({ success: true });
});

const adminOnly = [authenticate, requireRole('admin', 'super_admin')];

router.get('/overview', ...adminOnly, async (_req, res) => {
  if (hasGaConfig()) {
    try {
      const data = await getGaOverview();
      return res.json({ success: true, data });
    } catch {
      // Fall back to internal if GA is configured but unavailable.
    }
  }

  try {
    await ensureSchema();

    const [active30Res, active5Res, seriesRes, sourcesRes, pagesRes, countriesRes] = await Promise.all([
      db.query(`SELECT COUNT(DISTINCT session_id) AS c FROM realtime_analytics_events WHERE created_at > NOW() - INTERVAL '30 minutes'`),
      db.query(`SELECT COUNT(DISTINCT session_id) AS c FROM realtime_analytics_events WHERE created_at > NOW() - INTERVAL '5 minutes'`),
      db.query(`
        WITH buckets AS (
          SELECT generate_series(
            date_trunc('minute', NOW() - INTERVAL '29 minutes'),
            date_trunc('minute', NOW()),
            INTERVAL '1 minute'
          ) AS bucket
        ),
        events AS (
          SELECT date_trunc('minute', created_at) AS bucket, COUNT(DISTINCT session_id) AS active_users
          FROM realtime_analytics_events
          WHERE created_at > NOW() - INTERVAL '30 minutes'
          GROUP BY 1
        )
        SELECT b.bucket, COALESCE(e.active_users, 0) AS active_users
        FROM buckets b
        LEFT JOIN events e ON e.bucket = b.bucket
        ORDER BY b.bucket
      `),
      db.query(`
        WITH first_source AS (
          SELECT DISTINCT ON (session_id)
            session_id, COALESCE(NULLIF(source, ''), '(direct)') AS src
          FROM realtime_analytics_events
          WHERE created_at > NOW() - INTERVAL '30 minutes'
          ORDER BY session_id, created_at ASC
        )
        SELECT src AS source, COUNT(*)::int AS active_users
        FROM first_source
        GROUP BY src
        ORDER BY active_users DESC
        LIMIT 5
      `),
      db.query(`
        SELECT
          COALESCE(NULLIF(page_title, ''), 'Untitled') AS title,
          COALESCE(NULLIF(page_path, ''), '/') AS path,
          COUNT(*)::int AS views
        FROM realtime_analytics_events
        WHERE created_at > NOW() - INTERVAL '30 minutes'
        GROUP BY 1,2
        ORDER BY views DESC
        LIMIT 5
      `),
      db.query(`
        SELECT COALESCE(NULLIF(country, ''), 'Unknown') AS country, COUNT(DISTINCT session_id)::int AS active_users
        FROM realtime_analytics_events
        WHERE created_at > NOW() - INTERVAL '30 minutes'
        GROUP BY 1
        ORDER BY active_users DESC
        LIMIT 5
      `)
    ]);

    const activeUsers30m = parseInt(active30Res.rows[0]?.c || '0', 10);
    const activeUsers5m = parseInt(active5Res.rows[0]?.c || '0', 10);
    const activeUsersPerMinute = Math.round((activeUsers30m / 30) * 10) / 10;
    const totalSourceUsers = sourcesRes.rows.reduce((sum, s) => sum + (s.active_users || 0), 0) || 1;
    const totalViews = pagesRes.rows.reduce((sum, p) => sum + (p.views || 0), 0) || 1;

    return res.json({
      success: true,
      data: {
        activeUsers30m,
        activeUsers5m,
        activeUsersPerMinute,
        trafficSeries: seriesRes.rows.map((r, i) => ({
          minuteOffset: 30 - (i + 1),
          activeUsers: parseInt(r.active_users || 0, 10)
        })),
        sources: sourcesRes.rows.map(s => ({
          source: s.source,
          activeUsers: s.active_users,
          share: Math.round((s.active_users / totalSourceUsers) * 1000) / 10
        })),
        audiences: [{ name: 'All Users', activeUsers: activeUsers30m, share: 100 }],
        pages: pagesRes.rows.map(p => ({
          title: p.title,
          path: p.path,
          views: p.views,
          share: Math.round((p.views / totalViews) * 1000) / 10
        })),
        topCountries: countriesRes.rows.map((r) => ({
          country: normalizeCountry(r.country),
          activeUsers: r.active_users
        })),
        provider: 'internal',
        growthBot: {
          status: activeUsers30m < 5
            ? 'Traffic low. Recommend growth mission.'
            : activeUsers30m > 40
              ? 'Traffic strong. Optimize conversion.'
              : 'Traffic stable. Monitoring.',
          lastAction: lastGrowthAction
        }
      }
    });
  } catch (_err) {
    // Fallback to in-memory if DB is unavailable.
    const now = Date.now();
    const cutoff30 = now - (30 * 60 * 1000);
    const cutoff5 = now - (5 * 60 * 1000);
    const events = fallbackEvents.filter(e => new Date(e.created_at).getTime() >= cutoff30);
    const unique30 = new Set(events.map(e => e.session_id));
    const unique5 = new Set(events.filter(e => new Date(e.created_at).getTime() >= cutoff5).map(e => e.session_id));

    return res.json({
      success: true,
      data: {
        activeUsers30m: unique30.size,
        activeUsers5m: unique5.size,
        activeUsersPerMinute: Math.round((unique30.size / 30) * 10) / 10,
        trafficSeries: Array.from({ length: 30 }).map((_v, idx) => ({ minuteOffset: 29 - idx, activeUsers: 0 })),
        sources: [{ source: '(direct)', activeUsers: unique30.size, share: 100 }],
        audiences: [{ name: 'All Users', activeUsers: unique30.size, share: 100 }],
        pages: [],
        topCountries: [],
        growthBot: { status: 'Running in fallback mode.', lastAction: lastGrowthAction }
      }
    });
  }
});

router.post('/growth/act', ...adminOnly, async (_req, res) => {
  const now = Date.now();
  if (now - lastGrowthActionAt < 60 * 1000) {
    return res.json({ success: true, data: { executed: false, reason: 'cooldown', lastAction: lastGrowthAction } });
  }

  const action = {
    action: 'Triggered growth wake-up + web missions',
    at: new Date().toISOString()
  };

  try {
    const orchestrator = require('../services/agent-orchestrator');
    if (orchestrator?.heartbeat?.wakeUp) {
      await orchestrator.heartbeat.wakeUp();
    } else {
      if (orchestrator?.emitEvent) {
        await orchestrator.emitEvent('growth.metrics.changed', { source: 'realtime_analytics', reason: 'manual_growth_action' });
      }
      if (orchestrator?.triggerWorkflow) {
        await orchestrator.triggerWorkflow('crm.lead.harvest', { trigger: 'realtime_growth_action' });
      }
    }
    lastGrowthActionAt = now;
    lastGrowthAction = action;
    return res.json({ success: true, data: { executed: true, action } });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
module.exports.getGaOverview = getGaOverview;
module.exports.hasGaConfig = hasGaConfig;
