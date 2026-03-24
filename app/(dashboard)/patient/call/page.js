'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Patient-only standalone call entrypoint for video testing without a booked appointment.
 */
export default function PatientStandaloneCallEntry() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/patient/appointments/standalone/call');
  }, [router]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <div className="text-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4" />
        <p className="text-slate-600">Opening test call...</p>
      </div>
    </div>
  );
}
