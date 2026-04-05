import { redirect } from 'next/navigation';

export default function PatientPortalRootPage() {
  redirect('/patient/dashboard');
}
