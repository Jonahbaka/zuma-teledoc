import MarketHomepage from '@/components/marketing/MarketHomepage';

const nigeriaStructuredData = [
  {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name: 'DoctaRx Nigeria | AI-First Telehealth & Language Voice',
    description:
      'Discover AI-first telehealth, language voice and clinician-connected care with DoctaRx Nigeria.',
    url: 'https://doctarx.com/ng',
    inLanguage: 'en-NG',
    isPartOf: {
      '@type': 'WebSite',
      name: 'DoctaRx',
      url: 'https://doctarx.com',
    },
    about: [
      { '@type': 'Thing', name: 'Telehealth in Nigeria' },
      { '@type': 'Thing', name: 'Online doctor consultation Nigeria' },
      { '@type': 'Thing', name: 'Online pharmacy Nigeria' },
    ],
    primaryImageOfPage: 'https://doctarx.com/ng/opengraph-image',
  },
  {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: 'DoctaRx Nigeria',
    url: 'https://doctarx.com/ng',
    logo: 'https://doctarx.com/icon.svg',
    description:
      'DoctaRx connects market-specific telehealth, health records, messaging, and pharmacy options in Nigeria. Services depend on availability and clinical authorization.',
    areaServed: {
      '@type': 'Country',
      name: 'Nigeria',
    },
    hasOfferCatalog: {
      '@type': 'OfferCatalog', name: 'Care coordination features',
      itemListElement: [
      {
        '@type': 'Service',
        name: 'Online doctor consultation',
        serviceType: 'Telehealth consultation',
      },
      {
        '@type': 'Service',
        name: 'Prescription management',
        serviceType: 'Prescription upload and review',
      },
      {
        '@type': 'Service',
        name: 'Pharmacy coordination',
        serviceType: 'Medicine search, pharmacy confirmation, and fulfillment',
      },
      ],
    },
  },
  {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      {
        '@type': 'ListItem',
        position: 1,
        name: 'DoctaRx',
        item: 'https://doctarx.com/',
      },
      {
        '@type': 'ListItem',
        position: 2,
        name: 'Nigeria',
        item: 'https://doctarx.com/ng',
      },
    ],
  },
];

export const metadata = {
  title: 'AI-First Telehealth and Language Voice in Nigeria',
  description:
    'AI-first telehealth for Nigeria, built around your voice. Explore multilingual conversations, clinician-led care, health records and pharmacy coordination.',
  keywords: [
    'telehealth in Nigeria',
    'online doctor Nigeria',
    'doctor consultation Nigeria',
    'online pharmacy Nigeria',
    'healthcare platform Nigeria',
    'Nigerian telemedicine platform',
  ],
  category: 'Healthcare',
  alternates: {
    canonical: 'https://doctarx.com/ng',
    languages: {
      'en-US': 'https://doctarx.com/',
      'en-NG': 'https://doctarx.com/ng',
      'x-default': 'https://doctarx.com/',
    },
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-image-preview': 'large',
      'max-snippet': -1,
    },
  },
  openGraph: {
    title: 'DoctaRx Nigeria | AI-First Telehealth & Language Voice',
    description:
      'Discover AI-first telehealth, language voice and clinician-connected care with DoctaRx Nigeria.',
    url: 'https://doctarx.com/ng',
    siteName: 'DoctaRx Nigeria',
    locale: 'en_NG',
    alternateLocale: ['en_US'],
    type: 'website',
    images: ['/ng/opengraph-image'],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'DoctaRx Nigeria | AI-First Telehealth & Language Voice',
    description:
      'AI-first telehealth for Nigeria. Your voice, your language, and a more connected care experience.',
    images: ['/ng/opengraph-image'],
  },
  other: {
    'geo.region': 'NG',
    'geo.placename': 'Nigeria',
  },
};

export default function NigeriaLandingPage() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(nigeriaStructuredData) }}
      />
      <MarketHomepage market="NG" />
    </>
  );
}
