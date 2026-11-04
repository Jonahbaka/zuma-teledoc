import PublicHealthProgrammeDashboard from '@/components/ng/admin/PublicHealthProgrammeDashboard';

export const metadata = {
  title: 'Public Health Settings | DoctaRx Nigeria Admin',
};

export default function NigeriaPublicHealthSettingsPage() {
  return <PublicHealthProgrammeDashboard initialTab="settings" />;
}
