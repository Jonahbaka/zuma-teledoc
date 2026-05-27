'use client';

/**
 * components/ng/telehealth/NetworkQualityBadge.jsx
 * Live in-call WebRTC quality indicator. Samples stats every 2s.
 * Usage: <NetworkQualityBadge pc={peerConnection} />
 */

import { useEffect, useState } from 'react';
import { Wifi, AlertTriangle } from 'lucide-react';

const TONE = {
  good:      'bg-emerald-100 text-emerald-800',
  fair:      'bg-amber-100 text-amber-800',
  poor:      'bg-rose-100 text-rose-800',
  very_poor: 'bg-rose-600 text-white',
  unknown:   'bg-slate-100 text-slate-600',
};

function classify(kbps) {
  if (kbps == null || kbps <= 0) return 'unknown';
  if (kbps >= 1500) return 'good';
  if (kbps >= 500)  return 'fair';
  if (kbps >= 150)  return 'poor';
  return 'very_poor';
}

export default function NetworkQualityBadge({ pc, intervalMs = 2000 }) {
  const [stats, setStats] = useState(null);

  useEffect(() => {
    if (!pc) return;
    let cancelled = false;
    let timer = null;

    async function tick() {
      try {
        const mod = await import('@/lib/ng/networkQuality');
        const s = await mod.sampleRtcStats(pc);
        if (!cancelled) setStats(s);
      } catch { /* swallow */ }
      if (!cancelled) timer = setTimeout(tick, intervalMs);
    }
    tick();
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [pc, intervalMs]);

  const downKbps = stats?.downKbps ?? null;
  const label = classify(downKbps);
  const bars = label === 'good' ? 4 : label === 'fair' ? 3 : label === 'poor' ? 2 : label === 'very_poor' ? 1 : 0;

  return (
    <div className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold ${TONE[label]}`}>
      <Wifi className="h-3.5 w-3.5" />
      <span>
        {label === 'unknown' ? '—' : `${downKbps ?? 0} kbps`}
        {stats?.packetLossPct > 0 && ` · ${stats.packetLossPct}% loss`}
        {stats?.rtt > 0 && ` · ${stats.rtt}ms`}
      </span>
      <span className="flex items-center gap-0.5">
        {[1, 2, 3, 4].map(i => (
          <span key={i}
            className={`block h-2 w-1 rounded-sm ${i <= bars ? 'bg-current opacity-100' : 'bg-current opacity-25'}`} />
        ))}
      </span>
      {label === 'very_poor' && <AlertTriangle className="h-3 w-3" />}
    </div>
  );
}
