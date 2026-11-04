import { redirect } from 'next/navigation';

export default function CommandCenterSettingsRedirectPage() {
  redirect('/admin/settings');
}
