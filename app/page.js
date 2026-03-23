import MarketHomepage from '@/components/marketing/MarketHomepage';

export const metadata = {
  title: 'United States Telehealth',
  description:
    'DoctaRx delivers a premium US telehealth experience with secure visits, messaging, e-prescribing, insurance-ready workflows, and connected pharmacy coordination.',
  alternates: {
    canonical: 'https://doctarx.com/',
  },
  openGraph: {
    title: 'DoctaRx United States',
    description:
      'Secure visits, messaging, e-prescribing, insurance-ready workflows, and pharmacy coordination for the US care experience.',
    url: 'https://doctarx.com/',
    siteName: 'DoctaRx',
    locale: 'en_US',
    type: 'website',
    images: ['/opengraph-image'],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'DoctaRx United States',
    description:
      'Secure visits, messaging, e-prescribing, insurance-ready workflows, and pharmacy coordination for the US care experience.',
    images: ['/opengraph-image'],
  },
};

export default function HomePage() {
  return <MarketHomepage market="US" />;
}
