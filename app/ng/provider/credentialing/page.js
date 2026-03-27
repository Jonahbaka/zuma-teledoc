import { FileCheck } from 'lucide-react';
import ProviderMarketWorkspaceNotice from '@/components/provider/ProviderMarketWorkspaceNotice';

export default function NigeriaProviderCredentialingPage() {
  return (
    <ProviderMarketWorkspaceNotice
      icon={FileCheck}
      title="Licensure review is handled through Nigeria onboarding"
      description="Nigeria provider activation does not use the US credentialing checkout or NPI and DEA workflow. Licensure review continues through your registration details, profile, and admin approval process."
      primaryAction={{
        title: 'Review your provider profile',
        description: 'Update your specialty, license details, and other Nigeria-specific practice information.',
        href: '/ng/provider/profile',
        label: 'Open profile',
      }}
      secondaryAction={{
        title: 'Return to operations',
        description: 'Use the dashboard to continue visits, prescriptions, and care coordination while review is in progress.',
        href: '/ng/provider/dashboard',
        label: 'Open dashboard',
      }}
    />
  );
}
