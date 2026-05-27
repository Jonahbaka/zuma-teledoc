import OperationsHub from '@/components/ng/provider/OperationsHub';

export const metadata = {
  title: 'Operations Hub — DoctaRx Nigeria',
  description: 'Provider operations workspace: prescriptions, conferences, referrals, SOAP, medications, analytics — all in one screen.',
};

export default function ProviderOperationsPage() {
  return <OperationsHub />;
}
