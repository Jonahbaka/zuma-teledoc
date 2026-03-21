'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { toProviderPortalPath } from '@/lib/providerPortal';

/**
 * Provider-only standalone call entrypoint (no appointment required).
 * Reuses the existing provider call UI by routing to a special standalone id.
 */
export default function ProviderStandaloneCallEntry() {
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    router.replace(toProviderPortalPath('/appointments/standalone/call', { pathname }));
  }, [pathname, router]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <div className="text-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-500 mx-auto mb-4"></div>
        <p className="text-slate-600">Opening video call...</p>
      </div>
    </div>
  );
}


