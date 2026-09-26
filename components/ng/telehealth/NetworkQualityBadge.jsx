'use client';

/**
 * components/ng/telehealth/NetworkQualityBadge.jsx
 *
 * Live in-call connection status for Nigeria telehealth.
 * Usage: <NetworkQualityBadge pc={peerConnection} offline={offline} onRetry={retry} />
 *
 * All state, severity, guidance, and fallback decisions come from the shared,
 * unit-tested resilience core in lib/ng/connectionResilience.js, so the UI and
 * the tests cannot drift apart.
 */

import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, PhoneOff, RefreshCw, VideoOff, Wifi, WifiOff } from 'lucide-react';
import {
  CONNECTION_STATES,
  SEVERITY,
  deriveConnectionState,
} from '@/lib/ng/connectionResilience';

const TONE = {
  [SEVERITY.INFO]: 'bg-emerald-100 text-emerald-800',
  [SEVERITY.WARNING]: 'bg-amber-100 text-amber-900',
  [SEVERITY.CRITICAL]: 'bg-rose-100 text-rose-900',
};

const ICON = {
  [CONNECTION_STATES.CONNECTED]: Wifi,
  [CONNECTION_STATES.RECOVERED]: Wifi,
  [CONNECTION_STATES.DEGRADED]: Wifi,
  [CONNECTION_STATES.FALLBACK_REQUIRED]: WifiOff,
  [CONNECTION_STATES.RECONNECTING]: RefreshCw,
  [CONNECTION_STATES.FAILED]: WifiOff,
  [CONNECTION_STATES.ENDED]: PhoneOff,
};

function qualityBars(downKbps) {
  if (downKbps == null || downKbps <= 0) return 0;
  if (downKbps >= 1500) return 4;
  if (downKbps >= 500) return 3;
  if (downKbps >= 150) return 2;
  return 1;
}

export default function NetworkQualityBadge({
  pc,
  intervalMs = 2000,
  offline = false,
  reconnectAttempt = 0,
  lastError = null,
  onAudioOnly = null,
  onReschedule = null,
  onRetry = null,
}) {
  const [stats, setStats] = useState(null);

  useEffect(() => {
    if (!pc) return undefined;
    let cancelled = false;
    let timer = null;

    async function tick() {
      try {
        const mod = await import('@/lib/ng/networkQuality');
        const s = await mod.sampleRtcStats(pc);
        if (!cancelled) setStats(s);
      } catch { /* stats are best-effort; state must never depend on them */ }
      if (!cancelled) timer = setTimeout(tick, intervalMs);
    }
    tick();
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [pc, intervalMs]);

  const view = useMemo(() => deriveConnectionState({
    phase: offline ? CONNECTION_STATES.RECONNECTING : CONNECTION_STATES.CONNECTED,
    downKbps: stats?.downKbps ?? null,
    packetLossPct: stats?.packetLossPct ?? null,
    rttMs: stats?.rtt ?? null,
    offline,
    reconnectAttempt,
    lastError,
  }), [stats, offline, reconnectAttempt, lastError]);

  const Icon = ICON[view.state] || Wifi;
  const bars = qualityBars(stats?.downKbps ?? null);

  return (
    <div className="space-y-2">
      <div
        className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold ${TONE[view.severity]}`}
        role="status"
        aria-live="polite"
        data-connection-state={view.state}
      >
        <Icon className={`h-3.5 w-3.5 ${view.state === CONNECTION_STATES.RECONNECTING ? 'animate-spin' : ''}`} aria-hidden="true" />
        <span>{view.label}</span>
        {stats?.downKbps > 0 && (
          <span className="font-normal opacity-80">
            {stats.downKbps} kbps
            {stats.packetLossPct > 0 ? ` · ${stats.packetLossPct}% loss` : ''}
            {stats.rtt > 0 ? ` · ${stats.rtt}ms` : ''}
          </span>
        )}
        <span className="flex items-center gap-0.5" aria-hidden="true">
          {[1, 2, 3, 4].map((i) => (
            <span
              key={i}
              className={`block h-2 w-1 rounded-sm ${i <= bars ? 'bg-current opacity-100' : 'bg-current opacity-25'}`}
            />
          ))}
        </span>
        {view.severity === SEVERITY.CRITICAL && <AlertTriangle className="h-3 w-3" aria-hidden="true" />}
      </div>

      {view.guidance && (
        <p className="max-w-sm text-xs leading-5 text-slate-600">{view.guidance}</p>
      )}

      {(view.offerAudioOnly || view.offerReschedule || view.canReconnect) && (
        <div className="flex flex-wrap gap-2">
          {view.offerAudioOnly && onAudioOnly && (
            <button
              type="button"
              onClick={onAudioOnly}
              className="inline-flex min-h-9 items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-800 hover:bg-slate-50"
            >
              <VideoOff className="h-3.5 w-3.5" aria-hidden="true" />
              Continue audio-only
            </button>
          )}
          {view.canReconnect && onRetry && view.state !== CONNECTION_STATES.CONNECTED && (
            <button
              type="button"
              onClick={onRetry}
              className="inline-flex min-h-9 items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-800 hover:bg-slate-50"
            >
              <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
              Reconnect now
            </button>
          )}
          {view.offerReschedule && onReschedule && (
            <button
              type="button"
              onClick={onReschedule}
              className="inline-flex min-h-9 items-center gap-1.5 rounded-md border border-rose-300 bg-white px-3 text-xs font-semibold text-rose-800 hover:bg-rose-50"
            >
              <PhoneOff className="h-3.5 w-3.5" aria-hidden="true" />
              End and reschedule
            </button>
          )}
        </div>
      )}
    </div>
  );
}
