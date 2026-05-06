import TestingLinksClient from '@/app/(dashboard)/admin/testing-links/TestingLinksClient';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';

export const metadata = {
  title: 'Nigeria Testing Access | DoctaRx Admin',
  robots: {
    index: false,
    follow: false,
  },
};

export default function NigeriaTestingLinksPage() {
  return <TestingLinksClient market="NG" />;
}
