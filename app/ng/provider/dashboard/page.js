import ProviderDashboardPage from '@/app/(dashboard)/provider/dashboard/page';
import ProviderCommandCenter from '@/components/ng/provider/ProviderCommandCenter';

export default function NigeriaProviderDashboardPage() {
  if (process.env.NEXT_PUBLIC_NG_PROVIDER_COMMAND_CENTER_ENABLED !== 'false') {
    return <ProviderCommandCenter />;
  }

  return <ProviderDashboardPage />;
}
