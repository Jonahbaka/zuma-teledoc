'use client';

import { Phone } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

// Minimal country calling code list (expand as needed).
const COUNTRY_CALLING_CODES = [
  { country: 'United States', iso2: 'US', code: '+1' },
  { country: 'United Kingdom', iso2: 'GB', code: '+44' },
  { country: 'Nigeria', iso2: 'NG', code: '+234' },
  { country: 'Brazil', iso2: 'BR', code: '+55' },
  { country: 'India', iso2: 'IN', code: '+91' },
  { country: 'Canada', iso2: 'CA', code: '+1' },
  { country: 'France', iso2: 'FR', code: '+33' },
  { country: 'Spain', iso2: 'ES', code: '+34' }
];

function digitsOnly(v) {
  return String(v || '').replace(/[^\d]/g, '');
}

function toE164({ callingCode, nationalNumber }) {
  const cc = String(callingCode || '').trim();
  const n = digitsOnly(nationalNumber);
  if (!cc.startsWith('+')) return '';
  if (!n) return cc;
  return `${cc}${n}`;
}

export function PhoneInputE164({
  value,
  onChange,
  defaultCountryIso2 = 'US',
  className,
  required = false,
  disabled = false,
  placeholder = '5551234567'
}) {
  // Derive initial calling code from current value if possible.
  const defaultCallingCode =
    COUNTRY_CALLING_CODES.find(c => c.iso2 === defaultCountryIso2)?.code || '+1';

  // When user edits, we keep 2 pieces: calling code selector + national number.
  // If the parent passes a full E.164, we still show it split best-effort.
  const hasPlus = typeof value === 'string' && value.trim().startsWith('+');
  const selectedCallingCode = hasPlus
    ? COUNTRY_CALLING_CODES.find(c => value.startsWith(c.code))?.code || defaultCallingCode
    : defaultCallingCode;

  const national = hasPlus
    ? value.replace(selectedCallingCode, '').replace(/[^\d]/g, '')
    : String(value || '').replace(/[^\d]/g, '');

  const setCallingCode = (nextCode) => {
    const e164 = toE164({ callingCode: nextCode, nationalNumber: national });
    onChange?.(e164);
  };

  const setNational = (nextNational) => {
    const e164 = toE164({ callingCode: selectedCallingCode, nationalNumber: nextNational });
    onChange?.(e164);
  };

  return (
    <div className={cn('flex items-center gap-2', className)}>
      <div className="relative w-[140px]">
        <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <select
          value={selectedCallingCode}
          onChange={(e) => setCallingCode(e.target.value)}
          disabled={disabled}
          className="h-10 w-full rounded-md border border-input bg-background pl-9 pr-2 text-sm outline-none"
          aria-label="Country calling code"
        >
          {COUNTRY_CALLING_CODES.map((c) => (
            <option key={`${c.iso2}-${c.code}`} value={c.code}>
              {c.iso2} {c.code}
            </option>
          ))}
        </select>
      </div>

      <Input
        type="tel"
        value={national}
        onChange={(e) => setNational(e.target.value)}
        placeholder={placeholder}
        required={required}
        disabled={disabled}
        inputMode="tel"
        autoComplete="tel"
        aria-label="Phone number"
      />
    </div>
  );
}

export function isValidE164(phone) {
  return /^\+[1-9]\d{1,14}$/.test(String(phone || '').trim());
}

