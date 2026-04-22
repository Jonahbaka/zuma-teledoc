import NigeriaCareDiscoveryExperience from '@/components/ng/NigeriaCareDiscoveryExperience';

export const metadata = {
  title: 'Medicine Discovery in Nigeria | DoctaRx',
  description:
    'Discover medicines, featured categories, access logic, and nearby pharmacy follow-through in Nigeria without using generic US-only medication assumptions.',
};

export default function NigeriaMedicinesPage() {
  return (
    <NigeriaCareDiscoveryExperience
      initialTab="pharmacy"
      pageTitle="Medicine discovery with safer Nigeria-first access logic"
      pageBody="Search medicines, compare safer access paths, and continue to pharmacy or provider follow-through without casually advertising prescription or restricted items."
    />
  );
}
