import { Suspense } from 'react';
import NigeriaAdminLoginPage from '@/components/ng/admin/NigeriaAdminLoginPage';

export const metadata = {
  title: 'Nigeria Admin Login | DoctaRx',
  description: 'Dedicated DoctaRx Nigeria admin portal login.',
};

function NigeriaAdminLoginFallback() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-blue-50 text-sm font-semibold text-blue-900">
      Loading Nigeria admin login...
    </div>
  );
}

export default function NigeriaAdminLoginRoute() {
  return (
    <Suspense fallback={<NigeriaAdminLoginFallback />}>
      <NigeriaAdminLoginPage />
    </Suspense>
  );
}
