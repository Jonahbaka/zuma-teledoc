import ReferralNetworkPortal from '@/components/ng/referral-network/ReferralNetworkPortal';

export const metadata = {
  title: 'DoctaRx Referral Network — DoctaRx Nigeria',
  description: 'Nationwide referral coordination across hospitals, labs, pharmacies, specialists, and agents.',
};

export default function ReferralNetworkPage() {
  return <ReferralNetworkPortal initialTab="overview" />;
}
