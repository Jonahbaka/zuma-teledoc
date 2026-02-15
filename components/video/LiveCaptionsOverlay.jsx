'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import api from '@/lib/api';

function getSpeechRecognition() {
  if (typeof window === 'undefined') return null;
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

function isSupported() {
  return Boolean(getSpeechRecognition());
}

const COMMON_LANGS = [
  { id: 'auto', label: 'Auto (browser)' },
  { id: 'en-US', label: 'English' },
  { id: 'es-ES', label: 'Spanish' },
  { id: 'pt-BR', label: 'Portuguese (Brazil)' },
  { id: 'fr-FR', label: 'French' },
  { id: 'hi-IN', label: 'Hindi' }
];

async function translateText({ text, targetLang, sourceLang }) {
  // Note: only called when user enables translation (phiConsent: true).
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 9000);
  try {
    const res = await api.post(
      '/ai-assist/translate',
      { text, targetLang, sourceLang, phiConsent: true },
      { signal: controller.signal }
    );
    return res?.data?.translatedText || text;
  } catch {
    return text;
  } finally {
    clearTimeout(t);
  }
}

export default function LiveCaptionsOverlay({
  enabled,
  speakerLabel = 'You',
  defaultTargetLang = 'en-US',
  className = ''
}) {
  const supported = useMemo(() => isSupported(), []);
  const [listening, setListening] = useState(false);
  const [error, setError] = useState(null);
  const [lines, setLines] = useState([]);
  const [interim, setInterim] = useState('');

  // Settings
  const [showPanel, setShowPanel] = useState(false);
  const [speechLang, setSpeechLang] = useState('auto');
  const [translateOn, setTranslateOn] = useState(false);
  const [targetLang, setTargetLang] = useState(defaultTargetLang);

  const recognitionRef = useRef(null);
  const stopRequestedRef = useRef(false);
  const translateQueueRef = useRef(Promise.resolve());

  // Keep only last N lines so we don't grow memory during long calls.
  const pushLine = (line) => {
    setLines((prev) => {
      const next = [...prev, line];
      return next.slice(-6);
    });
  };

  const resolvedSpeechLang = useMemo(() => {
    if (speechLang !== 'auto') return speechLang;
    if (typeof navigator === 'undefined') return 'en-US';
    return navigator.language || 'en-US';
  }, [speechLang]);

  useEffect(() => {
    if (!enabled) return;
    if (!supported) return;

    stopRequestedRef.current = false;
    setError(null);

    const SR = getSpeechRecognition();
    const recognition = new SR();
    recognitionRef.current = recognition;

    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = resolvedSpeechLang;

    recognition.onstart = () => setListening(true);
    recognition.onerror = (e) => {
      // Some browsers throw "not-allowed" if mic permission is blocked.
      setError(e?.error || 'speech_error');
    };
    recognition.onend = () => {
      setListening(false);
      setInterim('');
      if (!stopRequestedRef.current && enabled) {
        // Auto-restart for robustness (Chrome stops occasionally).
        try {
          recognition.start();
        } catch {
          // Ignore.
        }
      }
    };
    recognition.onresult = (event) => {
      let interimText = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const text = result?.[0]?.transcript || '';
        if (!text) continue;
        if (result.isFinal) {
          const raw = text.trim();
          if (!raw) continue;

          const line = {
            id: `${Date.now()}_${Math.random().toString(16).slice(2)}`,
            speaker: speakerLabel,
            text: raw,
            translatedText: null
          };
          pushLine(line);

          if (translateOn) {
            // Serialize translations to avoid bursts.
            translateQueueRef.current = translateQueueRef.current.then(async () => {
              const translatedText = await translateText({
                text: raw,
                targetLang,
                sourceLang: resolvedSpeechLang
              });
              setLines((prev) =>
                prev.map((l) => (l.id === line.id ? { ...l, translatedText } : l))
              );
            });
          }
        } else {
          interimText += text;
        }
      }
      setInterim(interimText.trim());
    };

    try {
      recognition.start();
    } catch (e) {
      setError(e?.message || 'speech_start_failed');
    }

    return () => {
      stopRequestedRef.current = true;
      try {
        recognition.onresult = null;
        recognition.onerror = null;
        recognition.onend = null;
        recognition.onstart = null;
        recognition.stop();
      } catch {
        // Ignore.
      }
      recognitionRef.current = null;
      setListening(false);
      setInterim('');
    };
  }, [enabled, supported, resolvedSpeechLang, speakerLabel, translateOn, targetLang]);

  // Reset captions when toggling off to avoid stale display.
  useEffect(() => {
    if (!enabled) {
      setLines([]);
      setInterim('');
      setError(null);
      setShowPanel(false);
    }
  }, [enabled]);

  if (!enabled) return null;

  return (
    <div className={`absolute inset-x-0 bottom-14 flex items-end justify-center ${className}`}>
      <div className="w-[92%] max-w-3xl pointer-events-none">
        {/* Caption lines */}
        <div className="space-y-1 text-center">
          {lines.map((line, idx) => {
            const isLast = idx === lines.length - 1;
            const displayText = line.translatedText || line.text;
            return (
              <div
                key={line.id}
                className={`transition-all duration-300 ${isLast ? 'opacity-100' : 'opacity-70'}`}
              >
                <span className="bg-black/70 text-white backdrop-blur-sm px-4 py-2 rounded-xl text-sm shadow-lg inline-block">
                  <span className="font-bold text-blue-300 mr-2">{line.speaker}:</span>
                  {displayText}
                </span>
              </div>
            );
          })}

          {interim ? (
            <div className="opacity-75">
              <span className="bg-black/50 text-white/90 backdrop-blur-sm px-4 py-2 rounded-xl text-sm inline-block">
                <span className="font-bold text-blue-300 mr-2">{speakerLabel}:</span>
                {interim}
              </span>
            </div>
          ) : null}
        </div>

        {/* Status + settings (needs pointer events) */}
        <div className="mt-2 flex justify-center">
          <div className="pointer-events-auto bg-black/50 border border-white/10 backdrop-blur px-3 py-2 rounded-xl text-[11px] text-white/80 flex items-center gap-3">
            <span className="flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full ${listening ? 'bg-emerald-400 animate-pulse' : 'bg-slate-400'}`} />
              {supported ? (listening ? 'Captions live' : 'Captions paused') : 'Captions unsupported'}
            </span>
            {error ? <span className="text-amber-300">({String(error)})</span> : null}
            <button
              type="button"
              onClick={() => setShowPanel((v) => !v)}
              className="text-white/90 hover:text-white underline underline-offset-2"
            >
              Settings
            </button>
          </div>
        </div>

        {showPanel ? (
          <div className="pointer-events-auto mt-2 bg-black/70 border border-white/10 backdrop-blur p-3 rounded-xl text-xs text-white/90">
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2">
                <span className="text-white/70">Speech language</span>
                <select
                  value={speechLang}
                  onChange={(e) => setSpeechLang(e.target.value)}
                  className="bg-black/40 border border-white/10 rounded px-2 py-1 outline-none"
                >
                  {COMMON_LANGS.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="flex items-center gap-2">
                <span className="text-white/70">Translate captions</span>
                <input
                  type="checkbox"
                  checked={translateOn}
                  onChange={(e) => setTranslateOn(e.target.checked)}
                />
              </label>

              <label className={`flex items-center gap-2 ${translateOn ? '' : 'opacity-50'}`}>
                <span className="text-white/70">To</span>
                <select
                  value={targetLang}
                  onChange={(e) => setTargetLang(e.target.value)}
                  disabled={!translateOn}
                  className="bg-black/40 border border-white/10 rounded px-2 py-1 outline-none disabled:opacity-60"
                >
                  {COMMON_LANGS.filter((l) => l.id !== 'auto').map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {translateOn ? (
              <div className="mt-2 text-[11px] text-white/70">
                Translation sends caption text to your configured AI provider. Disable if PHI should not leave the browser.
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

