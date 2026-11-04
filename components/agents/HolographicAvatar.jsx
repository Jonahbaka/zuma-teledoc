'use client';

import { useMemo } from 'react';
import { cn } from '@/lib/utils';
import { getThemeForColor } from '@/lib/agentPersonas';

function sizeClasses(size) {
  switch (size) {
    case 'xs':
      return { wrap: 'w-9 h-9', inner: 'w-7 h-7', ring1: 'inset-0', ring2: 'inset-0.5', text: 'text-[10px]' };
    case 'sm':
      return { wrap: 'w-12 h-12', inner: 'w-10 h-10', ring1: 'inset-0', ring2: 'inset-1', text: 'text-xs' };
    case 'lg':
      return { wrap: 'w-28 h-28', inner: 'w-20 h-20', ring1: 'inset-0', ring2: 'inset-2', text: 'text-sm' };
    case 'md':
    default:
      return { wrap: 'w-16 h-16', inner: 'w-12 h-12', ring1: 'inset-0', ring2: 'inset-1.5', text: 'text-xs' };
  }
}

function hashToUnit(label) {
  const s = String(label || '');
  let h = 2166136261; // FNV-1a-ish
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  // 0..1
  return (h >>> 0) / 0xffffffff;
}

function deriveExpression(persona, fallback = 'neutral') {
  const hint = String(persona?.expression || persona?.mood || '').trim().toLowerCase();
  if (hint) return hint;
  // stable default per agent id/type where available
  const id = String(persona?.id || '').toLowerCase();
  if (id.includes('compliance') || id.includes('guardian')) return 'serious';
  if (id.includes('devops') || id.includes('debug')) return 'focused';
  if (id.includes('growth') || id.includes('scout')) return 'upbeat';
  if (id.includes('asclepius') || id.includes('triage') || id.includes('pharmacist')) return 'calm';
  return fallback;
}

function HoloFace({ seedUnit, isSpeaking, expression = 'neutral' }) {
  // Small, deterministic variance so faces don't feel identical.
  const eyeY = 38 + Math.round(seedUnit * 4); // 38..42
  const mouthY = 56 + Math.round(seedUnit * 3); // 56..59
  const mouthW = 26 + Math.round(seedUnit * 6); // 26..32
  const mouthX = 64 - Math.round(mouthW / 2);

  const expr = String(expression || 'neutral').toLowerCase();
  const browTilt = expr === 'upbeat' || expr === 'happy' ? -1 : expr === 'serious' ? 1 : 0;
  const mouthSmile = expr === 'upbeat' || expr === 'happy' ? 4 : expr === 'concerned' || expr === 'sad' ? -3 : 1;

  return (
    <svg viewBox="0 0 128 128" className="h-full w-full" aria-hidden="true">
      {/* subtle backdrop */}
      <defs>
        <radialGradient id="holoFaceGlow" cx="30%" cy="30%" r="70%">
          <stop offset="0%" stopColor="rgba(255,255,255,0.10)" />
          <stop offset="55%" stopColor="rgba(255,255,255,0.04)" />
          <stop offset="100%" stopColor="rgba(0,0,0,0.0)" />
        </radialGradient>
      </defs>

      <rect x="0" y="0" width="128" height="128" fill="url(#holoFaceGlow)" />

      {/* Eyes */}
      <g
        className="docta-holo-eye-blink"
        style={{
          // 0..1 -> 0..1.2s
          animationDelay: `${Math.round(seedUnit * 1200)}ms`
        }}
      >
        {/* brows */}
        <path
          d={`M38 ${eyeY - 10} Q 50 ${eyeY - 18 + browTilt} 62 ${eyeY - 10}`}
          stroke="rgba(255,255,255,0.55)"
          strokeWidth="3"
          strokeLinecap="round"
          fill="none"
        />
        <path
          d={`M66 ${eyeY - 10} Q 78 ${eyeY - 18 + browTilt} 90 ${eyeY - 10}`}
          stroke="rgba(255,255,255,0.55)"
          strokeWidth="3"
          strokeLinecap="round"
          fill="none"
        />

        {/* eye whites */}
        <rect x="40" y={eyeY} width="20" height="10" rx="5" fill="rgba(255,255,255,0.18)" />
        <rect x="68" y={eyeY} width="20" height="10" rx="5" fill="rgba(255,255,255,0.18)" />
        {/* pupils */}
        <circle cx="50" cy={eyeY + 5} r="3.2" fill="rgba(255,255,255,0.78)" />
        <circle cx="78" cy={eyeY + 5} r="3.2" fill="rgba(255,255,255,0.78)" />
      </g>

      {/* Mouth */}
      <g
        className={cn(isSpeaking ? 'docta-holo-mouth-talk' : '')}
        style={{ transformOrigin: '64px 64px' }}
      >
        <path
          d={`M${mouthX} ${mouthY} Q 64 ${mouthY + mouthSmile} ${mouthX + mouthW} ${mouthY}`}
          stroke="rgba(255,255,255,0.60)"
          strokeWidth="4"
          strokeLinecap="round"
          fill="none"
        />
        {/* subtle inner highlight */}
        <path
          d={`M${mouthX + 2} ${mouthY + 6} Q 64 ${mouthY + mouthSmile + 4} ${mouthX + mouthW - 2} ${mouthY + 6}`}
          stroke="rgba(255,255,255,0.14)"
          strokeWidth="3"
          strokeLinecap="round"
          fill="none"
        />
      </g>

      {/* Nose */}
      <path
        d="M64 46 Q 60 56 64 64 Q 68 56 64 46"
        stroke="rgba(255,255,255,0.20)"
        strokeWidth="3"
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  );
}

