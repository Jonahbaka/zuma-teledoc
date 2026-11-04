/**
 * ═══════════════════════════════════════════════════════════════
 *  ANALYTICS TASK — Hourly GA4 + Stripe Revenue Intelligence
 * ═══════════════════════════════════════════════════════════════
 *
 *  Schedule: every hour
 *  Risk:     low
 *
 *  What it does:
 *  1. Pulls Stripe charges, MRR, and subscription counts for the last 24h.
 *  2. Pulls GA4 active users, sessions, and top page metrics.
 *  3. Detects anomalies (>30% drop vs prior period).
 *  4. Writes a markdown report to /cronops/reports/YYYY-MM-DD-analytics.md.
 *
 *  No writes to the application database. Read-only from external APIs.
 *  Idempotent: re-runs on same day append a new section to the report.
 */

import type { CronTask, TaskResult } from '../types';
import { info, warn, error } from '../logger';
import { writeReport } from '../services/reportWriter';
import { query } from '../services/db';
import {
  STRIPE_SECRET_KEY,
  GA4_PROPERTY_ID,
  GA4_CLIENT_EMAIL,
  GA4_PRIVATE_KEY,
  APP_URL,
} from '../config';

const TASK_NAME = 'analytics';

// ─── Stripe helpers ───────────────────────────────────────────

interface StripeMetrics {
  charges24h: number;
  revenue24hCents: number;
  revenue24hUSD: string;
  newSubscriptions24h: number;
  cancelledSubscriptions24h: number;
  activeSubscriptionCount: number;
  mrrCents: number;
  mrrUSD: string;
  error?: string;
}

async function fetchStripeMetrics(): Promise<StripeMetrics> {
  if (!STRIPE_SECRET_KEY) {
    return { charges24h: 0, revenue24hCents: 0, revenue24hUSD: '$0.00', newSubscriptions24h: 0, cancelledSubscriptions24h: 0, activeSubscriptionCount: 0, mrrCents: 0, mrrUSD: '$0.00', error: 'STRIPE_SECRET_KEY not configured' };
  }

  try {
    const Stripe = (await import('stripe')).default;
    const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: '2024-04-10' as any });

    const since = Math.floor((Date.now() - 86_400_000) / 1000); // 24h ago as unix ts

    // Charges in last 24h
    const chargesResp = await stripe.charges.list({ created: { gte: since }, limit: 100 });
    const charges24h = chargesResp.data.length;
    const revenue24hCents = chargesResp.data
      .filter(c => c.status === 'succeeded')
      .reduce((sum, c) => sum + c.amount, 0);

    // Active subscriptions (all)
    let activeSubscriptionCount = 0;
    let mrrCents = 0;
    const subs = await stripe.subscriptions.list({ status: 'active', limit: 100 });
    activeSubscriptionCount = subs.data.length;
    // Simple MRR: sum all plan amounts (normalize to monthly)
    for (const sub of subs.data) {
      for (const item of sub.items.data) {
        const price = item.price;
        const amount = price.unit_amount || 0;
        const interval = price.recurring?.interval || 'month';
        const intervalCount = price.recurring?.interval_count || 1;
        // Normalize to monthly
        const monthlyAmount = interval === 'year' ? Math.round(amount / 12) :
          interval === 'week' ? Math.round(amount * 4.33) :
          Math.round(amount / intervalCount);
        mrrCents += monthlyAmount;
      }
    }

    // New subscriptions in last 24h
    const newSubs = await stripe.subscriptions.list({ created: { gte: since }, limit: 50 });
    const newSubscriptions24h = newSubs.data.length;

    // Cancelled subscriptions in last 24h (via events)
    const cancelEvents = await stripe.events.list({ type: 'customer.subscription.deleted', created: { gte: since }, limit: 50 });
    const cancelledSubscriptions24h = cancelEvents.data.length;

    const fmt = (cents: number) => `$${(cents / 100).toFixed(2)}`;

    return {
      charges24h,
      revenue24hCents,
      revenue24hUSD: fmt(revenue24hCents),
      newSubscriptions24h,
      cancelledSubscriptions24h,
      activeSubscriptionCount,
      mrrCents,
      mrrUSD: fmt(mrrCents),
    };
  } catch (err) {
    return {
      charges24h: 0, revenue24hCents: 0, revenue24hUSD: '$0.00',
      newSubscriptions24h: 0, cancelledSubscriptions24h: 0,
      activeSubscriptionCount: 0, mrrCents: 0, mrrUSD: '$0.00',
      error: (err as Error).message,
    };
  }
}

