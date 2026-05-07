import PublicHealthProgrammeDashboard from '@/components/ng/admin/PublicHealthProgrammeDashboard';

export const metadata = {
  title: 'Public Health Intelligence Programme | DoctaRx Nigeria Admin',
};

export default function NigeriaPublicHealthProgrammePage() {
  return <PublicHealthProgrammeDashboard initialTab="executive" />;
}
