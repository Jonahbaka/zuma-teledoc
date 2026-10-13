import CareOpsShell from '@/components/careops/CareOpsShell';

export const metadata = {
  title: 'CareOps | DoctaRx',
  description: 'Facility care and scoped institutional reporting.',
  robots: { index: false, follow: false },
};

export default function CareOpsLayout({ children }) {
  return <CareOpsShell>{children}</CareOpsShell>;
}
