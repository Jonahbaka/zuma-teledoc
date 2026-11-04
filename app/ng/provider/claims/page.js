import { Receipt } from 'lucide-react';
import ProviderMarketWorkspaceNotice from '@/components/provider/ProviderMarketWorkspaceNotice';

export default function NigeriaProviderClaimsPage() {
  return (
    <ProviderMarketWorkspaceNotice
      icon={Receipt}
      title="Claims are not part of the Nigeria provider portal"
      description="The Nigeria workflow is centered on consultations, prescriptions, referrals, and pharmacy fulfillment. US insurance clearinghouse claims remain intentionally hidden from Nigeria providers."
      primaryAction={{
        title: 'Continue care operations',
        description: 'Return to your live dashboard for appointments, notes, and patient follow-up.',
        href: '/ng/provider/dashboard',
        label: 'Open dashboard',
      }}
      secondaryAction={{
        title: 'Finish visit documentation',
        description: 'Use visit notes and patient records instead of an insurance claims queue.',
        href: '/ng/provider/visits',
        label: 'Open visit notes',
      }}
    />
  );
}
