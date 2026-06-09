import './globals.css';
import { Toaster } from '@/components/ui/toaster';
import { AuthProvider } from '@/components/providers/AuthProvider';
import { I18nProvider } from '@/components/providers/I18nProvider';
import ClientRuntime from '@/components/providers/ClientRuntime';
import ConditionalSiteFooter from '@/components/layouts/ConditionalSiteFooter';
import { THEME_STORAGE_KEY } from '@/lib/theme';

export const metadata = {
  metadataBase: new URL('https://doctarx.com'),
  title: {
    default: 'DoctaRx | Virtual Care, Prescriptions, and Pharmacy Coordination',
    template: '%s | DoctaRx'
  },
  description: 'DoctaRx is a modern healthcare platform for virtual care, secure messaging, e-prescribing, prescription routing, and pharmacy coordination across market-specific experiences.',
  keywords: 'telehealth platform, virtual care, e-prescribing, secure messaging, pharmacy coordination, digital health, healthcare operations',
  authors: [{ name: 'DoctaRx' }],
  creator: 'DoctaRx',
  publisher: 'DoctaRx',
  applicationName: 'DoctaRx',
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'DoctaRx',
  },
  formatDetection: {
    telephone: false,
    email: false,
    address: false,
  },
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
    images: ['/opengraph-image'],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'DoctaRx | HIPAA-Compliant Telehealth & AI-Powered Healthcare',
    description: 'HIPAA-compliant telehealth with AI triage, video visits, encrypted messaging, and e-prescribing.',
    images: ['/opengraph-image'],
  },
  icons: {
    icon: [
      { url: '/favicon.ico', sizes: 'any' },
      { url: '/icon.svg', type: 'image/svg+xml' },
      { url: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: [
      { url: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }
    ],
    other: [
      {
        rel: 'mask-icon',
        url: '/icon.svg',
        color: '#0f172a'
      }
    ]
  },
  verification: {
    // Add Google Search Console verification code after setup:
    // google: 'your-google-verification-code',
    // yandex: 'your-yandex-verification-code',
  },
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  interactiveWidget: 'resizes-content',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f8fafc' },
    { media: '(prefers-color-scheme: dark)', color: '#020617' }
  ]
};

// JSON-LD Structured Data for SEO
const jsonLdApp = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  "name": "DoctaRx",
  "operatingSystem": "Web",
  "applicationCategory": "HealthApplication",
  "description": "Telehealth, messaging, prescription routing, and pharmacy coordination with market-specific experiences.",
  "url": "https://doctarx.com",
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
  "description": "DoctaRx is a healthcare technology platform for virtual care, secure communication, prescription routing, and pharmacy coordination.",
  "email": "info@doctarx.com",
  "sameAs": [],
  "medicalSpecialty": "Primary Care",
  "availableService": {
    "@type": "MedicalTherapy",
    "name": "Digital Healthcare Workflow",
    "description": "Secure virtual care, messaging, prescription routing, and pharmacy coordination"
  }
};

const jsonLdWebsite = {
  "@context": "https://schema.org",
  "@type": "WebSite",
  "name": "DoctaRx",
  "url": "https://doctarx.com",
  "description": "Market-specific digital healthcare experiences for virtual care, prescription routing, and pharmacy coordination",
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
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" sizes="180x180" />
        <meta name="application-name" content="DoctaRx" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="DoctaRx" />
        <meta name="msapplication-TileColor" content="#0f172a" />
        
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
      <body className="min-h-[100dvh] overflow-x-clip bg-background font-sans antialiased" suppressHydrationWarning>
        <ClientRuntime />
        <I18nProvider>
          <AuthProvider>
            <div className="app-shell-root">
              {children}
              <ConditionalSiteFooter />
              <Toaster />
            </div>
          </AuthProvider>
        </I18nProvider>
      </body>
    </html>
  );
}