export default function HolographicAvatar({
  persona,
  size = 'sm',
  showBadges = false,
  className,
  isSpeaking = false,
  // For backward compat with older UIs that pass `online` or other flags
  online
}) {
  const s = sizeClasses(size);
  const theme = getThemeForColor(persona?.colorKey || 'blue');
  const label = persona?.codeName || persona?.name || 'Agent';
  const seedUnit = useMemo(() => hashToUnit(label), [label]);
  const expression = useMemo(() => deriveExpression(persona), [persona]);

  const fallback = useMemo(() => {
    return String(label || 'AI').split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join('').toUpperCase();
  }, [label]);

  return (
    <div className={cn('relative flex items-center justify-center', s.wrap, className)}>
      {/* Outer rotating HUD ring */}
      <div className={cn('absolute rounded-full border-2 border-dashed opacity-70 animate-[spin_10s_linear_infinite]', s.ring1, theme.border)} />
      {/* Inner counter-rotating ring */}
      <div className={cn('absolute rounded-full border opacity-60 animate-[spin_8s_linear_infinite_reverse]', s.ring2, theme.border)} />

      {/* Speaking pulse ring */}
      {isSpeaking && (
        <div className={cn('absolute rounded-full border opacity-50 animate-ping', s.ring1, theme.border)} />
      )}

      {/* Image */}
      <div
        className={cn(
          'relative rounded-full overflow-hidden bg-[#0F0F16] z-10 ring-1',
          theme.ring,
          theme.glow,
          s.inner,
          isSpeaking ? 'docta-holo-talking' : ''
        )}
        aria-label={label}
        title={label}
      >
        {/* Background image (optional) */}
        {persona?.avatar && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={persona.avatar}
            alt={label}
            className="absolute inset-0 h-full w-full object-cover opacity-30"
            loading="lazy"
            referrerPolicy="no-referrer"
          />
        )}

        {/* Animated face overlay (always present) */}
        <div className="absolute inset-0 opacity-95 mix-blend-screen">
          <HoloFace seedUnit={seedUnit} isSpeaking={isSpeaking} expression={expression} />
        </div>

        {/* Fallback initials if SVG fails / for accessibility */}
        <div className={cn('absolute inset-0 flex items-center justify-center pointer-events-none', s.text, theme.accent, 'opacity-0')}>
          <span className="font-bold">{fallback}</span>
        </div>

        {/* Scanning effect */}
        <div className="absolute inset-0 pointer-events-none">
          <div
            className={cn(
              'absolute left-0 right-0 h-1/2 opacity-25 animate-[scan_2s_linear_infinite]',
              // use a neutral overlay so we don't rely on dynamic Tailwind class generation
              'bg-gradient-to-b from-transparent via-white/40 to-transparent'
            )}
          />
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_30%,rgba(255,255,255,0.10),transparent_60%)] opacity-40" />
          {/* Self-contained subtle "digital noise" */}
          <div className="absolute inset-0 opacity-10 mix-blend-overlay"
            style={{
              backgroundImage: 'repeating-linear-gradient(0deg, rgba(255,255,255,0.10) 0px, rgba(255,255,255,0.10) 1px, transparent 1px, transparent 6px), repeating-linear-gradient(90deg, rgba(255,255,255,0.08) 0px, rgba(255,255,255,0.08) 1px, transparent 1px, transparent 6px)'
            }}
          />
          {isSpeaking && (
            <div className="absolute inset-0 bg-white/10 mix-blend-overlay animate-pulse" />
          )}
        </div>
      </div>

      {showBadges && (
        <>
          <div className={cn('absolute -right-2 top-0 px-2 py-0.5 rounded border bg-[#0F0F16] font-mono', theme.border, theme.accent, 'text-[10px]')}>
            LIVE
          </div>
          <div className={cn('absolute -left-2 bottom-0 px-2 py-0.5 rounded border bg-[#0F0F16] font-mono', theme.border, theme.accent, 'text-[10px]')}>
            v3
          </div>
        </>
      )}

      {/* Keep component self-contained (keyframes live in globals.css, but class hooks live here). */}
      <span className="sr-only">{online === false ? 'offline' : 'online'}</span>
    </div>
  );
}

