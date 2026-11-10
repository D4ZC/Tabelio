import type { NextConfig } from 'next';
import { networkInterfaces } from 'node:os';
import { apiProxyTarget } from './lib/api-endpoint';
import { isPrivateIpv4 } from './lib/local-access';

const nextConfig: NextConfig = {
  output: 'standalone',
  devIndicators: false,
  outputFileTracingExcludes: { '/*': ['../../.certificates/**/*', '../../.env', '../../.env.*'] },
  allowedDevOrigins: ['localhost', '127.0.0.1', ...Object.values(networkInterfaces()).flatMap((entries) => entries ?? [])
    .filter((entry) => !entry.internal && entry.family === 'IPv4' && isPrivateIpv4(entry.address)).map((entry) => entry.address)],
  // Preserve the assistant's three 20 MB attachments, including multipart overhead.
  experimental: { proxyClientMaxBodySize: '65mb' },
  async rewrites() {
    const target = apiProxyTarget(process.env.API_PROXY_TARGET ?? process.env.NEXT_PUBLIC_API_URL);
    return { fallback: [{ source: '/api/:path*', destination: `${target}/:path*` }] };
  },
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{
        key: 'Permissions-Policy',
        value: 'camera=(), microphone=(self), geolocation=()',
      }],
    }];
  },
};

export default nextConfig;
