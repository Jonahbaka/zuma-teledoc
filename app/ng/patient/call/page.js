'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function NigeriaPatientStandaloneCallEntry() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/ng/patient/appointments');
  }, [router]);

  return (
    <div className="flex min-h-[40vh] items-center justify-center">
      <div className="text-center">
        <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-4 border-emerald-600 border-t-transparent" />
        <p className="text-gray-600">Opening consultations...</p>
      </div>
    </div>
  );
}
