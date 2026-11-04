// Lightweight voice module using the Web Speech API.
// This is client-only and gracefully no-ops on unsupported browsers.
import { useCallback, useEffect, useMemo, useState } from 'react';

function safeWindow() {
  return typeof window !== 'undefined' ? window : null;
}

export function canUseSpeechSynthesis() {
  const w = safeWindow();
  return Boolean(w && w.speechSynthesis && w.SpeechSynthesisUtterance);
}

export function useAgentVoice() {
  const [enabled, setEnabled] = useState(false);
  const [voices, setVoices] = useState([]);

  useEffect(() => {
    const w = safeWindow();
    if (!w) return;

    // Restore preference
    try {
      const saved = w.localStorage.getItem('doctarx_agent_voice_enabled');
      if (saved === 'true') setEnabled(true);
    } catch { /* ignore */ }

    if (!canUseSpeechSynthesis()) return;

    const loadVoices = () => {
      try {
        const available = w.speechSynthesis.getVoices();
        setVoices(Array.isArray(available) ? available : []);
      } catch {
        setVoices([]);
      }
    };

    loadVoices();
    w.speechSynthesis.onvoiceschanged = loadVoices;
    return () => {
      try { w.speechSynthesis.cancel(); } catch { /* ignore */ }
    };
  }, []);

  const setEnabledPersisted = useCallback((next) => {
    setEnabled(Boolean(next));
    const w = safeWindow();
    if (!w) return;
    try {
      w.localStorage.setItem('doctarx_agent_voice_enabled', next ? 'true' : 'false');
    } catch { /* ignore */ }
  }, []);

  const speak = useCallback((text, persona) => {
    const w = safeWindow();
    if (!w || !enabled || !canUseSpeechSynthesis()) return false;
    if (!text) return false;

    try {
      // Cancel previous speech to avoid queue buildup.
      w.speechSynthesis.cancel();

      const utterance = new w.SpeechSynthesisUtterance(text);
      const settings = persona?.voiceSettings || {};
      if (typeof settings.pitch === 'number') utterance.pitch = settings.pitch;
      if (typeof settings.rate === 'number') utterance.rate = settings.rate;

      const langPref = settings.langPreference || '';
      const preferredVoice =
        voices.find((v) => v.lang === langPref) ||
        voices.find((v) => (langPref ? v.lang?.startsWith(langPref.split('-')[0]) : false)) ||
        voices.find((v) => v.lang?.startsWith('en')) ||
        voices[0];

      if (preferredVoice) utterance.voice = preferredVoice;
      w.speechSynthesis.speak(utterance);
      return true;
    } catch {
      return false;
    }
  }, [enabled, voices]);

  const value = useMemo(() => ({
    enabled,
    setEnabled: setEnabledPersisted,
    voices,
    speak
  }), [enabled, setEnabledPersisted, voices, speak]);

  return value;
}

