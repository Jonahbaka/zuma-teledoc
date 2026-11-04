'use client';

/**
 * GoogleAnalytics — GA4 via native gtag.js
 *
 * Design decisions:
 * - Single tracking path: native gtag only (react-ga4 removed to eliminate duplicate hits)
 * - send_page_view: false on init → we fire exactly ONE page_view per SPA route change
 * - gtag.js script only loads in production → dev traffic never pollutes GA data
 * - gtag function always defined → window.gtag() calls never throw in dev mode
 * - NEXT_PUBLIC_GA_MEASUREMENT_ID must be set at build time (embedded into JS bundle)
 */

import { useEffect, Suspense } from 'react';
import Script from 'next/script';
import { usePathname, useSearchParams } from 'next/navigation';

const GA_MEASUREMENT_ID = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID;
const IS_PROD = process.env.NODE_ENV === 'production';

// ─── Internal Realtime Session (unchanged) ────────────────────────────────
function getRealtimeSessionId() {
  if (typeof window === 'undefined') return null;
  const key = 'drx_rt_sid';
  let sid = localStorage.getItem(key);
  if (!sid) {
    sid = `sid_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    localStorage.setItem(key, sid);
  }
  return sid;
}

function inferSource(searchParams) {
  const utmSource = searchParams?.get?.('utm_source');
  if (utmSource) return `${utmSource} / campaign`;
  if (typeof document === 'undefined' || !document.referrer) return '(direct)';
  try {
    const host = new URL(document.referrer).hostname;
    return host ? `${host} / referral` : '(direct)';
  } catch {
    return '(direct)';
  }
}

function trackRealtimePageView(pathname, searchParams) {
  if (typeof window === 'undefined' || !pathname) return;
  const payload = {
    sessionId: getRealtimeSessionId(),
    eventType: 'page_view',
    path: pathname + (searchParams?.toString() ? `?${searchParams.toString()}` : ''),
    title: document.title || '',
    referrer: document.referrer || '',
    source: inferSource(searchParams),
    deviceType: /mobile/i.test(navigator.userAgent) ? 'mobile' : 'desktop',
    locale: navigator.language || '',
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || ''
  };

  const url = '/api/realtime-analytics/track';
  try {
    const json = JSON.stringify(payload);
    if (navigator.sendBeacon) {
      navigator.sendBeacon(url, new Blob([json], { type: 'application/json' }));
      return;
    }
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: json,
      keepalive: true
    }).catch(() => {});
  } catch {
    // Tracking must never break UX.
  }
}

// ─── SPA Route Tracker (inner — needs Suspense for useSearchParams) ────────
function GoogleAnalyticsInner() {
  const pathname    = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    if (!pathname) return;

    const url = pathname + (searchParams?.toString() ? `?${searchParams.toString()}` : '');

    // Fire exactly one page_view per route change via native gtag.
    // We use gtag('event', 'page_view') — not gtag('config') — so we don't
    // accidentally re-initialize the tracker or double-fire on SPA transitions.
    if (typeof window !== 'undefined' && window.gtag && GA_MEASUREMENT_ID) {
      window.gtag('event', 'page_view', {
        page_path:     url,
        page_title:    typeof document !== 'undefined' ? document.title : '',
        page_location: typeof window  !== 'undefined' ? window.location.href : ''
      });

      if (!IS_PROD) {
        console.log(`[GA4 Debug] page_view → ${url}`);
      }
    }

    // Internal realtime tracking always runs (feeds the admin Realtime dashboard).
    trackRealtimePageView(pathname, searchParams);
  }, [pathname, searchParams]);

  return null;
}

// ─── Main Export ──────────────────────────────────────────────────────────
export default function GoogleAnalytics() {
  if (!GA_MEASUREMENT_ID) {
    if (!IS_PROD) {
      console.warn('[GA4] NEXT_PUBLIC_GA_MEASUREMENT_ID is not set — analytics disabled. Add it to .env and rebuild.');
    }
    return null;
  }

  return (
    <>
      {/*
        gtag.js remote script — production only.
        In dev, window.gtag is still defined (via the init script below)
        but no data is actually sent to Google.
      */}
      {IS_PROD && (
        <Script
          src={`https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`}
          strategy="afterInteractive"
        />
      )}

      {/*
        Gtag initialisation:
          - Always defines window.gtag so helper exports work in every env
          - send_page_view: false — disables the automatic page_view on init
            so GoogleAnalyticsInner fires the single authoritative page_view
          - debug_mode: true in non-production → visible in GA4 DebugView
      */}
      <Script id="ga4-init" strategy="afterInteractive">
        {`
          window.dataLayer = window.dataLayer || [];
          function gtag(){dataLayer.push(arguments);}
          window.gtag = gtag;
          ${IS_PROD ? "gtag('js', new Date());" : ""}
          gtag('config', '${GA_MEASUREMENT_ID}', {
            send_page_view: false${IS_PROD ? '' : ',\n            debug_mode: true'}
          });
          ${!IS_PROD ? `console.log('[GA4 Debug] Configured in dev mode (no hits sent): ${GA_MEASUREMENT_ID}');` : ''}
        `}
      </Script>

      <Suspense fallback={null}>
        <GoogleAnalyticsInner />
      </Suspense>
    </>
  );
}

// ─── Helper Exports ───────────────────────────────────────────────────────

/** Manually fire a page_view (e.g. after a modal or virtual page). */
export const pageview = (url) => {
  if (typeof window === 'undefined' || !window.gtag || !GA_MEASUREMENT_ID) return;
  window.gtag('event', 'page_view', {
    page_path:     url,
    page_title:    document.title,
    page_location: window.location.origin + url
  });
  if (!IS_PROD) console.log(`[GA4 Debug] manual page_view → ${url}`);
};

/** Fire a custom GA4 event. */
export const trackEvent = ({ action, category, label, value }) => {
  if (typeof window === 'undefined' || !window.gtag) return;
  window.gtag('event', action, {
    event_category: category,
    event_label:    label,
    ...(value !== undefined ? { value } : {})
  });
  if (!IS_PROD) console.log(`[GA4 Debug] event: ${action}`, { category, label, value });
};

/** Pre-built healthcare conversion events. */
export const trackHealthcareEvent = {
  appointmentBooked: (appointmentType) =>
    trackEvent({ action: 'appointment_booked', category: 'engagement', label: appointmentType }),

  videoCallStarted: () =>
    trackEvent({ action: 'video_call_started', category: 'telehealth', label: 'consultation' }),

  prescriptionSent: () =>
    trackEvent({ action: 'prescription_sent', category: 'e_prescribing', label: 'sent' }),

  userRegistered: (userType) =>
    trackEvent({ action: 'user_registered', category: 'conversion', label: userType }),

  subscriptionStarted: (plan) =>
    trackEvent({ action: 'subscription_started', category: 'revenue', label: plan }),
};
