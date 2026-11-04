import MarketHomepage from '@/components/marketing/MarketHomepage';

export const metadata = {
  title: 'DoctaRx | AI-First Telehealth & Language Voice',
  description:
    'A global AI-first telehealth platform connecting patients and providers. Explore language voice across Africa and beyond, clinician-led care, records and pharmacy coordination.',
  alternates: {
    canonical: 'https://doctarx.com/',
    languages: {
      'en-US': 'https://doctarx.com/',
      'en-NG': 'https://doctarx.com/ng',
    },
  },
  openGraph: {
    title: 'DoctaRx | AI-First Telehealth · Global Connection',
    description:
      'AI-first telehealth. Human care. Discover language voice and connected virtual care with DoctaRx.',
    url: 'https://doctarx.com/',
    siteName: 'DoctaRx',
    locale: 'en_US',
    alternateLocale: ['en_NG'],
    type: 'website',
    images: ['/opengraph-image'],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'DoctaRx | AI-First Telehealth · Global Connection',
    description:
      'AI-first telehealth. Human care. Discover language voice and connected virtual care with DoctaRx.',
    images: ['/opengraph-image'],
  },
};

export default function HomePage() {
  return <MarketHomepage market="US" />;
}
