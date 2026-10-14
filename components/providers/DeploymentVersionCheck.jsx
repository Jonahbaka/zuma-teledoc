'use client';

import { useEffect, useRef, useState } from 'react';

// Backend deployment and service-worker updates must not discard account
// sessions, clinical drafts, saved locations, or interrupt an active visit.
export function DeploymentVersionCheck() {
  const lastVersion = useRef(null);
  const [available, setAvailable] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    let stopped = false;
    let checking = false;
    let request;
    const endpoint = (process.env.NEXT_PUBLIC_API_URL || '/api').replace(/\/$/, '') + '/health';
    const announce = () => { if (!stopped) setAvailable(true); };
    const checkDeployment = async () => {
      if (checking || stopped || document.visibilityState !== 'visible') return;
      checking = true;
      request = new AbortController();
      const timeout = setTimeout(() => request.abort(), 8000);
      try {
        const response = await fetch(endpoint, { cache: 'no-store', signal: request.signal });
        if (!response.ok) return;
        const data = await response.json();
        const version = data.buildId || data.version;
        if (typeof version !== 'string' || !version.trim() || version === 'unknown') return;
        if (!stopped && lastVersion.current && version !== lastVersion.current) announce();
        if (!stopped) lastVersion.current = version;
      } catch {
        // An unavailable health check does not establish a deployment change.
      } finally { clearTimeout(timeout); checking = false; }
    };
    void checkDeployment();
    const interval = setInterval(checkDeployment, 60000);
    document.addEventListener('visibilitychange', checkDeployment);
    window.addEventListener('doctarx:application-update', announce);
    return () => {
      stopped = true; request?.abort(); clearInterval(interval);
      document.removeEventListener('visibilitychange', checkDeployment);
      window.removeEventListener('doctarx:application-update', announce);
    };
  }, []);

  function refreshApplication() {
    if (refreshing) return;
    setRefreshing(true);
    const waiting = window.__doctarxPwaRuntime?.registration?.waiting;
    if (!waiting || !navigator.serviceWorker) { window.location.reload(); return; }
    let finished = false;
    const reload = () => {
      if (finished) return;
      finished = true;
      navigator.serviceWorker.removeEventListener('controllerchange', reload);
      window.location.reload();
    };
    navigator.serviceWorker.addEventListener('controllerchange', reload, { once: true });
    waiting.postMessage({ type: 'SKIP_WAITING' });
    setTimeout(reload, 3000);
  }

  if (!available) return null;
  return <aside aria-label="DoctaRx application update" className="fixed inset-x-4 bottom-24 z-50 mx-auto flex max-w-2xl flex-wrap items-center gap-4 rounded-2xl border border-blue-200 bg-white p-5 text-base text-slate-950 shadow-xl sm:bottom-6">
    <div className="min-w-0 flex-1" role="status"><p className="font-semibold">A DoctaRx update is available</p><p className="mt-1 leading-6 text-slate-600">Save your work and finish any active visit before refreshing.</p></div>
    <button onClick={refreshApplication} disabled={refreshing} className="min-h-12 rounded-xl bg-blue-700 px-5 py-3 font-semibold text-white disabled:opacity-60">{refreshing ? 'Refreshing…' : 'Refresh application'}</button>
  </aside>;
}
