import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['@zkusd/config', '@zkusd/sdk', '@zkusd/types', '@zkusd/utils'],
};

export default nextConfig;
