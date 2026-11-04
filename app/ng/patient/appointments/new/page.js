import { redirect } from 'next/navigation';

export default function NigeriaNewAppointmentRedirect() {
  redirect('/ng/patient/appointments/book');
}