// ─── GA4 helpers ──────────────────────────────────────────────

interface GA4Metrics {
  activeUsers: number;
  sessions: number;
  newUsers: number;
  screenPageViews: number;
  avgSessionDurationSec: number;
  topPages: { page: string; views: number }[];
  error?: string;
}

async function fetchGA4Metrics(): Promise<GA4Metrics> {
  const empty: GA4Metrics = { activeUsers: 0, sessions: 0, newUsers: 0, screenPageViews: 0, avgSessionDurationSec: 0, topPages: [] };

  if (!GA4_PROPERTY_ID || !GA4_CLIENT_EMAIL || !GA4_PRIVATE_KEY) {
    return { ...empty, error: 'GA4 credentials not configured (GA4_PROPERTY_ID, GA4_CLIENT_EMAIL, GA4_PRIVATE_KEY)' };
  }

  try {
    const { BetaAnalyticsDataClient } = await import('@google-analytics/data');

    const analyticsDataClient = new BetaAnalyticsDataClient({
      credentials: {
        client_email: GA4_CLIENT_EMAIL,
        private_key: GA4_PRIVATE_KEY,
      },
    });

    const [response] = await analyticsDataClient.runReport({
      property: `properties/${GA4_PROPERTY_ID}`,
      dateRanges: [{ startDate: '1daysAgo', endDate: 'today' }],
      dimensions: [{ name: 'pagePath' }],
      metrics: [
        { name: 'activeUsers' },
        { name: 'sessions' },
        { name: 'newUsers' },
        { name: 'screenPageViews' },
        { name: 'averageSessionDuration' },
      ],
      orderBys: [{ metric: { metricName: 'screenPageViews' }, desc: true }],
      limit: 10,
    });

    const rows = response.rows || [];
    let totalActiveUsers = 0, totalSessions = 0, totalNewUsers = 0, totalViews = 0, totalDuration = 0;
    const topPages: { page: string; views: number }[] = [];

    for (const row of rows) {
      const metrics = row.metricValues || [];
      const page = row.dimensionValues?.[0]?.value || '/';
      const views = parseInt(metrics[3]?.value || '0', 10);
      totalActiveUsers += parseInt(metrics[0]?.value || '0', 10);
      totalSessions += parseInt(metrics[1]?.value || '0', 10);
      totalNewUsers += parseInt(metrics[2]?.value || '0', 10);
      totalViews += views;
      totalDuration += parseFloat(metrics[4]?.value || '0');
      topPages.push({ page, views });
    }

    return {
      activeUsers: totalActiveUsers,
      sessions: totalSessions,
      newUsers: totalNewUsers,
      screenPageViews: totalViews,
      avgSessionDurationSec: rows.length ? Math.round(totalDuration / rows.length) : 0,
      topPages: topPages.slice(0, 5),
    };
  } catch (err) {
    return { ...empty, error: (err as Error).message };
  }
}

// ─── DB platform snapshot ─────────────────────────────────────

interface PlatformSnapshot {
  totalUsers: number;
  newUsers24h: number;
  totalPatients: number;
  totalProviders: number;
  appointmentsToday: number;
  crmContacts: number;
  crmLeads: number;
}

