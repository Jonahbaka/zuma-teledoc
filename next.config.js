/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  compress: true,
  distDir: process.env.NEXT_DIST_DIR || '.next',
  productionBrowserSourceMaps: false,
  outputFileTracingRoot: __dirname,
  
  // Security headers
  async headers() {
    return [
      {
        source: '/sw.js',
        headers: [
          {
            key: 'Cache-Control',
            value: 'no-cache, no-store, must-revalidate'
          }
        ]
      },
      {
        source: '/manifest.webmanifest',
        headers: [
          {
            key: 'Content-Type',
            value: 'application/manifest+json'
          },
          {
            key: 'Cache-Control',
            value: 'public, max-age=0, must-revalidate'
          }
        ]
      },
      {
        source: '/:path*',
        headers: [
          {
            key: 'X-DNS-Prefetch-Control',
            value: 'on'
          },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=31536000; includeSubDomains'
          },
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff'
          },
          {
            key: 'X-Frame-Options',
            value: 'SAMEORIGIN'
          },
          {
            key: 'X-XSS-Protection',
            value: '1; mode=block'
          },
          {
            key: 'Referrer-Policy',
            value: 'strict-origin-when-cross-origin'
          },
          {
            key: 'Permissions-Policy',
            value: 'camera=(self), microphone=(self), geolocation=(self)'
          }
        ]
      }
    ];
  },

  async redirects() {
    return [
      { source: '/ng/secure/admin', destination: '/ng/admin/login', permanent: false },
      { source: '/ng/secure/admin/:path*', destination: '/ng/admin/login', permanent: false },
    ];
  },

  // Environment variables exposed to client
  env: {
    NEXT_PUBLIC_APP_NAME: 'DoctaRx',
    NEXT_PUBLIC_APP_VERSION: '1.0.0',
    NEXT_PUBLIC_APP_DOMAIN: 'doctarx.com'
  },

  // Image optimization
  images: {
    // The production custom server serves public image files reliably, but the
    // Next image optimizer route is not available behind the current Express/Nginx
    // deployment path. Serve the checked-in responsive assets directly instead of
    // rendering broken /_next/image URLs in production.
    unoptimized: true,
    domains: ['doctarx.com', 'www.doctarx.com', 'localhost'],
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'doctarx.com',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: '*.stripe.com',
        pathname: '/**',
      }
    ],
    formats: ['image/avif', 'image/webp']
  },

  // Experimental features
  experimental: {
    optimizePackageImports: ['lucide-react'],
    serverActions: {
      allowedOrigins: ['doctarx.com', 'www.doctarx.com', 'localhost:3000']
    }
  }
};

module.exports = nextConfig;

