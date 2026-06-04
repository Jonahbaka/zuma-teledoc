import ConferencePortal from '@/components/ng/conference/ConferencePortal';

export const metadata = {
  title: 'Clinical Video — DoctaRx Nigeria',
  description: 'Multi-party clinical video: consultations, case conferences, teaching rounds, board reviews, emergency coordination.',
};

export default function ConferencePage() {
  return <ConferencePortal initialTab="rooms" />;
}
