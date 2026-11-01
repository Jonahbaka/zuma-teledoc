import MarketHomepage from '@/components/marketing/MarketHomepage';

export const metadata = {
  title: 'DoctaRx | Telehealth AI & Connected Care',
  description:
    'DoctaRx is a Telehealth AI company connecting virtual care, health records, messaging, and pharmacy coordination. Explore care options for your account.',
  alternates: {
    canonical: 'https://doctarx.com/',
    languages: {
      'en-US': 'https://doctarx.com/',
      'en-NG': 'https://doctarx.com/ng',
    },
  },
  openGraph: {
    title: 'DoctaRx | Telehealth AI · United States',
    description:
      'Explore virtual care, health records, messaging, and pharmacy options in the United States. Services and availability are confirmed before booking.',
    url: 'https://doctarx.com/',
    siteName: 'DoctaRx',
    locale: 'en_US',
    alternateLocale: ['en_NG'],
    type: 'website',
    images: ['/opengraph-image'],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'DoctaRx | Telehealth AI · United States',
    description:
      'Explore virtual care, health records, messaging, and pharmacy options in the United States. Services and availability are confirmed before booking.',
    images: ['/opengraph-image'],
  },
};

export default function HomePage() {
  return <MarketHomepage market="US" />;
}
