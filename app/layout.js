import './globals.css';
import { Toaster } from '@/components/ui/toaster';
import { AuthProvider } from '@/components/providers/AuthProvider';
import { HiveProvider } from '@/components/providers/HiveProvider';
import { I18nProvider } from '@/components/providers/I18nProvider';
import ConditionalSiteFooter from '@/components/layouts/ConditionalSiteFooter';
import GoogleAnalytics from '@/components/analytics/GoogleAnalytics';
import { THEME_STORAGE_KEY } from '@/lib/theme';

export const metadata = {
  title: {
    default: 'DoctaRx | HIPAA-Compliant Telehealth & AI-Powered E-Prescribing Platform',
    template: '%s | DoctaRx'
  },
  description: 'DoctaRx is a HIPAA-compliant telehealth platform with AI-powered triage, video consultations, encrypted messaging, SOAP notes, and subscription billing. Connect patients with providers securely.',
  keywords: 'telehealth, telemedicine, e-prescribing, HIPAA compliant, AI triage, video consultation, online doctor, digital health, healthcare platform, virtual healthcare, medical records, telehealth platform, AI medical triage, telehealth video consultation, virtual healthcare platform, telemedicine software, HIPAA compliant video visits',
  authors: [{ name: 'DoctaRx' }],
  creator: 'DoctaRx',
  publisher: 'DoctaRx',
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-video-preview': -1,
      'max-image-preview': 'large',
      'max-snippet': -1,
    },
  },
  alternates: {
    canonical: 'https://doctarx.com',
  },
  openGraph: {
    type: 'website',
    locale: 'en_US',
    url: 'https://doctarx.com',
    siteName: 'DoctaRx',
    title: 'DoctaRx | HIPAA-Compliant Telehealth & AI-Powered Healthcare',
    description: 'HIPAA-compliant telehealth with AI triage, video visits, encrypted messaging, and e-prescribing. Secure healthcare on any device.',
    images: [
      {
        url: 'https://doctarx.com/og-image.png',
        width: 1200,
        height: 630,
        alt: 'DoctaRx - HIPAA-Compliant Telehealth & AI-Powered E-Prescribing Platform',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'DoctaRx | HIPAA-Compliant Telehealth & AI-Powered Healthcare',
    description: 'HIPAA-compliant telehealth with AI triage, video visits, encrypted messaging, and e-prescribing.',
    images: ['https://doctarx.com/og-image.png'],
  },
  icons: {
    icon: [
      { url: '/favicon.ico', sizes: 'any' },
      { url: '/icon.svg', type: 'image/svg+xml' }
    ],
    apple: '/icon.svg'
  },
  verification: {
    // Add Google Search Console verification code after setup:
    // google: 'your-google-verification-code',
    // yandex: 'your-yandex-verification-code',
  },
};

export const viewport = {
  width: 'device-width',
  initialScale: 1
};

// JSON-LD Structured Data for SEO
const jsonLdApp = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  "name": "DoctaRx",
  "operatingSystem": "Web",
  "applicationCategory": "HealthApplication",
  "description": "HIPAA-compliant telehealth platform with AI-powered triage, video consultations, encrypted messaging, SOAP notes, and subscription billing.",
  "url": "https://doctarx.com",
  "offers": {
    "@type": "AggregateOffer",
    "priceCurrency": "USD",
    "lowPrice": "0",
    "highPrice": "49.99",
    "offerCount": "3"
  },
  "aggregateRating": {
    "@type": "AggregateRating",
    "ratingValue": "4.9",
    "bestRating": "5",
    "ratingCount": "24"
  },
  "provider": {
    "@type": "Organization",
    "name": "DoctaRx",
    "url": "https://doctarx.com"
  }
};

const jsonLdOrg = {
  "@context": "https://schema.org",
  "@type": "MedicalOrganization",
  "name": "DoctaRx",
  "url": "https://doctarx.com",
  "logo": "https://doctarx.com/icon.svg",
  "description": "DoctaRx is a HIPAA-compliant telehealth platform providing AI-powered triage, secure video consultations, encrypted messaging, and e-prescribing services.",
  "email": "info@doctarx.com",
  "sameAs": [],
  "medicalSpecialty": "Primary Care",
  "availableService": {
    "@type": "MedicalTherapy",
    "name": "Telehealth Consultation",
    "description": "Secure HD video consultations with board-certified physicians"
  }
};

const jsonLdWebsite = {
  "@context": "https://schema.org",
  "@type": "WebSite",
  "name": "DoctaRx",
  "url": "https://doctarx.com",
  "description": "HIPAA-compliant telehealth platform with AI-powered triage and e-prescribing",
  "publisher": {
    "@type": "Organization",
    "name": "DoctaRx",
    "url": "https://doctarx.com"
  }
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Favicon and icons */}
        <link rel="icon" href="/favicon.ico" sizes="any" />
        <link rel="icon" href="/icon.svg" type="image/svg+xml" />
        <link rel="apple-touch-icon" href="/icon.svg" />
        
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link 
          href="https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,100..1000;1,9..40,100..1000&family=Instrument+Serif:ital@0;1&display=swap" 
          rel="stylesheet" 
        />
        {/* JSON-LD Structured Data */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLdApp) }}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLdOrg) }}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLdWebsite) }}
        />
        {/* Prevent theme flash: set `.dark` before React hydrates */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var k='${THEME_STORAGE_KEY}';var t=localStorage.getItem(k);if(t!=='dark'&&t!=='light'){t=window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';}if(t==='dark'){document.documentElement.classList.add('dark');}}catch(e){}})();`
          }}
        />
      </head>
      <body className="min-h-screen bg-background font-sans antialiased" suppressHydrationWarning>
        <GoogleAnalytics />
        <I18nProvider>
          <AuthProvider>
            <HiveProvider>
              {children}
              <ConditionalSiteFooter />
              <Toaster />
            </HiveProvider>
          </AuthProvider>
        </I18nProvider>
      </body>
    </html>
  );
}

