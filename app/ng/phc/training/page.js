import PhcTrainingManual from '@/components/ng/phc/PhcTrainingManual';

export const metadata = {
  title: 'PHC Field Guide | DoctaRx Nigeria',
  description: 'Nurse and doctor orientation guide for the DoctaRx Nigeria PHC workspace.',
};

export default function PhcTrainingPage() {
  return <PhcTrainingManual standalone />;
}
