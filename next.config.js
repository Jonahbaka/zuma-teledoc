/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  compress: true,
  
  // Security headers
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          {
            key: 'X-DNS-Prefetch-Control',
            value: 'on'
          },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains; preload'
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

  // Rewrites for API proxy
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `${process.env.NEXT_PUBLIC_API_URL || 'https://doctarx.com/api'}/:path*`
      }
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
    serverActions: {
      allowedOrigins: ['doctarx.com', 'www.doctarx.com', 'localhost:3000']
    }
  }
};

module.exports = nextConfig;

