import path from 'node:path';
import { fileURLToPath } from 'node:url';

const apiUrl = process.env.API_INTERNAL_URL || 'http://localhost:4000';
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const isProduction = process.env.NODE_ENV === 'production';

// Applied to real builds only: the dev server needs eval and a websocket for hot reload.
const contentSecurityPolicy = [
  "default-src 'self'",
  // Next.js starts each page with small inline scripts. No eval, no third-party scripts.
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  // The organiser's logo is hosted elsewhere (https only).
  "img-src 'self' data: blob: https:",
  "media-src 'self' blob: mediastream:",
  "connect-src 'self'",
  "worker-src 'self'",
  "font-src 'self' data:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  // Pass links are secrets: never tell another site which page a visitor came from.
  { key: 'Referrer-Policy', value: 'no-referrer' },
  // The scanner needs the camera; nothing needs the rest.
  { key: 'Permissions-Policy', value: 'camera=(self), microphone=(), geolocation=(), payment=(), usb=()' },
  { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
  ...(isProduction
    ? [
        { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
        { key: 'Content-Security-Policy', value: contentSecurityPolicy },
      ]
    : []),
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  outputFileTracingRoot: repoRoot,
  // Set by the Dockerfile: produces a self-contained server in .next/standalone.
  output: process.env.NEXT_OUTPUT === 'standalone' ? 'standalone' : undefined,
  async headers() {
    return [
      { source: '/:path*', headers: securityHeaders },
      {
        // Always re-check the service worker so fixes reach phones promptly.
        source: '/sw.js',
        headers: [{ key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' }],
      },
    ];
  },
  // The browser only ever talks to this origin; /api/* is forwarded to the Express API.
  // That keeps session cookies first-party and same-site. Note: this rule is fixed when the
  // app is BUILT, so API_INTERNAL_URL must be set for `next build` as well as at run time.
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${apiUrl}/api/:path*` }];
  },
};

export default nextConfig;