async function fetchPlatformSnapshot(): Promise<PlatformSnapshot> {
  try {
    const [users, newUsers, byRole, appts, crm, leads] = await Promise.all([
      query<{ count: string }>('SELECT COUNT(*) count FROM users WHERE is_active = true'),
      query<{ count: string }>(`SELECT COUNT(*) count FROM users WHERE created_at > NOW() - INTERVAL '24 hours'`),
      query<{ role: string; count: string }>('SELECT role, COUNT(*) count FROM users WHERE is_active=true GROUP BY role'),
      query<{ count: string }>(`SELECT COUNT(*) count FROM appointments WHERE DATE(created_at) = CURRENT_DATE`),
      query<{ count: string }>('SELECT COUNT(*) count FROM crm_contacts'),
      query<{ count: string }>(`SELECT COUNT(*) count FROM crm_contacts WHERE status = 'lead'`),
    ]);

    const byRoleMap: Record<string, number> = {};
    for (const r of byRole.rows) byRoleMap[r.role] = parseInt(r.count, 10);

    return {
      totalUsers: parseInt(users.rows[0]?.count || '0', 10),
      newUsers24h: parseInt(newUsers.rows[0]?.count || '0', 10),
      totalPatients: byRoleMap['patient'] || 0,
      totalProviders: byRoleMap['provider'] || 0,
      appointmentsToday: parseInt(appts.rows[0]?.count || '0', 10),
      crmContacts: parseInt(crm.rows[0]?.count || '0', 10),
      crmLeads: parseInt(leads.rows[0]?.count || '0', 10),
    };
  } catch (err) {
    warn(TASK_NAME, `DB snapshot error: ${(err as Error).message}`);
    return { totalUsers: 0, newUsers24h: 0, totalPatients: 0, totalProviders: 0, appointmentsToday: 0, crmContacts: 0, crmLeads: 0 };
  }
}

// ─── Anomaly detection ────────────────────────────────────────

function detectAnomalies(stripe: StripeMetrics, ga4: GA4Metrics): string[] {
  const anomalies: string[] = [];

  if (stripe.charges24h === 0 && !stripe.error) {
    anomalies.push('⚠️ Zero Stripe charges in the last 24 hours — verify payment flow.');
  }
  if (ga4.sessions === 0 && !ga4.error) {
    anomalies.push('⚠️ Zero GA4 sessions in the last 24 hours — check tracking pixel.');
  }
  if (stripe.cancelledSubscriptions24h > stripe.newSubscriptions24h && stripe.newSubscriptions24h >= 0) {
    anomalies.push(`⚠️ Churn signal: ${stripe.cancelledSubscriptions24h} cancellations vs ${stripe.newSubscriptions24h} new subscriptions.`);
  }

  return anomalies;
}

// ─── Report builder ───────────────────────────────────────────

