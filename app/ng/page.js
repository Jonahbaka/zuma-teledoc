import MarketHomepage from '@/components/marketing/MarketHomepage';

const nigeriaStructuredData = [
  {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name: 'DoctaRx Nigeria | Online Doctor Consultation, Prescriptions, and Pharmacy Access',
    description:
      'Book online doctor consultations in Nigeria, upload prescriptions, compare pharmacy availability, and manage medicine fulfillment in one secure platform.',
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
    '@type': 'MedicalOrganization',
    name: 'DoctaRx Nigeria',
    url: 'https://doctarx.com/ng',
    logo: 'https://doctarx.com/icon.svg',
    description:
      'DoctaRx Nigeria is a digital healthcare platform for online doctor consultations, prescription management, medicine search, and pharmacy coordination across Nigeria.',
    areaServed: {
      '@type': 'Country',
      name: 'Nigeria',
    },
    availableLanguage: ['en-NG', 'en'],
    availableService: [
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
  title: 'Online Doctor Consultation and Pharmacy Access in Nigeria',
  description:
    'DoctaRx Nigeria helps patients book online doctor consultations, upload prescriptions, compare pharmacy availability, and manage medicine fulfillment in one secure telehealth platform.',
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
    title: 'DoctaRx Nigeria | Online Doctor Consultation, Prescriptions, and Pharmacy Access',
    description:
      'Online doctor consultations, prescription upload, medicine search, and trusted pharmacy coordination for patients in Nigeria.',
    url: 'https://doctarx.com/ng',
    siteName: 'DoctaRx Nigeria',
    locale: 'en_NG',
    alternateLocale: ['en_US'],
    type: 'website',
    images: ['/ng/opengraph-image'],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'DoctaRx Nigeria | Online Doctor Consultation and Pharmacy Access',
    description:
      'Book online doctor consultations, upload prescriptions, compare pharmacy availability, and manage medicine access in Nigeria.',
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
