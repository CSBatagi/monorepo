import type { NextConfig } from "next";

// If LOCAL_DEV is set to "true", use local settings. Otherwise, use server defaults.
const isLocal = process.env.LOCAL_DEV === "true";
// Only the explicit loopback review runner enables this separate dev build.
const isCinematicPreview = process.env.CSBATAGI_CINEMATIC_PREVIEW === "true";
const currentBasePath = '';

const nextConfig: NextConfig = {
  distDir: isCinematicPreview ? (process.env.CSBATAGI_CINEMATIC_BUILD === 'true' ? '.next-cinematic-build' : '.next-cinematic-preview') : '.next',
  devIndicators: isCinematicPreview ? false : undefined,
  output: isLocal ? undefined : 'standalone',
  basePath: currentBasePath,
  env: {
    NEXT_PUBLIC_BASE_PATH: currentBasePath, // Expose basePath to the client
  },
  experimental: {
    optimizePackageImports: ['lucide-react'],
  },
  eslint: {
    // Warning: This allows production builds to successfully complete even if
    // your project has ESLint errors.
    ignoreDuringBuilds: true,
  },
  typescript: {
    tsconfigPath: isCinematicPreview ? 'tsconfig.cinematic-preview.json' : 'tsconfig.json',
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