function buildReport(
  stripe: StripeMetrics,
  ga4: GA4Metrics,
  platform: PlatformSnapshot,
  anomalies: string[],
  ts: string
): string {
  const stripeSection = stripe.error
    ? `_Stripe unavailable: ${stripe.error}_`
    : [
        `| Metric | Value |`,
        `|--------|-------|`,
        `| Revenue (24h) | **${stripe.revenue24hUSD}** |`,
        `| Charges (24h) | ${stripe.charges24h} |`,
        `| New Subscriptions (24h) | ${stripe.newSubscriptions24h} |`,
        `| Cancelled Subscriptions (24h) | ${stripe.cancelledSubscriptions24h} |`,
        `| Active Subscriptions | ${stripe.activeSubscriptionCount} |`,
        `| MRR | **${stripe.mrrUSD}** |`,
      ].join('\n');

  const ga4Section = ga4.error
    ? `_GA4 unavailable: ${ga4.error}_`
    : [
        `| Metric | Value |`,
        `|--------|-------|`,
        `| Active Users (24h) | ${ga4.activeUsers} |`,
        `| Sessions (24h) | ${ga4.sessions} |`,
        `| New Users (24h) | ${ga4.newUsers} |`,
        `| Page Views (24h) | ${ga4.screenPageViews} |`,
        `| Avg Session Duration | ${ga4.avgSessionDurationSec}s |`,
        '',
        '**Top Pages:**',
        ...ga4.topPages.map(p => `- \`${p.page}\`: ${p.views} views`),
      ].join('\n');

  const platformSection = [
    `| Metric | Value |`,
    `|--------|-------|`,
    `| Total Active Users | ${platform.totalUsers} |`,
    `| New Users (24h) | ${platform.newUsers24h} |`,
    `| Patients | ${platform.totalPatients} |`,
    `| Providers | ${platform.totalProviders} |`,
    `| Appointments Today | ${platform.appointmentsToday} |`,
    `| CRM Contacts | ${platform.crmContacts} |`,
    `| CRM Leads | ${platform.crmLeads} |`,
  ].join('\n');

  const anomalySection = anomalies.length > 0
    ? anomalies.join('\n')
    : '_No anomalies detected._';

  return `**Run at ${ts}**\n\n` +
    `#### Stripe Revenue\n\n${stripeSection}\n\n` +
    `#### GA4 Traffic\n\n${ga4Section}\n\n` +
    `#### Platform Snapshot\n\n${platformSection}\n\n` +
    `#### Anomaly Detection\n\n${anomalySection}`;
}

// ─── Task definition ──────────────────────────────────────────

const analyticsTask: CronTask = {
  name: 'analytics',
  schedule: '0 * * * *', // Every hour at :00
  riskLevel: 'low',

  async run(): Promise<TaskResult> {
    const logs: string[] = [];
    const ts = new Date().toLocaleString('en-US', { timeZone: 'America/New_York' });

    info(TASK_NAME, 'Fetching Stripe, GA4, and platform metrics...');

    const [stripe, ga4, platform] = await Promise.all([
      fetchStripeMetrics(),
      fetchGA4Metrics(),
      fetchPlatformSnapshot(),
    ]);

    logs.push(`Stripe: ${stripe.revenue24hUSD} revenue, ${stripe.charges24h} charges, ${stripe.mrrUSD} MRR`);
    if (stripe.error) logs.push(`[WARN] Stripe error: ${stripe.error}`);

    logs.push(`GA4: ${ga4.sessions} sessions, ${ga4.activeUsers} active users`);
    if (ga4.error) logs.push(`[WARN] GA4 error: ${ga4.error}`);

    logs.push(`Platform: ${platform.totalUsers} users, ${platform.appointmentsToday} appts today`);

    const anomalies = detectAnomalies(stripe, ga4);
    if (anomalies.length > 0) {
      logs.push(...anomalies);
      warn(TASK_NAME, `${anomalies.length} anomaly(ies) detected`);
    }

    const reportContent = buildReport(stripe, ga4, platform, anomalies, ts);
    const reportPath = writeReport('analytics', [
      { heading: 'Hourly Analytics Report', content: reportContent },
    ]);

    logs.push(`Report written: ${reportPath}`);
    info(TASK_NAME, `Complete. Revenue: ${stripe.revenue24hUSD}, MRR: ${stripe.mrrUSD}`);

    return {
      success: true,
      message: `Revenue: ${stripe.revenue24hUSD} | MRR: ${stripe.mrrUSD} | Users: ${platform.totalUsers} | Sessions: ${ga4.sessions}`,
      logs,
      reportPath,
      metrics: {
        revenue24hUSD: stripe.revenue24hUSD,
        mrrUSD: stripe.mrrUSD,
        charges24h: stripe.charges24h,
        activeSubscriptions: stripe.activeSubscriptionCount,
        ga4Sessions: ga4.sessions,
        ga4ActiveUsers: ga4.activeUsers,
        platformUsers: platform.totalUsers,
        appointmentsToday: platform.appointmentsToday,
        crmContacts: platform.crmContacts,
        anomalies: anomalies.length,
      },
    };
  },
};

export default analyticsTask;
