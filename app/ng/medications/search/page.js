import MedicationSearchV2 from '@/components/ng/medications/MedicationSearchV2';

export const metadata = {
  title: 'Medication Search — DoctaRx Nigeria',
  description: 'Nigerian brand-aware fuzzy medication search with interaction checker.',
};

export default function MedicationSearchPage() {
  return <MedicationSearchV2 />;
}
