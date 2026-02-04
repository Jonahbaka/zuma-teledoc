import './globals.css';
import { Toaster } from '@/components/ui/toaster';
import { AuthProvider } from '@/components/providers/AuthProvider';
import ConditionalSiteFooter from '@/components/layouts/ConditionalSiteFooter';
import GoogleAnalytics from '@/components/analytics/GoogleAnalytics';
import { THEME_STORAGE_KEY } from '@/lib/theme';

export const metadata = {
  title: {
    default: 'DoctaRx | Telehealth & E-Prescribing Platform',
    template: '%s | DoctaRx'
  },
  description: 'Secure telehealth platform for providers and patients. Manage prescriptions, video consults, and medical records online.',
  keywords: 'telehealth, telemedicine, e-prescribing, virtual healthcare, doctor appointment, video consultation, online doctor, medical records, HIPAA compliant',
  authors: [{ name: 'DoctaRx' }],
  creator: 'DoctaRx',
  publisher: 'DoctaRx',
  robots: 'index, follow',
  openGraph: {
    type: 'website',
    locale: 'en_US',
    url: 'https://doctarx.com',
    siteName: 'DoctaRx',
    title: 'DoctaRx | Telehealth & E-Prescribing Platform',
    description: 'Secure telehealth platform for providers and patients. Manage prescriptions, video consults, and medical records online.',
    images: [
      {
        url: 'https://doctarx.com/og-image.png',
        width: 1200,
        height: 630,
        alt: 'DoctaRx - Telehealth & E-Prescribing Platform',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'DoctaRx | Telehealth & E-Prescribing Platform',
    description: 'Secure telehealth platform for providers and patients. Manage prescriptions, video consults, and medical records online.',
    images: ['https://doctarx.com/og-image.png'],
  },
  icons: {
    icon: [
      { url: '/favicon.ico', sizes: 'any' },
      { url: '/icon.svg', type: 'image/svg+xml' }
    ],
    apple: '/icon.svg'
  }
};

export const viewport = {
  width: 'device-width',
  initialScale: 1
};

// JSON-LD Structured Data for SEO
const jsonLd = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  "name": "DoctaRx",
  "operatingSystem": "Web",
  "applicationCategory": "MedicalApplication",
  "offers": {
    "@type": "Offer",
    "price": "0",
    "priceCurrency": "USD"
  },
  "description": "A secure telehealth and e-prescribing platform for healthcare providers and patients.",
  "aggregateRating": {
    "@type": "AggregateRating",
    "ratingValue": "4.8",
    "ratingCount": "24"
  },
  "author": {
    "@type": "Organization",
    "name": "DoctaRx Inc",
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
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
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
        <AuthProvider>
          {children}
          <ConditionalSiteFooter />
          <Toaster />
        </AuthProvider>
      </body>
    </html>
  );
}

