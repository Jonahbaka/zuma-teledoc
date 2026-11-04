export function jurisdictionForCountry(countryCode) {
  const c = String(countryCode || '').toUpperCase().trim();
  if (!c) return { code: 'UNKNOWN', label: 'Unknown' };

  // GDPR (EEA + UK for practical purposes)
  const GDPR = new Set([
    'AT','BE','BG','HR','CY','CZ','DK','EE','FI','FR','DE','GR','HU','IE','IT','LV','LT','LU','MT','NL','PL','PT','RO','SK','SI','ES','SE',
    'IS','LI','NO','GB'
  ]);
  if (GDPR.has(c)) return { code: 'GDPR', label: 'GDPR' };

  // Brazil
  if (c === 'BR') return { code: 'LGPD', label: 'LGPD' };

  // Default
  return { code: 'STANDARD', label: 'Standard' };
}

