import PublicHealthProgrammeDashboard from '@/components/ng/admin/PublicHealthProgrammeDashboard';

export const metadata = {
  title: 'DHIS2 Readiness | DoctaRx Nigeria Admin',
};

export default function NigeriaPublicHealthDhis2ReadinessPage() {
  return <PublicHealthProgrammeDashboard initialTab="dhis2" />;
}
