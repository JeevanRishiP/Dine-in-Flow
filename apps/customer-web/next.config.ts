import type { NextConfig } from 'next';
import { PHASE_DEVELOPMENT_SERVER } from 'next/constants';

const apiOrigin = (
  process.env['API_INTERNAL_URL'] ||
  process.env['NEXT_PUBLIC_API_URL'] ||
  'http://localhost:3000'
).replace(/\/+$/, '');

const wsOrigin = apiOrigin.replace(/^http/i, 'ws');
const isProd = process.env['NODE_ENV'] === 'production';

const connectSources = [
  "'self'",
  'https://accounts.google.com',
  ...(isProd
    ? [apiOrigin, wsOrigin]
    : ['http://localhost:3000', 'http://127.0.0.1:3000', 'ws://localhost:3000', apiOrigin, wsOrigin]),
];

export default function nextConfig(phase: string): NextConfig {
  return {
    distDir: phase === PHASE_DEVELOPMENT_SERVER ? '.next-dev' : '.next',
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
            {
              key: 'Referrer-Policy',
              value: 'strict-origin-when-cross-origin',
            },
            {
              key: 'Permissions-Policy',
              value: 'camera=(), microphone=(), geolocation=()',
            },
            ...(isProd
              ? [{ key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' }]
              : []),
            {
              key: 'Content-Security-Policy',
              value: [
                "default-src 'self'",
                `script-src 'self' 'unsafe-inline' https://accounts.google.com/gsi/client${isProd ? '' : " 'unsafe-eval'"}`,
                "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://accounts.google.com/gsi/style",
                "img-src 'self' data: blob: https:",
                `connect-src ${Array.from(new Set(connectSources)).join(' ')}`,
                "frame-src 'self' https://accounts.google.com/gsi/",
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
}
