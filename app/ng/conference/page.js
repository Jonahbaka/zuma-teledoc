import ConferencePortal from '@/components/ng/conference/ConferencePortal';

export const metadata = {
  title: 'Conferencing — DoctaRx Nigeria',
  description: 'Multi-party clinical conferencing: consultations, case conferences, teaching rounds, board reviews, emergency coordination.',
};

export default function ConferencePage() {
  return <ConferencePortal initialTab="rooms" />;
}
