import PublicHealthProgrammeDashboard from '@/components/ng/admin/PublicHealthProgrammeDashboard';

export const metadata = {
  title: 'Public Health Reports | DoctaRx Nigeria Admin',
};

export default function NigeriaPublicHealthReportsPage() {
  return <PublicHealthProgrammeDashboard initialTab="reports" />;
}
