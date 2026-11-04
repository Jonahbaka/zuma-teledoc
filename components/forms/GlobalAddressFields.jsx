'use client';

import { useEffect, useMemo, useState } from 'react';
import { MapPin, Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { getCountryOptions } from '@/lib/countries';

// Field label overrides for high-traffic countries.
// For all other countries, we use neutral defaults.
const COUNTRY_FIELD_OVERRIDES = {
  US: { regionLabel: 'State', postalLabel: 'ZIP code' },
  GB: { regionLabel: 'County', postalLabel: 'Postcode' },
  NG: { regionLabel: 'State', postalLabel: 'Postal code' },
  GH: { regionLabel: 'Region', postalLabel: 'Postal code' },
  ZA: { regionLabel: 'Province', postalLabel: 'Postal code' },
  JM: { regionLabel: 'Parish', postalLabel: 'Postal code' },
  BR: { regionLabel: 'State', postalLabel: 'CEP' },
  IN: { regionLabel: 'State', postalLabel: 'PIN code' },
  CA: { regionLabel: 'Province', postalLabel: 'Postal code' },
  FR: { regionLabel: 'Region', postalLabel: 'Postal code' },
  ES: { regionLabel: 'Province', postalLabel: 'Postal code' }
};

const DEFAULT_COUNTRY = 'US';
const DEFAULT_COUNTRY_CONFIG = { regionLabel: 'Region/State', postalLabel: 'Postal code' };

function countryConfig(countryCode) {
  const cc = String(countryCode || '').toUpperCase() || DEFAULT_COUNTRY;
  return COUNTRY_FIELD_OVERRIDES[cc] || DEFAULT_COUNTRY_CONFIG;
}

function getAllCountryOptions() {
  // Always use a complete ISO list (stable across browsers).
  const options = getCountryOptions({ locale: (typeof navigator !== 'undefined' ? navigator.language : 'en') });

  // Ensure default is present.
  const hasDefault = options.some((c) => c.code === DEFAULT_COUNTRY);
  if (!hasDefault) options.unshift({ code: DEFAULT_COUNTRY, name: 'United States' });
  return options;
}

// Very lightweight autocomplete using OpenStreetMap Nominatim.
// No API key required, but keep requests low (rate limited).
async function nominatimSearch(query) {
  const q = String(query || '').trim();
  if (!q || q.length < 4) return [];
  const url = `https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&limit=5&q=${encodeURIComponent(q)}`;
  const res = await fetch(url, {
    headers: {
      'Accept': 'application/json'
    }
  });
  if (!res.ok) return [];
  const data = await res.json();
  return Array.isArray(data) ? data : [];
}

export function GlobalAddressFields({
  value,
  onChange,
  className,
  required = false
}) {
  const v = value || {};
  const [country, setCountry] = useState(v.country || DEFAULT_COUNTRY);
  const [search, setSearch] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [searching, setSearching] = useState(false);

  const cfg = useMemo(() => countryConfig(country), [country]);
  const countryOptions = useMemo(() => getAllCountryOptions(), []);

  useEffect(() => {
    onChange?.({ ...v, country });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [country]);

  useEffect(() => {
    let alive = true;
    const run = async () => {
      const q = search.trim();
      if (q.length < 4) {
        setSuggestions([]);
        return;
      }
      setSearching(true);
      try {
        const res = await nominatimSearch(q);
        if (!alive) return;
        setSuggestions(res);
      } catch {
        if (!alive) return;
        setSuggestions([]);
      } finally {
        if (alive) setSearching(false);
      }
    };
    const t = setTimeout(run, 350);
    return () => { alive = false; clearTimeout(t); };
  }, [search]);

  const applySuggestion = (s) => {
    const a = s?.address || {};
    const street = [a.house_number, a.road].filter(Boolean).join(' ').trim();
    const city = a.city || a.town || a.village || a.suburb || '';
    const region = a.state || a.county || a.region || '';
    const postalCode = a.postcode || '';
    const countryCode = (a.country_code || '').toUpperCase() || country;

    setCountry(countryCode);
    setSearch('');
    setSuggestions([]);
    onChange?.({
      ...v,
      country: countryCode,
      addressLine1: street || v.addressLine1 || '',
      addressLine2: v.addressLine2 || '',
      city: city || v.city || '',
      region: region || v.region || '',
      postalCode: postalCode || v.postalCode || ''
    });
  };

  return (
    <div className={cn('space-y-3', className)}>
      <div className="space-y-2">
        <Label>Country</Label>
        <select
          value={country}
          onChange={(e) => setCountry(e.target.value)}
          className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none"
          required={required}
        >
          {countryOptions.map((c) => (
            <option key={c.code} value={c.code}>{c.name}</option>
          ))}
        </select>
      </div>

      <div className="space-y-2">
        <Label>Search address (optional)</Label>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Start typing street, city..."
            className="pl-9"
          />
        </div>
        {suggestions.length > 0 && (
          <div className="rounded-md border border-border bg-card shadow-sm overflow-hidden">
            {suggestions.map((s) => (
              <button
                type="button"
                key={s.place_id}
                onClick={() => applySuggestion(s)}
                className="w-full text-left px-3 py-2 text-sm hover:bg-accent flex items-start gap-2"
              >
                <MapPin className="w-4 h-4 mt-0.5 text-muted-foreground" />
                <span className="text-foreground">{s.display_name}</span>
              </button>
            ))}
          </div>
        )}
        {searching && (
          <p className="text-xs text-muted-foreground">Searching...</p>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-2 md:col-span-2">
          <Label>Address line 1</Label>
          <Input
            value={v.addressLine1 || ''}
            onChange={(e) => onChange?.({ ...v, country, addressLine1: e.target.value })}
            placeholder="Street address"
            required={required}
            autoComplete="address-line1"
          />
        </div>
        <div className="space-y-2 md:col-span-2">
          <Label>Address line 2 (optional)</Label>
          <Input
            value={v.addressLine2 || ''}
            onChange={(e) => onChange?.({ ...v, country, addressLine2: e.target.value })}
            placeholder="Apartment, suite, etc."
            autoComplete="address-line2"
          />
        </div>
        <div className="space-y-2">
          <Label>City</Label>
          <Input
            value={v.city || ''}
            onChange={(e) => onChange?.({ ...v, country, city: e.target.value })}
            required={required}
            autoComplete="address-level2"
          />
        </div>
        <div className="space-y-2">
          <Label>{cfg.regionLabel}</Label>
          <Input
            value={v.region || ''}
            onChange={(e) => onChange?.({ ...v, country, region: e.target.value })}
            autoComplete="address-level1"
          />
        </div>
        <div className="space-y-2">
          <Label>{cfg.postalLabel}</Label>
          <Input
            value={v.postalCode || ''}
            onChange={(e) => onChange?.({ ...v, country, postalCode: e.target.value })}
            autoComplete="postal-code"
          />
        </div>
      </div>
    </div>
  );
}

