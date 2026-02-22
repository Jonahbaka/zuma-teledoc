'use client';

import { useEffect, useRef } from 'react';

/**
 * DeploymentVersionCheck
 * 
 * Polls /api/health every 5 seconds to detect deployment changes.
 * When version changes:
 * 1. Clears localStorage, sessionStorage, IndexedDB
 * 2. Unregisters all service workers
 * 3. Reloads the page (bypassing cache)
 * 
 * This prevents users from getting stuck on stale builds.
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
          headers: { 'Pragma': 'no-cache', 'Cache-Control': 'no-cache' }
        });

        if (!response.ok) return;

        const data = await response.json();
        const currentVersion = data.version || 'unknown';
        const timestamp = data.timestamp;

        // First check: store the version
        if (lastVersionRef.current === null) {
          lastVersionRef.current = { version: currentVersion, timestamp };
          return;
        }

        // Subsequent checks: detect version change
        if (currentVersion !== lastVersionRef.current.version) {
          console.warn(
            `🚀 Deployment detected! Version changed from ${lastVersionRef.current.version} → ${currentVersion}. Clearing cache and reloading...`
          );

          // Clear all storage
          try {
            localStorage.clear();
            sessionStorage.clear();

            // Unregister all service workers
            if ('serviceWorker' in navigator) {
              const registrations = await navigator.serviceWorker.getRegistrations();
              for (const reg of registrations) {
                await reg.unregister();
              }
            }

            // Clear IndexedDB
            const dbs = await indexedDB.databases?.() || [];
            for (const db of dbs) {
              indexedDB.deleteDatabase(db.name);
            }
          } catch (e) {
            console.error('Error clearing cache:', e);
          }

          // Hard reload, bypassing cache
          setTimeout(() => {
            window.location.href = window.location.href;
          }, 500);
        }

        lastVersionRef.current = { version: currentVersion, timestamp };
      } catch (error) {
        // Silently fail (network issues, etc.)
      }
    };

    // Start checking immediately
    checkDeployment();

    // Then check every 5 seconds
    checkIntervalRef.current = setInterval(checkDeployment, 5000);

    return () => {
      if (checkIntervalRef.current) {
        clearInterval(checkIntervalRef.current);
      }
    };
  }, []);

  // This component doesn't render anything
  return null;
}
