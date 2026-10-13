'use client';

import dynamic from 'next/dynamic';
import { usePathname } from 'next/navigation';

const GoogleAnalytics = dynamic(() => import('@/components/analytics/GoogleAnalytics'), {
  ssr: false,
});
const DeploymentVersionCheck = dynamic(
  () => import('@/components/providers/DeploymentVersionCheck').then((mod) => mod.DeploymentVersionCheck),
  { ssr: false }
);
const PwaBootstrap = dynamic(() => import('@/components/pwa/PwaBootstrap'), {
  ssr: false,
});

export default function ClientRuntime() {
  const pathname = usePathname() || '';
  const isCareOps = pathname.startsWith('/careops') || pathname.startsWith('/ng/phc') || pathname.startsWith('/ng/government-data');
  return (
    <>
      {!isCareOps && <GoogleAnalytics />}
      <DeploymentVersionCheck />
      <PwaBootstrap />
    </>
  );
}
