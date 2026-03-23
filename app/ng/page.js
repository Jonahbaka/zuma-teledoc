import MarketHomepage from '@/components/marketing/MarketHomepage';

export const metadata = {
  title: 'Nigeria Prescription and Pharmacy Network',
  description:
    'DoctaRx Nigeria combines medicine search, prescription upload, pharmacy confirmation, local payment rails, and fulfillment tracking in one premium regional experience.',
  alternates: {
    canonical: 'https://doctarx.com/ng',
  },
  openGraph: {
    title: 'DoctaRx Nigeria',
    description:
      'Medicine search, prescription upload, pharmacy confirmation, local payment rails, and fulfillment tracking in one premium Nigeria experience.',
    url: 'https://doctarx.com/ng',
    siteName: 'DoctaRx Nigeria',
    locale: 'en_NG',
    type: 'website',
    images: ['/ng/opengraph-image'],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'DoctaRx Nigeria',
    description:
      'Medicine search, prescription upload, pharmacy confirmation, local payment rails, and fulfillment tracking in one premium Nigeria experience.',
    images: ['/ng/opengraph-image'],
  },
};

export default function NigeriaLandingPage() {
  return <MarketHomepage market="NG" />;
}
