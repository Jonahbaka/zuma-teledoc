import { redirect } from 'next/navigation';

export default function AdminPortalRootPage() {
  redirect('/admin/dashboard');
}
