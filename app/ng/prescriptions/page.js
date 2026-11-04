import PrescriptionsPortal from '@/components/ng/prescriptions/PrescriptionsPortal';

export const metadata = {
  title: 'Prescriptions — DoctaRx Nigeria',
  description: 'Doctor compose + sign, pharmacy receive + dispense, full Rx lifecycle with audit.',
};

export default function PrescriptionsPage() {
  return <PrescriptionsPortal initialTab="doctor-list" />;
}
