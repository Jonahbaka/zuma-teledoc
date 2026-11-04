import { redirect } from 'next/navigation';

export default function LegacyPatientAppointmentPage() {
  redirect('/patient/appointments/book');
}
