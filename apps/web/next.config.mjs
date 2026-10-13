import path from 'node:path';
import { fileURLToPath } from 'node:url';

const apiUrl = process.env.API_INTERNAL_URL || 'http://localhost:4000';
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  outputFileTracingRoot: repoRoot,
  // The browser only ever talks to this origin; /api/* is forwarded to the Express API.
  // That keeps session cookies first-party and same-site.
  async headers() {
    return [
      {
        // Always re-check the service worker so fixes reach phones promptly.
        source: '/sw.js',
        headers: [{ key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' }],
      },
    ];
  },
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${apiUrl}/api/:path*` }];
  },
};

export default nextConfig;
