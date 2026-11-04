import { notFound } from 'next/navigation';
import ProviderImagingPage from '@/app/(dashboard)/provider/imaging/page';

export default function NigeriaProviderImagingPage() {
  if (process.env.NG_MEDICAL_IMAGING_AUTHORIZED !== 'true') notFound();
  return <ProviderImagingPage />;
}
