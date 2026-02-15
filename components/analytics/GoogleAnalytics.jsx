'use client';

import { useEffect, Suspense } from 'react';
import Script from 'next/script';
import { usePathname, useSearchParams } from 'next/navigation';
import ReactGA from 'react-ga4';

// Google Analytics Measurement ID
const GA_MEASUREMENT_ID = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID || 'G-S9C6QBY7DD';

// Initialize React GA4
let initialized = false;

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
    deviceType: /mobile/i.test(navigator.userAgent) ? 'mobile' : 'desktop'
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
    // No-op: tracking must never break UX.
  }
}

// Inner component that uses useSearchParams (must be wrapped in Suspense)
function GoogleAnalyticsInner() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Initialize GA4 on mount
  useEffect(() => {
    if (!initialized && GA_MEASUREMENT_ID) {
      ReactGA.initialize(GA_MEASUREMENT_ID);
      initialized = true;
    }
  }, []);

  // Track page views on route change
  useEffect(() => {
    if (initialized && pathname) {
      const url = pathname + (searchParams?.toString() ? `?${searchParams.toString()}` : '');
      
      // Track with react-ga4
      ReactGA.send({ hitType: 'pageview', page: url });
      
      // Also track with gtag for redundancy
      if (typeof window !== 'undefined' && window.gtag) {
        window.gtag('config', GA_MEASUREMENT_ID, {
          page_path: url,
        });
      }

      // Send internal realtime analytics event for the Admin realtime dashboard.
      trackRealtimePageView(pathname, searchParams);
    }
  }, [pathname, searchParams]);

  return null;
}

// Main component with Suspense wrapper
export default function GoogleAnalytics() {
  if (!GA_MEASUREMENT_ID) {
    return null;
  }

  return (
    <>
      {/* Google Analytics Script */}
      <Script
        src={`https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`}
        strategy="afterInteractive"
      />
      <Script id="google-analytics" strategy="afterInteractive">
        {`
          window.dataLayer = window.dataLayer || [];
          function gtag(){dataLayer.push(arguments);}
          gtag('js', new Date());
          gtag('config', '${GA_MEASUREMENT_ID}', {
            page_path: window.location.pathname,
          });
        `}
      </Script>
      {/* Wrap the component that uses useSearchParams in Suspense */}
      <Suspense fallback={null}>
        <GoogleAnalyticsInner />
      </Suspense>
    </>
  );
}

// Helper function to track page views manually
export const pageview = (url) => {
  if (typeof window !== 'undefined') {
    ReactGA.send({ hitType: 'pageview', page: url });
    if (window.gtag) {
      window.gtag('config', GA_MEASUREMENT_ID, {
        page_path: url,
      });
    }
  }
};

// Helper function to track custom events
export const trackEvent = ({ action, category, label, value }) => {
  if (typeof window !== 'undefined') {
    ReactGA.event({
      category: category,
      action: action,
      label: label,
      value: value,
    });
  }
};

// Track specific healthcare events
export const trackHealthcareEvent = {
  appointmentBooked: (appointmentType) => {
    trackEvent({
      action: 'appointment_booked',
      category: 'engagement',
      label: appointmentType,
    });
  },
  videoCallStarted: () => {
    trackEvent({
      action: 'video_call_started',
      category: 'telehealth',
      label: 'consultation',
    });
  },
  prescriptionSent: () => {
    trackEvent({
      action: 'prescription_sent',
      category: 'e_prescribing',
      label: 'sent',
    });
  },
  userRegistered: (userType) => {
    trackEvent({
      action: 'user_registered',
      category: 'conversion',
      label: userType,
    });
  },
  subscriptionStarted: (plan) => {
    trackEvent({
      action: 'subscription_started',
      category: 'revenue',
      label: plan,
    });
  },
};
