'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

export function useSpeechSynthesis() {
  const [voices, setVoices] = useState([]);

  const supported = useMemo(() => {
    return typeof window !== 'undefined' && !!window.speechSynthesis && typeof window.SpeechSynthesisUtterance !== 'undefined';
  }, []);

  useEffect(() => {
    if (!supported) return;

    const load = () => {
      try {
        const list = window.speechSynthesis.getVoices() || [];
        setVoices(list);
      } catch {
        setVoices([]);
      }
    };

    load();
    // Chrome loads voices asynchronously
    window.speechSynthesis.onvoiceschanged = load;

    return () => {
      try { window.speechSynthesis.cancel(); } catch { /* ignore */ }
      try { window.speechSynthesis.onvoiceschanged = null; } catch { /* ignore */ }
    };
  }, [supported]);

  const stop = useCallback(() => {
    if (!supported) return;
    try { window.speechSynthesis.cancel(); } catch { /* ignore */ }
  }, [supported]);

  const speak = useCallback((text, settings = {}) => {
    if (!supported) return false;
    const raw = String(text || '').trim();
    if (!raw) return false;

    const pitch = typeof settings.pitch === 'number' ? settings.pitch : 1.0;
    const rate = typeof settings.rate === 'number' ? settings.rate : 1.0;
    const langPreference = String(settings.langPreference || '').trim();

    try {
      // Cancel previous speech to avoid queue buildup.
      window.speechSynthesis.cancel();

      const u = new SpeechSynthesisUtterance(raw);
      u.pitch = pitch;
      u.rate = rate;

      // Pick a voice based on preference, then any English, then default.
      const preferred =
        (langPreference ? voices.find((v) => v.lang === langPreference) : null) ||
        voices.find((v) => String(v.lang || '').toLowerCase().startsWith('en')) ||
        voices[0];

      if (preferred) u.voice = preferred;
      if (langPreference) u.lang = langPreference;

      window.speechSynthesis.speak(u);
      return true;
    } catch {
      return false;
    }
  }, [supported, voices]);

  return { supported, voices, speak, stop };
}

