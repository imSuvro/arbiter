import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Windows developer workstations may not have permission to create the symlinks
  // used by standalone tracing. Linux CI and production builds still get the
  // minimal standalone image layout.
  output: process.platform === 'win32' ? undefined : 'standalone',
  reactStrictMode: true,
  poweredByHeader: false,
};

export default nextConfig;
