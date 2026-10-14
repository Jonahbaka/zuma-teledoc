import CareOpsShell from '@/components/careops/CareOpsShell';

export const metadata = {
  title: { default: 'DoctaRx CareOps', template: '%s | DoctaRx CareOps' },
  description: 'Facility care and scoped institutional reporting.',
  robots: { index: false, follow: false },
  alternates: { canonical: '/careops' },
  manifest: '/careops/manifest.webmanifest',
  applicationName: 'DoctaRx CareOps',
  openGraph: { title: 'DoctaRx CareOps', description: 'Clinical collaboration and scoped institutional reporting.', siteName: 'DoctaRx CareOps', url: '/careops' },
};

export default function CareOpsLayout({ children }) {
  return <CareOpsShell>{children}</CareOpsShell>;
}
