'use client';

import dynamic from 'next/dynamic';

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
  return (
    <>
      <GoogleAnalytics />
      <DeploymentVersionCheck />
      <PwaBootstrap />
    </>
  );
}
