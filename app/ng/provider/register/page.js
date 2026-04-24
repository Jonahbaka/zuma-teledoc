import ProviderRegisterPage from '@/components/provider/ProviderRegisterPage';

export const metadata = {
  title: 'Provider Registration for Nigeria Telehealth',
  description:
    'Join the DoctaRx Nigeria provider network for online consultations, prescription follow-through, and connected pharmacy coordination.',
  alternates: {
    canonical: 'https://doctarx.com/ng/provider/register',
  },
  robots: {
    index: true,
    follow: true,
  },
  openGraph: {
    title: 'DoctaRx Nigeria Provider Registration',
    description:
      'Apply to join the Nigeria provider network for telehealth consultations and prescription-connected care delivery.',
    url: 'https://doctarx.com/ng/provider/register',
    siteName: 'DoctaRx Nigeria',
    locale: 'en_NG',
    type: 'website',
    images: ['/ng/opengraph-image'],
  },
};

export default function NigeriaProviderRegisterPage() {
  return <ProviderRegisterPage market="NG" />;
}
