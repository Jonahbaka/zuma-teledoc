'use client';

import React, { useId } from 'react';
import { cn } from '@/lib/utils';

// DoctaRx primary wordmark (inline SVG) — "White Glow" variant.
// Designed for dark headers; for light pages, wrap it in a dark pill background.
export default function DoctaRxLogo({ className, title = 'DoctaRx', glow = true }) {
  const uid = useId();
  const glowId = `doctarx_glow_${uid.replace(/:/g, '_')}`;
  return (
    <svg
      role="img"
      aria-label={title}
      viewBox="0 0 400 100"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn('h-8 w-auto', className)}
    >
      <defs>
        {glow ? (
          <filter id={glowId} x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="2.5" result="coloredBlur" />
            <feMerge>
              <feMergeNode in="coloredBlur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        ) : null}
      </defs>

      <g transform="translate(10, 10)">
        <path
          d="M20 5 H45 C70 5 70 75 45 75 H20 V5 Z"
          stroke="#3B82F6"
          strokeWidth="8"
          strokeLinecap="round"
        />
        <path
          d="M20 40 L35 40 L40 25 L48 55 L55 40 L70 40"
          stroke="#22D3EE"
          strokeWidth="6"
          strokeLinecap="round"
          strokeLinejoin="round"
          filter={glow ? `url(#${glowId})` : undefined}
        />
      </g>

      <text
        x="100"
        y="65"
        fontFamily="Arial, Helvetica, sans-serif"
        fontWeight="800"
        fontSize="52"
        fill="#FFFFFF"
        letterSpacing="-1"
        filter={glow ? `url(#${glowId})` : undefined}
      >
        Docta<tspan fill="#22D3EE">Rx</tspan>
      </text>
    </svg>
  );
}

