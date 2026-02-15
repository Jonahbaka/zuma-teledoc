'use client';

import React, { createContext, useCallback, useEffect, useMemo, useState } from 'react';
import { DEFAULT_LANG, detectBrowserLang, getStoredLang, normalizeLang, storeLang, t as translate } from '@/lib/i18n';

const I18nContext = createContext({
  lang: DEFAULT_LANG,
  setLang: () => {},
  t: (key, fallback) => fallback || key
});

export function I18nProvider({ children }) {
  const [lang, setLangState] = useState(DEFAULT_LANG);

  useEffect(() => {
    // Initial language: localStorage > browser > default
    const initial = getStoredLang() || detectBrowserLang() || DEFAULT_LANG;
    setLangState(normalizeLang(initial));
  }, []);

  useEffect(() => {
    // Reflect on <html lang="..."> for accessibility/SEO.
    try {
      document.documentElement.lang = lang;
    } catch {
      // ignore
    }
  }, [lang]);

  const setLang = useCallback((next) => {
    const normalized = normalizeLang(next);
    setLangState(normalized);
    storeLang(normalized);
  }, []);

  const value = useMemo(() => ({
    lang,
    setLang,
    t: (key, fallback) => translate(lang, key, fallback)
  }), [lang, setLang]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const ctx = React.useContext(I18nContext);
  return ctx;
}

