import { Building2 } from 'lucide-react';
import ProviderMarketWorkspaceNotice from '@/components/provider/ProviderMarketWorkspaceNotice';

export default function NigeriaProviderHospitalNetworkPage() {
  return (
    <ProviderMarketWorkspaceNotice
      icon={Building2}
      title="Use referrals for hospital and facility coordination"
      description="Nigeria providers route hospital and facility coordination through live referrals and patient follow-up workflows. The US hospital network integration screen is hidden here because it relies on market-specific EHR connection models."
      primaryAction={{
        title: 'Open care referrals',
        description: 'Dispatch live referrals to connected organizations from the Nigeria provider workspace.',
        href: '/ng/provider/referrals',
        label: 'Open referrals',
      }}
      secondaryAction={{
        title: 'Return to your patient queue',
        description: 'Continue consultations, notes, and patient management from the core Nigeria provider flow.',
        href: '/ng/provider/patients',
        label: 'Open patients',
      }}
    />
  );
}
