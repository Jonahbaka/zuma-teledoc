export default function manifest() {
  return {
    name: 'DoctaRx',
    short_name: 'DoctaRx',
    description:
      'DoctaRx delivers secure virtual care, prescriptions, messaging, and pharmacy coordination in a mobile-ready experience.',
    start_url: '/',
    id: '/',
    scope: '/',
    display: 'standalone',
    display_override: ['window-controls-overlay', 'standalone', 'minimal-ui'],
    orientation: 'any',
    background_color: '#020617',
    theme_color: '#0f172a',
    dir: 'ltr',
    lang: 'en',
    prefer_related_applications: false,
    launch_handler: {
      client_mode: 'navigate-existing'
    },
    categories: ['medical', 'health', 'productivity'],
    icons: [
      {
        src: '/icon-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any'
      },
      {
        src: '/icon-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any'
      },
      {
        src: '/icon-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any maskable'
      }
    ],
    shortcuts: [
      {
        name: 'Patient Login',
        short_name: 'Patient',
        url: '/patient/login'
      },
      {
        name: 'Nigeria Patient Login',
        short_name: 'NG Patient',
        url: '/ng/patient/login'
      },
      {
        name: 'Provider Login',
        short_name: 'Provider',
        url: '/provider/login'
      },
      {
        name: 'Nigeria Provider Login',
        short_name: 'NG Provider',
        url: '/ng/provider/login'
      },
      {
        name: 'Nigeria Pharmacy Login',
        short_name: 'NG Pharmacy',
        url: '/ng/pharmacy/login'
      },
      {
        name: 'Nigeria',
        short_name: 'Nigeria',
        url: '/ng'
      }
    ]
  };
}
