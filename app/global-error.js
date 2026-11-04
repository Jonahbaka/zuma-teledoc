'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';

function safeToString(err) {
  try {
    if (!err) return '';
    if (typeof err === 'string') return err;
    return err.message || JSON.stringify(err);
  } catch {
    return '';
  }
}

async function clearCachesBestEffort() {
  try {
    if (typeof window === 'undefined') return;

    // Unregister any service workers (if present).
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister().catch(() => {})));
    }

    // Clear Cache Storage (if present).
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k).catch(() => {})));
    }
  } catch {
    // ignore
  }
}

export default function GlobalError({ error, reset }) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [clearing, setClearing] = useState(false);

  useEffect(() => {
    // Log for visibility in serverless environments where console collection exists.
    // eslint-disable-next-line no-console
    console.error('GlobalError boundary caught:', error);
  }, [error]);

  const tryAgain = useCallback(() => {
    try {
      reset();
    } catch {
      window.location.reload();
    }
  }, [reset]);

  const clearCacheAndReload = useCallback(async () => {
    setClearing(true);
    await clearCachesBestEffort();
    window.location.reload();
  }, []);

  return (
    <html>
      <body>
        <div className="min-h-screen bg-[#0b0b0f] text-white flex items-center justify-center p-6">
          <div className="w-full max-w-xl rounded-3xl border border-white/10 bg-white/[0.04] p-6 shadow-2xl">
            <div className="text-sm text-slate-300">DoctaRx</div>
            <div className="mt-2 text-2xl font-semibold">Something went wrong</div>
            <div className="mt-2 text-slate-300 text-sm">
              The app hit an unexpected error while loading. You can try again without leaving the site.
            </div>

            <div className="mt-5 flex flex-wrap gap-2">
              <button
                onClick={tryAgain}
                className="px-4 py-2 rounded-xl bg-white text-black text-sm font-medium hover:bg-slate-100"
              >
                Try again
              </button>
              <button
                onClick={clearCacheAndReload}
                disabled={clearing}
                className="px-4 py-2 rounded-xl border border-white/15 bg-white/[0.03] text-slate-100 text-sm hover:bg-white/[0.06] disabled:opacity-60"
              >
                {clearing ? 'Clearing cache...' : 'Clear cache and reload'}
              </button>
              <Link
                href="/"
                className="px-4 py-2 rounded-xl border border-white/15 bg-white/[0.03] text-slate-100 text-sm hover:bg-white/[0.06]"
              >
                Go home
              </Link>
            </div>

            <div className="mt-5">
              <button
                onClick={() => setDetailsOpen((v) => !v)}
                className="text-xs text-slate-400 hover:text-slate-200"
              >
                {detailsOpen ? 'Hide details' : 'Show details'}
              </button>
              {detailsOpen ? (
                <pre className="mt-2 whitespace-pre-wrap text-xs text-slate-300 bg-black/40 border border-white/10 rounded-2xl p-3 overflow-auto max-h-48">
                  {safeToString(error)}
                </pre>
              ) : null}
            </div>

            <div className="mt-4 text-xs text-slate-500">
              If this keeps happening after deploys, it can be a cached JS chunk mismatch. The Clear cache button usually fixes it immediately.
            </div>
          </div>
        </div>
      </body>
    </html>
  );
}

