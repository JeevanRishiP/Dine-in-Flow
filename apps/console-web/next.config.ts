import type { NextConfig } from 'next';

const apiOrigin = (
  process.env['API_INTERNAL_URL'] ||
  process.env['NEXT_PUBLIC_API_URL'] ||
  'http://localhost:3000'
).replace(/\/+$/, '');

const wsOrigin = apiOrigin.replace(/^http/i, 'ws');
const isProd = process.env['NODE_ENV'] === 'production';

const connectSources = [
  "'self'",
  ...(isProd
    ? [apiOrigin, wsOrigin]
    : ['http://localhost:3000', 'http://127.0.0.1:3000', 'ws://localhost:3000', apiOrigin, wsOrigin]),
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `${apiOrigin}/:path*`,
      },
    ];
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          ...(isProd
            ? [{ key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' }]
            : []),
          {
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              `script-src 'self' 'unsafe-inline'${isProd ? '' : " 'unsafe-eval'"}`,
              "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
              "img-src 'self' data: blob: https://images.unsplash.com",
              `connect-src ${Array.from(new Set(connectSources)).join(' ')}`,
              "font-src 'self' https://fonts.gstatic.com",
              "frame-ancestors 'none'",
              "base-uri 'self'",
              "form-action 'self'",
            ].join('; '),
          },
        ],
      },
    ];
  },
};

export default nextConfig;
