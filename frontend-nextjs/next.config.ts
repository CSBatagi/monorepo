import type { NextConfig } from "next";


// If LOCAL_DEV is set to "true", use local settings. Otherwise, use server defaults.
const isLocal = process.env.LOCAL_DEV === "true";

const nextConfig: NextConfig = {
  output: isLocal ? undefined : 'standalone',
  basePath: isLocal ? '' : '/test',
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
    ],
  },
};

export default nextConfig;
