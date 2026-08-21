import GovernmentDataWorkspace from '@/components/ng/government/GovernmentDataWorkspace';

export const metadata = {
  title: 'Government Data Workspace | DoctaRx Nigeria',
  description: 'Scoped government data intake, approval, reconciliation, search, and export.',
};

export default function GovernmentDataPage() {
  return <GovernmentDataWorkspace />;
}
