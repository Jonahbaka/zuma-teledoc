import PublicHealthProgrammeDashboard from '@/components/ng/admin/PublicHealthProgrammeDashboard';

export const metadata = {
  title: 'Public Health Forecasting | DoctaRx Nigeria Admin',
};

export default function NigeriaPublicHealthForecastingPage() {
  return <PublicHealthProgrammeDashboard initialTab="forecasting" />;
}
