// Shared country list helper.
// Uses ISO 3166-1 alpha-2 codes via i18n-iso-countries (stable across browsers).
//
// We keep this as a tiny helper so dropdowns don't depend on Intl.supportedValuesOf,
// which is not available in some browsers/environments and would collapse to a short fallback list.

import countries from 'i18n-iso-countries';
import enLocale from 'i18n-iso-countries/langs/en.json';

let registered = false;
function ensureRegistered() {
  if (registered) return;
  try {
    countries.registerLocale(enLocale);
  } catch {
    // Ignore double-register or runtime quirks.
  }
  registered = true;
}

export function getCountryOptions({ locale } = {}) {
  ensureRegistered();

  // We use English names for now (consistent UX). If you want full localization,
  // we can register more locales and select based on the app language.
  const names = countries.getNames('en', { select: 'official' }) || {};

  const usedLocale =
    (typeof locale === 'string' && locale.trim()) ||
    (typeof navigator !== 'undefined' && navigator.language) ||
    'en';

  const options = Object.entries(names)
    .map(([code, name]) => ({ code: String(code).toUpperCase(), name: String(name) }))
    .filter((c) => /^[A-Z]{2}$/.test(c.code));

  options.sort((a, b) =>
    a.name.localeCompare(b.name, usedLocale, { sensitivity: 'base' })
  );

  return options;
}

