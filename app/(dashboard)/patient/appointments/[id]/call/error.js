'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';

async function clearCachesBestEffort() {
  try {
    if (typeof window === 'undefined') return;
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister().catch(() => {})));
    }
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k).catch(() => {})));
    }
  } catch {
    // ignore
  }
}

export default function PatientCallError({ error, reset }) {
  const [clearing, setClearing] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line no-console
    console.error('Patient call error boundary caught:', error);
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
    <div className="min-h-screen bg-[#0b0b0f] text-white flex items-center justify-center p-6">
      <div className="w-full max-w-xl rounded-3xl border border-white/10 bg-white/[0.04] p-6">
        <div className="text-sm text-slate-300">DoctaRx</div>
        <div className="mt-2 text-2xl font-semibold">We hit a problem joining your visit</div>
        <div className="mt-2 text-slate-300 text-sm">
          Try again. If this happened after an update, clearing cached files usually fixes it.
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
            href="/patient/appointments"
            className="px-4 py-2 rounded-xl border border-white/15 bg-white/[0.03] text-slate-100 text-sm hover:bg-white/[0.06]"
          >
            Back to appointments
          </Link>
        </div>
      </div>
    </div>
  );
}

