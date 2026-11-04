import GovernmentDataWorkspace from '@/components/ng/government/GovernmentDataWorkspace';

export const metadata = {
  title: 'Executive Command Center | DoctaRx Nigeria',
  description: 'Real-time public-health intelligence and operational visibility for DoctaRx Nigeria executive leadership.',
};

export default function ExecutiveViewPage() {
  return <div className="clinical-readable"><GovernmentDataWorkspace readOnly heading="Executive command center" /></div>;
}
