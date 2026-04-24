'use client';

import NigeriaCareDiscoveryExperience from '@/components/ng/NigeriaCareDiscoveryExperience';

export default function NigeriaPatientSearchPage() {
  return (
    <NigeriaCareDiscoveryExperience
      initialTab="nearest"
      embeddedInPortal
      pageTitle="Continue care discovery inside the Nigeria patient portal"
      pageBody="Search providers, teleconsult options, medicine categories, and pharmacy follow-through from the patient workspace. Manual location and low-bandwidth fallback stay available throughout the flow."
    />
  );
}
