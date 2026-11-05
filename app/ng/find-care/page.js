import NigeriaCareDiscoveryExperience from '@/components/ng/NigeriaCareDiscoveryExperience';
import { publicMetadata } from '@/lib/seo/metadata.cjs';

export const metadata = publicMetadata({
  title: 'Find care and providers in Nigeria',
  path: '/ng/find-care',
  description:
    'Search symptoms, medicines, specialists, and trusted provider options in Nigeria with location-aware ranking, manual fallback, and low-bandwidth telehealth options.',
});

export default function NigeriaFindCarePage() {
  return (
    <NigeriaCareDiscoveryExperience
      initialTab="nearest"
      pageTitle="Find care, providers, and next-step treatment options"
      pageBody="Search by symptom, medicine, specialty, provider name, or payer badge. If GPS is weak, continue with state, city, or landmark without breaking the flow."
    />
  );
}
