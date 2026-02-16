'use client';

import React from 'react';
import { cn } from '@/lib/utils';

// DoctaRx primary wordmark (inline SVG).
// Keeping this inline avoids asset fetches and ensures consistent rendering.
export default function DoctaRxLogo({ className, title = 'DoctaRx' }) {
  return (
    <svg
      role="img"
      aria-label={title}
      viewBox="0 0 400 100"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn('h-8 w-auto', className)}
    >
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
        />
      </g>
      <text
        x="100"
        y="65"
        fontFamily="sans-serif"
        fontWeight="800"
        fontSize="52"
        fill="#0F172A"
        letterSpacing="-1"
      >
        Docta<tspan fill="#22D3EE">Rx</tspan>
      </text>
    </svg>
  );
}

