'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function NigeriaPatientStandaloneCallEntry() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/ng/patient/appointments/standalone/call');
  }, [router]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="text-center">
        <div className="animate-spin w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full mx-auto mb-4" />
        <p className="text-gray-600">Opening test call...</p>
      </div>
    </div>
  );
}
