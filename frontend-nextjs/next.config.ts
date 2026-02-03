import type { NextConfig } from "next";

// If LOCAL_DEV is set to "true", use local settings. Otherwise, use server defaults.
const isLocal = process.env.LOCAL_DEV === "true";
const currentBasePath = '';

const nextConfig: NextConfig = {
  output: isLocal ? undefined : 'standalone',
  basePath: currentBasePath,
  env: {
    NEXT_PUBLIC_BASE_PATH: currentBasePath, // Expose basePath to the client
  },
  eslint: {
    // Warning: This allows production builds to successfully complete even if
    // your project has ESLint errors.
    ignoreDuringBuilds: true,
  },
  typescript: {
    // !! WARN !!
    // Dangerously allow production builds to successfully complete even if
    // your project has type errors.
    // !! WARN !!
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true, // Disable image optimization for Docker/standalone builds
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'lh3.googleusercontent.com',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'avatars.steamstatic.com',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'avatars.akamai.steamstatic.com',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'steamcdn-a.akamaihd.net',
        port: '',
        pathname: '/**',
      },
    ],
  },
};

export default nextConfig;
