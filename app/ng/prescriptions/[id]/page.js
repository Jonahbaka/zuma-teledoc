import RxDetail from '@/components/ng/prescriptions/RxDetail';

export const metadata = { title: 'Prescription — DoctaRx Nigeria' };

export default function RxDetailPage({ params }) {
  return <RxDetail id={params.id} />;
}
