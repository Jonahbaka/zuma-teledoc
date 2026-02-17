'use client';

import { useMemo } from 'react';
import { cn } from '@/lib/utils';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
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

export default function HolographicAvatar({
  persona,
  size = 'sm',
  showBadges = false,
  className
}) {
  const s = sizeClasses(size);
  const theme = getThemeForColor(persona?.colorKey || 'blue');
  const label = persona?.codeName || persona?.name || 'Agent';

  const fallback = useMemo(() => {
    return String(label || 'AI').split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join('').toUpperCase();
  }, [label]);

  return (
    <div className={cn('relative flex items-center justify-center', s.wrap, className)}>
      {/* Outer rotating HUD ring */}
      <div className={cn('absolute rounded-full border-2 border-dashed opacity-70 animate-[spin_10s_linear_infinite]', s.ring1, theme.border)} />
      {/* Inner counter-rotating ring */}
      <div className={cn('absolute rounded-full border opacity-60 animate-[spin_8s_linear_infinite_reverse]', s.ring2, theme.border)} />

      {/* Image */}
      <div className={cn('relative rounded-full overflow-hidden bg-[#0F0F16] z-10 ring-1', theme.ring, theme.glow, s.inner)}>
        <Avatar className="h-full w-full">
          <AvatarImage src={persona?.avatar} alt={label} className="opacity-90 hover:opacity-100 transition-opacity" />
          <AvatarFallback className={cn('bg-slate-900 text-white font-bold', s.text)}>
            {fallback}
          </AvatarFallback>
        </Avatar>

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
    </div>
  );
}

