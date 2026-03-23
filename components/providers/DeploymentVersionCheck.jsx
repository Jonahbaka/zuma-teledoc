'use client';

import { useEffect, useRef } from 'react';

/**
 * DeploymentVersionCheck
 *
 * Polls /api/health every 5 seconds to detect deployment changes.
 * When the reported build id changes:
 * 1. Clears localStorage, sessionStorage, and IndexedDB
 * 2. Unregisters service workers
 * 3. Reloads the page without relying on cached assets
 */
export function DeploymentVersionCheck() {
  const lastVersionRef = useRef(null);
  const checkIntervalRef = useRef(null);

  useEffect(() => {
    const checkDeployment = async () => {
      try {
        const response = await fetch('/api/health', {
          method: 'GET',
          cache: 'no-store',
          headers: { Pragma: 'no-cache', 'Cache-Control': 'no-cache' }
        });

        if (!response.ok) return;

        const data = await response.json();
        const currentVersion = data.buildId || data.version || 'unknown';
        const timestamp = data.timestamp;

        if (lastVersionRef.current === null) {
          lastVersionRef.current = { version: currentVersion, timestamp };
          return;
        }

        if (currentVersion !== lastVersionRef.current.version) {
          console.warn(
            `Deployment detected. Version changed from ${lastVersionRef.current.version} to ${currentVersion}. Clearing cache and reloading.`
          );

          try {
            localStorage.clear();
            sessionStorage.clear();

            if ('serviceWorker' in navigator) {
              const registrations = await navigator.serviceWorker.getRegistrations();
              for (const registration of registrations) {
                await registration.unregister();
              }
            }

            const databases = await indexedDB.databases?.() || [];
            for (const database of databases) {
              indexedDB.deleteDatabase(database.name);
            }
          } catch (error) {
            console.error('Error clearing cached client state:', error);
          }

          setTimeout(() => {
            window.location.reload();
          }, 500);
        }

        lastVersionRef.current = { version: currentVersion, timestamp };
      } catch {
        // Ignore transient network failures.
      }
    };

    checkDeployment();
    checkIntervalRef.current = setInterval(checkDeployment, 5000);

    return () => {
      if (checkIntervalRef.current) {
        clearInterval(checkIntervalRef.current);
      }
    };
  }, []);

  return null;
}
