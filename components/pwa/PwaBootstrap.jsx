'use client';

import { useEffect, useState } from 'react';

const DISMISS_KEY = 'doctarx-install-dismissed-v1';
const DISMISS_TTL_MS = 1000 * 60 * 60 * 24 * 7;
const SW_RUNTIME_KEY = '__doctarxPwaRuntime';
const SW_RELOAD_PREFIX = 'doctarx-sw-reloaded:';

function isStandaloneDisplay() {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
}

function wasDismissedRecently() {
  if (typeof window === 'undefined') return false;
  const dismissedAt = Number(window.localStorage.getItem(DISMISS_KEY) || 0);
  return Boolean(dismissedAt && Date.now() - dismissedAt < DISMISS_TTL_MS);
}

function getServiceWorkerRuntime() {
  if (typeof window === 'undefined') return null;

  if (!window[SW_RUNTIME_KEY]) {
    window[SW_RUNTIME_KEY] = {
      controllerAtBoot: Boolean(window.navigator.serviceWorker?.controller),
      listenersBound: false,
      registration: null,
      registrationPromise: null
    };
  }

  return window[SW_RUNTIME_KEY];
}

function shouldReloadForVersion(version) {
  if (typeof window === 'undefined' || !version) return false;

  const storageKey = `${SW_RELOAD_PREFIX}${version}`;
  if (window.sessionStorage.getItem(storageKey)) {
    return false;
  }

  window.sessionStorage.setItem(storageKey, '1');
  return true;
}

function bindServiceWorkerLifecycle() {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
    return;
  }

  const runtime = getServiceWorkerRuntime();
  if (!runtime || runtime.listenersBound) {
    return;
  }

  runtime.listenersBound = true;

  const applyWaitingWorker = () => {
    if (runtime.registration?.waiting && navigator.serviceWorker.controller) {
      runtime.registration.waiting.postMessage({ type: 'SKIP_WAITING' });
    }
  };

  runtime.handleWorkerMessage = (event) => {
    if (event.data?.type !== 'APP_SHELL_ACTIVATED') {
      return;
    }

    if (runtime.controllerAtBoot && shouldReloadForVersion(event.data.version)) {
      window.location.reload();
    }
  };

  runtime.handleVisibilityChange = () => {
    if (document.visibilityState === 'visible') {
      runtime.registration?.update().catch(() => {});
    }
  };

  runtime.handleOnline = () => {
    runtime.registration?.update().catch(() => {});
  };

  navigator.serviceWorker.addEventListener('message', runtime.handleWorkerMessage);
  document.addEventListener('visibilitychange', runtime.handleVisibilityChange);
  window.addEventListener('online', runtime.handleOnline);

  const registerWorker = async () => {
    try {
      if (!runtime.registrationPromise) {
        runtime.registrationPromise = navigator.serviceWorker.register('/sw.js', { scope: '/' });
      }

      const registration = await runtime.registrationPromise;
      runtime.registration = registration;

      if (!runtime.updateListenerBound) {
        runtime.handleUpdateFound = () => {
          const installing = registration.installing;
          if (!installing) {
            return;
          }

          installing.addEventListener('statechange', () => {
            if (installing.state === 'installed') {
              applyWaitingWorker();
            }
          });
        };

        registration.addEventListener('updatefound', runtime.handleUpdateFound);
        runtime.updateListenerBound = true;
      }

      applyWaitingWorker();
      await registration.update().catch(() => {});
    } catch {
      // Service worker registration should never interrupt the app shell.
    }
  };

  if ('requestIdleCallback' in window) {
    window.requestIdleCallback(registerWorker, { timeout: 2000 });
  } else if (document.readyState === 'complete') {
    registerWorker();
  } else {
    window.addEventListener('load', registerWorker, { once: true });
  }
}

export default function PwaBootstrap() {
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [installMode, setInstallMode] = useState('hidden');
  const [isStandalone, setIsStandalone] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;

    const media = window.matchMedia('(display-mode: standalone)');
    const syncStandalone = () => {
      const standalone = isStandaloneDisplay();
      setIsStandalone(standalone);
      document.documentElement.classList.toggle('pwa-standalone', standalone);
    };

    syncStandalone();
    if (typeof media.addEventListener === 'function') {
      media.addEventListener('change', syncStandalone);
    } else if (typeof media.addListener === 'function') {
      media.addListener(syncStandalone);
    }

    return () => {
      if (typeof media.removeEventListener === 'function') {
        media.removeEventListener('change', syncStandalone);
      } else if (typeof media.removeListener === 'function') {
        media.removeListener(syncStandalone);
      }
    };
  }, []);

  useEffect(() => {
    bindServiceWorkerLifecycle();
    return undefined;
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    if (isStandalone || wasDismissedRecently()) {
      setInstallMode('hidden');
      return undefined;
    }

    const userAgent = window.navigator.userAgent || '';
    const isIOS = /iphone|ipad|ipod/i.test(userAgent);
    const isSafari = /safari/i.test(userAgent) && !/crios|fxios|edgios|android/i.test(userAgent);

    if (isIOS && isSafari) {
      setInstallMode('ios');
    }

    const handleBeforeInstallPrompt = (event) => {
      event.preventDefault();
      setDeferredPrompt(event);
      setInstallMode('prompt');
    };

    const handleInstalled = () => {
      setDeferredPrompt(null);
      setInstallMode('hidden');
      window.localStorage.removeItem(DISMISS_KEY);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleInstalled);
    };
  }, [isStandalone]);

  let description = '';
  if (installMode === 'ios') {
    description = 'Add DoctaRx to your home screen from Safari so visits and dashboards launch like a native app.';
  } else if (installMode === 'prompt') {
    description = 'Install DoctaRx for faster launch, offline shell caching, and standalone mobile navigation.';
  }

  const dismissPrompt = () => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(DISMISS_KEY, String(Date.now()));
    }
    setDeferredPrompt(null);
    setInstallMode('hidden');
  };

  const handleInstall = async () => {
    if (!deferredPrompt) return;

    try {
      await deferredPrompt.prompt();
      const choice = await deferredPrompt.userChoice;
      if (choice?.outcome !== 'accepted') {
        dismissPrompt();
      }
    } catch {
      dismissPrompt();
    } finally {
      setDeferredPrompt(null);
    }
  };

  if (isStandalone || installMode === 'hidden') {
    return null;
  }

  return (
    <aside className="app-install-banner" aria-live="polite">
      <div className="app-install-banner__eyebrow">Install DoctaRx</div>
      <p className="app-install-banner__copy">{description}</p>
      <div className="app-install-banner__actions">
        {installMode === 'prompt' ? (
          <button type="button" className="app-install-banner__primary" onClick={handleInstall}>
            Install App
          </button>
        ) : (
          <span className="app-install-banner__hint">Tap Share, then Add to Home Screen.</span>
        )}
        <button type="button" className="app-install-banner__secondary" onClick={dismissPrompt}>
          Not now
        </button>
      </div>
    </aside>
  );
}
